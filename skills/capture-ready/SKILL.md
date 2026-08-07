---
name: capture-ready
description: Author stateful code capture-ready BY CONSTRUCTION, in ANY language — so verification never needs an instrumentation retrofit. Apply whenever writing or substantially reshaping a state machine, workflow, reducer, store, or protocol handler in any session and any language (Python, Go, Rust, Java, TS outside polygen, …): shape the module to the eight CR requirements (one named step boundary, declared observable projection, observable rejections, a step-listener seam from the first commit, injected non-determinism, effects declared not awaited, exported scenarios, one in-flight step) so a Polygraph trace corpus falls out of a listener registration instead of an after-the-fact patch. polygen enforces most of this structurally for JS/TS; this skill is how the same discipline reaches everything polygen cannot author. Trigger phrases: "capture-ready", "instrumented from the start", "make it traceable", "write it so we can verify it later", or any request to write stateful/transition logic where polygen is not being used.
---

# capture-ready — write it instrumented, so nobody retrofits traces

The Polygraph toolchain starts working at code-generation time, not at
verification time. Every other capture path in this repo answers "the code
exists; how do I get traces out of it?" — instrument a copy, keep a patch,
hope it doesn't rot. That retrofit is only ever necessary because the code
was **shaped** without capture in mind. This skill states the rule for code
an agent writes: get the shape right at authoring time and the corpus falls
out of a listener registration — no patch, no seam hunt, nothing to
re-derive when the code moves.

Source of truth (ships with the plugin — read it when detail is needed):
`${CLAUDE_PLUGIN_ROOT}/docs/capture-ready.md`. The retrofit path for code we
did NOT write is unchanged (`polygraph` skill Step 2 + `docs/capture-spec.md`)
— never reshape someone else's target to make it easier to capture.

> Scope disclosure: capture-ready is not verified and not evidence — a module
> can satisfy all eight requirements and be wrong. It is the precondition
> that makes verification cheap and repeatable.

## When this fires

Any session where you are authoring or substantially reshaping stateful code
— a state machine, workflow, reducer, store, saga, protocol handler — in ANY
language, with or without polygen. Apply BEFORE the first commit: adding the
listener seam to a well-shaped module later is a one-line change; adding a
single step boundary to a module that grew three mutation paths is a rewrite.
If polygen is in play (JS/TS), it enforces CR-1..CR-4 and CR-8 structurally;
your job narrows to CR-5, CR-6, CR-7 as review points.

## The eight requirements

- **CR-1 — One named step boundary.** All state change flows through a single
  entry taking a named action and its data (`dispatch(action, data)`,
  `handle(msg)`, `next(state, action, data)`). No second mutation path, no
  transition logic in a route handler, view, or `useEffect`. A trace window
  is *defined* by this boundary.
- **CR-2 — Observable state is a declared projection.** One function returns
  exactly the contract's state keys — a **snapshot**, never references into a
  live model (aliasing makes `pre === post` and every window silently reads
  as a no-op).
- **CR-3 — Rejections are observable.** An action that does not apply
  produces an explicit `reject(reason)` and a window with `pre == post` —
  never a `throw` (the window is lost) and never a silent `return state`
  (deliberate no-op and unhandled become indistinguishable).
- **CR-4 — A step-listener seam exists from the first commit.** The module
  accepts an optional observer firing once per step, after the transition
  settles, with `{action, data, classification}`. Defaults to a no-op; costs
  nothing unused. This single requirement is what replaces the
  instrumentation patch forever.
- **CR-5 — Non-determinism is injected.** Clock, RNG, ID generation, env
  reads, locale formatting are constructor/config ports so a scenario can pin
  them at a seed. Ambient reads make deterministic re-capture impossible
  without redacting the very fields the transition depends on.
- **CR-6 — Effects are declared, then executed at the edge.** The transition
  returns/records effect intent; a caller performs the I/O. No `await
  fetch(...)` mid-transition. (Also the precondition for running under
  polyrun, whose journal is the strongest corpus in the system.)
- **CR-7 — Scenarios are exported functions**, callable from plain Node/CLI —
  not bodies buried in a test runner. The same drivers serve the test suite,
  the demo corpus, and any later capture run.
- **CR-8 — One in-flight step per instance.** The step boundary serializes:
  a transition settles before the next action presents. This is an observable
  serialization point, not a thread-safety claim — transactional handlers,
  queue consumers, actor mailboxes, and per-node apply loops all satisfy it.

## The language-neutral contract

Only the emitter changes per language. From the CR-4 listener, write one
NDJSON line per step:

```
{"pre":{…},"action":"NAME","data":{…},"post":{…}}
```

`pre`/`post` are the CR-2 projection. Everything downstream —
`validate_corpus.mjs`, `replay.mjs`, `check.mjs`, polyvers' stimuli gate —
consumes that shape unchanged, whatever language produced it. For JS the
emitters already exist (`scripts/instrument/sam-emitter.mjs` for SAM v2,
`tapReducer` in `scripts/instrument/trace-emitter.mjs` for reducer shapes);
for anything else, write the few lines by hand at the listener.

Reference shapes for a reducer and a service/class (and the SAM v2 one-liner)
are in `docs/capture-ready.md` §"What it looks like" — a store whose
`dispatch` computes `pre`, applies the pure reducer, emits, and exposes
`getState()` as the projection is the whole pattern in ~10 lines, in any
language.

## Anti-patterns (each forces a retrofit)

| you are about to write | instead |
|---|---|
| module-level mutable state touched from several call sites | CR-1: one boundary |
| transition logic inline in the route/component | CR-1: move it behind the boundary |
| `throw` on an invalid transition | CR-3: observable reject(reason) |
| silent `return state` for unhandled actions | CR-3: reject with a reason |
| `Date.now()` / `uuid()` / env read inside the transition | CR-5: inject as ports |
| `await` on I/O inside the transition | CR-6: declare the intent |
| projection returning live references | CR-2: snapshot |
| scenario logic only inside `describe`/`it` | CR-7: export plain functions |

## Handoff

When the module is written, say which CRs hold and which do not (never imply
all eight silently). Name the capture step for the integrator: register the
listener, run the exported scenarios, and the NDJSON corpus feeds
`/polygraph:verify` — for non-JS targets the *module* stays in its language
and only the corpus crosses over. If the code is JS/TS and being authored
fresh, prefer the `polygen` skill (the profile enforces the shape and
model-checks the result); this skill is the floor beneath it, for everything
else.
