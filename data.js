// ============================================================
// data.js — Capa de datos y conexión a APIs reales
// Reemplaza las funciones mock con tus credenciales reales
// ============================================================

// ---- CONFIGURACIÓN ----
const CONFIG = {
  dropiBaseUrl: 'https://api.dropi.co/api/v1',   // URL base API Dropi
  metaBaseUrl:  'https://graph.facebook.com/v19.0',
  deliveryRate: 0.75,   // Tasa de entrega por defecto (75%)
  currency: 'CLP',
  refreshInterval: 300, // segundos
};

// ---- CREDENCIALES (se guardan en localStorage) ----
function getCreds() {
  return {
    dropiKey:    localStorage.getItem('dropi_key') || '',
    dropiStore:  localStorage.getItem('dropi_store') || '',
    metaToken:   localStorage.getItem('meta_token') || '',
    metaAccount: localStorage.getItem('meta_account') || '',
  };
}
function saveCreds(obj) {
  Object.entries(obj).forEach(([k,v]) => localStorage.setItem(k, v));
}

// ---- DATOS DE EJEMPLO (se usan cuando no hay API configurada) ----
const SAMPLE_ORDERS = [
  {id:'DRP-2401',producto:'Crema facial 50ml',  estado:'entregado',venta:35000,proveedor:8000, envio:4500,ads:3200,ciudad:'Bogotá',    fecha:'2025-04-13'},
  {id:'DRP-2402',producto:'Faja reductora XL',  estado:'entregado',venta:42000,proveedor:12000,envio:5000,ads:3800,ciudad:'Medellín',   fecha:'2025-04-13'},
  {id:'DRP-2403',producto:'Crema facial 50ml',  estado:'transito', venta:35000,proveedor:8000, envio:4500,ads:3200,ciudad:'Cali',       fecha:'2025-04-13'},
  {id:'DRP-2404',producto:'Suero vitamina C',   estado:'pendiente',venta:28000,proveedor:7000, envio:4200,ads:2900,ciudad:'Barranquilla',fecha:'2025-04-13'},
  {id:'DRP-2405',producto:'Faja reductora M',   estado:'entregado',venta:42000,proveedor:12000,envio:5000,ads:3800,ciudad:'Cartagena',  fecha:'2025-04-13'},
  {id:'DRP-2406',producto:'Masajeador eléctrico',estado:'devuelto',venta:55000,proveedor:18000,envio:5500,ads:5000,ciudad:'Bogotá',    fecha:'2025-04-12'},
  {id:'DRP-2407',producto:'Crema facial 50ml',  estado:'pendiente',venta:35000,proveedor:8000, envio:4500,ads:3200,ciudad:'Medellín',   fecha:'2025-04-13'},
  {id:'DRP-2408',producto:'Suero vitamina C',   estado:'entregado',venta:28000,proveedor:7000, envio:4200,ads:2900,ciudad:'Bogotá',    fecha:'2025-04-13'},
  {id:'DRP-2409',producto:'Faja reductora S',   estado:'cancelado',venta:42000,proveedor:12000,envio:5000,ads:3800,ciudad:'Pereira',   fecha:'2025-04-12'},
  {id:'DRP-2410',producto:'Masajeador eléctrico',estado:'transito',venta:55000,proveedor:18000,envio:5500,ads:5000,ciudad:'Cali',      fecha:'2025-04-13'},
  {id:'DRP-2411',producto:'Crema facial 100ml', estado:'pendiente',venta:48000,proveedor:11000,envio:4800,ads:4200,ciudad:'Bogotá',    fecha:'2025-04-13'},
  {id:'DRP-2412',producto:'Suero vitamina C',   estado:'entregado',venta:28000,proveedor:7000, envio:4200,ads:2900,ciudad:'Manizales', fecha:'2025-04-13'},
  {id:'DRP-2413',producto:'Kit skincare',       estado:'entregado',venta:75000,proveedor:22000,envio:6000,ads:6500,ciudad:'Bogotá',    fecha:'2025-04-13'},
  {id:'DRP-2414',producto:'Faja reductora XL',  estado:'pendiente',venta:42000,proveedor:12000,envio:5000,ads:3800,ciudad:'Bucaramanga',fecha:'2025-04-13'},
  {id:'DRP-2415',producto:'Kit skincare',       estado:'transito', venta:75000,proveedor:22000,envio:6000,ads:6500,ciudad:'Bogotá',    fecha:'2025-04-13'},
];

const SAMPLE_META = {
  gasto: 58300,
  impresiones: 142000,
  clicks: 3840,
  campaigns: [
    {nombre:'Crema Facial — Conversiones', gasto:22000, roas:4.2, pedidos:18, ctr:3.1},
    {nombre:'Faja Reductora — Reach',      gasto:18500, roas:3.8, pedidos:14, ctr:2.7},
    {nombre:'Suero Vitamina C — Ventas',   gasto:10800, roas:3.1, pedidos: 9, ctr:2.2},
    {nombre:'Kit Skincare — Retargeting',  gasto: 7000, roas:5.6, pedidos: 6, ctr:4.1},
  ]
};

// ============================================================
// DROPI API — Conexión real Dropi Chile (app.dropi.cl)
// ============================================================
async function fetchDropiOrders(period = 'hoy') {
  const { dropiKey } = getCreds();
  if (!dropiKey) return SAMPLE_ORDERS;

  const today = new Date().toISOString().substring(0,10);
  let from;
  if (period === 'mes')    from = new Date(new Date().setDate(new Date().getDate()-30)).toISOString().substring(0,10);
  else if (period === 'semana') from = new Date(new Date().setDate(new Date().getDate()-7)).toISOString().substring(0,10);
  else from = new Date(new Date().setDate(new Date().getDate()-1)).toISOString().substring(0,10);

  const url = `https://api.dropi.cl/api/orders/myorders/v2?exportAs=orderByRow&orderBy=id&orderDirection=desc&result_number=500&start=0&textToSearch=&status=null&supplier_id=false&user_id=313971&from=${from}&until=${today}&filter_product=undefined&haveIncidenceProcesamiento=false&tag_id=&warranty=false&seller=null&filter_date_by=FECHA%20DE%20CREADO&invoiced=null`;

  try {
    console.log('[dropi] Llamando directo desde browser...');
    const res = await fetch(url, {
      headers: {
        'x-authorization': `Bearer ${dropiKey}`,
        'x-captcha-token': '',
        'x-host': 'cl',
        'accept': 'application/json, text/plain, */*',
        'origin': 'https://app.dropi.cl',
        'referer': 'https://app.dropi.cl/',
      },
      credentials: 'include',
    });

    if (!res.ok) {
      console.warn('[dropi] Error:', res.status);
      if (res.status === 401 || res.status === 403) {
        showRenewalBannerIfExists();
      }
      return SAMPLE_ORDERS;
    }

    const data = await res.json();
    let orders = Array.isArray(data) ? data : (data.data || data.orders || data.results || []);
    if (!Array.isArray(orders) || orders.length === 0) {
      const vals = Object.values(data).filter(v => Array.isArray(v) && v.length > 0);
      if (vals.length > 0) orders = vals[0];
    }
    orders = (orders || []).filter(o => o && typeof o === 'object');
    console.log('[dropi] Pedidos cargados:', orders.length);
    return orders.map(mapDropiOrderFrontend);

  } catch(e) {
    console.warn('[dropi] CORS bloqueado, usando servidor proxy...');
    return fetchViaServerProxy(period, dropiKey);
  }
}

function showRenewalBannerIfExists() {
  if (typeof showRenewalBanner === 'function') showRenewalBanner(0);
}

async function fetchViaServerProxy(period, token) {
  try {
    // Enviar token al servidor primero
    await fetch('/api/set-token', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token})
    });
    const res = await fetch('/api/orders?period=' + period + '&token=' + encodeURIComponent(token));
    if (!res.ok) return SAMPLE_ORDERS;
    const json = await res.json();
    if (!json.ok || !json.data || json.data.length === 0) return SAMPLE_ORDERS;
    console.log('[proxy] Pedidos:', json.count);
    return json.data;
  } catch(e) {
    console.error('[proxy] Error:', e.message);
    return SAMPLE_ORDERS;
  }
}


async function fetchViaServer(period) {
  try {
    const res = await fetch('/api/orders?period=' + period);
    if (!res.ok) return SAMPLE_ORDERS;
    const json = await res.json();
    if (!json.ok || !json.data || json.data.length === 0) return SAMPLE_ORDERS;
    console.log('Via servidor:', json.count, 'pedidos');
    return json.data;
  } catch(e) {
    console.error('Error servidor:', e.message);
    return SAMPLE_ORDERS;
  }
}

function mapDropiOrderFrontend(o) {
  const detail    = o.orderdetails && o.orderdetails[0];
  const producto  = (detail && detail.product && detail.product.name) || o.product_name || 'Producto';
  const venta     = parseFloat(o.total_order || o.sale_price || 0);
  const proveedor = parseFloat((detail && detail.product && detail.product.sale_price) || o.supplier_price || 0);
  const envio     = parseFloat(o.freight_cost || o.shipping_cost || o.freight || 0) || 8500;
  const status    = String(o.status||'').trim().toUpperCase();
  let estado = 'pendiente';
  if (['DELIVERED','ENTREGADO'].includes(status)) estado = 'entregado';
  else if (['EN CAMINO','IN_TRANSIT','EN TRANSITO','GUIA GENERADA','PREPARADO','EN PROCESO'].includes(status)) estado = 'transito';
  else if (['RETURNED','DEVUELTO'].includes(status)) estado = 'devuelto';
  else if (['CANCELLED','CANCELADO'].includes(status)) estado = 'cancelado';
  return {
    id:        String(o.id || ''),
    producto,
    estado,
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

function daysAgoISO(d) {
  const dt = new Date(); dt.setDate(dt.getDate()-d);
  return dt.toISOString().substring(0,10);
}

function mapDropiStatus(status) {
  const map = {
    'delivered':  'entregado',
    'entregado':  'entregado',
    'pending':    'pendiente',
    'pendiente':  'pendiente',
    'in_transit': 'transito',
    'transito':   'transito',
    'returned':   'devuelto',
    'devuelto':   'devuelto',
    'cancelled':  'cancelado',
    'cancelado':  'cancelado',
  };
  return map[String(status).toLowerCase()] || 'pendiente';
}

// ============================================================
// META ADS API — Funciones de conexión real
// Documentación: https://developers.facebook.com/docs/marketing-api
// ============================================================
async function fetchMetaAds(period = 'hoy') {
  const { metaToken, metaAccount } = getCreds();
  if (!metaToken || !metaAccount) return SAMPLE_META;

  const datePreset = { hoy:'today', semana:'this_week_sun_today', mes:'this_month' }[period] || 'today';
  const fields = 'spend,impressions,clicks,actions,campaign_name,cpm,cpc';

  // Endpoint real de Meta:
  // GET /{ad_account_id}/insights?fields=...&date_preset=...&level=campaign
  const url = `${CONFIG.metaBaseUrl}/${metaAccount}/insights?` +
    `fields=${fields}&date_preset=${datePreset}&level=campaign&access_token=${metaToken}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta API: ${res.status}`);
    const data = await res.json();

    const rows = data.data || [];
    const gasto = rows.reduce((s,r) => s + parseFloat(r.spend||0), 0);
    const imps  = rows.reduce((s,r) => s + parseInt(r.impressions||0), 0);
    const clicks= rows.reduce((s,r) => s + parseInt(r.clicks||0), 0);

    const campaigns = rows.map(r => {
      const purchases = r.actions?.find(a => a.action_type === 'purchase');
      const pedidos   = parseInt(purchases?.value || 0);
      const spent     = parseFloat(r.spend || 0);
      return {
        nombre:  r.campaign_name,
        gasto:   spent,
        roas:    pedidos > 0 ? parseFloat((spent / pedidos).toFixed(2)) : 0,
        pedidos: pedidos,
        ctr:     parseFloat(r.ctr || 0),
      };
    });

    return { gasto, impresiones: imps, clicks, campaigns };
  } catch(e) {
    console.error('Error Meta:', e);
    return SAMPLE_META;
  }
}

// ============================================================
// HELPERS DE FECHAS
// ============================================================
function todayISO() {
  return new Date().toISOString().substring(0,10);
}
function weeksAgoISO(w) {
  const d = new Date();
  d.setDate(d.getDate() - w * 7);
  return d.toISOString().substring(0,10);
}
function monthStartISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().substring(0,10);
}

// ============================================================
// PASOS DE INTEGRACIÓN (guía en pantalla)
// ============================================================
const INTEGRATION_STEPS = [
  {
    title: '1. Obtén tu API Key de Dropi',
    desc:  'Ingresa a tu cuenta Dropi → Configuración → Integraciones → API. Copia tu API Key y tu Store ID.',
    code:  'URL: https://app.dropi.co/settings/integrations/api\nCopia: API Key + Store ID',
  },
  {
    title: '2. Crea una app en Meta for Developers',
    desc:  'Ve a developers.facebook.com → Crear app → Tipo "Negocio". Agrega el producto "Marketing API".',
    code:  'URL: https://developers.facebook.com/apps\nPermisos: ads_read, ads_management, read_insights',
  },
  {
    title: '3. Genera tu Access Token de Meta',
    desc:  'En tu app de Meta: Herramientas → Graph API Explorer → selecciona tu app → genera token con permisos de Marketing API. Para producción, genera un token de larga duración (60 días).',
    code:  'URL: https://developers.facebook.com/tools/explorer\nEjemplo token: EAAxxxxxxxxxxxxxxxx...',
  },
  {
    title: '4. Obtén tu Ad Account ID de Meta',
    desc:  'Ve a Meta Business Suite → Configuración del negocio → Cuentas publicitarias. El ID tiene formato act_XXXXXXXXXX.',
    code:  'URL: https://business.facebook.com/settings/ad-accounts\nFormato: act_1234567890',
  },
  {
    title: '5. Ingresa las credenciales en el panel',
    desc:  'Ve a la sección "Configuración" de este panel e ingresa tu API Key de Dropi, Store ID, Access Token de Meta y Ad Account ID. Los datos se guardan localmente en tu navegador.',
    code:  'Sección: Configuración → Conexión Dropi + Meta Ads',
  },
  {
    title: '6. Configura el backend (servidor proxy)',
    desc:  'Para producción, crea un servidor Node.js o Python que haga las llamadas a las APIs y las sirva al frontend. Esto protege tus credenciales y permite webhooks en tiempo real.',
    code:  '# Ejemplo Node.js (Express)\nnpm install express node-cron axios cors\nnode server.js',
  },
  {
    title: '7. Opcional — Webhooks de Dropi',
    desc:  'Dropi permite configurar webhooks para recibir actualizaciones de estado en tiempo real (sin polling). Configura la URL de tu servidor en Dropi → Integraciones → Webhooks.',
    code:  'POST /webhook/dropi\nEvents: order.delivered, order.returned, order.cancelled',
  },
];
