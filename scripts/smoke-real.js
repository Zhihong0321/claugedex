const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const port = 3737;
const targets = process.argv.slice(2);
const server = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

main().catch((error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

async function main() {
  await waitForListening();
  const response = await postJson("/api/handshake", {
    targets: targets.length ? targets : ["brain", "looper", "coder"]
  });
  cleanup();

  if (!response.ok) {
    throw new Error("Handshake did not return ok=true");
  }

  const results = response.results || [];
  const summary = results.map((result) => ({
    agent: result.agentId,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    protocolOk: result.protocolOk,
    protocolError: result.protocolError,
    incident: result.incident?.incidentId || null,
    stdoutPath: result.stdoutPath,
    stderrPath: result.stderrPath
  }));

  console.log(JSON.stringify(summary, null, 2));

  const bad = results.filter((result) => result.exitCode !== 0 || result.timedOut);
  if (bad.length) {
    throw new Error(`One or more real CLI handshakes failed: ${bad.map((item) => item.agentId).join(", ")}`);
  }
}

function waitForListening() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      get("/api/config")
        .then(() => {
          clearInterval(timer);
          resolve();
        })
        .catch(() => {
          if (Date.now() - started > 10000) {
            clearInterval(timer);
            reject(new Error(`Server did not start. Output:\n${output}`));
          }
        });
    }, 200);
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: pathname }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
  });
}

function postJson(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${raw}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function cleanup() {
  if (!server.killed) server.kill("SIGTERM");
}
