# ClauGeDex

Prototype CLI bridge for Claude, Gemini, and Codex.

## v0.0.1 Goal

- Show three agent panes: Brain, Looper, and Coder.
- Send direct chat prompts to Brain.
- Capture stdout, stderr, exit code, timing, and schema parse status.
- Persist every run into a session folder for debugging.

## v0.0.2 Test Chain

The `Test Chain` button runs a fixed bridge test:

```text
Brain -> Looper -> App
```

Brain must return `PLAN_TO_LOOPER`. The app routes that envelope into Looper. Looper must return `CHAIN_TEST_SUCCESS` to the app. Success returns to the app first because the app is the protocol bridge; Brain final review comes later.

## Full Chain

The `Run Full Chain` button sends the current prompt through:

```text
Brain -> Looper -> Coder -> Looper -> App
```

Expected route types:

- Brain: `PLAN_TO_LOOPER`
- Looper: `TASK_TO_CODER`
- Coder: `CODER_RESULT`
- Looper: `LOOPER_VALIDATION_RESULT`

Coder now runs with `workspace-write` access, so this route can edit files inside the selected working folder when Looper sends a precise implementation task. If the task is ambiguous or outside the working folder, Coder should return a blocker instead of guessing.

Brain must include what to build, how to build it, success criteria, and a local test plan when it passes work to Looper. The app injects detected local validation context, including package scripts and environment setup signals, so Brain can distinguish tests that can run locally from checks that require user-approved setup. Looper is the trusted local validation authority for the chain and returns the final validation result to the app.

When a chain is blocked on permission or missing user input, the response schema uses `user_input_needed: true`, a `user_input_request` object, and `next_action: "USER_INPUT_NEEDED"` when that action is allowed. The app emits `chain:user-input-needed` and shows a feedback panel so the user can answer and continue through Full Chain.

The sidebar chat is a Brain inbox. Use `Ask Brain` for direct planning/discussion with Brain only. Use `Run Full Chain` from the top bar or the chat panel when the prompt should route through Brain, Looper, Coder, and Looper validation.

## Run

```powershell
npm start
```

Open:

```text
http://127.0.0.1:3737
```

Safe mock mode:

```powershell
npm run start:mock
```

Smoke test:

```powershell
npm run smoke:mock
```

Real CLI smoke test:

```powershell
npm run smoke:real
```

Target only selected real agents while debugging adapters:

```powershell
node scripts/smoke-real.js looper coder
```

## CLI Defaults

Edit `claugedex.config.json` to change command adapters.

Current defaults:

- Brain: `claude -p --output-format json` with prompt on stdin
- Looper: direct Node launch of the Gemini CLI script with `--prompt "{{prompt}}" --output-format json`
- Coder: `codex exec -m gpt-5.3-codex --sandbox workspace-write --json -C "{{cwd}}"` with prompt on stdin

The app injects the role context, user prompt, session id, run id, and schema instructions into stdin or `{{prompt}}`, depending on the adapter. Structured CLI output is normalized back into ClauGeDex protocol text before schema parsing.

## Debug Output

Every app start creates:

```text
sessions/session-YYYYMMDD-HHMMSS/
├── events.jsonl
├── state.json
├── incidents/
└── runs/
```

Each run stores:

- full prompt
- raw stdout
- raw stderr
- parsed result summary

If a CLI response cannot be parsed, times out, fails to spawn, or exits non-zero, the app writes an incident package under `incidents/`. This is the handoff shape for the future General Edge Case Handler.

## Token Telemetry

ClauGeDex records token counts only, not cost. Each run result includes normalized token fields:

```json
{
  "tokens": {
    "source": "cli-reported",
    "input": 0,
    "output": 0,
    "cached": 0,
    "cache_creation": 0,
    "thoughts": 0,
    "tool": 0,
    "total": 0,
    "models": {}
  }
}
```

Cost is intentionally excluded because providers, API routes, and billing plans vary.

## Prototype Safety Note

v0.0.1 logs prompts and raw CLI output by design. Do not send secrets, credentials, private keys, or customer data through this prototype until a redaction layer exists.
