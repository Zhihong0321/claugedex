const fs = require("fs");
const path = require("path");

function createSessionLogger({ rootDir, sessionDir }) {
  const sessionId = makeSessionId();
  const sessionPath = path.resolve(rootDir, sessionDir || "sessions", sessionId);
  const runsPath = path.join(sessionPath, "runs");
  const incidentsPath = path.join(sessionPath, "incidents");
  fs.mkdirSync(runsPath, { recursive: true });
  fs.mkdirSync(incidentsPath, { recursive: true });

  const eventLogPath = path.join(sessionPath, "events.jsonl");
  const statePath = path.join(sessionPath, "state.json");
  const state = {
    sessionId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    incidentCount: 0,
    agents: {},
    lastRuns: []
  };

  function writeState() {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  function appendEvent(event) {
    const row = {
      ts: new Date().toISOString(),
      sessionId,
      ...event
    };
    fs.appendFileSync(eventLogPath, `${JSON.stringify(row)}\n`);
    return row;
  }

  function writeRunArtifact(runId, name, content) {
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(runsPath, `${runId}-${safeName}`);
    fs.writeFileSync(filePath, content ?? "");
    return filePath;
  }

  function writeIncident(incident) {
    state.incidentCount += 1;
    const filePath = path.join(incidentsPath, `${incident.incidentId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(incident, null, 2));
    writeState();
    return filePath;
  }

  writeState();

  return {
    sessionId,
    sessionPath,
    runsPath,
    incidentsPath,
    eventLogPath,
    statePath,
    state,
    appendEvent,
    writeRunArtifact,
    writeIncident,
    writeState
  };
}

function makeSessionId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `session-${stamp}`;
}

function makeRunId(agentId) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const random = Math.random().toString(16).slice(2, 8);
  return `${stamp}-${agentId}-${random}`;
}

module.exports = {
  createSessionLogger,
  makeRunId
};
