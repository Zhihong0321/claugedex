const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.SMOKE_PORT || 4737);
const server = spawn(process.execPath, ["src/server.js", "--mock"], {
  cwd: rootDir,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: String(port)
  }
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
    targets: ["brain", "looper", "coder"]
  });
  if (!response.ok) {
    throw new Error("Handshake did not return ok=true");
  }
  const results = response.results || [];
  if (results.length !== 3) {
    throw new Error(`Expected 3 results, received ${results.length}`);
  }
  const bad = results.filter((result) => !result.protocolOk || result.exitCode !== 0);
  if (bad.length) {
    throw new Error(`Mock agents failed: ${bad.map((item) => item.agentId).join(", ")}`);
  }

  const chain = await postJson("/api/full-chain", {
    message: "Mock full-chain implementation test"
  });
  if (!chain.ok || chain.chain?.status !== "OK") {
    throw new Error(`Mock full chain failed: ${JSON.stringify(chain.chain || chain)}`);
  }
  if (!chain.results?.coder?.envelope?.changes_made) {
    throw new Error("Mock Coder did not return edit-mode result fields");
  }

  cleanup();
  console.log("Mock smoke passed: handshake and full chain returned valid ClauGeDex schema.");
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
