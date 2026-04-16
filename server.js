require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');

const app  = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT     = process.env.PORT || 3000;
const USER_ID  = '313971';
const EMAIL    = process.env.DROPI_EMAIL    || '1.felipe.h@gmail.com';
const PASSWORD = process.env.DROPI_PASSWORD || 'Hola1202..!!';
let   TOKEN    = process.env.DROPI_SESSION_TOKEN || process.env.DROPI_API_KEY || '';
let   TOKEN_EXPIRES = 0; // timestamp ms

function toDateISO(daysAgo) {
  const d = new Date(); d.setDate(d.getDate()-daysAgo);
  return d.toISOString().substring(0,10);
}

function getHeaders(token) {
  return {
    'x-authorization': `Bearer ${token}`,
    'x-captcha-token': '',
    'x-host':          'cl',
    'accept':          'application/json, text/plain, */*',
    'accept-language': 'es-419,es;q=0.9',
    'origin':          'https://app.dropi.cl',
    'referer':         'https://app.dropi.cl/',
    'sec-fetch-dest':  'empty',
    'sec-fetch-mode':  'cors',
    'sec-fetch-site':  'same-site',
    'user-agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  };
}

// ---- AUTO-LOGIN ----
async function refreshToken() {
  console.log('[auth] Intentando login automático...');
  const loginUrls = [
    'https://app.dropi.cl/api/auth/login',
    'https://app.dropi.cl/api/users/login',
  ];
  for (const url of loginUrls) {
    try {
      const r = await axios.post(url, 
        { email: EMAIL, password: PASSWORD },
        { headers: { 
          'Content-Type': 'application/json',
          'x-host': 'cl',
          'origin': 'https://app.dropi.cl',
          'referer': 'https://app.dropi.cl/',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }, timeout: 10000 }
      );
      const data = r.data;
      // Buscar token en la respuesta
      const newToken = data.token || data.access_token || data.data?.token || 
                       data.data?.access_token || data.authorisation?.token;
      if (newToken) {
        TOKEN = newToken;
        TOKEN_EXPIRES = Date.now() + 3.5 * 60 * 60 * 1000; // 3.5 horas
        console.log('[auth] Token renovado OK, expira en 3.5h');
        return true;
      }
      console.log('[auth] Login OK pero sin token en respuesta:', JSON.stringify(data).substring(0,200));
    } catch(e) {
      console.log('[auth] Login falló:', url, '-', e.response?.status, e.message.substring(0,80));
    }
  }
  return false;
}

async function getValidToken() {
  // Si el token expira en menos de 10 minutos, renovar
  if (!TOKEN || Date.now() > TOKEN_EXPIRES - 10*60*1000) {
    console.log('[auth] Token expirado o próximo a expirar, renovando...');
    const ok = await refreshToken();
    if (!ok) console.log('[auth] No se pudo renovar, usando token actual');
  }
  return TOKEN;
}

// Renovar token cada 3 horas automáticamente
setInterval(async () => {
  console.log('[cron] Renovando token preventivamente...');
  await refreshToken();
}, 3 * 60 * 60 * 1000);

function mapStatus(s) {
  const str = String(s||'').trim().toUpperCase();
  if (['DELIVERED','ENTREGADO'].includes(str)) return 'entregado';
  if (['EN CAMINO','IN_TRANSIT','EN TRANSITO','GUIA GENERADA','PREPARADO','EN PROCESO'].includes(str)) return 'transito';
  if (['RETURNED','DEVUELTO'].includes(str)) return 'devuelto';
  if (['CANCELLED','CANCELADO'].includes(str)) return 'cancelado';
  return 'pendiente';
}

function mapOrder(o) {
  const detail    = o.orderdetails && o.orderdetails[0];
  const producto  = (detail && detail.product && detail.product.name) || o.product_name || 'Producto';
  const venta     = parseFloat(o.total_order || o.sale_price || 0);
  const proveedor = parseFloat((detail && detail.product && detail.product.sale_price) || o.supplier_price || 0);
  const envio     = parseFloat(o.freight_cost || o.shipping_cost || o.freight || 0) || 8500;
  return {
    id:        String(o.id || ''),
    producto,
    estado:    mapStatus(o.status),
    venta,
    proveedor,
    envio,
    ads:       0,
    ciudad:    o.city || '',
    fecha:     (o.created_at || '').substring(0,10),
    cliente:   (o.name||'') + ' ' + (o.surname||''),
    tracking:  o.shipping_guide || '',
    courier:   (o.distribution_company && o.distribution_company.name) || o.shipping_company || '',
  };
}

// Recibir token desde el frontend (cuando el usuario lo pega manualmente)
app.post('/api/set-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false });
  TOKEN = token;
  TOKEN_EXPIRES = Date.now() + 3.5 * 60 * 60 * 1000;
  console.log('[api] Token actualizado manualmente, válido por 3.5h');
  res.json({ ok: true });
});

app.get('/api/orders', async (req, res) => {
  const period = req.query.period || 'hoy';
  const token  = req.query.token || await getValidToken();
  const until  = req.query.until  || toDateISO(0);
  const from   = req.query.from    || (period==='semana' ? toDateISO(7) : period==='mes' ? toDateISO(30) : toDateISO(1));

  if (!token) return res.json({ ok: true, data: [], count: 0 });

  const url = `https://api.dropi.cl/api/orders/myorders/v2?exportAs=orderByRow&orderBy=id&orderDirection=desc&result_number=500&start=0&textToSearch=&status=null&supplier_id=false&user_id=${USER_ID}&from=${from}&until=${until}&filter_product=undefined&haveIncidenceProcesamiento=false&tag_id=&warranty=false&seller=null&filter_date_by=FECHA%20DE%20CREADO&invoiced=null`;

  try {
    const r = await axios.get(url, {
      headers: getHeaders(token),
      responseType: 'text',
      timeout: 15000
    });

    let data = r.data;
    if (typeof data === 'string') data = JSON.parse(data);

    let orders = Array.isArray(data) ? data :
      (data.data || data.orders || data.results || data.items || data.list || []);
    if (!Array.isArray(orders) || orders.length === 0) {
      const vals = Object.values(data).filter(v => Array.isArray(v) && v.length > 0);
      if (vals.length > 0) orders = vals[0];
    }
    orders = (orders || []).filter(o => o && typeof o === 'object');
    console.log('[api] Pedidos:', orders.length, '| Período:', period);

    const mapped = orders.map(mapOrder);
    res.json({ ok: true, data: mapped, count: mapped.length });

  } catch(e) {
    const status = e.response?.status;
    console.error('[api] Error:', status, e.message);
    
    // Si es 401/403, intentar renovar token y reintentar una vez
    if (status === 401 || status === 403) {
      console.log('[api] Token rechazado, intentando renovar...');
      const renewed = await refreshToken();
      if (renewed) {
        try {
          const r2 = await axios.get(url, { headers: getHeaders(TOKEN), responseType: 'text', timeout: 15000 });
          let data2 = r2.data;
          if (typeof data2 === 'string') data2 = JSON.parse(data2);
          let orders2 = Array.isArray(data2) ? data2 : (data2.data || data2.orders || []);
          orders2 = (orders2 || []).filter(o => o && typeof o === 'object');
          console.log('[api] Reintento exitoso:', orders2.length, 'pedidos');
          return res.json({ ok: true, data: orders2.map(mapOrder), count: orders2.length });
        } catch(e2) {
          console.error('[api] Reintento también falló:', e2.message);
        }
      }
    }
    res.status(502).json({ ok: false, error: status + ' ' + e.message });
  }
});

app.get('/api/meta', async (req, res) => {
  const { token, account, period } = req.query;
  if (!token || !account) return res.json({ ok: false });
  const presetMap = { hoy:'today', semana:'this_week_sun_today', mes:'this_month' };
  const preset = presetMap[period] || 'this_month';
  console.log('[meta] period:', period, '-> preset:', preset);
  try {
    const fields = 'campaign_name,spend,impressions,clicks,ctr,actions,action_values';
    const r = await axios.get(`https://graph.facebook.com/v18.0/${account}/insights?fields=${fields}&date_preset=${preset}&level=campaign&access_token=${token}`, { timeout: 8000 });
    res.json({ ok: true, data: r.data.data || [] });
  } catch(e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/token-status', (req, res) => {
  const mins = Math.round((TOKEN_EXPIRES - Date.now()) / 60000);
  res.json({ 
    hasToken: !!TOKEN, 
    expiresInMinutes: mins > 0 ? mins : 0,
    tokenPreview: TOKEN ? TOKEN.substring(0,30) + '...' : 'ninguno'
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dropflow.html')));

app.listen(PORT, async () => {
  console.log(`\nDropi Dashboard en http://localhost:${PORT}`);
  console.log('Email:', EMAIL);
  console.log('Token inicial:', TOKEN ? TOKEN.substring(0,30)+'...' : 'ninguno');
  
  // Intentar login automático al arrancar si no hay token o está por expirar
  if (!TOKEN || TOKEN_EXPIRES < Date.now()) {
    console.log('Intentando login automático al arrancar...');
    await refreshToken();
  } else {
    const mins = Math.round((TOKEN_EXPIRES - Date.now()) / 60000);
    console.log(`Token válido por ${mins} minutos más`);
  }
});
