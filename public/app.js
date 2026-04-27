const agentIds = ["brain", "looper", "coder"];
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

let eventCount = 0;
let activeRuns = 0;
let pendingUserInput = null;

initialize();

async function initialize() {
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

  const source = new EventSource("/api/events");
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    handleEvent(event);
  };
  source.onerror = () => {
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
    targets: selectedTargets()
  });
});

handshakeButton.addEventListener("click", async () => {
  await postPrompt("/api/handshake", {
    targets: selectedTargets()
  });
});

testChainButton.addEventListener("click", async () => {
  await postPrompt("/api/test-chain", {});
});

fullChainButton.addEventListener("click", async () => {
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
});

clearButton.addEventListener("click", async () => {
  for (const output of Object.values(outputs)) output.textContent = "";
  debugLog.textContent = "";
  eventCount = 0;
  debugCount.textContent = "0 events";
  hideUserInputPanel();
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
  }

  if (event.type === "run:stdout") {
    appendOutput(event.agentId, event.text);
  }

  if (event.type === "run:stderr") {
    appendOutput(event.agentId, `\n[stderr]\n${event.text}`);
  }

  if (event.type === "run:complete") {
    activeRuns = Math.max(0, activeRuns - 1);
    setAgentStatus(event.agentId, event.incident ? "needs-attention" : "ok");
    const schema = event.protocolOk ? `schema:${event.protocolSource}` : `schema:${event.protocolError}`;
    metas[event.agentId].textContent = `${event.durationMs}ms | exit ${event.exitCode} | ${schema} | ${formatTokens(event.tokens)}`;
  }

  if (event.type === "chain:user-input-needed") {
    showUserInputPanel(event);
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

function selectedTargets() {
  return Array.from(document.querySelectorAll("#targetRow input:checked")).map(
    (input) => input.value
  );
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
    return `${event.agentId} ${event.durationMs}ms exit=${event.exitCode} protocol=${event.protocolOk} ${formatTokens(event.tokens)} incident=${event.incident?.incidentId || "none"}`;
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
