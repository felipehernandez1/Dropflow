const express  = require('express');
const path     = require('path');
const https    = require('https');
const { URLSearchParams } = require('url');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dropflow_secret_2026';

// ── BASE DE DATOS ─────────────────────────────────────────────────────────────
// Usar directorio persistente si existe (Render Disk), sino local
const DB_PATH = process.env.DB_PATH || (require('fs').existsSync('/data') ? '/data/dropflow.db' : './dropflow.db');
console.log('Base de datos en:', DB_PATH);
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'viewer',
    creado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS datos_usuario (
    usuario_id INTEGER PRIMARY KEY,
    pedidos TEXT DEFAULT '[]',
    meta TEXT DEFAULT 'null',
    config TEXT DEFAULT '{}',
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
  CREATE TABLE IF NOT EXISTS meta_tokens (
    usuario_id INTEGER PRIMARY KEY,
    token TEXT,
    ad_account_id TEXT,
    actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const adminExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get('admin@dropflow.cl');
if (!adminExiste) {
  const hash = bcrypt.hashSync('dropflow2026', 10);
  const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('Admin', 'admin@dropflow.cl', hash, 'admin');
  db.prepare('INSERT INTO datos_usuario (usuario_id) VALUES (?)').run(r.lastInsertRowid);
  console.log('Usuario admin creado: admin@dropflow.cl / dropflow2026');
}

// ── MIDDLEWARES ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// Servir archivos estáticos solo para rutas no-API
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  express.static(path.join(__dirname))(req, res, next);
});

function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  const token = jwt.sign({ id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
});

app.post('/api/registro', auth, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run(nombre, email, hash, rol || 'viewer');
    db.prepare('INSERT INTO datos_usuario (usuario_id) VALUES (?)').run(r.lastInsertRowid);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'El email ya existe' });
  }
});

app.get('/api/usuarios', auth, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const users = db.prepare('SELECT id, nombre, email, rol, creado_en FROM usuarios').all();
  res.json(users);
});

app.delete('/api/usuarios/:id', auth, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  db.prepare('DELETE FROM datos_usuario WHERE usuario_id = ?').run(req.params.id);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── DATOS USUARIO ─────────────────────────────────────────────────────────────
app.get('/api/datos', auth, (req, res) => {
  const datos = db.prepare('SELECT * FROM datos_usuario WHERE usuario_id = ?').get(req.usuario.id);
  if (!datos) return res.json({ pedidos: [], meta: null, config: {} });
  res.json({
    pedidos: JSON.parse(datos.pedidos || '[]'),
    meta:    JSON.parse(datos.meta || 'null'),
    config:  JSON.parse(datos.config || '{}'),
  });
});

app.post('/api/datos', auth, (req, res) => {
  const { pedidos, meta, config } = req.body;
  const datos = db.prepare('SELECT usuario_id FROM datos_usuario WHERE usuario_id = ?').get(req.usuario.id);
  if (datos) {
    db.prepare('UPDATE datos_usuario SET pedidos=?, meta=?, config=?, actualizado_en=CURRENT_TIMESTAMP WHERE usuario_id=?')
      .run(JSON.stringify(pedidos ?? []), JSON.stringify(meta ?? null), JSON.stringify(config ?? {}), req.usuario.id);
  } else {
    db.prepare('INSERT INTO datos_usuario (usuario_id, pedidos, meta, config) VALUES (?, ?, ?, ?)')
      .run(req.usuario.id, JSON.stringify(pedidos ?? []), JSON.stringify(meta ?? null), JSON.stringify(config ?? {}));
  }
  res.json({ ok: true });
});

// ── PROXY IA ──────────────────────────────────────────────────────────────────
app.post('/api/ia', auth, (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'API key no configurada' } });
  const body = JSON.stringify(req.body);
  const options = {
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  };
  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try { res.status(apiRes.statusCode).json(JSON.parse(data)); }
      catch (e) { res.status(500).json({ error: { message: 'Error parseando respuesta IA' } }); }
    });
  });
  apiReq.on('error', err => res.status(500).json({ error: { message: err.message } }));
  apiReq.write(body); apiReq.end();
});

// ── META ADS EN VIVO ──────────────────────────────────────────────────────────
app.post('/api/meta/token', auth, (req, res) => {
  const { token, adAccountId } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  const existe = db.prepare('SELECT usuario_id FROM meta_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (existe) {
    db.prepare('UPDATE meta_tokens SET token=?, ad_account_id=?, actualizado_en=CURRENT_TIMESTAMP WHERE usuario_id=?')
      .run(token, adAccountId || '', req.usuario.id);
  } else {
    db.prepare('INSERT INTO meta_tokens (usuario_id, token, ad_account_id) VALUES (?,?,?)')
      .run(req.usuario.id, token, adAccountId || '');
  }
  res.json({ ok: true });
});

app.get('/api/meta/live', auth, async (req, res) => {
  const row = db.prepare('SELECT token, ad_account_id FROM meta_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row?.token) return res.status(400).json({ error: 'No hay token de Meta configurado' });

  const token = row.token;
  const actId = row.ad_account_id;
  if (!actId) return res.status(400).json({ error: 'No hay Ad Account ID configurado' });

  const hasta = req.query.hasta || new Date().toISOString().split('T')[0];
  const desde = req.query.desde || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

  console.log(`Meta API: ${desde} → ${hasta} | account: ${actId}`);

  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }));

    // Paso 1: obtener lista de anuncios con estado
    const adsListUrl = `https://graph.facebook.com/v19.0/${actId}/ads?fields=id,name,status,effective_status,created_time,adset{daily_budget,lifetime_budget}&limit=100&access_token=${token}`;
    const adsList = await fetchMeta(adsListUrl);
    const ads = adsList.data || [];

    if (!ads.length) {
      return res.json({ ads: [], summary: {}, fecha: new Date().toISOString(), desde, hasta });
    }

    // Paso 2: obtener insights por período para cada anuncio
    // Usar endpoint de insights a nivel de cuenta con desglose por anuncio
    const insightsUrl = `https://graph.facebook.com/v19.0/${actId}/insights?level=ad&fields=ad_id,ad_name,spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,website_purchase_roas,frequency&time_range=${timeRange}&limit=100&access_token=${token}`;
    const insightsData = await fetchMeta(insightsUrl);
    const insights = insightsData.data || [];

    console.log(`Ads: ${ads.length} | Insights en período: ${insights.length} | spend total: ${insights.reduce((s,i)=>s+parseFloat(i.spend||0),0).toFixed(0)}`);

    // Combinar anuncios con sus insights del período
    const insightMap = {};
    insights.forEach(ins => { insightMap[ins.ad_id] = ins; });

    const combined = ads.map(ad => {
      const ins = insightMap[ad.id] || {};
      const compras = ins.actions?.find(a => a.action_type === 'purchase')?.value || 0;
      const roasArr = ins.website_purchase_roas;
      const roas = Array.isArray(roasArr) ? parseFloat(roasArr[0]?.value || 0) : parseFloat(roasArr || 0);
      const presupDiario = parseInt(ad.adset?.daily_budget || 0);
      const presupTotal  = parseInt(ad.adset?.lifetime_budget || 0);
      const presupuesto  = presupDiario > 0 ? presupDiario : presupTotal;

      return {
        id:          ad.id,
        nombre:      ad.name || 'Sin nombre',
        estado:      ad.effective_status?.toLowerCase() || 'unknown',
        fecha:       ad.created_time ? ad.created_time.split('T')[0] : '',
        presupuesto: presupuesto, // CLP ya en unidad base
        gasto:       parseFloat(ins.spend || 0),
        impresiones: parseInt(ins.impressions || 0),
        clics:       parseInt(ins.clicks || 0),
        compras:     parseFloat(compras),
        roas:        roas,
        ctr:         parseFloat(ins.ctr || 0),
        cpc:         parseFloat(ins.cpc || 0),
        cpm:         parseFloat(ins.cpm || 0),
        frecuencia:  parseFloat(ins.frequency || 0),
      };
    });

    // Resumen del período
    const summaryUrl = `https://graph.facebook.com/v19.0/${actId}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,actions,action_values&time_range=${timeRange}&access_token=${token}`;
    const summaryData = await fetchMeta(summaryUrl);
    const summary = summaryData.data?.[0] || {};

    res.json({ ads: combined, summary, fecha: new Date().toISOString(), desde, hasta });

  } catch (e) {
    console.error('Error Meta API:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Helper fetch Meta
function fetchMeta(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET' };
    const req = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json);
        } catch (e) { reject(new Error('Error parseando respuesta Meta')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── DROPI EN VIVO ─────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS dropi_tokens (
  usuario_id INTEGER PRIMARY KEY,
  token TEXT,
  email TEXT,
  actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
)`);

app.post('/api/dropi/token', auth, (req, res) => {
  const { token, email } = req.body;
  if (!token || !email) return res.status(400).json({ error: 'Token y email requeridos' });
  const existe = db.prepare('SELECT usuario_id FROM dropi_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (existe) {
    db.prepare('UPDATE dropi_tokens SET token=?, email=?, actualizado_en=CURRENT_TIMESTAMP WHERE usuario_id=?')
      .run(token, email, req.usuario.id);
  } else {
    db.prepare('INSERT INTO dropi_tokens (usuario_id, token, email) VALUES (?,?,?)')
      .run(req.usuario.id, token, email);
  }
  res.json({ ok: true });
});

app.get('/api/dropi/pedidos', auth, async (req, res) => {
  const row = db.prepare('SELECT token, email FROM dropi_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row?.token) return res.status(400).json({ error: 'No hay token de Dropi configurado' });

  const hasta = req.query.hasta || new Date().toISOString().split('T')[0];
  const desde = req.query.desde || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

  try {
    // Llamar a la API de Dropi para obtener órdenes
    // Probar múltiples endpoints posibles de Dropi
    let dropiData = null;
    // Token decodificado: iss=app.dropi.cl, sub=313971 (user_id), aud=SHOPIFY
    const userId = 313971; // from JWT sub
    const endpoints = [
      { path: '/api/v2/orders?page=1&perpage=500&dateFrom='+desde+'&dateTo='+hasta },
      { path: '/api/orders?page=1&limit=500&from='+desde+'&to='+hasta },
      { path: '/api/v1/orders?page=1&limit=500' },
      { path: '/api/dropshipper/orders?page=1&limit=500' },
      { path: '/orders?page=1&limit=500&from='+desde+'&to='+hasta },
    ].map(e => ({ path: e.path, params: {} }));
    
    for (const ep of endpoints) {
      try {
        console.log('Intentando endpoint:', ep.path);
        const result = await fetchDropi(ep.path, row.token, {});
        if (result && result.isSuccess !== false && !result.error) {
          dropiData = result;
          console.log('Endpoint exitoso:', ep.path);
          break;
        } else {
          console.log('Endpoint fallido:', ep.path, JSON.stringify(result).substring(0, 100));
        }
      } catch(e) {
        console.log('Endpoint error:', ep.path, e.message.substring(0, 100));
      }
    }

    if (!dropiData || dropiData.isSuccess === false) {
      throw new Error(dropiData?.message || 'Error al consultar Dropi');
    }

    // Transformar datos de Dropi al formato interno de Dropflow
    const orders = dropiData.data || dropiData.orders || dropiData.result || [];
    const pedidos = orders.map(o => ({
      id:         String(o.id || o.order_id || ''),
      fecha:      (o.created_at || o.fecha || '').split('T')[0] || '',
      cliente:    o.customer_name || o.cliente || '',
      ciudad:     o.city || o.ciudad_destino?.nombre || '',
      producto:   o.product_name || o.producto || o.items?.[0]?.name || 'Sin nombre',
      estadoRaw:  o.status || o.estado || '',
      estado:     mapEstadoDropi(o.status || o.estado || ''),
      venta:      parseFloat(o.sale_price || o.valor_venta || o.amount || 0),
      proveedor:  parseFloat(o.provider_price || o.valor_proveedor || o.product_cost || 0),
      flete:      parseFloat(o.shipping_cost || o.precio_flete || o.freight || 0),
      comision:   parseFloat(o.commission || o.comision || 0),
      devFlete:   parseFloat(o.return_cost || 0),
      utilidad:   parseFloat(o.utility || o.ganancia || 0),
      margen:     0,
    }));

    // Calcular margen
    pedidos.forEach(p => {
      if (p.venta > 0) {
        const u = p.utilidad || (p.venta - p.proveedor - p.flete - p.comision);
        p.utilidad = u;
        p.margen = (u / p.venta) * 100;
      }
    });

    console.log(`Dropi: ${pedidos.length} pedidos ${desde} → ${hasta}`);
    res.json({ pedidos, total: pedidos.length, desde, hasta });

  } catch (e) {
    console.error('Error Dropi API:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function mapEstadoDropi(estado) {
  const s = (estado || '').toUpperCase().trim();
  if (['ENTREGADO', 'DELIVERED', 'COMPLETED'].includes(s)) return 'entregado';
  if (['EN REPARTO', 'EN_REPARTO', 'EN TRANSITO', 'EN TRÁNSITO', 'TRANSIT', 'SHIPPED', 'GUIA_GENERADA', 'EN DESTINO'].includes(s)) return 'transito';
  if (['PENDIENTE', 'PENDIENTE CONFIRMACION', 'PENDING'].includes(s)) return 'pendiente';
  if (['DEVOLUCION', 'EN DEVOLUCIÓN', 'RETURNED', 'RETURN'].includes(s)) return 'devuelto';
  if (['CANCELADO', 'CANCELLED', 'CANCELED'].includes(s)) return 'cancelado';
  return 'otro';
}

function fetchDropi(endpoint, token, params = {}, hostname = 'app.dropi.cl') {
  return new Promise((resolve, reject) => {
    const qs = Object.entries(params).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&');
    const path = endpoint + (qs ? '?' + qs : '');
    const options = {
      hostname,
      path,
      method: 'GET',
      headers: {
        'dropi-integracion-key': token,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    };
    console.log('Dropi request:', options.hostname + options.path);
    const req = https.request(options, (apiRes) => {
      let data = '';
      console.log('Dropi status:', apiRes.statusCode, apiRes.statusMessage);
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        console.log('Dropi response completo:', data.substring(0, 500));
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch(e) {
          reject(new Error('Dropi respondió: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Registro público (sin auth)
app.post('/api/registro-publico', (req, res) => {
  const { nombre, email, password, plan } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run(nombre, email, hash, 'viewer');
    db.prepare('INSERT INTO datos_usuario (usuario_id) VALUES (?)').run(r.lastInsertRowid);
    // Guardar plan seleccionado en config
    db.prepare('UPDATE datos_usuario SET config=? WHERE usuario_id=?').run(JSON.stringify({plan: plan||'free'}), r.lastInsertRowid);
    console.log('Nuevo usuario registrado:', email, '| Plan:', plan);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'El email ya está registrado' });
  }
});

// ── SHOPIFY EN VIVO ──────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS shopify_tokens (
  usuario_id INTEGER PRIMARY KEY,
  shop_url TEXT,
  access_token TEXT,
  actualizado_en TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// Cache de tokens Shopify (client credentials flow)
const shopifyTokenCache = {};

async function getShopifyToken(shop, clientId, clientSecret) {
  const cached = shopifyTokenCache[shop];
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;

  console.log('Shopify token request a:', `https://${shop}/admin/oauth/access_token`);
  console.log('Client ID:', clientId?.substring(0,8)+'...');
  
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })
  });

  console.log('Shopify token response status:', response.status);
  
  if (!response.ok) {
    const err = await response.text();
    console.log('Shopify token error body:', err.substring(0,200));
    // Si devuelve HTML, la app no está instalada en la tienda
    if(err.includes('<!DOCTYPE')) {
      throw new Error('La app no está instalada en tu tienda. Ve al Dev Dashboard e instálala primero.');
    }
    throw new Error('Error token Shopify ('+response.status+'): ' + err.substring(0,100));
  }

  const { access_token, expires_in } = await response.json();
  shopifyTokenCache[shop] = { token: access_token, expiresAt: Date.now() + (expires_in||82800)*1000 };
  console.log('Shopify token obtenido para:', shop, '| expira en:', expires_in, 's');
  return access_token;
}

app.post('/api/shopify/token', auth, (req, res) => {
  const { shopUrl, clientId, clientSecret } = req.body;
  if (!shopUrl || !clientId || !clientSecret) return res.status(400).json({ error: 'URL, Client ID y Client Secret requeridos' });
  const shop = shopUrl.replace('https://','').replace('http://','').replace(/\/$/,'').trim();
  const existe = db.prepare('SELECT usuario_id FROM shopify_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (existe) {
    db.prepare('UPDATE shopify_tokens SET shop_url=?, access_token=?, actualizado_en=CURRENT_TIMESTAMP WHERE usuario_id=?')
      .run(shop, clientId+'::'+clientSecret, req.usuario.id);
  } else {
    db.prepare('INSERT INTO shopify_tokens (usuario_id, shop_url, access_token) VALUES (?,?,?)')
      .run(req.usuario.id, shop, clientId+'::'+clientSecret);
  }
  res.json({ ok: true });
});

app.get('/api/shopify/test', auth, async (req, res) => {
  const row = db.prepare('SELECT shop_url, access_token FROM shopify_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row) return res.status(400).json({ error: 'No hay credenciales de Shopify' });
  try {
    const [clientId, clientSecret] = row.access_token.split('::');
    const token = await getShopifyToken(row.shop_url, clientId, clientSecret);
    const data = await fetchShopify(row.shop_url, token, '/admin/api/2024-01/shop.json');
    res.json({ ok: true, shop: data.shop?.name, domain: data.shop?.domain, plan: data.shop?.plan_name });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/shopify/orders', auth, async (req, res) => {
  const row = db.prepare('SELECT shop_url, access_token FROM shopify_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row) return res.status(400).json({ error: 'No hay credenciales de Shopify' });

  const desde = req.query.desde || new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const hasta = req.query.hasta ? new Date(req.query.hasta+'T23:59:59').toISOString() : new Date().toISOString();

  try {
    // Traer órdenes paginadas
    const [clientId, clientSecret] = row.access_token.split('::');
    const token = await getShopifyToken(row.shop_url, clientId, clientSecret);
    const fleteProm = parseFloat(req.query.flete_promedio || 0);
    
    let orders = [], pageUrl = `/admin/api/2024-01/orders.json?status=any&created_at_min=${desde}&created_at_max=${hasta}&limit=250&fields=id,name,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,shipping_address,line_items,shipping_lines,refunds,cancel_reason,cancelled_at`;
    
    while(pageUrl) {
      const data = await fetchShopify(row.shop_url, token, pageUrl);
      orders = orders.concat(data.orders || []);
      pageUrl = null; // Shopify pagina con cursor — por ahora 250 max
    }

    console.log(`Shopify: ${orders.length} órdenes ${desde.split('T')[0]} → ${hasta.split('T')[0]} | flete promedio: $${fleteProm}`);

    // Obtener costos de proveedor por variant_id en lote
    const variantIds = [...new Set(orders.flatMap(o=>(o.line_items||[]).map(l=>l.variant_id).filter(Boolean)))];
    const costosProveedor = {};
    
    if(variantIds.length > 0) {
      try {
        // Shopify permite hasta 100 variants por llamada
        for(let i=0; i<variantIds.length; i+=50) {
          const batch = variantIds.slice(i,i+50);
          const varData = await fetchShopify(row.shop_url, token, 
            `/admin/api/2024-01/variants.json?ids=${batch.join(',')}&fields=id,inventory_item_id`);
          const inventoryIds = (varData.variants||[]).map(v=>v.inventory_item_id).filter(Boolean);
          if(inventoryIds.length) {
            const costData = await fetchShopify(row.shop_url, token,
              `/admin/api/2024-01/inventory_items.json?ids=${inventoryIds.join(',')}&fields=id,cost`);
            // Map variant → cost via inventory_item
            const invMap = {};
            (costData.inventory_items||[]).forEach(inv=>{ invMap[inv.id]=parseFloat(inv.cost||0); });
            (varData.variants||[]).forEach(v=>{ costosProveedor[v.id]=invMap[v.inventory_item_id]||0; });
          }
        }
        console.log(`Shopify: costos proveedor obtenidos para ${Object.keys(costosProveedor).length} variantes`);
      } catch(e) {
        console.warn('No se pudieron obtener costos:', e.message);
      }
    }

    // Transformar al formato Dropflow
    const pedidos = orders.map(o => {
      const estado = mapEstadoShopify(o.financial_status, o.fulfillment_status, o.cancelled_at);
      const venta = parseFloat(o.total_price || 0);
      
      // Costo proveedor: suma de cost × quantity por line item
      const costoProveedor = (o.line_items||[]).reduce((s,l)=>{
        const costo = costosProveedor[l.variant_id] || 0;
        return s + (costo * (l.quantity||1));
      }, 0);
      
      // Flete: cobrado al cliente (lo que pagó por envío)
      // Si hay flete promedio configurado, usarlo como costo real
      const fleteCliente = (o.shipping_lines||[]).reduce((s,l)=>s+parseFloat(l.price||0),0);
      const fleteCosto = fleteProm > 0 ? fleteProm : fleteCliente;
      
      const tieneProveedor = costoProveedor > 0;
      const utilidad = venta - costoProveedor - fleteCosto;
      
      return {
        id:        String(o.id),
        nombre:    o.name || '',
        fecha:     (o.created_at||'').split('T')[0],
        cliente:   o.shipping_address ? (o.shipping_address.first_name+' '+o.shipping_address.last_name).trim() : '',
        ciudad:    o.shipping_address?.city || '',
        producto:  (o.line_items||[])[0]?.title || 'Sin nombre',
        estadoRaw: o.financial_status+'_'+o.fulfillment_status,
        estado,
        venta,
        proveedor: costoProveedor,
        flete:     fleteCosto,
        comision:  0,
        devFlete:  estado==='devuelto'?fleteCosto:0,
        utilidad,
        margen:    venta>0?(utilidad/venta)*100:0,
        fuente:    'shopify',
        sinCostoProveedor: !tieneProveedor,
      };
    });

    const sinCosto = pedidos.filter(p=>p.sinCostoProveedor).length;
    const avisos = [];
    if(sinCosto > 0) avisos.push(sinCosto+' pedidos sin costo de proveedor — agrégalo en Shopify: Products → Variants → Cost per item');
    if(fleteProm === 0) avisos.push('Flete promedio en $0 — configúralo en Dropflow para cálculos más exactos');

    res.json({ 
      pedidos, total: pedidos.length, 
      desde: desde.split('T')[0], hasta: hasta.split('T')[0],
      avisos,
      stats: { conCosto: pedidos.length-sinCosto, sinCosto, fleteProm }
    });

  } catch(e) {
    console.error('Error Shopify:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function mapEstadoShopify(financial, fulfillment, cancelled) {
  if (cancelled) return 'cancelado';
  if (financial === 'refunded' || fulfillment === 'restocked') return 'devuelto';
  if (fulfillment === 'fulfilled') return 'entregado';
  if (fulfillment === 'partial' || fulfillment === 'in_transit') return 'transito';
  if (financial === 'paid') return 'transito'; // pagado pero no despachado aún
  if (financial === 'pending') return 'pendiente';
  return 'pendiente';
}

function fetchShopify(shop, token, path) {
  return new Promise((resolve, reject) => {
    const fullPath = path.startsWith('http') ? new URL(path).pathname + new URL(path).search : path;
    const options = {
      hostname: shop,
      path: fullPath,
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      }
    };
    const req = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          if (apiRes.statusCode === 401) { reject(new Error('Token inválido o sin permisos')); return; }
          if (apiRes.statusCode === 404) { reject(new Error('Tienda no encontrada: '+shop)); return; }
          const json = JSON.parse(data);
          if (json.errors) reject(new Error(JSON.stringify(json.errors)));
          else resolve(json);
        } catch(e) { reject(new Error('Error parseando respuesta Shopify: '+data.substring(0,100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Beacon endpoint para guardar al cerrar página
app.post('/api/datos/beacon', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();
  try {
    const usuario = require('jsonwebtoken').verify(token, JWT_SECRET);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { pedidos, meta, config } = JSON.parse(body);
        const datos = db.prepare('SELECT usuario_id FROM datos_usuario WHERE usuario_id=?').get(usuario.id);
        if (datos) {
          db.prepare('UPDATE datos_usuario SET pedidos=?, meta=?, config=?, actualizado_en=CURRENT_TIMESTAMP WHERE usuario_id=?')
            .run(JSON.stringify(pedidos||[]), JSON.stringify(meta||null), JSON.stringify(config||{}), usuario.id);
        }
      } catch(e) { console.warn('Beacon parse error:', e.message); }
    });
  } catch(e) { console.warn('Beacon auth error:', e.message); }
  res.status(200).end();
});

// ── MERCADO PAGO ─────────────────────────────────────────────────────────────
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';

// Planes y precios
const PLANES = {
  pro:      { nombre: 'Pro',      precio: 9990,  moneda: 'CLP' },
  business: { nombre: 'Business', precio: 19990, moneda: 'CLP' },
};

// Crear preferencia de pago MP
app.post('/api/mp/crear-pago', auth, async (req, res) => {
  const { plan } = req.body;
  if (!PLANES[plan]) return res.status(400).json({ error: 'Plan inválido' });
  if (!MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Mercado Pago no configurado' });

  try {
    const planInfo = PLANES[plan];
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        items: [{
          title: 'Dropflow ' + planInfo.nombre,
          quantity: 1,
          unit_price: planInfo.precio,
          currency_id: planInfo.moneda,
        }],
        payer: { email: req.usuario.email },
        back_urls: {
          success: 'https://dropflow-uw2x.onrender.com?pago=ok&plan='+plan,
          failure: 'https://dropflow-uw2x.onrender.com?pago=error',
          pending: 'https://dropflow-uw2x.onrender.com?pago=pendiente',
        },
        auto_return: 'approved',
        external_reference: req.usuario.id + ':' + plan,
        notification_url: 'https://dropflow-uw2x.onrender.com/api/mp/webhook',
        statement_descriptor: 'DROPFLOW',
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Error MP');
    
    console.log('MP preferencia creada:', data.id, 'para usuario:', req.usuario.email, 'plan:', plan);
    res.json({ id: data.id, url: data.init_point, sandbox_url: data.sandbox_init_point });

  } catch(e) {
    console.error('Error MP:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Webhook de Mercado Pago — confirmar pagos
app.post('/api/mp/webhook', express.raw({type:'application/json'}), async (req, res) => {
  try {
    const { type, data } = JSON.parse(req.body);
    if (type !== 'payment') return res.status(200).end();

    // Obtener detalles del pago
    const r = await fetch('https://api.mercadopago.com/v1/payments/'+data.id, {
      headers: { 'Authorization': 'Bearer ' + MP_ACCESS_TOKEN }
    });
    const pago = await r.json();
    
    if (pago.status === 'approved') {
      const [usuarioId, plan] = (pago.external_reference || '').split(':');
      if (usuarioId && plan) {
        // Actualizar plan del usuario
        const configActual = db.prepare('SELECT config FROM datos_usuario WHERE usuario_id=?').get(parseInt(usuarioId));
        const config = JSON.parse(configActual?.config || '{}');
        config.plan = plan;
        config.plan_desde = new Date().toISOString();
        config.mp_pago_id = pago.id;
        db.prepare('UPDATE datos_usuario SET config=? WHERE usuario_id=?')
          .run(JSON.stringify(config), parseInt(usuarioId));
        console.log('✅ Pago aprobado — usuario:', usuarioId, 'plan:', plan, 'monto:', pago.transaction_amount);
      }
    }
    res.status(200).end();
  } catch(e) {
    console.error('Webhook MP error:', e.message);
    res.status(200).end(); // Siempre 200 para MP
  }
});

// Estado del plan del usuario
app.get('/api/mp/plan', auth, (req, res) => {
  const datos = db.prepare('SELECT config FROM datos_usuario WHERE usuario_id=?').get(req.usuario.id);
  const config = JSON.parse(datos?.config || '{}');
  res.json({ plan: config.plan || 'free', desde: config.plan_desde || null });
});

// ── WILDCARD ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dropflow.html'));
});

app.listen(PORT, () => {
  console.log('Dropflow v0.3 corriendo en puerto ' + PORT);
});
