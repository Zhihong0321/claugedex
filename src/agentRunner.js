const { spawn } = require("child_process");
const path = require("path");
const { buildAgentPrompt, extractProtocolResponse } = require("./protocol");
const { makeRunId } = require("./logger");

async function runAgent({ agent, userMessage, session, schema, rootDir, emit }) {
  const runId = makeRunId(agent.id);
  const startedAt = Date.now();
  const cwd = path.resolve(rootDir, agent.cwd || ".");
  const fullPrompt = buildAgentPrompt({
    agent,
    userMessage,
    runId,
    sessionId: session.sessionId,
    schema
  });

  const templateValues = {
    prompt: fullPrompt,
    cwd,
    agent: agent.id,
    sessionId: session.sessionId,
    runId,
    node: process.execPath,
    npmGlobal: path.join(process.env.APPDATA || "", "npm")
  };
  const command = applyTemplates(agent.command, templateValues);
  const args = (agent.args || []).map((arg) => applyTemplates(String(arg), templateValues));
  const stdinPrompt = agent.stdinPrompt === true;
  const shell = typeof agent.shell === "boolean" ? agent.shell : defaultShellFor(command);
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1"
  };
  if (agent.promptEnv) {
    env[agent.promptEnv] = formatPromptForEnv(fullPrompt, agent.promptEnvFormat);
  }

  session.state.runCount += 1;
  session.state.agents[agent.id] = {
    status: "running",
    runId,
    startedAt: new Date(startedAt).toISOString()
  };
  session.writeState();

  const promptPath = session.writeRunArtifact(runId, `${agent.id}-prompt.txt`, fullPrompt);
  const startEvent = session.appendEvent({
    type: "run:start",
    runId,
    agentId: agent.id,
    command,
    argsPreview: args.map((arg) => (arg === fullPrompt ? "{{prompt}}" : arg)),
    cwd,
    stdinPrompt,
    promptEnv: agent.promptEnv || null,
    shell,
    promptPath
  });
  emit(startEvent);

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let child;

  const result = await new Promise((resolve) => {
    const timeoutMs = Number(agent.timeoutMs || 120000);
    const timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) {
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    child = spawn(command, args, {
      cwd,
      shell,
      stdio: stdinPrompt ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env
    });

    if (stdinPrompt) {
      child.stdin.end(fullPrompt);
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      emit(
        session.appendEvent({
          type: "run:stdout",
          runId,
          agentId: agent.id,
          text
        })
      );
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      emit(
        session.appendEvent({
          type: "run:stderr",
          runId,
          agentId: agent.id,
          text
        })
      );
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        spawnError: error.message
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        spawnError: null
      });
    });
  });

  const durationMs = Date.now() - startedAt;
  const protocol = extractProtocolResponse(stdout, schema);
  const stdoutPath = session.writeRunArtifact(runId, `${agent.id}-stdout.txt`, stdout);
  const stderrPath = session.writeRunArtifact(runId, `${agent.id}-stderr.txt`, stderr);

  let incident = null;
  if (!protocol.ok || result.spawnError || timedOut || result.exitCode !== 0) {
    const incidentId = `incident-${runId}`;
    incident = {
      incidentId,
      runId,
      agentId: agent.id,
      createdAt: new Date().toISOString(),
      errorType: classifyError({ protocol, result, timedOut }),
      protocol,
      command,
      argsPreview: args.map((arg) => (arg === fullPrompt ? "{{prompt}}" : arg)),
      cwd,
      stdinPrompt,
      promptEnv: agent.promptEnv || null,
      shell,
      timedOut,
      exitCode: result.exitCode,
      signal: result.signal,
      spawnError: result.spawnError,
      stdoutPath,
      stderrPath,
      promptPath,
      nextRecoveryTarget: "general-edge-case-handler"
    };
    incident.path = session.writeIncident(incident);
  }

  const completed = {
    type: "run:complete",
    runId,
    agentId: agent.id,
    durationMs,
    timedOut,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    stdoutPath,
    stderrPath,
    promptPath,
    protocolOk: protocol.ok,
    protocolSource: protocol.source,
    protocolError: protocol.error,
    envelope: protocol.envelope,
    incident
  };

  session.state.agents[agent.id] = {
    status: completed.incident ? "needs-attention" : "ok",
    runId,
    durationMs,
    exitCode: result.exitCode,
    protocolOk: protocol.ok,
    completedAt: new Date().toISOString()
  };
  session.state.lastRuns.unshift({
    runId,
    agentId: agent.id,
    durationMs,
    protocolOk: protocol.ok,
    incident: incident?.incidentId || null
  });
  session.state.lastRuns = session.state.lastRuns.slice(0, 50);
  session.writeRunArtifact(runId, `${agent.id}-result.json`, JSON.stringify(completed, null, 2));
  session.writeState();
  emit(session.appendEvent(completed));

  return completed;
}

function classifyError({ protocol, result, timedOut }) {
  if (timedOut) return "PROCESS_TIMEOUT";
  if (result.spawnError) return "PROCESS_SPAWN_FAILED";
  if (result.exitCode !== 0) return "PROCESS_EXIT_NON_ZERO";
  if (!protocol.ok) return "SCHEMA_PARSE_FAILED";
  return "UNKNOWN_EDGE_CASE";
}

function defaultShellFor(command) {
  if (process.platform !== "win32") return false;
  const commandText = String(command || "");
  return !/\.(exe|com)$/i.test(commandText);
}

function formatPromptForEnv(prompt, format) {
  if (format === "escaped-lines") {
    return String(prompt).replace(/\r?\n/g, "\\n");
  }
  return prompt;
}

function applyTemplates(value, replacements) {
  let next = String(value || "");
  for (const [key, replacement] of Object.entries(replacements)) {
    next = next.replaceAll(`{{${key}}}`, replacement);
  }
  return next;
}

module.exports = {
  runAgent
};
