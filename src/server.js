const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { loadConfig, publicConfig } = require("./config");
const { createSessionLogger } = require("./logger");
const { runAgent } = require("./agentRunner");

const rootDir = path.resolve(__dirname, "..");
const { config, configPath, mock } = loadConfig(rootDir, process.argv.slice(2));
const session = createSessionLogger({
  rootDir,
  sessionDir: config.sessionDir
});

const clients = new Set();
const recentEvents = [];

function emit(event) {
  recentEvents.push(event);
  if (recentEvents.length > 300) recentEvents.shift();
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

emit(
  session.appendEvent({
    type: "app:start",
    configPath,
    mock,
    sessionPath: session.sessionPath
  })
);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/events") {
      return handleEvents(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        ...publicConfig(config, { mock }),
        session: {
          id: session.sessionId,
          path: session.sessionPath,
          statePath: session.statePath,
          eventLogPath: session.eventLogPath
        }
      });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, session.state);
    }

    if (req.method === "POST" && url.pathname === "/api/handshake") {
      const body = await readJson(req);
      const targets = normalizeTargets(body.targets);
      return runTargets(res, targets, config.handshakePrompt || "hi");
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      if (!message) {
        return sendJson(res, { error: "MESSAGE_REQUIRED" }, 400);
      }
      const targets = normalizeTargets(body.targets);
      return runTargets(res, targets, message);
    }

    if (req.method === "POST" && url.pathname === "/api/test-chain") {
      return runTestChain(res);
    }

    if (req.method === "POST" && url.pathname === "/api/full-chain") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      if (!message) {
        return sendJson(res, { error: "MESSAGE_REQUIRED" }, 400);
      }
      return runFullChain(res, message);
    }

    if (req.method === "POST" && url.pathname === "/api/clear-view") {
      emit(session.appendEvent({ type: "ui:clear-view" }));
      return sendJson(res, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    const event = session.appendEvent({
      type: "app:error",
      message: error.message,
      stack: error.stack
    });
    emit(event);
    return sendJson(res, { error: error.message }, 500);
  }
});

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  for (const event of recentEvents) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

async function runTargets(res, targets, message) {
  const runEvent = session.appendEvent({
    type: "prompt:received",
    targets,
    message
  });
  emit(runEvent);

  const jobs = targets.map((agentId) => {
    const agent = config.agents[agentId];
    if (!agent || agent.enabled === false) {
      return Promise.resolve({
        type: "run:skipped",
        agentId,
        reason: "AGENT_DISABLED_OR_UNKNOWN"
      });
    }
    return runAgent({
      agent,
      userMessage: message,
      session,
      schema: config.schema,
      rootDir,
      emit
    });
  });

  const results = await Promise.all(jobs);
  return sendJson(res, { ok: true, results });
}

async function runTestChain(res) {
  const chainId = makeChainId();
  const brainPrompt = [
    "ClauGeDex Test Chain v0.0.2.",
    "Create one tiny execution plan for Looper.",
    "The plan must only ask Looper to confirm that it received Brain's plan.",
    "Do not ask Coder to edit files.",
    "Keep the plan short."
  ].join("\n");

  emit(
    session.appendEvent({
      type: "chain:start",
      chainId,
      route: ["brain", "looper", "app"],
      message: "Test Chain started: Brain -> Looper -> App"
    })
  );

  const brainResult = await runAgent({
    agent: config.agents.brain,
    userMessage: brainPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "looper",
      type: "PLAN_TO_LOOPER",
      nextAction: "PASS_TO_LOOPER",
      messageHint: "short plan for Looper"
    }
  });

  if (!isUsableAgentResult(brainResult) || !envelopeMatches(brainResult.envelope, {
    from: "brain",
    to: "looper",
    type: "PLAN_TO_LOOPER",
    status: "OK",
    next_action: "PASS_TO_LOOPER"
  })) {
    const failed = completeChain(chainId, "FAILED", "Brain did not return a usable schema response.", {
      brainRunId: brainResult.runId,
      brainIncident: brainResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult } }, 502);
  }

  emit(
    session.appendEvent({
      type: "chain:route",
      chainId,
      from: "brain",
      to: "looper",
      sourceRunId: brainResult.runId,
      routedType: brainResult.envelope?.type,
      message: "Brain output routed to Looper"
    })
  );

  const looperPrompt = [
    "ClauGeDex Test Chain v0.0.2.",
    "You are receiving Brain's routed plan through the app.",
    "Your job for this test is only to confirm the chain worked.",
    "Return success to the app. Do not call Coder.",
    "",
    "Brain envelope:",
    JSON.stringify(brainResult.envelope, null, 2)
  ].join("\n");

  const looperResult = await runAgent({
    agent: config.agents.looper,
    userMessage: looperPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "app",
      type: "CHAIN_TEST_SUCCESS",
      nextAction: "PASS_TO_APP",
      messageHint: "Looper received Brain plan and confirms chain success",
      extraFields: {
        chain_id: chainId,
        received_from: "brain"
      }
    }
  });

  if (!isUsableAgentResult(looperResult) || !envelopeMatches(looperResult.envelope, {
    from: "looper",
    to: "app",
    type: "CHAIN_TEST_SUCCESS",
    status: "OK",
    next_action: "PASS_TO_APP"
  })) {
    const failed = completeChain(chainId, "FAILED", "Looper did not return a usable schema response.", {
      brainRunId: brainResult.runId,
      looperRunId: looperResult.runId,
      looperIncident: looperResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult, looper: looperResult } }, 502);
  }

  const completed = completeChain(chainId, "OK", "Test Chain succeeded: Brain -> Looper -> App.", {
    brainRunId: brainResult.runId,
    looperRunId: looperResult.runId
  });
  return sendJson(res, { ok: true, chain: completed, results: { brain: brainResult, looper: looperResult } });
}

async function runFullChain(res, userMessage) {
  const chainId = makeChainId();
  const coderMode = getCoderMode();
  const localValidationContext = getLocalValidationContext();

  emit(
    session.appendEvent({
      type: "chain:start",
      chainId,
      route: ["brain", "looper", "coder", "looper", "app"],
      message: "Full Chain started: Brain -> Looper -> Coder -> Looper -> App",
      coderMode
    })
  );

  const brainPrompt = [
    "User request:",
    userMessage,
    "",
    "Local validation context available to Brain:",
    JSON.stringify(localValidationContext, null, 2),
    "",
    "Brain must issue Looper a plan that includes:",
    "- what to build",
    "- how to build it",
    "- success criteria",
    "- local tests or checks Looper/Coder can run here",
    "- any local environment setup that needs user permission before it can be done",
    "",
    "Brain must not assume production database, secrets, credentials, or external services are available.",
    "If env config, dependency install, auth, or service setup is needed, Brain must create a setup task for the user instead of doing it itself.",
    "If progress is blocked by missing user permission or missing user input, Brain must set user_input_needed=true and describe the request in user_input_request.",
    "Looper is the trusted local validation authority for this chain; Brain should trust Looper's reported local test result unless the report conflicts with visible evidence."
  ].join("\n");

  const brainResult = await runAgent({
    agent: config.agents.brain,
    userMessage: brainPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "looper",
      type: "PLAN_TO_LOOPER",
      nextAction: "PASS_TO_LOOPER",
      messageHint: "short implementation plan for Looper",
      extraFields: {
        build_intent: "what to build",
        implementation_approach: ["how to build it"],
        plan: ["ordered implementation steps"],
        success_criteria: ["checklist item"],
        local_test_plan: [
          {
            command: "local command or manual check",
            purpose: "what this proves",
            requires: ["local prerequisite"],
            expected_signal: "pass condition"
          }
        ],
        local_test_environment: {
          available_locally: ["detected local capability"],
          not_available_without_setup: ["missing env, service, auth, db, or dependency"],
          setup_status: "ready | needs-user-permission | unknown"
        },
        user_setup_tasks: ["permissioned setup task, or none"],
        user_input_needed: false,
        user_input_request: {
          reason: "why user input is needed, or none",
          question: "exact question for the user, or none",
          options: ["suggested answer option, or none"],
          requested_action: "what the user should do next, or none"
        },
        looper_test_authority: "Looper is trusted to run or verify the local test result for this chain.",
        constraints: ["implementation constraint"],
        risks: ["likely risk"]
      }
    }
  });

  if (!isUsableAgentResult(brainResult) || !envelopeMatches(brainResult.envelope, {
    from: "brain",
    to: "looper",
    type: "PLAN_TO_LOOPER",
    status: "OK",
    next_action: "PASS_TO_LOOPER"
  })) {
    const failed = completeChain(chainId, "FAILED", "Brain did not return PLAN_TO_LOOPER.", {
      brainRunId: brainResult.runId,
      brainIncident: brainResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult } }, 502);
  }

  emitRoute(chainId, "brain", "looper", brainResult);

  const looperPrompt = [
    "ClauGeDex Full Chain.",
    "You are receiving Brain's routed plan through the app.",
    "Convert Brain's plan into one precise task for Coder.",
    "Preserve Brain's what/how/success criteria/local test plan in the Coder task.",
    "You are the trusted local validation authority for this chain. After Coder finishes, the app will route Coder's result back to you for validation.",
    `Current Coder mode: ${coderMode}. Ask Coder to implement directly when the task is precise enough, and to stop with a clear blocker when it is not.`,
    "Keep scope tight. Map Brain's plan to actual files if they are known.",
    "Do not ask Coder to create secrets, configure production services, or set up missing env without user permission. Convert that need into user_setup_tasks.",
    "If user permission or missing user input blocks progress, set user_input_needed=true and describe the exact user request in user_input_request.",
    "",
    "Brain envelope:",
    JSON.stringify(brainResult.envelope, null, 2)
  ].join("\n");

  const looperResult = await runAgent({
    agent: config.agents.looper,
    userMessage: looperPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "coder",
      type: "TASK_TO_CODER",
      nextAction: "PASS_TO_CODER",
      messageHint: "precise Coder task ready",
      extraFields: {
        task: "precise coder task",
        target_files: ["file path"],
        constraints: ["implementation constraint"],
        success_criteria: ["checklist item"],
        local_test_commands: [
          {
            command: "local command or manual check",
            purpose: "what this proves",
            required_setup: ["local prerequisite"],
            expected_signal: "pass condition"
          }
        ],
        user_setup_tasks: ["permissioned setup task, or none"],
        user_input_needed: false,
        user_input_request: {
          reason: "why user input is needed, or none",
          question: "exact question for the user, or none",
          options: ["suggested answer option, or none"],
          requested_action: "what the user should do next, or none"
        },
        validation_owner: "looper"
      }
    }
  });

  if (!isUsableAgentResult(looperResult) || !envelopeMatches(looperResult.envelope, {
    from: "looper",
    to: "coder",
    type: "TASK_TO_CODER",
    status: "OK",
    next_action: "PASS_TO_CODER"
  })) {
    const failed = completeChain(chainId, "FAILED", "Looper did not return TASK_TO_CODER.", {
      brainRunId: brainResult.runId,
      looperRunId: looperResult.runId,
      looperIncident: looperResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult, looper: looperResult } }, 502);
  }

  emitRoute(chainId, "looper", "coder", looperResult);

  const coderPrompt = [
    "ClauGeDex Full Chain.",
    "You are receiving Looper's routed task through the app.",
    `Current Coder mode: ${coderMode}.`,
    "Implement the routed task directly when it is precise enough and inside the working folder.",
    "Keep changes scoped to the task. Preserve unrelated user edits. Run relevant validation when possible.",
    "Run the local_test_commands from Looper when they are safe and the local environment is already configured.",
    "If a test needs missing env config, secrets, auth, dependency install, a production database, or an external service, do not set that up yourself; report it in tests_blocked and user_setup_tasks.",
    "If you cannot continue without user permission or missing user input, set user_input_needed=true and describe the exact user request in user_input_request.",
    "If the task is unsafe, ambiguous, or outside the working folder, do not guess; return a clear blocker.",
    "",
    "Looper envelope:",
    JSON.stringify(looperResult.envelope, null, 2)
  ].join("\n");

  const coderResult = await runAgent({
    agent: config.agents.coder,
    userMessage: coderPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "app",
      type: "CODER_RESULT",
      nextActions: ["PASS_TO_APP", "USER_INPUT_NEEDED"],
      messageHint: "Coder completed implementation result",
      extraFields: {
        chain_id: chainId,
        result_summary: "short result summary",
        files_changed: ["file path"],
        files_considered: ["file path"],
        changes_made: ["change summary"],
        tests_run: [
          {
            command: "local command or manual check",
            status: "passed | failed | skipped",
            evidence: "short evidence"
          }
        ],
        tests_blocked: [
          {
            command: "local command or manual check",
            reason: "missing setup or unsafe requirement"
          }
        ],
        user_setup_tasks: ["permissioned setup task, or none"],
        user_input_needed: false,
        user_input_request: {
          reason: "why user input is needed, or none",
          question: "exact question for the user, or none",
          options: ["suggested answer option, or none"],
          requested_action: "what the user should do next, or none"
        },
        validation_notes: ["validation note"]
      }
    }
  });

  if (!isUsableAgentResult(coderResult) || !envelopeMatches(coderResult.envelope, {
    from: "coder",
    to: "app",
    type: "CODER_RESULT",
    status: "OK",
    next_action: ["PASS_TO_APP", "USER_INPUT_NEEDED"]
  })) {
    const failed = completeChain(chainId, "FAILED", "Coder did not return CODER_RESULT.", {
      brainRunId: brainResult.runId,
      looperRunId: looperResult.runId,
      coderRunId: coderResult.runId,
      coderIncident: coderResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult, looper: looperResult, coder: coderResult } }, 502);
  }

  emitRoute(chainId, "coder", "looper", coderResult);

  const validationPrompt = [
    "ClauGeDex Full Chain validation step.",
    "You are receiving Coder's result after implementation.",
    "You are the trusted local validation authority for this chain.",
    "Compare Coder's result against Brain's plan, success criteria, and local test plan.",
    "Trust only local evidence reported by Coder or visible in the provided envelopes.",
    "If tests passed, report PASS with next_action PASS_TO_APP.",
    "If tests failed, report FAIL with next_action PASS_TO_APP.",
    "If tests need user-approved setup or missing user input, report BLOCKED with next_action USER_INPUT_NEEDED and fill user_input_request.",
    "",
    "Brain envelope:",
    JSON.stringify(brainResult.envelope, null, 2),
    "",
    "Coder envelope:",
    JSON.stringify(coderResult.envelope, null, 2)
  ].join("\n");

  const validationResult = await runAgent({
    agent: config.agents.looper,
    userMessage: validationPrompt,
    session,
    schema: config.schema,
    rootDir,
    emit,
    responseContract: {
      to: "app",
      type: "LOOPER_VALIDATION_RESULT",
      nextActions: ["PASS_TO_APP", "USER_INPUT_NEEDED"],
      messageHint: "Looper validated Coder result against Brain plan",
      extraFields: {
        chain_id: chainId,
        validation_status: "PASS | FAIL | BLOCKED",
        trusted_test_result: "short trusted test result",
        tests_run: ["test result summary"],
        tests_blocked: ["blocked test summary"],
        matched_success_criteria: ["criterion result"],
        remaining_risks: ["risk"],
        user_setup_tasks: ["permissioned setup task, or none"],
        user_input_needed: false,
        user_input_request: {
          reason: "why user input is needed, or none",
          question: "exact question for the user, or none",
          options: ["suggested answer option, or none"],
          requested_action: "what the user should do next, or none"
        }
      }
    }
  });

  if (!isUsableAgentResult(validationResult) || !envelopeMatches(validationResult.envelope, {
    from: "looper",
    to: "app",
    type: "LOOPER_VALIDATION_RESULT",
    status: "OK",
    next_action: ["PASS_TO_APP", "USER_INPUT_NEEDED"]
  })) {
    const failed = completeChain(chainId, "FAILED", "Looper did not return LOOPER_VALIDATION_RESULT.", {
      brainRunId: brainResult.runId,
      looperRunId: looperResult.runId,
      coderRunId: coderResult.runId,
      validationRunId: validationResult.runId,
      validationIncident: validationResult.incident?.incidentId || null
    });
    return sendJson(res, { ok: false, chain: failed, results: { brain: brainResult, looper: looperResult, coder: coderResult, validation: validationResult } }, 502);
  }

  emitRoute(chainId, "looper", "app", validationResult);
  const userInputEvent = emitUserInputNeededIfBlocked(chainId, validationResult);

  const completed = completeChain(chainId, "OK", "Full Chain succeeded: Brain -> Looper -> Coder -> Looper -> App.", {
    brainRunId: brainResult.runId,
    looperRunId: looperResult.runId,
    coderRunId: coderResult.runId,
    validationRunId: validationResult.runId,
    validationStatus: validationResult.envelope.validation_status || null,
    userInputNeeded: Boolean(userInputEvent),
    totalTokens: sumResultTokens([brainResult, looperResult, coderResult, validationResult])
  });
  return sendJson(res, { ok: true, chain: completed, results: { brain: brainResult, looper: looperResult, coder: coderResult, validation: validationResult } });
}

function emitRoute(chainId, from, to, result) {
  emit(
    session.appendEvent({
      type: "chain:route",
      chainId,
      from,
      to,
      sourceRunId: result.runId,
      routedType: result.envelope?.type,
      message: `${from} output routed to ${to}`
    })
  );
}

function completeChain(chainId, status, message, details = {}) {
  const event = session.appendEvent({
    type: "chain:complete",
    chainId,
    status,
    message,
    ...details
  });
  emit(event);
  return event;
}

function isUsableAgentResult(result) {
  return Boolean(result && result.exitCode === 0 && !result.timedOut && result.protocolOk && result.envelope);
}

function envelopeMatches(envelope, expected) {
  if (!envelope) return false;
  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) return value.includes(envelope[key]);
    return envelope[key] === value;
  });
}

function sumResultTokens(results) {
  return results.reduce((total, result) => total + Number(result.tokens?.total || 0), 0);
}

function getCoderMode() {
  const coder = config.agents.coder || {};
  const sandboxMode = coder.sandboxMode || "unspecified";
  return coder.writeAccess ? `edit-enabled:${sandboxMode}` : `read-only:${sandboxMode}`;
}

function emitUserInputNeededIfBlocked(chainId, result) {
  const envelope = result.envelope || {};
  const blocked = envelope.validation_status === "BLOCKED";
  const requested = envelope.next_action === "USER_INPUT_NEEDED" || envelope.user_input_needed === true;
  if (!blocked && !requested) return null;

  const event = session.appendEvent({
    type: "chain:user-input-needed",
    chainId,
    sourceRunId: result.runId,
    from: envelope.from || result.agentId,
    message: envelope.message || "User input is needed to continue the chain.",
    userSetupTasks: Array.isArray(envelope.user_setup_tasks) ? envelope.user_setup_tasks : [],
    userInputRequest: envelope.user_input_request || null
  });
  emit(event);
  return event;
}

function getLocalValidationContext() {
  const packageJsonPath = path.join(rootDir, "package.json");
  let packageScripts = {};
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageScripts = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).scripts || {};
    } catch (error) {
      packageScripts = { parse_error: error.message };
    }
  }

  return {
    cwd: rootDir,
    package_scripts: packageScripts,
    package_manager_files: {
      package_json: fs.existsSync(packageJsonPath),
      package_lock: fs.existsSync(path.join(rootDir, "package-lock.json")),
      pnpm_lock: fs.existsSync(path.join(rootDir, "pnpm-lock.yaml")),
      yarn_lock: fs.existsSync(path.join(rootDir, "yarn.lock"))
    },
    dependency_state: {
      node_modules_present: fs.existsSync(path.join(rootDir, "node_modules"))
    },
    env_files_present: [".env", ".env.local", ".env.development"].filter((name) =>
      fs.existsSync(path.join(rootDir, name))
    ),
    local_test_guidance: [
      "Prefer commands already listed in package_scripts.",
      "Mock/smoke tests are local checks when available.",
      "Real CLI tests may require local CLI auth and should be treated as blocked if auth is unavailable.",
      "Production database, secrets, credentials, external services, and new environment setup require user permission before use."
    ]
  };
}

function makeChainId() {
  return `chain-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeTargets(targets) {
  const available = Object.keys(config.agents);
  if (!Array.isArray(targets) || targets.length === 0) return available;
  return targets.filter((target) => available.includes(target));
}

function serveStatic(req, res, pathname) {
  const publicDir = path.join(rootDir, "public");
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

const port = Number(process.env.PORT || config.port || 3737);
server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  const event = session.appendEvent({
    type: "app:listening",
    url
  });
  emit(event);
  console.log(`ClauGeDex v0.0.1 listening at ${url}`);
  console.log(`Session: ${session.sessionPath}`);
  if (mock) console.log("Mock mode enabled.");
});

server.on("error", (error) => {
  const event = session.appendEvent({
    type: "app:listen-error",
    message: error.message,
    code: error.code
  });
  emit(event);
  console.error(error.message);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    const event = session.appendEvent({
      type: "app:shutdown",
      signal
    });
    emit(event);
    server.close(() => process.exit(0));
  });
}
