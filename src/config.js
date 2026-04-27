const fs = require("fs");
const path = require("path");

function loadConfig(rootDir, argv = []) {
  const configPath = path.join(rootDir, "claugedex.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const mock = argv.includes("--mock") || process.env.CLAUGEDEX_MOCK === "1";

  if (mock) {
    for (const agent of Object.values(config.agents)) {
      agent.provider = "Mock CLI";
      agent.command = process.execPath;
      agent.args = [path.join(rootDir, "scripts", "mock-agent.js"), "{{agent}}"];
      agent.stdinPrompt = true;
      delete agent.promptEnv;
      agent.shell = false;
      agent.timeoutMs = 30000;
      agent.sandboxMode = "mock";
      agent.writeAccess = false;
      agent.mock = true;
    }
  }

  return {
    config,
    configPath,
    mock
  };
}

function publicConfig(config, meta) {
  return {
    port: config.port,
    mock: meta.mock,
    sessionDir: config.sessionDir,
    schema: config.schema,
    agents: Object.fromEntries(
      Object.entries(config.agents).map(([id, agent]) => [
        id,
        {
          id: agent.id,
          label: agent.label,
          provider: agent.provider,
          enabled: agent.enabled,
          command: agent.command,
          args: agent.args,
          cwd: agent.cwd,
          sandboxMode: agent.sandboxMode || null,
          writeAccess: Boolean(agent.writeAccess),
          timeoutMs: agent.timeoutMs,
          mock: Boolean(agent.mock)
        }
      ])
    )
  };
}

module.exports = {
  loadConfig,
  publicConfig
};
