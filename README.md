# Mobile Studio AI (local development)

A mobile-friendly PWA dashboard and AI Content Coach for YouTube creators, using YouTube Data API v3, YouTube Analytics API, and Google Gemini AI.

## Features

- **Analytics Overview**: View channel stats, watch time, likes, comments, shares, subscriber gains/losses, and daily breakdown.
- **Top Content Breakdown**: Track video-level performance and metadata across selected date windows (7, 28, or 90 days).
- **AI Content Coach**:
  - **Section A · Channel Health Snapshot**: Period-over-period comparison (current vs. equivalent previous period) with percentage and absolute changes, zero-baseline handling, and freshness warnings.
  - **Section B · What Is Working?**: Observable performance pattern analysis across top videos, distinguishing facts, correlations, and hypotheses without assuming causation.
  - **Section C · What Should I Make Next?**: 3–5 personalized video ideas grounded in channel metrics, with working titles, opening hooks, target audience, execution strategy, grounded citations, and batch regeneration.
  - **Section D · Improve My Next Upload**: Prioritized actionable experiments with expected learnings and evaluation methods.
  - **Section E · Ask the Content Coach**: Interactive Q&A grounded in bounded channel data with prompt-injection defense.
  - **Section F · Saved Ideas**: Scoped persistent storage per authenticated channel ID to save, review, and remove recommendations.

## Requirements

- Node.js 18 or later
- A Google Cloud project with YouTube Data API v3 and YouTube Analytics API enabled
- OAuth 2.0 Web application credentials
- (Optional) Google Gemini API key for full generative AI coaching (`GEMINI_API_KEY`)

## Install & Configuration

Set up dependencies and `.env`:
- `SESSION_SECRET`: Random 32+ byte string.
- `GOOGLE_CLIENT_ID`: Google OAuth Client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth Client Secret.
- `GOOGLE_REDIRECT_URI`: `http://localhost:3000/auth/callback`
- `GEMINI_API_KEY`: (Optional) Your Google Gemini API key. If omitted, the coach operates in grounded heuristic fallback mode.
- `GEMINI_MODEL`: (Optional) Gemini model name (default: `gemini-1.5-flash`).

## Google OAuth Setup

In Google Cloud Console:
1. Select your project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure OAuth consent screen.
4. Add Test users for testing apps.
5. Create an OAuth Client ID of type `Web application`.
6. Add Authorized redirect URI: `http://localhost:3000/auth/callback`.
7. Put the Client ID and Client Secret into `.env`.

OAuth Scopes requested:
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

## Run & Test

Check syntax and run unit tests:
- Run syntax checks: `npm run check`
- Run automated unit tests: `npm test`
- Start local application: `node server.js`

Open `http://localhost:3000` in your browser.

## AI Grounding & Safety Directives

- All provider API keys and model calls execute strictly server-side.
- Titles, descriptions, and comments are treated as untrusted data and sanitized to defend against prompt injection.
- Video citations in generated ideas are validated against actual channel video IDs.
- The coach never fabricates missing API metrics (e.g., audience retention curves or traffic sources when not provided by the API).
- Clear distinctions are drawn between observed facts, statistical correlations, and hypotheses.

## Notes & Limitations

- Local development mode: server listens on `127.0.0.1` only.
- Sessions use Express MemoryStore (resets on server restart).
- YouTube Analytics reports are subject to a 24–48 hour processing delay.
- Per-video views in a date-range Analytics report represent period views, not lifetime views.
