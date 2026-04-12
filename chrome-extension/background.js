// CareTalk360 Screenpop — background service worker
// Polls the server every 30 seconds via chrome.alarms.
// When a new call is detected, opens CareTalk360 in a new Chrome tab.

const SERVER = 'https://caretalk-screenpop.onrender.com';

// ── Helpers ──────────────────────────────────────────────────────────────
async function getLastSeenTs() {
  const r = await chrome.storage.local.get(['lastSeenTs']).catch(() => ({}));
  return r.lastSeenTs || 0;
}

async function setLastSeenTs(ts) {
  await chrome.storage.local.set({ lastSeenTs: ts }).catch(() => {});
}

async function getAgentEmail() {
  const r = await chrome.storage.local.get(['agentEmail']).catch(() => ({}));
  return r.agentEmail || '';
}

// ── Main poll ─────────────────────────────────────────────────────────────
async function poll() {
  const lastSeenTs = await getLastSeenTs();
  const agentEmail = await getAgentEmail();

  // Use agent-specific endpoint if email is configured, otherwise latest
  const endpoint = agentEmail
    ? `${SERVER}/my-engagement?email=${encodeURIComponent(agentEmail)}`
    : `${SERVER}/latest-engagement`;

  try {
    const res  = await fetch(endpoint, { cache: 'no-store' });
    const data = await res.json();

    if (data.ok && data.ts > lastSeenTs) {
      await setLastSeenTs(data.ts);
      chrome.tabs.create({ url: data.url, active: true });
      console.log('[CareTalk] Opened CareTalk360 for', data.phone);
    }
  } catch (err) {
    console.warn('[CareTalk] Poll failed:', err.message);
  }
}

// ── Alarm-based polling (reliable across SW restarts) ─────────────────────
// Chrome 120+: minimum is 30 seconds (periodInMinutes: 0.5)
// Chrome < 120: Chrome clamps to 1 minute automatically
chrome.alarms.create('poll', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') poll();
});

// ── On install / startup — set baseline so old calls don't trigger ─────────
async function init() {
  const existing = await getLastSeenTs();
  if (!existing) {
    // First run: ignore any calls already in the store
    await setLastSeenTs(Date.now());
    console.log('[CareTalk] Initialized — monitoring for new calls.');
  }
  poll(); // check right away
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Also poll once whenever the SW is woken up by any event
poll();
