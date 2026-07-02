// ╔══════════════════════════════════════════════════════════════════╗
// ║  DROPFLOW SERVER v3.0                                           ║
// ║  Production-ready · MP + Stripe · Multi-country · Auth real     ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');

const app = express();

// ── Raw body for webhooks (must be before json middleware) ──────────
app.use('/api/mp/webhook',    express.raw({ type: '*/*' }));
app.use('/api/stripe/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));

// ── Config ──────────────────────────────────────────────────────────
const CFG = {
  port:          process.env.PORT            || 3000,
  jwtSecret:     process.env.JWT_SECRET      || crypto.randomBytes(32).toString('hex'),
  jwtRefresh:    process.env.JWT_REFRESH     || crypto.randomBytes(32).toString('hex'),
  appUrl:        process.env.APP_URL         || 'https://dropflow.cl',
  mpToken:       process.env.MP_ACCESS_TOKEN || '',
  mpPublicKey:   process.env.MP_PUBLIC_KEY   || '',
  stripeSecret:  process.env.STRIPE_SECRET   || '',
  stripeWebhook: process.env.STRIPE_WEBHOOK  || '',
  anthropicKey:  process.env.ANTHROPIC_API_KEY || '',
  adminEmail:    process.env.ADMIN_EMAIL     || 'admin@dropflow.cl',
  adminPass:     process.env.ADMIN_PASS      || 'Hola 1202',
  dbFile:        process.env.DB_FILE         || './db.json',
};

// ── Plans ────────────────────────────────────────────────────────────
const PLANS = {
  free:         { price: 0,    days: null, name: 'Free',          features: { maxOrders: 50, ai: false, metaAds: false, export: false } },
  pro_weekly:   { price: 5990, days: 7,    name: 'Pro Weekly',    currency: 'CLP', features: { maxOrders: -1, ai: true, metaAds: true, export: true } },
  pro_monthly:  { price: 9990, days: 30,   name: 'Pro Monthly',   currency: 'CLP', features: { maxOrders: -1, ai: true, metaAds: true, export: true } },
  pro_usd:      { price: 9.99, days: 30,   name: 'Pro Monthly',   currency: 'USD', features: { maxOrders: -1, ai: true, metaAds: true, export: true } },
  biz_monthly:  { price:19990, days: 30,   name: 'Business',      currency: 'CLP', features: { maxOrders: -1, ai: true, metaAds: true, export: true, multiStore: true } },
  biz_usd:      { price:19.99, days: 30,   name: 'Business',      currency: 'USD', features: { maxOrders: -1, ai: true, metaAds: true, export: true, multiStore: true } },
};

// ── DB (JSON file, good enough for MVP) ─────────────────────────────
let DB = { users: {}, subs: {}, data: {}, tokens: {} };

function loadDB() {
  try {
    if (fs.existsSync(CFG.dbFile)) {
      DB = JSON.parse(fs.readFileSync(CFG.dbFile, 'utf8'));
      // migrate old format
      if (Array.isArray(DB.users)) {
        const usersObj = {};
        DB.users.forEach(u => { usersObj[u.email] = u; });
        DB.users = usersObj;
      }
    }
  } catch(e) { console.error('DB load error:', e.message); }
}

let _dirty = false;
function markDirty() { _dirty = true; }
function saveDB() { try { fs.writeFileSync(CFG.dbFile, JSON.stringify(DB, null, 2)); } catch(e) {} }
setInterval(() => { if(_dirty){ saveDB(); _dirty = false; } }, 10000);
process.on('SIGTERM', () => { saveDB(); process.exit(0); });

// ── Rate limiter (simple in-memory) ─────────────────────────────────
const rateLimits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimits.set(key, entry);
  return entry.count > max;
}

// ── Auth middleware ──────────────────────────────────────────────────
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

// ── Subscription helpers ─────────────────────────────────────────────
function getSubscription(email) {
  const sub = DB.subs[email];
  if (!sub) return { plan: 'free', active: true, expiresAt: null };
  if (sub.plan === 'free' || sub.plan === 'admin') return { ...sub, active: true };
  const active = sub.expiresAt ? Date.now() < sub.expiresAt : false;
  return { ...sub, active };
}

function activatePlan(email, planKey, paymentId) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error('Invalid plan: ' + planKey);
  const now = Date.now();
  DB.subs[email] = {
    plan: planKey,
    active: true,
    activatedAt: now,
    expiresAt: plan.days ? now + (plan.days * 86400000) : null,
    paymentId,
  };
  markDirty();
  console.log(`✓ Plan activated: ${email} → ${planKey} (expires: ${plan.days ? new Date(DB.subs[email].expiresAt).toLocaleDateString() : 'never'})`);
}

function canUsePro(email) {
  const sub = getSubscription(email);
  return sub.active && sub.plan !== 'free';
}

// ── Token helpers ────────────────────────────────────────────────────
function signTokens(user) {
  const payload = { id: user.id, email: user.email, role: user.role };
  const access  = jwt.sign(payload, CFG.jwtSecret,  { expiresIn: '2h' });
  const refresh = jwt.sign(payload, CFG.jwtRefresh, { expiresIn: '30d' });
  DB.tokens[refresh] = { email: user.email, createdAt: Date.now() };
  markDirty();
  return { access, refresh };
}

function userPublic(email) {
  const u   = DB.users[email];
  const sub = getSubscription(email);
  return {
    id:        u.id,
    name:      u.name,
    email:     u.email,
    role:      u.role,
    plan:      sub.plan,
    planActive: sub.active,
    expiresAt: sub.expiresAt,
    features:  PLANS[sub.plan]?.features || PLANS.free.features,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip;
  if (rateLimit('reg:'+ip, 5, 60000)) return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });

  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campos incompletos' });
  if (password.length < 6)          return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
  if (DB.users[email])              return res.status(400).json({ error: 'Email ya registrado' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const user = { id: crypto.randomUUID(), name, email, role: 'viewer', password: hash, createdAt: Date.now() };
    DB.users[email] = user;
    DB.subs[email]  = { plan: 'free', active: true, expiresAt: null };
    markDirty();

    const tokens = signTokens(user);
    res.json({ ...tokens, user: userPublic(email) });
  } catch(e) {
    res.status(500).json({ error: 'Error creando cuenta: ' + e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip;
  if (rateLimit('login:'+ip, 10, 60000)) return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });

  const { email, password } = req.body;
  const user = DB.users[email];
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

  try {
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const tokens = signTokens(user);
    res.json({ ...tokens, user: userPublic(email) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Refresh token
app.post('/api/auth/refresh', (req, res) => {
  const { refresh } = req.body;
  if (!refresh || !DB.tokens[refresh]) return res.status(401).json({ error: 'Refresh token inválido' });

  try {
    const payload = jwt.verify(refresh, CFG.jwtRefresh);
    const user = DB.users[payload.email];
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    // Rotate refresh token
    delete DB.tokens[refresh];
    const tokens = signTokens(user);
    res.json({ ...tokens, user: userPublic(payload.email) });
  } catch(e) {
    delete DB.tokens[refresh];
    markDirty();
    return res.status(401).json({ error: 'Refresh token expirado' });
  }
});

// Logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const { refresh } = req.body;
  if (refresh) { delete DB.tokens[refresh]; markDirty(); }
  res.json({ ok: true });
});

// Me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = DB.users[req.user.email];
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(userPublic(req.user.email));
});

// ═══════════════════════════════════════════════════════════════════
//  USER DATA
// ═══════════════════════════════════════════════════════════════════

app.get('/api/data', requireAuth, (req, res) => {
  const d = DB.data[req.user.email] || {};
  res.json({ orders: d.orders || [], meta: d.meta || null, config: d.config || {}, ppto: d.ppto || null });
});

app.post('/api/data', requireAuth, (req, res) => {
  if (!DB.data[req.user.email]) DB.data[req.user.email] = {};
  const d = DB.data[req.user.email];

  // Enforce free plan limits on the server side
  if (req.body.orders !== undefined) {
    const sub = getSubscription(req.user.email);
    const maxOrders = PLANS[sub.plan]?.features?.maxOrders || 50;
    d.orders = maxOrders === -1 ? req.body.orders : req.body.orders.slice(0, maxOrders);
  }
  if (req.body.meta   !== undefined) {
    if (!canUsePro(req.user.email)) return res.status(403).json({ error: 'Meta Ads requiere plan Pro', code: 'UPGRADE_REQUIRED' });
    d.meta = req.body.meta;
  }
  if (req.body.config !== undefined) d.config = req.body.config;
  if (req.body.ppto   !== undefined) d.ppto   = req.body.ppto;

  markDirty();
  res.json({ ok: true });
});

// Admin: list users
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = Object.values(DB.users).map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role,
    sub: getSubscription(u.email), createdAt: u.createdAt,
  }));
  res.json(users);
});

app.delete('/api/users/:email', requireAuth, requireAdmin, (req, res) => {
  delete DB.users[req.params.email];
  delete DB.subs[req.params.email];
  delete DB.data[req.params.email];
  markDirty();
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS — MERCADO PAGO (LATAM)
// ═══════════════════════════════════════════════════════════════════

app.post('/api/pay/mp/create', requireAuth, async (req, res) => {
  // Usar token de env o el token de prueba hardcodeado como fallback
  const token = CFG.mpToken || 'TEST-5575668542953877-061919-8025e11bac1f04daa64d660cda3cb4d9-3276535336';
  console.log('MP create - planKey:', req.body.planKey, '- token:', token ? token.slice(0,20)+'...' : 'MISSING');
  if (!token) return res.status(500).json({ error: 'Mercado Pago no configurado. Agrega MP_ACCESS_TOKEN en Render.' });

  const { planKey } = req.body;
  const plan = PLANS[planKey];
  if (!plan || !plan.price) return res.status(400).json({ error: 'Plan no válido' });

  try {
    const preference = {
      items: [{
        id: planKey,
        title: `Dropflow ${plan.name}`,
        description: 'Contabilidad profesional para dropshipping',
        quantity: 1,
        currency_id: plan.currency || 'CLP',
        unit_price: plan.price,
      }],
      payer: { email: req.user.email },
      back_urls: {
        success: `${CFG.appUrl}?pay=ok&plan=${planKey}`,
        failure: `${CFG.appUrl}?pay=fail`,
        pending: `${CFG.appUrl}?pay=pending`,
      },
      auto_return: 'approved',
      notification_url: `${CFG.appUrl}/api/pay/mp/webhook`,
      external_reference: `${req.user.email}|||${planKey}|||${Date.now()}`,
      statement_descriptor: 'DROPFLOW',
    };

    const r = await axios.post('https://api.mercadopago.com/checkout/preferences', preference, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    console.log('MP response init_point:', r.data.init_point?.slice(0,60));
    res.json({ url: r.data.init_point, sandbox_url: r.data.sandbox_init_point, id: r.data.id });
  } catch(e) {
    console.error('MP create error:', JSON.stringify(e.response?.data || e.message));
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

// MP Webhook
app.post('/api/pay/mp/webhook', async (req, res) => {
  res.status(200).send('OK'); // Always respond fast to MP

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body.type !== 'payment') return;

    const payResp = await axios.get(`https://api.mercadopago.com/v1/payments/${body.data?.id}`, {
      headers: { Authorization: `Bearer ${CFG.mpToken || 'TEST-5575668542953877-061919-8025e11bac1f04daa64d660cda3cb4d9-3276535336'}` }
    });

    const pago = payResp.data;
    if (pago.status !== 'approved') return;

    const [email, planKey] = (pago.external_reference || '').split('|||');
    if (!email || !planKey) return;

    activatePlan(email, planKey, pago.id);
  } catch(e) {
    console.error('MP webhook error:', e.message);
  }
});

// Verify payment after redirect
app.post('/api/pay/mp/verify', requireAuth, async (req, res) => {
  const { payment_id, planKey } = req.body;
  if (!payment_id) return res.status(400).json({ ok: false, error: 'Sin payment_id' });

  try {
    const r = await axios.get(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      headers: { Authorization: `Bearer ${CFG.mpToken || 'TEST-5575668542953877-061919-8025e11bac1f04daa64d660cda3cb4d9-3276535336'}` }
    });

    const pago = r.data;
    if (pago.status !== 'approved') return res.json({ ok: false, status: pago.status });

    const resolvedPlan = planKey || 'pro_monthly';
    activatePlan(req.user.email, resolvedPlan, pago.id);
    res.json({ ok: true, user: userPublic(req.user.email) });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PAYMENTS — STRIPE (Global)
// ═══════════════════════════════════════════════════════════════════

app.post('/api/pay/stripe/create', requireAuth, async (req, res) => {
  if (!CFG.stripeSecret) return res.status(500).json({ error: 'Stripe no configurado' });

  const { planKey } = req.body;
  const plan = PLANS[planKey];
  if (!plan || !plan.price) return res.status(400).json({ error: 'Plan no válido' });

  try {
    const stripe = require('stripe')(CFG.stripeSecret);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: (plan.currency || 'usd').toLowerCase(),
          product_data: { name: `Dropflow ${plan.name}`, description: 'Contabilidad para dropshipping' },
          unit_amount: Math.round(plan.price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${CFG.appUrl}?pay=ok&plan=${planKey}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${CFG.appUrl}?pay=fail`,
      customer_email: req.user.email,
      metadata: { email: req.user.email, planKey },
    });
    res.json({ url: session.url, id: session.id });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Stripe webhook
app.post('/api/pay/stripe/webhook', async (req, res) => {
  if (!CFG.stripeSecret) return res.status(200).send('OK');

  try {
    const stripe = require('stripe')(CFG.stripeSecret);
    const event  = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], CFG.stripeWebhook);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { email, planKey } = session.metadata || {};
      if (email && planKey) activatePlan(email, planKey, session.payment_intent);
    }

    res.json({ received: true });
  } catch(e) {
    console.error('Stripe webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  META ADS
// ═══════════════════════════════════════════════════════════════════

app.post('/api/meta/token', requireAuth, (req, res) => {
  if (!canUsePro(req.user.email)) return res.status(403).json({ error: 'Requiere plan Pro', code: 'UPGRADE_REQUIRED' });
  if (!DB.data[req.user.email]) DB.data[req.user.email] = {};
  DB.data[req.user.email].metaToken   = req.body.token;
  DB.data[req.user.email].metaAccount = req.body.adAccountId;
  markDirty();
  res.json({ ok: true });
});

app.get('/api/meta/live', requireAuth, async (req, res) => {
  if (!canUsePro(req.user.email)) return res.status(403).json({ error: 'Requiere plan Pro', code: 'UPGRADE_REQUIRED' });

  const d = DB.data[req.user.email] || {};
  if (!d.metaToken || !d.metaAccount) return res.status(400).json({ error: 'Meta Ads no configurado' });

  const { desde, hasta } = req.query;
  const since = desde || new Date(Date.now()-30*86400000).toISOString().split('T')[0];
  const until = hasta || new Date().toISOString().split('T')[0];

  try {
    const r = await axios.get(`https://graph.facebook.com/v18.0/${d.metaAccount}/ads`, {
      params: {
        fields: `name,effective_status,daily_budget,lifetime_budget,insights.date_preset(custom){time_range,spend,impressions,clicks,actions,action_values,ctr,cpc,cpm,frequency}`,
        time_range: JSON.stringify({ since, until }),
        limit: 200,
        access_token: d.metaToken,
      },
      timeout: 15000,
    });

    const ads = (r.data.data || []).map(ad => {
      const ins   = ad.insights?.data?.[0] || {};
      const spend = parseFloat(ins.spend || 0);
      const compras = parseInt((ins.actions||[]).find(a=>a.action_type==='purchase')?.value || 0);
      const valorComp = parseFloat((ins.action_values||[]).find(a=>a.action_type==='purchase')?.value || 0);
      return {
        nombre:      ad.name,
        estado:      (ad.effective_status||'').toLowerCase(),
        presupuesto: parseFloat(ad.daily_budget||ad.lifetime_budget||0)/100,
        gasto:       spend,  // Returns in account currency
        impresiones: parseInt(ins.impressions||0),
        clics:       parseInt(ins.clicks||0),
        compras,
        valorConversiones: valorComp,
        roas:        spend>0 ? valorComp/spend : 0,
        ctr:         parseFloat(ins.ctr||0),
        cpc:         parseFloat(ins.cpc||0),
        cpm:         parseFloat(ins.cpm||0),
        frecuencia:  parseFloat(ins.frequency||0),
      };
    });

    res.json({ ads, fecha: new Date().toISOString() });
  } catch(e) {
    console.error('Meta error:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  DROPI
// ═══════════════════════════════════════════════════════════════════

app.post('/api/dropi/login', requireAuth, async (req, res) => {
  try {
    const r = await axios.post('https://api.dropi.cl/api/v1/auth/login', req.body, {
      headers: { 'Content-Type': 'application/json' }, timeout: 10000
    });
    if (!DB.data[req.user.email]) DB.data[req.user.email] = {};
    DB.data[req.user.email].dropiToken = r.data.token || r.data.access_token;
    markDirty();
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.response?.data?.message || 'Credenciales incorrectas' });
  }
});

app.get('/api/dropi/orders', requireAuth, async (req, res) => {
  const d = DB.data[req.user.email] || {};
  if (!d.dropiToken) return res.status(400).json({ error: 'Dropi no conectado. Reconecta.' });

  try {
    const r = await axios.get('https://api.dropi.cl/api/v1/orders', {
      params: { start_date: req.query.desde, end_date: req.query.hasta, per_page: 500 },
      headers: { Authorization: `Bearer ${d.dropiToken}` },
      timeout: 15000,
    });

    const raw = r.data.data || r.data.orders || [];
    const orders = raw.map(p => {
      const venta     = parseFloat(p.sale_price||p.price||0);
      const proveedor = parseFloat(p.cost_price||p.wholesale_price||0);
      const flete     = parseFloat(p.shipping_cost||p.freight||2500);
      const comision  = parseFloat(p.commission||0);
      const utilidad  = venta - proveedor - flete - comision;
      return {
        id:        String(p.id||p.order_id),
        fecha:     (p.created_at||p.date||'').split('T')[0],
        producto:  p.product_name||p.title||'Producto',
        estado:    mapDropiStatus(p.status||p.estado),
        venta, proveedor, flete, comision,
        utilidad,
        margen:    venta>0 ? (utilidad/venta)*100 : 0,
        ciudad:    p.shipping_city||p.city||'',
      };
    });

    res.json({ orders, total: orders.length });
  } catch(e) {
    if (e.response?.status===401) {
      if (DB.data[req.user.email]) DB.data[req.user.email].dropiToken = null;
      markDirty();
      return res.status(401).json({ error: 'Sesión Dropi expirada. Reconecta.' });
    }
    res.status(500).json({ error: e.message });
  }
});

function mapDropiStatus(s='') {
  const m = { delivered:'delivered', entregado:'delivered', in_transit:'transit', transito:'transit', enviado:'transit', returned:'returned', devuelto:'returned', cancelled:'cancelled', cancelado:'cancelled' };
  return m[s.toLowerCase()] || 'pending';
}

// ═══════════════════════════════════════════════════════════════════
//  SHOPIFY
// ═══════════════════════════════════════════════════════════════════

app.post('/api/shopify/connect', requireAuth, async (req, res) => {
  const { shopUrl, clientId, clientSecret } = req.body;
  if (!DB.data[req.user.email]) DB.data[req.user.email] = {};
  DB.data[req.user.email].shopify = { shopUrl, clientId, clientSecret };
  markDirty();
  try {
    const r = await axios.get(`https://${shopUrl}/admin/api/2024-01/shop.json`, { auth: { username: clientId, password: clientSecret } });
    res.json({ ok: true, shop: r.data.shop.name, domain: r.data.shop.domain });
  } catch(e) { res.status(400).json({ error: 'No se pudo conectar con Shopify' }); }
});

app.get('/api/shopify/orders', requireAuth, async (req, res) => {
  const sh = DB.data[req.user.email]?.shopify;
  if (!sh) return res.status(400).json({ error: 'Shopify no configurado' });
  try {
    const r = await axios.get(`https://${sh.shopUrl}/admin/api/2024-01/orders.json`, {
      auth: { username: sh.clientId, password: sh.clientSecret },
      params: { created_at_min: req.query.desde+'T00:00:00', created_at_max: req.query.hasta+'T23:59:59', limit: 250, status: 'any' }
    });
    const flete = parseFloat(req.query.flete||2500);
    const orders = (r.data.orders||[]).map(o => {
      const v = parseFloat(o.total_price);
      return { id: String(o.order_number), fecha: o.created_at?.split('T')[0], producto: o.line_items?.[0]?.name||'Producto', estado: mapShopifyStatus(o.fulfillment_status, o.financial_status), venta: v, proveedor: 0, flete, comision: 0, utilidad: v-flete, margen: v>0?(v-flete)/v*100:0, ciudad: o.shipping_address?.city||'' };
    });
    res.json({ orders });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function mapShopifyStatus(f, fin) {
  if (fin==='refunded') return 'returned';
  if (fin==='voided')   return 'cancelled';
  if (f==='fulfilled')  return 'delivered';
  if (f==='partial')    return 'transit';
  return 'pending';
}

// ═══════════════════════════════════════════════════════════════════
//  AI (Anthropic)
// ═══════════════════════════════════════════════════════════════════

app.post('/api/ai', requireAuth, async (req, res) => {
  if (!canUsePro(req.user.email)) return res.status(403).json({ error: 'IA requiere plan Pro', code: 'UPGRADE_REQUIRED' });
  if (!CFG.anthropicKey) return res.status(500).json({ error: 'IA no configurada' });

  if (rateLimit('ai:'+req.user.email, 20, 60000)) return res.status(429).json({ error: 'Límite de IA alcanzado. Espera 1 minuto.' });

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      req.body.model || 'claude-sonnet-4-6',
      max_tokens: 1000,
      system:     req.body.system,
      messages:   req.body.messages,
    }, {
      headers: { 'x-api-key': CFG.anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    res.json(r.data);
  } catch(e) {
    res.status(500).json({ error: { message: e.response?.data?.error?.message || e.message } });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  STATIC + HEALTH
// ═══════════════════════════════════════════════════════════════════


// ── Setup endpoint (crear usuario rápido, solo si NO existe) ─────────
app.post('/api/setup/user', async (req, res) => {
  const { name, email, password, secret } = req.body;
  // Clave secreta para evitar que cualquiera cree usuarios vía este endpoint
  if (secret !== 'dropflow-setup-2024') return res.status(403).json({ error: 'Forbidden' });
  if (DB.users[email]) return res.status(400).json({ error: 'Usuario ya existe. Usa /api/auth/login' });
  const hash = await bcrypt.hash(password, 12);
  DB.users[email] = { id: crypto.randomUUID(), name: name || 'Usuario', email, role: 'viewer', password: hash, createdAt: Date.now() };
  DB.subs[email]  = { plan: 'free', active: true, expiresAt: null };
  markDirty(); saveDB();
  res.json({ ok: true, message: 'Usuario creado. Ya puedes iniciar sesión.' });
});

app.get('/health', (req, res) => res.json({
  ok: true, version: '3.0',
  mp: !!CFG.mpToken, stripe: !!CFG.stripeSecret, ai: !!CFG.anthropicKey,
  users: Object.keys(DB.users).length,
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dropflow.html')));
app.use(express.static(__dirname));

// ── Init admin ───────────────────────────────────────────────────────
async function init() {
  loadDB();
  // Siempre actualiza la clave del admin al arrancar (por si cambió)
  const adminHash = await bcrypt.hash(CFG.adminPass, 12);
  if (!DB.users[CFG.adminEmail]) {
    DB.users[CFG.adminEmail] = { id: crypto.randomUUID(), name: 'Admin', email: CFG.adminEmail, role: 'admin', password: adminHash, createdAt: Date.now() };
    console.log(`✓ Admin creado: ${CFG.adminEmail}`);
  } else {
    DB.users[CFG.adminEmail].password = adminHash;
    console.log(`✓ Admin actualizado: ${CFG.adminEmail}`);
  }
  DB.subs[CFG.adminEmail] = { plan: 'admin', active: true, expiresAt: null };
  markDirty(); saveDB();

  app.listen(CFG.port, () => {
    console.log(`\n🚀 Dropflow v3.0 — puerto ${CFG.port}`);
    console.log(`   MP:     ${CFG.mpToken    ? '✓' : '✗ falta MP_ACCESS_TOKEN'}`);
    console.log(`   Stripe: ${CFG.stripeSecret ? '✓' : '✗ falta STRIPE_SECRET (opcional)'}`);
    console.log(`   AI:     ${CFG.anthropicKey ? '✓' : '✗ falta ANTHROPIC_API_KEY'}`);
  });
}

init().catch(console.error);
