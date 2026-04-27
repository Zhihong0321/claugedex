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
  const message = `Mock ${agentId} received ${prompt.length} chars`;
  console.log("mock raw line before schema");
  console.log("<<<CLAUGEDEX_RESPONSE_START>>>");
  console.log(
    JSON.stringify(
      {
        claugedex: true,
        from: agentId,
        to: "app",
        type: "AGENT_RESPONSE",
        status: "OK",
        session_id: "mock-session",
        run_id: "mock-run",
        message,
        next_action: "PASS_TO_APP",
        observed_at: now
      },
      null,
      2
    )
  );
  console.log("<<<CLAUGEDEX_RESPONSE_END>>>");
}
