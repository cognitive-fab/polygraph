# todo-machine — a TODO app's lifecycle as a verified workflow

The concrete application of [`../workflows-not-loops/MANUAL.md`](../workflows-not-loops/MANUAL.md)
to the most ordinary app there is. The point being demonstrated: a TODO app
has two kinds of code, and only one of them belongs in a machine.

- **The shell** (routes, UI, list views) stays ordinary code — polyrun's
  `dispatch`/`getState`/`list` are the only calls it makes.
- **The lifecycle of one item** is a polygen-authored, model-checked state
  machine, one polyrun instance per todo:

```
open ──COMPLETE──────────────► completed (terminal)
open ──DUE_PASSED (timer)────► overdue
overdue ──SNOOZE {until}─────► open          ← the ONLY backward edge, budget 2
overdue ──SNOOZE, budget out─► needsTriage   ← a human (or a model SUGGESTION) decides
overdue/needsTriage ──COMPLETE/DROP──► completed | archived (terminal)
```

The loop this kills isn't an LLM loop — it's the **cron job that scans the
table every minute** for overdue items. Here each item arms its own durable
timer (`SET_DUE` → timer intent → `DUE_PASSED` fires back as an ordinary
event), and staleness is the machine's problem, verifiably: a timer carrying
a superseded due date is an observable `reject`, so there are no
cancellation races and redelivered timers are harmless by construction.

The fuzzy middle is optional and exactly one effect: entering `needsTriage`
emits `suggestTriage`, whose handler may ask a model "keep, reschedule, or
drop?". The suggestion goes to the app; a human (or the app acting on it)
dispatches the ordinary `COMPLETE`/`DROP`. **The model proposes; the
verified machine disposes.**

What the invariants pin down (`machine/invariants.mjs`, polygen-authored;
`machine/effect-invariants.mjs` for emissions):

- the only backward edge is the snooze bend, and `snoozeCount` moves only
  by exactly +1 under it — corrections are event-driven, budget 2, then
  `needsTriage` instead of another lap;
- the new due date is recorded **verbatim** from the signal;
- one notification per overdue entry, ≤ 3 per item lifetime, none without a
  `DUE_PASSED` — periodic nagging is unrepresentable;
- the model is consulted at most once, only after the budget is spent;
- terminals are frozen and record how they ended (`doneVia`); there is
  deliberately no REOPEN — re-opening is a *new instance* (fresh budget,
  fresh journal), not a mutation of a settled one.

## What's here

- `machine/` — polygen output (contract, `next.cjs`, `invariants.mjs`,
  report, trace corpus) plus the hand-written effect layer (`effects.cjs`,
  `effects.manifest.json`, `effect-invariants.mjs`)
- `demo/run-demo.mjs` — one item's whole life on real durable timers
- `polyrun.config.mjs` — deploy/check config

## Run it (no API key needed — polygen already ran; artifacts committed)

```bash
# the lifecycle rules, model-checked before anything runs
node scripts/check.mjs --spec examples/todo-machine/machine/next.cjs \
  --contract examples/todo-machine/machine/contract.json \
  --invariants examples/todo-machine/machine/invariants.mjs

# the emission rules: "no cron scan, no periodic nagging" as checked facts
node polyrun/bin/polyrun.mjs check-effects --config examples/todo-machine/polyrun.config.mjs

# one todo's life: due → remind → snooze ×2 → budget spent → triage
# suggestion → drop; then a stale timer redelivers and is absorbed
npm run demo:todo

# the clickable app: create items, watch timers fire, snooze, triage
npm run todo
#   → http://127.0.0.1:7090/todo   (the TODO app)
#   → http://127.0.0.1:7090/       (polyrun ops console: instances, journals)
```

Try in the app: give an item a 15 s due date and watch it go overdue (🔔);
snooze it twice, then watch the third snooze land in `needsTriage` with the
model's suggestion; double-click any button — the toast says "deduped",
because every click carries a stable `actionId`; open an item's journal to
see its whole life, rejects included.

## What a real app adds on top

Only the shell — and none of it contains business logic:

```js
POST /todos                → rt.create('todo', id)
POST /todos/:id/due        → rt.dispatch(id, 'SET_DUE', {dueAt}, actionId)
POST /todos/:id/snooze     → rt.dispatch(id, 'SNOOZE', {until}, actionId)
POST /todos/:id/complete   → rt.dispatch(id, 'COMPLETE', {}, actionId)
GET  /todos?state=open     → rt.list('todo', {todoState: 'open'})
```

Double-click on "complete" → same `actionId`, deduped. Crash between
"mark done" and "cancel the timer" → impossible, one ACID transaction.
The per-item journal is the audit trail — and a Polygraph trace corpus.
