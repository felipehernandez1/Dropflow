// dropflow-import.js — Parser Dropi y Meta Ads
// Columnas basadas en exportación real de Dropi (verificadas 2026-04)

// ─── ESTADOS DROPI ───────────────────────────────────────────────────────────
const ESTADOS = {
  entregado:  ['ENTREGADO'],
  transito:   ['EN REPARTO', 'EN_REPARTO', 'EN TRANSITO', 'EN TRÁNSITO',
               'GUIA_GENERADA', 'EN ESPERA EN OFICINA', 'NOVEDAD'],
  pendiente:  ['PENDIENTE CONFIRMACION'],
  devolucion: ['DEVOLUCION', 'EN DEVOLUCIÓN', 'EN DEVOLUCION'],
  cancelado:  ['CANCELADO'],
};

function clasificarEstado(estatus) {
  const s = (estatus || '').toString().trim().toUpperCase();
  for (const [tipo, lista] of Object.entries(ESTADOS)) {
    if (lista.includes(s)) return tipo;
  }
  return 'otro';
}

// ─── PARSER EXCEL DROPI ──────────────────────────────────────────────────────
function parsearFilaDropi(fila) {
  const precio     = parseFloat(fila['VALOR DE COMPRA EN PRODUCTOS']) || 0;
  const proveedor  = parseFloat(fila['TOTAL EN PRECIOS DE PROVEEDOR']) || 0;
  const flete      = parseFloat(fila['PRECIO FLETE']) || 0;
  const comision   = parseFloat(fila['COMISION']) || 0;
  const devFlete   = parseFloat(fila['COSTO DEVOLUCION FLETE']) || 0;

  // Utilidad: si Dropi ya la calculó úsala, si no calcularla
  let ganancia = parseFloat(fila['GANANCIA']);
  if (isNaN(ganancia)) {
    ganancia = precio - proveedor - flete - comision - devFlete;
  }

  const estadoRaw = (fila['ESTATUS'] || '').toString().trim();
  const estado    = clasificarEstado(estadoRaw);

  return {
    id:          String(fila['ID'] || ''),
    fecha:       String(fila['FECHA'] || ''),
    cliente:     String(fila['NOMBRE CLIENTE'] || ''),
    ciudad:      String(fila['CIUDAD DESTINO'] || ''),
    departamento:String(fila['DEPARTAMENTO DESTINO'] || ''),
    telefono:    String(fila['TELÉFONO'] || ''),
    producto:    String(fila['CATEGORÍAS'] || 'Sin categoría'),
    tienda:      String(fila['TIENDA'] || ''),
    transportadora: String(fila['TRANSPORTADORA'] || ''),
    estadoRaw,
    estado,
    // financiero
    venta:       precio,
    proveedor,
    flete,
    comision,
    devFlete,
    utilidad:    ganancia,
    margen:      precio > 0 ? (ganancia / precio) * 100 : 0,
  };
}

// ─── IMPORTAR EXCEL DROPI ────────────────────────────────────────────────────
function importarDropiExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data  = new Uint8Array(e.target.result);
        const wb    = XLSX.read(data, { type: 'array' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!filas.length) {
          reject(new Error('El archivo Excel está vacío.'));
          return;
        }

        // Validar que sea un Excel de Dropi
        const cols = Object.keys(filas[0]);
        const requeridas = ['ID', 'ESTATUS', 'VALOR DE COMPRA EN PRODUCTOS', 'TOTAL EN PRECIOS DE PROVEEDOR'];
        const faltantes = requeridas.filter(c => !cols.includes(c));
        if (faltantes.length) {
          reject(new Error(`El archivo no parece ser un Excel de Dropi. Faltan columnas: ${faltantes.join(', ')}`));
          return;
        }

        const pedidos = filas.map(parsearFilaDropi);
        resolve(pedidos);

      } catch (err) {
        reject(new Error('Error leyendo el Excel: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── CALCULAR RESUMEN FINANCIERO ─────────────────────────────────────────────
function calcularResumen(pedidos) {
  const filtrar = (tipo) => pedidos.filter(p => p.estado === tipo);

  const entregados  = filtrar('entregado');
  const transito    = filtrar('transito');
  const pendientes  = filtrar('pendiente');
  const devoluciones= filtrar('devolucion');
  const cancelados  = filtrar('cancelado');

  const suma = (arr, campo) => arr.reduce((s, p) => s + (p[campo] || 0), 0);

  // Ingresos y costos REALES (solo entregados)
  const ingresosReales   = suma(entregados, 'venta');
  const costoProveedor   = suma(entregados, 'proveedor');
  const costoFlete       = suma(entregados, 'flete');
  const costoComision    = suma(entregados, 'comision');
  const costoDevFlete    = suma(entregados, 'devFlete');
  const costosTotal      = costoProveedor + costoFlete + costoComision + costoDevFlete;
  const utilidadReal     = suma(entregados, 'utilidad');
  const margenReal       = ingresosReales > 0 ? (utilidadReal / ingresosReales) * 100 : 0;

  // Proyección pedidos en camino (75% tasa de entrega estimada)
  const TASA_ENTREGA     = (window.appConfig?.tasaEntrega ?? 75) / 100;
  const enCamino         = [...transito, ...pendientes];
  const proyIngresos     = suma(enCamino, 'venta') * TASA_ENTREGA;
  const proyUtilidad     = enCamino.reduce((s, p) => {
    // estimar utilidad proporcional al margen actual, o usar la calculada
    const margenEst = margenReal / 100 || 0.47;
    return s + (p.venta * margenEst * TASA_ENTREGA);
  }, 0);

  // Tasa real de entrega del archivo
  const totalConGuia = entregados.length + transito.length + devoluciones.length + cancelados.length;
  const tasaReal     = totalConGuia > 0 ? (entregados.length / totalConGuia) * 100 : 0;

  return {
    // conteos
    total:          pedidos.length,
    entregados:     entregados.length,
    enTransito:     transito.length,
    pendientes:     pendientes.length,
    devoluciones:   devoluciones.length,
    cancelados:     cancelados.length,
    tasaReal,

    // reales
    ingresosReales,
    costoProveedor,
    costoFlete,
    costoComision,
    costoDevFlete,
    costosTotal,
    utilidadReal,
    margenReal,

    // proyección
    proyIngresos,
    proyUtilidad,
    utilidadTotal:  utilidadReal + proyUtilidad,

    // detalle por estado
    pedidosPorEstado: {
      entregados,
      transito,
      pendientes,
      devoluciones,
      cancelados,
      todos: pedidos,
    },
  };
}

// ─── IMPORTAR CSV META ADS ────────────────────────────────────────────────────
function importarMetaCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const wb    = XLSX.read(e.target.result, { type: 'string' });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(ws, { defval: 0 });

        if (!filas.length) {
          reject(new Error('El CSV de Meta Ads está vacío.'));
          return;
        }

        // Mapeo flexible de columnas Meta Ads
        const mapear = (fila, opciones) => {
          for (const op of opciones) {
            const key = Object.keys(fila).find(k => k.toLowerCase().includes(op.toLowerCase()));
            if (key !== undefined) return fila[key];
          }
          return 0;
        };

        const campanas = filas.map(fila => ({
          nombre:      String(mapear(fila, ['campaña', 'campaign', 'nombre', 'name']) || ''),
          gasto:       parseFloat(mapear(fila, ['importe gastado', 'amount spent', 'spend', 'gasto'])) || 0,
          impresiones: parseInt(mapear(fila, ['impresiones', 'impressions']))   || 0,
          clics:       parseInt(mapear(fila, ['clics', 'clicks', 'link clicks']))|| 0,
          compras:     parseInt(mapear(fila, ['compras', 'purchases', 'results']))|| 0,
          fecha:       String(mapear(fila, ['fecha', 'date', 'day']) || ''),
        }));

        const gastoTotal   = campanas.reduce((s, c) => s + c.gasto, 0);
        const impresiones  = campanas.reduce((s, c) => s + c.impresiones, 0);
        const clics        = campanas.reduce((s, c) => s + c.clics, 0);
        const compras      = campanas.reduce((s, c) => s + c.compras, 0);

        resolve({
          campanas,
          gastoTotal,
          impresiones,
          clics,
          compras,
          ctr:  impresiones > 0 ? (clics / impresiones) * 100 : 0,
          cpc:  clics > 0 ? gastoTotal / clics : 0,
          cpa:  compras > 0 ? gastoTotal / compras : 0,
        });

      } catch (err) {
        reject(new Error('Error leyendo el CSV de Meta Ads: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file, 'UTF-8');
  });
}

// ─── FILTRAR POR FECHA ────────────────────────────────────────────────────────
function filtrarPorFecha(pedidos, desde, hasta) {
  if (!desde && !hasta) return pedidos;
  return pedidos.filter(p => {
    const f = p.fecha; // formato DD-MM-YYYY
    if (!f || f.length < 10) return true;
    // Convertir a YYYY-MM-DD para comparar
    const partes = f.split('-');
    if (partes.length !== 3) return true;
    const iso = `${partes[2]}-${partes[1]}-${partes[0]}`;
    if (desde && iso < desde) return false;
    if (hasta && iso > hasta) return false;
    return true;
  });
}

// ─── AGRUPAR DATOS PARA GRÁFICOS ─────────────────────────────────────────────
function agruparPorFecha(pedidos) {
  const mapa = {};
  for (const p of pedidos) {
    const f = p.fecha || 'Sin fecha';
    if (!mapa[f]) mapa[f] = { fecha: f, venta: 0, costo: 0, utilidad: 0, pedidos: 0 };
    mapa[f].venta    += p.venta;
    mapa[f].costo    += p.proveedor + p.flete + p.comision;
    mapa[f].utilidad += p.utilidad;
    mapa[f].pedidos  += 1;
  }
  // Ordenar por fecha
  return Object.values(mapa).sort((a, b) => {
    const toISO = d => {
      const p = d.split('-');
      return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
    };
    return toISO(a.fecha).localeCompare(toISO(b.fecha));
  });
}

function agruparPorCiudad(pedidos) {
  const mapa = {};
  for (const p of pedidos) {
    const c = p.ciudad || 'Sin ciudad';
    if (!mapa[c]) mapa[c] = { ciudad: c, venta: 0, pedidos: 0, utilidad: 0 };
    mapa[c].venta    += p.venta;
    mapa[c].pedidos  += 1;
    mapa[c].utilidad += p.utilidad;
  }
  return Object.values(mapa).sort((a, b) => b.venta - a.venta);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function formatCLP(n) {
  if (isNaN(n) || n === null) return '$0';
  return '$' + Math.round(n).toLocaleString('es-CL');
}

function formatPct(n) {
  if (isNaN(n) || n === null) return '0%';
  return n.toFixed(1) + '%';
}

// Exportar para uso global
window.DropflowImport = {
  importarDropiExcel,
  importarMetaCSV,
  calcularResumen,
  filtrarPorFecha,
  agruparPorFecha,
  agruparPorCiudad,
  clasificarEstado,
  formatCLP,
  formatPct,
  ESTADOS,
};
