// dropflow-import.js
// Columnas verificadas contra exportación real de Dropi (abril 2026)

const DROPI_ESTADOS = {
  entregado: ['ENTREGADO'],
  transito:  ['EN REPARTO','EN_REPARTO','EN TRANSITO','EN TRÁNSITO',
              'GUIA_GENERADA','EN ESPERA EN OFICINA','NOVEDAD'],
  pendiente: ['PENDIENTE CONFIRMACION'],
  devuelto:  ['DEVOLUCION','EN DEVOLUCIÓN','EN DEVOLUCION'],
  cancelado: ['CANCELADO'],
};

function clasificarEstado(raw) {
  const s = (raw || '').toString().trim().toUpperCase();
  for (const [tipo, lista] of Object.entries(DROPI_ESTADOS)) {
    if (lista.includes(s)) return tipo;
  }
  return 'otro';
}

function parsearFilaDropi(fila) {
  // IMPORTANTE: VALOR FACTURADO siempre viene vacío en Dropi.
  // El precio de venta real está en VALOR DE COMPRA EN PRODUCTOS.
  const venta     = parseFloat(fila['VALOR DE COMPRA EN PRODUCTOS']) || 0;
  const proveedor = parseFloat(fila['TOTAL EN PRECIOS DE PROVEEDOR']) || 0;
  const flete     = parseFloat(fila['PRECIO FLETE']) || 0;
  const comision  = parseFloat(fila['COMISION']) || 0;
  const devFlete  = parseFloat(fila['COSTO DEVOLUCION FLETE']) || 0;
  let   utilidad  = parseFloat(fila['GANANCIA']);
  if (isNaN(utilidad)) utilidad = venta - proveedor - flete - comision - devFlete;

  const estadoRaw = (fila['ESTATUS'] || '').toString().trim();
  return {
    id:          String(fila['ID'] || ''),
    fecha:       String(fila['FECHA'] || ''),
    cliente:     String(fila['NOMBRE CLIENTE'] || ''),
    ciudad:      String(fila['CIUDAD DESTINO'] || ''),
    producto:    String(fila['CATEGORÍAS'] || fila['TIENDA'] || 'Sin categoría'),
    tienda:      String(fila['TIENDA'] || ''),
    estadoRaw,
    estado:      clasificarEstado(estadoRaw),
    venta, proveedor, flete, comision, devFlete, utilidad,
    margen: venta > 0 ? (utilidad / venta) * 100 : 0,
  };
}

function importarDropiExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb    = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (!filas.length) { reject(new Error('El archivo está vacío.')); return; }
        const faltantes = ['ID','ESTATUS','VALOR DE COMPRA EN PRODUCTOS']
          .filter(c => !Object.keys(filas[0]).includes(c));
        if (faltantes.length) {
          reject(new Error('No parece ser un Excel de Dropi. Faltan: ' + faltantes.join(', ')));
          return;
        }
        resolve(filas.map(parsearFilaDropi));
      } catch(err) { reject(new Error('Error leyendo Excel: ' + err.message)); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });
}

function calcularResumen(pedidos, tasaEntrega) {
  const tasa = ((tasaEntrega ?? 75) / 100);
  const fil  = tipo => pedidos.filter(p => p.estado === tipo);
  const suma = (arr, k) => arr.reduce((s, p) => s + (p[k] || 0), 0);

  const entregados = fil('entregado');
  const transito   = fil('transito');
  const pendientes = fil('pendiente');
  const devueltos  = fil('devuelto');
  const cancelados = fil('cancelado');
  const enCamino   = [...transito, ...pendientes];

  const ingresosReales = suma(entregados, 'venta');
  const costoProveedor = suma(entregados, 'proveedor');
  const costoFlete     = suma(entregados, 'flete');
  const costoComision  = suma(entregados, 'comision');
  const costosTotal    = costoProveedor + costoFlete + costoComision;
  const utilidadReal   = suma(entregados, 'utilidad');
  const margenReal     = ingresosReales > 0 ? (utilidadReal / ingresosReales) * 100 : 0;
  const margenEst      = margenReal > 0 ? margenReal / 100 : 0.47;
  const proyUtilidad   = suma(enCamino, 'venta') * margenEst * tasa;
  const totalConGuia   = entregados.length + transito.length + devueltos.length + cancelados.length;

  return {
    total: pedidos.length,
    entregados: entregados.length,
    enTransito: transito.length,
    pendientes: pendientes.length,
    devueltos:  devueltos.length,
    cancelados: cancelados.length,
    tasaReal:   totalConGuia > 0 ? (entregados.length / totalConGuia) * 100 : 0,
    ingresosReales, costoProveedor, costoFlete, costoComision, costosTotal,
    utilidadReal, margenReal, proyUtilidad,
    utilidadTotal: utilidadReal + proyUtilidad,
    listas: { entregados, transito, pendientes, devueltos, cancelados, todos: pedidos },
  };
}

function filtrarPorFecha(pedidos, desde, hasta) {
  if (!desde && !hasta) return pedidos;
  return pedidos.filter(p => {
    const pts = (p.fecha || '').split('-');
    if (pts.length !== 3) return true;
    const iso = `${pts[2]}-${pts[1]}-${pts[0]}`;
    if (desde && iso < desde) return false;
    if (hasta && iso > hasta) return false;
    return true;
  });
}

function agruparPorFecha(pedidos) {
  const m = {};
  const toISO = d => { const p=d.split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:d; };
  for (const p of pedidos) {
    const f = p.fecha || 'Sin fecha';
    if (!m[f]) m[f] = { fecha:f, venta:0, costo:0, utilidad:0, pedidos:0 };
    m[f].venta    += p.venta;
    m[f].costo    += p.proveedor + p.flete + p.comision;
    m[f].utilidad += p.utilidad;
    m[f].pedidos  += 1;
  }
  return Object.values(m).sort((a,b)=>toISO(a.fecha).localeCompare(toISO(b.fecha)));
}

function agruparPorCiudad(pedidos) {
  const m = {};
  for (const p of pedidos) {
    const c = p.ciudad || 'Sin ciudad';
    if (!m[c]) m[c] = { ciudad:c, venta:0, pedidos:0, utilidad:0 };
    m[c].venta    += p.venta;
    m[c].pedidos  += 1;
    m[c].utilidad += p.utilidad;
  }
  return Object.values(m).sort((a,b)=>b.venta-a.venta);
}

function importarMetaCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb    = XLSX.read(e.target.result, { type: 'string' });
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: 0 });
        if (!filas.length) { reject(new Error('CSV vacío')); return; }
        const get = (f, ops) => {
          for (const op of ops) {
            const k = Object.keys(f).find(k=>k.toLowerCase().includes(op.toLowerCase()));
            if (k!==undefined) return f[k];
          }
          return 0;
        };
        const campanas = filas.map(f => ({
          nombre:      String(get(f,['campaña','campaign','nombre','name'])||''),
          gasto:       parseFloat(get(f,['importe gastado','amount spent','spend','gasto']))||0,
          impresiones: parseInt(get(f,['impresiones','impressions']))||0,
          clics:       parseInt(get(f,['clics','clicks','link clicks']))||0,
          compras:     parseInt(get(f,['compras','purchases','results']))||0,
          fecha:       String(get(f,['fecha','date','day'])||''),
        }));
        const gastoTotal  = campanas.reduce((s,c)=>s+c.gasto,0);
        const impresiones = campanas.reduce((s,c)=>s+c.impresiones,0);
        const clics       = campanas.reduce((s,c)=>s+c.clics,0);
        const compras     = campanas.reduce((s,c)=>s+c.compras,0);
        resolve({ campanas, gastoTotal, impresiones, clics, compras,
          ctr: impresiones>0?(clics/impresiones)*100:0,
          cpc: clics>0?gastoTotal/clics:0,
          cpa: compras>0?gastoTotal/compras:0 });
      } catch(err) { reject(new Error('Error CSV: ' + err.message)); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file, 'UTF-8');
  });
}

function fmtCLP(n) {
  if (n==null||isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}
function fmtPct(n) {
  if (n==null||isNaN(n)) return '0%';
  return (+n).toFixed(1)+'%';
}

// Exponer globalmente
window.importarDropiExcel = importarDropiExcel;
window.importarMetaCSV    = importarMetaCSV;
window.calcularResumen    = calcularResumen;
window.filtrarPorFecha    = filtrarPorFecha;
window.agruparPorFecha    = agruparPorFecha;
window.agruparPorCiudad   = agruparPorCiudad;
window.clasificarEstado   = clasificarEstado;
window.fmtCLP             = fmtCLP;
window.fmtPct             = fmtPct;
