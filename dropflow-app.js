// ================================================
// DROPFLOW — App Core
// ================================================

// ---- GLOBALS ----
let ALL_ORDERS   = [];
let META_DATA    = { gasto:0, impresiones:0, clicks:0, ctr:0, cpa:0, roas:0, campanas:[] };
let CURRENT_PERIOD = 'mes';
let CURRENT_FROM   = null;
let CURRENT_UNTIL  = null;
let refreshTimer   = null;
let DP_STATE       = { open:false, from:null, until:null, selecting:'from', viewYear:new Date().getFullYear(), viewMonth:new Date().getMonth() };

// ---- COSTOS OPERACIONALES ----
const COST_FIELDS = [
  { key:'herramientas_ia',   label:'Herramientas IA' },
  { key:'dominio_hosting',   label:'Dominio / Hosting' },
  { key:'apps_saas',         label:'Apps / SaaS' },
  { key:'publicidad_extra',  label:'Publicidad Extra' },
  { key:'logistica_extra',   label:'Logística Extra' },
  { key:'empaques',          label:'Empaques' },
  { key:'empleados',         label:'Empleados / Freelancers' },
  { key:'impuestos',         label:'Impuestos / Contabilidad' },
  { key:'devoluciiones',     label:'Devoluciones Extra' },
  { key:'otros',             label:'Otros gastos' },
];

function getCostos() {
  return COST_FIELDS.reduce((acc, f) => {
    acc[f.key] = parseFloat(localStorage.getItem('cost_' + f.key) || '0');
    return acc;
  }, {});
}

function getTotalCostosOp() {
  const c = getCostos();
  return Object.values(c).reduce((a,b) => a+b, 0);
}

// ---- FORMAT ----
function fmt(n) {
  if (!n || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function fmtK(n) {
  if (!n || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1000000) return '$' + (n/1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000)    return '$' + Math.round(n/1000) + 'K';
  return '$' + Math.round(n);
}

function pct(val, base) {
  if (!base) return '0%';
  return Math.round(val/base*100) + '%';
}

function utilidad(o) {
  return (o.venta||0) - (o.proveedor||0) - (o.envio||0) - (o.ads||0);
}

// ---- NAVEGACIÓN ----
function navegarA(sec) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  const link = document.querySelector(`[data-nav="${sec}"]`);
  if (link) link.classList.add('active');

  const section = document.getElementById('sec-' + sec);
  if (section) section.classList.add('active');

  const titles = {
    dashboard:  'Contabilidad en vivo',
    pedidos:    'Pedidos',
    graficos:   'Gráficos & Analytics',
    meta:       'Meta Ads',
    proyeccion: 'Proyección',
    config:     'Configuración',
  };
  const el = document.getElementById('page-title');
  if (el) el.textContent = titles[sec] || sec;

  if (sec === 'pedidos')    renderTable();
  if (sec === 'meta')       renderMeta();
  if (sec === 'proyeccion') renderProjection();
  if (sec === 'graficos')   setTimeout(initCharts, 80);
  if (sec === 'config')     renderConfig();
}

// ---- PERIODO ----
async function changePeriod(val) {
  if (val === 'custom') return; // handled by calendar
  CURRENT_PERIOD = val;
  CURRENT_FROM   = null;
  CURRENT_UNTIL  = null;
  await refreshData();
}

// ---- DATE PICKER ----
function toggleDatePicker() {
  const popup = document.getElementById('dp-popup');
  if (!popup) return;
  DP_STATE.open = !DP_STATE.open;
  popup.classList.toggle('open', DP_STATE.open);
  if (DP_STATE.open) renderDatePicker();
}

function closeDatePicker() {
  DP_STATE.open = false;
  const popup = document.getElementById('dp-popup');
  if (popup) popup.classList.remove('open');
}

function renderDatePicker() {
  const grid = document.getElementById('dp-grid');
  const monthLabel = document.getElementById('dp-month-label');
  const fromField  = document.getElementById('dp-from-field');
  const untilField = document.getElementById('dp-until-field');
  const applyBtn   = document.getElementById('dp-apply-btn');
  if (!grid) return;

  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  if (monthLabel) monthLabel.textContent = months[DP_STATE.viewMonth] + ' ' + DP_STATE.viewYear;

  const today = new Date();
  const todayStr = today.toISOString().substring(0,10);
  const firstDay = new Date(DP_STATE.viewYear, DP_STATE.viewMonth, 1).getDay();
  const daysInMonth = new Date(DP_STATE.viewYear, DP_STATE.viewMonth+1, 0).getDate();

  const days = ['D','L','M','M','J','V','S'];
  let html = days.map(d => `<div class="dp-day-name">${d}</div>`).join('');
  html += Array(firstDay).fill('<div class="dp-day empty"></div>').join('');

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${DP_STATE.viewYear}-${String(DP_STATE.viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    let cls = 'dp-day';
    if (iso === todayStr) cls += ' today';
    if (DP_STATE.from && DP_STATE.until) {
      if (iso > DP_STATE.from && iso < DP_STATE.until) cls += ' in-range';
      if (iso === DP_STATE.from) cls += ' range-start';
      if (iso === DP_STATE.until) cls += ' range-end';
    } else if (iso === DP_STATE.from) cls += ' selected';
    html += `<div class="${cls}" onclick="dpSelectDay('${iso}')">${d}</div>`;
  }

  grid.innerHTML = html;

  if (fromField)  { fromField.textContent  = DP_STATE.from  || 'Inicio'; fromField.className  = 'dp-range-field' + (DP_STATE.selecting==='from' ? ' active' : ''); }
  if (untilField) { untilField.textContent = DP_STATE.until || 'Fin';    untilField.className = 'dp-range-field' + (DP_STATE.selecting==='until' ? ' active' : ''); }
  if (applyBtn)   { applyBtn.disabled = !(DP_STATE.from && DP_STATE.until); }
}

function dpSelectDay(iso) {
  if (DP_STATE.selecting === 'from') {
    DP_STATE.from    = iso;
    DP_STATE.until   = null;
    DP_STATE.selecting = 'until';
  } else {
    if (iso < DP_STATE.from) {
      DP_STATE.until = DP_STATE.from;
      DP_STATE.from  = iso;
    } else {
      DP_STATE.until = iso;
    }
    DP_STATE.selecting = 'from';
  }
  renderDatePicker();
}

function dpNavMonth(dir) {
  DP_STATE.viewMonth += dir;
  if (DP_STATE.viewMonth < 0)  { DP_STATE.viewMonth = 11; DP_STATE.viewYear--; }
  if (DP_STATE.viewMonth > 11) { DP_STATE.viewMonth = 0;  DP_STATE.viewYear++; }
  renderDatePicker();
}

async function dpApply() {
  if (!DP_STATE.from || !DP_STATE.until) return;
  CURRENT_FROM   = DP_STATE.from;
  CURRENT_UNTIL  = DP_STATE.until;
  CURRENT_PERIOD = 'custom';

  const sel = document.getElementById('period-select');
  if (sel) {
    // update display
    const opt = sel.querySelector('option[value="custom"]');
    if (opt) opt.textContent = `${DP_STATE.from} → ${DP_STATE.until}`;
    sel.value = 'custom';
  }
  closeDatePicker();
  await refreshData();
}

// ---- INIT ----
async function init() {
  updateDateBadge();
  setSyncStatus('loading');
  await startTokenMonitor();
  ALL_ORDERS = await fetchDropiOrders(CURRENT_PERIOD);
  META_DATA  = await fetchMetaAds(CURRENT_PERIOD);
  assignAdsPerOrder();
  renderDashboard();
  setSyncStatus('live');
  scheduleRefresh();

  // Close datepicker on outside click
  document.addEventListener('click', e => {
    const wrapper = document.getElementById('period-wrapper');
    if (wrapper && !wrapper.contains(e.target)) closeDatePicker();
  });
}

function assignAdsPerOrder() {
  // dailyCampMap: { 'YYYY-MM-DD': { 'nombre_campaña': { gasto, conversiones } } }
  const dailyCampMap = META_DATA.dailyCampMap || {};
  const globalCpa    = META_DATA.gasto > 0 && ALL_ORDERS.length > 0
    ? META_DATA.gasto / ALL_ORDERS.length : 0;

  ALL_ORDERS = ALL_ORDERS.map(o => {
    const fecha    = (o.fecha||'').substring(0,10);
    const producto = (o.producto||'').toLowerCase().trim();
    const dayData  = dailyCampMap[fecha] || {};

    // Buscar campaña cuyo nombre coincida con el producto
    let cpa = 0;
    let matched = false;

    for (const [campNombre, data] of Object.entries(dayData)) {
      const camp = campNombre.toLowerCase().trim();
      // Match si el nombre del producto está contenido en la campaña o viceversa
      if (camp.includes(producto.substring(0,10)) || producto.includes(camp.substring(0,10))) {
        if (data.conversiones > 0) {
          cpa = data.gasto / data.conversiones;
          matched = true;
          break;
        }
      }
    }

    // Fallback 1: CPA del día sin importar campaña
    if (!matched) {
      const dayTotal = Object.values(dayData).reduce((a,d)=>({gasto:a.gasto+d.gasto, conv:a.conv+d.conversiones}), {gasto:0,conv:0});
      if (dayTotal.conv > 0) cpa = dayTotal.gasto / dayTotal.conv;
      else if (dayTotal.gasto > 0) {
        const pedidosDelDia = ALL_ORDERS.filter(p=>(p.fecha||'').substring(0,10)===fecha).length || 1;
        cpa = dayTotal.gasto / pedidosDelDia;
      }
    }

    // Fallback 2: CPA global del período
    if (!cpa) cpa = globalCpa;

    return { ...o, ads: Math.round(cpa) };
  });

  const matched = ALL_ORDERS.filter(o=>o.ads>0).length;
  console.log('[cpa] Pedidos con CPA asignado:', matched, '/', ALL_ORDERS.length);
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const interval = parseInt(localStorage.getItem('dropi_interval') || '300') * 1000;
  refreshTimer = setInterval(refreshData, interval);
}

async function refreshData() {
  setSyncStatus('loading');
  try {
    ALL_ORDERS = await fetchDropiOrders(CURRENT_PERIOD, CURRENT_FROM, CURRENT_UNTIL);
    META_DATA  = await fetchMetaAds(CURRENT_PERIOD);
    assignAdsPerOrder();
    renderDashboard();
    renderTable();
    renderMeta();
  } catch(e) {
    console.error('refreshData error:', e);
  }
  setSyncStatus('live');
  const lu = document.getElementById('last-update');
  if (lu) lu.textContent = 'Últ: ' + new Date().toLocaleTimeString('es-CL', {hour:'2-digit',minute:'2-digit'});
}

// ---- SYNC STATUS ----
function setSyncStatus(state) {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  dot.className = 'sync-dot' + (state==='live'?' live':state==='error'?' error':'');
  label.textContent = state==='live'?'En vivo':state==='error'?'Error':' Sync...';
}

function updateDateBadge() {
  const el = document.getElementById('date-badge');
  if (el) el.textContent = new Date().toLocaleDateString('es-CL', {weekday:'long',day:'numeric',month:'long'});
}

// ---- DASHBOARD ----
function renderDashboard() {
  const ent   = ALL_ORDERS.filter(o => o.estado === 'entregado');
  const pen   = ALL_ORDERS.filter(o => o.estado === 'pendiente' || o.estado === 'transito');
  const tasa  = parseFloat(localStorage.getItem('param_tasa') || '75') / 100;
  const costOp = getTotalCostosOp();

  const totalVenta = ent.reduce((s,o) => s + o.venta, 0);
  const totalProv  = ent.reduce((s,o) => s + o.proveedor, 0);
  const totalEnvio = ent.reduce((s,o) => s + o.envio, 0);
  const totalAds   = ent.reduce((s,o) => s + (o.ads||0), 0);
  const totalCost  = totalProv + totalEnvio + totalAds + costOp;
  const totalUtil  = totalVenta - totalCost;
  const projUtil   = pen.reduce((s,o) => s + utilidad(o), 0) * tasa - costOp * tasa;

  animateValue('k-ingresos',  totalVenta);
  animateValue('k-costos',    totalCost);
  animateValue('k-utilidad',  totalUtil);
  animateValue('k-proyeccion',projUtil);

  setText('k-ingresos-sub',  ent.length + ' pedidos entregados');
  setText('k-costos-sub',    'Prov + envío + ads + operación');
  setText('k-margen-sub',    'Margen: ' + pct(totalUtil, totalVenta));
  setText('k-proy-sub',      pen.length + ' pend. × ' + Math.round(tasa*100) + '%');

  renderSparkline('spark-ingresos', ent, o => o.venta,    '#00d68f');
  renderSparkline('spark-costos',   ent, o => o.proveedor+o.envio+(o.ads||0), '#f43f5e');
  renderSparkline('spark-util',     ent, o => utilidad(o),'#8b5cf6');
  renderSparkline('spark-proy',     pen, o => utilidad(o)*tasa,'#f59e0b');

  // Cost breakdown incluyendo costos operacionales
  const breakdown = [
    ['Costo proveedor',    totalProv,  totalVenta, 'var(--green)'],
    ['Envío Dropi',        totalEnvio, totalVenta, 'var(--blue2)'],
    ['Meta Ads',           totalAds,   totalVenta, 'var(--purple)'],
    ['Costos operación',   costOp,     totalVenta, 'var(--red)'],
    ['Utilidad neta',      totalUtil,  totalVenta, 'var(--amber)'],
  ];

  const bd = document.getElementById('cost-breakdown');
  if (bd) {
    // Update toggle total
    const tt = document.getElementById('costos-op-total');
    if (tt) tt.textContent = costOp > 0 ? '— ' + fmt(costOp) : '';

    bd.innerHTML = breakdown.map(([label,val,base,color]) => `
      <div class="cost-item">
        <div class="cost-item-row">
          <span class="cost-item-label">${label}</span>
          <span class="cost-item-val" style="color:${color}">${fmt(val)} <span class="muted" style="font-size:10px">${pct(val,base)}</span></span>
        </div>
        <div class="cost-track">
          <div class="cost-fill" style="width:${Math.min(100,Math.abs(Math.round((val/base)||0)*100/100))}%;background:${color}"></div>
        </div>
      </div>
    `).join('');
  }

  renderStatusSection();
  renderTotalNeto(totalUtil, projUtil, pen.length, tasa);
  renderTasaReal();
}

function renderTotalNeto(utilReal, utilProy, penCount, tasa) {
  animateValue('tn-real',  utilReal  || 0);
  animateValue('tn-proy',  utilProy  || 0);
  animateValue('tn-total', (utilReal||0) + (utilProy||0));
  setText('tn-real-sub',  (ALL_ORDERS.filter(o=>o.estado==='entregado').length) + ' entregados');
  setText('tn-proy-sub',  penCount + ' pedidos × ' + Math.round(tasa*100) + '%');
  const totalV = ALL_ORDERS.filter(o=>o.estado==='entregado').reduce((s,o)=>s+o.venta,0);
  const total  = (utilReal||0)+(utilProy||0);
  setText('tn-total-sub', 'Margen total: ' + pct(total, totalV));
}

function renderTasaReal() {
  const total    = ALL_ORDERS.length;
  const ent      = ALL_ORDERS.filter(o=>o.estado==='entregado').length;
  const tasaReal = total > 0 ? Math.round(ent/total*100) : 0;
  const el = document.getElementById('tasa-real-val');
  if (el) el.textContent = tasaReal + '%';
  const bar = document.getElementById('tasa-real-bar');
  if (bar) bar.style.width = tasaReal + '%';
  const sub = document.getElementById('tasa-real-sub');
  if (sub) sub.textContent = ent + ' entregados de ' + total + ' pedidos';
}

function renderStatusSection() {
  const counts = {
    entregado:0, transito:0, pendiente:0, devuelto:0, cancelado:0
  };
  ALL_ORDERS.forEach(o => { if(counts[o.estado]!==undefined) counts[o.estado]++; });
  const total = ALL_ORDERS.length || 1;

  const statuses = [
    { key:'entregado', label:'Entregado', color:'var(--green)' },
    { key:'transito',  label:'En tránsito',color:'var(--blue2)' },
    { key:'pendiente', label:'Pendiente', color:'var(--amber)' },
    { key:'devuelto',  label:'Devuelto',  color:'var(--red)' },
    { key:'cancelado', label:'Cancelado', color:'var(--text3)' },
  ];

  const el = document.getElementById('status-grid');
  if (!el) return;
  el.innerHTML = statuses.map(s => {
    const n   = counts[s.key] || 0;
    const pct2 = Math.round(n/total*100);
    return `
      <div class="status-row">
        <div class="status-dot" style="background:${s.color}"></div>
        <span class="status-label">${s.label}</span>
        <div class="status-bar-wrap">
          <div class="status-bar-fill" style="width:${pct2}%;background:${s.color}"></div>
        </div>
        <span class="status-count">${n} — ${pct2}%</span>
      </div>
    `;
  }).join('');
  setText('status-total', ALL_ORDERS.length + ' total');
}

// ---- SPARKLINE ----
function renderSparkline(id, orders, fn, color) {
  const el = document.getElementById(id);
  if (!el) return;
  const byDate = {};
  orders.forEach(o => {
    const d = (o.fecha||'').substring(0,10);
    byDate[d] = (byDate[d]||0) + fn(o);
  });
  const vals = Object.values(byDate);
  if (!vals.length) return;
  const max = Math.max(...vals)||1;
  const W=80, H=36;
  const pts = vals.map((v,i) => `${(i/(vals.length-1||1)*W).toFixed(1)},${(H-v/max*H).toFixed(1)}`).join(' ');
  const area = vals.map((v,i) => `${(i/(vals.length-1||1)*W).toFixed(1)},${(H-v/max*H).toFixed(1)}`);
  const areaPath = `M${area[0]} ${area.slice(1).map(p=>'L'+p).join(' ')} L${W},${H} L0,${H} Z`;
  el.innerHTML = `<svg class="sparkline-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="sg-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#sg-${id})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

// ---- TABLA ----
let TABLE_FILTER = 'todos';
function renderTable() {
  const filtered = TABLE_FILTER === 'todos' ? ALL_ORDERS : ALL_ORDERS.filter(o => o.estado === TABLE_FILTER);
  const el = document.getElementById('orders-table-body');
  if (!el) return;

  if (!filtered.length) {
    el.innerHTML = `<tr><td colspan="9"><div class="empty-state">Sin pedidos para este período</div></td></tr>`;
    return;
  }

  el.innerHTML = filtered.slice(0,200).map(o => {
    const util = utilidad(o);
    return `<tr>
      <td class="mono muted">${o.id}</td>
      <td class="mono muted" style="font-size:10px">${o.fecha||''}</td>
      <td>${(o.producto||'').substring(0,28)}</td>
      <td><span class="badge ${o.estado}">${o.estado}</span></td>
      <td class="r mono positive">${fmt(o.venta)}</td>
      <td class="r mono muted">${fmt(o.proveedor)}</td>
      <td class="r mono muted">${fmt(o.envio)}</td>
      <td class="r mono" style="color:var(--purple)">${fmt(o.ads||0)}</td>
      <td class="r mono ${util>=0?'positive':'negative'}">${fmt(util)}</td>
      <td class="muted">${o.ciudad||''}</td>
    </tr>`;
  }).join('');

  // Footer totals
  const tv = filtered.reduce((s,o)=>s+o.venta,0);
  const te = filtered.reduce((s,o)=>s+o.envio,0);
  const tu = filtered.reduce((s,o)=>s+utilidad(o),0);
  setText('table-footer-info', `${filtered.length} pedidos · Ventas ${fmt(tv)} · Envío ${fmt(te)} · Utilidad ${fmt(tu)}`);
}

function setTableFilter(f) {
  TABLE_FILTER = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  renderTable();
}

// ---- META ADS ----
function renderMeta() {
  animateValue('meta-gasto',       META_DATA.gasto||0);
  animateValue('meta-impresiones', META_DATA.impresiones||0, true);
  const ctr  = document.getElementById('meta-ctr');
  if (ctr)   ctr.textContent  = ((META_DATA.ctr||0)*100).toFixed(1) + '%';
  const roas = document.getElementById('meta-roas');
  if (roas)  roas.textContent = (META_DATA.roas||0).toFixed(1) + 'x';
  animateValue('meta-cpa', META_DATA.cpa||0);

  const camp = document.getElementById('meta-campaigns');
  if (!camp) return;
  const camps = META_DATA.campanas || [];
  if (!camps.length) {
    camp.innerHTML = `<div class="empty-state">Sin datos de campañas — conecta Meta Ads en Configuración</div>`;
    return;
  }
  camp.innerHTML = camps.map(c => `
    <div class="campaign-row">
      <div class="campaign-name">${c.nombre||'Campaña'}</div>
      <span class="campaign-stat">${fmt(c.gasto)}</span>
      <span class="campaign-stat">${c.clicks||0} clicks</span>
      <span class="campaign-roas">${(c.roas||0).toFixed(1)}x</span>
    </div>
  `).join('');
}

// ---- PROYECCIÓN ----
function renderProjection() {
  updateSimulator();
}

function updateSimulator() {
  const tasaEl = document.getElementById('sim-tasa');
  const precioEl = document.getElementById('sim-precio');
  const pedidosEl = document.getElementById('sim-pedidos');
  const tasa   = parseInt(tasaEl?.value || 75);
  const precio = parseInt(precioEl?.value || 25000);
  const pedidos= parseInt(pedidosEl?.value || 100);
  setText('sim-tasa-val',    tasa + '%');
  setText('sim-precio-val',  fmt(precio));
  setText('sim-pedidos-val', pedidos + '');

  const ent    = ALL_ORDERS.filter(o=>o.estado==='entregado');
  const pen    = ALL_ORDERS.filter(o=>o.estado==='pendiente'||o.estado==='transito');
  const utilR  = ent.reduce((s,o)=>s+utilidad(o),0);
  const utilP  = pen.reduce((s,o)=>s+utilidad(o),0) * (tasa/100);
  const sim    = pedidos * (tasa/100) * (precio * 0.25); // 25% margen simulado

  animateValue('proj-real',  utilR);
  animateValue('proj-pend',  utilP);
  animateValue('proj-total', utilR+utilP);
  animateValue('proj-sim',   sim);

  localStorage.setItem('param_tasa', tasa.toString());
}

// ---- COSTOS OPERACIONALES ----
function toggleCostosPanel() {
  const panel = document.getElementById('costos-panel');
  const arrow = document.getElementById('costos-arrow');
  if (!panel) return;
  panel.classList.toggle('open');
  if (arrow) arrow.style.transform = panel.classList.contains('open') ? 'rotate(180deg)' : '';
}

function saveCostos() {
  COST_FIELDS.forEach(f => {
    const el = document.getElementById('cost-input-' + f.key);
    if (el) localStorage.setItem('cost_' + f.key, el.value || '0');
  });
  renderDashboard();
  toggleCostosPanel();
  showToast('Costos operacionales guardados ✓', 'green');
}

function renderCostosPanel() {
  const el = document.getElementById('costos-panel');
  if (!el) return;
  const icons = {
    herramientas_ia:  '🤖',
    dominio_hosting:  '🌐',
    apps_saas:        '📱',
    publicidad_extra: '📢',
    logistica_extra:  '📦',
    empaques:         '🎁',
    empleados:        '👥',
    impuestos:        '🧾',
    devoluciiones:    '↩️',
    otros:            '💼',
  };
  el.innerHTML = `
    <div style="grid-column:1/-1;font-family:var(--font-mono);font-size:9px;color:var(--text3);margin-bottom:4px;letter-spacing:0.5px">
      💡 Estos costos se distribuyen mensualmente y se descuentan de tu utilidad real
    </div>
  ` + COST_FIELDS.map(f => {
    const val = localStorage.getItem('cost_' + f.key) || '';
    const icon = icons[f.key] || '•';
    return `
      <div class="costo-item">
        <div class="costo-item-label">${icon} ${f.label}</div>
        <input id="cost-input-${f.key}" class="costo-item-input" type="number" placeholder="$0/mes" value="${val}">
      </div>
    `;
  }).join('') + `
    <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px">
      <button class="costos-save-btn" onclick="saveCostos()" style="flex:1">💾 Guardar costos</button>
      <button class="costos-save-btn" onclick="clearCostos()" style="flex:0;padding:7px 12px;background:var(--red-bg);border-color:rgba(244,63,94,0.2);color:var(--red)">✕</button>
    </div>
  `;
}

function clearCostos() {
  COST_FIELDS.forEach(f => localStorage.removeItem('cost_' + f.key));
  renderCostosPanel();
  renderDashboard();
  showToast('Costos limpiados', 'green');
}

// ---- CONFIG ----
function renderConfig() {
  // Token status
  const token = localStorage.getItem('dropi_key') || '';
  const tokenPreview = document.getElementById('dropi-token-preview');
  if (tokenPreview && token) tokenPreview.textContent = token.substring(0,20) + '...';
}

function connectDropi() {
  const input = document.getElementById('dropi-token-input');
  if (!input) return;
  let token = input.value.trim();
  if (token.startsWith('Bearer ')) token = token.substring(7);
  if (!token) return setConfigStatus('dropi-status', 'err', 'Token requerido');
  localStorage.setItem('dropi_key', token);
  fetch('/api/set-token', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token})
  }).then(()=>{
    setConfigStatus('dropi-status', 'ok', '✓ Dropi conectado');
    refreshData();
  }).catch(() => setConfigStatus('dropi-status', 'err', 'Error de conexión'));
}

function connectMeta() {
  const tokenEl   = document.getElementById('meta-token-input');
  const accountEl = document.getElementById('meta-account-input');
  if (!tokenEl || !accountEl) return;
  const token   = tokenEl.value.trim();
  const account = accountEl.value.trim();
  if (!token || !account) return setConfigStatus('meta-status', 'err', 'Token y Account ID requeridos');
  localStorage.setItem('meta_token',   token);
  localStorage.setItem('meta_account', account);
  localStorage.setItem('meta_token_time', Date.now().toString());
  setConfigStatus('meta-status', 'ok', '✓ Meta Ads conectado');
  refreshData();
}

function setConfigStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'config-status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
}

function saveParams() {
  const envio = document.getElementById('param-envio');
  const tasa  = document.getElementById('param-tasa');
  if (envio) localStorage.setItem('param_envio', envio.value || '8500');
  if (tasa)  localStorage.setItem('param_tasa',  tasa.value  || '75');
  showToast('Parámetros guardados ✓', 'green');
  renderDashboard();
}

// ---- UTILIDADES ----
function animateValue(id, target, noFormat) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = 0;
  const duration = 600;
  const startTime = performance.now();
  function update(now) {
    const p = Math.min(1, (now-startTime)/duration);
    const ease = 1-Math.pow(1-p, 3);
    const val = Math.round(start + (target-start)*ease);
    el.textContent = noFormat ? val.toLocaleString('es-CL') : fmt(val);
    if (p < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:9999;
    background:${type==='green'?'var(--green-bg)':'var(--red-bg)'};
    border:1px solid ${type==='green'?'rgba(0,214,143,0.3)':'rgba(244,63,94,0.3)'};
    color:${type==='green'?'var(--green)':'var(--red)'};
    font-family:var(--font-mono);font-size:11px;padding:10px 16px;
    border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---- FETCH META ----
async function fetchMetaAds(period) {
  const token   = localStorage.getItem('meta_token');
  const account = localStorage.getItem('meta_account');
  if (!token || !account) return META_DATA;
  try {
    const r = await fetch(`/api/meta?token=${encodeURIComponent(token)}&account=${encodeURIComponent(account)}&period=${period}`);
    const json = await r.json();
    if (!json.ok || !json.data) return META_DATA;

    // Construir mapa de gasto y conversiones por día
    // time_increment=1 devuelve un registro por campaña por día
    const dailyMap = {}; // { 'YYYY-MM-DD': { gasto, conversiones } }

    const camps = [];
    const campMap = {}; // agrupar por nombre de campaña

    json.data.forEach(c => {
      const spend = parseFloat(c.spend||0);
      const purchases = (c.actions||[]).find(a=>a.action_type==='purchase');
      const conversiones = parseFloat(purchases?.value||0);
      const purchaseVal = parseFloat((c.action_values||[]).find(a=>a.action_type==='purchase')?.value||0);
      const clicks = parseInt(c.clicks||0);
      const impr   = parseInt(c.impressions||0);
      const fecha  = c.date_start || '';

      // Acumular por día
      if (fecha) {
        if (!dailyMap[fecha]) dailyMap[fecha] = { gasto:0, conversiones:0 };
        dailyMap[fecha].gasto       += spend;
        dailyMap[fecha].conversiones += conversiones;
      }

      // Agrupar por campaña para mostrar en tabla
      const nombre = c.campaign_name || 'Campaña';
      if (!campMap[nombre]) campMap[nombre] = { nombre, gasto:0, clicks:0, impresiones:0, conversiones:0, ingresos:0 };
      campMap[nombre].gasto       += spend;
      campMap[nombre].clicks      += clicks;
      campMap[nombre].impresiones += impr;
      campMap[nombre].conversiones+= conversiones;
      campMap[nombre].ingresos    += purchaseVal;
    });

    const campList = Object.values(campMap).map(c => ({
      ...c,
      roas: c.gasto > 0 ? c.ingresos/c.gasto : 0,
      ctr:  c.impresiones > 0 ? c.clicks/c.impresiones : 0,
      cpa:  c.conversiones > 0 ? c.gasto/c.conversiones : 0,
    }));

    const totalGasto = campList.reduce((s,c)=>s+c.gasto,0);
    const totalIng   = campList.reduce((s,c)=>s+c.ingresos,0);
    const totalConv  = campList.reduce((s,c)=>s+c.conversiones,0);
    const totalClicks= campList.reduce((s,c)=>s+c.clicks,0);
    const totalImpr  = campList.reduce((s,c)=>s+c.impresiones,0);

    // Construir mapa por día + campaña para match exacto con producto
    const dailyCampMap = {};
    json.data.forEach(c => {
      const fecha  = c.date_start || '';
      const nombre = c.campaign_name || '';
      const spend  = parseFloat(c.spend||0);
      const purchases = (c.actions||[]).find(a=>a.action_type==='purchase');
      const conversiones = parseFloat(purchases?.value||0);
      if (fecha && nombre) {
        if (!dailyCampMap[fecha]) dailyCampMap[fecha] = {};
        if (!dailyCampMap[fecha][nombre]) dailyCampMap[fecha][nombre] = {gasto:0,conversiones:0};
        dailyCampMap[fecha][nombre].gasto       += spend;
        dailyCampMap[fecha][nombre].conversiones += conversiones;
      }
    });

    console.log('[meta] Mapa diario:', dailyMap);
    console.log('[meta] Mapa campaña×día:', Object.keys(dailyCampMap).length, 'días');

    return {
      gasto: totalGasto, impresiones: totalImpr, clicks: totalClicks,
      ctr:   totalImpr>0?totalClicks/totalImpr:0,
      cpa:   totalConv>0?totalGasto/totalConv:0,
      roas:  totalGasto>0?totalIng/totalGasto:0,
      campanas: campList,
      dailyMap,
      dailyCampMap, // CPA por día×campaña para match con producto
    };
  } catch(e) {
    console.error('Meta error:', e);
    return META_DATA;
  }
}
