// Engagement state
let engagementData = {};
let engagementVars = {};   // CustomerID, AppointmentID, etc.
let sdk = null;            // resolved zoomSdk reference

const CARETALK_BASE = 'https://caretalk360.com/dashboard/patient-teleHealth';

function buildScreenpopUrl() {
  const cid = engagementVars.CustomerID || '';
  const aid = engagementVars.AppointmentID || '';
  if (!cid && !aid) return null;
  return `${CARETALK_BASE}?patientId=${encodeURIComponent(cid)}&appointmentId=${encodeURIComponent(aid)}`;
}

function log(msg) {
  const el = document.getElementById('log');
  const now = new Date().toLocaleTimeString();
  el.innerHTML += `<div class="log-entry"><time>${now}</time>${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, type) {
  const bar = document.getElementById('sdk-status');
  bar.textContent = text;
  if (type === 'error') {
    bar.style.color = '#842029';
    bar.style.background = '#f8d7da';
  } else {
    bar.style.color = '#2372eb';
    bar.style.background = '#e8f0fe';
  }
}

function renderEngagementStatus(status) {
  const cls = { active: 'active', idle: 'idle', ended: 'ended' }[status?.toLowerCase()] || 'unknown';
  document.getElementById('eng-status').innerHTML = `<span class="badge ${cls}">${status || '—'}</span>`;
}

function updateEngagementUI(ctx) {
  if (!ctx) return;
  engagementData = { ...engagementData, ...ctx };
  if (ctx.engagementId)  document.getElementById('eng-id').textContent = ctx.engagementId;
  if (ctx.channel)       document.getElementById('eng-channel').textContent = ctx.channel;
  if (ctx.direction)     document.getElementById('eng-direction').textContent = ctx.direction;
  if (ctx.consumer)      document.getElementById('eng-consumer').textContent =
    ctx.consumer?.phoneNumber || ctx.consumer?.name || ctx.consumer || '—';
}

// Fetch a single engagement variable — tries full namespace then short name
async function fetchVar(shortName) {
  const candidates = [
    `global_custom.CTH.${shortName}`,
    shortName,
  ];
  for (const name of candidates) {
    try {
      const res = await sdk.getEngagementVariableValue({ name });
      if (res?.value !== undefined && res.value !== '') {
        log(`Var ${shortName} = ${res.value}`);
        return String(res.value);
      }
    } catch (_) {}
  }
  return '';
}

async function loadEngagementVars() {
  engagementVars.CustomerID    = await fetchVar('CustomerID');
  engagementVars.AppointmentID = await fetchVar('AppointmentID');
  engagementVars.EligibilityID = await fetchVar('EligibilityID');
  engagementVars.StateCodeID   = await fetchVar('StateCodeID');

  // Update customer card
  if (engagementVars.CustomerID || engagementVars.AppointmentID) {
    document.getElementById('cust-id').textContent   = engagementVars.CustomerID    || '—';
    document.getElementById('cust-appt').textContent = engagementVars.AppointmentID || '—';
    document.getElementById('customer-card').style.display = 'block';
  }
}

// ── Open URL in system browser ──
async function openUrl(url) {
  log(`Opening: ${url}`);
  // Try SDK first, then show clickable link as fallback
  try {
    await sdk.openUrl({ url });
    return;
  } catch (_) {}

  // Fallback: render a link the agent can click
  const result = document.getElementById('result');
  result.innerHTML =
    `✓ <a href="${url}" target="_blank" rel="noopener noreferrer"
        style="color:inherit;font-weight:700;">Click to open in browser ↗</a>`;
  result.className = 'result success';
  result.style.display = 'block';
}

// ── Screenpop Button Handler ──
async function triggerScreenpop() {
  const btn    = document.getElementById('screenpop-btn');
  const result = document.getElementById('result');

  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> Launching...';
  result.style.display = 'none';
  result.className = 'result';

  const url = buildScreenpopUrl();

  if (!url) {
    result.className = 'result error';
    result.textContent = '✗ No CustomerID or AppointmentID found in engagement.';
    result.style.display = 'block';
    log('No variables available — cannot build URL.');
    btn.innerHTML = '<span class="icon">🖥️</span> Launch Screenpop';
    btn.disabled = false;
    return;
  }

  log(`Screenpop URL: ${url}`);
  await openUrl(url);

  result.className = 'result success';
  result.textContent = result.querySelector('a') ? result.textContent : '✓ Screenpop opened!';
  result.style.display = 'block';
  log('Done ✓');

  btn.innerHTML = '<span class="icon">🖥️</span> Launch Screenpop';
  btn.disabled = false;
}

// ── Load SDK dynamically so we can catch load failures ──
function loadSdkScript() {
  return new Promise((resolve) => {
    // Already injected by host?
    if (typeof zoomSdk !== 'undefined') { resolve(zoomSdk); return; }

    const s = document.createElement('script');
    s.src = 'https://appssdk.zoom.us/sdk.js';
    s.onload  = () => resolve(typeof zoomSdk !== 'undefined' ? zoomSdk : null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

// ── SDK Init ──
async function init() {
  try {
    log('Loading Zoom Apps SDK...');

    // Diagnostics — log what Zoom globals exist in this webview
    const zoomGlobals = Object.keys(window).filter(k => /zoom/i.test(k));
    log('Zoom globals: ' + (zoomGlobals.join(', ') || 'none'));
    log('URL: ' + window.location.href);

    sdk = await loadSdkScript();
    if (!sdk) throw new Error('zoomSdk unavailable — SDK did not load');

    // Race config against a 5-second timeout so we never hang forever
    await Promise.race([
      sdk.config({
        capabilities: [
          'getRunningContext',
          'getEngagementContext', 'getEngagementStatus',
          'getEngagementVariableValue',
          'onEngagementContextChange', 'onEngagementStatusChange',
          'onRunningContextChange',
          'openUrl',
        ]
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SDK config timed out after 5s')), 5000)
      )
    ]);

    setStatus('SDK Ready ✓');
    log('SDK initialized.');
    document.getElementById('screenpop-btn').disabled = false;

    // Running context
    try {
      const ctx = await sdk.getRunningContext();
      document.getElementById('running-context').textContent = ctx?.context || '—';
    } catch(_) {}

    // Agent info
    try {
      const appCtx = await sdk.getAppContext();
      document.getElementById('agent-name').textContent =
        appCtx?.user?.name || appCtx?.user?.email || '—';
    } catch(_) {}

    // Engagement context + variables
    try {
      const engCtx = await sdk.getEngagementContext();
      updateEngagementUI(engCtx);
      log(`Engagement: ${engCtx?.engagementId}`);
      await loadEngagementVars();
    } catch(e) { log('No active engagement yet.'); }

    // Engagement status
    try {
      const engStatus = await sdk.getEngagementStatus();
      renderEngagementStatus(engStatus?.status);
      engagementData.status = engStatus?.status;
    } catch(_) {}

    // Event listeners
    sdk.onEngagementStatusChange((evt) => {
      renderEngagementStatus(evt?.status);
      engagementData.status = evt?.status;
      log(`Status → ${evt?.status}`);
    });

    sdk.onEngagementContextChange(async (evt) => {
      updateEngagementUI(evt);
      log(`Context → ${evt?.engagementId}`);
      await loadEngagementVars();
    });

    sdk.onRunningContextChange((evt) => {
      document.getElementById('running-context').textContent = evt?.context || '—';
    });

  } catch (err) {
    setStatus('SDK Error: ' + err.message, 'error');
    log('Error: ' + err.message);
    document.getElementById('screenpop-btn').disabled = false;
  }
}

init();
