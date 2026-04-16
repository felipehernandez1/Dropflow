// ================================================
// DROPFLOW — Importador CSV/Excel
// Procesa archivos de Dropi y Meta Ads
// ================================================

// ---- DROPI EXCEL ----
async function importDropiExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rows.length) return reject('Archivo vacío');

        // Detectar columnas — Dropi puede variar los nombres
        const sample = rows[0];
        const keys   = Object.keys(sample);
        console.log('[import-dropi] Columnas:', keys);

        const find = (...names) => keys.find(k =>
          names.some(n => k.toLowerCase().includes(n.toLowerCase()))
        );

        const colId      = find('id','orden','order','pedido','#');
        const colProd    = find('product','producto','nombre producto','item');
        const colEstado  = find('estado','status','state');
        const colVenta   = find('total','venta','price','precio','valor');
        const colProv    = find('proveedor','supplier','costo','cost','sale_price');
        const colEnvio   = find('envio','envío','freight','shipping','logistic');
        const colCiudad  = find('ciudad','city','commune','comuna');
        const colFecha   = find('fecha','date','created','creado');
        const colCliente = find('cliente','customer','nombre','name');

        console.log('[import-dropi] Mapeando:', { colId, colProd, colEstado, colVenta, colFecha });

        const DEFAULT_ENVIO = parseFloat(localStorage.getItem('param_envio') || '8500');

        const orders = rows.map((r, i) => {
          const estado = mapStatusImport(String(r[colEstado]||''));
          const venta  = parseFloat(String(r[colVenta]||'0').replace(/[^0-9.-]/g,'')) || 0;
          const prov   = parseFloat(String(r[colProv]||'0').replace(/[^0-9.-]/g,'')) || 0;
          const envio  = parseFloat(String(r[colEnvio]||'0').replace(/[^0-9.-]/g,'')) || DEFAULT_ENVIO;
          const fecha  = parseFecha(r[colFecha]);

          return {
            id:        String(r[colId]  || i+1),
            producto:  String(r[colProd]|| 'Producto'),
            estado,
            venta,
            proveedor: prov,
            envio,
            ads:       0,
            ciudad:    String(r[colCiudad]  || ''),
            fecha,
            cliente:   String(r[colCliente] || ''),
            tracking:  '',
            courier:   '',
          };
        }).filter(o => o.venta > 0 || o.estado !== 'pendiente');

        console.log('[import-dropi] Pedidos importados:', orders.length);
        resolve(orders);
      } catch(e) {
        reject('Error leyendo Excel: ' + e.message);
      }
    };
    reader.onerror = () => reject('Error leyendo archivo');
    reader.readAsArrayBuffer(file);
  });
}

// ---- META ADS CSV ----
async function importMetaCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        if (!rows.length) return reject('CSV vacío');

        const headers = rows[0];
        console.log('[import-meta] Columnas:', headers);

        const find = (...names) => {
          const idx = headers.findIndex(h =>
            names.some(n => h.toLowerCase().includes(n.toLowerCase()))
          );
          return idx >= 0 ? idx : -1;
        };

        const iCamp  = find('campaign','campaña','nombre campaña','campaign name');
        const iGasto = find('amount spent','gasto','spend','importe','monto');
        const iImpr  = find('impressions','impresiones');
        const iClicks= find('clicks','clics');
        const iConv  = find('purchase','compra','conversiones','results');
        const iIngresos = find('purchase value','ingresos','revenue','valor compra');
        const iFecha = find('date','fecha','day','día','start');

        console.log('[import-meta] Índices:', { iCamp, iGasto, iImpr, iClicks, iConv, iFecha });

        const dailyCampMap = {};
        const campMap = {};

        rows.slice(1).forEach(row => {
          if (!row.length || row.every(c => !c)) return;
          const nombre = String(row[iCamp] || 'Campaña').trim();
          const gasto  = parseFloat(String(row[iGasto]||'0').replace(/[^0-9.-]/g,'')) || 0;
          const impr   = parseInt(String(row[iImpr]||'0').replace(/[^0-9]/g,'')) || 0;
          const clicks = parseInt(String(row[iClicks]||'0').replace(/[^0-9]/g,'')) || 0;
          const conv   = parseFloat(String(row[iConv]||'0').replace(/[^0-9.-]/g,'')) || 0;
          const ingr   = parseFloat(String(row[iIngresos]||'0').replace(/[^0-9.-]/g,'')) || 0;
          const fecha  = iFecha >= 0 ? parseFecha(row[iFecha]) : '';

          if (fecha) {
            if (!dailyCampMap[fecha]) dailyCampMap[fecha] = {};
            if (!dailyCampMap[fecha][nombre]) dailyCampMap[fecha][nombre] = { gasto:0, conversiones:0 };
            dailyCampMap[fecha][nombre].gasto       += gasto;
            dailyCampMap[fecha][nombre].conversiones += conv;
          }

          if (!campMap[nombre]) campMap[nombre] = { nombre, gasto:0, clicks:0, impresiones:0, conversiones:0, ingresos:0 };
          campMap[nombre].gasto       += gasto;
          campMap[nombre].clicks      += clicks;
          campMap[nombre].impresiones += impr;
          campMap[nombre].conversiones += conv;
          campMap[nombre].ingresos    += ingr;
        });

        const campanas = Object.values(campMap).map(c => ({
          ...c,
          roas: c.gasto > 0 ? c.ingresos/c.gasto : 0,
          ctr:  c.impresiones > 0 ? c.clicks/c.impresiones : 0,
          cpa:  c.conversiones > 0 ? c.gasto/c.conversiones : 0,
        }));

        const totalGasto = campanas.reduce((s,c)=>s+c.gasto, 0);
        const totalIng   = campanas.reduce((s,c)=>s+c.ingresos, 0);
        const totalConv  = campanas.reduce((s,c)=>s+c.conversiones, 0);
        const totalClicks= campanas.reduce((s,c)=>s+c.clicks, 0);
        const totalImpr  = campanas.reduce((s,c)=>s+c.impresiones, 0);

        console.log('[import-meta] Campañas:', campanas.length, '| Gasto total:', totalGasto);
        console.log('[import-meta] Días con data:', Object.keys(dailyCampMap).length);

        resolve({
          gasto: totalGasto,
          impresiones: totalImpr,
          clicks: totalClicks,
          ctr:  totalImpr  > 0 ? totalClicks/totalImpr : 0,
          cpa:  totalConv  > 0 ? totalGasto/totalConv  : 0,
          roas: totalGasto > 0 ? totalIng/totalGasto   : 0,
          campanas,
          dailyCampMap,
          dailyMap: Object.fromEntries(
            Object.entries(dailyCampMap).map(([fecha, camps]) => [
              fecha,
              Object.values(camps).reduce((a,c) => ({
                gasto: a.gasto + c.gasto,
                conversiones: a.conversiones + c.conversiones
              }), {gasto:0, conversiones:0})
            ])
          )
        });
      } catch(e) {
        reject('Error leyendo CSV: ' + e.message);
      }
    };
    reader.onerror = () => reject('Error leyendo archivo');
    reader.readAsText(file, 'UTF-8');
  });
}

// ---- HELPERS ----
function mapStatusImport(s) {
  const str = s.trim().toUpperCase();
  if (['ENTREGADO','DELIVERED','DELIVERED','COMPLETADO'].includes(str)) return 'entregado';
  if (['EN CAMINO','EN TRÁNSITO','EN TRANSITO','TRANSITO','IN_TRANSIT','GUIA GENERADA','PREPARADO'].includes(str)) return 'transito';
  if (['DEVUELTO','RETURNED'].includes(str)) return 'devuelto';
  if (['CANCELADO','CANCELLED','CANCELED'].includes(str)) return 'cancelado';
  if (['PENDIENTE','PENDING','PENDIENTE CONFIRMACION'].includes(str)) return 'pendiente';
  return 'pendiente';
}

function parseFecha(val) {
  if (!val) return '';
  const s = String(val).trim();
  // ISO: 2026-04-13
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [d,m,y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const parts = s.split('/');
    return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }
  // Excel serial number
  const n = parseFloat(s);
  if (!isNaN(n) && n > 40000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    return d.toISOString().substring(0,10);
  }
  return s.substring(0,10);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if ((c === ',' || c === ';') && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim());
    return cols;
  }).filter(r => r.some(c => c));
}

// ---- UI HANDLERS ----
async function handleDropiFile(input) {
  const file = input.files[0];
  if (!file) return;
  const btn = document.getElementById('btn-import-dropi');
  if (btn) { btn.textContent = '⏳ Importando...'; btn.disabled = true; }

  try {
    const orders = await importDropiExcel(file);
    ALL_ORDERS = orders;
    assignAdsPerOrder();
    renderDashboard();
    renderTable();
    setImportStatus('dropi-import-status', 'ok', `✓ ${orders.length} pedidos importados`);
    showToast(`${orders.length} pedidos importados de Dropi ✓`, 'green');
  } catch(e) {
    setImportStatus('dropi-import-status', 'err', '✗ ' + e);
    showToast('Error: ' + e, 'red');
  } finally {
    if (btn) { btn.textContent = '📂 Seleccionar archivo'; btn.disabled = false; }
    input.value = '';
  }
}

async function handleMetaFile(input) {
  const file = input.files[0];
  if (!file) return;
  const btn = document.getElementById('btn-import-meta');
  if (btn) { btn.textContent = '⏳ Importando...'; btn.disabled = true; }

  try {
    const metaData = await importMetaCsv(file);
    META_DATA = metaData;
    assignAdsPerOrder();
    renderDashboard();
    renderMeta();
    setImportStatus('meta-import-status', 'ok', `✓ ${metaData.campanas.length} campañas · $${Math.round(metaData.gasto).toLocaleString('es-CL')} gasto`);
    showToast(`Meta Ads importado ✓ Gasto: $${Math.round(metaData.gasto).toLocaleString('es-CL')}`, 'green');
  } catch(e) {
    setImportStatus('meta-import-status', 'err', '✗ ' + e);
    showToast('Error: ' + e, 'red');
  } finally {
    if (btn) { btn.textContent = '📂 Seleccionar CSV'; btn.disabled = false; }
    input.value = '';
  }
}

function setImportStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'config-status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
}

function triggerFileInput(id) {
  document.getElementById(id)?.click();
}
