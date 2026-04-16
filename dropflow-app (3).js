// dropflow-app.js
// IDs sincronizados con dropflow.html · Drag & drop · Parser corregido

// ─── ESTADO ───────────────────────────────────────────────────────────────────
window.STATE = {};
const STATE = window.STATE;
Object.assign(STATE, {
  pedidos:     [],
  metaAds:     null,
  filtroDesde: '',
  filtroHasta: '',
  filtroTabla: 'todos',
  tasaEntrega: 75,
  costoEnvio:  6000,
};

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const setText = (id, val) => { const e=$(id); if(e) e.textContent=val; };

function showToast(msg, tipo='ok') {
  let t = document.querySelector('.df-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'df-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'df-toast show ' + (tipo==='error'?'toast-err':'toast-ok');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function showStatus(id, msg, tipo='ok') {
  const e = $(id);
  if (!e) return;
  e.style.display = 'block';
  e.style.color = tipo==='error' ? 'var(--red)' : 'var(--green)';
  e.textContent = msg;
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────────────────────
function navegarA(seccion) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const sec = $('sec-' + seccion);
  const btn = document.querySelector(`[data-nav="${seccion}"]`);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');
  const titulos = {
    dashboard:'Contabilidad en vivo', pedidos:'Pedidos', graficos:'Gráficos',
    meta:'Meta Ads', proyeccion:'Proyección', config:'Configuración'
  };
  setText('page-title', titulos[seccion] || seccion);
  if (seccion==='graficos' && STATE.pedidos.length) renderCharts();
}

// ─── RENDER DASHBOARD ─────────────────────────────────────────────────────────
function renderDashboard() {
  const pedFiltrados = filtrarPorFecha(STATE.pedidos, STATE.filtroDesde, STATE.filtroHasta);
  const R = calcularResumen(pedFiltrados, STATE.tasaEntrega);

  // KPIs
  setText('k-ingresos',   fmtCLP(R.ingresosReales));
  setText('k-ingresos-sub', `${R.entregados} pedidos entregados`);
  setText('k-costos',     fmtCLP(R.costosTotal));
  setText('k-costos-sub', 'Prov + envío + comisión');
  setText('k-proyeccion', fmtCLP(R.proyUtilidad));
  setText('k-proy-sub',   `${R.pendientes + R.enTransito} pend. × ${STATE.tasaEntrega}%`);
  setText('k-utilidad',   fmtCLP(R.utilidadReal));
  setText('k-margen-sub', `Margen: ${fmtPct(R.margenReal)}`);
  setText('total-ing-tag', `sobre ${fmtCLP(R.ingresosReales)}`);

  // Distribución costos
  renderCostBreakdown(R);

  // Estado pedidos
  setText('status-total', `${R.total} total`);
  const grid = $('status-grid');
  if (grid) {
    grid.innerHTML = [
      { label:'Entregados', val:R.entregados, color:'var(--green)' },
      { label:'En tránsito', val:R.enTransito, color:'var(--blue2)' },
      { label:'Pendientes',  val:R.pendientes, color:'var(--amber)' },
      { label:'Devueltos',   val:R.devueltos,  color:'var(--red)' },
      { label:'Cancelados',  val:R.cancelados, color:'var(--text3)' },
    ].map(s => `
      <div class="status-item">
        <div class="status-dot" style="background:${s.color}"></div>
        <div class="status-label">${s.label}</div>
        <div class="status-val" style="color:${s.color}">${s.val}</div>
      </div>
    `).join('');
  }

  // Tasa real
  setText('tasa-real-val', fmtPct(R.tasaReal));
  setText('tasa-real-sub', `${R.entregados} entregados de ${R.entregados+R.enTransito+R.devueltos+R.cancelados} con guía`);
  const bar = $('tasa-real-bar');
  if (bar) bar.style.width = Math.min(R.tasaReal, 100) + '%';

  // Total neto consolidado
  setText('tn-real',     fmtCLP(R.utilidadReal));
  setText('tn-real-sub', `${R.entregados} entregados`);
  setText('tn-proy',     fmtCLP(R.proyUtilidad));
  setText('tn-proy-sub', `${R.pendientes+R.enTransito} pedidos × ${STATE.tasaEntrega}%`);
  setText('tn-total',    fmtCLP(R.utilidadTotal));
  setText('tn-total-sub',`Margen: ${fmtPct(R.margenReal)}`);

  // Proyector
  setText('proj-real',  fmtCLP(R.utilidadReal));
  setText('proj-pend',  fmtCLP(R.proyUtilidad));
  setText('proj-total', fmtCLP(R.utilidadTotal));
}

function renderCostBreakdown(R) {
  const el = $('cost-breakdown');
  if (!el) return;
  const total = R.costosTotal || 1;
  const items = [
    { label:'Proveedor', val:R.costoProveedor, color:'var(--red)' },
    { label:'Flete',     val:R.costoFlete,     color:'var(--amber)' },
    { label:'Comisión',  val:R.costoComision,  color:'var(--blue2)' },
  ];
  el.innerHTML = items.map(i => {
    const pct = (i.val/total*100).toFixed(1);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
          <span style="color:var(--text2)">${i.label}</span>
          <span style="color:var(--text1)">${fmtCLP(i.val)} <span style="color:var(--text3)">(${pct}%)</span></span>
        </div>
        <div style="height:5px;background:var(--bg4);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${i.color};border-radius:3px;transition:width 0.8s ease"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── RENDER TABLA PEDIDOS ─────────────────────────────────────────────────────
function renderPedidos() {
  const tbody = $('orders-table-body');
  if (!tbody) return;

  let pedidos = filtrarPorFecha(STATE.pedidos, STATE.filtroDesde, STATE.filtroHasta);
  if (STATE.filtroTabla !== 'todos') {
    pedidos = pedidos.filter(p => p.estado === STATE.filtroTabla);
  }

  setText('table-footer-info', `${pedidos.length} pedidos mostrados`);

  if (!pedidos.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">${
      STATE.pedidos.length ? 'No hay pedidos para este filtro' : 'Importa un Excel de Dropi para ver tus pedidos'
    }</div></td></tr>`;
    return;
  }

  const BADGE = {
    entregado:'badge-green', transito:'badge-blue', pendiente:'badge-yellow',
    devuelto:'badge-red', cancelado:'badge-gray', otro:'badge-gray'
  };

  tbody.innerHTML = pedidos.map(p => `
    <tr>
      <td style="font-family:var(--font-mono);font-size:11px">${p.id}</td>
      <td>${p.fecha}</td>
      <td>${p.producto}</td>
      <td><span class="badge ${BADGE[p.estado]||'badge-gray'}">${p.estadoRaw}</span></td>
      <td style="text-align:right">${fmtCLP(p.venta)}</td>
      <td style="text-align:right">${fmtCLP(p.proveedor)}</td>
      <td style="text-align:right">${fmtCLP(p.flete)}</td>
      <td style="text-align:right">${fmtCLP(p.comision)}</td>
      <td style="text-align:right;color:${p.utilidad>=0?'var(--green)':'var(--red)'}">${fmtCLP(p.utilidad)}</td>
      <td>${p.ciudad}</td>
    </tr>
  `).join('');
}

function setTableFilter(filtro) {
  STATE.filtroTabla = filtro;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-filter="${filtro}"]`);
  if (btn) btn.classList.add('active');
  renderPedidos();
}

// ─── RENDER META ──────────────────────────────────────────────────────────────
function renderMeta() {
  const meta = STATE.metaAds;
  if (!meta) return;
  setText('meta-gasto',       fmtCLP(meta.gastoTotal));
  setText('meta-impresiones', meta.impresiones.toLocaleString('es-CL'));
  setText('meta-ctr',         fmtPct(meta.ctr));
  const R = STATE.pedidos.length ? calcularResumen(STATE.pedidos, STATE.tasaEntrega) : null;
  const roas = R && meta.gastoTotal>0 ? (R.ingresosReales/meta.gastoTotal).toFixed(2)+'x' : '—';
  setText('meta-roas', roas);

  const cont = $('meta-campaigns');
  if (cont && meta.campanas.length) {
    cont.innerHTML = `<table style="width:100%;font-size:12px">
      <thead><tr>
        <th>Campaña</th><th style="text-align:right">Gasto</th>
        <th style="text-align:right">Impr.</th><th style="text-align:right">Clics</th>
        <th style="text-align:right">Compras</th><th style="text-align:right">CPA</th>
      </tr></thead>
      <tbody>${meta.campanas.map(c=>`<tr>
        <td>${c.nombre||'Sin nombre'}</td>
        <td style="text-align:right">${fmtCLP(c.gasto)}</td>
        <td style="text-align:right">${c.impresiones.toLocaleString('es-CL')}</td>
        <td style="text-align:right">${c.clics.toLocaleString('es-CL')}</td>
        <td style="text-align:right">${c.compras}</td>
        <td style="text-align:right">${c.gasto>0&&c.compras>0?fmtCLP(c.gasto/c.compras):'—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
}

// ─── IMPORTAR DROPI ───────────────────────────────────────────────────────────
async function handleDropiFile(input) {
  const file = input?.files?.[0] || input;
  if (!file) return;

  const btn = $('btn-import-dropi');
  if (btn) { btn.disabled=true; btn.textContent='⏳ Procesando...'; }

  try {
    const pedidos = await importarDropiExcel(file);
    STATE.pedidos = pedidos;
    try { localStorage.setItem('df_pedidos', JSON.stringify(pedidos));
          localStorage.setItem('df_pedidos_ts', new Date().toISOString()); } catch(e){}

    showToast(`✓ ${pedidos.length} pedidos importados`);
    showStatus('dropi-import-status', `✓ ${pedidos.length} pedidos cargados correctamente`, 'ok');

    // Actualizar preview token
    const R = calcularResumen(pedidos, STATE.tasaEntrega);
    const prev = $('dropi-token-preview');
    if (prev) prev.textContent = `${pedidos.length} pedidos · ${fmtCLP(R.utilidadReal)} utilidad`;

    renderDashboard();
    renderPedidos();
    renderCharts();
  } catch(err) {
    showToast('❌ ' + err.message, 'error');
    showStatus('dropi-import-status', '❌ ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='📂 Seleccionar archivo Excel de Dropi'; }
    if (input?.value !== undefined) input.value='';
  }
}

// ─── IMPORTAR META ────────────────────────────────────────────────────────────
async function handleMetaFile(input) {
  const file = input?.files?.[0] || input;
  if (!file) return;
  try {
    STATE.metaAds = await importarMetaCSV(file);
    try { localStorage.setItem('df_meta', JSON.stringify(STATE.metaAds)); } catch(e){}
    showToast(`✓ Meta Ads: ${STATE.metaAds.campanas.length} campañas`);
    showStatus('meta-import-status', `✓ ${STATE.metaAds.campanas.length} campañas cargadas`, 'ok');
    renderMeta();
  } catch(err) {
    showToast('❌ ' + err.message, 'error');
    showStatus('meta-import-status', '❌ ' + err.message, 'error');
  } finally {
    if (input?.value !== undefined) input.value='';
  }
}

// ─── DRAG & DROP GLOBAL ───────────────────────────────────────────────────────
function setupDragDrop() {
  // Crear overlay de drop global
  const overlay = document.createElement('div');
  overlay.id = 'drop-overlay';
  overlay.innerHTML = `
    <div class="drop-box">
      <div class="drop-icon">📂</div>
      <div class="drop-title">Suelta el archivo aquí</div>
      <div class="drop-sub">Excel de Dropi o CSV de Meta Ads</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Insertar zonas de drop visibles en config
  insertDropZone('dropi-import-section', 'dropi');
  insertDropZone('meta-import-section', 'meta');

  // Eventos drag globales
  let dragCounter = 0;
  document.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('visible');
  });
  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter=0; overlay.classList.remove('visible'); }
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('visible');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    routeFile(file);
  });

  // Drop en zonas específicas
  document.querySelectorAll('.drop-zone').forEach(zone => {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (zone.dataset.tipo === 'dropi') handleDropiFile(file);
      else handleMetaFile(file);
    });
    zone.addEventListener('click', () => {
      const input = zone.dataset.tipo==='dropi' ? $('input-dropi-file') : $('input-meta-file');
      if (input) input.click();
    });
  });
}

function insertDropZone(sectionId, tipo) {
  // Reemplazar el botón de importar con una drop zone elegante
  const section = $(sectionId);
  if (!section) return;
  const row = section.querySelector('.config-row');
  if (!row) return;
  const label = tipo==='dropi'
    ? '📊 Excel de Dropi'
    : '📈 CSV de Meta Ads';
  const zone = document.createElement('div');
  zone.className = 'drop-zone';
  zone.dataset.tipo = tipo;
  zone.innerHTML = `
    <div class="drop-zone-icon">${tipo==='dropi'?'📊':'📈'}</div>
    <div class="drop-zone-title">Arrastra ${label} aquí</div>
    <div class="drop-zone-sub">o haz clic para buscar el archivo</div>
  `;
  row.parentNode.insertBefore(zone, row);
  row.style.display = 'none'; // ocultar el botón viejo
}

function routeFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) handleDropiFile(file);
  else if (name.endsWith('.csv')) handleMetaFile(file);
  else showToast('❌ Formato no reconocido. Usa .xlsx o .csv', 'error');
}

// ─── TRIGGER FILE INPUT ────────────────────────────────────────────────────────
function triggerFileInput(id) {
  const el = $(id);
  if (el) el.click();
}

// ─── FILTROS FECHA (topbar) ───────────────────────────────────────────────────
function changePeriod(val) {
  if (val === 'custom') return;
  const hoy = new Date();
  const fmt  = d => d.toISOString().split('T')[0];
  if (val === 'hoy') {
    STATE.filtroDesde = STATE.filtroHasta = fmt(hoy);
  } else if (val === 'semana') {
    const lun = new Date(hoy); lun.setDate(hoy.getDate()-hoy.getDay()+1);
    STATE.filtroDesde = fmt(lun); STATE.filtroHasta = fmt(hoy);
  } else if (val === 'mes') {
    STATE.filtroDesde = fmt(new Date(hoy.getFullYear(),hoy.getMonth(),1));
    STATE.filtroHasta = fmt(hoy);
  } else {
    STATE.filtroDesde = STATE.filtroHasta = '';
  }
  renderDashboard(); renderPedidos();
}

// Date picker (stubs que llaman a changePeriod)
function toggleDatePicker() {
  const pp = $('dp-popup');
  if (pp) pp.classList.toggle('open');
}
function dpNavMonth() {}
function dpApply() {
  const from = $('dp-from-field')?.dataset.val || '';
  const to   = $('dp-until-field')?.dataset.val || '';
  STATE.filtroDesde = from; STATE.filtroHasta = to;
  toggleDatePicker();
  renderDashboard(); renderPedidos();
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
function saveParams() {
  const tasa  = parseFloat($('param-tasa')?.value);
  const envio = parseFloat($('param-envio')?.value);
  if (!isNaN(tasa))  STATE.tasaEntrega = tasa;
  if (!isNaN(envio)) STATE.costoEnvio  = envio;
  try { localStorage.setItem('df_config', JSON.stringify({tasaEntrega:STATE.tasaEntrega,costoEnvio:STATE.costoEnvio})); } catch(e){}
  showToast('✓ Configuración guardada');
  if (STATE.pedidos.length) renderDashboard();
}

function connectDropi() { showToast('Conexión via token próximamente', 'ok'); }
function connectMeta()   { showToast('Conexión via API próximamente', 'ok'); }

// ─── CHARTS (stub — dropflow-charts.js lo implementa) ────────────────────────
function renderCharts() {
  if (window.DropflowCharts) {
    const filtrados = filtrarPorFecha(STATE.pedidos, STATE.filtroDesde, STATE.filtroHasta);
    const R = calcularResumen(filtrados, STATE.tasaEntrega);
    window.DropflowCharts.render(R, filtrados);
  }
}

// ─── SIMULADOR PROYECCIÓN ─────────────────────────────────────────────────────
function updateSimulator() {
  const tasa    = parseInt($('sim-tasa')?.value   || 75);
  const precio  = parseInt($('sim-precio')?.value || 25000);
  const pedidos = parseInt($('sim-pedidos')?.value|| 100);
  setText('sim-tasa-val',    tasa+'%');
  setText('sim-precio-val',  fmtCLP(precio));
  setText('sim-pedidos-val', pedidos);
  const R = STATE.pedidos.length ? calcularResumen(STATE.pedidos, STATE.tasaEntrega) : null;
  const margen = R ? R.margenReal/100 : 0.47;
  const entregados  = Math.round(pedidos * tasa/100);
  const utilProy    = entregados * precio * margen;
  const utilReal    = R ? R.utilidadReal : 0;
  setText('proj-real',  fmtCLP(utilReal));
  setText('proj-pend',  fmtCLP(utilProy));
  setText('proj-total', fmtCLP(utilReal + utilProy));
}

// ─── REFRESH ──────────────────────────────────────────────────────────────────
function refreshData() {
  if (STATE.pedidos.length) { renderDashboard(); renderPedidos(); renderCharts(); }
  showToast('✓ Datos actualizados');
}
function scheduleRefresh() {}

// ─── COSTOS PANEL (toggle) ────────────────────────────────────────────────────
let _costosOpen = false;
function toggleCostosPanel() {
  _costosOpen = !_costosOpen;
  const panel = $('costos-panel');
  const arrow = $('costos-arrow');
  if (panel) panel.style.display = _costosOpen ? 'block' : 'none';
  if (arrow) arrow.textContent   = _costosOpen ? '▲' : '▼';
}
function renderCostosPanel() { /* implementado en renderDashboard */ }

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
function cargarLocal() {
  try {
    const p = localStorage.getItem('df_pedidos');
    if (p) STATE.pedidos = JSON.parse(p);
    const m = localStorage.getItem('df_meta');
    if (m) STATE.metaAds = JSON.parse(m);
    const c = localStorage.getItem('df_config');
    if (c) { const cfg=JSON.parse(c); STATE.tasaEntrega=cfg.tasaEntrega||75; STATE.costoEnvio=cfg.costoEnvio||6000; }
    if ($('param-tasa'))  $('param-tasa').value  = STATE.tasaEntrega;
    if ($('param-envio')) $('param-envio').value = STATE.costoEnvio;
  } catch(e) {}
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  // Fecha topbar
  const dateBadge = $('date-badge');
  if (dateBadge) dateBadge.textContent = new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'});

  // Estado sync
  setText('sync-label', 'Sin datos');

  // Cargar locales
  cargarLocal();

  // Drag & drop
  setupDragDrop();

  // Render inicial
  if (STATE.pedidos.length) {
    renderDashboard();
    renderPedidos();
    setText('sync-label', 'Datos cargados');
    const dot = $('sync-dot');
    if (dot) dot.style.background = 'var(--green)';
  } else {
    renderPedidos(); // muestra empty state
  }
  if (STATE.metaAds) renderMeta();
}

// Estilos para drag & drop y toast
(function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    /* Toast */
    .df-toast {
      position:fixed;bottom:24px;right:24px;z-index:9999;
      padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;
      opacity:0;transform:translateY(8px);transition:all 0.25s ease;pointer-events:none;
      max-width:320px;
    }
    .df-toast.show { opacity:1;transform:translateY(0); }
    .df-toast.toast-ok  { background:#1a2e1a;color:#4ade80;border:1px solid rgba(74,222,128,0.2); }
    .df-toast.toast-err { background:#2e1a1a;color:#f87171;border:1px solid rgba(248,113,113,0.2); }

    /* Drop overlay global */
    #drop-overlay {
      position:fixed;inset:0;z-index:9000;
      background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;
      opacity:0;pointer-events:none;transition:opacity 0.2s;
    }
    #drop-overlay.visible { opacity:1;pointer-events:all; }
    .drop-box {
      text-align:center;padding:48px 64px;border-radius:20px;
      border:2px dashed rgba(255,255,255,0.3);background:rgba(255,255,255,0.05);
    }
    .drop-icon { font-size:48px;margin-bottom:16px; }
    .drop-title { font-size:20px;font-weight:700;color:#fff;margin-bottom:8px; }
    .drop-sub { font-size:13px;color:rgba(255,255,255,0.5); }

    /* Drop zones en config */
    .drop-zone {
      border:2px dashed var(--border);border-radius:12px;
      padding:28px;text-align:center;cursor:pointer;
      transition:all 0.2s;margin-bottom:12px;
    }
    .drop-zone:hover, .drop-zone.drag-over {
      border-color:var(--purple);background:var(--bg3);
    }
    .drop-zone-icon { font-size:28px;margin-bottom:8px; }
    .drop-zone-title { font-size:14px;font-weight:600;color:var(--text1);margin-bottom:4px; }
    .drop-zone-sub { font-size:11px;color:var(--text3); }

    /* Status items */
    .status-item { display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border); }
    .status-item:last-child { border-bottom:none; }
    .status-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
    .status-label { flex:1;font-size:12px;color:var(--text2); }
    .status-val { font-size:16px;font-weight:700; }

    /* Badges tabla */
    .badge { padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;white-space:nowrap; }
    .badge-green  { background:var(--green-bg,rgba(34,197,94,0.1));color:var(--green); }
    .badge-blue   { background:var(--blue-bg,rgba(59,130,246,0.1));color:var(--blue2); }
    .badge-yellow { background:var(--amber-bg,rgba(245,158,11,0.1));color:var(--amber); }
    .badge-red    { background:var(--red-bg,rgba(239,68,68,0.1));color:var(--red); }
    .badge-gray   { background:var(--bg3);color:var(--text3); }
  `;
  document.head.appendChild(s);
})();
