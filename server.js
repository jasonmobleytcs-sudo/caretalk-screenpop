const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Required OWASP security headers — MUST be before static middleware
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://appssdk.zoom.us; frame-ancestors 'self' https://*.zoom.us");
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Log every request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | UA: ${req.headers['user-agent']?.substring(0, 80)}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Prismatic Webhook URLs ──
const WEBHOOKS = {
  // Helper flow: wraps context + returns careTalkOpenUrl
  screenpop:   'https://hooks.prismatic.io/trigger/SW5zdGFuY2VGbG93Q29uZmlnOmM5ZGQ2ZDZiLWMzMzgtNDYyOS1iMjIyLTFhY2FjZjdjY2ZiYQ==',
  // Add your other webhook URLs here:
  // lookup:   'https://hooks.prismatic.io/trigger/...',
  // restore:  'https://hooks.prismatic.io/trigger/...',
  // save:     'https://hooks.prismatic.io/trigger/...',
};

// ── Helper: parse Prismatic response by flow type ──
function parsePrismaticResponse(json, flow) {
  if (flow === 'screenpop') {
    // Shape: { ok, context: {...}, careTalkOpenUrl: "https://..." }
    return {
      ok:         json.ok,
      url:        json.careTalkOpenUrl || null,
      customer:   json.context || {},
    };
  }

  // CRM Lookup / Restore / Save — top-level payload
  // Shape: { ok, matched, customerId, appointmentId, customerPhone, stateId, state, ... }
  return {
    ok:       json.ok,
    url:      null,
    customer: {
      customerId:       json.customerId,
      eligibilityId:    json.eligibilityId,
      appointmentId:    json.appointmentId,
      customerPhone:    json.customerPhone,
      stateId:          json.stateId,
      state:            json.state,
      recommendedRoute: json.recommendedRoute,
      partnerName:      json.partnerName,
      matched:          json.matched,
      matchType:        json.matchType,
    },
  };
}

// ── POST /screenpop — trigger helper flow, get careTalkOpenUrl ──
app.post('/screenpop', async (req, res) => {
  try {
    console.log('Screenpop triggered:', req.body);
    const response = await fetch(WEBHOOKS.screenpop, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const text = await response.text();
    console.log('Prismatic screenpop response:', response.status, text);

    const json = JSON.parse(text);
    const parsed = parsePrismaticResponse(json, 'screenpop');

    res.json({ success: true, ...parsed });
  } catch (err) {
    console.error('Screenpop error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /lookup — CRM State Lookup by phone ──
app.post('/lookup', async (req, res) => {
  try {
    console.log('CRM Lookup:', req.body);
    const response = await fetch(WEBHOOKS.lookup, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const json = await response.json();
    const parsed = parsePrismaticResponse(json, 'lookup');
    res.json({ success: true, ...parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Ping endpoint ──
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
