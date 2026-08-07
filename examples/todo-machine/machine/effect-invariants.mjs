// Effect-emission invariants for the todo machine: the "no cron-scan loop"
// claims as rules over every reachable path of the machine ∘ mapper
// composition.
'use strict';

const countActions = (path, name) =>
  path.actions.filter((a) => a.action === name).length;

export const effectInvariants = [
  {
    // Timers are armed only by scheduling actions: one per SET_DUE or
    // snooze-bend, never on a cadence.
    name: 'no-timer-without-a-scheduling-action',
    pred: (path) =>
      path.count('timer') <=
      countActions(path, 'SET_DUE') + countActions(path, 'SNOOZE'),
  },
  {
    // Every notification is the direct consequence of a due date passing —
    // there is no periodic "remind anyway" emission.
    name: 'no-notification-without-a-due-signal',
    pred: (path) => path.count('notifyUser') <= countActions(path, 'DUE_PASSED'),
  },
  {
    // The snooze budget bounds the whole nag cycle: at most 3 overdue
    // entries (initial + 2 snoozes) on any reachable path.
    name: 'at-most-three-notifications-per-item',
    pred: (path) => path.count('notifyUser') <= 3,
  },
  {
    // The model is consulted at most once per item, and only after the
    // budget is exhausted — never as a per-turn reflection.
    name: 'triage-suggested-at-most-once-and-only-after-exhaustion',
    pred: (path) =>
      path.count('suggestTriage') <= 1 &&
      path.emitted.every((e, i) =>
        e.kind !== 'suggestTriage' ||
        (path.actionBefore('SNOOZE', i) && path.actionBefore('DUE_PASSED', i))),
  },
];
