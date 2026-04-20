const express  = require('express');
const path     = require('path');
const https    = require('https');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dropflow_secret_2026';

// ── BASE DE DATOS ────────────────────────────────────────────────────────────
const db = new Database('dropflow.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'viewer',
    creado_en TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS datos_usuario (
    usuario_id INTEGER PRIMARY KEY,
    pedidos TEXT DEFAULT '[]',
    meta TEXT DEFAULT 'null',
    config TEXT DEFAULT '{}',
    actualizado_en TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
  CREATE TABLE IF NOT EXISTS meta_tokens (
    usuario_id INTEGER PRIMARY KEY,
    token TEXT,
    ad_account_id TEXT,
    actualizado_en TEXT DEFAULT (datetime('now'))
  );
`);

// Crear usuario admin por defecto si no existe
const adminExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get('admin@dropflow.cl');
if (!adminExiste) {
  const hash = bcrypt.hashSync('dropflow2026', 10);
  const r = db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)').run('Admin', 'admin@dropflow.cl', hash, 'admin');
  db.prepare('INSERT INTO datos_usuario (usuario_id) VALUES (?)').run(r.lastInsertRowid);
  console.log('Usuario admin creado: admin@dropflow.cl / dropflow2026');
}

// ── MIDDLEWARES ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// Middleware auth
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

// ── RUTAS AUTH ────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  const token = jwt.sign({ id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
});

app.post('/api/registro', auth, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo el admin puede crear usuarios' });
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
    db.prepare('UPDATE datos_usuario SET pedidos=?, meta=?, config=?, actualizado_en=datetime("now") WHERE usuario_id=?')
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
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
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
  apiReq.write(body);
  apiReq.end();
});

// ── STATIC ────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dropflow.html'));
});

app.listen(PORT, () => {
  console.log('Dropflow v0.3 corriendo en puerto ' + PORT);
});

// ── META ADS EN VIVO ──────────────────────────────────────────────────────────

// Guardar token Meta del usuario
app.post('/api/meta/token', auth, (req, res) => {
  const { token, adAccountId } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  
  // Guardar token en DB del usuario
  db.exec(`CREATE TABLE IF NOT EXISTS meta_tokens (
    usuario_id INTEGER PRIMARY KEY,
    token TEXT,
    ad_account_id TEXT,
    actualizado_en TEXT DEFAULT (datetime('now'))
  )`);
  
  const existe = db.prepare('SELECT usuario_id FROM meta_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (existe) {
    db.prepare('UPDATE meta_tokens SET token=?, ad_account_id=?, actualizado_en=datetime("now") WHERE usuario_id=?')
      .run(token, adAccountId || '', req.usuario.id);
  } else {
    db.prepare('INSERT INTO meta_tokens (usuario_id, token, ad_account_id) VALUES (?,?,?)')
      .run(req.usuario.id, token, adAccountId || '');
  }
  res.json({ ok: true });
});

// Obtener ad accounts del usuario
app.get('/api/meta/accounts', auth, async (req, res) => {
  const row = db.prepare('SELECT token FROM meta_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row?.token) return res.status(400).json({ error: 'No hay token de Meta configurado' });
  
  try {
    const url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=name,account_id,currency,account_status&access_token=${row.token}`;
    const data = await fetchMeta(url);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener datos en vivo de Meta Ads
app.get('/api/meta/live', auth, async (req, res) => {
  const row = db.prepare('SELECT token, ad_account_id FROM meta_tokens WHERE usuario_id=?').get(req.usuario.id);
  if (!row?.token) return res.status(400).json({ error: 'No hay token de Meta configurado' });
  
  const token = row.token;
  const actId = row.ad_account_id;
  if (!actId) return res.status(400).json({ error: 'No hay Ad Account ID configurado' });

  try {
    const hoy = new Date().toISOString().split('T')[0];
    const hace30 = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

    // Insights por anuncio
    const insightsUrl = `https://graph.facebook.com/v19.0/${actId}/ads?fields=name,status,effective_status,insights{spend,impressions,clicks,ctr,cpc,cpm,actions,action_values,roas}&time_range={"since":"${hace30}","until":"${hoy}"}&limit=50&access_token=${token}`;
    const insights = await fetchMeta(insightsUrl);

    // Resumen de la cuenta
    const summaryUrl = `https://graph.facebook.com/v19.0/${actId}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,actions,action_values&time_range={"since":"${hace30}","until":"${hoy}"}&access_token=${token}`;
    const summary = await fetchMeta(summaryUrl);

    res.json({ ads: insights.data || [], summary: summary.data?.[0] || {}, fecha: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper para llamadas a Meta Graph API
function fetchMeta(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
    };
    const req = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json);
        } catch (e) {
          reject(new Error('Error parseando respuesta Meta'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
