const POLL_MS = 3000; // check for new calls every 3 seconds

// Only trigger on calls that arrive AFTER this panel loaded
let lastSeenTs = Date.now();

// Agent email — stored in localStorage so it survives panel reloads
let agentEmail = localStorage.getItem('ct_agent_email') || '';

// ── Zoom SDK init ──
let sdkReady = false;
async function initSdk() {
  if (typeof zoomSdk === 'undefined') return;
  try {
    await Promise.race([
      zoomSdk.config({ capabilities: ['openUrl', 'getUserContext'] }),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 4000))
    ]);
    sdkReady = true;
    // Try to get agent identity automatically
    try {
      const ctx = await zoomSdk.getUserContext();
      const email = (ctx.email || '').toLowerCase();
      if (email && !agentEmail) {
        agentEmail = email;
        localStorage.setItem('ct_agent_email', email);
        log('Agent identified via SDK: ' + email);
        renderEmailUI();
      }
    } catch (_) {}
  } catch (e) {
    log('Zoom SDK unavailable — manual email entry used.');
  }
}

function renderEmailUI() {
  const inp = document.getElementById('agent-email-input');
  if (inp) inp.value = agentEmail;
  const lbl = document.getElementById('agent-email-label');
  if (lbl) lbl.textContent = agentEmail ? `Polling as: ${agentEmail}` : 'Enter your Zoom email to receive only your calls';
}

// ── Helpers ──
function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const now = new Date().toLocaleTimeString();
  el.innerHTML += `<div class="log-entry"><time>${now}</time>${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, type) {
  const bar = document.getElementById('sdk-status');
  if (!bar) return;
  bar.textContent = text;
  bar.style.color      = type === 'error'   ? '#842029'
                       : type === 'success'  ? '#1a7a3a'
                       : type === 'incoming' ? '#7b3f00'
                       : '#2372eb';
  bar.style.background = type === 'error'   ? '#f8d7da'
                       : type === 'success'  ? '#d4edda'
                       : type === 'incoming' ? '#fff3cd'
                       : '#e8f0fe';
}

function normalizePhone(raw) {
  return String(raw).replace(/\D/g, '').slice(-10);
}

function populateCard(data) {
  document.getElementById('cust-id').textContent         = data.customerId       || '—';
  document.getElementById('cust-appt').textContent       = data.appointmentId    || '—';
  document.getElementById('cust-phone').textContent      = data.phone            || '—';
  document.getElementById('cust-state').textContent      = data.stateId          || '—';
  document.getElementById('cust-partner').textContent    = data.partnerName      || '—';
  document.getElementById('cust-route').textContent      = data.recommendedRoute || '—';
  document.getElementById('customer-card').style.display = 'block';
}

async function tryOpenUrl(url) {
  // Strategy 1: Zoom Apps SDK openUrl (proper API for opening system browser)
  if (sdkReady && typeof zoomSdk !== 'undefined' && zoomSdk.openUrl) {
    try { await zoomSdk.openUrl({ url }); return 'sdk'; } catch (_) {}
  }
  // Strategy 2: window.open _system (some Electron webviews honor this)
  try { const w = window.open(url, '_system'); if (w) return 'window'; } catch (_) {}
  // Strategy 3: window.open _blank
  try { const w = window.open(url, '_blank'); if (w && !w.closed) return 'window'; } catch (_) {}
  // Strategy 4: navigator.clipboard (modern API)
  try { await navigator.clipboard.writeText(url); return 'clipboard'; } catch (_) {}
  // Strategy 5: execCommand copy (works in most Electron webviews)
  try {
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return 'clipboard';
  } catch (_) {}
  return false;
}

function showScreenpop(url) {
  const result = document.getElementById('result');
  // Show pulsing button + a selectable URL input as fallback
  result.innerHTML =
    `<a href="${url}" target="_blank" rel="noopener noreferrer" id="screenpop-link">` +
    `🖥️&nbsp; OPEN CARETALK360 ↗</a>` +
    `<input id="url-copy-input" type="text" value="${url}" readonly ` +
    `style="margin-top:8px;width:100%;font-size:10px;padding:4px;border:1px solid #ccc;` +
    `border-radius:4px;background:#f8f8f8;cursor:pointer;" title="Click to select URL" />`;
  result.className = 'result screenpop';
  result.style.display = 'block';

  // Auto-select URL input on click for easy Cmd+C
  setTimeout(() => {
    const inp = document.getElementById('url-copy-input');
    if (inp) inp.addEventListener('click', () => inp.select());

    const link = document.getElementById('screenpop-link');
    if (!link) return;
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const outcome = await tryOpenUrl(url);
      if (outcome === 'sdk' || outcome === 'window') {
        result.innerHTML = `✅ CareTalk360 opened in your browser!`;
        result.className = 'result success';
        log('CareTalk360 opened in system browser.');
      } else if (outcome === 'clipboard') {
        result.innerHTML = `📋 <strong>URL copied!</strong> Paste in your browser&nbsp;(Cmd+V / Ctrl+V).<br>` +
          `<small style="word-break:break-all;opacity:0.75;">${url}</small>`;
        result.className = 'result success';
        log('URL copied to clipboard — paste in browser.');
      } else {
        result.innerHTML = `⚠️ Click the URL below to select it, then copy &amp; paste in your browser:<br>` +
          `<input type="text" value="${url}" readonly onclick="this.select()" ` +
          `style="width:100%;font-size:10px;padding:4px;margin-top:6px;border:1px solid #ccc;border-radius:4px;" />`;
        result.className = 'result error';
      }
    });
  }, 50);
}

// ── Auto-poll for new calls ──
async function pollLatest() {
  try {
    // Use agent-specific endpoint if we know who this agent is
    const endpoint = agentEmail
      ? `/my-engagement?email=${encodeURIComponent(agentEmail)}`
      : `/latest-engagement`;
    const res  = await fetch(`${window.location.origin}${endpoint}`);
    const data = await res.json();

    if (data.ok && data.ts > lastSeenTs) {
      lastSeenTs = data.ts; // mark as seen so we don't re-trigger

      setStatus('📞 Incoming transfer detected!', 'incoming');
      log(`Transfer detected — caller: ${data.phone}`);

      // Fill phone field + customer card
      document.getElementById('phone-input').value = data.phone;
      populateCard(data);

      // Attempt to open in system browser automatically
      showScreenpop(data.url);

      // Also attempt auto-open immediately on detection
      const outcome = await tryOpenUrl(data.url);
      if (outcome === 'sdk' || outcome === 'window') {
        log('CareTalk360 opened automatically in your browser.');
      } else if (outcome === 'clipboard') {
        log('URL copied to clipboard — paste in browser.');
      } else {
        log('Click the OPEN CARETALK360 button above.');
      }
    }
  } catch (_) {
    // Silent — don't spam the log during normal idle polling
  }
}

// ── Manual phone lookup (fallback) ──
async function lookupEngagement() {
  const input  = document.getElementById('phone-input');
  const btn    = document.getElementById('lookup-btn');
  const result = document.getElementById('result');

  const phone = normalizePhone(input.value || '');
  if (phone.length < 7) {
    result.className = 'result error';
    result.textContent = '✗ Enter the caller\'s phone number first.';
    result.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Looking up…';
  result.style.display = 'none';
  log(`Manual lookup: ${phone}`);

  try {
    const res  = await fetch(`${window.location.origin}/get-engagement?phone=${phone}`);
    const data = await res.json();

    if (data.ok) {
      populateCard(data);
      showScreenpop(data.url);
      setStatus('Ready ✓', 'success');
      log(`CareTalk360 URL ready for ${data.customerId || phone}`);
    } else {
      result.className = 'result error';
      result.textContent = `✗ ${data.error || 'No data found. Has the flow run yet?'}`;
      result.style.display = 'block';
      log('Lookup failed: ' + (data.error || 'not found'));
    }
  } catch (err) {
    result.className = 'result error';
    result.textContent = '✗ Server error: ' + err.message;
    result.style.display = 'block';
    log('Error: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = 'Look Up';
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setStatus('Monitoring for incoming transfers…', 'info');
  log('App loaded. Listening for call transfers automatically.');
  initSdk();
  renderEmailUI();

  // Agent email save button
  document.getElementById('agent-email-save').addEventListener('click', () => {
    const val = (document.getElementById('agent-email-input').value || '').trim().toLowerCase();
    agentEmail = val;
    localStorage.setItem('ct_agent_email', val);
    renderEmailUI();
    log(val ? `Agent email saved: ${val}` : 'Agent email cleared — monitoring all calls.');
  });

  // Start polling
  setInterval(pollLatest, POLL_MS);
  pollLatest(); // check immediately on load

  document.getElementById('lookup-btn')
    .addEventListener('click', lookupEngagement);

  document.getElementById('phone-input')
    .addEventListener('keydown', e => {
      if (e.key === 'Enter') lookupEngagement();
    });
});
