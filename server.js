// ╔══════════════════════════════════════════════════════════════════╗
// ║  DROPFLOW SERVER v3.1 — MongoDB Atlas                          ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const crypto   = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

// ── Raw body para webhooks ──────────────────────────────────────────
app.use('/api/pay/mp/webhook',     express.raw({ type: '*/*' }));
app.use('/api/pay/stripe/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));

// ── Config ──────────────────────────────────────────────────────────
const CFG = {
  port:         process.env.PORT             || 3000,
  mongoUri:     process.env.MONGODB_URI      || '',
  jwtSecret:    process.env.JWT_SECRET       || crypto.randomBytes(32).toString('hex'),
  jwtRefresh:   process.env.JWT_REFRESH      || crypto.randomBytes(32).toString('hex'),
  appUrl:       process.env.APP_URL          || 'https://www.dropflow.cl',
  mpToken:      process.env.MP_ACCESS_TOKEN  || '',
  stripeSecret: process.env.STRIPE_SECRET    || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  adminEmail:   process.env.ADMIN_EMAIL      || 'admin@dropflow.cl',
  adminPass:    process.env.ADMIN_PASS       || 'Hola1202',
};

// ── Planes ──────────────────────────────────────────────────────────
const PLANS = {
  free:        { price:0,     days:null, name:'Free',       features:{ maxOrders:50,  ai:false, metaAds:false, export:false } },
  pro_weekly:  { price:5990,  days:7,    name:'Pro Weekly', currency:'CLP', features:{ maxOrders:-1, ai:true, metaAds:true, export:true } },
  pro_monthly: { price:9990,  days:30,   name:'Pro Monthly',currency:'CLP', features:{ maxOrders:-1, ai:true, metaAds:true, export:true } },
  pro_usd:     { price:9.99,  days:30,   name:'Pro Monthly',currency:'USD', features:{ maxOrders:-1, ai:true, metaAds:true, export:true } },
  biz_monthly: { price:19990, days:30,   name:'Business',  currency:'CLP', features:{ maxOrders:-1, ai:true, metaAds:true, export:true, multiStore:true } },
  biz_usd:     { price:19.99, days:30,   name:'Business',  currency:'USD', features:{ maxOrders:-1, ai:true, metaAds:true, export:true, multiStore:true } },
  admin:       { price:0,     days:null, name:'Admin',      features:{ maxOrders:-1, ai:true, metaAds:true, export:true } },
};

// ── MongoDB ─────────────────────────────────────────────────────────
let db;
let client;

async function connectDB() {
  if (!CFG.mongoUri) throw new Error('MONGODB_URI no configurada');
  client = new MongoClient(CFG.mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db('dropflow');
  // Indices para performance
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('tokens').createIndex({ token: 1 });
  await db.collection('tokens').createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });
  await db.collection('data').createIndex({ email: 1 });
  console.log('✓ MongoDB conectado');
}

// Helpers de acceso a colecciones
const Users  = () => db.collection('users');
const Subs   = () => db.collection('subs');
const Data   = () => db.collection('data');
const Tokens = () => db.collection('tokens');

// ── Rate limiter (en memoria — stateless entre requests está bien) ──
const rateLimits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count:0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimits.set(key, entry);
  return entry.count > max;
}

// ── Auth middleware ─────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, CFG.jwtSecret);
    next();
  } catch(e) {
    if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── Subscription helpers ────────────────────────────────────────────
async function getSubscription(email) {
  const sub = await Subs().findOne({ email });
  if (!sub) return { plan:'free', active:true, expiresAt:null };
  if (sub.plan === 'free' || sub.plan === 'admin') return { ...sub, active:true };
  const active = sub.expiresAt ? Date.now() < sub.expiresAt : false;
  return { ...sub, active };
}

async function activatePlan(email, planKey, paymentId) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error('Plan inválido: ' + planKey);
  const now = Date.now();
  const sub = {
    email, plan: planKey, active: true,
    activatedAt: now,
    expiresAt: plan.days ? now + (plan.days * 86400000) : null,
    paymentId,
  };
  await Subs().updateOne({ email }, { $set: sub }, { upsert: true });
  console.log('✓ Plan activado:', email, '->', planKey);
}

async function canUsePro(email) {
  const sub = await getSubscription(email);
  return sub.active && sub.plan !== 'free';
}

// ── Token helpers ───────────────────────────────────────────────────
async function signTokens(user) {
  const payload = { id: user._id?.toString(), email: user.email, role: user.role };
  const access  = jwt.sign(payload, CFG.jwtSecret,  { expiresIn: '2h' });
  const refresh = jwt.sign(payload, CFG.jwtRefresh, { expiresIn: '30d' });
  await Tokens().insertOne({ token: refresh, email: user.email, createdAt: new Date() });
  return { access, refresh };
}

async function userPublic(email) {
  const u   = await Users().findOne({ email }, { projection:{ password:0 } });
  const sub = await getSubscription(email);
  if (!u) return null;
  return {
    id:         u._id?.toString(),
    name:       u.name,
    email:      u.email,
    role:       u.role,
    plan:       sub.plan,
    planActive: sub.active,
    expiresAt:  sub.expiresAt,
    features:   PLANS[sub.plan]?.features || PLANS.free.features,
  };
}

// ════════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip;
  if (rateLimit('reg:'+ip, 5, 60000)) return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos incompletos' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
  try {
    const exists = await Users().findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 12);
    const user = { name, email, role:'viewer', password:hash, createdAt: new Date() };
    await Users().insertOne(user);
    await Subs().insertOne({ email, plan:'free', active:true, expiresAt:null, createdAt: new Date() });
    const tokens = await signTokens(user);
    res.json({ ...tokens, user: await userPublic(email) });
  } catch(e) {
    if (e.code === 11000) return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip;
  if (rateLimit('login:'+ip, 10, 60000)) return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });
  const { email, password } = req.body;
  try {
    const user = await Users().findOne({ email });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });
    const tokens = await signTokens(user);
    res.json({ ...tokens, user: await userPublic(email) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refresh } = req.body;
  if (!refresh) return res.status(401).json({ error: 'Sin refresh token' });
  try {
    const payload = jwt.verify(refresh, CFG.jwtRefresh);
    const stored  = await Tokens().findOne({ token: refresh });
    if (!stored) return res.status(401).json({ error: 'Refresh token inválido' });
    const user = await Users().findOne({ email: payload.email });
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    // Rotar token
    await Tokens().deleteOne({ token: refresh });
    const tokens = await signTokens(user);
    res.json({ ...tokens, user: await userPublic(payload.email) });
  } catch(e) {
    await Tokens().deleteOne({ token: refresh });
    return res.status(401).json({ error: 'Refresh token expirado' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const { refresh } = req.body;
  if (refresh) await Tokens().deleteOne({ token: refresh });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const u = await userPublic(req.user.email);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(u);
});

// ════════════════════════════════════════════════════════════════════
//  USER DATA
// ════════════════════════════════════════════════════════════════════

app.get('/api/data', requireAuth, async (req, res) => {
  const d = await Data().findOne({ email: req.user.email }) || {};
  res.json({ orders: d.orders || [], meta: d.meta || null, config: d.config || {}, ppto: d.ppto || null });
});

app.post('/api/data', requireAuth, async (req, res) => {
  const sub = await getSubscription(req.user.email);
  const update = {};
  if (req.body.orders !== undefined) {
    const max = PLANS[sub.plan]?.features?.maxOrders || 50;
    update.orders = max === -1 ? req.body.orders : req.body.orders.slice(0, max);
  }
  if (req.body.meta !== undefined) {
    if (!(await canUsePro(req.user.email))) return res.status(403).json({ error:'Meta Ads requiere plan Pro', code:'UPGRADE_REQUIRED' });
    update.meta = req.body.meta;
  }
  if (req.body.config !== undefined) update.config = req.body.config;
  if (req.body.ppto   !== undefined) update.ppto   = req.body.ppto;
  await Data().updateOne({ email: req.user.email }, { $set: update }, { upsert: true });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
//  PAGOS — MERCADO PAGO
// ════════════════════════════════════════════════════════════════════

app.post('/api/pay/mp/create', requireAuth, async (req, res) => {
  const token = CFG.mpToken || 'APP_USR-5575668542953877-061919-7f87114d66b2727e7597d09a44745596-3276535336';
  const { planKey } = req.body;
  const plan = PLANS[planKey];
  if (!plan || !plan.price) return res.status(400).json({ error: 'Plan no válido: ' + planKey });
  console.log('MP /create — plan:', planKey, '| token:', token.slice(0,20) + '...');
  try {
    const preference = {
      items: [{ id:planKey, title:'Dropflow '+plan.name, description:'Contabilidad profesional para dropshipping', quantity:1, currency_id:plan.currency||'CLP', unit_price:plan.price }],
      payer: { email: req.user.email },
      back_urls: {
        success: CFG.appUrl + '?pay=ok&plan=' + planKey,
        failure: CFG.appUrl + '?pay=fail',
        pending: CFG.appUrl + '?pay=pending',
      },
      auto_return: 'approved',
      notification_url: CFG.appUrl + '/api/pay/mp/webhook',
      external_reference: req.user.email + '|||' + planKey + '|||' + Date.now(),
      statement_descriptor: 'DROPFLOW',
    };
    const r = await axios.post('https://api.mercadopago.com/checkout/preferences', preference, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log('MP preference OK, init_point:', r.data.init_point?.slice(0,60));
    res.json({ url: r.data.init_point, sandbox_url: r.data.sandbox_init_point, id: r.data.id });
  } catch(e) {
    const msg = e.response?.data?.message || e.response?.data?.error || e.message;
    console.error('MP /create error:', msg);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/pay/mp/webhook', async (req, res) => {
  res.status(200).send('OK');
  try {
    const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    if (body.type !== 'payment') return;
    const token = CFG.mpToken || 'APP_USR-5575668542953877-061919-7f87114d66b2727e7597d09a44745596-3276535336';
    const payResp = await axios.get('https://api.mercadopago.com/v1/payments/' + body.data?.id, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const pago = payResp.data;
    if (pago.status !== 'approved') return;
    const [email, planKey] = (pago.external_reference || '').split('|||');
    if (!email || !planKey) return;
    await activatePlan(email, planKey, pago.id);
  } catch(e) {
    console.error('MP webhook error:', e.message);
  }
});

app.post('/api/pay/mp/verify', requireAuth, async (req, res) => {
  const { payment_id, planKey } = req.body;
  if (!payment_id) return res.status(400).json({ ok:false, error:'Sin payment_id' });
  try {
    const token = CFG.mpToken || 'APP_USR-5575668542953877-061919-7f87114d66b2727e7597d09a44745596-3276535336';
    const r = await axios.get('https://api.mercadopago.com/v1/payments/' + payment_id, {
      headers: { Authorization: 'Bearer ' + token }
    });
    const pago = r.data;
    if (pago.status !== 'approved') return res.json({ ok:false, status:pago.status });
    await activatePlan(req.user.email, planKey || 'pro_monthly', pago.id);
    res.json({ ok:true, user: await userPublic(req.user.email) });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
//  META ADS
// ════════════════════════════════════════════════════════════════════

app.post('/api/meta/token', requireAuth, async (req, res) => {
  if (!(await canUsePro(req.user.email))) return res.status(403).json({ error:'Requiere plan Pro', code:'UPGRADE_REQUIRED' });
  await Data().updateOne({ email:req.user.email }, { $set:{ metaToken:req.body.token, metaAccount:req.body.adAccountId } }, { upsert:true });
  res.json({ ok:true });
});

app.get('/api/meta/live', requireAuth, async (req, res) => {
  if (!(await canUsePro(req.user.email))) return res.status(403).json({ error:'Requiere plan Pro', code:'UPGRADE_REQUIRED' });
  const d = await Data().findOne({ email:req.user.email }) || {};
  if (!d.metaToken || !d.metaAccount) return res.status(400).json({ error:'Meta Ads no configurado' });
  const since = req.query.desde || new Date(Date.now()-30*86400000).toISOString().split('T')[0];
  const until = req.query.hasta || new Date().toISOString().split('T')[0];
  try {
    const r = await axios.get('https://graph.facebook.com/v18.0/'+d.metaAccount+'/ads', {
      params: { fields:'name,effective_status,daily_budget,lifetime_budget,insights.date_preset(custom){time_range,spend,impressions,clicks,actions,action_values,ctr,cpc,cpm,frequency}', time_range:JSON.stringify({since,until}), limit:200, access_token:d.metaToken },
      timeout:15000,
    });
    const ads = (r.data.data||[]).map(ad => {
      const ins=ad.insights?.data?.[0]||{};
      const spend=parseFloat(ins.spend||0);
      const compras=parseInt((ins.actions||[]).find(a=>a.action_type==='purchase')?.value||0);
      const valorComp=parseFloat((ins.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
      return { nombre:ad.name, estado:(ad.effective_status||'').toLowerCase(), presupuesto:parseFloat(ad.daily_budget||ad.lifetime_budget||0)/100, gasto:spend, impresiones:parseInt(ins.impressions||0), clics:parseInt(ins.clicks||0), compras, valorConversiones:valorComp, roas:spend>0?valorComp/spend:0, ctr:parseFloat(ins.ctr||0), cpc:parseFloat(ins.cpc||0), cpm:parseFloat(ins.cpm||0), frecuencia:parseFloat(ins.frequency||0) };
    });
    res.json({ ads, fecha:new Date().toISOString() });
  } catch(e) {
    res.status(500).json({ error:e.response?.data?.error?.message||e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
//  DROPI
// ════════════════════════════════════════════════════════════════════

app.post('/api/dropi/login', requireAuth, async (req, res) => {
  try {
    const r = await axios.post('https://api.dropi.cl/api/v1/auth/login', req.body, { headers:{'Content-Type':'application/json'}, timeout:10000 });
    await Data().updateOne({ email:req.user.email }, { $set:{ dropiToken:r.data.token||r.data.access_token } }, { upsert:true });
    res.json({ ok:true });
  } catch(e) {
    res.status(400).json({ error:e.response?.data?.message||'Credenciales incorrectas' });
  }
});

app.get('/api/dropi/orders', requireAuth, async (req, res) => {
  const d = await Data().findOne({ email:req.user.email }) || {};
  if (!d.dropiToken) return res.status(400).json({ error:'Dropi no conectado' });
  try {
    const r = await axios.get('https://api.dropi.cl/api/v1/orders', {
      params:{ start_date:req.query.desde, end_date:req.query.hasta, per_page:500 },
      headers:{ Authorization:'Bearer '+d.dropiToken }, timeout:15000,
    });
    const raw = r.data.data||r.data.orders||[];
    const orders = raw.map((p,i) => {
      const venta=parseFloat(p.sale_price||p.price||0);
      const proveedor=parseFloat(p.cost_price||p.wholesale_price||0);
      const flete=parseFloat(p.shipping_cost||p.freight||2500);
      const comision=parseFloat(p.commission||0);
      const utilidad=venta-proveedor-flete-comision;
      return { id:String(p.id||p.order_id||i), fecha:(p.created_at||p.date||'').split('T')[0], producto:p.product_name||p.title||'Producto', estado:mapDropiStatus(p.status||p.estado), venta, proveedor, flete, comision, utilidad, margen:venta>0?(utilidad/venta)*100:0, ciudad:p.shipping_city||p.city||'' };
    });
    res.json({ orders, total:orders.length });
  } catch(e) {
    if (e.response?.status===401) { await Data().updateOne({email:req.user.email},{$set:{dropiToken:null}}); return res.status(401).json({error:'Sesión Dropi expirada'}); }
    res.status(500).json({ error:e.message });
  }
});

function mapDropiStatus(s='') {
  const m={delivered:'delivered',entregado:'delivered',in_transit:'transit',transito:'transit',enviado:'transit',returned:'returned',devuelto:'returned',cancelled:'cancelled',cancelado:'cancelled'};
  return m[s.toLowerCase()]||'pending';
}

// ════════════════════════════════════════════════════════════════════
//  SHOPIFY
// ════════════════════════════════════════════════════════════════════

app.post('/api/shopify/connect', requireAuth, async (req, res) => {
  const { shopUrl, clientId, clientSecret } = req.body;
  await Data().updateOne({ email:req.user.email }, { $set:{ shopify:{shopUrl,clientId,clientSecret} } }, { upsert:true });
  try {
    const r = await axios.get('https://'+shopUrl+'/admin/api/2024-01/shop.json', { auth:{ username:clientId, password:clientSecret } });
    res.json({ ok:true, shop:r.data.shop.name, domain:r.data.shop.domain });
  } catch(e) { res.status(400).json({ error:'No se pudo conectar con Shopify' }); }
});

app.get('/api/shopify/orders', requireAuth, async (req, res) => {
  const d = await Data().findOne({ email:req.user.email }) || {};
  const sh = d.shopify;
  if (!sh) return res.status(400).json({ error:'Shopify no configurado' });
  try {
    const r = await axios.get('https://'+sh.shopUrl+'/admin/api/2024-01/orders.json', {
      auth:{ username:sh.clientId, password:sh.clientSecret },
      params:{ created_at_min:req.query.desde+'T00:00:00', created_at_max:req.query.hasta+'T23:59:59', limit:250, status:'any' }
    });
    const flete=parseFloat(req.query.flete||2500);
    const orders=(r.data.orders||[]).map(o=>{
      const v=parseFloat(o.total_price);
      return { id:String(o.order_number), fecha:o.created_at?.split('T')[0], producto:o.line_items?.[0]?.name||'Producto', estado:mapShopifyStatus(o.fulfillment_status,o.financial_status), venta:v, proveedor:0, flete, comision:0, utilidad:v-flete, margen:v>0?(v-flete)/v*100:0, ciudad:o.shipping_address?.city||'' };
    });
    res.json({ orders });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

function mapShopifyStatus(f,fin) {
  if(fin==='refunded')return 'returned'; if(fin==='voided')return 'cancelled';
  if(f==='fulfilled')return 'delivered'; if(f==='partial')return 'transit';
  return 'pending';
}

// ════════════════════════════════════════════════════════════════════
//  IA
// ════════════════════════════════════════════════════════════════════

app.post('/api/ai', requireAuth, async (req, res) => {
  if (!(await canUsePro(req.user.email))) return res.status(403).json({ error:'IA requiere plan Pro', code:'UPGRADE_REQUIRED' });
  if (!CFG.anthropicKey) return res.status(500).json({ error:'ANTHROPIC_API_KEY no configurada en Render' });
  if (rateLimit('ai:'+req.user.email, 20, 60000)) return res.status(429).json({ error:'Límite de IA alcanzado. Espera 1 minuto.' });
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6', max_tokens:1000,
      system: req.body.system, messages: req.body.messages,
    }, { headers:{ 'x-api-key':CFG.anthropicKey, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' }, timeout:30000 });
    res.json(r.data);
  } catch(e) {
    res.status(500).json({ error:{ message:e.response?.data?.error?.message||e.message } });
  }
});

// ════════════════════════════════════════════════════════════════════
//  ADMIN + HEALTH + STATIC
// ════════════════════════════════════════════════════════════════════

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await Users().find({}, { projection:{password:0} }).toArray();
  const result = await Promise.all(users.map(async u => ({ ...u, sub: await getSubscription(u.email) })));
  res.json(result);
});

app.get('/health', async (req, res) => {
  res.json({ ok:true, version:'3.1-mongo', mp:!!CFG.mpToken, ai:!!CFG.anthropicKey });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dropflow.html')));
app.use(express.static(__dirname));

// ════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════

async function init() {
  await connectDB();

  // Crear/actualizar admin
  const adminHash = await bcrypt.hash(CFG.adminPass, 12);
  await Users().updateOne(
    { email: CFG.adminEmail },
    { $set: { name:'Admin', email:CFG.adminEmail, role:'admin', password:adminHash, updatedAt:new Date() }, $setOnInsert:{ createdAt:new Date() } },
    { upsert: true }
  );
  await Subs().updateOne(
    { email: CFG.adminEmail },
    { $set: { plan:'admin', active:true, expiresAt:null } },
    { upsert: true }
  );
  console.log('✓ Admin:', CFG.adminEmail);

  app.listen(CFG.port, () => {
    console.log('\n🚀 Dropflow v3.1 MongoDB — puerto', CFG.port);
    console.log('   MP:', CFG.mpToken ? '✓' : '✗ falta MP_ACCESS_TOKEN');
    console.log('   AI:', CFG.anthropicKey ? '✓' : '✗ falta ANTHROPIC_API_KEY');
  });
}

process.on('SIGTERM', async () => { await client?.close(); process.exit(0); });
process.on('uncaughtException', e => console.error('Uncaught:', e.message));

init().catch(e => { console.error('Init error:', e.message); process.exit(1); });
