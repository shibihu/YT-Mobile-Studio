import "dotenv/config";
import express from "express";
import session from "express-session";
import { google } from "googleapis";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANALYTICS_END_LAG_DAYS,
  DAILY_METRICS,
  VIDEO_METRICS,
  dateRange,
  normalizeReportRows,
  sumMetricTotals
} from "./lib/metrics.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = "127.0.0.1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Client auto-refresh interval in seconds. Clamped so a bad value cannot
// cause excessive YouTube API polling (quota burn).
const AUTO_REFRESH_SECONDS = (() => {
  const raw = Number.parseInt(process.env.AUTO_REFRESH_SECONDS ?? "", 10);
  if (!Number.isFinite(raw)) return 60;
  return Math.min(3600, Math.max(30, raw));
})();

const required = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI"
];
for (const key of required) {
  if (!process.env[key] || process.env[key].startsWith("REPLACE_")) {
    throw new Error(`Missing configuration in .env: ${key}`);
  }
}
if (process.env.GOOGLE_REDIRECT_URI !== `http://localhost:${PORT}/auth/callback`) {
  throw new Error(
    `For this local setup, GOOGLE_REDIRECT_URI must be http://localhost:${PORT}/auth/callback`
  );
}

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly"
];

app.disable("x-powered-by");
app.use(express.json({ limit: "15kb" }));
app.use(session({
  name: "mobile-studio.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // Localhost only. Use HTTPS + secure:true when deployed.
    maxAge: 60 * 60 * 1000
  }
}));

// This development server intentionally listens on loopback only.
app.use(express.static(path.join(__dirname, "public"), {
  index: "index.html",
  setHeaders(res, filePath) {
    if (filePath.endsWith("service-worker.js")) {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    // Keep the app shell fresh; the service worker also refreshes these.
    if (/\.(?:html|js|css|webmanifest)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.get("host") || !["http:", "https:"].includes(parsed.protocol)) {
        return res.status(403).json({ error: "Cross-origin request rejected." });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }
  next();
}
app.use("/api", requireSameOrigin);
app.use("/api", (req, res, next) => {
  // Analytics responses must never be served stale by browsers or proxies.
  res.setHeader("Cache-Control", "no-store");
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`[api] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
});

function oauthClient(tokens) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  if (client.transporter) {
    client.transporter.defaults = {
      ...client.transporter.defaults,
      fetchImplementation: globalThis.fetch,
      timeout: OAUTH_EXCHANGE_TIMEOUT_MS
    };
  }
  if (tokens) client.setCredentials(tokens);
  return client;
}

const OAUTH_EXCHANGE_TIMEOUT_MS = 15000;

function googleOAuthErrorBody(data) {
  if (!data || typeof data !== "object") return null;
  const body = {};
  for (const key of ["error", "error_description", "error_uri"]) {
    if (typeof data[key] === "string") body[key] = data[key].slice(0, 300);
  }
  return Object.keys(body).length ? body : null;
}

function describeOAuthError(err) {
  const cause = err?.cause;
  const text = (value) => typeof value === "string" ? value.slice(0, 500) : undefined;
  const scalar = (value) => (typeof value === "string" || typeof value === "number") ? value : undefined;
  return {
    name: err?.name,
    message: text(err?.message),
    code: scalar(err?.code),
    httpStatus: err?.response?.status ?? err?.status,
    googleOAuthError: googleOAuthErrorBody(err?.response?.data),
    cause: cause ? {
      name: cause.name,
      message: text(cause.message),
      code: scalar(cause.code)
    } : undefined,
    stack: text(err?.stack)?.split("\n").slice(0, 8).join("\n")
  };
}

function oauthExchangeFailure(err) {
  const body = googleOAuthErrorBody(err?.response?.data);
  const httpStatus = err?.response?.status;
  if (body?.error === "invalid_grant") {
    return [400, "Google said this sign-in attempt expired or was already used. Go back and connect again."];
  }
  if (body?.error === "invalid_client" || body?.error === "unauthorized_client") {
    return [502, "Google rejected this app's OAuth client credentials. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the OAuth client in Google Cloud Console. Details are in the server log."];
  }
  if (body?.error === "redirect_uri_mismatch") {
    return [502, "The redirect URI does not match this OAuth client in Google Cloud Console. Details are in the server log."];
  }
  if (body?.error) {
    return [502, `Google sign-in failed (${body.error}). Details are in the server log.`];
  }
  if (httpStatus) {
    return [502, `Google's sign-in service replied with an unexpected response (HTTP ${httpStatus}). Details are in the server log.`];
  }
  if (err?.cause?.name === "TimeoutError" || /timeout|timed out/i.test(err?.message ?? "")) {
    return [504, "Google's sign-in service took too long to respond. Try connecting again."];
  }
  return [502, "Could not reach Google's sign-in service to finish signing in. Check your connection and the server log, then try again."];
}

// Logs API failures without access tokens, refresh tokens, client secrets,
// request headers, or account identifiers. Never log the raw error object:
// googleapis errors carry an Authorization header inside err.config.
function logApiError(context, err) {
  const googleError = err?.response?.data?.error;
  const safeGoogleError = (googleError && typeof googleError === "object")
    ? {
        code: googleError.code,
        message: String(googleError.message ?? "").slice(0, 300),
        errors: (googleError.errors ?? []).slice(0, 5).map((entry) => ({
          domain: entry?.domain,
          reason: entry?.reason,
          message: String(entry?.message ?? "").slice(0, 200)
        }))
      }
    : undefined;
  console.error(`[api] ${context} failed:`, JSON.stringify({
    name: err?.name,
    message: String(err?.message ?? "").slice(0, 300),
    status: err?.response?.status ?? err?.status,
    googleError: safeGoogleError
  }));
}

function getAuth(req) {
  if (!req.session.tokens?.access_token) {
    const error = new Error("Connect your YouTube account first.");
    error.code = "NOT_CONNECTED";
    throw error;
  }
  const client = oauthClient(req.session.tokens);
  client.on("tokens", (tokens) => {
    if (req.session.tokens) {
      req.session.tokens = { ...req.session.tokens, ...tokens };
      req.session.save(() => {});
    }
  });
  return client;
}

function publicError(err) {
  if (err?.code === "NOT_CONNECTED") return [401, err.message];
  const status = err?.response?.status;
  if (status === 401 || status === 403) {
    return [502, "Google rejected this request. Check account permissions, OAuth scopes, API enablement, and test-user settings."];
  }
  if (status === 429) return [429, "Google API quota/rate limit reached. Wait and try again later."];
  return [502, "Could not load YouTube data. Check the server log for details."];
}

async function getChannel(auth) {
  const yt = google.youtube({ version: "v3", auth });
  const response = await yt.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true
  });
  const channel = response.data.items?.[0];
  if (!channel) throw new Error("No YouTube channel is available for this Google account.");
  return {
    id: channel.id,
    title: channel.snippet?.title ?? "YouTube channel",
    description: channel.snippet?.description ?? "",
    thumbnail: channel.snippet?.thumbnails?.medium?.url ??
      channel.snippet?.thumbnails?.default?.url ?? null,
    subscribersHidden: Boolean(channel.statistics?.hiddenSubscriberCount),
    subscribers: channel.statistics?.hiddenSubscriberCount
      ? null : (channel.statistics?.subscriberCount ?? null),
    totalViews: channel.statistics?.viewCount ?? null,
    videoCount: channel.statistics?.videoCount ?? null
  };
}

async function getChannelReport(auth, days) {
  const range = dateRange(days);
  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
  const response = await ytAnalytics.reports.query({
    ids: "channel==MINE",
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: "day",
    sort: "day",
    metrics: DAILY_METRICS.join(",")
  });
  const { headers, rows } = normalizeReportRows(response.data.columnHeaders, response.data.rows);
  // Metrics the API did not return stay null (shown as "unavailable"), never 0.
  const totals = sumMetricTotals(rows, DAILY_METRICS);
  return {
    ...range,
    headers,
    rows,
    totals,
    note: `YouTube Analytics data can lag by a few days; this report ends on ${range.endDate} (${ANALYTICS_END_LAG_DAYS} day(s) before today). Days without activity are omitted by the API.`
  };
}

async function getVideoReport(auth, days) {
  const range = dateRange(days);
  const analytics = google.youtubeAnalytics({ version: "v2", auth });
  const response = await analytics.reports.query({
    ids: "channel==MINE",
    startDate: range.startDate,
    endDate: range.endDate,
    dimensions: "video",
    sort: "-views",
    maxResults: 25,
    metrics: VIDEO_METRICS.join(",")
  });
  const { headers, rows } = normalizeReportRows(response.data.columnHeaders, response.data.rows);
  const ids = rows.map(row => row.video).filter(Boolean);
  const metadata = {};
  if (ids.length) {
    const yt = google.youtube({ version: "v3", auth });
    // videos.list accepts up to 50 IDs in one request.
    const details = await yt.videos.list({
      part: ["snippet", "statistics"],
      id: ids.slice(0, 50)
    });
    for (const video of details.data.items ?? []) {
      metadata[video.id] = {
        title: video.snippet?.title ?? video.id,
        thumbnail: video.snippet?.thumbnails?.medium?.url ??
          video.snippet?.thumbnails?.default?.url ?? null,
        publishedAt: video.snippet?.publishedAt ?? null,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
        // All-time views from the Data API, kept separate from period views.
        lifetimeViews: video.statistics?.viewCount ?? null
      };
    }
  }
  return {
    ...range,
    headers,
    note: "Per-video metrics cover the selected reporting period only. Lifetime views come from the YouTube Data API and may differ from Analytics.",
    rows: rows.map(row => ({
      ...row,
      ...(metadata[row.video] ?? {
        title: row.video,
        thumbnail: null,
        url: null,
        lifetimeViews: null
      })
    }))
  };
}

app.get("/auth/google", (req, res) => {
  const state = randomBytes(32).toString("hex");
  req.session.oauthState = state;
  req.session.save((err) => {
    if (err) return res.status(500).send("Could not start sign-in. Please restart the server.");
    const url = oauthClient().generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: SCOPES,
      state
    });
    res.redirect(url);
  });
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;

  if (error) {
    console.warn("OAuth callback: Google returned error:", String(error).slice(0, 200));
    return res.status(400).send("Google sign-in was cancelled or denied.");
  }
  if (!safeEqual(state, expectedState)) {
    console.warn("OAuth callback: state check failed. hadState=%s hadSessionState=%s",
      typeof state === "string", typeof expectedState === "string");
    return res.status(403).send("OAuth state check failed. Go back and try connecting again.");
  }
  if (typeof code !== "string") return res.status(400).send("Missing OAuth authorization code.");

  const client = oauthClient();

  let tokens;
  try {
    const { tokens: exchanged } = await client.getToken(code);
    tokens = exchanged;
    if (!tokens.access_token) throw new Error("Google did not return an access token.");
  } catch (err) {
    console.error("OAuth callback: token exchange failed:", JSON.stringify(describeOAuthError(err)));
    const [status, message] = oauthExchangeFailure(err);
    return res.status(status).send(message);
  }

  req.session.regenerate((err) => {
    if (err) {
      console.error("OAuth callback: session regeneration failed:", err.message);
      return res.status(500).send("Could not create a session. Please retry.");
    }
    req.session.tokens = tokens;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error("OAuth callback: session save failed:", saveErr.message);
        return res.status(500).send("Could not save your session. Please retry.");
      }
      res.redirect("/");
    });
  });
});

app.get("/api/me", async (req, res) => {
  if (!req.session.tokens?.access_token) return res.json({ connected: false });
  try {
    const auth = getAuth(req);
    const channel = await getChannel(auth);
    res.json({ connected: true, channel, updatedAt: new Date().toISOString() });
  } catch (err) {
    logApiError("Channel API", err);
    const [status, message] = publicError(err);
    res.status(status).json({ error: message });
  }
});

app.get("/api/analytics", async (req, res) => {
  try {
    const auth = getAuth(req);
    const [channel, report] = await Promise.all([
      getChannel(auth),
      getChannelReport(auth, req.query.days)
    ]);
    res.json({ channel, report, updatedAt: new Date().toISOString() });
  } catch (err) {
    logApiError("Analytics API", err);
    const [status, message] = publicError(err);
    res.status(status).json({ error: message });
  }
});

app.get("/api/videos", async (req, res) => {
  try {
    const auth = getAuth(req);
    // Channel stats are already provided by /api/analytics; fetching them here
    // again would burn extra Data API quota and risk inconsistent snapshots.
    const report = await getVideoReport(auth, req.query.days);
    res.json({ report, updatedAt: new Date().toISOString() });
  } catch (err) {
    logApiError("Video report API", err);
    const [status, message] = publicError(err);
    res.status(status).json({ error: message });
  }
});

app.post("/auth/logout", async (req, res) => {
  const tokens = req.session.tokens;
  if (tokens?.access_token || tokens?.refresh_token) {
    try {
      const token = tokens.refresh_token || tokens.access_token;
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token })
      });
    } catch (err) {
      console.error("Token revocation request failed:", err.message);
    }
  }
  req.session.destroy((err) => {
    res.clearCookie("mobile-studio.sid", { httpOnly: true, sameSite: "lax", secure: false });
    if (err) return res.status(500).json({ error: "Could not clear the local session." });
    res.json({ ok: true });
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, autoRefreshSeconds: AUTO_REFRESH_SECONDS });
});

app.listen(PORT, HOST, () => {
  console.log(`Mobile Studio AI running at http://localhost:${PORT}`);
  console.log("Local-development mode: server is bound to 127.0.0.1 only.");
});
