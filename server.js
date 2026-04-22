const express  = require('express');
const path     = require('path');
const https    = require('https');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dropflow_secret_2026';

// ── BASE DE DATOS ─────────────────────────────────────────────────────────────
const db = new Database('dropflow.db');
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

// ── WILDCARD ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dropflow.html'));
});

app.listen(PORT, () => {
  console.log('Dropflow v0.3 corriendo en puerto ' + PORT);
});
