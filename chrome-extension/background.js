const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

async function ensureOffscreen() {
  // Check if offscreen doc is already running
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  }).catch(() => []);

  if (contexts.length > 0) return; // already running

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS'],
      justification: 'Background Web Worker polls for incoming call transfers every 5 seconds'
    });
  } catch (e) {
    console.error('[CareTalk] Failed to create offscreen doc:', e.message);
  }
}

// When the poller detects a new call, open CareTalk360 in a new active tab
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'newCall') {
    chrome.tabs.create({ url: msg.url, active: true });
  }
});

// Start polling on install and browser startup
chrome.runtime.onInstalled.addListener(() => ensureOffscreen());
chrome.runtime.onStartup.addListener(() => ensureOffscreen());

// Revive the offscreen doc every minute in case Chrome killed it
chrome.alarms.create('revive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => ensureOffscreen());
