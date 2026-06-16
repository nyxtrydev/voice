/* ─── VoiceAgentOS — Real API frontend ─────────────────
   No dummy data. Every action talks to the backend.
   ─────────────────────────────────────────────────────── */

const TOKEN_KEY  = "vaos_token";
const USER_KEY   = "vaos_user";
const AGENT_KEY  = "vaos_selected_agent";

/* ── DOM helpers ───────────────────────────────────── */
const $  = s  => document.querySelector(s);
const $$ = s  => Array.from(document.querySelectorAll(s));

/* ── App state (no dummy data) ─────────────────────── */
let state = {
  user:              null,
  token:             localStorage.getItem(TOKEN_KEY),
  agents:            [],
  selectedAgentId:   localStorage.getItem(AGENT_KEY) || null,
  calls:             [],
  selectedCallId:    null,
  bookings:          [],
  analytics:         null,
  events:            [],
  bookingFilter:     "all",
  sseSource:         null,
  config:            { twilioPhone: null, publicBaseUrl: null },
  testConversation:  [],   // [{role:"user"|"assistant", content:string}]
};

/* ─────────────────────────────────────────────────────
   API LAYER
   ─────────────────────────────────────────────────── */
const api = {
  async request(method, path, body, isMultipart = false) {
    const headers = {};
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
    if (!isMultipart) headers["Content-Type"] = "application/json";

    const res = await fetch(path, {
      method,
      headers,
      body: isMultipart ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });

    if (res.status === 401) { logout(); return null; }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
  },
  get:    (p)        => api.request("GET",  p),
  post:   (p, b)     => api.request("POST", p, b),
  put:    (p, b)     => api.request("PUT",  p, b),
  upload: (p, form)  => api.request("POST", p, form, true),
};

/* ─────────────────────────────────────────────────────
   AUTH
   ─────────────────────────────────────────────────── */
async function login(email, password) {
  const data = await api.post("/api/auth/login", { email, password });
  if (!data) return;
  state.token = data.token;
  state.user  = data.user;
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY,  JSON.stringify(data.user));
  await bootApp();
}

async function register(email, password) {
  const data = await api.post("/api/auth/register", { email, password });
  if (!data) return;
  state.token = data.token;
  state.user  = data.user;
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY,  JSON.stringify(data.user));
  await bootApp();
}

function logout() {
  state.token = null;
  state.user  = null;
  state.agents = [];
  state.selectedAgentId = null;
  if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(AGENT_KEY);
  showAuthScreen();
}

/* ─────────────────────────────────────────────────────
   BOOT
   ─────────────────────────────────────────────────── */
async function init() {
  if (!state.token) { showAuthScreen(); return; }

  try {
    const me = await api.get("/api/me");
    if (!me) return;
    state.user = me.user;
    await bootApp();
  } catch {
    logout();
  }
}

async function bootApp() {
  showScreen("app");
  updateSidebarUser();
  // Fetch public config (Twilio phone number etc.) — fire and forget, non-blocking
  api.get("/api/info").then(info => {
    if (info) state.config = info;
  }).catch(() => {});
  await loadAgents();
}

async function loadAgents() {
  showLoading(true);
  try {
    const data = await api.get("/api/agents");
    if (!data) return;
    state.agents = data.agents || [];

    if (state.agents.length === 0) {
      state.selectedAgentId = null;
      renderAgentSelect();
      renderDashboardEmpty();
      renderAgentsEmpty();
      showLoading(false);
      return;
    }

    const valid = state.agents.find(a => a.id === state.selectedAgentId);
    if (!valid) {
      state.selectedAgentId = state.agents[0].id;
      localStorage.setItem(AGENT_KEY, state.selectedAgentId);
    }

    renderAgentSelect();
    await loadAgentData(state.selectedAgentId);
  } catch (err) {
    showToast("Failed to load agents: " + err.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadAgentData(agentId) {
  if (!agentId) return;
  try {
    const [analyticsRes, callsRes, bookingsRes] = await Promise.all([
      api.get(`/api/agents/${agentId}/analytics`),
      api.get(`/api/agents/${agentId}/calls?limit=50`),
      api.get(`/api/agents/${agentId}/bookings`),
    ]);

    state.analytics = analyticsRes?.analytics || null;
    state.events    = analyticsRes?.events    || [];
    state.calls     = callsRes?.calls         || [];
    state.bookings  = bookingsRes?.bookings   || [];

    if (state.calls.length && !state.calls.find(c => c.id === state.selectedCallId)) {
      state.selectedCallId = state.calls[0].id;
    }

    renderAll();
    connectSSE(agentId);
  } catch (err) {
    showToast("Failed to load agent data: " + err.message, "error");
  }
}

/* ─────────────────────────────────────────────────────
   SCREEN MANAGEMENT
   ─────────────────────────────────────────────────── */
function showScreen(name) {
  $("#auth-screen").classList.toggle("hidden", name !== "auth");
  $("#loading-screen").classList.toggle("hidden", name !== "loading");
  $("#app-shell").classList.toggle("hidden", name !== "app");
}
function showAuthScreen() { showScreen("auth"); }
function showLoading(on) {
  if (on && $("#app-shell").classList.contains("hidden")) {
    showScreen("loading");
  } else if (!on && !$("#app-shell").classList.contains("hidden")) {
    // already in app
  } else if (!on) {
    showScreen("auth");
  }
}

function updateSidebarUser() {
  const email = state.user?.email || "";
  $("#sidebar-user-email").textContent = email;
  const org = email.split("@")[1]?.split(".")[0] || email;
  $("#topbar-org").textContent = org.charAt(0).toUpperCase() + org.slice(1);

  const plan = state.user?.plan || "starter";
  const planLimits = { starter: 100, growth: 500, pro: 999999 };
  const planNames = { starter: "Starter Plan", growth: "Growth Plan", pro: "Pro Plan" };
  const limit = planLimits[plan] || 100;
  const used  = state.analytics?.calls?.calls_month || 0;

  $("#plan-name").textContent = planNames[plan] || "Starter Plan";
  $("#plan-calls-used").textContent = used;
  $("#plan-calls-limit").textContent = limit >= 999999 ? "∞" : limit;
  const pct = limit >= 999999 ? 5 : Math.min(100, Math.round((used / limit) * 100));
  $("#plan-meter-fill").style.width = `${pct}%`;
  const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1);
  $("#plan-renews").textContent = `Renews ${nextMonth.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

/* ─────────────────────────────────────────────────────
   VIEW ROUTING
   ─────────────────────────────────────────────────── */
const VIEW_TITLES = {
  dashboard: "Agent Overview",
  agents:    "Agents",
  bookings:  "Booking Table",
  calls:     "Call History",
  prompts:   "Prompt Editor",
};

function setView(name) {
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach(v => v.classList.remove("active"));
  $(`#${name}-view`).classList.add("active");
  $("#view-title").textContent = VIEW_TITLES[name] || name;
  if (name === "prompts" && !$("#test-console").children.length) resetTestConsole();
}

/* ─────────────────────────────────────────────────────
   RENDERS
   ─────────────────────────────────────────────────── */
function renderAll() {
  renderDashboard();
  renderAgents();
  renderBookings();
  renderCalls();
  renderPrompts();
}

function renderAgentSelect() {
  const sel = $("#agent-select");
  if (state.agents.length === 0) {
    sel.innerHTML = `<option value="">No agents</option>`;
    return;
  }
  sel.innerHTML = state.agents.map(a =>
    `<option value="${a.id}" ${a.id === state.selectedAgentId ? "selected" : ""}>${escHtml(a.name)}</option>`
  ).join("");
}

/* ── Dashboard ──────────────────────────────────────── */
function renderDashboardEmpty() {
  $("#dashboard-empty").style.display = "";
  $("#dashboard-content").style.display = "none";
  $("#agents-view .agent-grid").innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon"><svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="20" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 44c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      <h2>No agents yet</h2>
      <p>Create your first voice agent to start handling calls.</p>
    </div>`;
}

function renderDashboard() {
  const agent = selectedAgent();
  if (!agent) { renderDashboardEmpty(); return; }

  $("#dashboard-empty").style.display = "none";
  $("#dashboard-content").style.display = "";

  const a = state.analytics;

  // Live strip
  const isLive   = agent.status === "live";
  const isPaused = agent.status === "paused";
  const isDraft  = agent.status === "draft";

  $("#live-indicator").className = "live-dot" + (isLive ? " active" : "");
  $("#status-agent-name").textContent = agent.name;

  // Show provisioned number, or the configured Twilio number for unprovisioned agents
  const phoneDisplay = agent.twilioPhoneNumber ||
    (isDraft && state.config.twilioPhone ? state.config.twilioPhone : null) ||
    (isDraft ? "Not provisioned" : "—");
  $("#status-phone").textContent = phoneDisplay;

  $("#live-state").textContent = isLive   ? "Ready for inbound calls" :
                                 isPaused ? "Paused — resume to take calls" :
                                 isDraft  ? "Draft — provision to go live" : agent.status;

  // Stop / Resume buttons in live strip
  $("#stop-agent-btn").style.display   = isLive   ? "" : "none";
  $("#resume-agent-btn").style.display = isPaused ? "" : "none";
  $("#stop-agent-btn").dataset.stopAgent     = agent.id;
  $("#resume-agent-btn").dataset.resumeAgent = agent.id;

  // SSE pill
  $("#sse-pill").style.display = state.sseSource ? "" : "none";

  // Metrics
  const callsToday = a?.calls?.calls_today ?? 0;
  const callsWeek  = a?.calls?.calls_week  ?? 0;
  const avgDur     = a?.calls?.avg_duration_seconds ?? 0;
  const avgSent    = a?.calls?.avg_sentiment_score ?? 0;
  const bookTotal  = a?.bookings?.total ?? 0;
  const bookConf   = a?.bookings?.confirmed ?? 0;

  $("#metric-calls-today").textContent = callsToday;
  $("#metric-calls-week").textContent  = `${callsWeek} this week`;
  $("#metric-bookings").textContent    = bookTotal;
  $("#metric-bookings-copy").textContent = `${bookConf} confirmed`;
  $("#metric-duration").textContent    = avgDur ? fmtDuration(avgDur) : "—";
  $("#metric-sentiment").textContent   = avgSent || "—";
  $("#metric-sentiment-label").textContent = avgSent ? "avg score" : "no data";

  // Sentiment donut
  const pos = a?.calls?.positive ?? 0;
  const neu = a?.calls?.neutral  ?? 0;
  const neg = a?.calls?.negative ?? 0;
  const total = Math.max(pos + neu + neg, 1);
  const posPct = Math.round((pos / total) * 100);
  const neuPct = Math.round((neu / total) * 100);
  const negPct = Math.max(0, 100 - posPct - neuPct);
  const donut = $("#sentiment-donut");
  donut.style.background = pos + neu + neg === 0
    ? "var(--fill-2)"
    : `conic-gradient(var(--apple-green) 0 ${posPct}%, var(--apple-orange) ${posPct}% ${posPct+neuPct}%, var(--apple-red) ${posPct+neuPct}% 100%)`;
  donut.dataset.score = pos + neu + neg === 0 ? "—" : `${avgSent}/100`;

  $("#sentiment-legend").innerHTML = [
    ["Positive", posPct, "var(--apple-green)"],
    ["Neutral",  neuPct, "var(--apple-orange)"],
    ["Negative", negPct, "var(--apple-red)"]
  ].map(([label, val, color]) => `
    <div class="legend-row">
      <span class="legend-row-left"><i class="swatch" style="background:${color}"></i>${label}</span>
      <strong>${val}%</strong>
    </div>`).join("");

  // Activity timeline from events
  const eventsHtml = state.events.length
    ? state.events.slice(0, 8).map(ev => {
        const t = new Date(ev.created_at);
        const timeStr = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
        const { title, detail } = eventLabel(ev);
        return `<div class="activity-item">
          <div class="activity-time">${timeStr}</div>
          <div><strong>${escHtml(title)}</strong><span>${escHtml(detail)}</span></div>
        </div>`;
      }).join("")
    : `<div class="empty-inline">No activity yet.</div>`;
  $("#activity-timeline").innerHTML = eventsHtml;

  // Recent calls table
  const recentCalls = state.calls.slice(0, 10);
  $("#recent-calls-body").innerHTML = recentCalls.length
    ? recentCalls.map(c => `
        <tr>
          <td>${escHtml(c.callerName || c.callerPhone || "Unknown")}</td>
          <td>${escHtml(c.outcome)}</td>
          <td>${c.sentiment ? `<span class="badge ${c.sentiment}">${c.sentiment}${c.sentimentScore ? ` · ${c.sentimentScore}` : ""}</span>` : "—"}</td>
          <td>${c.durationSeconds ? fmtDuration(c.durationSeconds) : "—"}</td>
          <td>${fmtTime(c.startedAt)}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="table-empty">No calls yet. Calls will appear here after they are processed.</td></tr>`;
}

/* ── Agents ─────────────────────────────────────────── */
function renderAgents() {
  if (state.agents.length === 0) { renderAgentsEmpty(); return; }

  const agentGrid = $("#agent-list");
  agentGrid.innerHTML = state.agents.map(a => `
    <article class="agent-card">
      <div class="agent-card-header">
        <div>
          <p class="agent-card-eyebrow">${escHtml(a.persona)}</p>
          <h3>${escHtml(a.name)}</h3>
        </div>
        <span class="badge ${statusBadgeClass(a.status)}">${a.status}</span>
      </div>
      <p class="agent-card-desc">${escHtml(a.businessName)}</p>
      <div class="agent-stats">
        <div>
          <span class="agent-stat-label">Phone</span>
          <span class="agent-stat-val" style="font-size:12px">${a.twilioPhoneNumber || "—"}</span>
        </div>
        <div>
          <span class="agent-stat-label">Prompt v</span>
          <span class="agent-stat-val">${a.promptVersion}</span>
        </div>
        <div>
          <span class="agent-stat-label">Booking</span>
          <span class="agent-stat-val" style="font-size:13px">${a.bookingEnabled ? "Enabled" : "Off"}</span>
        </div>
        <div>
          <span class="agent-stat-label">Type</span>
          <span class="agent-stat-val" style="font-size:13px;text-transform:capitalize">${a.businessType}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
        <button class="secondary-btn" data-select-agent="${a.id}" type="button">Dashboard</button>
        ${a.status === "draft" ? `<button class="primary-btn" data-provision-agent="${a.id}" type="button" style="flex:1">
          <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 2l9 5-9 5V2Z" fill="currentColor"/></svg>
          Provision &amp; go live</button>` : ""}
        ${a.status === "live"   ? `<button class="danger-btn"  data-stop-agent="${a.id}"   type="button">
          <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/></svg>
          Stop agent</button>` : ""}
        ${a.status === "paused" ? `<button class="resume-btn"  data-resume-agent="${a.id}" type="button">
          <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 2.5l7 4.5-7 4.5V2.5Z" fill="currentColor"/></svg>
          Resume</button>` : ""}
      </div>
    </article>`).join("");
}

function renderAgentsEmpty() {
  const agentGrid = $("#agent-list");
  agentGrid.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon"><svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="20" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 44c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
      <h2>No agents yet</h2>
      <p>Create your first voice agent to start handling calls automatically.</p>
    </div>`;
}

/* ── Bookings ────────────────────────────────────────── */
function renderBookings() {
  let bookings = state.bookings;
  if (state.bookingFilter !== "all") {
    bookings = bookings.filter(b => b.status === state.bookingFilter);
  }

  $("#bookings-body").innerHTML = bookings.length
    ? bookings.map(b => `
        <tr>
          <td>${escHtml(b.name)}</td>
          <td>${escHtml(b.phone || "—")}</td>
          <td>${b.bookingDate || "—"}</td>
          <td>${escHtml(b.bookingTime || "—")}</td>
          <td>${escHtml(b.service)}</td>
          <td>
            <select data-booking-status="${b.id}" aria-label="Status for ${escHtml(b.name)}">
              ${["pending","confirmed","cancelled"].map(s =>
                `<option value="${s}" ${b.status === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="table-empty">No bookings ${state.bookingFilter !== "all" ? `with status "${state.bookingFilter}"` : "yet"}.</td></tr>`;
}

/* ── Calls ───────────────────────────────────────────── */
function renderCalls() {
  const query = ($("#call-search")?.value || "").trim().toLowerCase();
  const calls = state.calls.filter(c => {
    if (!query) return true;
    const hay = `${c.callerName} ${c.callerPhone} ${c.outcome} ${c.summary} ${c.transcript}`.toLowerCase();
    return hay.includes(query);
  });

  if (!calls.some(c => c.id === state.selectedCallId) && calls[0]) {
    state.selectedCallId = calls[0].id;
  }

  $("#call-list").innerHTML = calls.length
    ? calls.map(c => `
        <button class="call-item ${c.id === state.selectedCallId ? "active" : ""}" data-call-id="${c.id}" type="button">
          <span class="call-item-name">${escHtml(c.callerName || c.callerPhone || "Unknown caller")}</span>
          <span class="call-item-meta">${escHtml(c.outcome)} · ${fmtTime(c.startedAt)} · ${c.durationSeconds ? fmtDuration(c.durationSeconds) : "—"}</span>
        </button>`).join("")
    : `<div class="empty-inline">${query ? "No calls match your search." : "No calls yet."}</div>`;

  renderCallDetail();
}

function renderCallDetail() {
  const call = state.calls.find(c => c.id === state.selectedCallId);
  const el = $("#call-detail");
  if (!call) {
    el.innerHTML = `<div class="empty-inline">Select a call to view its transcript.</div>`;
    return;
  }

  const turns = call.turns || [];
  const transcriptHtml = turns.length
    ? turns.map(t => `
        <div class="turn ${t.speaker}">
          <strong>${t.speaker === "caller" ? "Caller" : "Agent"}</strong>
          <p>${escHtml(t.text)}</p>
        </div>`).join("")
    : call.transcript
      ? call.transcript.split("\n").filter(l => l.trim()).map(line => {
          const isAgent = line.toLowerCase().startsWith("agent:");
          const text = line.replace(/^(agent:|caller:)\s*/i, "");
          return `<div class="turn ${isAgent ? "agent" : "caller"}">
            <strong>${isAgent ? "Agent" : "Caller"}</strong>
            <p>${escHtml(text)}</p>
          </div>`;
        }).join("")
      : `<div class="empty-inline">Transcript not available.</div>`;

  el.innerHTML = `
    <div class="card-header">
      <div>
        <p class="card-eyebrow">${call.id.slice(0, 8)}…</p>
        <h2 class="card-title">${escHtml(call.callerName || call.callerPhone || "Unknown caller")}</h2>
      </div>
      ${call.sentiment ? `<span class="badge ${call.sentiment}">${call.sentiment}${call.sentimentScore ? ` · ${call.sentimentScore}` : ""}</span>` : ""}
    </div>
    ${call.summary ? `<p style="font-size:14px;color:var(--label-2);margin-bottom:16px">${escHtml(call.summary)}</p>` : ""}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:14px;background:var(--fill-3);border-radius:var(--r-lg);margin-bottom:12px">
      <div><span class="agent-stat-label">Outcome</span><span class="agent-stat-val" style="font-size:14px;text-transform:capitalize">${escHtml(call.outcome)}</span></div>
      <div><span class="agent-stat-label">Duration</span><span class="agent-stat-val" style="font-size:14px">${call.durationSeconds ? fmtDuration(call.durationSeconds) : "—"}</span></div>
      <div><span class="agent-stat-label">Started</span><span class="agent-stat-val" style="font-size:14px">${fmtTime(call.startedAt)}</span></div>
    </div>
    <div class="transcript">${transcriptHtml}</div>`;
}

/* ── Prompts ─────────────────────────────────────────── */
function renderPrompts() {
  const agent = selectedAgent();
  if (!agent) {
    $("#prompt-agent-name").textContent = "No agent selected";
    $("#prompt-editor").value = "";
    $("#prompt-editor").placeholder = "Create an agent first.";
    return;
  }
  $("#prompt-agent-name").textContent = `${agent.name} — system prompt`;
  $("#prompt-version").textContent = agent.promptVersion;
  $("#prompt-editor").value = agent.systemPrompt || "";
  const voiceEl = $("#voice-select");
  if (voiceEl) {
    voiceEl.value = agent.voice || "priya";
    if (!voiceEl.value) voiceEl.value = "priya";
  }
}

function resetTestConsole() {
  const agent = selectedAgent();
  state.testConversation = [];
  const greeting = agent
    ? `Hello! I'm ${escHtml(agent.name.split(" ")[0])}, calling for ${escHtml(agent.businessName)}. How can I help you today?`
    : "Select an agent to start testing.";
  $("#test-console").innerHTML = `<div class="console-msg agent">${greeting}</div>`;
}

/* ─────────────────────────────────────────────────────
   SSE
   ─────────────────────────────────────────────────── */
function connectSSE(agentId) {
  if (state.sseSource) { state.sseSource.close(); state.sseSource = null; }
  if (!agentId || !state.token) return;

  const url = `/api/agents/${agentId}/sse`;
  const es  = new EventSource(url + `?token=${state.token}`);

  // The server uses Bearer auth in preHandler; EventSource can't set headers.
  // We pass token as query param — the server needs a small patch to support it,
  // OR we skip SSE if the server enforces Bearer-only. We'll attempt and ignore errors.
  es.addEventListener("connected", () => {
    state.sseSource = es;
    renderDashboard(); // update SSE pill
  });

  const refresh = async () => {
    try {
      const [analyticsRes, bookingsRes] = await Promise.all([
        api.get(`/api/agents/${agentId}/analytics`),
        api.get(`/api/agents/${agentId}/bookings`),
      ]);
      state.analytics = analyticsRes?.analytics || state.analytics;
      state.events    = analyticsRes?.events    || state.events;
      state.bookings  = bookingsRes?.bookings   || state.bookings;
      renderDashboard();
      renderBookings();
    } catch { /* ignore */ }
  };

  es.addEventListener("call.ended",     refresh);
  es.addEventListener("booking.created", refresh);
  es.addEventListener("booking.updated", refresh);
  es.addEventListener("agent.updated",  () => loadAgents());
  es.addEventListener("agent.provisioned", () => loadAgents());

  es.onerror = () => {
    state.sseSource = null;
    renderDashboard(); // hide SSE pill
  };

  state.sseSource = es;
}

/* ─────────────────────────────────────────────────────
   WIZARD
   ─────────────────────────────────────────────────── */
let wizardStep = 0;

function openWizard() {
  wizardStep = 0;
  setWizardStep(0);
  $("#agent-form").reset();
  $$(".template-card").forEach(c => c.classList.toggle("active", c.querySelector("input[type='radio']")?.checked));
  $("#wizard-error").classList.add("hidden");
  $("#wizard-error").textContent = "";
  $("#wizard-modal").classList.add("active");
}

function closeWizard() {
  $("#wizard-modal").classList.remove("active");
}

function setWizardStep(step) {
  $$(".wizard-step").forEach((s, i) => s.classList.toggle("active", i === step));
  $$(".ws-step").forEach((s, i) => s.classList.toggle("active", i <= step));
  $("#wizard-back").disabled = step === 0;
  $("#wizard-next").classList.toggle("hidden", step === 3);
  $("#wizard-create").classList.toggle("hidden", step !== 3);
}

function wizardFormValues() {
  return Object.fromEntries(new FormData($("#agent-form")).entries());
}

async function generatePromptForWizard() {
  const v = wizardFormValues();
  const template = v.template || "clinic";
  const typeMap = { clinic: "clinic", auto: "auto", tech: "tech", other: "other" };
  const btype = typeMap[template] || typeMap[v.businessType] || "clinic";

  const label = $("#wizard-generating");
  label.textContent = "Generating…";

  try {
    const res = await api.post("/api/agents/generate-prompt", {
      businessName: v.businessName || "My Business",
      agentName:    v.agentName    || "Aria",
      businessType: btype,
      description:  v.description  || "A business that serves customers.",
      hours:        v.hours        || undefined,
      address:      v.address      || undefined,
    });
    if (res?.systemPrompt) {
      $("#generated-prompt").value = res.systemPrompt;
      const bookingToggle = $("#agent-form [name='bookingEnabled']");
      if (bookingToggle) bookingToggle.checked = res.bookingEnabled !== false;
    }
  } catch (err) {
    showWizardError("Could not generate prompt: " + err.message);
  } finally {
    label.textContent = "";
  }
}

async function createAgent(event) {
  event.preventDefault();
  const v = wizardFormValues();
  const template = v.template || "clinic";
  const typeMap  = { clinic: "clinic", auto: "auto", tech: "tech", other: "other" };
  const btype    = typeMap[template] || "clinic";

  const btn = $("#wizard-create");
  btn.disabled = true;
  btn.textContent = "Creating…";

  try {
    const res = await api.post("/api/agents", {
      businessName:   v.businessName,
      agentName:      v.agentName || "Aria",
      businessType:   btype,
      description:    v.description || "",
      hours:          v.hours       || undefined,
      address:        v.address     || undefined,
      systemPrompt:   v.generatedPrompt || undefined,
      bookingEnabled: v.bookingEnabled === "on",
      phoneCountry:   v.phoneCountry || "India",
    });

    if (!res?.agent) throw new Error("No agent returned");
    const agent = res.agent;

    // Upload knowledge file if provided
    const fileInput = $("#knowledge-file-input");
    if (fileInput.files?.[0]) {
      const form = new FormData();
      form.append("file", fileInput.files[0]);
      try {
        await api.upload(`/api/agents/${agent.id}/knowledge`, form);
      } catch {
        showToast("Agent created but knowledge upload failed.", "warning");
      }
    }

    await loadAgents();
    state.selectedAgentId = agent.id;
    localStorage.setItem(AGENT_KEY, agent.id);
    renderAgentSelect();
    await loadAgentData(agent.id);
    closeWizard();
    setView("dashboard");
    showToast(`${agent.name} created — status: ${agent.status}`);
  } catch (err) {
    showWizardError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Provision & launch";
  }
}

function showWizardError(msg) {
  const el = $("#wizard-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

/* ─────────────────────────────────────────────────────
   STOP / RESUME AGENT  (one active agent at a time)
   ─────────────────────────────────────────────────── */
async function stopAgent(agentId) {
  const btns = $$(`[data-stop-agent="${agentId}"]`);
  btns.forEach(b => { b.disabled = true; b.textContent = "Stopping…"; });

  try {
    const res = await api.post(`/api/agents/${agentId}/stop`, {});
    if (!res?.agent) throw new Error("Stop failed");
    const idx = state.agents.findIndex(a => a.id === agentId);
    if (idx !== -1) state.agents[idx] = res.agent;
    renderDashboard();
    renderAgents();
    showToast(`${res.agent.name} stopped — paused`);
  } catch (err) {
    showToast("Stop failed: " + err.message, "error");
    btns.forEach(b => { b.disabled = false; });
  }
}

async function resumeAgent(agentId) {
  const btns = $$(`[data-resume-agent="${agentId}"]`);
  btns.forEach(b => { b.disabled = true; b.textContent = "Resuming…"; });

  try {
    // Enforce one-at-a-time: pause any currently live agent first
    const liveAgents = state.agents.filter(a => a.status === "live" && a.id !== agentId);
    for (const la of liveAgents) {
      const stopRes = await api.post(`/api/agents/${la.id}/stop`, {});
      if (stopRes?.agent) {
        const idx = state.agents.findIndex(a => a.id === la.id);
        if (idx !== -1) state.agents[idx] = stopRes.agent;
      }
    }

    const res = await api.post(`/api/agents/${agentId}/resume`, {});
    if (!res?.agent) throw new Error("Resume failed");
    const idx = state.agents.findIndex(a => a.id === agentId);
    if (idx !== -1) state.agents[idx] = res.agent;
    renderDashboard();
    renderAgents();
    showToast(`${res.agent.name} resumed — ready for calls`);
  } catch (err) {
    showToast("Resume failed: " + err.message, "error");
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ─────────────────────────────────────────────────────
   PROVISION AGENT
   ─────────────────────────────────────────────────── */
async function provisionAgent(agentId) {
  const btn = document.querySelector(`[data-provision-agent="${agentId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Provisioning…"; }

  try {
    // Enforce one-at-a-time: pause any live agent before going live
    const liveAgents = state.agents.filter(a => a.status === "live" && a.id !== agentId);
    for (const la of liveAgents) {
      const stopRes = await api.post(`/api/agents/${la.id}/stop`, {});
      if (stopRes?.agent) {
        const idx = state.agents.findIndex(a => a.id === la.id);
        if (idx !== -1) state.agents[idx] = stopRes.agent;
      }
    }

    const res = await api.post(`/api/agents/${agentId}/provision`, {});
    if (!res?.agent) throw new Error("Provision failed");
    showToast(`Live at ${res.agent.twilioPhoneNumber || "—"}`);
    await loadAgents();
  } catch (err) {
    showToast("Provision failed: " + err.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "Provision & go live"; }
  }
}

/* ─────────────────────────────────────────────────────
   SAVE PROMPT
   ─────────────────────────────────────────────────── */
async function savePrompt() {
  const agent = selectedAgent();
  if (!agent) return;
  const prompt = $("#prompt-editor").value.trim();
  if (!prompt) { showToast("Prompt cannot be empty.", "error"); return; }

  const btn = $("#save-prompt");
  btn.disabled = true;

  try {
    const voice = $("#voice-select")?.value || undefined;
    const res = await api.put(`/api/agents/${agent.id}`, { systemPrompt: prompt, voice });
    if (!res?.agent) throw new Error("Update failed");

    const idx = state.agents.findIndex(a => a.id === agent.id);
    if (idx !== -1) state.agents[idx] = res.agent;

    renderPrompts();
    showToast(`Prompt v${res.agent.promptVersion} deployed`);
  } catch (err) {
    showToast("Save failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

/* ─────────────────────────────────────────────────────
   BOOKING STATUS
   ─────────────────────────────────────────────────── */
async function updateBookingStatus(bookingId, status) {
  const agent = selectedAgent();
  if (!agent) return;
  try {
    const res = await api.put(`/api/agents/${agent.id}/bookings/${bookingId}`, { status });
    if (!res?.booking) throw new Error("Update failed");
    const idx = state.bookings.findIndex(b => b.id === bookingId);
    if (idx !== -1) state.bookings[idx] = res.booking;
    renderDashboard();
    showToast(`Booking marked ${status}`);
  } catch (err) {
    showToast("Failed: " + err.message, "error");
  }
}

/* ─────────────────────────────────────────────────────
   CALL DETAIL LOAD (full transcript)
   ─────────────────────────────────────────────────── */
async function loadCallDetail(callId) {
  const agent = selectedAgent();
  if (!agent) return;

  // optimistic: select from state
  state.selectedCallId = callId;
  renderCalls();

  try {
    const res = await api.get(`/api/agents/${agent.id}/calls/${callId}`);
    if (!res?.call) return;
    // update with full transcript turns
    const idx = state.calls.findIndex(c => c.id === callId);
    if (idx !== -1) state.calls[idx] = res.call;
    else state.calls.unshift(res.call);
    renderCallDetail();
  } catch { /* ignore, already rendered from list */ }
}

/* ─────────────────────────────────────────────────────
   HELPERS
   ─────────────────────────────────────────────────── */
function selectedAgent() {
  return state.agents.find(a => a.id === state.selectedAgentId) || null;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(secs) {
  const s = Number(secs) || 0;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function statusBadgeClass(status) {
  if (status === "live")  return "positive";
  if (status === "paused") return "neutral";
  return "neutral";
}

function eventLabel(ev) {
  const p = ev.payload || {};
  const map = {
    "agent.created":    { title: "Agent created", detail: p.name || "" },
    "agent.updated":    { title: "Agent updated", detail: p.promptVersion ? `Prompt v${p.promptVersion}` : "" },
    "agent.provisioned":{ title: "Agent provisioned", detail: p.phoneNumber || "" },
    "call.inbound":     { title: "Inbound call", detail: "" },
    "call.started":     { title: "Call started", detail: p.callId?.slice(0, 8) || "" },
    "call.ended":       { title: "Call ended", detail: p.outcome || "" },
    "booking.created":  { title: "Booking captured", detail: "" },
    "booking.updated":  { title: "Booking updated", detail: p.status || "" },
    "knowledge.uploaded": { title: "Knowledge uploaded", detail: p.fileName || "" },
  };
  return map[ev.event_type] || { title: ev.event_type, detail: "" };
}

function showToast(msg, type = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast active" + (type === "error" ? " toast-error" : "");
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove("active"), 3200);
}

/* ─────────────────────────────────────────────────────
   AUTH SCREEN
   ─────────────────────────────────────────────────── */
function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearAuthError() {
  $("#auth-error").classList.add("hidden");
}

$$("[data-auth-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    const tab = btn.dataset.authTab;
    $("#login-form").classList.toggle("hidden",    tab !== "login");
    $("#register-form").classList.toggle("hidden", tab !== "register");
    clearAuthError();
  });
});

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  clearAuthError();
  const email = $("#login-email").value.trim();
  const pass  = $("#login-password").value;
  if (!email || !pass) { showAuthError("Email and password are required."); return; }
  const btn = $("#login-submit");
  btn.disabled = true; btn.textContent = "Signing in…";
  try { await login(email, pass); }
  catch (err) { showAuthError(err.message || "Sign in failed."); }
  finally { btn.disabled = false; btn.textContent = "Sign in"; }
});

$("#register-form").addEventListener("submit", async e => {
  e.preventDefault();
  clearAuthError();
  const email = $("#reg-email").value.trim();
  const pass  = $("#reg-password").value;
  if (!email || !pass) { showAuthError("Email and password are required."); return; }
  if (pass.length < 8)  { showAuthError("Password must be at least 8 characters."); return; }
  const btn = $("#reg-submit");
  btn.disabled = true; btn.textContent = "Creating account…";
  try { await register(email, pass); }
  catch (err) { showAuthError(err.message || "Registration failed."); }
  finally { btn.disabled = false; btn.textContent = "Create account"; }
});

/* ─────────────────────────────────────────────────────
   GLOBAL EVENT DELEGATION
   ─────────────────────────────────────────────────── */
document.addEventListener("click", e => {
  const nav       = e.target.closest("[data-view]");
  const jump      = e.target.closest("[data-view-jump]");
  const selAgent  = e.target.closest("[data-select-agent]");
  const provision = e.target.closest("[data-provision-agent]");
  const stopBtn   = e.target.closest("[data-stop-agent]");
  const resumeBtn = e.target.closest("[data-resume-agent]");
  const callBtn   = e.target.closest("[data-call-id]");
  const bFilter   = e.target.closest("[data-booking-filter]");

  if (nav)       setView(nav.dataset.view);
  if (jump)      setView(jump.dataset.viewJump);

  if (selAgent) {
    state.selectedAgentId = selAgent.dataset.selectAgent;
    localStorage.setItem(AGENT_KEY, state.selectedAgentId);
    renderAgentSelect();
    loadAgentData(state.selectedAgentId);
    setView("dashboard");
  }

  if (provision) provisionAgent(provision.dataset.provisionAgent);
  if (stopBtn)   stopAgent(stopBtn.dataset.stopAgent);
  if (resumeBtn) resumeAgent(resumeBtn.dataset.resumeAgent);

  if (callBtn) {
    loadCallDetail(callBtn.dataset.callId);
  }

  if (bFilter) {
    state.bookingFilter = bFilter.dataset.bookingFilter;
    $$("[data-booking-filter]").forEach(b => b.classList.toggle("active", b === bFilter));
    renderBookings();
  }
});

/* Agent select dropdown */
$("#agent-select").addEventListener("change", async e => {
  state.selectedAgentId = e.target.value;
  localStorage.setItem(AGENT_KEY, state.selectedAgentId);
  state.testConversation = [];
  $("#test-console").innerHTML = "";
  await loadAgentData(state.selectedAgentId);
});

/* Logout */
$("#logout-btn").addEventListener("click", () => {
  if (confirm("Sign out?")) logout();
});

/* Refresh */
$("#refresh-btn").addEventListener("click", async () => {
  await loadAgentData(state.selectedAgentId);
  showToast("Data refreshed");
});

/* New agent buttons */
$("#new-agent-button").addEventListener("click", openWizard);
$("#agents-new-agent").addEventListener("click", openWizard);
$("#empty-new-agent")?.addEventListener("click", openWizard);
document.addEventListener("click", e => {
  if (e.target.id === "empty-new-agent") openWizard();
});

/* Close wizard */
$("#close-wizard").addEventListener("click", closeWizard);
$("#wizard-modal").addEventListener("click", e => { if (e.target === $("#wizard-modal")) closeWizard(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeWizard(); });

/* Wizard nav */
$("#wizard-next").addEventListener("click", async () => {
  if (wizardStep < 3) {
    wizardStep++;
    setWizardStep(wizardStep);
    if (wizardStep === 3) await generatePromptForWizard();
  }
});
$("#wizard-back").addEventListener("click", () => {
  if (wizardStep > 0) { wizardStep--; setWizardStep(wizardStep); }
});
$("#agent-form").addEventListener("submit", createAgent);

/* Template card selection */
$$(".template-card input[type='radio']").forEach(radio => {
  radio.addEventListener("change", () => {
    $$(".template-card").forEach(c => c.classList.toggle("active", c.contains(radio) && radio.checked));
  });
});

/* Knowledge file label */
$("#file-drop-zone").addEventListener("click", () => $("#knowledge-file-input").click());
$("#knowledge-file-input").addEventListener("change", () => {
  const file = $("#knowledge-file-input").files?.[0];
  $("#file-note").textContent = file ? file.name : "PDF, DOCX, or TXT · max 5 MB";
});

/* Save prompt */
$("#save-prompt").addEventListener("click", savePrompt);

/* Booking status change */
$("#bookings-body").addEventListener("change", e => {
  const id = e.target.dataset.bookingStatus;
  if (id) updateBookingStatus(id, e.target.value);
});

/* Call search */
$("#call-search").addEventListener("input", renderCalls);

/* Clear console */
$("#clear-console").addEventListener("click", () => resetTestConsole());

/* Prompt test console — real LLM */
$("#test-form").addEventListener("submit", async e => {
  e.preventDefault();
  const agent = selectedAgent();
  if (!agent) { showToast("Select an agent first", "error"); return; }

  const input = $("#test-input");
  const text  = input.value.trim();
  if (!text) return;

  const con = $("#test-console");
  input.value = "";
  input.disabled = true;
  $("#test-form").querySelector("button[type='submit']").disabled = true;

  // Show user message immediately
  con.insertAdjacentHTML("beforeend", `<div class="console-msg user">${escHtml(text)}</div>`);

  // Add typing indicator
  const typingId = "typing-" + Date.now();
  con.insertAdjacentHTML("beforeend",
    `<div class="console-msg agent typing" id="${typingId}"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`);
  con.scrollTop = con.scrollHeight;

  // Append to conversation history
  state.testConversation.push({ role: "user", content: text });

  try {
    const res = await api.post(`/api/agents/${agent.id}/chat`, {
      messages: state.testConversation
    });

    const reply   = res?.reply || "Sorry, I didn't catch that.";
    const endCall = res?.endCall;

    // Replace typing indicator with real reply
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.outerHTML =
      `<div class="console-msg agent">${escHtml(reply)}${endCall ? ' <span class="end-call-badge">END CALL</span>' : ""}</div>`;

    state.testConversation.push({ role: "assistant", content: reply });

    if (endCall) {
      con.insertAdjacentHTML("beforeend",
        `<div class="console-msg system">— Call ended by agent —</div>`);
      state.testConversation = [];
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.outerHTML =
      `<div class="console-msg agent" style="color:var(--apple-red)">Error: ${escHtml(err.message)}</div>`;
  } finally {
    input.disabled = false;
    $("#test-form").querySelector("button[type='submit']").disabled = false;
    con.scrollTop = con.scrollHeight;
    input.focus();
  }
});

/* ─────────────────────────────────────────────────────
   BOOT
   ─────────────────────────────────────────────────── */
init();
