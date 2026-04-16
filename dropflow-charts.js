// ================================================
// DROPFLOW CHARTS — Modern Premium Visualizations
// Chart.js + Canvas 2D custom effects
// ================================================

let _chartInstances = {};

function destroyChart(id) {
  if (_chartInstances[id]) {
    _chartInstances[id].destroy();
    delete _chartInstances[id];
  }
}

function getChartColors() {
  return {
    green:  '#00d68f',
    red:    '#f43f5e',
    amber:  '#f59e0b',
    purple: '#8b5cf6',
    blue:   '#3b82f6',
    cyan:   '#06b6d4',
    greenBg:  'rgba(0,214,143,0.15)',
    redBg:    'rgba(244,63,94,0.15)',
    amberBg:  'rgba(245,158,11,0.15)',
    purpleBg: 'rgba(139,92,246,0.15)',
  };
}

function chartDefaults() {
  const C = getChartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 800, easing: 'easeInOutQuart' },
    plugins: {
      legend: {
        labels: {
          color: '#8899bb',
          font: { family: 'JetBrains Mono', size: 10 },
          padding: 16,
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
        }
      },
      tooltip: {
        backgroundColor: '#111827',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleColor: '#f0f4ff',
        bodyColor: '#8899bb',
        titleFont: { family: 'Outfit', size: 12, weight: '600' },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
      }
    },
    scales: {
      x: {
        ticks: { color: '#4a5a7a', font: { family: 'JetBrains Mono', size: 9 } },
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        border: { color: 'rgba(255,255,255,0.06)' },
      },
      y: {
        ticks: {
          color: '#4a5a7a',
          font: { family: 'JetBrains Mono', size: 9 },
          callback: v => '$' + (Math.abs(v) >= 1000 ? Math.round(v/1000)+'K' : v),
        },
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        border: { color: 'rgba(255,255,255,0.06)', dash: [4,4] },
      }
    }
  };
}

// =============================================
// 1. BARRAS — Ventas, Costos, Utilidad por día
// =============================================
function renderChartBarras() {
  const canvas = document.getElementById('chart-barras');
  if (!canvas) return;
  destroyChart('barras');

  const C = getChartColors();
  const byDate = {};
  ALL_ORDERS.forEach(o => {
    const d = (o.fecha||'').substring(0,10);
    if (!d) return;
    if (!byDate[d]) byDate[d] = { venta:0, costo:0, utilidad:0 };
    byDate[d].venta    += o.venta||0;
    byDate[d].costo    += (o.proveedor||0)+(o.envio||0)+(o.ads||0);
    byDate[d].utilidad += (o.venta||0)-(o.proveedor||0)-(o.envio||0)-(o.ads||0);
  });

  const fechas = Object.keys(byDate).sort().slice(-14);
  const labels = fechas.map(f => f.substring(5));

  const ctx = canvas.getContext('2d');
  
  // Gradientes
  const gVenta = ctx.createLinearGradient(0,0,0,300);
  gVenta.addColorStop(0, 'rgba(0,214,143,0.9)');
  gVenta.addColorStop(1, 'rgba(0,214,143,0.4)');

  const gCosto = ctx.createLinearGradient(0,0,0,300);
  gCosto.addColorStop(0, 'rgba(244,63,94,0.9)');
  gCosto.addColorStop(1, 'rgba(244,63,94,0.4)');

  const gUtil = ctx.createLinearGradient(0,0,0,300);
  gUtil.addColorStop(0, 'rgba(245,158,11,0.9)');
  gUtil.addColorStop(1, 'rgba(245,158,11,0.4)');

  const cfg = chartDefaults();
  cfg.plugins.tooltip.callbacks = {
    label: ctx => ` ${ctx.dataset.label}: $${Math.round(ctx.raw).toLocaleString('es-CL')}`
  };

  _chartInstances.barras = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ventas',
          data: fechas.map(f => byDate[f].venta),
          backgroundColor: gVenta,
          borderColor: C.green,
          borderWidth: 1,
          borderRadius: { topLeft:4, topRight:4 },
          borderSkipped: false,
        },
        {
          label: 'Costos',
          data: fechas.map(f => byDate[f].costo),
          backgroundColor: gCosto,
          borderColor: C.red,
          borderWidth: 1,
          borderRadius: { topLeft:4, topRight:4 },
          borderSkipped: false,
        },
        {
          label: 'Utilidad',
          data: fechas.map(f => byDate[f].utilidad),
          backgroundColor: gUtil,
          borderColor: C.amber,
          borderWidth: 1,
          borderRadius: { topLeft:4, topRight:4 },
          borderSkipped: false,
        },
      ]
    },
    options: {
      ...cfg,
      interaction: { mode:'index', intersect:false },
      plugins: { ...cfg.plugins },
      scales: {
        ...cfg.scales,
        x: { ...cfg.scales.x, grid: { display:false } },
      }
    }
  });
}

// =============================================
// 2. ÁREA — Utilidad acumulada
// =============================================
function renderChartLinea() {
  const canvas = document.getElementById('chart-linea');
  if (!canvas) return;
  destroyChart('linea');

  const C = getChartColors();
  const byDate = {};
  ALL_ORDERS.filter(o=>o.estado==='entregado').forEach(o => {
    const d = (o.fecha||'').substring(0,10);
    if (!byDate[d]) byDate[d] = 0;
    byDate[d] += (o.venta||0)-(o.proveedor||0)-(o.envio||0)-(o.ads||0);
  });

  const fechas = Object.keys(byDate).sort().slice(-20);
  let acum = 0;
  const acumulado = fechas.map(f => { acum += byDate[f]; return acum; });
  const diario    = fechas.map(f => byDate[f]);

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0, 'rgba(0,214,143,0.25)');
  grad.addColorStop(1, 'rgba(0,214,143,0.01)');

  const cfg = chartDefaults();
  cfg.plugins.tooltip.callbacks = {
    label: c => ` ${c.dataset.label}: $${Math.round(c.raw).toLocaleString('es-CL')}`
  };

  _chartInstances.linea = new Chart(canvas, {
    type: 'line',
    data: {
      labels: fechas.map(f=>f.substring(5)),
      datasets: [
        {
          label: 'Acumulada',
          data: acumulado,
          borderColor: C.green,
          backgroundColor: grad,
          borderWidth: 2.5,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: C.green,
          pointBorderColor: '#111827',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
        },
        {
          label: 'Diaria',
          data: diario,
          borderColor: C.amber,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [5,3],
          fill: false,
          tension: 0.4,
          pointRadius: 2,
          pointBackgroundColor: C.amber,
          pointHoverRadius: 5,
        }
      ]
    },
    options: { ...cfg, interaction:{ mode:'index', intersect:false } }
  });
}

// =============================================
// 3. DONUT — Estados de pedidos
// =============================================
function renderChartDonut() {
  const canvas = document.getElementById('chart-donut');
  if (!canvas) return;
  destroyChart('donut');

  const C = getChartColors();
  const counts = {entregado:0,transito:0,pendiente:0,devuelto:0,cancelado:0};
  ALL_ORDERS.forEach(o => { if(counts[o.estado]!==undefined) counts[o.estado]++; });

  const data   = [counts.entregado,counts.transito,counts.pendiente,counts.devuelto,counts.cancelado];
  const colors = [C.green, C.blue, C.amber, C.red, '#4a5a7a'];
  const labels = ['Entregado','En tránsito','Pendiente','Devuelto','Cancelado'];

  _chartInstances.donut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        hoverOffset: 12,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration:800, animateRotate:true },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color:'#8899bb',
            font:{ family:'JetBrains Mono', size:10 },
            padding:12, boxWidth:8, boxHeight:8, usePointStyle:true
          }
        },
        tooltip: {
          backgroundColor:'#111827', borderColor:'rgba(255,255,255,0.08)',
          borderWidth:1, titleColor:'#f0f4ff', bodyColor:'#8899bb',
          titleFont:{family:'Outfit',size:12,weight:'600'},
          bodyFont:{family:'JetBrains Mono',size:11},
          padding:12, cornerRadius:8,
          callbacks: {
            label: c => ` ${c.label}: ${c.raw} (${Math.round(c.raw/ALL_ORDERS.length*100)}%)`
          }
        }
      }
    }
  });
}

// =============================================
// 4. BARRAS HORIZONTALES — Top ciudades
// =============================================
function renderChartCiudades() {
  const canvas = document.getElementById('chart-hex');
  if (!canvas) return;
  destroyChart('ciudades');

  const C = getChartColors();
  const byCiudad = {};
  ALL_ORDERS.filter(o=>o.estado==='entregado').forEach(o => {
    const c = o.ciudad||'?';
    if(!byCiudad[c]) byCiudad[c] = 0;
    byCiudad[c] += o.venta||0;
  });

  const top = Object.entries(byCiudad).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (!top.length) return;

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(300,0,0,0);
  grad.addColorStop(0, 'rgba(0,214,143,0.9)');
  grad.addColorStop(1, 'rgba(6,182,212,0.5)');

  _chartInstances.ciudades = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top.map(([c])=>c),
      datasets: [{
        label: 'Ventas',
        data: top.map(([,v])=>v),
        backgroundColor: grad,
        borderColor: C.green,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: { duration:800 },
      plugins: {
        legend: { display:false },
        tooltip: {
          backgroundColor:'#111827', borderColor:'rgba(255,255,255,0.08)',
          borderWidth:1, titleColor:'#f0f4ff', bodyColor:'#8899bb',
          titleFont:{family:'Outfit',size:12,weight:'600'},
          bodyFont:{family:'JetBrains Mono',size:11},
          padding:12, cornerRadius:8,
          callbacks: { label: c => ` $${Math.round(c.raw).toLocaleString('es-CL')}` }
        }
      },
      scales: {
        x: {
          ticks:{ color:'#4a5a7a', font:{family:'JetBrains Mono',size:9}, callback:v=>'$'+Math.round(v/1000)+'K' },
          grid: { color:'rgba(255,255,255,0.04)', drawBorder:false },
          border:{ color:'rgba(255,255,255,0.06)', dash:[4,4] },
        },
        y: {
          ticks:{ color:'#8899bb', font:{family:'JetBrains Mono',size:10} },
          grid: { display:false },
          border:{ display:false },
        }
      }
    }
  });
}

// =============================================
// INIT
// =============================================
function initCharts() {
  renderChartBarras();
  renderChartLinea();
  renderChartDonut();
  renderChartCiudades();
}
