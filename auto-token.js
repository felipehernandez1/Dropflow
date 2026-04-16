// ============================================
// AUTO-RENOVACIÓN DE TOKEN DROPI
// Estrategia: iframe oculto que carga app.dropi.cl
// y extrae el token de las peticiones
// ============================================

const AUTO_TOKEN_KEY  = 'dropi_key';
const AUTO_TOKEN_TIME = 'dropi_token_time';
const TOKEN_TTL_MS    = 3.5 * 60 * 60 * 1000; // 3.5 horas

function getTokenAge() {
  const saved = localStorage.getItem(AUTO_TOKEN_TIME);
  if (!saved) return Infinity;
  return Date.now() - parseInt(saved);
}

function saveToken(token) {
  localStorage.setItem(AUTO_TOKEN_KEY, token);
  localStorage.setItem(AUTO_TOKEN_TIME, Date.now().toString());
  // Enviar al servidor
  fetch('/api/set-token', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({token})
  }).catch(()=>{});
  console.log('[auto-token] Token guardado, válido por 3.5h');
}

async function pushTokenToServer() {
  const token = localStorage.getItem(AUTO_TOKEN_KEY);
  if (!token) return false;
  try {
    const r = await fetch('/api/set-token', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token})
    });
    return (await r.json()).ok;
  } catch(e) { return false; }
}

// ---- Verificar estado del token en servidor ----
async function checkTokenStatus() {
  try {
    const r = await fetch('/api/token-status');
    return await r.json();
  } catch(e) { return {hasToken:false, expiresInMinutes:0}; }
}

// ---- Mostrar banner de renovación ----
function showRenewalBanner(minutesLeft) {
  const existing = document.getElementById('token-renewal-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'token-renewal-banner';
  banner.style.cssText = `
    position:fixed; bottom:20px; right:20px; z-index:9999;
    background:linear-gradient(135deg,#1a0a00,#2a1500);
    border:1px solid #ff6b00; border-radius:12px;
    padding:16px 20px; max-width:320px;
    box-shadow:0 0 30px rgba(255,107,0,0.3);
    font-family:'DM Mono',monospace;
  `;

  const msg = minutesLeft <= 0
    ? 'Token Dropi <strong style="color:#ff4444">expirado</strong>'
    : `Token Dropi expira en <strong style="color:#ffa726">${minutesLeft} min</strong>`;

  banner.innerHTML = `
    <div style="color:#ff9944;font-size:11px;letter-spacing:1px;margin-bottom:10px">⚠ RENOVAR TOKEN DROPI</div>
    <div style="color:#ccc;font-size:11px;line-height:1.6;margin-bottom:12px">${msg}<br>
    Abre Dropi, copia el x-authorization y pégalo abajo:</div>
    <input id="token-input-banner" placeholder="Pega el token aquí..." style="
      width:100%;box-sizing:border-box;padding:8px 10px;
      background:rgba(255,255,255,0.05);border:1px solid rgba(255,107,0,0.3);
      border-radius:6px;color:#fff;font-size:10px;font-family:'DM Mono',monospace;
      margin-bottom:8px;outline:none;
    ">
    <div style="display:flex;gap:8px">
      <button onclick="applyBannerToken()" style="
        flex:1;padding:8px;background:linear-gradient(135deg,rgba(255,107,0,0.3),rgba(255,167,38,0.3));
        border:1px solid rgba(255,107,0,0.5);border-radius:6px;color:#ffa726;
        cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:1px;
      ">✓ APLICAR</button>
      <button onclick="openDropiForToken()" style="
        flex:1;padding:8px;background:rgba(255,255,255,0.05);
        border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#888;
        cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;
      ">↗ Abrir Dropi</button>
      <button onclick="document.getElementById('token-renewal-banner').remove()" style="
        padding:8px 10px;background:none;border:none;color:#555;cursor:pointer;font-size:14px;
      ">×</button>
    </div>
  `;
  document.body.appendChild(banner);
}

window.applyBannerToken = async function() {
  const input = document.getElementById('token-input-banner');
  if (!input) return;
  let token = input.value.trim();
  if (token.startsWith('Bearer ')) token = token.substring(7);
  if (!token || token.length < 20) {
    input.style.borderColor = '#ff4444';
    return;
  }
  saveToken(token);
  const ok = await pushTokenToServer();
  if (ok) {
    document.getElementById('token-renewal-banner')?.remove();
    showSuccessBadge('Token renovado ✓');
    // Recargar datos
    if (typeof refreshData === 'function') refreshData();
  }
};

window.openDropiForToken = function() {
  window.open('https://app.dropi.cl/app/mis-pedidos', '_blank');
  setTimeout(() => {
    const input = document.getElementById('token-input-banner');
    if (input) {
      input.placeholder = 'Copia x-authorization de Network Tab...';
      input.focus();
    }
  }, 500);
};

function showSuccessBadge(msg) {
  const badge = document.createElement('div');
  badge.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:9999;
    background:linear-gradient(135deg,#003322,#001a11);
    border:1px solid #00e676;border-radius:10px;
    padding:12px 18px;color:#00e676;
    font-family:'DM Mono',monospace;font-size:11px;
    box-shadow:0 0 20px rgba(0,230,118,0.3);
  `;
  badge.textContent = msg;
  document.body.appendChild(badge);
  setTimeout(()=>badge.remove(), 3000);
}

// ---- MONITOR PRINCIPAL ----
async function startTokenMonitor() {
  // Al inicio: enviar token guardado al servidor
  const saved = localStorage.getItem(AUTO_TOKEN_KEY);
  if (saved) {
    await pushTokenToServer();
  }

  async function check() {
    const status = await checkTokenStatus();
    const mins   = status.expiresInMinutes || 0;

    if (!status.hasToken || mins <= 0) {
      showRenewalBanner(0);
    } else if (mins <= 25) {
      showRenewalBanner(mins);
    } else {
      // Token OK — asegurarse de que el servidor lo tiene
      const localAge = getTokenAge();
      if (localAge < TOKEN_TTL_MS) {
        // Token local fresco, enviar al servidor si lo perdió
        if (mins < 5) await pushTokenToServer();
      }
    }
  }

  // Verificar al inicio
  setTimeout(check, 2000);

  // Verificar cada 15 minutos
  setInterval(check, 15 * 60 * 1000);
}

// ---- AUTO-RENOVAR TOKEN DE META ADS ----
// El token de Meta dura 60 días. Vamos a mostrar aviso cuando queden 7 días.
async function checkMetaToken() {
  const metaToken = localStorage.getItem('meta_token');
  const metaSaved = localStorage.getItem('meta_token_time');
  if (!metaToken || !metaSaved) return;

  const age = Date.now() - parseInt(metaSaved);
  const daysLeft = Math.round((60*24*60*60*1000 - age) / (24*60*60*1000));

  if (daysLeft <= 7 && daysLeft >= 0) {
    showMetaRenewalBanner(daysLeft);
  }
}

function showMetaRenewalBanner(daysLeft) {
  const existing = document.getElementById('meta-renewal-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'meta-renewal-banner';
  banner.style.cssText = `
    position:fixed; bottom:20px; left:20px; z-index:9999;
    background:linear-gradient(135deg,#001a33,#000d1a);
    border:1px solid #1877f2; border-radius:12px;
    padding:16px 20px; max-width:300px;
    box-shadow:0 0 30px rgba(24,119,242,0.2);
    font-family:'DM Mono',monospace;
  `;
  banner.innerHTML = `
    <div style="color:#1877f2;font-size:11px;letter-spacing:1px;margin-bottom:8px">ℹ META ADS TOKEN</div>
    <div style="color:#aaa;font-size:11px;line-height:1.6;margin-bottom:10px">
      Tu token de Meta expira en <strong style="color:#fff">${daysLeft} días</strong>.<br>
      Renuévalo en el Graph API Explorer.
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="window.open('https://developers.facebook.com/tools/explorer','_blank')" style="
        flex:1;padding:7px;background:rgba(24,119,242,0.2);
        border:1px solid rgba(24,119,242,0.4);border-radius:6px;color:#1877f2;
        cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;
      ">↗ Renovar</button>
      <button onclick="document.getElementById('meta-renewal-banner').remove()" style="
        padding:7px 10px;background:none;border:none;color:#555;cursor:pointer;font-size:14px;
      ">×</button>
    </div>
  `;
  document.body.appendChild(banner);
}

// ---- GUARDAR TOKEN META AL CONECTAR ----
function patchMetaTokenSave() {
  const originalSave = window.saveMetaToken;
  // Hook en el botón de configuración de Meta
  document.addEventListener('click', e => {
    if (e.target && e.target.textContent && e.target.textContent.includes('Conectar Meta')) {
      const tokenInput = document.getElementById('meta-token-input') ||
                         document.querySelector('input[placeholder*="Meta"]') ||
                         document.querySelector('input[placeholder*="Access"]');
      if (tokenInput && tokenInput.value) {
        localStorage.setItem('meta_token', tokenInput.value);
        localStorage.setItem('meta_token_time', Date.now().toString());
      }
    }
  });
}

// ---- INICIAR TODO ----
document.addEventListener('DOMContentLoaded', () => {
  startTokenMonitor();
  setTimeout(checkMetaToken, 3000);
  patchMetaTokenSave();
});
