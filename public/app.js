const $ = (selector) => document.querySelector(selector);
const number = (value) => value == null ? "—" : Number(value).toLocaleString();
const state = {
  connected: false,
  loading: false,
  coachLoading: false,
  currentTab: "dashboard",
  savedIdeas: [],
  channel: null,
  videoMap: {}
};

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
  state.channel = channel;
  $("#channelName").textContent = channel.title || "YouTube Channel";
  $("#channelDescription").textContent = channel.description || "No channel description available.";
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

// Tab Switching logic
function switchTab(tab) {
  state.currentTab = tab;
  $("#tabDashboard").classList.toggle("active", tab === "dashboard");
  $("#tabCoach").classList.toggle("active", tab === "coach");
  $("#tabSaved").classList.toggle("active", tab === "saved");

  $("#viewDashboard").classList.toggle("hidden", tab !== "dashboard");
  $("#viewCoach").classList.toggle("hidden", tab !== "coach");
  $("#viewSaved").classList.toggle("hidden", tab !== "saved");

  if (tab === "coach" && !state.coachLoaded) {
    loadCoachData();
  } else if (tab === "saved") {
    renderSavedIdeas();
  }
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
    td.textContent = "No daily analytics rows available for this date range.";
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
    p.textContent = "No video performance records found for this period.";
    list.append(p);
    return;
  }

  for (const video of report.rows) {
    if (video.video) {
      state.videoMap[video.video] = video.title || video.video;
    }

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

// Section A: Health Snapshot renderer
function renderHealthSnapshot(snapshot) {
  const grid = $("#comparisonGrid");
  grid.replaceChildren();

  const period = snapshot.reportingPeriod;
  const prev = snapshot.previousPeriod;
  $("#coachPeriodLabel").textContent = `Selected: ${period.startDate} to ${period.endDate} vs. Previous: ${prev.startDate} to ${prev.endDate}`;
  $("#coachFreshnessNote").textContent = snapshot.dataFreshness;

  const comps = snapshot.comparisons || {};
  const metrics = [
    { key: "views", label: "Period Views" },
    { key: "estimatedMinutesWatched", label: "Watch Mins" },
    { key: "netSubscribers", label: "Net Subscribers" },
    { key: "likes", label: "Likes Received" },
    { key: "comments", label: "Comments" },
    { key: "shares", label: "Shares" }
  ];

  for (const m of metrics) {
    const comp = comps[m.key] || { current: 0, previous: 0, absoluteChange: 0, percentChange: 0 };
    const card = document.createElement("div");
    card.className = "comp-card";

    const isPos = comp.absoluteChange > 0;
    const isNeg = comp.absoluteChange < 0;
    const changeClass = isPos ? "pos" : (isNeg ? "neg" : "neu");
    const arrow = isPos ? "↑" : (isNeg ? "↓" : "•");
    const pctStr = comp.percentChange != null ? `${comp.percentChange > 0 ? "+" : ""}${comp.percentChange}%` : "—";
    const absStr = `${comp.absoluteChange > 0 ? "+" : ""}${number(comp.absoluteChange)}`;

    card.innerHTML = `
      <div class="comp-header">
        <span class="comp-label">${escapeHtml(m.label)}</span>
      </div>
      <div class="comp-val">${number(comp.current)}</div>
      <div class="comp-change ${changeClass}">
        <span>${arrow} ${absStr} (${pctStr})</span>
      </div>
      <div class="comp-prev">Prior period: ${number(comp.previous)}</div>
    `;
    grid.append(card);
  }
}

// Section B: What Is Working renderer
function renderWorkingPatterns(working) {
  const container = $("#patternsContainer");
  container.replaceChildren();

  const patterns = working.observablePatterns || [];
  if (!patterns.length) {
    container.innerHTML = `<p class="muted">No observable performance patterns identified for this period.</p>`;
    return;
  }

  for (const item of patterns) {
    const card = document.createElement("div");
    card.className = "pattern-card";

    let badgeClass = "fact";
    let badgeLabel = "Observed Fact";
    if (item.type === "correlation") {
      badgeClass = "correlation";
      badgeLabel = "Correlation";
    } else if (item.type === "hypothesis") {
      badgeClass = "hypothesis";
      badgeLabel = "Hypothesis";
    }

    card.innerHTML = `
      <div class="pattern-head">
        <h3 class="pattern-title">${escapeHtml(item.pattern || item.observation)}</h3>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="pattern-evidence"><strong>Evidence:</strong> ${escapeHtml(item.evidence || "Channel period analytics.")}</div>
      <div class="pattern-disclaimer">${escapeHtml(item.disclaimer || "")}</div>
    `;
    container.append(card);
  }
}

// Section C: Content Ideas renderer
function renderContentIdeas(ideas) {
  const container = $("#ideasContainer");
  container.replaceChildren();

  if (!ideas || !ideas.length) {
    container.innerHTML = `<p class="muted">No content recommendations available for this batch.</p>`;
    return;
  }

  for (const idea of ideas) {
    const card = document.createElement("div");
    card.className = "idea-card";

    let badgeClass = "hypothesis";
    let badgeText = "Hypothesis";
    if (idea.evidenceType === "data_backed") {
      badgeClass = "fact";
      badgeText = "Data Backed";
    } else if (idea.evidenceType === "general_practice") {
      badgeClass = "practice";
      badgeText = "Best Practice";
    }

    const isSaved = state.savedIdeas.some(s => s.id === idea.id || s.workingTitle === idea.workingTitle);

    let citationsHtml = "";
    if (Array.isArray(idea.citations) && idea.citations.length > 0) {
      const chips = idea.citations.map(id => {
        const title = state.videoMap[id] || id;
        return `<a class="citation-chip" href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">📌 ${escapeHtml(title.slice(0, 30))}</a>`;
      }).join(" ");
      citationsHtml = `
        <div class="idea-section">
          <div class="idea-section-label">Grounded In Videos</div>
          <div class="idea-citations">${chips}</div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="idea-head">
        <div>
          <h3 class="idea-title">${escapeHtml(idea.workingTitle)}</h3>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
      </div>
      <div class="idea-section">
        <div class="idea-section-label">Topic Summary</div>
        <div class="idea-section-body">${escapeHtml(idea.topicSummary)}</div>
      </div>
      <div class="idea-section">
        <div class="idea-section-label">Target Audience & Channel Fit</div>
        <div class="idea-section-body"><strong>Audience:</strong> ${escapeHtml(idea.intendedAudience)}</div>
        <div class="idea-section-body mt-10"><strong>Why it fits:</strong> ${escapeHtml(idea.whyItFits)}</div>
      </div>
      <div class="idea-section">
        <div class="idea-section-label">Execution Strategy</div>
        <div class="idea-section-body"><strong>Opening Hook:</strong> ${escapeHtml(idea.openingHook)}</div>
        <div class="idea-section-body mt-10"><strong>Approach:</strong> ${escapeHtml(idea.executionApproach)}</div>
      </div>
      ${citationsHtml}
      <div class="idea-actions">
        <button class="button secondary save-idea-btn" data-idea='${escapeHtml(JSON.stringify(idea))}'>${isSaved ? "✓ Saved" : "📌 Save Idea"}</button>
      </div>
    `;

    container.append(card);
  }

  // Bind save buttons
  container.querySelectorAll(".save-idea-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const raw = btn.getAttribute("data-idea");
        const idea = JSON.parse(raw);
        btn.disabled = true;
        await api("/api/coach/saved", {
          method: "POST",
          body: JSON.stringify({ idea })
        });
        btn.textContent = "✓ Saved";
        await updateSavedIdeasCount();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    });
  });
}

// Section D: Experiments renderer
function renderVideoImprovements(improvements) {
  const container = $("#improvementsContainer");
  container.replaceChildren();

  if (!improvements || !improvements.length) {
    container.innerHTML = `<p class="muted">No improvement recommendations available.</p>`;
    return;
  }

  for (const item of improvements) {
    const card = document.createElement("div");
    card.className = "exp-card";

    let prioClass = "prio-med";
    if (item.priority === "High") prioClass = "prio-high";
    else if (item.priority === "Low") prioClass = "prio-low";

    card.innerHTML = `
      <div class="exp-head">
        <h3 class="exp-title">${escapeHtml(item.experiment)}</h3>
        <span class="${prioClass}">PRIORITY: ${escapeHtml(item.priority || "Medium")}</span>
      </div>
      <div class="tiny muted"><strong>Evidence:</strong> ${escapeHtml(item.evidence)}</div>
      <div class="tiny muted"><strong>Expected Learning:</strong> ${escapeHtml(item.expectedLearning)}</div>
      <div class="tiny muted"><strong>Evaluation Method:</strong> ${escapeHtml(item.evaluationMethod)}</div>
    `;
    container.append(card);
  }
}

// Section F: Saved Ideas renderer
function renderSavedIdeas() {
  const container = $("#savedContainer");
  container.replaceChildren();

  if (!state.savedIdeas || !state.savedIdeas.length) {
    container.innerHTML = `<p class="muted">No saved ideas yet. Save ideas from the AI Content Coach tab to review them here.</p>`;
    return;
  }

  for (const idea of state.savedIdeas) {
    const card = document.createElement("div");
    card.className = "idea-card";

    card.innerHTML = `
      <div class="idea-head">
        <div>
          <h3 class="idea-title">${escapeHtml(idea.workingTitle)}</h3>
          <span class="tiny muted">Saved: ${new Date(idea.savedAt || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="idea-section">
        <div class="idea-section-label">Topic Summary</div>
        <div class="idea-section-body">${escapeHtml(idea.topicSummary)}</div>
      </div>
      <div class="idea-section">
        <div class="idea-section-label">Opening Hook</div>
        <div class="idea-section-body">${escapeHtml(idea.openingHook)}</div>
      </div>
      <div class="idea-actions">
        <button class="button danger delete-saved-btn" data-id="${escapeHtml(idea.id)}">Remove</button>
      </div>
    `;
    container.append(card);
  }

  container.querySelectorAll(".delete-saved-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      try {
        btn.disabled = true;
        await api(`/api/coach/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
        await updateSavedIdeasCount();
        renderSavedIdeas();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function updateSavedIdeasCount() {
  try {
    const res = await api("/api/coach/saved");
    state.savedIdeas = res.savedIdeas || [];
    $("#savedCount").textContent = state.savedIdeas.length;
  } catch (err) {
    console.warn("Could not update saved ideas count:", err.message);
  }
}

async function loadCoachData() {
  if (!state.connected || state.coachLoading) return;
  state.coachLoading = true;
  showError("");

  $("#comparisonGrid").innerHTML = `<div class="loading-placeholder">Loading channel health comparison...</div>`;
  $("#patternsContainer").innerHTML = `<div class="loading-placeholder">Analyzing top-performing patterns...</div>`;
  $("#ideasContainer").innerHTML = `<div class="loading-placeholder">Generating content recommendations...</div>`;
  $("#improvementsContainer").innerHTML = `<div class="loading-placeholder">Preparing experiments...</div>`;

  try {
    const days = encodeURIComponent($("#coachDays").value);
    const data = await api(`/api/coach/snapshot?days=${days}`);

    if (data.aiConfigured === false) {
      $("#aiConfigNotice").classList.remove("hidden");
    } else {
      $("#aiConfigNotice").classList.add("hidden");
    }

    renderHealthSnapshot(data.healthSnapshot);
    renderWorkingPatterns(data.workingPatterns);
    renderContentIdeas(data.contentIdeas);
    renderVideoImprovements(data.improvements);

    state.savedIdeas = data.savedIdeas || [];
    $("#savedCount").textContent = state.savedIdeas.length;
    state.coachLoaded = true;
  } catch (err) {
    showError(err.message);
  } finally {
    state.coachLoading = false;
  }
}

async function generateNewIdeasBatch() {
  const btn = $("#generateNewIdeas");
  btn.disabled = true;
  btn.textContent = "⏳ Generating...";
  showError("");

  try {
    const days = encodeURIComponent($("#coachDays").value);
    const res = await api("/api/coach/ideas/generate", {
      method: "POST",
      body: JSON.stringify({ days })
    });
    renderContentIdeas(res.contentIdeas);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Request New Batch";
  }
}

async function handleAskQuestion(e) {
  e.preventDefault();
  const input = $("#coachQuestionInput");
  const question = input.value.trim();
  if (!question) return;

  const btn = $("#askCoachSubmit");
  btn.disabled = true;
  btn.textContent = "Asking Coach...";
  showError("");

  const answerCard = $("#askAnswerContainer");
  const answerText = $("#askAnswerText");
  const badge = $("#answerProviderBadge");

  answerCard.classList.remove("hidden");
  answerText.textContent = "Thinking and analyzing channel data...";
  badge.textContent = "PROCESSING";
  badge.className = "badge correlation";

  try {
    const days = encodeURIComponent($("#coachDays").value);
    const res = await api("/api/coach/ask", {
      method: "POST",
      body: JSON.stringify({ question, days })
    });

    answerText.textContent = res.answer;
    if (res.provider === "gemini") {
      badge.textContent = `GEMINI (${res.model || "ai"})`;
      badge.className = "badge fact";
    } else {
      badge.textContent = "HEURISTIC MODE";
      badge.className = "badge hypothesis";
    }
  } catch (err) {
    showError(err.message);
    answerText.textContent = `Failed to get an answer: ${err.message}`;
    badge.textContent = "ERROR";
    badge.className = "badge practice";
  } finally {
    btn.disabled = false;
    btn.textContent = "Ask Coach";
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
  loadingCell.textContent = "Loading Analytics...";
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
    setStatus("Connection error");
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

// Event Listeners
$("#tabDashboard").addEventListener("click", () => switchTab("dashboard"));
$("#tabCoach").addEventListener("click", () => switchTab("coach"));
$("#tabSaved").addEventListener("click", () => switchTab("saved"));

$("#refreshAll").addEventListener("click", () => {
  loadAnalytics();
  if (state.currentTab === "coach") {
    loadCoachData();
  }
});
$("#loadVideos").addEventListener("click", loadAnalytics);
$("#days").addEventListener("change", loadAnalytics);
$("#coachDays").addEventListener("change", () => {
  state.coachLoaded = false;
  loadCoachData();
});

$("#generateNewIdeas").addEventListener("click", generateNewIdeasBatch);
$("#askCoachForm").addEventListener("submit", handleAskQuestion);

// Suggested question chips
document.querySelectorAll(".chip-btn").forEach(chip => {
  chip.addEventListener("click", () => {
    const q = chip.getAttribute("data-q");
    if (q) {
      $("#coachQuestionInput").value = q;
      $("#askCoachForm").requestSubmit();
    }
  });
});

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
