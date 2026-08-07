# How to build "a workflow, not a loop" — a step-by-step manual

This is the recipe behind `examples/workflows-not-loops`, written so you can
apply it to a **new** project. Every step names the file you create, the
command that checks it, and the loop it replaces.

## 0. The mental shift (read this first)

An agentic loop — plan, act, observe, correct, repeat — exists to compensate
for three things: the first attempt is bad (starved context), a failure
anywhere restarts everything (no decomposition), and correction happens on a
schedule instead of on a signal (ceremony). You don't "not use a loop" by
deleting the `while`. You remove each *reason* to loop:

| the loop exists because… | you replace it with… | artifact |
|---|---|---|
| the first attempt is bad | a contract + invariants written **before** the code, and a model check that proves the code meets them before it runs | `contract.json`, `invariants.mjs` |
| failure anywhere restarts everything | stages along the data flow, each with a typed input/output; a failure re-runs one stage | the state machine + effect mapper |
| correction happens on a cadence | backward edges that exist **only** for a concrete failure signal, carrying the exact failure, with a bounded budget that escalates to a human | transition invariants |
| the model babysits deterministic work | deterministic handlers at the edges; the model is one well-scoped handler | polyrun handlers |

What's left after those four moves is a **state machine**: a directed graph
of stages, stepped by events, with (usually one or two) backward edges that
each require a named signal. That machine is small enough to model-check
exhaustively — which is what makes the whole thing more than discipline.

---

## Step 1 — Draw the pipeline as data flow (no tools yet)

Write one line per stage: *what comes in, what goes out, what can go wrong.*
For the document pipeline:

```
raw.json        --extract-->   extracted.json     (can fail: unreadable-input)
extracted.json  --transform--> article.json       (the fuzzy/LLM step; can fail: model-unavailable)
article.json    --validate-->  pass | violation   (missing-title, broken-schema)
article.json    --render-->    article.html       (can fail: render-crashed)
```

Then decide, per failure, ONE of exactly two answers:
- **bend back** — to which single stage, carrying which exact signal, with
  what budget? (Here: a validation violation bends back to *transform only*,
  carrying the violation verbatim, at most 2 times.)
- **escalate** — stop and hand a recorded reason to a human. (Here: every
  infrastructure failure, and the 3rd validation failure.)

If you catch yourself writing "retry the whole thing" or "re-plan", stop —
that's the loop sneaking back in. Every correction must name its target
stage and its triggering signal.

## Step 2 — Write the contract (`contract.json`)

This is "front-load context" made concrete: the full universe of states,
events, and data values, **before any code**.

- `stateKeys` — the observable state. One enum key for the stage
  (`docState`), plus whatever the corrections need (`fixAttempts`,
  `lastViolation`). Keep it tiny; if a value isn't needed to decide a
  transition or to audit one, it doesn't belong here.
- `actions` — one event per stage completion (`EXTRACT_DONE`,
  `VALIDATION_FAILED {violation}` …). Completions are events *into* the
  machine; the machine never "calls" a stage.
- `dataDomain` — concrete representative values for every action field
  (`violation: ["missing-title", "broken-schema"]`). **Not optional**: the
  model checker explores exactly this universe; a field without a domain is
  invisible to it.
- `terminalStates` — where the workflow ends (`published`, `escalated`).
  An escalation terminal is what makes bounded budgets honest: exhaustion
  has somewhere to go that isn't another lap.
- `specialRules` — your anti-loop rules in prose, so a reviewer (or
  polygen) knows they're intent, not accident. Also the `noOpRule`: an
  event that doesn't apply in the current state is an **observable
  reject(reason)**, never an error — this single convention is what makes
  duplicates, stale webhooks, and at-least-once delivery safe with zero
  coordination.

## Step 3 — Write the invariants (`invariants.mjs`)

Turn every "should never happen" into a predicate. The anti-loop rules have
a standard shape — steal these four:

```js
// 1. The pipeline is directed: name the ONLY legal backward edge(s).
'pipeline-only-bends-back-on-validation-failure'
  backward move ⇒ (action === 'VALIDATION_FAILED'
                   && pre = validating && post = transforming)

// 2. Corrections happen only on a real signal: the fix counter cannot
//    move except by exactly +1 under that signal. A reflect-every-turn
//    cadence is literally unrepresentable if this holds.
'corrections-only-on-a-real-signal'

// 3. The signal is routed verbatim — "fix this", not a re-plan.
'validation-failure-records-exact-violation'
  post.lastViolation === data.violation

// 4. The budget is bounded and exhaustion escalates to a human.
'fix-budget-exhaustion-escalates'
```

Plus the two hygiene rules every machine wants: terminal states are frozen,
and stale/duplicate events are byte-for-byte no-ops.

## Step 4 — Author the machine and model-check it

Two paths to the same artifact (a SAM v2 strict-profile module):

```bash
# with an API key: polygen drafts everything and self-repairs on
# counterexamples (this project: converged with zero repairs)
node scripts/polygen.mjs --intent "<your step-1 text>" \
  --contract contract.json --model opus-5 --out out/

# without: author next.cjs by hand in the same style, then check it
node scripts/check.mjs --spec next.cjs --contract contract.json \
  --invariants invariants.mjs
```

The check explores **every reachable state × every action × every domain
value** and either says `no invariant violations reachable` or hands you a
concrete counterexample path. Note what this replaces: the try-observe-fix
grind at *runtime* becomes a counterexample-driven fix at *authoring time* —
the one loop you keep, and it's event-driven too (it only iterates when the
checker produces a concrete violation).

Do not ship until this passes. This is "the first pass is the good pass",
mechanically enforced.

## Step 5 — Declare the effects (`effects.cjs` + `effects.manifest.json`)

"Determinism at the edges" is a file boundary, not a vibe:

- **The mapper** (`effects.cjs`) is pure: *entering* a stage emits an
  intent (`entered('transforming') → {kind: 'transform', payload: {...}}`).
  The bend-back payload carries the violation verbatim — the targeted-fix
  routing lives here.
- **The manifest** declares every effect's completion wiring: which action
  fires on success, on failure, on retry exhaustion. Failure routing is
  *data*, reviewable in one screen — not `catch` blocks scattered through
  handler code.
- **The handlers** (plain async functions, registered with polyrun) do the
  actual work. Deterministic stages are ordinary functions; the model step
  is just one more handler. A *domain* failure (a validation violation) is
  a permanent, named error — it becomes the signal; an *infrastructure*
  failure retries under the manifest's policy and escalates on exhaustion.

Then check the composition — emission rules over every reachable path:

```bash
node polyrun/bin/polyrun.mjs check-effects --config polyrun.config.mjs
```

`effect-invariants.mjs` is where "no ceremony" stops being prose:
`no-correction-without-a-signal` (transform emissions ≤ 1 + failure
signals), `bend-back-never-re-runs-extraction` (blast radius is one stage),
`no-render-before-validation-pass` (order is enforced, not hoped).

## Step 6 — Run it under polyrun

```js
const rt = await createRuntime({ store, machines: [...], handlers });
rt.startWorkers(...);
await rt.create('docpipe', id);
await rt.dispatch(id, 'START', {}, actionId);   // then the events drive it
```

You write **no orchestration code**. No planner, no reflection step, no
scheduler — the machine decides, the mapper declares, the workers perform,
and every step commits atomically with its journal row. The journal is the
receipt: read it after a run and count the laps. Ours shows one directed
pass, one event-driven bend, and a stale duplicate signal absorbed as an
observable reject (`npm run demo:workflows`).

## Step 7 — Evolve it with polyvers (change ≠ re-plan)

When the workflow grows a stage (our v2 adds `linting`):

```bash
polyvers classify --old v1 --new v2          # which compatibility lanes?
polyvers migrate scaffold --old v1 --new v2  # fills what it can, throws HOLEs at humans
polyvers check --old v1 --new v2 --synthesize --out reports  # 8 gates over fleet states
polyrun migrate --config ... --apply         # then deploy passes
```

The deploy gate refuses v2 over unmigrated instances until the migration
validates fleet-wide. In-flight work crosses the version without replay
gymnastics — evolution is also a workflow, not a loop.

---

## Where a loop is still legitimate

Two places, both bounded and event-driven:

1. **The correction bend at runtime** — at most `fixAttempts` laps, each
   triggered by a named signal, then escalation. That's the article's "some
   feedback is real".
2. **Self-repair at authoring time** — polygen iterates only on a concrete
   model-checker counterexample, with a repair budget.

If you find a third loop, ask what signal triggers it and what bounds it.
No answer = it's ceremony.

## Smell test for your next design review

- A stage "re-plans" instead of naming its target and signal → loop.
- A reflection/summarize step runs every turn regardless of events → loop.
- Retry counts live in handler code instead of the machine's state → the
  budget is unbounded and unverifiable.
- The LLM calls tools inside its own reasoning to check/format/route → pull
  those out as deterministic stages; keep the model to the fuzzy middle.
- You can't answer "what does the journal of a happy-path run look like?"
  → you don't have a workflow yet.
