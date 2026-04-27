# ClauGeDex

Prototype CLI bridge for Claude, Gemini, and Codex.

## v0.0.1 Goal

- Show three agent panes: Brain, Looper, and Coder.
- Send one prompt to selected CLI agents.
- Capture stdout, stderr, exit code, timing, and schema parse status.
- Persist every run into a session folder for debugging.

## v0.0.2 Test Chain

The `Test Chain` button runs a fixed bridge test:

```text
Brain -> Looper -> App
```

Brain must return `PLAN_TO_LOOPER`. The app routes that envelope into Looper. Looper must return `CHAIN_TEST_SUCCESS` to the app. Success returns to the app first because the app is the protocol bridge; Brain final review comes later.

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

- Brain: `claude -p --output-format text` with prompt on stdin
- Looper: direct Node launch of the Gemini CLI script with `--prompt "{{prompt}}" --output-format text`
- Coder: `codex exec -m gpt-5.3-codex --sandbox read-only -C "{{cwd}}"` with prompt on stdin

The app injects the role context, user prompt, session id, run id, and schema instructions into stdin. Adapters can still use `{{prompt}}` in `args` if a CLI requires prompt-as-argument mode.

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

## Prototype Safety Note

v0.0.1 logs prompts and raw CLI output by design. Do not send secrets, credentials, private keys, or customer data through this prototype until a redaction layer exists.
