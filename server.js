const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const app     = express();

// ── Zoom S2S OAuth — auto-lookup agent email from userId ──────────────────
let _zoomToken = null;
let _zoomTokenExpiry = 0;

async function getZoomToken() {
  if (_zoomToken && Date.now() < _zoomTokenExpiry - 60000) return _zoomToken;
  const acct   = process.env.ZOOM_S2S_ACCOUNT_ID;
  const cid    = process.env.ZOOM_S2S_CLIENT_ID;
  const csecret= process.env.ZOOM_S2S_CLIENT_SECRET;
  if (!acct || !cid || !csecret) return null;
  try {
    const creds = Buffer.from(`${cid}:${csecret}`).toString('base64');
    const r = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${acct}`,
      { method: 'POST', headers: { Authorization: `Basic ${creds}` } }
    );
    const d = await r.json();
    if (d.access_token) {
      _zoomToken = d.access_token;
      _zoomTokenExpiry = Date.now() + d.expires_in * 1000;
      return _zoomToken;
    }
  } catch (_) {}
  return null;
}

async function lookupAgentEmail(userId) {
  const token = await getZoomToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://api.zoom.us/v2/users/${userId}`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.email || '').toLowerCase() || null;
  } catch (_) { return null; }
}

// Capture raw body before JSON parsing (needed for webhook signature verification)
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

// ── Security + no-cache headers ───────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://appssdk.zoom.us; connect-src 'self' https://*.zoom.us; frame-ancestors 'self' https://*.zoom.us");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ── Request logger ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory stores ──────────────────────────────────────────────────────
const STORE_TTL_MS  = 4 * 60 * 60 * 1000; // 4 hours
const AGENT_TTL_MS  = 2 * 60 * 60 * 1000; // 2 hours

// Phone → CRM data (populated by Zoom CC flow HTTP Request widget)
const engagementStore = new Map();

// AgentEmail/AgentId → phone (populated by Zoom CC webhook)
const agentToPhone = new Map();

// Email → userId mapping (populated by panel on load via /register-agent)
const emailToUserId = new Map();

// Most recently received call phone (fallback for non-agent-specific polling)
let latestPhone = null;

// Recent webhook payloads for debugging
const webhookLog = [];

function normalizePhone(raw = '') {
  return String(raw).replace(/\D/g, '').slice(-10);
}

function buildUrl(data) {
  return `https://caretalk360.com/dashboard/patient-teleHealth` +
         `?patientId=${encodeURIComponent(data.customerId || '')}` +
         `&appointmentId=${encodeURIComponent(data.appointmentId || '')}`;
}

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of engagementStore) {
    if (now - v.ts > STORE_TTL_MS) engagementStore.delete(k);
  }
  for (const [k, v] of agentToPhone) {
    if (now - v.ts > AGENT_TTL_MS) agentToPhone.delete(k);
  }
}

// ── POST /flow-data ───────────────────────────────────────────────────────
// Called by Zoom CC flow HTTP Request widget before routing to queue.
app.post('/flow-data', (req, res) => {
  pruneExpired();
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  const entry = {
    customerId:       req.body.customerId       || '',
    appointmentId:    req.body.appointmentId    || '',
    stateId:          req.body.stateId          || '',
    eligibilityId:    req.body.eligibilityId    || '',
    partnerName:      req.body.partnerName      || '',
    recommendedRoute: req.body.recommendedRoute || '',
    phone,
    ts: Date.now(),
  };
  engagementStore.set(phone, entry);
  // NOTE: latestPhone is intentionally NOT set here.
  // It is set in the webhook handler when an agent actually answers,
  // so /latest-engagement only fires after answer — not when the call enters the flow.
  console.log(`[flow-data] stored for ${phone}`);
  res.json({ ok: true });
});

// ── POST /webhook/zoom-cc ─────────────────────────────────────────────────
// Zoom CC fires this when an agent accepts a call.
// Stores agentEmail → phone mapping so each agent gets only their own screenpop.
app.post('/webhook/zoom-cc', (req, res) => {
  const body = req.body || {};

  // Keep last 20 payloads for debugging
  webhookLog.unshift({ ts: Date.now(), event: body.event, payload: body.payload });
  if (webhookLog.length > 20) webhookLog.pop();

  // ── Zoom URL validation challenge ──
  if (body.event === 'endpoint.url_validation') {
    const token = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '';
    const hash  = crypto.createHmac('sha256', token)
                        .update(body.payload?.plainToken || '')
                        .digest('hex');
    console.log('[webhook] URL validation challenge responded');
    return res.json({ plainToken: body.payload?.plainToken, encryptedToken: hash });
  }

  // ── Signature verification ──
  const secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (secretToken) {
    const ts  = req.headers['x-zm-request-timestamp'] || '';
    const sig = req.headers['x-zm-signature'] || '';
    const expected = 'v0=' + crypto
      .createHmac('sha256', secretToken)
      .update(`v0:${ts}:${req.rawBody}`)
      .digest('hex');
    if (sig !== expected) {
      console.warn('[webhook] Signature mismatch — rejected');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event   = body.event || '';
  const payload = body.payload || {};
  console.log(`[webhook] ${event}`, JSON.stringify(payload).substring(0, 300));

  // ── Handle agent-accepted engagement events ──
  const AGENT_EVENTS = [
    'contact_center.engagement_user_answered',   // confirmed actual event name
    'contact_center.engagement_agent_accepted',
    'contact_center.engagement_connected',
    'contact_center.engagement_answered',
    'contact_center.engagement_agent_connected',
    'contact_center.engagement_assigned',
    'contact_center.engagement_updated',
  ];

  if (AGENT_EVENTS.includes(event)) {
    // Zoom CC sends data under payload.object for engagement_user_answered
    const obj = payload.object || {};

    // Extract agent identifier — try object shape first, then legacy shapes
    const agentId = (
      obj.user_id                          ||
      payload.operator?.user_id            ||
      payload.operator?.id                 ||
      payload.agent?.user_id               ||
      payload.agent?.id                    ||
      payload.engagement?.operator?.user_id ||
      ''
    );

    const agentEmail = (
      obj.user_email                       ||
      payload.operator?.email              ||
      payload.agent?.email                 ||
      payload.engagement?.operator?.email  ||
      ''
    ).toLowerCase();

    // Extract caller phone — object shape first, then legacy
    const rawPhone = (
      obj.consumer_number                        ||
      obj.ani                                    ||
      payload.consumer?.phone_number             ||
      payload.engagement?.consumer?.phone_number ||
      payload.engagement?.ani                    ||
      payload.ani                                ||
      payload.caller_number                      ||
      ''
    );
    const phone = normalizePhone(rawPhone);

    if (phone && (agentId || agentEmail)) {
      const mapping = { phone, ts: Date.now() };
      if (agentId)    agentToPhone.set(agentId, mapping);
      if (agentEmail) agentToPhone.set(agentEmail, mapping);
      latestPhone = phone; // only set here so /latest-engagement fires on answer, not on flow entry
      console.log(`[webhook] Agent ${agentId || agentEmail} (${obj.user_display_name || ''}) answered call from ${phone}`);

      // Async: look up agent's email from Zoom API so email-based polls work
      if (agentId && !agentEmail) {
        lookupAgentEmail(agentId).then(email => {
          if (email) {
            agentToPhone.set(email, mapping);
            emailToUserId.set(email, agentId);
            console.log(`[webhook] Resolved ${agentId} → ${email}`);
          }
        }).catch(() => {});
      }
    } else {
      console.warn('[webhook] Could not extract agent or phone. agentId:', agentId, 'phone:', phone, 'obj:', JSON.stringify(obj).substring(0, 200));
    }
  }

  res.json({ ok: true });
});

// ── POST /register-agent  (panel calls this on load to map email → userId) ──
app.post('/register-agent', (req, res) => {
  const email  = (req.body.email  || '').toLowerCase().trim();
  const userId = (req.body.userId || '').trim();
  if (email && userId) {
    emailToUserId.set(email, userId);
    console.log(`[register] ${email} → ${userId}`);
  }
  res.json({ ok: true });
});

// ── GET /my-engagement?email=XXX  (agent-specific) ────────────────────────
app.get('/my-engagement', (req, res) => {
  pruneExpired();
  const email   = (req.query.email   || '').toLowerCase();
  const userId  = (req.query.userId  || req.query.agentId || '').trim();

  // Try direct userId lookup first, then email→userId lookup, then email directly
  const key = userId
    || (email && emailToUserId.get(email))
    || email;

  if (!key) return res.json({ ok: false, error: 'email or userId required' });

  const mapping = agentToPhone.get(key);
  if (!mapping) return res.json({ ok: false, error: 'No active engagement for this agent' });

  const data = engagementStore.get(mapping.phone);
  if (!data)  return res.json({ ok: false, error: 'Engagement data not in store' });

  res.json({ ok: true, url: buildUrl(data), ...data });
});

// ── GET /latest-engagement  (fallback — most recent call, all agents) ─────
app.get('/latest-engagement', (req, res) => {
  pruneExpired();
  if (!latestPhone) return res.json({ ok: false });
  const data = engagementStore.get(latestPhone);
  if (!data || Date.now() - data.ts > 5 * 60 * 1000) return res.json({ ok: false });
  res.json({ ok: true, url: buildUrl(data), ...data });
});

// ── GET /get-engagement?phone=XXXXXXXXXX  (manual panel lookup) ───────────
app.get('/get-engagement', (req, res) => {
  pruneExpired();
  const phone = normalizePhone(req.query.phone);
  const data  = engagementStore.get(phone);
  if (!data) return res.json({ ok: false, error: 'No engagement found for that number' });
  res.json({ ok: true, url: buildUrl(data), ...data });
});

// ── Screenpop tab (served to real Chrome, relaxed CSP) ────────────────────
app.get('/screenpop-tab', (req, res) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  res.sendFile(path.join(__dirname, 'public', 'screenpop-tab.html'));
});

// ── Cache-busting aliases ─────────────────────────────────────────────────
['app','v2','v3','v4','v5','v6','v7','v8','v9',
 'v10','v11','v12','v13','v14','v15','v16','v17','v18','v19','v20'].forEach(p =>
  app.get(`/${p}`, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))
);

// ── Debug endpoints ───────────────────────────────────────────────────────
app.get('/debug/store',    (req, res) => { pruneExpired(); const e = []; for (const [phone, v] of engagementStore) e.push({ phone, ...v, age_min: Math.round((Date.now()-v.ts)/60000) }); res.json({ count: e.length, entries: e }); });
app.get('/debug/agents',   (req, res) => { pruneExpired(); const a = []; for (const [key, v] of agentToPhone) a.push({ key, phone: v.phone, age_min: Math.round((Date.now()-v.ts)/60000) }); res.json({ count: a.length, agents: a }); });
app.get('/debug/webhooks', (req, res) => res.json({ count: webhookLog.length, log: webhookLog }));

// ── Ping ──────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ ok: true }));

app.get('/oauth/callback', (req, res) => {
  console.log('OAuth code:', req.query.code);
  res.send('Authorization successful! You can close this window.');
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
