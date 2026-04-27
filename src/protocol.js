const RESPONSE_START = "<<<CLAUGEDEX_RESPONSE_START>>>";
const RESPONSE_END = "<<<CLAUGEDEX_RESPONSE_END>>>";

function buildAgentPrompt({ agent, userMessage, runId, sessionId, schema }) {
  const startMarker = schema?.startMarker || RESPONSE_START;
  const endMarker = schema?.endMarker || RESPONSE_END;

  return [
    agent.contextPrompt || "",
    "",
    "ClauGeDex protocol rules:",
    `- You are agent "${agent.id}".`,
    "- Return exactly one final ClauGeDex response envelope.",
    `- Put the JSON between ${startMarker} and ${endMarker}.`,
    "- The JSON must be valid and machine parseable.",
    "- Do not put Markdown fences inside the markers.",
    "- Keep v0.0.1 responses short.",
    "",
    "Required JSON shape:",
    "{",
    '  "claugedex": true,',
    `  "from": "${agent.id}",`,
    '  "to": "app",',
    '  "type": "AGENT_RESPONSE",',
    '  "status": "OK",',
    `  "session_id": "${sessionId}",`,
    `  "run_id": "${runId}",`,
    '  "message": "short response here",',
    '  "next_action": "PASS_TO_APP"',
    "}",
    "",
    "User prompt:",
    userMessage
  ].join("\n");
}

function extractProtocolResponse(raw, schema) {
  const startMarker = schema?.startMarker || RESPONSE_START;
  const endMarker = schema?.endMarker || RESPONSE_END;
  const text = String(raw || "");
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);

  if (start !== -1 && end !== -1) {
    const jsonText = text.slice(start + startMarker.length, end).trim();
    return parseJsonEnvelope(jsonText, "markers");
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseJsonEnvelope(trimmed, "raw-json");
  }

  return {
    ok: false,
    source: "none",
    error: "CLAUGEDEX_RESPONSE_MARKERS_NOT_FOUND",
    envelope: null
  };
}

function parseJsonEnvelope(jsonText, source) {
  try {
    const envelope = JSON.parse(jsonText);
    if (!envelope || typeof envelope !== "object") {
      return {
        ok: false,
        source,
        error: "CLAUGEDEX_RESPONSE_NOT_OBJECT",
        envelope: null
      };
    }
    if (envelope.claugedex !== true) {
      return {
        ok: false,
        source,
        error: "CLAUGEDEX_RESPONSE_FLAG_MISSING",
        envelope
      };
    }
    return {
      ok: true,
      source,
      error: null,
      envelope
    };
  } catch (error) {
    return {
      ok: false,
      source,
      error: `CLAUGEDEX_RESPONSE_JSON_INVALID: ${error.message}`,
      envelope: null
    };
  }
}

module.exports = {
  RESPONSE_START,
  RESPONSE_END,
  buildAgentPrompt,
  extractProtocolResponse
};
