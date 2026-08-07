# Capture-ready by construction

**Status:** authoring guidance. Applies to stateful code *we write* — through
polygen, or by hand in any session where an agent is authoring or substantially
reshaping a state machine, workflow, reducer, or protocol handler.

Every other capture document in this repo answers *"the code exists; how do I
get a trace corpus out of it?"* — instrument a copy, find a seam, keep a patch
([`capture-plan.md`](capture-plan.md)), and eventually commit that harness as an
artifact ([`capture-spec.md`](capture-spec.md)). That is retrofitting, and it is
only necessary because the code was shaped without capture in mind.

**The rule this document states: code authored through this toolchain must not
create that problem.** Capture is not a mechanism to force onto a finished
module — it is a property of the module's shape. Get the shape right at
authoring time and the corpus falls out of a listener registration, with no
patch to apply, no seam to discover, and nothing to re-derive when the code
moves.

> Scope disclosure, same as everywhere: this strengthens the **conformance**
> claim, never the coverage claim. Capture-ready is not verified — it is the
> precondition that makes verification cheap and repeatable. "Exhaustive"
> remains exhaustive over the finite (action, data) domains the contract
> declares.

## The requirements

Eight properties. A module with all eight needs no instrumentation patch, ever.

**CR-1 — One named step boundary.** All state change flows through a single
entry taking a named action and its data (`present(proposal)`,
`actions[name](data)`, `dispatch(action, data)`, `next(state, action, data)`).
No call site mutates state directly, and no transition logic lives in a route
handler, a view, or a `useEffect`. A trace window is *defined* by this
boundary; code with three ways to change state has no well-defined step.

**CR-2 — Observable state is a declared projection.** Export a function
returning exactly the contract's `stateKeys` and nothing else — no display
strings, no timestamps, no request IDs. In the SAM v2 strict profile
`getState()` already does this from the declared `modelShape`. Elsewhere, write
`project(model)` and keep it next to the contract. The projection must return a
**snapshot**, not references into a live model: an in-place acceptor mutation
otherwise makes `pre` and `post` the same object and every window silently
reads as a no-op (`scripts/instrument/sam-emitter.mjs:73-79`).

**CR-3 — Rejections are observable, not thrown and not silently dropped.** An
action arriving where the machine ignores it must produce an explicit
`reject(reason)` and a window with `pre == post`. A `throw` loses the window
(the step never completes); an unconditional `return state` produces a window
with no reason attached. Observable rejection is what lets a failing no-op say
*why* — `rejected(reason)` vs `identity-by-mutation` vs `unhandled` — which is
the single largest triage difference between the v1 and v2 artifacts.

**CR-4 — A step-listener seam exists from the first commit.** The module
accepts an optional observer that fires once per presented action, after the
transition settles, with `{intent, data, classification}` or equivalent. It
defaults to a no-op, costs nothing when unused, and never appears in a
production code path. This is the requirement that replaces
`capture/instrument.patch` entirely: with CR-4, `capture.manifest.json` records
`seam.kind: "sam-dispatch"` (or `"listener"`) and an empty patch, and target
drift (`capture-spec.md` FR-6.1) can no longer break a harness — there is no
textual diff to rot.

**CR-5 — Non-determinism is injected, never read ambiently.** `Date.now()`,
`Math.random()`, `crypto.randomUUID()`, environment reads, and locale-dependent
formatting are constructor/config ports, so a scenario can pin them at a
declared seed. Without this, a harness cannot pass the determinism gate
(`capture-spec.md` FR-7.1/FR-7.3) except by redacting the very fields the
transition depends on.

**CR-6 — Effects are declared, then executed at the edge.** The transition
returns or records effect *intent*; a caller performs the I/O. A module that
awaits a network call mid-transition can only be captured against the real
dependency or a double — which imports the correlated-oracle risk
(`capture-spec.md` FR-3.4: a double that quietly diverges makes every
downstream verdict wrong in the same direction). Declared effects also let the
same module run under polyrun, whose journal is the strongest corpus in the
system.

**CR-7 — Scenarios are exported functions, not test-runner bodies.** Each
scenario drives the module through a sequence and is callable from plain Node.
Then `capture/run.mjs` (`capture-spec.md` FR-2.1) is a thin loop over exported
scenarios, and the same code serves the test suite and the corpus. Scenario
logic buried inside `describe`/`it` blocks has to be excavated by an agent —
exactly the disposable work this document exists to prevent.

**CR-8 — One in-flight step per instance.** The step boundary serializes:
acceptors run to completion before the next action is presented. This is the
*observable serialization point* ([`capture-plan.md`](capture-plan.md) §3) —
not a prohibition on concurrency. Transactional handlers, event-sourced
systems, queue consumers, actor mailboxes, workflow engines and per-node apply
loops all satisfy it; polyrun provides it by construction
(`polyrun-spec.md:168`). Reading state while a transition is in flight is
unsound capture regardless of how the code is shaped.

## What it looks like

**SAM v2 strict profile (what polygen authors) — already compliant.** CR-1 to
CR-4 and CR-8 come from the profile itself: named intents, `getState()`
projecting the declared `modelShape`, `reject(reason)` for every
not-applicable action, and the framework's own `stepListener`. Capture is one
line, and it includes rejected steps:

```js
const control = instance({ initialState, component });
withSamTracingV2(instance, 'traces/happy.ndjson');   // scripts/instrument/sam-emitter.mjs
await scenarios.happyPath(control.actions);
```

CR-5, CR-6 and CR-7 still need deliberate authoring — the profile does not
enforce them.

**A plain reducer.** Keep the reducer pure (that is CR-1, CR-2, CR-5, CR-6 at
once) and take the listener at the store boundary:

```js
export function reduce(state, action, data) { /* pure */ }

export function createStore(initial, { onStep = () => {} } = {}) {
  let state = initial;
  return {
    dispatch(action, data) {
      const pre = project(state);
      state = reduce(state, action, data);
      onStep({ pre, action, data, post: project(state) });   // CR-4
    },
    getState: () => project(state),                          // CR-2
  };
}
```

`tapReducer` in `scripts/instrument/trace-emitter.mjs` covers the Redux-shaped
case without even that much.

**A service or class.** Same shape: one `handle(action, data)` method (CR-1),
a `snapshot()` returning contract keys (CR-2), `{ clock, rng, ids }` injected
(CR-5), an `onStep` option (CR-4), and effects returned rather than awaited
(CR-6).

**Another language.** The requirements are language-neutral; only the emitter
changes. Write one NDJSON line per step —
`{"pre":{…},"action":"NAME","data":{…},"post":{…}}` — from the listener the
same way, and everything downstream (`validate_corpus.mjs`, `replay.mjs`,
`check.mjs`, polyvers) consumes it unchanged.

## Anti-patterns

Each of these forces a retrofit, and each is a routine thing to write if
capture was not considered:

| shape | why capture breaks | fix |
|---|---|---|
| state mutated from several call sites / module-level `let` | no definable step boundary | CR-1 |
| transition logic inline in the route handler or component | the seam is in framework code you do not own | CR-1 |
| `throw new Error('invalid transition')` | the window is lost; a rejection looks like a crash | CR-3 |
| silent `return state` for unhandled actions | window with no reason; `unhandled` and *deliberate no-op* become indistinguishable | CR-3 |
| `Date.now()` / `uuid()` read inside the transition | determinism gate cannot pass without redacting a load-bearing field | CR-5 |
| `await fetch(...)` inside the transition | capture needs the real dependency or a double | CR-6 |
| projection returning live model references | `pre === post` on every window, silently | CR-2 |
| test-only `setState()` pokes mid-scenario | breaks the `pre`/`post` chain the tracer maintains | CR-7 |

## Where this rule fires

- **polygen** authors SAM v2, so CR-1..CR-4 and CR-8 are structural. The
  authoring loop should treat CR-5, CR-6 and CR-7 as review points rather than
  aspirations — see [`polygen.md`](polygen.md).
- **Any session authoring stateful code**, polygen or not: apply these before
  the first commit. Adding CR-4 to a module that already exists is a one-line
  change; adding CR-1 to one that does not have it is a rewrite.
- **Auditing code we did not write** ([`skills/polygraph/SKILL.md`](../skills/polygraph/SKILL.md)
  Step 2): the retrofit path stays exactly as it is. This document does not
  license reshaping someone else's target to make it easier to capture — but
  when a fix is being made in that code anyway, moving it toward this shape is
  the cheap moment.

## What this does not claim

- Capture-ready is not verified, and not evidence. A module can satisfy all
  eight requirements and be wrong.
- It does not remove the need for a committed harness
  ([`capture-spec.md`](capture-spec.md)); it makes the harness trivial —
  a manifest, seeded scenarios, and a listener registration, with no patch.
- It says nothing about data races, lock ordering, or memory-model reordering.
  CR-8 asks for an observable serialization point, which is a much weaker
  property than thread safety.
