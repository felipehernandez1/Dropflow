// dropflow-app.js — Lógica principal del dashboard Dropflow
// Conecta importación → estado → UI

// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
const APP = {
  pedidos:    [],   // todos los pedidos importados
  metaAds:    null, // datos Meta Ads
  filtroDesde: '',
  filtroHasta: '',
  filtroEstado: 'todos',
  config: {
    tasaEntrega:   75,
    costoEnvio:    6000,
    costoOp:       0,
  },
};

// Hacerlo accesible para import.js
window.appConfig = APP.config;

// ─── HELPERS UI ───────────────────────────────────────────────────────────────
const { formatCLP, formatPct, calcularResumen, filtrarPorFecha,
        agruparPorFecha, agruparPorCiudad, importarDropiExcel,
        importarMetaCSV, ESTADOS } = window.DropflowImport;

function el(id) { return document.getElementById(id); }

function mostrarToast(msg, tipo = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function setTexto(id, val) {
  const e = el(id);
  if (e) e.textContent = val;
}

// ─── RENDERIZAR DASHBOARD (RESUMEN) ──────────────────────────────────────────
function renderizarResumen() {
  const pedidosFiltrados = filtrarPorFecha(APP.pedidos, APP.filtroDesde, APP.filtroHasta);
  const R = calcularResumen(pedidosFiltrados);

  // KPIs principales
  setTexto('kpi-ingresos',    formatCLP(R.ingresosReales));
  setTexto('kpi-ingresos-sub', `${R.entregados} pedidos entregados`);

  setTexto('kpi-costos',     formatCLP(R.costosTotal));
  setTexto('kpi-costos-sub', 'Prov + flete + comisión');

  setTexto('kpi-util-proy',  formatCLP(R.proyUtilidad));
  setTexto('kpi-util-proy-sub', `${R.pendientes + R.enTransito} pend. × ${APP.config.tasaEntrega}%`);

  setTexto('kpi-utilidad',   formatCLP(R.utilidadReal));
  setTexto('kpi-margen',     `Margen: ${formatPct(R.margenReal)}`);

  // Distribución de costos
  const totalCostos = R.costosTotal || 1;
  setTexto('dist-proveedor', formatPct(R.costoProveedor / totalCostos * 100));
  setTexto('dist-flete',     formatPct(R.costoFlete     / totalCostos * 100));
  setTexto('dist-comision',  formatPct(R.costoComision  / totalCostos * 100));

  // Estado de pedidos
  setTexto('estado-total',       R.total);
  setTexto('estado-entregados',  R.entregados);
  setTexto('estado-transito',    R.enTransito);
  setTexto('estado-pendientes',  R.pendientes);
  setTexto('estado-devoluciones',R.devoluciones);
  setTexto('estado-cancelados',  R.cancelados);
  setTexto('tasa-entrega',       formatPct(R.tasaReal));

  // Utilidad consolidada
  setTexto('util-real',    formatCLP(R.utilidadReal));
  setTexto('util-pend',    formatCLP(R.proyUtilidad));
  setTexto('util-total',   formatCLP(R.utilidadTotal));
  setTexto('util-margen',  formatPct(R.margenReal));

  // Actualizar gráficos si existen
  if (window.DropflowCharts) {
    const porFecha  = agruparPorFecha(pedidosFiltrados.filter(p => p.estado === 'entregado'));
    const porCiudad = agruparPorCiudad(pedidosFiltrados);
    window.DropflowCharts.actualizarTodos(R, porFecha, porCiudad);
  }
}

// ─── RENDERIZAR TABLA DE PEDIDOS ─────────────────────────────────────────────
function renderizarPedidos() {
  const tabla = el('tabla-pedidos');
  if (!tabla) return;

  let pedidos = filtrarPorFecha(APP.pedidos, APP.filtroDesde, APP.filtroHasta);

  // Filtro por estado
  if (APP.filtroEstado !== 'todos') {
    pedidos = pedidos.filter(p => p.estado === APP.filtroEstado);
  }

  if (!pedidos.length) {
    tabla.innerHTML = '<tr><td colspan="10" class="empty">No hay pedidos para mostrar</td></tr>';
    return;
  }

  const BADGE = {
    entregado:  'badge-green',
    transito:   'badge-blue',
    pendiente:  'badge-yellow',
    devolucion: 'badge-red',
    cancelado:  'badge-gray',
    otro:       'badge-gray',
  };

  tabla.innerHTML = pedidos.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.fecha}</td>
      <td>${p.producto}</td>
      <td><span class="badge ${BADGE[p.estado] || 'badge-gray'}">${p.estadoRaw}</span></td>
      <td>${formatCLP(p.venta)}</td>
      <td>${formatCLP(p.proveedor)}</td>
      <td>${formatCLP(p.flete)}</td>
      <td>${formatCLP(p.comision)}</td>
      <td class="${p.utilidad >= 0 ? 'positivo' : 'negativo'}">${formatCLP(p.utilidad)}</td>
      <td>${p.ciudad}</td>
    </tr>
  `).join('');
}

// ─── MANEJAR IMPORTACIÓN DROPI ────────────────────────────────────────────────
async function manejarArchivoDropi(file) {
  if (!file) return;

  const btn = el('btn-importar-dropi');
  const label = el('label-dropi');
  if (btn) btn.disabled = true;
  if (label) label.textContent = 'Procesando...';

  try {
    const pedidos = await importarDropiExcel(file);
    APP.pedidos = pedidos;

    // Guardar en localStorage para persistencia
    try {
      localStorage.setItem('dropflow_pedidos', JSON.stringify(pedidos));
      localStorage.setItem('dropflow_pedidos_fecha', new Date().toISOString());
    } catch(e) { /* localStorage lleno, ignorar */ }

    mostrarToast(`✓ ${pedidos.length} pedidos importados correctamente`);
    renderizarResumen();
    renderizarPedidos();

    // Mostrar info en configuración
    const info = el('dropi-info');
    if (info) {
      const R = calcularResumen(pedidos);
      info.innerHTML = `
        <div class="import-success">
          <strong>✓ Dropi conectado</strong><br>
          ${pedidos.length} pedidos · ${R.entregados} entregados · ${formatCLP(R.utilidadReal)} utilidad real
        </div>
      `;
    }

  } catch (err) {
    mostrarToast('❌ ' + err.message, 'error');
    console.error(err);
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = '📂 Seleccionar archivo Excel de Dropi';
  }
}

// ─── MANEJAR IMPORTACIÓN META ADS ─────────────────────────────────────────────
async function manejarArchivoMeta(file) {
  if (!file) return;

  try {
    const meta = await importarMetaCSV(file);
    APP.metaAds = meta;

    try {
      localStorage.setItem('dropflow_meta', JSON.stringify(meta));
    } catch(e) {}

    mostrarToast(`✓ Meta Ads importado: ${meta.campanas.length} campañas`);
    renderizarMeta();

  } catch (err) {
    mostrarToast('❌ ' + err.message, 'error');
    console.error(err);
  }
}

// ─── RENDERIZAR META ADS ──────────────────────────────────────────────────────
function renderizarMeta() {
  const meta = APP.metaAds;
  if (!meta) return;

  setTexto('meta-gasto',       formatCLP(meta.gastoTotal));
  setTexto('meta-impresiones', meta.impresiones.toLocaleString('es-CL'));
  setTexto('meta-ctr',         formatPct(meta.ctr));

  // ROAS: ingresos reales / gasto ads
  const R = APP.pedidos.length ? calcularResumen(APP.pedidos) : null;
  const roas = R && meta.gastoTotal > 0 ? R.ingresosReales / meta.gastoTotal : 0;
  setTexto('meta-roas', roas.toFixed(2) + 'x');

  // Tabla campañas
  const tabla = el('tabla-campanas');
  if (tabla && meta.campanas.length) {
    tabla.innerHTML = meta.campanas.map(c => `
      <tr>
        <td>${c.nombre || 'Sin nombre'}</td>
        <td>${formatCLP(c.gasto)}</td>
        <td>${c.impresiones.toLocaleString('es-CL')}</td>
        <td>${c.clics.toLocaleString('es-CL')}</td>
        <td>${c.compras}</td>
        <td>${c.gasto > 0 && c.compras > 0 ? formatCLP(c.gasto / c.compras) : '-'}</td>
      </tr>
    `).join('');
  }
}

// ─── FILTROS ──────────────────────────────────────────────────────────────────
function aplicarFiltroFecha(periodo) {
  const hoy = new Date();
  const fmt  = d => d.toISOString().split('T')[0];

  if (periodo === 'hoy') {
    APP.filtroDesde = APP.filtroHasta = fmt(hoy);
  } else if (periodo === 'semana') {
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - hoy.getDay() + 1);
    APP.filtroDesde = fmt(lunes);
    APP.filtroHasta = fmt(hoy);
  } else if (periodo === 'mes') {
    APP.filtroDesde = fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    APP.filtroHasta = fmt(hoy);
  } else {
    APP.filtroDesde = '';
    APP.filtroHasta = '';
  }

  renderizarResumen();
  renderizarPedidos();
}

function aplicarFiltroEstado(estado) {
  APP.filtroEstado = estado;
  renderizarPedidos();
}

function aplicarFiltroPersonalizado() {
  const desde = el('filtro-desde');
  const hasta  = el('filtro-hasta');
  APP.filtroDesde = desde?.value || '';
  APP.filtroHasta = hasta?.value  || '';
  renderizarResumen();
  renderizarPedidos();
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
function guardarConfig() {
  const tasa = parseFloat(el('config-tasa')?.value);
  const op   = parseFloat(el('config-op')?.value);

  if (!isNaN(tasa)) APP.config.tasaEntrega = tasa;
  if (!isNaN(op))   APP.config.costoOp     = op;
  window.appConfig = APP.config;

  try {
    localStorage.setItem('dropflow_config', JSON.stringify(APP.config));
  } catch(e) {}

  mostrarToast('✓ Configuración guardada');
  if (APP.pedidos.length) renderizarResumen();
}

// ─── PERSISTENCIA ─────────────────────────────────────────────────────────────
function cargarDesdePersistencia() {
  try {
    const pedidos = localStorage.getItem('dropflow_pedidos');
    if (pedidos) {
      APP.pedidos = JSON.parse(pedidos);
      const fecha = localStorage.getItem('dropflow_pedidos_fecha');
      const info  = el('dropi-ultima-carga');
      if (info && fecha) {
        info.textContent = 'Última carga: ' + new Date(fecha).toLocaleString('es-CL');
      }
    }

    const meta = localStorage.getItem('dropflow_meta');
    if (meta) APP.metaAds = JSON.parse(meta);

    const config = localStorage.getItem('dropflow_config');
    if (config) {
      Object.assign(APP.config, JSON.parse(config));
      window.appConfig = APP.config;
    }

    if (APP.pedidos.length) {
      renderizarResumen();
      renderizarPedidos();
    }
    if (APP.metaAds) renderizarMeta();

  } catch(e) {
    console.warn('No se pudo restaurar datos previos:', e);
  }
}

// ─── EVENTOS ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Input Dropi
  const inputDropi = el('input-dropi') || el('dropi-file');
  if (inputDropi) {
    inputDropi.addEventListener('change', e => manejarArchivoDropi(e.target.files[0]));
  }

  // Input Meta Ads
  const inputMeta = el('input-meta') || el('meta-file');
  if (inputMeta) {
    inputMeta.addEventListener('change', e => manejarArchivoMeta(e.target.files[0]));
  }

  // Botones filtro fecha
  ['hoy', 'semana', 'mes', 'todos'].forEach(periodo => {
    const btn = el(`filtro-${periodo}`);
    if (btn) btn.addEventListener('click', () => {
      document.querySelectorAll('.filtro-fecha-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aplicarFiltroFecha(periodo);
    });
  });

  // Filtro personalizado
  const btnFiltro = el('btn-filtro-custom');
  if (btnFiltro) btnFiltro.addEventListener('click', aplicarFiltroPersonalizado);

  // Filtros de estado en tabla
  document.querySelectorAll('[data-estado]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-estado]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aplicarFiltroEstado(btn.dataset.estado);
    });
  });

  // Config
  const btnConfig = el('btn-guardar-config');
  if (btnConfig) btnConfig.addEventListener('click', guardarConfig);

  // Cargar datos previos
  cargarDesdePersistencia();

  // Mostrar placeholder si no hay datos
  if (!APP.pedidos.length) {
    const tabla = el('tabla-pedidos');
    if (tabla) {
      tabla.innerHTML = '<tr><td colspan="10" class="empty">Importa un Excel de Dropi para ver tus pedidos</td></tr>';
    }
  }
});

// Exportar para uso externo
window.DropflowApp = {
  APP,
  renderizarResumen,
  renderizarPedidos,
  aplicarFiltroFecha,
  aplicarFiltroEstado,
};
