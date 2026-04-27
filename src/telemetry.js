function normalizeAgentOutput(agent, stdout) {
  const raw = String(stdout || "");
  const provider = String(agent.provider || "").toLowerCase();

  if (provider.includes("claude")) {
    return normalizeClaude(raw);
  }
  if (provider.includes("gemini")) {
    return normalizeGemini(raw);
  }
  if (provider.includes("codex")) {
    return normalizeCodex(raw);
  }

  return {
    protocolText: raw,
    telemetry: emptyTelemetry("unavailable")
  };
}

function normalizeClaude(raw) {
  const parsed = parseFirstJsonValue(raw);
  if (!parsed.ok) {
    return { protocolText: raw, telemetry: emptyTelemetry("unavailable") };
  }

  const payload = parsed.value;
  const telemetry = emptyTelemetry("cli-reported");

  if (payload.modelUsage && typeof payload.modelUsage === "object") {
    for (const [model, usage] of Object.entries(payload.modelUsage)) {
      telemetry.models[model] = compactCounts({
        input: usage.inputTokens,
        output: usage.outputTokens,
        cached: usage.cacheReadInputTokens,
        cache_creation: usage.cacheCreationInputTokens
      });
      addCounts(telemetry, telemetry.models[model]);
    }
    finalizeTotal(telemetry);
    return {
      protocolText: String(payload.result || raw),
      telemetry
    };
  }

  if (payload.usage) {
    const usage = payload.usage;
    addCounts(
      telemetry,
      compactCounts({
        input: usage.input_tokens,
        output: usage.output_tokens,
        cached: usage.cache_read_input_tokens,
        cache_creation: usage.cache_creation_input_tokens
      })
    );
    finalizeTotal(telemetry);
  }

  return {
    protocolText: String(payload.result || raw),
    telemetry
  };
}

function normalizeGemini(raw) {
  const parsed = parseFirstJsonValue(raw);
  if (!parsed.ok) {
    return { protocolText: raw, telemetry: emptyTelemetry("unavailable") };
  }

  const payload = parsed.value;
  const telemetry = emptyTelemetry("cli-reported");
  const models = payload.stats?.models || {};

  for (const [model, modelStats] of Object.entries(models)) {
    const tokens = modelStats.tokens || {};
    const counts = compactCounts({
      input: tokens.input ?? tokens.prompt,
      output: tokens.candidates,
      cached: tokens.cached,
      thoughts: tokens.thoughts,
      tool: tokens.tool,
      total: tokens.total
    });
    telemetry.models[model] = counts;
    addCounts(telemetry, counts);
  }
  finalizeTotal(telemetry);

  return {
    protocolText: String(payload.response || raw),
    telemetry
  };
}

function normalizeCodex(raw) {
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!events.length) {
    return { protocolText: raw, telemetry: emptyTelemetry("unavailable") };
  }

  const messages = [];
  const telemetry = emptyTelemetry("cli-reported");

  for (const event of events) {
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      messages.push(event.item.text || "");
    }
    if (event.type === "turn.completed" && event.usage) {
      const cached = toNumber(event.usage.cached_input_tokens);
      const input = Math.max(toNumber(event.usage.input_tokens) - cached, 0);
      addCounts(
        telemetry,
        compactCounts({
          input,
          output: event.usage.output_tokens,
          cached: event.usage.cached_input_tokens
        })
      );
    }
  }

  finalizeTotal(telemetry);

  return {
    protocolText: messages.join("\n") || raw,
    telemetry
  };
}

function emptyTelemetry(source) {
  return {
    source,
    input: 0,
    output: 0,
    cached: 0,
    cache_creation: 0,
    thoughts: 0,
    tool: 0,
    total: 0,
    models: {}
  };
}

function compactCounts(counts) {
  const normalized = {
    input: toNumber(counts.input),
    output: toNumber(counts.output),
    cached: toNumber(counts.cached),
    cache_creation: toNumber(counts.cache_creation),
    thoughts: toNumber(counts.thoughts),
    tool: toNumber(counts.tool)
  };
  normalized.total = toNumber(counts.total) || sumCoreCounts(normalized);
  return normalized;
}

function addCounts(target, counts) {
  target.input += toNumber(counts.input);
  target.output += toNumber(counts.output);
  target.cached += toNumber(counts.cached);
  target.cache_creation += toNumber(counts.cache_creation);
  target.thoughts += toNumber(counts.thoughts);
  target.tool += toNumber(counts.tool);
  target.total += toNumber(counts.total);
}

function finalizeTotal(telemetry) {
  if (!telemetry.total) {
    telemetry.total = sumCoreCounts(telemetry);
  }
  if (!telemetry.input && !telemetry.output && !telemetry.cached && !telemetry.cache_creation && !telemetry.thoughts && !telemetry.tool && !telemetry.total) {
    telemetry.source = "unavailable";
  }
}

function sumCoreCounts(counts) {
  return (
    toNumber(counts.input) +
    toNumber(counts.output) +
    toNumber(counts.cached) +
    toNumber(counts.cache_creation) +
    toNumber(counts.thoughts) +
    toNumber(counts.tool)
  );
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function parseFirstJsonValue(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  if (start === -1) return { ok: false, value: null };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      try {
        return { ok: true, value: JSON.parse(text.slice(start, index + 1)) };
      } catch {
        return { ok: false, value: null };
      }
    }
  }

  return { ok: false, value: null };
}

module.exports = {
  normalizeAgentOutput
};
