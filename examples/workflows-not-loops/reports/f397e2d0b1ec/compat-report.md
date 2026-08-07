# polyvers compat-report — change f397e2d0b1ec

old version `8792884f27eb` → new version `a4582a3aeed6`

**Lanes:** shape, migration, composition, vocabulary, intent, semantic
**Corpus:** 27 snapshot(s), source: synthesized (BFS-reachable states of the OLD machine — the weakest tier; prefer live or archived snapshots) — migrated through the new version's migrate.cjs before the downstream gates
**Invariant adequacy:** NOT MEASURED — invariant-set strength unknown; a PASS against weak invariants is weaker than it looks (`polynv grade` measures it)

| gate | verdict | summary |
|---|---|---|
| load | PASS | module surface, validate(), contract/manifest cross-checks |
| vocabulary | PASS | cross-version action/effect/reject-reason/terminal vocabulary |
| invariant-diff | PASS | strengthened: state:lint-attempts-within-budget, transition:pipeline-only-bends-back-on-a-failure-signal, transition:lint-failure-records-exact-violation, transition:lint-budget-exhaustion-escalates, transition:rendering-only-entered-through-lint-pass |
| migrate | PASS | migrate.cjs validated over 27 snapshot(s) (pure, accepted, projection-equal, state+transition invariants hold) — against this corpus tier; polyrun migrate's live dry run remains the apply-time gate |
| shape-roundtrip | PASS | setState round-trip over 27 snapshot(s) |
| stimuli | PASS | 10 old-version stimulus(es) (full declared domain — a conservative superset of in-flight stimuli) × 27 snapshot(s) = 270 deliveries; every outcome must be accepted or a NAMED observable reject |
| invariants-pointwise | PASS | 5 state invariant(s) × 27 snapshot(s) = 135 checks (11 transition invariant(s) need transitions, not snapshots — checked by the M1 model-check gate) |
| semantic-model-check | PASS | exhaustive check from 27 fleet snapshot(s) + init, 64 state(s) checked = 26 seeded from the fleet + 38 discovered from them; one witness per violated rule — not an affected-instance list |
| check-effects | NOT RUN (polyrun) | the machine∘mapper composition is gated by `polyrun check-effects` (effect-emission invariants over every reachable path) — not YET by polyvers (a mapper-emission walk cross-checking kinds against the manifest is a recorded follow-up) — required by: composition |
| matrix + product | NOT RUN (polyvers) | for parent/child fleets a mapper change rewires the cross-machine surface — run `polyvers matrix` (spawn/completion protocol + delivery per rollout pairing) and `polyvers product` (joint interleavings against cross-machine invariants); a delivery-clean pairing can still fail the product check — required by: composition |

## Vocabulary diff
- actions added: LINT_PASSED, LINT_FAILED
- dataDomain changed
- effect kinds added: lint

## Shape diff
- state keys added: lintAttempts
- state keys retyped: docState

## Intent diff
- invariants added: state:lint-attempts-within-budget, transition:pipeline-only-bends-back-on-a-failure-signal, transition:lint-failure-records-exact-violation, transition:lint-budget-exhaustion-escalates, transition:rendering-only-entered-through-lint-pass

## Verdict: PASS

> Scope note: 2 gate(s) this change's lanes require are not implemented in this build (see the NOT RUN rows). A PASS here is a pass over the gates that ran — nothing more.
