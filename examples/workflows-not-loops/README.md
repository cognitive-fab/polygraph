# workflows-not-loops — Adron Hall's four moves, executed by the Polygraph toolset

A worked sample inspired by Adron Hall's *"Loop Engineering" Is Mostly Just
Broken SDLC Wearing a Costume*: a document-publishing pipeline built as a
**directed workflow** — front-loaded context, data-flow decomposition,
event-driven correction, determinism at the edges — with every one of those
claims **machine-checked before the pipeline ever runs**, then executed
durably, then evolved against a live fleet.

The article's thesis is prose; this directory turns each of its four moves
into an artifact a checker enforces:

| the article says | the toolset artifact that enforces it |
|---|---|
| **1. Front-load context so the first pass is the good pass** | The contract (`pipeline-v1/contract.json`) and invariants exist *before* the first run — polygen's discipline. The machine is model-checked exhaustively over its declared domains (27 states, 0 violations) and the deploy gate (`polyrun deploy`) refuses anything less. The first pass isn't hoped good; it's *proven* against its own stated intent. |
| **2. Decompose along data flow, not a status board** | `received → extracting → transforming → validating → rendering → published`. Each stage is an effect with a typed payload; each handler is a small unit over files (`raw.json → extracted.json → article.json → article.html`). The effect invariant `bend-back-never-re-runs-extraction` proves the blast radius of a validation failure is one stage — the failure is contained, it never "sloshes around the whole system". |
| **3. Make feedback event-driven, not clock-driven** | The ONLY backward edge in the machine is `validating → transforming`, and only the concrete signal `VALIDATION_FAILED {violation}` takes it — the violation is routed to the transform stage **verbatim** ("fix this", not a re-plan). This isn't a convention; it's the transition invariant `corrections-only-on-a-real-signal` and the emission invariant `no-correction-without-a-signal`, checked over every reachable path. A reflect-every-turn cadence is *unrepresentable* in this machine. And the fix budget is bounded: a third validation failure escalates to a human (`fix-budget-exhaustion-escalates`) instead of grinding another lap. |
| **4. Push determinism to the edges, model in the fuzzy middle** | polyrun's split exactly: the verified machine decides, the pure mapper (`effects.cjs`) *declares*, and handlers perform. In the demo, extract/validate/render are plain deterministic functions; only `transform` is the fuzzy model-shaped step — one well-scoped component under an idempotency key, not an anxious general contractor. |

And the part the article doesn't reach: **the workflow then evolves**.
`pipeline-v2/` inserts a `linting` stage (a second event-driven gate with its
own bounded budget), and `polyvers` gates the rollout against a fleet of
in-flight v1 instances — migration validated fleet-wide, old stimuli
replayed, the new machine model-checked from every live snapshot. Verdict:
PASS, no replay gymnastics, no versioning patches
([`reports/f397e2d0b1ec/compat-report.md`](reports/f397e2d0b1ec/compat-report.md)).

**New here? Start with [`MANUAL.md`](MANUAL.md)** — the step-by-step recipe
for building your own project this way.

## What's here

- `pipeline-v1/` — the deployed pipeline: contract, SAM v2 strict-profile
  machine (`next.cjs`), state/transition invariants, effect mapper +
  manifest, effect-emission invariants
- `pipeline-v2/` — the evolved pipeline (lint gate + `lintAttempts` budget),
  plus the polyvers-scaffolded `migrate.cjs` and `MIGRATION-NOTE.md`
- `polygen-out/` — the real polygen run against the same contract (module,
  invariants, report, 12-scenario trace corpus); `next.cjs` here is a
  drop-in bisimilar replacement for `pipeline-v1/next.cjs`
- `demo/run-demo.mjs` — the polyrun run (below)
- `polyrun.config.mjs` — deploy/check config (`PIPELINE_VERSION=pipeline-v2`
  selects v2)
- `reports/` — the committed polyvers compat-report

**Provenance:** `pipeline-v1`/`pipeline-v2` were authored in-session by the
frontier model in polygen's artifact style. The scripted pipeline was then
run for real against the same contract (`polygen.mjs --model opus-5`,
self-repair on) and its artifacts committed under `polygen-out/` —
**converged on iteration 0** (no repairs), 27 states, 94-window corpus,
0 replay failures. The two independently authored modules were compared by
full bisimulation over the declared domains (27 states × 270 edges):
**identical post-state and step classification on every edge**, plus
mutual cross-checks — each module passes the *other's* invariants, and the
hand-authored module replays polygen's 94-window corpus with 0 mismatches.
The only difference anywhere is one reject-reason spelling the contract
left unnamed (`start-not-applicable` vs `start-only-from-received`) —
exactly the public-API lane `polyvers` exists to police. polygen's
invariants were also stronger in two spots, and both have since been
**folded back into `pipeline-v1`/`pipeline-v2`**:
`validation-failure-records-exact-violation` pins `post.lastViolation` to
the signal's payload verbatim (v2 adds the lint analog), and
`publish-requires-clean-render` proves publishing only happens via a clean
`RENDER_DONE` and that only passing a gate ever clears a violation. Both
modules pass the strengthened union. Everything below is the mechanical,
keyless half of the loop — reproducible from the repo root, byte for byte.

## Run it (no API key anywhere)

```bash
# the article's claims, model-checked before anything runs
node scripts/check.mjs --spec examples/workflows-not-loops/pipeline-v1/next.cjs \
  --contract examples/workflows-not-loops/pipeline-v1/contract.json \
  --invariants examples/workflows-not-loops/pipeline-v1/invariants.mjs
#   → 27 states, no invariant violations reachable

# the emission layer: "no ceremony" as a checked rule over every path
node polyrun/bin/polyrun.mjs check-effects --config examples/workflows-not-loops/polyrun.config.mjs
PIPELINE_VERSION=pipeline-v2 node polyrun/bin/polyrun.mjs check-effects \
  --config examples/workflows-not-loops/polyrun.config.mjs --depth 24

# the durable run: one directed pass, one event-driven bend, zero laps
npm run demo:workflows

# the evolution: classify the v1→v2 change, then gate it against the fleet
node polyvers/bin/polyvers.mjs classify --old examples/workflows-not-loops/pipeline-v1 \
  --new examples/workflows-not-loops/pipeline-v2
node polyvers/bin/polyvers.mjs check --old examples/workflows-not-loops/pipeline-v1 \
  --new examples/workflows-not-loops/pipeline-v2 --synthesize \
  --out examples/workflows-not-loops/reports

# the rollout, against the LIVE store the demo left behind (run demo first):
# deploying v2 over an unmigrated v1 instance is REFUSED by the gate…
PIPELINE_VERSION=pipeline-v2 node polyrun/bin/polyrun.mjs deploy \
  --config examples/workflows-not-loops/polyrun.config.mjs        # → DEPLOY GATE: FAIL
# …until the scaffolded migration validates and applies fleet-wide:
PIPELINE_VERSION=pipeline-v2 node polyrun/bin/polyrun.mjs migrate \
  --config examples/workflows-not-loops/polyrun.config.mjs --apply
PIPELINE_VERSION=pipeline-v2 node polyrun/bin/polyrun.mjs deploy \
  --config examples/workflows-not-loops/polyrun.config.mjs        # → DEPLOY GATE: PASS
```

## What the demo shows

The source document genuinely lacks a title. The pipeline runs one directed
pass; validation fails **once** with the exact violation; only the transform
stage re-runs — its payload carries `violation: "missing-title"` verbatim —
and the pipeline sails on. Then a stale duplicate of the correction signal
arrives (a redelivered webhook, say): in a loop architecture that's another
lap; here the verified machine journals an observable reject and nothing
moves.

```
  # 0 $create              accepted   → received     fix=0
  # 1 START                accepted   → extracting   fix=0
  # 2 EXTRACT_DONE         accepted   → transforming fix=0
  # 3 TRANSFORM_DONE       accepted   → validating   fix=0
  # 4 VALIDATION_FAILED    accepted   → transforming fix=1   ← the one real signal
  # 5 TRANSFORM_DONE       accepted   → validating   fix=1
  # 6 VALIDATION_PASSED    accepted   → rendering    fix=1
  # 7 RENDER_DONE          accepted   → published    fix=1
  # 8 VALIDATION_FAILED    rejected (terminal)       ← ceremony, absorbed
```

The journal doubles as a Polygraph trace corpus — the deployed workflow is
continuously auditable against an independent reading of its own code.

## Where a loop legitimately survives

The article concedes some feedback is real, and this sample keeps exactly
two loops, both event-driven and bounded: the `VALIDATION_FAILED` bend (at
most 2 laps, then a human), and — at authoring time — polygen's self-repair
loop, which iterates only on a *concrete counterexample* from the model
checker, the workflow-shaped version of "tests failed? route the failing
output back for a targeted fix". Everything else is a straight line.
