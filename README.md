# Mobile Studio AI (local development)

A mobile-friendly PWA dashboard for a YouTube channel, using YouTube Data API v3 and YouTube Analytics API. No Gemini integration is included.

## Requirements

- Node.js 18 or later (Termux: `pkg install nodejs-lts`)
- A Google Cloud project with YouTube Data API v3 and YouTube Analytics API enabled
- OAuth 2.0 Web application credentials

## Install

```bash
npm install
cp .env.example .env
openssl rand -hex 32
nano .env
```

Paste the generated random value into `SESSION_SECRET` and fill in the real OAuth Client ID and Client Secret. Do not share or commit `.env`.

## Google OAuth setup

In Google Cloud Console:
1. Select your project.
2. Enable YouTube Data API v3 and YouTube Analytics API.
3. Configure Google Auth Platform branding and audience.
4. For External/Testing apps, add the Google account you will use under Test users where applicable.
5. Create an OAuth Client ID with application type `Web application`.
6. Add Authorized redirect URI exactly: `http://localhost:3000/auth/callback`.
7. Put the generated Client ID and Client Secret into `.env`.

For local development, do not expose this server to the internet. This app requests:
- `youtube.readonly`
- `yt-analytics.readonly`

## Run

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000` in the same device/browser environment where the local server runs. For a desktop browser, run this project on the PC itself; `localhost` on another device refers to that other device.

## Data freshness and auto-refresh

- The dashboard refreshes automatically every **60 seconds** by default. Configure with `AUTO_REFRESH_SECONDS` in `.env` (clamped to 30–3600 seconds to protect YouTube API quota).
- A manual **↻ Refresh data** button triggers an immediate refresh. Refreshes never overlap: if one is in flight, additional requests (auto or manual) are ignored.
- Auto-refresh pauses while the browser tab is hidden and refreshes once when you return to a stale tab.
- API responses are always sent with `Cache-Control: no-store`; the service worker never caches `/api/` or `/auth/` requests, so analytics are not served stale from HTTP or service-worker caches.
- The YouTube Analytics API is **not** real-time. Reports typically lag by 1–3 days, so the selected date range ends **2 days before today** (see `lib/metrics.js`). The UI labels the range and the lag.

## Lifetime totals vs selected-period metrics

These come from two different YouTube APIs and are labeled separately in the UI:

- **Channel cards** (total channel views, subscribers, video count) come from the **YouTube Data API** (`channels.list` statistics) and are all-time accumulated totals.
- **Channel report and per-video metrics** (views, minutes watched, likes, comments, shares, subscriber changes for the selected date range) come from the **YouTube Analytics API** and cover only the selected reporting period — they are not lifetime numbers.
- **Lifetime views per video** are fetched from the Data API `videos.list` statistics field and shown as a separate chip ("Lifetime views (Data API)") on each video card. Data API and Analytics numbers can differ slightly; the app does not merge or fake them.

## Zero, missing, and failed data

- Days with no channel activity are omitted by the Analytics API entirely; the app does not turn them into fake `0` rows.
- A metric the API did not return shows as `—` (unavailable), never as a fabricated `0`. A genuine all-zero report still shows `0`.
- Each section (channel/report and videos) loads independently. If one request fails, the other still renders, the error banner explains what failed, and the last successful data is kept on screen.
- Each section shows its own "last updated" timestamp, recorded only after that section's request actually succeeded. Failed refreshes are never marked successful.
- Hidden subscriber counts (when the owner hides them) are displayed as "ซ่อนอยู่" with an explanation, not as an empty value.
- Server logs include per-request timing and sanitized Google error details. Access tokens, refresh tokens, secrets, and request headers are never logged.

## Notes and limitations

- This is a local development starter, not a production-ready multi-user service.
- Express MemoryStore is used for sessions. It is not suitable for production.
- Tokens are held in the server-side session in memory and disappear when the server restarts.
- YouTube Analytics may return no rows for channels/date ranges without reportable data; recent dates can be incomplete and the API is not real-time.
- Metrics available through the API differ from YouTube Studio. This dashboard does not fabricate Shorts "Stayed to watch" or per-video retention metrics.
- PWA installation usually requires HTTPS when hosted, though localhost is treated as a secure context by modern browsers.
- Before public deployment, add a production session store, HTTPS, secure cookies, CSRF protections, rate limiting, privacy/terms pages, token revocation and deletion handling, and review Google OAuth verification requirements.
