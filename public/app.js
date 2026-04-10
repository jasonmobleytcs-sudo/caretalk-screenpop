const CARETALK_BASE = 'https://caretalk360.com/dashboard/patient-teleHealth';

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
  bar.style.color      = type === 'error' ? '#842029' : type === 'success' ? '#1a7a3a' : '#2372eb';
  bar.style.background = type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda'  : '#e8f0fe';
}

function normalizePhone(raw) {
  return raw.replace(/\D/g, '').slice(-10);
}

// ── Phone Lookup ──
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
  log(`Looking up phone: ${phone}`);

  try {
    const res  = await fetch(`${window.location.origin}/get-engagement?phone=${phone}`);
    const data = await res.json();

    if (data.ok) {
      // Populate customer card
      document.getElementById('cust-id').textContent    = data.customerId    || '—';
      document.getElementById('cust-appt').textContent  = data.appointmentId || '—';
      document.getElementById('cust-phone').textContent = data.phone         || '—';
      document.getElementById('cust-state').textContent = data.stateId       || '—';
      document.getElementById('cust-partner').textContent     = data.partnerName      || '—';
      document.getElementById('cust-route').textContent       = data.recommendedRoute || '—';
      document.getElementById('customer-card').style.display  = 'block';

      result.innerHTML =
        `✓ <a href="${data.url}" target="_blank" rel="noopener noreferrer"
            style="color:inherit;font-weight:700;font-size:15px;">
           🖥️ Open CareTalk360 ↗
         </a>`;
      result.className = 'result success';
      result.style.display = 'block';
      setStatus('Ready ✓', 'success');
      log(`CareTalk360 URL ready for ${data.customerId}`);
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

// Allow Enter key in phone field
document.addEventListener('DOMContentLoaded', () => {
  setStatus('Ready — enter caller phone to look up');
  log('App loaded. Enter the caller\'s phone number to get the CareTalk360 link.');

  const input = document.getElementById('phone-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') lookupEngagement();
    });
  }
});
