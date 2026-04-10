# Caretalk Screenpop — Zoom Contact Center App

A Zoom Contact Center app built with the Zoom Apps SDK that displays real-time engagement context to agents and triggers a Prismatic screenpop webhook with a single button click.

---

## What It Does

- Loads inside the Zoom desktop client during an active Contact Center engagement
- Displays engagement ID, channel, direction, consumer info, and agent name
- Listens for real-time engagement status and context changes via SDK events
- Sends engagement data to a Prismatic webhook to trigger a screenpop

---

## Prerequisites

- Zoom account with Contact Center enabled
- Node.js v18+ and npm
- ngrok account (free tier works for development)
- Prismatic account with a webhook-triggered flow
- Zoom Marketplace developer access (account owner, admin, or "Zoom for developers" role)

---

## Project Structure

```
zoom-contact-center-app/
├── public/
│   └── index.html          # App UI with Zoom Apps SDK + screenpop button
├── server.js               # Express server with OWASP headers + Prismatic proxy
├── package.json
├── generate_icon_v2.py     # Script to regenerate app icons
├── app_icon_light.png      # Light mode icon (1024px) — upload to Zoom Marketplace
├── app_icon_light_512.png  # Light mode icon (512px)
├── app_icon_dark.png       # Dark mode icon (1024px)
└── app_icon_dark_512.png   # Dark mode icon (512px)
```

---

## Setup Instructions

### 1. Install Dependencies

```bash
cd zoom-contact-center-app
npm install
```

### 2. Start the Local Server

```bash
node server.js
# Server runs on http://localhost:3000
```

### 3. Start ngrok Tunnel

```bash
# First time only — add your authtoken from dashboard.ngrok.com
ngrok config add-authtoken YOUR_NGROK_TOKEN

# Start the tunnel
ngrok http 3000
```

Copy the public URL ngrok gives you, e.g.:
```
https://your-subdomain.ngrok-free.dev
```

---

## Zoom Marketplace App Setup

### Step 1 — Create the App
1. Go to [marketplace.zoom.us](https://marketplace.zoom.us)
2. Click **Develop → Build App → General App (OAuth)**

### Step 2 — Basic Information
- **App managed by:** User-managed
- **OAuth Redirect URL:** `https://YOUR-NGROK-URL/oauth/callback`
- **OAuth Allow List:** `https://YOUR-NGROK-URL`

### Step 3 — Features → Surface Tab
- **Where to use:** Contact Center ✅
- **Home URL:** `https://YOUR-NGROK-URL`
- **Domain Allow List:** `YOUR-NGROK-URL` *(no https://)*

#### Enable Zoom App SDK → Add APIs:
| APIs | Events |
|------|--------|
| `getAppVariableList` | `onEngagementContextChange` |
| `getEngagementContext` | `onEngagementStatusChange` |
| `getEngagementStatus` | `onEngagementVariableValueChange` |
| `getEngagementVariableValue` | `onRunningContextChange` |
| `getRunningContext` | `onAuthorized` |
| `getAppContext` | `onAppPopout` |
| `appPopout` | |
| `promptAuthorize` | |

### Step 4 — Scopes (Optional)
Only needed if calling Zoom REST APIs. Add a scope description explaining data usage.

### Step 5 — App Listing
- Upload `app_icon_light_512.png` as the app icon
- Fill in Short Description and Long Description

### Step 6 — Beta Test
1. Go to **Beta Test** in the left nav
2. Generate the **Authorization URL**
3. Paste it in your browser and click **Allow**

---

## Contact Center Admin Setup

1. Go to your Zoom Admin portal → **Contact Center → Integrations → Zoom Apps**
2. Find your app and click **Configure**
3. **Queues:** Add the queues where agents should see this app
4. **Variables:** Optionally add Contact Center variables to expose to the app

---

## Prismatic Webhook

The app sends a `POST` request to your Prismatic webhook when the **Launch Screenpop** button is clicked.

### Webhook URL
Update `PRISMATIC_WEBHOOK` in `server.js`:

```js
const PRISMATIC_WEBHOOK = 'https://hooks.prismatic.io/trigger/YOUR_TRIGGER_ID';
```

### Payload Sent to Prismatic

```json
{
  "engagementId": "abc123",
  "channel": "voice",
  "direction": "inbound",
  "consumer": "555-123-4567",
  "agentName": "Jason Mobley",
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

The request is proxied through `/screenpop` on your server to avoid CORS issues.

---

## OWASP Security Headers

The server automatically adds all headers required by Zoom:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' https://appssdk.zoom.us; frame-ancestors 'self' https://*.zoom.us` |
| `Referrer-Policy` | `no-referrer` |

---

## Regenerating Icons

```bash
# Create a Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install Pillow

# Generate icons
python3 generate_icon_v2.py
# Outputs: app_icon_light.png, app_icon_dark.png (1024px)
#          app_icon_light_512.png, app_icon_dark_512.png (512px)
```

---

## How It Works in the Zoom Client

1. Agent receives an engagement on a configured queue
2. The Caretalk Screenpop app panel appears automatically in the Contact Center UI
3. The app loads engagement context (ID, channel, direction, consumer) via the Zoom Apps SDK
4. Agent clicks **Launch Screenpop**
5. The app POSTs engagement data to Prismatic via `/screenpop`
6. Prismatic runs the flow and triggers the screenpop in the target system

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| OWASP header warning in Marketplace | Restart server, re-paste Home URL to re-validate |
| ngrok warning page showing | Server sends `ngrok-skip-browser-warning: true` header automatically |
| Icon not updating in Zoom client | Replace cached file at `~/Library/Application Support/zoom.us/data/ZoomAppIcon/YOUR_CLIENT_ID.png` then restart Zoom |
| App not appearing in Contact Center | Check queue assignment in Contact Center Admin → Integrations |
| Prismatic webhook failing | Check `PRISMATIC_WEBHOOK` URL in `server.js` and verify the flow is active |

---

## App Credentials

> ⚠️ Never commit credentials to version control.

Store these securely:
- **Client ID:** Found in Zoom Marketplace → App Credentials
- **Client Secret:** Found in Zoom Marketplace → App Credentials
- **ngrok Auth Token:** Found at dashboard.ngrok.com/get-started/your-authtoken
