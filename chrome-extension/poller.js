// Web Worker — runs persistently inside the offscreen document.
// Polls the server every 5 seconds. When a new call arrives,
// posts a message which bubbles up to open a Chrome tab.

const SERVER = 'https://caretalk-screenpop-tlxu.onrender.com';

// Only trigger on calls that arrive AFTER this worker started
let lastSeenTs = Date.now();

async function poll() {
  try {
    const res  = await fetch(`${SERVER}/latest-engagement`);
    const data = await res.json();

    if (data.ok && data.ts > lastSeenTs) {
      lastSeenTs = data.ts;
      self.postMessage({ type: 'newCall', url: data.url });
    }
  } catch (_) {
    // Server unreachable — silent fail, try again next tick
  }
}

setInterval(poll, 5000); // poll every 5 seconds
poll();                  // check immediately on start
