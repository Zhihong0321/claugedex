const agentIds = ["brain", "looper", "coder"];
const chatTarget = ["brain"];
const outputs = Object.fromEntries(
  agentIds.map((id) => [id, document.getElementById(`output-${id}`)])
);
const metas = Object.fromEntries(
  agentIds.map((id) => [id, document.getElementById(`meta-${id}`)])
);
const panels = Object.fromEntries(
  agentIds.map((id) => [id, document.querySelector(`[data-agent="${id}"]`)])
);

const promptForm = document.getElementById("promptForm");
const promptInput = document.getElementById("promptInput");
const handshakeButton = document.getElementById("handshakeButton");
const testChainButton = document.getElementById("testChainButton");
const fullChainButton = document.getElementById("fullChainButton");
const chatFullChainButton = document.getElementById("chatFullChainButton");
const sendButton = document.getElementById("sendButton");
const clearButton = document.getElementById("clearButton");
const debugLog = document.getElementById("debugLog");
const debugCount = document.getElementById("debugCount");
const sessionLine = document.getElementById("sessionLine");
const modeBadge = document.getElementById("modeBadge");
const coderModeBadge = document.getElementById("coderModeBadge");
const userInputPanel = document.getElementById("userInputPanel");
const userInputQuestion = document.getElementById("userInputQuestion");
const userInputTasks = document.getElementById("userInputTasks");
const continueChainButton = document.getElementById("continueChainButton");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabViews = Array.from(document.querySelectorAll(".tab-view"));
const operatorSystemStatus = document.getElementById("operatorSystemStatus");
const operatorSystemDetail = document.getElementById("operatorSystemDetail");
const operatorLastChainStatus = document.getElementById("operatorLastChainStatus");
const operatorLastChainDetail = document.getElementById("operatorLastChainDetail");
const operatorAgentHealthStatus = document.getElementById("operatorAgentHealthStatus");
const operatorAgentHealthDetail = document.getElementById("operatorAgentHealthDetail");
const operatorLastRouteStatus = document.getElementById("operatorLastRouteStatus");
const operatorLastRouteDetail = document.getElementById("operatorLastRouteDetail");
const operatorTokensStatus = document.getElementById("operatorTokensStatus");
const operatorTokensDetail = document.getElementById("operatorTokensDetail");
const resultReviewStatus = document.getElementById("resultReviewStatus");
const resultReviewDetail = document.getElementById("resultReviewDetail");
const resultReviewBody = document.getElementById("resultReviewBody");

const RESULT_PLACEHOLDER_VALUES = new Set([
  "none",
  "file path",
  "change summary",
  "short result summary",
  "validation note",
  "local command or manual check",
  "passed | failed | skipped",
  "missing setup or unsafe requirement",
  "short evidence",
  "permissioned setup task, or none",
  "why user input is needed, or none",
  "exact question for the user, or none",
  "suggested answer option, or none",
  "what the user should do next, or none",
  "test result summary",
  "blocked test summary",
  "criterion result",
  "risk"
]);

let eventCount = 0;
let activeRuns = 0;
let pendingUserInput = null;
let streamConnected = false;
let runTokenTotal = 0;
let lastChainTokenTotal = 0;
let lastCoderEnvelope = null;
let lastValidationEnvelope = null;
let lastCoderRunReview = null;
let lastValidationRunReview = null;
let lastCompletedChainEvent = null;
let resultReviewInputNeeded = false;
const agentHealthState = Object.fromEntries(
  agentIds.map((id) => [
    id,
    {
      runs: 0,
      incidents: 0,
      last: "idle"
    }
  ])
);

initialize();

async function initialize() {
  initializeTabs();
  resetOperatorMetrics();

  const config = await getJson("/api/config");
  sessionLine.textContent = `${config.session.id} | ${config.session.path}`;
  modeBadge.textContent = config.mock ? "mock" : "real";
  const coder = config.agents.coder;
  coderModeBadge.textContent = coder?.writeAccess
    ? `coder:${coder.sandboxMode || "write"}`
    : `coder:${coder?.sandboxMode || "read-only"}`;

  for (const [id, agent] of Object.entries(config.agents)) {
    const panel = panels[id];
    if (!panel) continue;
    panel.querySelector(".provider").textContent = agent.provider;
  }

  setOperatorSystem("Connecting to event stream...", "Waiting for live SSE events.");

  const source = new EventSource("/api/events");
  source.onopen = () => {
    streamConnected = true;
    setOperatorSystem(`Live stream connected${formatRunLoad()}`, "Listening for chain and run events.");
  };
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    handleEvent(event);
  };
  source.onerror = () => {
    streamConnected = false;
    setOperatorSystem(`Event stream disconnected${formatRunLoad()}`, "Connection lost. Waiting for automatic retry.");
    addDebugRow({
      type: "app:event-stream-error",
      ts: new Date().toISOString(),
      message: "Event stream disconnected"
    });
  };
}

promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = promptInput.value.trim();
  if (!message) return;
  await postPrompt("/api/prompt", {
    message,
    targets: chatTarget
  });
});

handshakeButton.addEventListener("click", async () => {
  await postPrompt("/api/handshake", {
    targets: agentIds
  });
});

testChainButton.addEventListener("click", async () => {
  await postPrompt("/api/test-chain", {});
});

fullChainButton.addEventListener("click", async () => {
  await runFullChainFromPrompt();
});

chatFullChainButton.addEventListener("click", async () => {
  await runFullChainFromPrompt();
});

async function runFullChainFromPrompt() {
  const message = promptInput.value.trim();
  if (!message) {
    addDebugRow({
      type: "ui:request-error",
      ts: new Date().toISOString(),
      message: "Message required for Run Full Chain"
    });
    return;
  }
  await postPrompt("/api/full-chain", { message });
}

clearButton.addEventListener("click", async () => {
  for (const output of Object.values(outputs)) output.textContent = "";
  debugLog.textContent = "";
  eventCount = 0;
  debugCount.textContent = "0 events";
  hideUserInputPanel();
  resetOperatorMetrics();
  await fetch("/api/clear-view", { method: "POST" });
});

continueChainButton.addEventListener("click", async () => {
  if (!pendingUserInput) return;
  const answer = promptInput.value.trim();
  if (!answer) {
    addDebugRow({
      type: "ui:request-error",
      ts: new Date().toISOString(),
      message: "User feedback required before continuing the chain"
    });
    promptInput.focus();
    return;
  }
  const request = pendingUserInput.userInputRequest || {};
  await postPrompt("/api/full-chain", {
    message: [
      `Continue blocked ClauGeDex chain ${pendingUserInput.chainId}.`,
      "",
      "Original user input request:",
      JSON.stringify(request, null, 2),
      "",
      "User feedback:",
      answer
    ].join("\n")
  });
  hideUserInputPanel();
});

async function postPrompt(url, payload) {
  setBusy(true);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    addDebugRow({
      type: "ui:request-error",
      ts: new Date().toISOString(),
      message: error.message
    });
  } finally {
    setBusy(false);
  }
}

function handleEvent(event) {
  if (event.type === "run:start") {
    activeRuns += 1;
    setAgentStatus(event.agentId, "running");
    outputs[event.agentId].textContent = "";
    metas[event.agentId].textContent = `run ${event.runId}`;
    if (agentHealthState[event.agentId]) {
      agentHealthState[event.agentId].last = "running";
      updateAgentHealthCard();
    }
    setOperatorSystem(`Live stream connected${formatRunLoad()}`, `${event.agentId} started run ${event.runId}`);
  }

  if (event.type === "run:stdout") {
    appendOutput(event.agentId, event.text);
  }

  if (event.type === "run:stderr") {
    appendOutput(event.agentId, `\n[stderr]\n${event.text}`);
  }

  if (event.type === "run:complete") {
    activeRuns = Math.max(0, activeRuns - 1);
    setAgentStatus(event.agentId, statusFromRunComplete(event));
    const schema = event.protocolOk ? `schema:${event.protocolSource}` : `schema:${event.protocolError}`;
    const attention = event.incident ? ` | ${event.incident.errorType}` : "";
    metas[event.agentId].textContent = `${event.durationMs}ms | exit ${event.exitCode} | ${schema} | ${formatTokens(event.tokens)}${attention}`;
    captureResultEnvelope(event);
    updateAgentHealthFromRun(event);
    updateTokensFromRun(event);
    setOperatorSystem(`Live stream connected${formatRunLoad()}`, `${event.agentId} completed in ${event.durationMs}ms`);
  }

  if (event.type === "chain:start") {
    operatorLastChainStatus.textContent = `${event.chainId} started`;
    operatorLastChainDetail.textContent = event.message || "Chain execution started.";
  }

  if (event.type === "chain:route") {
    operatorLastRouteStatus.textContent = `${event.from} -> ${event.to}`;
    operatorLastRouteDetail.textContent = `${event.chainId} | ${event.routedType || "unknown type"}`;
  }

  if (event.type === "chain:complete") {
    operatorLastChainStatus.textContent = `${event.chainId} ${event.status || "complete"}`;
    const total = event.totalTokens ? ` | tok:${formatNumber(event.totalTokens)}` : "";
    operatorLastChainDetail.textContent = `${event.message || "Chain completed"}${total}`;
    if (event.totalTokens) {
      lastChainTokenTotal = Number(event.totalTokens || 0);
      operatorTokensStatus.textContent = `chain:${formatNumber(lastChainTokenTotal)}`;
      operatorTokensDetail.textContent = `${event.chainId} ${event.status || ""}`.trim();
    }
    renderResultReview(event);
  }

  if (event.type === "chain:user-input-needed") {
    operatorLastChainStatus.textContent = `${event.chainId} user input needed`;
    operatorLastChainDetail.textContent = event.message || "Chain blocked waiting for user input.";
    markResultReviewInputNeeded(event);
  }

  if (event.type === "chain:user-input-needed") {
    showUserInputPanel(event);
  }

  if (event.type === "app:error" || event.type === "app:listen-error") {
    setOperatorSystem(`System attention needed${formatRunLoad()}`, event.message || event.type);
  }

  if (event.type === "app:listening") {
    setOperatorSystem(`Server listening${formatRunLoad()}`, event.url || "127.0.0.1");
  }

  if (event.type === "ui:clear-view") {
    return;
  }

  addDebugRow(event);
}

function showUserInputPanel(event) {
  pendingUserInput = event;
  const request = event.userInputRequest || {};
  userInputQuestion.textContent =
    request.question || event.message || "The chain needs your input before it can continue.";
  userInputTasks.textContent = "";
  const tasks = [
    ...(Array.isArray(event.userSetupTasks) ? event.userSetupTasks : []),
    ...(Array.isArray(request.options) ? request.options : [])
  ].filter((item) => item && item !== "none");
  for (const task of tasks) {
    const item = document.createElement("li");
    item.textContent = String(task);
    userInputTasks.append(item);
  }
  userInputTasks.hidden = tasks.length === 0;
  userInputPanel.hidden = false;
  promptInput.placeholder = request.requested_action || "Type your answer, permission, or setup result here.";
  promptInput.focus();
}

function hideUserInputPanel() {
  pendingUserInput = null;
  userInputPanel.hidden = true;
  userInputQuestion.textContent = "";
  userInputTasks.textContent = "";
  promptInput.placeholder = "";
}

function initializeTabs() {
  for (const button of tabButtons) {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  }
  activateTab("tab-operator");
}

function activateTab(targetId) {
  for (const button of tabButtons) {
    const active = button.dataset.tabTarget === targetId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }

  for (const view of tabViews) {
    view.hidden = view.id !== targetId;
  }
}

function resetOperatorMetrics() {
  runTokenTotal = 0;
  lastChainTokenTotal = 0;
  lastCoderEnvelope = null;
  lastValidationEnvelope = null;
  lastCoderRunReview = null;
  lastValidationRunReview = null;
  lastCompletedChainEvent = null;
  resultReviewInputNeeded = false;
  for (const id of agentIds) {
    agentHealthState[id] = {
      runs: 0,
      incidents: 0,
      last: "idle"
    };
  }
  operatorLastChainStatus.textContent = "No chains yet";
  operatorLastChainDetail.textContent = "Waiting for chain:start";
  operatorLastRouteStatus.textContent = "No routing yet";
  operatorLastRouteDetail.textContent = "Waiting for chain:route";
  operatorTokensStatus.textContent = "tok:0";
  operatorTokensDetail.textContent = "No token reports yet";
  resultReviewStatus.textContent = "Waiting for chain to complete...";
  resultReviewDetail.textContent = "No chain result yet";
  resultReviewBody.textContent = "";
  updateAgentHealthCard();
}

function captureResultEnvelope(event) {
  if (!event.envelope || typeof event.envelope !== "object") return;

  const runReview = {
    protocolOk: Boolean(event.protocolOk),
    hasIncident: Boolean(event.incident),
    incidentType: event.incident?.errorType || ""
  };

  if (event.envelope.type === "CODER_RESULT") {
    lastCoderEnvelope = event.envelope;
    lastCoderRunReview = runReview;
  }

  if (event.envelope.type === "LOOPER_VALIDATION_RESULT") {
    lastValidationEnvelope = event.envelope;
    lastValidationRunReview = runReview;
  }
}

function renderResultReview(event) {
  lastCompletedChainEvent = event;

  resultReviewStatus.textContent = `${event.chainId} ${event.status || "complete"}`;
  const details = [event.message || "Chain completed."];
  if (event.totalTokens) details.push(`tok:${formatNumber(event.totalTokens)}`);
  resultReviewDetail.textContent = details.join(" | ");
  resultReviewBody.textContent = "";

  const badges = document.createElement("div");
  badges.className = "result-review-badges";
  badges.append(createResultBadge(`CHAIN ${event.status || "UNKNOWN"}`, badgeClassForChainStatus(event.status)));

  const validationStatus = pickMeaningfulText(lastValidationEnvelope?.validation_status);
  if (validationStatus) {
    badges.append(
      createResultBadge(
        `VALIDATION ${validationStatus}`,
        badgeClassForValidationStatus(validationStatus)
      )
    );
  }

  appendRunReviewBadge(badges, "CODER", lastCoderRunReview);
  appendRunReviewBadge(badges, "VALIDATION RUN", lastValidationRunReview);

  if (resultReviewInputNeeded || event.userInputNeeded) {
    badges.append(createResultBadge("USER INPUT NEEDED", "rr-status-input"));
  }

  resultReviewBody.append(badges);

  const fields = document.createElement("dl");
  appendReviewField(fields, "Chain ID", event.chainId);
  appendReviewField(fields, "Chain Status", event.status);
  appendReviewField(fields, "Validation", validationStatus);

  if (event.totalTokens) {
    appendReviewField(fields, "Total Tokens", formatNumber(event.totalTokens));
  }

  appendReviewField(fields, "Coder Summary", pickMeaningfulText(lastCoderEnvelope?.result_summary));
  appendReviewListField(fields, "Files Changed", lastCoderEnvelope?.files_changed);
  appendReviewListField(fields, "Files Considered", lastCoderEnvelope?.files_considered);
  appendReviewListField(fields, "Changes Made", lastCoderEnvelope?.changes_made);
  appendReviewListField(fields, "Tests Run", formatCoderTestsRun(lastCoderEnvelope?.tests_run));
  appendReviewListField(fields, "Tests Blocked", formatCoderTestsBlocked(lastCoderEnvelope?.tests_blocked));

  appendReviewField(fields, "Trusted Result", pickMeaningfulText(lastValidationEnvelope?.trusted_test_result));
  appendReviewListField(fields, "Validation Tests", lastValidationEnvelope?.tests_run);
  appendReviewListField(fields, "Validation Blocked", lastValidationEnvelope?.tests_blocked);
  appendReviewListField(fields, "Matched Criteria", lastValidationEnvelope?.matched_success_criteria);
  appendReviewListField(fields, "Remaining Risks", lastValidationEnvelope?.remaining_risks);

  if (fields.children.length > 0) {
    resultReviewBody.append(fields);
  }
}

function markResultReviewInputNeeded(event) {
  resultReviewInputNeeded = true;

  if (lastCompletedChainEvent) {
    renderResultReview(lastCompletedChainEvent);
    return;
  }

  resultReviewStatus.textContent = `${event.chainId} user input needed`;
  resultReviewDetail.textContent = event.message || "Chain blocked waiting for user input.";
  resultReviewBody.textContent = "";

  const badges = document.createElement("div");
  badges.className = "result-review-badges";
  badges.append(createResultBadge("USER INPUT NEEDED", "rr-status-input"));
  resultReviewBody.append(badges);
}

function appendRunReviewBadge(container, label, runReview) {
  if (!runReview) return;

  if (runReview.protocolOk && runReview.hasIncident) {
    const detail = runReview.incidentType ? ` (${runReview.incidentType})` : "";
    container.append(createResultBadge(`${label} WARNING${detail}`, "rr-status-warn"));
    return;
  }

  if (runReview.protocolOk) {
    container.append(createResultBadge(`${label} OK`, "rr-status-ok"));
    return;
  }

  container.append(createResultBadge(`${label} FAIL`, "rr-status-fail"));
}

function createResultBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = `result-review-badge ${className}`;
  badge.textContent = text;
  return badge;
}

function badgeClassForChainStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "OK" || normalized === "PASS" || normalized === "SUCCESS") return "rr-status-ok";
  if (normalized === "FAILED" || normalized === "FAIL" || normalized === "ERROR") return "rr-status-fail";
  if (normalized === "BLOCKED") return "rr-status-input";
  return "rr-status-warn";
}

function badgeClassForValidationStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PASS") return "rr-status-ok";
  if (normalized === "FAIL") return "rr-status-fail";
  if (normalized === "BLOCKED") return "rr-status-input";
  return "rr-status-warn";
}

function appendReviewField(list, label, value) {
  const text = pickMeaningfulText(value);
  if (!text) return;

  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = text;
  list.append(dt, dd);
}

function appendReviewListField(list, label, values) {
  const lines = normalizeReviewList(values);
  if (lines.length === 0) return;
  appendReviewField(list, label, lines.join("\n"));
}

function normalizeReviewList(values) {
  if (Array.isArray(values)) {
    return values
      .map((value) => pickMeaningfulText(value))
      .filter(Boolean);
  }
  const single = pickMeaningfulText(values);
  return single ? [single] : [];
}

function formatCoderTestsRun(testsRun) {
  if (!Array.isArray(testsRun)) return [];
  return testsRun
    .map((test) => {
      if (!test || typeof test !== "object") return pickMeaningfulText(test);
      const command = pickMeaningfulText(test.command);
      const status = pickMeaningfulText(test.status);
      const evidence = pickMeaningfulText(test.evidence);
      if (!command && !status && !evidence) return "";
      const parts = [];
      if (command) parts.push(command);
      if (status) parts.push(`[${status}]`);
      if (evidence) parts.push(`- ${evidence}`);
      return parts.join(" ");
    })
    .filter(Boolean);
}

function formatCoderTestsBlocked(testsBlocked) {
  if (!Array.isArray(testsBlocked)) return [];
  return testsBlocked
    .map((test) => {
      if (!test || typeof test !== "object") return pickMeaningfulText(test);
      const command = pickMeaningfulText(test.command);
      const reason = pickMeaningfulText(test.reason);
      if (!command && !reason) return "";
      const parts = [];
      if (command) parts.push(command);
      if (reason) parts.push(`- ${reason}`);
      return parts.join(" ");
    })
    .filter(Boolean);
}

function pickMeaningfulText(value) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text) return "";
  if (RESULT_PLACEHOLDER_VALUES.has(text.toLowerCase())) return "";
  return text;
}

function setOperatorSystem(status, detail) {
  operatorSystemStatus.textContent = status;
  operatorSystemDetail.textContent = detail;
}

function formatRunLoad() {
  const label = activeRuns === 1 ? "run" : "runs";
  return ` | active ${label}: ${activeRuns}`;
}

function updateAgentHealthFromRun(event) {
  const health = agentHealthState[event.agentId];
  if (!health) return;
  health.runs += 1;
  health.last = statusFromRunComplete(event);
  if (event.incident) {
    health.incidents += 1;
  }
  updateAgentHealthCard();
}

function updateAgentHealthCard() {
  const states = agentIds.map((id) => agentHealthState[id].last);
  const healthy = states.filter((state) => state === "ok" || state === "ok-warning" || state === "idle").length;
  const running = states.filter((state) => state === "running").length;
  const attention = states.filter((state) => state === "needs-attention" || state === "error").length;
  operatorAgentHealthStatus.textContent = `${healthy}/${agentIds.length} healthy`;
  operatorAgentHealthDetail.textContent = `running:${running} | attention:${attention}`;
}

function updateTokensFromRun(event) {
  const total = Number(event.tokens?.total || 0);
  if (total > 0) {
    runTokenTotal += total;
  }
  if (lastChainTokenTotal > 0) {
    operatorTokensStatus.textContent = `chain:${formatNumber(lastChainTokenTotal)}`;
  } else {
    operatorTokensStatus.textContent = `tok:${formatNumber(runTokenTotal)}`;
  }
  operatorTokensDetail.textContent = `${event.agentId} ${formatTokens(event.tokens)}`;
}

function appendOutput(agentId, text) {
  const output = outputs[agentId];
  if (!output) return;
  output.textContent += text;
  output.scrollTop = output.scrollHeight;
}

function setAgentStatus(agentId, status) {
  const panel = panels[agentId];
  if (!panel) return;
  const statusEl = panel.querySelector(".status");
  statusEl.textContent = status;
  statusEl.className = `status ${status}`;
}

function statusFromRunComplete(event) {
  if (event.protocolOk && event.envelope && event.incident) return "ok-warning";
  if (event.protocolOk && event.exitCode === 0) return "ok";
  if (event.incident) return "needs-attention";
  return event.exitCode === 0 ? "ok" : "error";
}

function addDebugRow(event) {
  eventCount += 1;
  debugCount.textContent = `${eventCount} events`;
  const row = document.createElement("div");
  const className =
    event.type?.includes("error") || event.type?.includes("stderr")
      ? "event-row error"
      : event.incident
        ? "event-row incident"
        : "event-row";
  row.className = className;

  const title = document.createElement("strong");
  title.textContent = `${event.ts || ""} ${event.type || "event"}`;

  const details = document.createElement("span");
  details.textContent = summarizeEvent(event);

  row.append(title, details);
  debugLog.prepend(row);

  while (debugLog.children.length > 250) {
    debugLog.lastElementChild.remove();
  }
}

function summarizeEvent(event) {
  if (event.type === "run:start") {
    const mode = event.sandboxMode ? ` mode=${event.sandboxMode}` : "";
    const write = event.writeAccess ? " write=on" : "";
    return `${event.agentId}${mode}${write} ${event.command} ${event.argsPreview?.join(" ") || ""}`;
  }
  if (event.type === "chain:start") {
    const coderMode = event.coderMode ? ` coder=${event.coderMode}` : "";
    return `${event.chainId} ${event.message}${coderMode}`;
  }
  if (event.type === "chain:route") {
    return `${event.chainId} ${event.from}->${event.to} ${event.routedType}`;
  }
  if (event.type === "chain:complete") {
    const tokens = event.totalTokens ? ` tok:${formatNumber(event.totalTokens)}` : "";
    const input = event.userInputNeeded ? " user-input-needed" : "";
    return `${event.chainId} ${event.status} ${event.message}${input}${tokens}`;
  }
  if (event.type === "chain:user-input-needed") {
    const request = event.userInputRequest || {};
    return `${event.chainId} ${request.question || event.message || "User input needed"}`;
  }
  if (event.type === "run:complete") {
    const warning = event.incident ? ` warning=${event.incident.errorType}` : "";
    return `${event.agentId} ${event.durationMs}ms exit=${event.exitCode} protocol=${event.protocolOk} ${formatTokens(event.tokens)} incident=${event.incident?.incidentId || "none"}${warning}`;
  }
  if (event.type === "run:stdout" || event.type === "run:stderr") {
    const text = String(event.text || "").replace(/\s+/g, " ").trim();
    return `${event.agentId} ${text.slice(0, 180)}`;
  }
  if (event.message) return event.message;
  return JSON.stringify(event);
}

function setBusy(busy) {
  sendButton.disabled = busy;
  handshakeButton.disabled = busy;
  testChainButton.disabled = busy;
  fullChainButton.disabled = busy;
  chatFullChainButton.disabled = busy;
  continueChainButton.disabled = busy;
}

function formatTokens(tokens) {
  if (!tokens || tokens.source === "unavailable") return "tokens:unavailable";
  const parts = [`tok:${formatNumber(tokens.total)}`];
  if (tokens.input) parts.push(`in:${formatNumber(tokens.input)}`);
  if (tokens.output) parts.push(`out:${formatNumber(tokens.output)}`);
  if (tokens.cached) parts.push(`cache:${formatNumber(tokens.cached)}`);
  if (tokens.cache_creation) parts.push(`cache-new:${formatNumber(tokens.cache_creation)}`);
  if (tokens.thoughts) parts.push(`thought:${formatNumber(tokens.thoughts)}`);
  return parts.join(" ");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}
