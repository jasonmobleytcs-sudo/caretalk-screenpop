let lastSeenTs = Date.now();
let lastUrl = null;

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (el) { el.textContent = text; el.style.color = color || '#27ae60'; }
}

async function poll() {
  try {
    const res  = await fetch('/latest-engagement');
    const data = await res.json();

    if (data.ok && data.ts > lastSeenTs) {
      lastSeenTs = data.ts;
      lastUrl = data.url;

      // Update last call info
      const info = document.getElementById('last-call');
      if (info) {
        info.style.display = 'block';
        document.getElementById('lc-phone').textContent = data.phone || '—';
        document.getElementById('lc-patient').textContent = data.customerId || '—';
        document.getElementById('lc-appt').textContent   = data.appointmentId || '—';
        const link = document.getElementById('lc-link');
        link.href = data.url;
      }

      // Try to open in new tab — works once popup permission is granted
      const win = window.open(data.url, '_blank');
      if (!win || win.closed) {
        setStatus('⚠️ Popup blocked — see instructions below', '#c0392b');
        document.getElementById('blocked-msg').style.display = 'block';
      } else {
        setStatus('✅ CareTalk360 opened!', '#27ae60');
        document.getElementById('blocked-msg').style.display = 'none';
      }
    }
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  // Manual open button
  document.getElementById('manual-btn').addEventListener('click', () => {
    if (lastUrl) window.open(lastUrl, '_blank');
  });

  setInterval(poll, 5000);
  poll();
});
