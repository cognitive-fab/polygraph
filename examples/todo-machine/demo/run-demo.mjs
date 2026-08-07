// todo-machine demo — the cron-scan loop replaced by durable, verified timers:
//
//   - SET_DUE arms a durable timer; DUE_PASSED fires as an ordinary event
//   - each overdue entry notifies ONCE (event-driven, no periodic nagging)
//   - SNOOZE is the machine's only backward edge: budget 2, then needsTriage
//   - in needsTriage the fuzzy middle runs once: a (simulated) model
//     SUGGESTS a triage; the app dispatches the ordinary DROP — the model
//     proposes, the verified machine disposes
//   - a stale timer for a superseded due date fires into the machine and is
//     journaled as an observable reject, not a bug
//
// Run:  node --no-warnings examples/todo-machine/demo/run-demo.mjs
'use strict';

import { rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRuntime } from '../../../polyrun/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const machineDir = join(here, '..', 'machine');
const stateDir = join(here, '.demo-state');
const TODO_ID = 'todo-launch-post';

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });

const say = (msg) => console.log(`[todo] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const soon = (ms) => new Date(Date.now() + ms).toISOString();

let notifications = 0;
let suggestion = null;

const rt = await createRuntime({
  store: { sqlite: join(stateDir, 'todo.sqlite') },
  machines: [{
    machineId: 'todo',
    module: join(machineDir, 'next.cjs'),
    contract: join(machineDir, 'contract.json'),
    effects: { mapper: join(machineDir, 'effects.cjs'), manifest: join(machineDir, 'effects.manifest.json') },
  }],
  handlers: {
    // Deterministic edge: deliver the reminder (here: print it).
    notifyUser: async (p) => {
      notifications += 1;
      say(`🔔 reminder ${notifications}: "write the launch post" was due ${p.dueAt} (snoozes used: ${p.snoozeCount})`);
      return {};
    },
    // The fuzzy middle, consulted exactly once, only after the budget is
    // exhausted. Simulated deterministically here; in a real app this is
    // one model call. Its output is a SUGGESTION to the app, not a mutation.
    suggestTriage: async (p) => {
      suggestion = 'drop';
      say(`🤖 triage model: snoozed ${p.snoozeCount}× and still not done — suggest DROP ('no-longer-relevant')`);
      return { suggestion };
    },
  },
  worker: { leaseMs: 4000 },
});
rt.startWorkers({ effectPollMs: 100, timerPollMs: 100 });

await rt.create('todo', TODO_ID);
say('created "write the launch post"');

const firstDue = soon(1200);
await rt.dispatch(TODO_ID, 'SET_DUE', { dueAt: firstDue }, 'set-due:1');
say(`due date set (${firstDue}) — durable timer armed, no cron scan anywhere`);

const waitFor = async (pred, ms = 15_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { state, status } = await rt.getState(TODO_ID);
    if (pred(state, status)) return state;
    await sleep(100);
  }
  throw new Error('demo timed out waiting for a state');
};

// Overdue → snooze, twice (the bounded, event-driven bend).
for (let lap = 1; lap <= 2; lap++) {
  await waitFor((s) => s.todoState === 'overdue');
  const until = soon(1200);
  await rt.dispatch(TODO_ID, 'SNOOZE', { until }, `snooze:${lap}`);
  say(`snoozed (${lap}/2) until ${until} — back to open, new timer armed`);
}

// Third overdue: the budget is spent — SNOOZE now triages instead.
await waitFor((s) => s.todoState === 'overdue');
await rt.dispatch(TODO_ID, 'SNOOZE', { until: soon(1200) }, 'snooze:3');
const triage = await waitFor((s) => s.todoState === 'needsTriage');
say(`third snooze refused a lap → needsTriage (snoozeCount stays ${triage.snoozeCount})`);

// Wait for the model's suggestion, then the app (or a human) dispatches the
// ordinary action. The machine, not the model, owns the decision.
await waitFor(() => suggestion !== null);
await rt.dispatch(TODO_ID, 'DROP', { reason: 'no-longer-relevant' }, 'drop:1');

// A stale timer for the FIRST due date redelivers (at-least-once world).
// The machine rejects it observably — no cancellation race existed.
const stale = await rt.dispatch(TODO_ID, 'DUE_PASSED', { dueAt: firstDue }, 'stale:redelivered-timer');
say(`stale duplicate timer → ${stale.stepKind} (${stale.rejectReason})`);

const { state, status } = await rt.getState(TODO_ID);

// ---- report ------------------------------------------------------------------

console.log('\n=== journal (one item\'s whole life — also a Polygraph trace corpus) ===');
const journal = await rt.getJournal(TODO_ID);
for (const row of journal) {
  const kind = row.step_kind === 'accepted' ? 'accepted' : `${row.step_kind} (${row.reject_reason})`;
  console.log(`  #${String(row.seq).padStart(2)} ${row.action.padEnd(12)} ${kind.padEnd(36)} → ${row.post.todoState} snoozes=${row.post.snoozeCount}`);
}

const rejects = journal.filter((r) => r.step_kind === 'rejected').length;
console.log('\n=== the claims, as observed facts ===');
console.log(`  reminders sent           : ${notifications} (one per overdue entry — never on a cadence)`);
console.log(`  model consultations      : 1 (only after the budget was spent; it suggested, the machine decided)`);
console.log(`  stale timers absorbed    : ${rejects} observable reject(s), zero corruption, zero cancellation code`);
console.log(`  final                    : ${state.todoState} (doneVia=${state.doneVia})`);

const ok = status === 'terminal' && state.todoState === 'archived' &&
  state.doneVia === 'no-longer-relevant' && state.snoozeCount === 2 &&
  notifications === 3 && suggestion === 'drop' && rejects >= 1;
console.log(`\nRESULT: ${ok ? 'OK' : 'FAILED'}`);

rt.stopWorkers();
await rt.close();
process.exit(ok ? 0 : 1);
