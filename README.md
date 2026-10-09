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

## Notes and limitations

- This is a local development starter, not a production-ready multi-user service.
- Express MemoryStore is used for sessions. It is not suitable for production.
- Tokens are held in the server-side session in memory and disappear when the server restarts.
- YouTube Analytics may return no rows for channels/date ranges without reportable data; recent dates can be incomplete.
- Metrics available through the API differ from YouTube Studio. This dashboard does not fabricate Shorts "Stayed to watch" or per-video retention metrics.
- PWA installation usually requires HTTPS when hosted, though localhost is treated as a secure context by modern browsers.
- Before public deployment, add a production session store, HTTPS, secure cookies, CSRF protections, rate limiting, privacy/terms pages, token revocation and deletion handling, and review Google OAuth verification requirements.
# YT-Mobile-Studio
# YT-Mobile-Studio
# YT-Mobile-Studio
