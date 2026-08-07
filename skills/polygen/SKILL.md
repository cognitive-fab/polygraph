---
name: polygen
description: Write NEW stateful code that is verifiable from the moment it's written, instead of auditing code that already exists (that's the "polygraph" skill). Draft a contract from a feature description, author a SAM v2 strict-profile module against it (named intents/schemas/domains, keyed acceptors, reject(reason), sealed model, next-state (prime) acceptors; --legacy-bare-next authors the legacy init()/next(state, action, data) artifact), self-repair against reachable invariant violations before anything ships, and synthesize a demo/regression trace corpus. Use when the user wants to write a new state machine, workflow, or reducer and have it come out pre-verified; when they say "build a verifiable X"; or as the first half of a lifecycle that ends with wiring the result into a real app and auditing the integration with polygraph. Trigger phrases: "polygen", "write a verifiable state machine", "author verifiable code", "build me a X flow that's already checked", "generate a reducer/workflow and verify it".
---

# polygen — author verifiable code, out of the box

Companion to the `polygraph` skill. That one AUDITS code that already exists.
This one AUTHORS new code so it's verifiable from the start — closing the loop
at creation time instead of retrofitting it later. v1 is **JS/TS only**: the
generated module is directly usable only in a JS/TS codebase (porting a
verified model to another language is a real, separate problem — the port
itself would need its own differential check against the JS original — and is
out of scope here).

**The authored artifact (v0.7):** by default a **SAM v2 strict-profile
module** (`module.exports = { instance, init, actions, getState, setState }`,
sam-lib 2.1.2 vendored in the plugin): named intents with schemas and
finite domains, acceptors keyed by intent name, every not-applicable action
an observable `reject(reason)` (never a throw), sealed model, and explicit
next-state (prime) semantics — acceptors write the `next` draft and frame
untouched variables with `unchanged(...)` (sam-lib 2.1, #25). Generated code
must load **strict-clean** — `instance({}).validate()` is a hard gate at
every stage boundary, so schema/shape errors block instead of becoming report
lines, and dead wiring cannot ship silently. The self-repair loop feeds back
`lastStep()` classifications and determinism flags, not only windows and
invariants. `--legacy-bare-next` authors the original `init()`/`next()`
artifact instead. (House rule from sam-lib #29, fixed in 2.0.0-alpha.2: never rely on
`instance({}).state()`; the pipeline uses `getState()`/`setState()` only.)

> **Same disclosure as `polygraph`.** This is experimental, unproven
> technology and a *consistency check, not a proof*. A converged run means the
> authored code satisfies its OWN stated invariants over a bounded, explored
> state space — nothing more, and that space is finite only because the
> contract declares finite action/data domains; behavior at values outside
> the declared representatives is unchecked. The contract and the invariants are the model's
> reading of your intent; they need your review before either is trusted.

All scripts live under `${CLAUDE_PLUGIN_ROOT}/scripts/`. `polygen.mjs` needs
`ANTHROPIC_API_KEY` and an explicit `--model` (no default; recommend `opus-5`
with the self-repair loop on, which is the default — `fable-5` only for
one-shot runs with `--repair-max 0`, and `opus-4.8` as the retry if the API
refuses on policy grounds. Per-step source of truth: `RECOMMENDED_MODELS` in
`scripts/models.mjs`).

## Step 0 — Choose the authoring path (key or no key)

Only the AUTHORING model call needs a key. Every gate below it — the strict
`validate()` load, `check.mjs` model checking, corpus validation, replay,
`check-effects`, the polyrun deploy gate, polyvers, polynv — is pure local
execution. That means there are two legitimate paths, and the user chooses:

- **Keyed (scripted) — the CI / reproducibility path.** `polygen.mjs` with
  `ANTHROPIC_API_KEY`: pinned model id, deterministic harness, the automated
  self-repair loop, the standard `polygen-report.md`, and the synthesized
  corpus independently replayed in a separate process. This is the path for
  enterprises wiring authoring into CI, and for anyone who wants the run
  re-executable byte-for-byte later.
- **Keyless (in-session) — the zero-cost adoption path.** YOU are the
  authoring model. Author `contract.json`, the SAM v2 strict-profile
  module, and `invariants.mjs` in this session, in the exact artifact style
  (copy shapes from an existing example, e.g.
  `${CLAUDE_PLUGIN_ROOT}/examples/workflows-not-loops/pipeline-v1/`), then
  run the SAME mechanical gates the script would: `check.mjs` (fix code at
  any counterexample and re-check — that is the self-repair loop, performed
  by you), drive the module through exported scenarios to synthesize a
  corpus, `validate_corpus.mjs`, and replay in a separate process. A/B
  evidence that this is not a degraded mode: an in-session-authored machine
  and a scripted `polygen.mjs` run against the same contract were
  behaviorally identical over the full explored space (270/270 edges,
  `examples/workflows-not-loops/README.md` "Provenance") — the checkers, not
  the key, carry the guarantee.

**When no key is present, ASK — never fail silently and never fall back
silently.** The user decides, with the tradeoffs in front of them. The
question to put to them, roughly:

> I don't have an `ANTHROPIC_API_KEY` in this environment. Two ways forward:
> **(a) continue keyless** — I author the artifacts in this session and run
> every mechanical gate locally (model check, corpus validation, separate-
> process replay); same checking strength, zero API cost; what you give up
> is a pinned model id and a scripted, re-runnable authoring step.
> **(b) supply a key** — the scripted `polygen.mjs` run: pinned model,
> automated repair loop, the standard report; this is the path you'd wire
> into CI. Which would you like?

If they choose keyless and later want the CI-grade run, the same contract
feeds `polygen.mjs --contract` unchanged.

State the provenance either way in the handoff ("authored in-session,
keyless, all gates green" vs "polygen.mjs, model X, converged iteration N")
— the artifacts must say which path produced them. What the keyless path
gives up is *reproducibility of the authoring step itself* (no pinned model,
no scripted rerun), never checking strength.

## Step 1 — Get the feature intent and the contract (do this WITH the user)

Ask for (or draft from) a plain-language description of the feature: the
states it moves through, the events that step it, and anything the user
already knows should never happen (a payment recorded twice, a lock releasing
without an explicit unlock).

You have two paths:
- **Model drafts the contract** (the default): pass `--intent "<description>"`
  with no `--contract`. `polygen.mjs` drafts `contract.json` from the intent —
  observable state, action alphabet, `dataDomain` (concrete values for every
  parameterized action field — **this is not optional**: an action field
  missing from `dataDomain` is silently excluded from model-checking below),
  terminal states, and special rules. **Review this before continuing** — it
  is now the design spec everything else is built against; a wrong contract
  produces correctly-verified code against the wrong intent.
- **You supply the contract** (`--contract <c.json>`): use when the user
  already knows the exact shape (e.g. this is one leg of a larger system with
  an established observable-state convention).

## Step 2 — Run polygen

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/polygen.mjs \
  --intent "<feature description>" --model opus-5 --out out/
```

This authors the v2 SAM module (add `--legacy-bare-next` for `init()`/`next()`),
proposes `invariants.mjs`, then self-repairs:
model-checks the code against its own invariants and, on a reachable
violation, patches the code and re-checks — up to `--repair-max` (default 3)
rounds. It then synthesizes a demo/regression trace corpus by driving the
final code through model-proposed scenarios, validates it
(`validate_corpus.mjs`), and independently replays it in a **separate
process** as a sanity check (catches nondeterminism the in-process generation
wouldn't expose).

Everything lands in `<out>/`: `contract.json`, `next.cjs` (the module file —
the name is historical; in the default mode it contains the v2 SAM module),
`invariants.mjs`, `traces/*.ndjson`, and `polygen-report.md` (which names the
artifact mode it was authored in).

## Step 3 — Read the report and triage (do this WITH the user)

- **Converged, no domain-coverage gaps**: the code satisfies its own
  invariants over the explored space. Still review the contract and
  invariants by hand — a converged run against a wrong or incomplete contract
  proves nothing about the actual feature.
- **Did not converge within the repair budget**: the report says so plainly
  and lists the residual violation(s) with a counterexample. Do not treat this
  as shippable — either fix the code by hand at the counterexample, or re-run
  with a higher `--repair-max`.
- **Domain coverage gaps** (flagged at the top of the report): an action field
  had no `dataDomain` entry, so that action was invisible to the checker. Add
  the missing domain to `contract.json` and re-run — the "converged" verdict
  above did not actually examine that action.
- **Corpus problems that survived the one feedback retry**: read them; usually
  a scenario that doesn't drive to a declared terminal state.

## Step 4 — Hand off to integration + audit

Wiring the generated `next()` into the real app is deliberately NOT scripted —
it needs a human or an integrating agent making real judgment calls about the
handler/route/reducer it plugs into. Instruct whoever does this:

- **Call the module; do not reimplement the transition logic inline.** (v2:
  dispatch through `actions[name](data)` and read via `getState()`; legacy:
  call `next()`.) The whole point of authoring it this way is that the
  transition logic lives in exactly one place.
- Once wired up, **capture REAL traces from the running integration** and run
  `/polygraph:verify` (the `polygraph` skill) against them. This is the step
  that catches drift — e.g. someone "helpfully" tweaking the wiring later and
  reintroducing logic outside `next()`, or the pure model disagreeing with how
  the real handler actually calls it.
- **Do NOT write an instrumentation shim for the generated module.** It is
  already capture-ready: register the framework's step listener and drive the
  scenarios.

  ```js
  const control = instance({ initialState, component });
  withSamTracingV2(instance, 'traces/s1.ndjson');  // scripts/instrument/sam-emitter.mjs
  ```

  Rejected steps emit windows too, so no-ops are recorded rather than inferred.
  Instrumenting a copy is the retrofit path for code we did not write; using it
  here means the wiring, not the module, is what actually needs the seam — say
  so explicitly instead of patching around it.

## Capture-readiness review (Step 3.5 — cheap, and only cheap now)

The v2 artifact gives you most of `docs/capture-ready.md` structurally: one
named step boundary, `getState()` projecting the declared keys, observable
`reject(reason)`, a `stepListener` seam, one in-flight step per instance
(CR-1..CR-4, CR-8). Three requirements are NOT structural — check the generated
module for them before handing it off, and repair by hand if needed:

- **CR-5 — no ambient non-determinism.** `Date.now()`, `Math.random()`,
  `crypto.randomUUID()`, `process.env` inside an acceptor. These belong in
  injected ports so a scenario can pin them at a seed; otherwise the module
  cannot be re-captured deterministically, and a real corpus can only be made
  comparable by redacting fields the transition depends on.
- **CR-6 — effects declared, not awaited.** No `await fetch(...)` / DB call
  inside a transition; record the intent and let the caller perform it. This is
  also the precondition for running the module under polyrun.
- **CR-7 — scenarios exported as plain functions**, not buried in a test
  runner, so the same drivers serve the synthesized corpus and any later
  capture run.

Fixing these after the module is wired into an app is a refactor; fixing them
now is an edit. Name any you could not fix in the handoff.

## Notes to carry into the work

- The repair loop fixes CODE, never invariants — an invariant encodes intent
  by definition; if a "violation" is actually a misunderstanding of intent,
  that's a signal to fix the contract/invariants and re-run, not to weaken the
  rule until it stops firing.
- A reachable violation on iteration 0 (before any repair) usually means the
  model's first draft missed a special rule named in the contract — worth
  noting which one, the same way `polygraph`'s Step 5 does for spec-errors.
- LLM output can have a genuine syntax slip (a stray `;` where a `,` belongs).
  `polygen.mjs` retries once with the load error fed back before giving up —
  if you see a hard failure citing "still fails to load," that's a real defect
  worth a closer look, not a transient issue.

Reference implementation and origin: the SysMoBench "finixpos" study at
<https://github.com/jdubray/SysMoBench-1>, and the `polygraph` skill this one
complements.
