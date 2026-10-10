const $ = (selector) => document.querySelector(selector);
const number = (value) => value == null ? "—" : Number(value).toLocaleString();
const state = {
  connected: false,
  loading: false,
  autoRefreshSeconds: 60,
  autoRefreshTimer: null,
  lastLoadFinishedAt: 0,
  lastDailyUpdateAt: null,
  lastVideosUpdateAt: null
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    credentials: "same-origin",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(message) {
  const el = $("#globalError");
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}
function setStatus(text) { $("#status").textContent = text; }

function formatUpdatedAt(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString();
}

function setChannel(channel) {
  $("#channelName").textContent = channel.title || "YouTube channel";
  $("#channelDescription").textContent = channel.description || "ไม่มีคำอธิบายช่อง";
  $("#totalViews").textContent = number(channel.totalViews);
  $("#totalViewsFoot").textContent = "สถิติสะสมทั้งหมดของช่อง (YouTube Data API)";
  $("#videoCount").textContent = number(channel.videoCount);
  $("#videoCountFoot").textContent = "ข้อมูลช่องสะสม (YouTube Data API)";
  if (channel.subscribersHidden) {
    $("#subscribers").textContent = "ซ่อนอยู่";
    $("#subscribersFoot").textContent = "เจ้าของช่องซ่อนจำนวนผู้ติดตามไว้";
  } else {
    $("#subscribers").textContent = number(channel.subscribers);
    $("#subscribersFoot").textContent = channel.subscribers == null
      ? "โหลดข้อมูลผู้ติดตามไม่สำเร็จ"
      : "สถิติสะสมจาก YouTube Data API";
  }
  const image = $("#channelThumbnail");
  if (channel.thumbnail) {
    image.src = channel.thumbnail;
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
  }
}

function setMetric(id, value) {
  $(id).textContent = number(value);
}

function renderDaily(report) {
  const totals = report.totals || {};
  $("#periodViews").textContent = number(totals.views);
  $("#watchMinutes").textContent = number(totals.estimatedMinutesWatched);
  $("#likes").textContent = number(totals.likes);
  $("#comments").textContent = number(totals.comments);
  $("#shares").textContent = number(totals.shares);
  $("#gained").textContent = number(totals.subscribersGained);
  $("#lost").textContent = number(totals.subscribersLost);
  $("#periodDates").textContent = `${report.startDate} – ${report.endDate} · YouTube Analytics`;
  $("#analyticsNote").textContent = report.note || "";

  const tbody = $("#dailyRows");
  tbody.replaceChildren();
  if (!report.rows?.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "ไม่มีข้อมูลรายวันในช่วงนี้ (API ไม่ส่งแถวสำหรับวันที่ไม่มีกิจกรรม)";
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const row of [...report.rows].reverse()) {
    const tr = document.createElement("tr");
    const netSubscribers = row.subscribersGained == null && row.subscribersLost == null
      ? "—"
      : number(Number(row.subscribersGained ?? 0) - Number(row.subscribersLost ?? 0));
    const values = [
      row.day ?? "—",
      number(row.views),
      number(row.estimatedMinutesWatched),
      number(row.likes),
      netSubscribers
    ];
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderVideos(report) {
  $("#videoDates").textContent = `${report.startDate} – ${report.endDate} · YouTube Analytics`;
  if (report.note) $("#videoNote").textContent = report.note;
  const list = $("#videoList");
  list.replaceChildren();

  if (!report.rows?.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "ไม่พบข้อมูลรายวิดีโอในช่วงเวลานี้";
    list.append(p);
    return;
  }

  for (const video of report.rows) {
    const card = document.createElement("article");
    card.className = "video-card";

    if (video.thumbnail) {
      const img = document.createElement("img");
      img.className = "video-thumb";
      img.src = video.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      card.append(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "video-thumb";
      card.append(placeholder);
    }

    const body = document.createElement("div");
    const title = document.createElement("a");
    title.className = "video-title";
    title.textContent = video.title || video.video || "Unknown video";
    title.href = video.url || `https://www.youtube.com/watch?v=${encodeURIComponent(video.video || "")}`;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    body.append(title);

    const metrics = document.createElement("div");
    metrics.className = "video-metrics";
    for (const [key, label] of [
      ["views", "Views (selected period)"],
      ["estimatedMinutesWatched", "Minutes watched (period)"],
      ["likes", "Likes (period)"],
      ["comments", "Comments (period)"],
      ["shares", "Shares (period)"],
      ["subscribersGained", "Subscribers gained (period)"],
      ["lifetimeViews", "Lifetime views (Data API)"]
    ]) {
      if (video[key] == null) continue;
      const item = document.createElement("span");
      item.textContent = `${label}: ${number(video[key])}`;
      metrics.append(item);
    }
    body.append(metrics);
    card.append(body);
    list.append(card);
  }
}

function scheduleAutoRefresh() {
  if (state.autoRefreshTimer) clearTimeout(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  if (!state.connected) return;
  state.autoRefreshTimer = setTimeout(async () => {
    state.autoRefreshTimer = null;
    // Browsers throttle timers in hidden tabs; skip and try again later.
    if (document.hidden) {
      scheduleAutoRefresh();
      return;
    }
    await loadAnalytics();
  }, state.autoRefreshSeconds * 1000);
}

async function loadAnalytics() {
  if (!state.connected || state.loading) return;
  state.loading = true;
  showError("");
  $("#refreshAll").disabled = true;
  $("#loadVideos").disabled = true;
  const isRefresh = state.lastLoadFinishedAt > 0;
  setStatus(isRefresh ? "กำลังอัปเดตข้อมูล..." : "กำลังโหลด Analytics...");

  try {
    const days = encodeURIComponent($("#days").value);
    // Fetch sections independently so one failure does not discard the other
    // section's data or mark a previously loaded dashboard as empty.
    const [dailyResult, videosResult] = await Promise.allSettled([
      api(`/api/analytics?days=${days}`),
      api(`/api/videos?days=${days}`)
    ]);

    const errors = [];
    if (dailyResult.status === "fulfilled") {
      setChannel(dailyResult.value.channel);
      renderDaily(dailyResult.value.report);
      state.lastDailyUpdateAt = Date.now();
      $("#dailyUpdated").textContent = `อัปเดตล่าสุด: ${formatUpdatedAt(state.lastDailyUpdateAt)}`;
    } else {
      errors.push(`ภาพรวม Analytics: ${dailyResult.reason?.message || "โหลดไม่สำเร็จ"}`);
    }

    if (videosResult.status === "fulfilled") {
      renderVideos(videosResult.value.report);
      state.lastVideosUpdateAt = Date.now();
      $("#videosUpdated").textContent = `อัปเดตล่าสุด: ${formatUpdatedAt(state.lastVideosUpdateAt)}`;
    } else {
      errors.push(`วิดีโอ: ${videosResult.reason?.message || "โหลดไม่สำเร็จ"}`);
    }

    if (errors.length) {
      showError(errors.join("\n"));
      setStatus(dailyResult.status === "fulfilled" ? "อัปเดตบางส่วนไม่สำเร็จ" : "เกิดข้อผิดพลาด");
    } else {
      setStatus("YouTube connected");
    }
  } catch (error) {
    showError(error.message);
    setStatus("เกิดข้อผิดพลาด");
  } finally {
    state.loading = false;
    state.lastLoadFinishedAt = Date.now();
    $("#refreshAll").disabled = false;
    $("#loadVideos").disabled = false;
    // A failed refresh is not treated as successful; only the per-section
    // timestamps above record real successes. Retrying still happens later.
    scheduleAutoRefresh();
  }
}

async function init() {
  try {
    const me = await api("/api/me");
    state.connected = Boolean(me.connected);
    $("#connectPanel").classList.toggle("hidden", state.connected);
    $("#dashboard").classList.toggle("hidden", !state.connected);

    if (!state.connected) {
      setStatus("Not connected");
      return;
    }
    const health = await api("/api/health").catch(() => null);
    if (Number.isFinite(health?.autoRefreshSeconds)) {
      state.autoRefreshSeconds = health.autoRefreshSeconds;
    }
    $("#autoRefreshNote").textContent =
      `รีเฟรชอัตโนมัติทุก ${state.autoRefreshSeconds} วินาที · หยุดชั่วคราวเมื่อแท็บถูกซ่อน · กดปุ่ม Refresh เพื่ออัปเดตทันที`;
    setChannel(me.channel);
    setStatus("YouTube connected");
    await loadAnalytics();
  } catch (error) {
    setStatus("Connection error");
    showError(error.message);
  }
}

// Refresh immediately when the tab becomes visible again and data is stale.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state.connected || state.loading) return;
  const staleAfterMs = state.autoRefreshSeconds * 1000;
  if (Date.now() - state.lastLoadFinishedAt >= staleAfterMs) {
    loadAnalytics();
  }
});

$("#refreshAll").addEventListener("click", loadAnalytics);
$("#loadVideos").addEventListener("click", loadAnalytics);
$("#days").addEventListener("change", loadAnalytics);

$("#disconnect").addEventListener("click", async () => {
  if (!confirm("Disconnect YouTube and revoke this app's stored authorization?")) return;
  $("#disconnect").disabled = true;
  try {
    await api("/auth/logout", { method: "POST" });
    location.reload();
  } catch (error) {
    showError(error.message);
    $("#disconnect").disabled = false;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
init();
