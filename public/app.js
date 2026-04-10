// Engagement state
let engagementData = {};

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

// ── Screenpop Button Handler ──
async function triggerScreenpop() {
  const btn = document.getElementById('screenpop-btn');
  const result = document.getElementById('result');

  btn.disabled = true;
  btn.innerHTML = '<span class="icon">⏳</span> Launching...';
  result.style.display = 'none';
  result.className = 'result';

  const payload = {
    engagementId:  engagementData.engagementId  || null,
    channel:       engagementData.channel        || null,
    direction:     engagementData.direction      || null,
    consumer:      engagementData.consumer       || null,
    agentName:     document.getElementById('agent-name').textContent,
    timestamp:     new Date().toISOString(),
  };

  log(`Screenpop triggered → ${JSON.stringify(payload)}`);

  const serverUrl = window.location.origin + '/screenpop';
  log(`Calling: ${serverUrl}`);

  try {
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    log(`Response status: ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data.success) {
      // Populate customer card from context
      if (data.customer && Object.keys(data.customer).length) {
        const c = data.customer;
        document.getElementById('cust-id').textContent      = c.customerId    || c.eligibilityId || '—';
        document.getElementById('cust-appt').textContent    = c.appointmentId || '—';
        document.getElementById('cust-phone').textContent   = c.customerPhone || '—';
        document.getElementById('cust-state').textContent   = c.state         || '—';
        document.getElementById('cust-partner').textContent = c.partnerName   || '—';
        document.getElementById('cust-route').textContent   = c.recommendedRoute || '—';
        document.getElementById('customer-card').style.display = 'block';
        log('Customer context loaded ✓');
      }

      // Render URL as a real anchor — Zoom Contact Center opens <a target="_blank">
      // links in the system browser, unlike window.open or zoomSdk.openUrl
      if (data.url) {
        log(`URL: ${data.url}`);
        result.innerHTML =
          `✓ <a href="${data.url}" target="_blank" rel="noopener noreferrer"
              style="color:inherit;font-weight:700;">Open Screenpop ↗</a>`;
        result.className = 'result success';
        result.style.display = 'block';

        // Also try SDK openUrl as a belt-and-suspenders attempt
        try { await zoomSdk.openUrl({ url: data.url }); } catch (_) {}
      } else {
        result.textContent = '✓ Screenpop triggered!';
        log('No URL returned from Prismatic.');
      }
      result.className = 'result success';
      result.style.display = 'block';
      log('Done ✓');
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    result.className = 'result error';
    result.textContent = '✗ Failed: ' + err.message;
    result.style.display = 'block';
    log('Screenpop error: ' + err.message);
  }

  btn.innerHTML = '<span class="icon">🖥️</span> Launch Screenpop';
  btn.disabled = false;
}

// ── SDK Init ──
async function init() {
  try {
    log('Loading Zoom Apps SDK...');

    // Race config against a 5-second timeout so we never hang forever
    await Promise.race([
      zoomSdk.config({
        capabilities: [
          'getRunningContext',
          'getEngagementContext', 'getEngagementStatus',
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
    const ctx = await zoomSdk.getRunningContext();
    document.getElementById('running-context').textContent = ctx?.context || '—';

    // Agent info
    try {
      const appCtx = await zoomSdk.getAppContext();
      document.getElementById('agent-name').textContent =
        appCtx?.user?.name || appCtx?.user?.email || '—';
    } catch(e) {}

    // Engagement context
    try {
      const engCtx = await zoomSdk.getEngagementContext();
      updateEngagementUI(engCtx);
      log(`Engagement: ${engCtx?.engagementId}`);
    } catch(e) { log('No active engagement.'); }

    // Engagement status
    try {
      const engStatus = await zoomSdk.getEngagementStatus();
      renderEngagementStatus(engStatus?.status);
      engagementData.status = engStatus?.status;
    } catch(e) {}

    // Event listeners
    zoomSdk.onEngagementStatusChange((evt) => {
      renderEngagementStatus(evt?.status);
      engagementData.status = evt?.status;
      log(`Status → ${evt?.status}`);
    });

    zoomSdk.onEngagementContextChange((evt) => {
      updateEngagementUI(evt);
      log(`Context → ${evt?.engagementId}`);
    });

    zoomSdk.onRunningContextChange((evt) => {
      document.getElementById('running-context').textContent = evt?.context || '—';
    });

  } catch (err) {
    setStatus('SDK Error: ' + err.message, 'error');
    log('Error: ' + err.message);
    // Still enable button for testing outside Zoom
    document.getElementById('screenpop-btn').disabled = false;
  }
}

init();
