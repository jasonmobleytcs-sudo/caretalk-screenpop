const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Required OWASP security headers — MUST be before static middleware
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://appssdk.zoom.us; connect-src 'self' https://*.zoom.us; frame-ancestors 'self' https://*.zoom.us");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Log every request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | UA: ${req.headers['user-agent']?.substring(0, 80)}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory engagement store (keyed by normalized phone number) ──
// Zoom CC flow POSTs here via HTTP Request widget after setting variables.
// Entries expire after 4 hours.
const engagementStore = new Map();
const STORE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function normalizePhone(raw = '') {
  return String(raw).replace(/\D/g, '').slice(-10); // last 10 digits
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, val] of engagementStore) {
    if (now - val.ts > STORE_TTL_MS) engagementStore.delete(key);
  }
}

// ── POST /flow-data — called by Zoom CC flow HTTP Request widget ──
// Body: { phone, customerId, appointmentId, stateId, eligibilityId, partnerName, recommendedRoute }
app.post('/flow-data', (req, res) => {
  pruneExpired();
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  engagementStore.set(phone, {
    customerId:       req.body.customerId       || '',
    appointmentId:    req.body.appointmentId    || '',
    stateId:          req.body.stateId          || '',
    eligibilityId:    req.body.eligibilityId    || '',
    partnerName:      req.body.partnerName      || '',
    recommendedRoute: req.body.recommendedRoute || '',
    phone,
    ts: Date.now(),
  });

  console.log(`flow-data stored for ${phone}:`, engagementStore.get(phone));
  res.json({ ok: true });
});

// ── GET /get-engagement?phone=XXXXXXXXXX — panel looks up engagement by caller phone ──
app.get('/get-engagement', (req, res) => {
  pruneExpired();
  const phone = normalizePhone(req.query.phone);
  const data  = engagementStore.get(phone);

  if (!data) {
    return res.json({ ok: false, error: 'No engagement found for that number' });
  }

  const url = `https://caretalk360.com/dashboard/patient-teleHealth` +
              `?patientId=${encodeURIComponent(data.customerId)}` +
              `&appointmentId=${encodeURIComponent(data.appointmentId)}`;

  res.json({ ok: true, url, ...data });
});

// ── Cache-busting aliases ──
['app','v2','v3','v4','v5','v6','v7','v8','v9',
 'v10','v11','v12','v13','v14','v15','v16','v17','v18','v19','v20'].forEach(p =>
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))
);

// ── Debug: show store contents (non-sensitive, internal use) ──
app.get('/debug/store', (req, res) => {
  pruneExpired();
  const entries = [];
  for (const [phone, val] of engagementStore) {
    entries.push({ phone, ...val, age_min: Math.round((Date.now() - val.ts) / 60000) });
  }
  res.json({ count: entries.length, entries });
});

// ── Ping ──
app.get('/ping', (req, res) => {
  console.log('PING! User-Agent:', req.headers['user-agent']);
  res.json({ ok: true });
});

app.get('/oauth/callback', (req, res) => {
  const { code } = req.query;
  console.log('OAuth code received:', code);
  res.send('Authorization successful! You can close this window.');
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
