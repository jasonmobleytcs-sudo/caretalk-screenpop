const POLL_MS = 3000; // check for new calls every 3 seconds

// Only trigger on calls that arrive AFTER this panel loaded
let lastSeenTs = Date.now();

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
  // Strategy 1: Zoom SDK openUrl (if SDK is injected)
  if (typeof zoomSdk !== 'undefined' && zoomSdk.openUrl) {
    try { await zoomSdk.openUrl({ url }); return true; } catch (_) {}
  }
  // Strategy 2: window.open
  const win = window.open(url, '_blank');
  if (win && !win.closed) return true;
  // Strategy 3: clipboard copy
  try {
    await navigator.clipboard.writeText(url);
    return 'clipboard';
  } catch (_) {}
  return false;
}

function showScreenpop(url) {
  const result = document.getElementById('result');
  result.innerHTML =
    `<a href="${url}" target="_blank" rel="noopener noreferrer" id="screenpop-link">` +
    `🖥️&nbsp; OPEN CARETALK360 ↗</a>`;
  result.className = 'result screenpop';
  result.style.display = 'block';

  // Attach click handler that tries every method
  setTimeout(() => {
    const link = document.getElementById('screenpop-link');
    if (!link) return;
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const outcome = await tryOpenUrl(url);
      if (outcome === true) {
        result.innerHTML = `✅ CareTalk360 opened! &nbsp;<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;font-weight:700;">Open again ↗</a>`;
        result.className = 'result success';
      } else if (outcome === 'clipboard') {
        result.innerHTML = `📋 <strong>URL copied to clipboard.</strong> Paste it in your browser (Cmd+V / Ctrl+V).<br><small style="word-break:break-all;opacity:0.8;">${url}</small>`;
        result.className = 'result success';
        log('URL copied to clipboard — paste in browser.');
      } else {
        // Last resort: show URL to copy manually
        result.innerHTML = `⚠️ Could not open automatically.<br><small>Copy this URL manually:</small><br><code style="word-break:break-all;font-size:11px;">${url}</code>`;
        result.className = 'result error';
      }
    });
  }, 50);
}

// ── Auto-poll for new calls ──
async function pollLatest() {
  try {
    const res  = await fetch(`${window.location.origin}/latest-engagement`);
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
      if (outcome === true) {
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
