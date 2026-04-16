// dropflow-charts.js — Sincronizado con STATE.pedidos (dropflow-app.js)

let _charts = {};

function _destroy(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

const C = {
  green:'#00d68f', red:'#f43f5e', amber:'#f59e0b',
  purple:'#8b5cf6', blue:'#3b82f6', cyan:'#06b6d4',
};

const TOOLTIP = {
  backgroundColor:'#111827', borderColor:'rgba(255,255,255,0.08)', borderWidth:1,
  titleColor:'#f0f4ff', bodyColor:'#8899bb',
  titleFont:{family:'Outfit',size:12,weight:'600'},
  bodyFont:{family:'JetBrains Mono',size:11},
  padding:12, cornerRadius:8,
};

const SCALES = {
  x:{
    ticks:{color:'#4a5a7a',font:{family:'JetBrains Mono',size:9}},
    grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},
    border:{color:'rgba(255,255,255,0.06)'},
  },
  y:{
    ticks:{
      color:'#4a5a7a',font:{family:'JetBrains Mono',size:9},
      callback: v=>'$'+(Math.abs(v)>=1000?Math.round(v/1000)+'K':v),
    },
    grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},
    border:{color:'rgba(255,255,255,0.06)',dash:[4,4]},
  }
};

// ── 1. BARRAS: Ventas · Costos · Utilidad por día ──────────────────────────
function renderBarras(pedidos) {
  const canvas = document.getElementById('chart-barras');
  if (!canvas) return;
  _destroy('barras');

  // Agrupar por fecha (solo entregados para $$ reales)
  const m = {};
  pedidos.forEach(p => {
    const f = p.fecha || 'Sin fecha';
    if (!m[f]) m[f] = {venta:0,costo:0,utilidad:0};
    m[f].venta    += p.venta;
    m[f].costo    += p.proveedor + p.flete + p.comision;
    m[f].utilidad += p.utilidad;
  });

  const toISO = d => { const p=d.split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:d; };
  const fechas = Object.keys(m).sort((a,b)=>toISO(a).localeCompare(toISO(b))).slice(-14);
  const labels  = fechas.map(f => { const p=f.split('-'); return p.length===3?`${p[0]}/${p[1]}`:f; });

  const ctx = canvas.getContext('2d');
  const gV = ctx.createLinearGradient(0,0,0,300);
  gV.addColorStop(0,'rgba(0,214,143,0.85)'); gV.addColorStop(1,'rgba(0,214,143,0.3)');
  const gC = ctx.createLinearGradient(0,0,0,300);
  gC.addColorStop(0,'rgba(244,63,94,0.85)'); gC.addColorStop(1,'rgba(244,63,94,0.3)');
  const gU = ctx.createLinearGradient(0,0,0,300);
  gU.addColorStop(0,'rgba(245,158,11,0.85)'); gU.addColorStop(1,'rgba(245,158,11,0.3)');

  _charts.barras = new Chart(canvas, {
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Ventas',   data:fechas.map(f=>m[f].venta),    backgroundColor:gV, borderColor:C.green,  borderWidth:1, borderRadius:{topLeft:4,topRight:4}, borderSkipped:false},
        {label:'Costos',   data:fechas.map(f=>m[f].costo),    backgroundColor:gC, borderColor:C.red,    borderWidth:1, borderRadius:{topLeft:4,topRight:4}, borderSkipped:false},
        {label:'Utilidad', data:fechas.map(f=>m[f].utilidad), backgroundColor:gU, borderColor:C.amber,  borderWidth:1, borderRadius:{topLeft:4,topRight:4}, borderSkipped:false},
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:800,easing:'easeInOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{labels:{color:'#8899bb',font:{family:'JetBrains Mono',size:10},padding:16,boxWidth:10,usePointStyle:true}},
        tooltip:{...TOOLTIP, callbacks:{label:c=>` ${c.dataset.label}: $${Math.round(c.raw).toLocaleString('es-CL')}`}},
      },
      scales:{...SCALES, x:{...SCALES.x,grid:{display:false}}},
    }
  });
}

// ── 2. ÁREA: Utilidad acumulada ────────────────────────────────────────────
function renderLinea(pedidos) {
  const canvas = document.getElementById('chart-linea');
  if (!canvas) return;
  _destroy('linea');

  const entregados = pedidos.filter(p=>p.estado==='entregado');
  const m = {};
  const toISO = d => { const p=d.split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:d; };
  entregados.forEach(p => {
    const f = p.fecha||'Sin fecha';
    if (!m[f]) m[f] = 0;
    m[f] += p.utilidad;
  });

  const fechas = Object.keys(m).sort((a,b)=>toISO(a).localeCompare(toISO(b))).slice(-20);
  let acum = 0;
  const acumulado = fechas.map(f => { acum += m[f]; return acum; });
  const diario    = fechas.map(f => m[f]);
  const labels    = fechas.map(f => { const p=f.split('-'); return p.length===3?`${p[0]}/${p[1]}`:f; });

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0,'rgba(0,214,143,0.25)');
  grad.addColorStop(1,'rgba(0,214,143,0.01)');

  _charts.linea = new Chart(canvas, {
    type:'line',
    data:{
      labels,
      datasets:[
        {
          label:'Acumulada', data:acumulado,
          borderColor:C.green, backgroundColor:grad, borderWidth:2.5,
          fill:true, tension:0.4, pointRadius:3,
          pointBackgroundColor:C.green, pointBorderColor:'#111827', pointBorderWidth:2, pointHoverRadius:6,
        },
        {
          label:'Diaria', data:diario,
          borderColor:C.amber, backgroundColor:'transparent', borderWidth:1.5,
          borderDash:[5,3], fill:false, tension:0.4,
          pointRadius:2, pointBackgroundColor:C.amber, pointHoverRadius:5,
        }
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      animation:{duration:800,easing:'easeInOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{labels:{color:'#8899bb',font:{family:'JetBrains Mono',size:10},padding:16,boxWidth:10,usePointStyle:true}},
        tooltip:{...TOOLTIP, callbacks:{label:c=>` ${c.dataset.label}: $${Math.round(c.raw).toLocaleString('es-CL')}`}},
      },
      scales:SCALES,
    }
  });
}

// ── 3. DONUT: Estados ──────────────────────────────────────────────────────
function renderDonut(R) {
  const canvas = document.getElementById('chart-donut');
  if (!canvas) return;
  _destroy('donut');

  const data   = [R.entregados, R.enTransito, R.pendientes, R.devueltos, R.cancelados];
  const colors = [C.green, C.blue, C.amber, C.red, '#4a5a7a'];
  const labels = ['Entregado','En tránsito','Pendiente','Devuelto','Cancelado'];

  _charts.donut = new Chart(canvas, {
    type:'doughnut',
    data:{
      labels,
      datasets:[{
        data, backgroundColor:colors.map(c=>c+'cc'),
        borderColor:colors, borderWidth:2, hoverOffset:12, borderRadius:4,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'68%',
      animation:{duration:800,animateRotate:true},
      plugins:{
        legend:{position:'bottom',labels:{color:'#8899bb',font:{family:'JetBrains Mono',size:10},padding:12,boxWidth:8,usePointStyle:true}},
        tooltip:{...TOOLTIP, callbacks:{label:c=>` ${c.label}: ${c.raw} (${R.total>0?Math.round(c.raw/R.total*100):0}%)`}},
      }
    }
  });
}

// ── 4. BARRAS HORIZ: Top ciudades ──────────────────────────────────────────
function renderCiudades(pedidos) {
  const canvas = document.getElementById('chart-hex');
  if (!canvas) return;
  _destroy('ciudades');

  const m = {};
  pedidos.filter(p=>p.estado==='entregado').forEach(p => {
    const c = p.ciudad||'Sin ciudad';
    if (!m[c]) m[c] = 0;
    m[c] += p.venta;
  });

  const top = Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (!top.length) return;

  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(300,0,0,0);
  grad.addColorStop(0,'rgba(0,214,143,0.9)');
  grad.addColorStop(1,'rgba(6,182,212,0.5)');

  _charts.ciudades = new Chart(canvas, {
    type:'bar',
    data:{
      labels:top.map(([c])=>c),
      datasets:[{
        label:'Ventas', data:top.map(([,v])=>v),
        backgroundColor:grad, borderColor:C.green,
        borderWidth:1, borderRadius:4, borderSkipped:false,
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      animation:{duration:800},
      plugins:{
        legend:{display:false},
        tooltip:{...TOOLTIP, callbacks:{label:c=>` $${Math.round(c.raw).toLocaleString('es-CL')}`}},
      },
      scales:{
        x:{
          ticks:{color:'#4a5a7a',font:{family:'JetBrains Mono',size:9},callback:v=>'$'+Math.round(v/1000)+'K'},
          grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},
          border:{color:'rgba(255,255,255,0.06)',dash:[4,4]},
        },
        y:{
          ticks:{color:'#8899bb',font:{family:'JetBrains Mono',size:10}},
          grid:{display:false}, border:{display:false},
        }
      }
    }
  });
}

// ── RENDER TODOS (llamado desde dropflow-app.js) ───────────────────────────
function renderCharts() {
  // Obtener pedidos desde STATE global (definido en dropflow-app.js)
  const pedidos = (window.STATE && window.STATE.pedidos) ? window.STATE.pedidos : [];
  const R = pedidos.length
    ? calcularResumen(filtrarPorFecha(pedidos, window.STATE.filtroDesde, window.STATE.filtroHasta), window.STATE.tasaEntrega)
    : { entregados:0, enTransito:0, pendientes:0, devueltos:0, cancelados:0, total:0 };

  const filtrados = filtrarPorFecha(pedidos, window.STATE?.filtroDesde, window.STATE?.filtroHasta);

  renderBarras(filtrados);
  renderLinea(filtrados);
  renderDonut(R);
  renderCiudades(filtrados);
}

// Alias para compatibilidad con llamadas desde el HTML
window.initCharts = renderCharts;
window.DropflowCharts = { render: renderCharts };
