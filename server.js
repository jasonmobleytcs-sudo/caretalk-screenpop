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
      _zoomToken      = d.access_token;
      _zoomApiBase    = (d.api_url || 'https://api.zoom.us').replace(/\/$/, '');
      _zoomTokenExpiry = Date.now() + d.expires_in * 1000;
      console.log(`[zoom-token] OK scope="${d.scope}" api=${_zoomApiBase}`);
      return _zoomToken;
    }
    console.warn('[zoom-token] Failed:', JSON.stringify(d));
  } catch (e) { console.warn('[zoom-token] Error:', e.message); }
  return null;
}
let _zoomApiBase = 'https://api.zoom.us';

async function lookupAgentEmail(userId) {
  const token = await getZoomToken();
  if (!token) return null;
  try {
    const url = `${_zoomApiBase}/v2/users/${userId}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) {
      console.warn(`[zoom-lookup] Failed for ${userId}: ${d.message || r.status}`);
      return null;
    }
    console.log(`[zoom-lookup] ${userId} → ${d.email}`);
    return (d.email || '').toLowerCase() || null;
  } catch (e) { console.warn('[zoom-lookup] Error:', e.message); return null; }
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

// Phone/engagementId → CRM data (populated by Zoom CC flow HTTP Request widget)
// Key is phone number for voice, engagementId for video/chat (no phone available)
const engagementStore = new Map();

// AgentEmail/AgentId → { storeKey, ts } (populated by Zoom CC webhook)
// storeKey is phone for voice, engagementId for video/chat
const agentToPhone = new Map();

// Email → userId mapping (populated by panel on load via /register-agent)
const emailToUserId = new Map();

// Most recently received call phone (fallback for non-agent-specific polling)
let latestPhone = null;

// Long-poll waiting clients: key → { res, timer, since }
const waitingClients = new Map();

// Dedup map: `${agentId}:${storeKey}` → ts
// Prevents double-pop when Zoom fires both video + chat events for the same answer
const recentEngagements = new Map();

function notifyWaitingClients(keys, phone, mappingTs) {
  const data = engagementStore.get(phone);
  if (!data) return;
  for (const key of keys) {
    if (!key) continue;
    const client = waitingClients.get(key);
    // Use mappingTs (when THIS agent answered) not data.ts (when CRM data arrived).
    // This prevents stale mappings from re-firing on a future call to the same phone.
    if (client && mappingTs > client.since) {
      clearTimeout(client.timer);
      client.res.json({ ok: true, url: buildUrl(data), ...data, ts: mappingTs });
      waitingClients.delete(key);
    }
  }
}

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
  for (const [k, v] of recentEngagements) {
    if (now - v > 60000) recentEngagements.delete(k);
  }
}

// ── POST /flow-data ───────────────────────────────────────────────────────
// Called by Zoom CC flow HTTP Request widget before routing to queue.
// Voice calls use phone as the store key.
// Video/chat calls have no phone — use engagementId as the store key instead.
app.post('/flow-data', (req, res) => {
  pruneExpired();
  const phone        = normalizePhone(req.body.phone);
  const engagementId = (req.body.engagementId || '').trim();

  // Use phone if available, fall back to engagementId for video/chat
  const storeKey = phone || engagementId;
  if (!storeKey) return res.status(400).json({ ok: false, error: 'phone or engagementId required' });

  const entry = {
    customerId:       req.body.customerId       || '',
    appointmentId:    req.body.appointmentId    || '',
    stateId:          req.body.stateId          || '',
    eligibilityId:    req.body.eligibilityId    || '',
    partnerName:      req.body.partnerName      || '',
    recommendedRoute: req.body.recommendedRoute || '',
    phone,
    engagementId,
    storeKey,
    ts: Date.now(),
  };
  engagementStore.set(storeKey, entry);
  // NOTE: latestPhone is intentionally NOT set here.
  // It is set in the webhook handler when an agent actually answers,
  // so /latest-engagement only fires after answer — not when the call enters the flow.
  console.log(`[flow-data] stored for storeKey=${storeKey} (phone=${phone || 'none'} engagementId=${engagementId || 'none'})`);
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

    // Extract engagementId — used as store key for video/chat where phone is absent
    const engagementId = (
      obj.engagement_id   ||
      obj.engagementId    ||
      payload.engagement_id ||
      ''
    ).trim();

    // Use phone if available (voice), fall back to engagementId (video/chat)
    const storeKey = phone || engagementId;

    if (storeKey && (agentId || agentEmail)) {
      // ── Dedup: Zoom fires both a video AND chat event for the same video answer ──
      // Skip if we already handled this agent+engagement within the last 10 seconds
      const dedupeKey = `${agentId || agentEmail}:${storeKey}`;
      const lastHandled = recentEngagements.get(dedupeKey);
      if (lastHandled && Date.now() - lastHandled < 10000) {
        console.log(`[webhook] Duplicate event skipped for ${dedupeKey}`);
        return res.json({ ok: true });
      }
      recentEngagements.set(dedupeKey, Date.now());
      // Clean up dedup map after 30s
      setTimeout(() => recentEngagements.delete(dedupeKey), 30000);

      const mapping = { phone: storeKey, ts: Date.now() };
      if (agentId)    agentToPhone.set(agentId, mapping);
      if (agentEmail) agentToPhone.set(agentEmail, mapping);
      if (phone) latestPhone = phone; // only set for voice calls
      console.log(`[webhook] Agent ${agentId || agentEmail} (${obj.user_display_name || ''}) answered — storeKey=${storeKey} (phone=${phone || 'none'} engagementId=${engagementId || 'none'})`);

      // Notify any long-polling clients waiting on userId or email right away
      notifyWaitingClients([agentId, agentEmail], storeKey, mapping.ts);

      // Async: look up agent's email from Zoom API so email-based polls also work
      if (agentId && !agentEmail) {
        lookupAgentEmail(agentId).then(email => {
          if (email) {
            agentToPhone.set(email, mapping);
            emailToUserId.set(email, agentId);
            console.log(`[webhook] Resolved ${agentId} → ${email}`);
            // Notify clients waiting on email key
            notifyWaitingClients([email], storeKey, mapping.ts);
          }
        }).catch(() => {});
      }
    } else {
      console.warn('[webhook] Could not extract agent or storeKey. agentId:', agentId, 'phone:', phone, 'engagementId:', engagementId, 'obj:', JSON.stringify(obj).substring(0, 200));
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

  // Use mapping.ts (when THIS agent answered) as the response ts.
  // This prevents a stale mapping from matching on a later call to the same phone number.
  res.json({ ok: true, url: buildUrl(data), ...data, ts: mapping.ts });
});

// ── GET /wait-for-engagement  (long-poll — returns instantly when agent answers) ──
app.get('/wait-for-engagement', (req, res) => {
  pruneExpired();
  const email  = (req.query.email  || '').toLowerCase();
  const userId = (req.query.userId || '').trim();
  const since  = parseInt(req.query.since) || 0;

  // Resolve key: prefer explicit userId, then email→userId map, then email itself
  const key = userId || (email && emailToUserId.get(email)) || email;
  if (!key) return res.json({ ok: false, error: 'email required' });

  // Check if data already available
  const mapping = agentToPhone.get(key);
  if (mapping) {
    const data = engagementStore.get(mapping.phone);
    // Use mapping.ts (when THIS agent answered) so stale mappings don't re-fire
    // on a later call to the same phone number.
    if (data && mapping.ts > since) {
      return res.json({ ok: true, url: buildUrl(data), ...data, ts: mapping.ts });
    }
  }

  // Also check latestPhone for fallback (no-email-configured agents)
  if (!email) {
    const data = latestPhone && engagementStore.get(latestPhone);
    if (data && data.ts > since) return res.json({ ok: true, url: buildUrl(data), ...data });
  }

  // Hold the connection — resolve when webhook fires (max 25s then return empty)
  res.setHeader('Content-Type', 'application/json');
  const timer = setTimeout(() => {
    waitingClients.delete(key);
    if (email !== key) waitingClients.delete(email);
    res.json({ ok: false });
  }, 25000);

  const entry = { res, timer, since };
  waitingClients.set(key, entry);
  if (email && email !== key) waitingClients.set(email, entry);

  req.on('close', () => {
    clearTimeout(timer);
    waitingClients.delete(key);
    if (email !== key) waitingClients.delete(email);
  });
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

// ── S2S token + user-lookup test ──────────────────────────────────────────
app.get('/debug/s2s', async (req, res) => {
  const userId = (req.query.userId || 'vzUtoOpXTGCjKVOec7n48w').trim();
  const report = {
    env: {
      ZOOM_S2S_ACCOUNT_ID:     !!process.env.ZOOM_S2S_ACCOUNT_ID,
      ZOOM_S2S_CLIENT_ID:      !!process.env.ZOOM_S2S_CLIENT_ID,
      ZOOM_S2S_CLIENT_SECRET:  !!process.env.ZOOM_S2S_CLIENT_SECRET,
    },
    token: null,
    tokenError: null,
    lookup: null,
    lookupError: null,
  };
  try {
    const token = await getZoomToken();
    report.token = token ? 'OK (obtained)' : 'null — getZoomToken returned null';
    if (token) {
      try {
        const url = `${_zoomApiBase}/v2/users/${userId}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        if (r.ok) {
          report.lookup = { email: d.email, display_name: d.display_name, status: d.status };
        } else {
          report.lookupError = { status: r.status, body: d };
        }
      } catch (e) { report.lookupError = e.message; }
    }
  } catch (e) { report.tokenError = e.message; }
  res.json(report);
});

// ── Ping ──────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ ok: true }));

app.get('/oauth/callback', (req, res) => {
  console.log('OAuth code:', req.query.code);
  res.send('Authorization successful! You can close this window.');
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
