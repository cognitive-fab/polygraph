# Inventory prompt — what in an existing project is worth polygraphing

You have installed the Polygraph plugin into an old project. Before you run
`/polygraph:verify` on anything, you need to know *what to point it at*. No
command ships for this; it is a plain prompt.

Paste the block below into Claude Code at the root of the target project. It
reads the plugin's own criteria (`capture-ready` CR-1..CR-8 and `docs/SDLC.md`
Phase 0 / Phase 4) so the ranking comes from the toolset, not from the model's
priors, and it writes `docs/polygraph-inventory.md`.

---

## The prompt

````markdown
Build me an inventory of the code in this repo that is worth polygraphing.

Read the plugin's own criteria first so you rank against them, not against
your priors:
  - ${CLAUDE_PLUGIN_ROOT}/skills/capture-ready/SKILL.md   (CR-1..CR-8)
  - ${CLAUDE_PLUGIN_ROOT}/docs/SDLC.md, Phase 0 and Phase 4  (which door, and what capture costs)

WHAT COUNTS AS A CANDIDATE
A unit of *stateful* code: a machine, workflow, saga, reducer/store, protocol
or message handler, session/lifecycle manager, retry-or-timeout coordinator,
order/checkout/billing flow, permission or approval flow. It qualifies only if
it has (a) a discernible set of states, (b) a discernible set of named events
or actions, and (c) at least one rule a human would care about being violated.

Explicitly EXCLUDE and do not list: stateless transforms, pure CRUD/DAO
wrappers, thin API controllers with no transition logic, rendering/view code,
config loaders, and anything whose "state" is just a cache.

FOR EACH CANDIDATE, REPORT
1. Name + file:line of the state-change entry point(s).
2. Observable state: the fields that actually define the state (not the whole
   object). Note if state is spread across DB rows, memory, and external
   services.
3. Action vocabulary: the named events it accepts, and which carry payloads
   whose values change the outcome (candidate dataDomain).
4. Invariants at stake: 1-3 concrete "this must never happen" statements in
   the language of the business, e.g. "a customer is never charged twice",
   "an order never ships before payment settles". If you cannot state one,
   say so — that is itself a finding, and flags it for /polygraph:polynv.
5. Blast radius: what breaks in production if an invariant is violated —
   money, auth/access, data loss, irreversible external effects, or just UI
   annoyance. Cite evidence (money calls, external API writes, deletes).
6. Combinatorial risk: does it have retries, timeouts, cancellations,
   concurrent actors, out-of-order events, or partial failure? These are where
   model checking pays and tests don't.
7. Capture readiness: score CR-1..CR-8, each PASS / PARTIAL / FAIL with a
   one-line reason. Call out the killers specifically: more than one mutation
   path (CR-1), rejections that throw or silently `return state` (CR-3),
   ambient Date.now()/random/uuid/env reads inside the transition (CR-5),
   awaited I/O mid-transition (CR-6).
8. Recommended door: /polygraph:verify (audit as-is), verify-after-a-small-
   reshape (name the reshape), rewrite with polygen, or not worth it — and why.
9. Effort estimate for getting a trace corpus: LOW (a listener seam exists or
   is one line), MEDIUM (needs a wrapper + drivers), HIGH (needs emulators,
   fault injection, or a foreign-language harness).

HOW TO WORK
Search broadly before judging — grep for switch/match on a status or state
field, enums of state names, `status ===`, transition tables, dispatch/reduce/
handle/on<Event> entry points, workflow/saga/orchestrator files, and
queue/webhook consumers. Read the actual transition bodies of anything you
list; do not infer behavior from filenames. Note where the same conceptual
machine is implemented twice.

OUTPUT
Write docs/polygraph-inventory.md:
  - A ranked table: candidate | door | blast radius | combinatorial risk |
    capture effort | CR blockers. Rank by value-over-cost, not by size.
  - The per-candidate detail sections above.
  - A "rejected candidates" list, one line each, so I can see what you
    considered and dismissed.
  - A closing recommendation: the single best first target and the concrete
    next command to run on it.
Do not modify any source files. This pass is read-only.
````

---

## Tuning notes

- **Scale it.** On a large repo, prepend a scope line: *"Restrict to
  `src/billing`, `src/orders`, and `src/workers` — ignore everything else."*
  Otherwise ask for a breadth pass first and confirm the shortlist before the
  deep read.
- **Polyglot repos.** The audit path works on non-JS targets through a
  deterministic harness (`examples/polygraph-oms-go` is the template). Add
  *"include non-JS code; flag language and note it needs a foreign harness"*
  and expect those candidates to land at HIGH capture effort.
- **The invariant question is the real filter.** Item 4 is what separates
  "stateful" from "worth verifying". If it comes back thin across the board,
  the honest next step is `/polygraph:polynv` on the top one or two rather
  than `/polygraph:verify` on ten.
- **Capture readiness is a cost, not a verdict.** A FAIL on CR-3 or CR-5 does
  not disqualify a candidate — it moves the estimate from LOW to MEDIUM. Only
  a missing single step boundary (CR-1) genuinely argues for the polygen door
  over the verify door.
