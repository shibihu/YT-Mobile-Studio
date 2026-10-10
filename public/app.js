const $ = (selector) => document.querySelector(selector);
const number = (value) => value == null ? "—" : Number(value).toLocaleString();
const state = { connected: false, loading: false };

async function api(url, options = {}) {
  const response = await fetch(url, {
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

function setChannel(channel) {
  $("#channelName").textContent = channel.title || "YouTube channel";
  $("#channelDescription").textContent = channel.description || "ไม่มีคำอธิบายช่อง";
  $("#totalViews").textContent = number(channel.totalViews);
  $("#subscribers").textContent = number(channel.subscribers);
  $("#videoCount").textContent = number(channel.videoCount);
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
  $("#periodDates").textContent = `${report.startDate} – ${report.endDate}`;
  $("#analyticsNote").textContent = report.note || "";

  const tbody = $("#dailyRows");
  tbody.replaceChildren();
  if (!report.rows?.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "ไม่มีข้อมูลรายวันในช่วงนี้";
    tr.append(td);
    tbody.append(tr);
    return;
  }

  for (const row of [...report.rows].reverse()) {
    const tr = document.createElement("tr");
    const values = [
      row.day ?? "—",
      number(row.views),
      number(row.estimatedMinutesWatched),
      number(row.likes),
      number(Number(row.subscribersGained ?? 0) - Number(row.subscribersLost ?? 0))
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
  $("#videoDates").textContent = `${report.startDate} – ${report.endDate}`;
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
      ["views", "Views"],
      ["estimatedMinutesWatched", "Minutes watched"],
      ["likes", "Likes"],
      ["comments", "Comments"],
      ["shares", "Shares"],
      ["subscribersGained", "Subscribers gained"]
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

async function loadAnalytics() {
  if (!state.connected || state.loading) return;
  state.loading = true;
  showError("");
  $("#refreshAll").disabled = true;
  $("#loadVideos").disabled = true;
  $("#dailyRows").replaceChildren();
  const loadingRow = document.createElement("tr");
  const loadingCell = document.createElement("td");
  loadingCell.colSpan = 5;
  loadingCell.textContent = "กำลังโหลด Analytics...";
  loadingRow.append(loadingCell);
  $("#dailyRows").append(loadingRow);

  try {
    const days = encodeURIComponent($("#days").value);
    const [daily, videos] = await Promise.all([
      api(`/api/analytics?days=${days}`),
      api(`/api/videos?days=${days}`)
    ]);
    setChannel(daily.channel);
    renderDaily(daily.report);
    renderVideos(videos.report);
    setStatus("YouTube connected");
  } catch (error) {
    showError(error.message);
    setStatus("เกิดข้อผิดพลาด");
  } finally {
    state.loading = false;
    $("#refreshAll").disabled = false;
    $("#loadVideos").disabled = false;
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
    setChannel(me.channel);
    setStatus("YouTube connected");
    await loadAnalytics();
  } catch (error) {
    setStatus("Connection error");
    showError(error.message);
  }
}

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
