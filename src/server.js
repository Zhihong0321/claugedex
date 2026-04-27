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
