// CareTalk360 Screenpop — background service worker
// Uses long-polling so the tab opens within ~2 seconds of the agent answering.
// Falls back to 30-second alarm polling as a safety net.

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

// ── Open tab when a new engagement arrives ────────────────────────────────
async function handleData(data) {
  const lastSeenTs = await getLastSeenTs();
  if (data.ok && data.ts > lastSeenTs) {
    await setLastSeenTs(data.ts);
    chrome.tabs.create({ url: data.url, active: true });
    console.log('[CareTalk] Opened CareTalk360 for', data.phone);
  }
}

// ── Long-poll: holds connection until server pushes a new call (≤25s) ─────
// The in-flight fetch keeps the service worker alive, and we restart
// immediately on completion — giving near-instant screenpop.
async function longPoll() {
  const agentEmail = await getAgentEmail();
  if (!agentEmail) {
    // No email set — retry in 10s
    setTimeout(longPoll, 10000);
    return;
  }

  const lastSeenTs = await getLastSeenTs();

  try {
    const res  = await fetch(
      `${SERVER}/wait-for-engagement?email=${encodeURIComponent(agentEmail)}&since=${lastSeenTs}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    await handleData(data);
  } catch (err) {
    console.warn('[CareTalk] Long-poll error:', err.message);
    // On network error wait 5s before retrying
    await new Promise(r => setTimeout(r, 5000));
  }

  // Always restart immediately — this loop keeps the SW alive
  longPoll();
}

// ── Alarm-based fallback poll (every 30s) ─────────────────────────────────
async function poll() {
  const lastSeenTs = await getLastSeenTs();
  const agentEmail = await getAgentEmail();

  const endpoint = agentEmail
    ? `${SERVER}/my-engagement?email=${encodeURIComponent(agentEmail)}`
    : `${SERVER}/latest-engagement`;

  try {
    let res  = await fetch(endpoint, { cache: 'no-store' });
    let data = await res.json();

    // If agent-specific lookup failed, fall back to latest engagement
    if (!data.ok && agentEmail) {
      const fallback = await fetch(`${SERVER}/latest-engagement`, { cache: 'no-store' });
      data = await fallback.json();
    }

    await handleData(data);
  } catch (err) {
    console.warn('[CareTalk] Poll failed:', err.message);
  }
}

// ── Alarm-based polling (reliable across SW restarts) ─────────────────────
chrome.alarms.create('poll', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') poll();
});

// ── On install / startup ──────────────────────────────────────────────────
async function init() {
  const existing = await getLastSeenTs();
  if (!existing) {
    await setLastSeenTs(Date.now());
    console.log('[CareTalk] Initialized — monitoring for new calls.');
  }
  poll();        // immediate snapshot check
  longPoll();    // start persistent long-poll loop
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Also start on any SW wake-up
poll();
longPoll();
