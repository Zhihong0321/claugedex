const agentId = process.argv[2] || "mock";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => respond());

setTimeout(() => {
  if (!stdin) respond();
}, 25);

let didRespond = false;

function respond() {
  if (didRespond) return;
  didRespond = true;
  const now = new Date().toISOString();
  const promptArg = process.argv.slice(3).join(" ");
  const prompt = stdin || promptArg || "";
  const shape = inferShape(prompt, agentId);
  const message = `Mock ${agentId} received ${prompt.length} chars`;
  const extra = inferExtraFields(shape.type);
  console.log("mock raw line before schema");
  console.log("<<<CLAUGEDEX_RESPONSE_START>>>");
  console.log(
    JSON.stringify(
      {
        claugedex: true,
        from: agentId,
        to: shape.to,
        type: shape.type,
        status: "OK",
        session_id: "mock-session",
        run_id: "mock-run",
        message,
        ...extra,
        next_action: shape.nextAction,
        observed_at: now
      },
      null,
      2
    )
  );
  console.log("<<<CLAUGEDEX_RESPONSE_END>>>");
}

function inferExtraFields(type) {
  if (type === "PLAN_TO_LOOPER") {
    return {
      plan: ["Mock Brain plan"],
      success_criteria: ["Mock success criterion"],
      constraints: ["Mock constraint"],
      risks: ["Mock risk"]
    };
  }
  if (type === "TASK_TO_CODER") {
    return {
      task: "Mock Looper task for Coder",
      target_files: ["mock.txt"],
      constraints: ["Read-only mock constraint"],
      success_criteria: ["Mock Coder returns CODER_RESULT"]
    };
  }
  if (type === "CODER_RESULT") {
    return {
      result_summary: "Mock Coder result",
      files_considered: ["mock.txt"],
      proposed_changes: ["No real changes in mock mode"],
      validation_notes: ["Mock validation passed"]
    };
  }
  return {};
}

function inferShape(prompt, agentId) {
  const to = matchRequiredValue(prompt, "to") || "app";
  const type = matchRequiredValue(prompt, "type") || "AGENT_RESPONSE";
  const nextAction = matchRequiredValue(prompt, "next_action") || "PASS_TO_APP";
  return { to, type, nextAction };
}

function matchRequiredValue(prompt, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`);
  const match = String(prompt).match(pattern);
  return match?.[1] || null;
}
