---
name: workflow
description: Build an LLM-era feature as a WORKFLOW, not an agentic loop — the composition skill that drives the whole toolset end-to-end. Design the stages along the data flow with the user (each failure either bends back to ONE named stage carrying its exact signal under a bounded budget, or escalates to a human), front-load the contract and the never-happens invariants, author the machine with polygen, declare effects (determinism at the edges, the model as one well-scoped handler), prove the anti-loop rules with check-effects, run it durably under polyrun, and later evolve it with polyvers. Use when the user wants to "avoid the loop", de-loop an agent design, build a pipeline/workflow with an LLM step, replace a cron-scan or plan-act-reflect architecture, or asks how to apply the workflows-not-loops method to a new project. Trigger phrases: "workflow not a loop", "build this as a workflow", "de-loop this agent", "no agentic loop", "event-driven pipeline", "apply the manual".
---

# workflow — build it as a workflow, not a loop

The composition skill: where `polygen` authors one machine, this skill builds
the whole feature the workflows-not-loops way, driving the other engines in
order. The method's premise (after Adron Hall's "Loop Engineering" critique):
an agentic loop exists to compensate for starved context, missing
decomposition, and clock-driven correction — remove each reason and the loop
collapses into a directed, checkable workflow. Each of those removals is an
ARTIFACT here, not advice.

The full worked recipe with rationale is
`${CLAUDE_PLUGIN_ROOT}/examples/workflows-not-loops/MANUAL.md`; the two
reference builds are `${CLAUDE_PLUGIN_ROOT}/examples/workflows-not-loops/`
(document pipeline, incl. the v1→v2 polyvers evolution) and
`${CLAUDE_PLUGIN_ROOT}/examples/todo-machine/` (an ordinary app: durable
per-item timers replacing the cron scan, plus an HTTP shell). Read the
MANUAL before Step 1; crib file shapes from the examples, not from memory.

> Same disclosure as every engine: the checks are exhaustive over the
> contract's DECLARED finite domains — a consistency check, not a proof. The
> contract and invariants are a reading of intent and need the user's review.

## Step 1 — Draw the pipeline as data flow (WITH the user, no tools)

One line per stage: what comes in, what goes out, what can go wrong. Then
force the two-answer rule — for EVERY failure the user must pick exactly one:

- **bend back** to ONE named stage, carrying the exact signal (violation,
  reason) verbatim, under a bounded budget (pick the number now); or
- **escalate** to a human, terminal, with the reason recorded.

"Retry the whole thing" / "re-plan" is not an option — that is the loop
sneaking back in. If the user cannot name the target stage and the signal,
the design is not done. Also decide the fuzzy middle now: which single
stage(s) does a model own? Everything else must be a deterministic function.

## Step 2 — Contract + invariants (front-loaded context)

Write `contract.json` before any code: observable state (the stage enum, the
correction counters, the recorded signal), one event per stage completion,
`dataDomain` with concrete values for every field (a field without a domain
is invisible to every checker downstream), terminal states including the
escalation terminal, special rules naming the anti-loop intent, and the
`noOpRule` (unexpected events are observable rejects — this is what makes
duplicates and stale deliveries safe).

Then the never-happens list in `invariants.mjs`. The four anti-loop rules
are standard — instantiate all four every time:

1. the pipeline is directed: only the named bend(s) may move backward;
2. correction counters move ONLY by exactly +1 under their signal
   (reflect-every-turn becomes unrepresentable);
3. the signal is recorded VERBATIM (post state carries data.violation);
4. budget exhaustion escalates — never another lap.

Plus the two hygiene rules: terminals frozen; stale/duplicate events are
byte-for-byte no-ops. If the user cannot articulate invariants, run the
`polynv` skill first — that is exactly what it elicits.

## Step 3 — Author and check the machine

Author with the `polygen` skill (supply the Step-2 contract via
`--contract` — do not let it redraft what the user already reviewed). No API
key is required: per that skill's Step 0 the user chooses the scripted keyed
path (CI-grade, pinned model) or the keyless in-session path — you author
`next.cjs` in the strict-profile artifact style (copy the shape from the
examples) and gate it yourself:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs --spec next.cjs \
  --contract contract.json --invariants invariants.mjs
```

Do not proceed past a reachable violation: fix the CODE at the
counterexample (or fix a wrong contract and re-run) — never weaken an
invariant to make it pass.

## Step 4 — Effects: determinism to the edges

Three artifacts (shapes in the examples): `effects.cjs` — a pure,
edge-triggered mapper (entering a stage emits its intent; the bend-back
payload carries the violation verbatim — that is the "fix this, not a
re-plan" routing); `effects.manifest.json` — completion wiring as data
(onSuccess/onFailure/onExhausted, retry policy; a DOMAIN failure is a
permanent named error that becomes the signal, an INFRASTRUCTURE failure
retries then escalates); and `effect-invariants.mjs` — the emission rules:
no correction without a signal (stage runs ≤ 1 + failure-signal count),
blast-radius containment (a bend never re-emits upstream stages), ordering
(no render before its gate), bounded totals. Timers (due dates, timeouts)
are effect intents carrying enough data for the machine to reject stale
firings — never app-side cancellation logic. Check the composition:

```
node ${CLAUDE_PLUGIN_ROOT}/polyrun/bin/polyrun.mjs check-effects --config polyrun.config.mjs
```

If exploration reports BOUNDED, raise `--depth` until it says exhaustive —
a bounded pass is not a pass.

## Step 5 — Run it under polyrun

Write `polyrun.config.mjs` (machine, contract, effects, invariants paths +
handlers) and a demo script — crib both from the examples. Handlers are
plain async functions; the model step is just one more handler under an
idempotency key. The integrator writes ZERO orchestration code. Gate with
`polyrun.mjs deploy --config …`, then run the demo and read the journal
aloud with the user: count the laps. The journal should show a directed
pass, bends only where signals demanded them, and stale/duplicate events as
observable rejects. The journal is also a Polygraph trace corpus — name
that: `/polygraph:verify` over real captured traces is the drift check after
integration.

## Step 6 — Evolution (later, but say it now)

When the workflow changes shape, that is the `polyvers` skill: classify →
migrate scaffold → check over fleet snapshots → `polyrun.mjs migrate
--apply` → deploy gate. Tell the user this exists at handoff so the first
schema change doesn't get hand-rolled.

## The two loops that legitimately survive

Name these in the handoff, so "no loops" is never overclaimed: the runtime
correction bend (bounded, signal-driven, then a human) and polygen's
self-repair at authoring time (iterates only on a concrete model-checker
counterexample, budgeted). Any third loop in the design must answer "what
signal triggers it and what bounds it" — no answer means it is ceremony, and
the Step-2 invariants should be making it unrepresentable.
