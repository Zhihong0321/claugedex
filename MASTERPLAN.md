# ClauGeDex — Masterplan
> Claude + Gemini + Codex — A New Orchestration Architecture for AI-Powered Development

---

## 1. What Is ClauGeDex, and Why?

### The Problem

Every AI coding tool today makes the same assumption:

> One model does everything — planning, managing, coding, reviewing, fixing.

This is wasteful. The most expensive model burns tokens on the cheapest tasks. The most capable brain is wasted on boilerplate. And every correction loop costs the same as the original plan.

### The Insight

In a real engineering company, no CTO writes code. No senior architect debugs typos. Work flows down a hierarchy — each level doing only what it is best at.

ClauGeDex applies this principle to AI:

```
Claude (Planner)     →  The CTO. Sets standards. Defines the goal. Never touches code.
Gemini (Looper)      →  The Team Manager. Owns execution. Loops until done. Absorbs all failures.
Codex (Coder)        →  The Developer. Executes precisely scoped tasks. Knows nothing about the bigger picture.
ClauGeDex            →  The Communication Layer. Routes, translates, monitors, resumes.
```

### Why This Is Different

| Existing Tools | ClauGeDex |
|----------------|-----------|
| One model does everything | Three models, strict role separation |
| Expensive model steers every fix | Cheap looper absorbs all failures invisibly |
| Planner sees every mistake | Planner sees only clean outcomes |
| Cost scales with complexity | Cost stays low regardless of iteration count |
| Manual model switching | Automatic hierarchy enforcement |

### The Core Promise

> **Opus-level quality. Haiku-level cost. No compromise.**

Claude sets the quality bar. Gemini enforces it cheaply. Codex pays the execution cost. ClauGeDex makes the three work as one.

---

## 2. Strategy

### The Authority Chain

```
Claude  →  issues plan + success criteria + checklist
Gemini  →  receives plan, owns Codex, loops until checklist passes, reports up
Codex   →  executes task, reports output, knows nothing beyond current task
```

Each layer treats the layer above as the human owner. Claude is Gemini's client. Gemini is Codex's boss. Neither Gemini nor Codex makes architectural decisions.

### The Invisible Failure Principle

Claude lives in a world where every plan succeeds on the first try. All failures, retries, corrections, and steering loops happen inside the Gemini–Codex layer. Claude never sees them. Claude tokens are spent on planning and final decisions only — never on debugging or correction.

### Token Economics

| Role | Model | When Used | Token Volume |
|------|-------|-----------|--------------|
| Planner | Claude Opus | Once per milestone | Minimal |
| Looper | Claude Sonnet or Gemini | Every loop iteration | Moderate |
| Coder | Codex or Claude Haiku | Every implementation | High |

Moving steering loops from Opus to Sonnet/Gemini is the primary cost lever. In a complex feature with 10 correction cycles, 9 of those cycles are now billed at Sonnet/Gemini rates instead of Opus rates.

### Communication Design

ClauGeDex is the nervous system. It must:

- Translate Claude's plan into Gemini-executable instructions
- Pass Gemini's task instructions to Codex as precise prompts
- Capture Codex output and compress it before returning to Gemini
- Capture Gemini's report and compress it before returning to Claude
- Enforce the rule: Claude never reads raw files, only summaries and diffs

---

## 3. Phase 1 — Prototype & Stability

### Goal

Prove the three-agent hierarchy works. Complete one real task end-to-end. Find what breaks. Stabilize.

This phase is not about optimization. It is about proving the concept is buildable and the communication between all three agents is reliable.

### What We Are Building in Phase 1

A standalone application — ClauGeDex — that can:

1. Accept a user-described feature request
2. Route it to Claude for planning
3. Hand Claude's plan to Gemini as a looper
4. Have Gemini drive Codex until the task is complete
5. Report the final result back to the user

No UI polish. No token dashboards. No optimization. Just proof that the loop works.

---

### Phase 1, Step 1 — Make It Run

**Objective:** ClauGeDex can launch all three CLIs and pass a message to each one.

What to test:
- Can ClauGeDex send a prompt to Claude CLI and receive a response?
- Can ClauGeDex send a prompt to Gemini CLI and receive a response?
- Can ClauGeDex send a prompt to Codex CLI and receive a response?
- Are responses captured cleanly without truncation or encoding issues?

Success criteria: All three CLIs respond to a simple "hello" command routed through ClauGeDex.

Known risks:
- Codex CLI is interactive by default. It may require `--approval-mode full-auto` or equivalent flag to run non-interactively.
- Gemini CLI authentication may differ from API key patterns.
- Claude CLI may behave differently in subprocess vs interactive mode.

---

### Phase 1, Step 2 — Complete One Simple Task

**Objective:** The full hierarchy completes one real coding task without human relay.

The task should be small, concrete, and verifiable. Example: "Create a function that takes a list of numbers and returns the median."

What to test:
- Claude produces a clear plan with success criteria
- Gemini receives the plan, prompts Codex
- Codex produces output
- Gemini validates output against Claude's criteria
- If validation fails, Gemini re-prompts Codex without involving Claude
- When done, Gemini reports success to Claude
- Claude confirms and reports to user

Success criteria: Task is completed with zero Claude involvement after the initial plan.

---

### Phase 1, Step 3 — Edge Cases and Stress Tests

After basic success, deliberately break things. Each scenario should produce a known, recoverable outcome — not a crash or silent failure.

**Edge Case 1: Codex Misunderstands the Task**
Codex produces output that does not match the spec at all. Gemini must detect this from test results or diff, re-prompt with a corrected and more specific instruction, and retry without escalating to Claude.

**Edge Case 2: Codex Hits Token Limit Mid-Task**
Codex stops generating mid-response. ClauGeDex must detect an incomplete output, summarize what was completed, and resume from the exact stopping point in a new prompt — not restart from scratch.

**Edge Case 3: Tests Pass But Output Is Wrong**
The test suite is insufficient. Tests pass but the implementation is subtly broken. This is a case where Gemini cannot detect the problem. The loop exits as "success" and reports to Claude. Claude must catch it during review. This exposes the limitation of automated test validation and informs what quality of success criteria Claude must produce in Phase 2.

**Edge Case 4: Gemini Loop Limit Reached**
Gemini has been set a maximum loop count — for example, 10 attempts. It has not reached the success criteria. It must escalate to Claude with a compressed report: what was tried, what failed, what the current state of the code is. Claude replans. Gemini resumes. ClauGeDex must handle this escalation path cleanly.

**Edge Case 5: Codex Modifies Files Outside Scope**
Codex makes changes to files not mentioned in the task. Gemini must diff the changes, detect out-of-scope modifications, revert them, and re-prompt Codex with a stricter instruction including explicit file boundaries.

**Edge Case 6: Context Window Overflow in Gemini**
After many loops, Gemini's context grows very large. It begins to lose coherence or reference earlier instructions incorrectly. ClauGeDex must detect this, compress the loop history into a short summary, and inject it as a fresh context for Gemini — effectively resetting the conversation while preserving the essential state.

**Edge Case 7: Claude API Rate Limit or Timeout**
Claude is unavailable mid-session. The loop is paused. When Claude becomes available, ClauGeDex must resume from the last known state. This requires state persistence — ClauGeDex must write its current state to disk after every significant action so no work is lost on interruption.

**Edge Case 8: Conflicting Instructions**
Claude's plan says "use TypeScript." Codex defaults to JavaScript. Gemini does not notice the conflict. Output passes tests but is in the wrong language. This tests whether Gemini reads Claude's full criteria or only the immediate task instruction.

---

### Phase 1 Success Definition

Phase 1 is complete when:

- ClauGeDex can complete a real coding task end-to-end without human relay
- All 8 edge cases have been tested and produce recoverable, non-crashing outcomes
- The system can resume after interruption without losing state
- Claude is provably not involved in any correction loop — verified by session logs

---

## 4. ClauGeDex ↔ Each CLI — Communication Design

### The Four Interfaces

**ClauGeDex → Claude**
- Input: User's natural language feature request
- Output: Structured plan with milestones, per-milestone checklist, explicit success criteria, escalation conditions, and definition of "stuck"
- Format: Claude must produce machine-parseable output. ClauGeDex must define the output schema Claude writes to.
- Rule: Claude never receives raw file contents. Only repo summaries, architecture descriptions, and Gemini's compressed reports.

**ClauGeDex → Gemini**
- Input: One milestone from Claude's plan, current repo state summary, test framework location
- Output: Loop status — either DONE (with diff summary) or STUCK (with attempt count, last error, last Codex output)
- Rule: Gemini must not interpret or expand Claude's plan. It executes it precisely as written.

**ClauGeDex → Codex**
- Input: Single, precisely scoped task. File targets named explicitly. Constraints listed. Anti-patterns named. Success condition stated.
- Output: Code changes as a git diff
- Rule: Codex receives only what it needs for the current task. No architectural context. No history. Clean slate each call.

**Gemini → ClauGeDex → Claude (Escalation Path)**
- Triggered when: loop limit reached, or Gemini explicitly cannot resolve a conflict
- Content: attempt count, last error message, current code state summary, Gemini's hypothesis about why it is stuck
- Claude receives this compressed report, not raw logs
- Claude responds with either: revised plan, alternate approach, or explicit instruction to abandon this approach

---

## 5. MVP Route

### Phase 1 — Prove It Works (Current Focus)

Target: ClauGeDex as a standalone app completing one real task through the full hierarchy.

Milestones:
1. All three CLIs respond to ClauGeDex commands
2. Full hierarchy completes one simple task
3. All 8 edge cases tested and resolved
4. System is stable and resumable

Deliverable: A working prototype with documented edge case outcomes.

---

### Phase 2 — Token Optimization

Target: Measure and prove that token cost is significantly lower than single-model approaches.

Work items:
- Instrument every API call with token counts by model
- Build a session cost report: how many Opus tokens, Sonnet tokens, Haiku/Gemini tokens per feature
- Compare against a baseline: same feature completed by Claude alone
- Implement prompt caching for Gemini's repeated context
- Implement context compression before every Claude call
- Implement diff-only reporting — Claude never reads full files, only git diffs
- Target: demonstrate 70%+ cost reduction vs Claude-only on a medium complexity feature

Deliverable: Cost comparison report with real numbers from real tasks.

---

### Phase 3 — Empower (Local AI Integration)

Target: Introduce Ollama so local models can participate in the hierarchy.

The hierarchy becomes configurable:

```
Planner   →  Claude Opus  (cloud, expensive, highest quality)
Looper    →  Gemini / Sonnet / local Llama (configurable)
Coder     →  Codex / Haiku / local DeepSeek-Coder (configurable)
```

A developer with a powerful local machine can run the looper and coder entirely offline. Only the planner hits the cloud. Cost approaches near-zero for execution.

Work items:
- Ollama integration as a drop-in for Gemini Looper role
- Ollama integration as a drop-in for Codex Coder role
- Model capability validation — test each local model against standard tasks before assigning to a role
- Configuration file: user defines which model plays which role
- Graceful fallback: if local model fails consistently, escalate to cloud equivalent

Deliverable: ClauGeDex running with a fully local looper and coder. Only planner calls hit the cloud.

---

## 6. Open Questions for Prototype Phase

These are unknowns to be answered by experimentation, not assumptions:

1. What is the minimum information Claude needs in its plan for Gemini to loop successfully without escalating?
2. What is the right loop limit before Gemini escalates? Too low = too many Claude tokens. Too high = wasted Gemini loops on an unsolvable problem.
3. How should Gemini compress its report to Claude? What is the minimum Claude needs to make a good replan decision?
4. Can Codex run reliably in fully non-interactive mode across all task types?
5. At what context size does Gemini start losing coherence? What is the compression trigger threshold?
6. How much does prompt caching on repeated Gemini context actually save in practice?
7. Does the quality of Codex output meaningfully improve when given a Claude-authored spec vs a human-authored spec?

Each prototype scenario should be designed to answer at least one of these questions.

---

## Repository Structure (Planned)

```
claugedex/
├── MASTERPLAN.md          ← This document
├── EXPERIMENTS.md         ← Scenario results and findings log
├── DECISIONS.md           ← Architecture decisions and why
├── prototype/             ← Phase 1 prototype code
│   ├── communicator/      ← ClauGeDex core routing logic
│   ├── adapters/          ← One adapter per CLI (claude, gemini, codex)
│   └── state/             ← Session state persistence
├── scenarios/             ← Test scenarios with inputs and expected outcomes
└── results/               ← Experiment results, token counts, diffs
```

---

## Guiding Principles

**Claude thinks. Gemini manages. Codex builds.**
Role separation is never violated. Claude never writes code. Gemini never makes architectural decisions. Codex never decides scope.

**Failures are invisible upward.**
Claude sees only outcomes. All mess lives below the Gemini layer.

**State is always persisted.**
Every significant action is written to disk. The system can always resume.

**Measure everything.**
Token counts, loop counts, time per milestone. Phase 2 optimization is impossible without Phase 1 measurement.

**Experiment before building.**
Every assumption in this document is a hypothesis. The prototype exists to prove or disprove them. Build the minimum needed to run the experiment. Document what you find.

---

*ClauGeDex — Orchestration architecture for the next era of AI-assisted development.*
