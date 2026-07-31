# Trace capture — what is missing, and what already works

**Status:** design plan. Four proposals; everything else on the subject is
already built and lives in `skills/polygraph/SKILL.md` Step 2.

> Scope disclosure: capture affects **conformance**, not the model check.
> Nothing here changes what "exhaustive" means — still exhaustive over the
> finite (action, data) domains the contract declares. A better corpus makes
> the *faithfulness* claim stronger; it does not widen the *coverage* claim.

## Start here: capture is not an open problem

It is easy to read a comparison against an engine-owned instrumentation
pipeline and conclude Polygraph has a capture gap. It mostly does not. The
plugin is an agent, and capture is already assigned to the agent — explicitly,
with helpers and hard-won rules:

- **`SKILL.md` Step 2 — "Capture traces from the code (YOU run this,
  autonomously)"**: *"This is the heavy step, and it is yours to carry — not
  the user's."* Building test doubles and emulators is in scope for the agent
  (the finixpos study's agent built a payment-terminal emulator and a
  fault-injection proxy to make the target runnable).
- **Helpers ship today** in `scripts/instrument/`: `withTracing` (wrap a
  `dispatch`), `tapReducer` (Redux-style), `traceStep` (you already hold
  pre/post), and `withSamTracing` (`sam-emitter.mjs`) — which wraps a SAM
  `component` config so every dispatch emits a window, no-ops included. For
  other languages the agent writes a small emitter to the same shape.
- **Event subscription, never polling**, with evidence: in the hashicorp/raft
  field study, polling every ~2 ms missed *every* Candidate occupancy because
  elections resolved faster than the poll interval. The corpus looked healthy
  and was structurally blind to a whole state.
- **Mechanical adequacy checks**: `validate_corpus.mjs` for chaining and
  terminal-state problems, and `mutate.mjs --all` zero-flip detection, which
  names any rule no trace exercises. That is a corpus-adequacy check by
  mutation — stronger than replay-conformance alone.

So the ladder of capture mechanisms an engine might ship — SAM dispatch
wrappers, runtime hooks, OTel consumers, log parsers — is a **decision
procedure the agent already performs per target**, not a build plan. An agent
with the repo in context picks the seam and writes the shim in one turn, in
whatever language the target is written in. Re-implementing that as engine code
would be building a worse version of what already works.

**Design principle that follows:** deterministic engines own what must be
reproducible; the agent owns what is target-specific. Everything below is on
the deterministic side of that line, which is why it is worth building.

## 1. The capture harness should be a committed artifact

**The real gap.** Step 2 tells the agent to instrument a *copy* and keep the
change as a diff/patch. Nothing requires that harness to be committed, named,
or re-runnable. That is fine for a one-off audit and wrong for everything that
has to happen twice.

Consequences today:

- **polygate cannot re-capture.** CI is keyless and deterministic by design; it
  cannot spawn an agent to re-derive a shim on every merge request. So the
  corpus in CI is whatever was committed, with no guarantee the harness that
  produced it still matches the code.
- **Model-generated evidence feeds a deterministic gate.** A wrong shim
  produces a healthy-looking corpus that certifies a wrong spec — Specula's
  named reward-hacking failure mode arriving through a different door. Our
  defenses (`validate_corpus`, zero-flip) are real, but they check the corpus,
  not the provenance of the thing that produced it.
- **polyvers re-runs are not comparable.** Version-gating wants the *same*
  stimuli replayed against a new version. That presumes a stable harness.

Proposal: promote the harness to a member of the artifact family, alongside
`contract.json`, the spec, `invariants.mjs` and the corpus.

- A named location (e.g. `capture/`) holding the instrumentation patch, the
  scenario driver, and a manifest recording target commit, entry points, and
  the seam used.
- Content-hashed like the other artifacts, so `polygate`'s staleness check can
  fail a merge where the code moved but the harness did not.
- Re-runnable without a model: `node capture/run.mjs --out traces/`.

The agent still *authors* it. It just stops being disposable.

## 2. polyrun journal exporter

`docs/polyrun-spec.md:123`: *"Each row is a Polygraph trace window
`{pre, action, data, post}` — the journal **is** a trace corpus."* Dispatch
commits snapshot, journal row and effect intents in one database transaction
(FR-2.2), and concurrent dispatches to the same instance serialize
(`polyrun-spec.md:168`). A machine running under polyrun therefore has a
perfect corpus already, captured with no instrumentation and no mid-flight
observation hazard.

What is missing is the two-line path from journal rows to `*.ndjson`, and the
documentation saying this is the best corpus available anywhere in the system.
It is currently a sentence in a spec.

This is also the cleanest answer to "capture is model-generated evidence": for
polyrun-hosted machines it is not — it is a byproduct of durable execution.

**Work:** small, deterministic, no agent involvement.

## 3. Differential execution instead of replay

Replay tells you the spec is faithful *on paths the traces happened to visit*.
Once the harness from §1 exists, it exposes a way to drive the system — and
then a corpus is not strictly required:

1. Generate action sequences from the contract's declared domain.
2. Run each against both the spec and the real system.
3. Compare declared `stateKeys` after every step.

This is model-based / stateful property testing (Erlang QuickCheck,
Hypothesis `RuleBasedStateMachine`). The split is exactly right for this
codebase: the agent writes the target-specific driver, a deterministic engine
generates the sequences and does the comparison.

Better than replay on two axes: it reaches states no captured trace visited,
and a divergence yields the minimal action sequence where spec and code
disagree — the same shape as a model-check counterexample, so it lands in the
existing report format unchanged.

It also closes from the opposite direction the gap Specula fills with
code-level bug reproduction: rather than forcing a schedule to reproduce a
model-level violation, divergences are found by construction.

**Known limitation — serialization.** Reading state while a transition is in
flight is unsound. The requirement is an *observable serialization point*, not
"no concurrency": transactional app logic, event-sourced systems, queue
consumers, actor mailboxes, workflow engines, and per-node apply loops in
replicated protocols all have one, and polyrun provides one by construction.
Same boundary Specula operates within — their mutex-based recording exists to
manufacture exactly this. Out of scope either way: data races, lock ordering,
memory-model reordering.

## 4. Fidelity belongs in the verdict

Consistent with how this repo already scopes the word *exhaustive*. A
conformance result should record how it was obtained:

```json
{
  "conformance": {
    "verdict": "faithful",
    "capture": "polyrun-journal",
    "harness": "capture/@a1b2c3d",
    "windows": 1284,
    "coverage": "41/58 declared (action,data) pairs exercised"
  }
}
```

Without this, "100% conformance" from a thin corpus reads identically to
differential execution over the full declared domain. Those are not the same
claim and the artifact should not let them look alike.

## Corollary: code we author should be capture-ready by construction

The capture problem only exists for code the agent did not write. When polygen
authors a module, it is SAM v2 — so `withSamTracing` gives free, complete,
no-op-inclusive capture forever, with no shim to write and no seam to find.

Worth making explicit policy rather than leaving it an emergent property:
**stateful code authored through this toolchain ships with its capture path
already working.** That is a real argument for authoring in SAM v2 that has
nothing to do with verification aesthetics, and it should be said out loud in
`docs/polygen.md`.

## Sequencing

1. **Committed capture harness** (§1) — unblocks polygate and polyvers re-runs.
2. **polyrun journal exporter** (§2) — small, and makes durable execution pay
   for itself twice.
3. **Fidelity in the verdict** (§4) — cheap, and keeps 1–3 honest.
4. **Differential driver** (§3) — the item that makes "I have no traces" stop
   being a question at all.

Every path must emit corpora that pass
`node scripts/validate_corpus.mjs <contract.json> <traces-dir-or-file>`, so
nothing downstream — `replay.mjs`, `check.mjs`, polyvers — needs to know how a
window was produced.
