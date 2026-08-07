# polygen — authored spec report

> Consistency check, not a proof. This code has been model-checked against
> its own stated invariants and its demo corpus has been independently
> replayed — that is not the same as being correct. Review the contract and
> invariants below before trusting either.

- artifact: **SAM v2 strict-profile module** (`{ instance, init, actions, getState, setState }`, vendored sam-lib 2.0.0-alpha; strict validate() gate at every stage boundary)

## Contract

```json
{
  "lang": "javascript",
  "stateKeys": [
    {
      "name": "todoState",
      "type": "enum: 'open' | 'overdue' | 'needsTriage' | 'completed' | 'archived'"
    },
    {
      "name": "snoozeCount",
      "type": "integer 0..2, how many times the user snoozed an overdue item"
    },
    {
      "name": "dueAt",
      "type": "string, ISO-8601 due timestamp ('' when no due date is set)"
    },
    {
      "name": "doneVia",
      "type": "string, how the item ended: 'completed' or a drop reason ('' until terminal)"
    }
  ],
  "initState": {
    "todoState": "open",
    "snoozeCount": 0,
    "dueAt": "",
    "doneVia": ""
  },
  "actions": {
    "SET_DUE": {
      "dataFields": {
        "dueAt": "string - ISO-8601 due timestamp, non-empty"
      }
    },
    "DUE_PASSED": {
      "dataFields": {
        "dueAt": "string - the due timestamp this (timer) event was scheduled for; must match the item's current dueAt or the event is stale"
      }
    },
    "SNOOZE": {
      "dataFields": {
        "until": "string - ISO-8601 new due timestamp, non-empty; recorded verbatim as the new dueAt"
      }
    },
    "COMPLETE": {
      "dataFields": {}
    },
    "DROP": {
      "dataFields": {
        "reason": "string - why the item was dropped, non-empty"
      }
    }
  },
  "dataDomain": {
    "SET_DUE": {
      "dueAt": [
        "2026-08-07T09:00:00Z"
      ]
    },
    "DUE_PASSED": {
      "dueAt": [
        "2026-08-07T09:00:00Z",
        "2026-08-08T09:00:00Z"
      ]
    },
    "SNOOZE": {
      "until": [
        "2026-08-08T09:00:00Z"
      ]
    },
    "COMPLETE": {},
    "DROP": {
      "reason": [
        "no-longer-relevant"
      ]
    }
  },
  "terminalKey": "todoState",
  "terminalStates": [
    "completed",
    "archived"
  ],
  "specialRules": [
    {
      "name": "corrections-are-event-driven",
      "note": "The ONLY backward edge in the lifecycle is overdue -> open, taken ONLY by SNOOZE, which records the new due date (data.until) verbatim in dueAt and increments snoozeCount by exactly 1. No action exists that re-opens or re-schedules an item without a concrete signal.",
      "whenState": "todoState == 'overdue'",
      "whenAction": "SNOOZE"
    },
    {
      "name": "bounded-snooze-budget-triages",
      "note": "SNOOZE with snoozeCount already at 2 moves the item to needsTriage (a human decides: COMPLETE or DROP) instead of granting another lap. needsTriage accepts only COMPLETE and DROP.",
      "whenState": "todoState == 'overdue' && snoozeCount >= 2",
      "whenAction": "SNOOZE"
    },
    {
      "name": "stale-due-timer-reject",
      "note": "DUE_PASSED applies only in 'open' AND only when data.dueAt equals the item's current dueAt. A timer for a superseded due date, or firing after the item completed/was dropped, is an observable rejection (post == pre), never a fault — this is what makes durable at-least-once timers safe with zero cancellation races.",
      "whenState": "any state where todoState != 'open' or data.dueAt != dueAt",
      "whenAction": "DUE_PASSED"
    },
    {
      "name": "reopen-is-a-new-instance",
      "note": "completed and archived are frozen terminals: there is deliberately no REOPEN action. Un-completing a todo is creating a new instance (fresh budget, fresh journal), not mutating a settled one.",
      "whenState": "todoState == 'completed' || todoState == 'archived'",
      "whenAction": "any"
    }
  ],
  "noOpRule": "An action that does not apply in the current state is reject(reason) — an observable no-op with post == pre."
}
```

## Code (`C:\Users\jjdub\code\polygraph\examples\todo-machine\machine\next.cjs`)

```javascript
'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

const INITIAL_STATE = {
  todoState: 'open',
  snoozeCount: 0,
  dueAt: '',
  doneVia: '',
};

const SNOOZE_BUDGET = 2;

const modelShape = {
  todoState: { type: 'string' },
  snoozeCount: { type: 'number' },
  dueAt: { type: 'string' },
  doneVia: { type: 'string' },
};

const isTerminal = (todoState) =>
  todoState === 'completed' || todoState === 'archived';

const isActive = (todoState) =>
  todoState === 'open' || todoState === 'overdue' || todoState === 'needsTriage';

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;

const componentActions = {
  SET_DUE: {
    action: (data = {}) => ({ ...data }),
    schema: { dueAt: { type: 'string', required: true } },
    domain: [{ dueAt: '2026-08-07T09:00:00Z' }],
  },
  DUE_PASSED: {
    action: (data = {}) => ({ ...data }),
    schema: { dueAt: { type: 'string', required: true } },
    domain: [{ dueAt: '2026-08-07T09:00:00Z' }, { dueAt: '2026-08-08T09:00:00Z' }],
  },
  SNOOZE: {
    action: (data = {}) => ({ ...data }),
    schema: { until: { type: 'string', required: true } },
    domain: [{ until: '2026-08-08T09:00:00Z' }],
  },
  COMPLETE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  DROP: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'no-longer-relevant' }],
  },
};

const acceptors = {
  // SET_DUE: records / replaces the due timestamp, only while open.
  SET_DUE: (model) => (proposal, { reject, next, unchanged }) => {
    const data = proposal || {};
    const current = model.todoState;

    if (isTerminal(current)) {
      return reject('reopen-is-a-new-instance');
    }
    if (current !== 'open') {
      return reject('due-date-only-settable-while-open');
    }
    if (!nonEmpty(data.dueAt)) {
      return reject('due-date-must-be-non-empty');
    }

    next.dueAt = data.dueAt;
    unchanged('todoState', 'snoozeCount', 'doneVia');
  },

  // DUE_PASSED: durable, at-least-once timer. Only valid in 'open' and only
  // for the due date the item currently carries; anything else is a safe,
  // observable rejection (post == pre), never a fault.
  DUE_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    const data = proposal || {};
    const current = model.todoState;

    if (isTerminal(current)) {
      return reject('reopen-is-a-new-instance');
    }
    if (current !== 'open') {
      return reject('stale-due-timer-reject');
    }
    if (!nonEmpty(model.dueAt)) {
      return reject('stale-due-timer-reject');
    }
    if (!nonEmpty(data.dueAt) || data.dueAt !== model.dueAt) {
      return reject('stale-due-timer-reject');
    }

    next.todoState = 'overdue';
    unchanged('snoozeCount', 'dueAt', 'doneVia');
  },

  // SNOOZE: the ONLY backward edge (overdue -> open), and only under budget
  // with a concrete new due signal. Budget exhausted -> needsTriage.
  SNOOZE: (model) => (proposal, { reject, next, unchanged }) => {
    const data = proposal || {};
    const current = model.todoState;
    const count = model.snoozeCount;

    if (isTerminal(current)) {
      return reject('reopen-is-a-new-instance');
    }
    if (current === 'needsTriage') {
      // Budget already spent: a human decides via COMPLETE or DROP.
      return reject('bounded-snooze-budget-triages');
    }
    if (current !== 'overdue') {
      // Nothing re-opens or re-schedules an item without a concrete signal.
      return reject('corrections-are-event-driven');
    }
    if (!nonEmpty(data.until)) {
      // In overdue, but no concrete new due date carried by the event.
      return reject('corrections-are-event-driven');
    }
    if (typeof count !== 'number' || count < 0 || count > SNOOZE_BUDGET) {
      return reject('bounded-snooze-budget-triages');
    }

    if (count >= SNOOZE_BUDGET) {
      next.todoState = 'needsTriage';
      next.dueAt = '';
      unchanged('snoozeCount', 'doneVia');
      return;
    }

    next.todoState = 'open';
    next.dueAt = data.until;
    next.snoozeCount = model.snoozeCount + 1;
    unchanged('doneVia');
  },

  // COMPLETE: terminal success from any active state.
  COMPLETE: (model) => (proposal, { reject, next, unchanged }) => {
    const current = model.todoState;

    if (isTerminal(current)) {
      return reject('reopen-is-a-new-instance');
    }
    if (!isActive(current)) {
      return reject('complete-not-applicable-here');
    }

    next.todoState = 'completed';
    next.doneVia = 'completed';
    next.dueAt = '';
    unchanged('snoozeCount');
  },

  // DROP: terminal archive from any active state, with a non-empty reason.
  DROP: (model) => (proposal, { reject, next, unchanged }) => {
    const data = proposal || {};
    const current = model.todoState;

    if (isTerminal(current)) {
      return reject('reopen-is-a-new-instance');
    }
    if (!isActive(current)) {
      return reject('drop-not-applicable-here');
    }
    if (!nonEmpty(data.reason)) {
      return reject('drop-reason-must-be-non-empty');
    }

    next.todoState = 'archived';
    next.doneVia = data.reason;
    next.dueAt = '';
    unchanged('snoozeCount');
  },
};

const control = instance({
  initialState: { ...INITIAL_STATE },
  component: { modelShape, actions: componentActions, acceptors, reactors: [] },
});

const { intents } = control;

const getState = () => instance({}).getState();

const setState = (snapshot) => instance({}).setState(snapshot);

const init = () => setState(INITIAL_STATE);

const actions = {
  SET_DUE: (data = {}) => intents.SET_DUE(data),
  DUE_PASSED: (data = {}) => intents.DUE_PASSED(data),
  SNOOZE: (data = {}) => intents.SNOOZE(data),
  COMPLETE: (data = {}) => intents.COMPLETE(data),
  DROP: (data = {}) => intents.DROP(data),
};

module.exports = { instance, init, actions, getState, setState };
```

⚠️ **Proposed invariants — review before trusting; these encode the model's
reading of intent, not a verified spec.**

```javascript
const TERMINAL = ['completed', 'archived'];
const STATES = ['open', 'overdue', 'needsTriage', 'completed', 'archived'];

const same = (a, b) =>
  a.todoState === b.todoState &&
  a.snoozeCount === b.snoozeCount &&
  a.dueAt === b.dueAt &&
  a.doneVia === b.doneVia;

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

export const stateInvariants = [
  {
    // Shape of every reachable state: legal state name, budget kept in 0..2.
    name: 'state-name-and-snooze-budget-in-range',
    pred: (s) =>
      STATES.includes(s.todoState) &&
      typeof s.snoozeCount === 'number' &&
      Number.isInteger(s.snoozeCount) &&
      s.snoozeCount >= 0 &&
      s.snoozeCount <= 2,
  },
  {
    // dueAt discipline: overdue always carries a concrete due date; needsTriage
    // and both terminals never carry one.
    name: 'due-at-consistent-with-state',
    pred: (s) => {
      if (s.todoState === 'overdue') return nonEmpty(s.dueAt);
      if (
        s.todoState === 'needsTriage' ||
        s.todoState === 'completed' ||
        s.todoState === 'archived'
      ) {
        return s.dueAt === '';
      }
      return typeof s.dueAt === 'string';
    },
  },
  {
    // Outcome is recorded exactly in the terminals and nowhere else.
    name: 'done-via-recorded-only-in-terminals',
    pred: (s) => {
      if (s.todoState === 'completed') return s.doneVia === 'completed';
      if (s.todoState === 'archived') return nonEmpty(s.doneVia);
      return s.doneVia === '';
    },
  },
];

export const transitionInvariants = [
  {
    // reopen-is-a-new-instance: completed / archived are frozen — no action
    // may change any field of a settled item.
    name: 'terminal-states-are-frozen',
    pred: (pre, action, data, post) =>
      !TERMINAL.includes(pre.todoState) || same(pre, post),
  },
  {
    // stale-due-timer-reject: DUE_PASSED fires only in open for the exact
    // current dueAt (then -> overdue, dueAt kept); anything else is a no-op.
    name: 'due-passed-only-matching-timer-in-open',
    pred: (pre, action, data, post) => {
      if (action !== 'DUE_PASSED') return true;
      const d = data || {};
      const applies =
        pre.todoState === 'open' &&
        nonEmpty(pre.dueAt) &&
        nonEmpty(d.dueAt) &&
        d.dueAt === pre.dueAt;
      if (!applies) return same(pre, post);
      return (
        post.todoState === 'overdue' &&
        post.dueAt === pre.dueAt &&
        post.snoozeCount === pre.snoozeCount &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // corrections-are-event-driven: the only backward edge is overdue -> open,
    // taken only by SNOOZE under budget, with data.until recorded verbatim
    // and snoozeCount bumped by exactly 1.
    name: 'only-backward-edge-is-under-budget-snooze',
    pred: (pre, action, data, post) => {
      if (post.todoState === pre.todoState) return true;
      if (post.todoState !== 'open') return true;
      const d = data || {};
      return (
        action === 'SNOOZE' &&
        pre.todoState === 'overdue' &&
        pre.snoozeCount < 2 &&
        nonEmpty(d.until) &&
        post.dueAt === d.until &&
        post.snoozeCount === pre.snoozeCount + 1 &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // snoozeCount moves only by exactly +1, and only on an accepted SNOOZE
    // taken in overdue while under budget (which must land in open).
    name: 'snooze-count-moves-only-by-one-under-budget-snooze',
    pred: (pre, action, data, post) => {
      if (post.snoozeCount === pre.snoozeCount) return true;
      const d = data || {};
      return (
        action === 'SNOOZE' &&
        pre.todoState === 'overdue' &&
        pre.snoozeCount < 2 &&
        nonEmpty(d.until) &&
        post.snoozeCount === pre.snoozeCount + 1 &&
        post.todoState === 'open'
      );
    },
  },
  {
    // bounded-snooze-budget-triages: SNOOZE at the budget goes to needsTriage
    // (dueAt cleared, count unchanged); needsTriage never accepts SNOOZE.
    name: 'exhausted-budget-snooze-triages',
    pred: (pre, action, data, post) => {
      if (action !== 'SNOOZE') return true;
      if (pre.todoState === 'needsTriage') return same(pre, post);
      const d = data || {};
      if (pre.todoState !== 'overdue' || !nonEmpty(d.until)) {
        return TERMINAL.includes(pre.todoState) || same(pre, post);
      }
      if (pre.snoozeCount < 2) return true;
      return (
        post.todoState === 'needsTriage' &&
        post.dueAt === '' &&
        post.snoozeCount === pre.snoozeCount &&
        post.doneVia === pre.doneVia
      );
    },
  },
  {
    // COMPLETE / DROP settle an active item exactly once, with the outcome and
    // a cleared dueAt; no other action may reach a terminal state.
    name: 'terminals-only-via-complete-or-drop',
    pred: (pre, action, data, post) => {
      if (!TERMINAL.includes(post.todoState) || TERMINAL.includes(pre.todoState)) {
        return !TERMINAL.includes(post.todoState) || TERMINAL.includes(pre.todoState);
      }
      const d = data || {};
      const active = ['open', 'overdue', 'needsTriage'].includes(pre.todoState);
      if (!active) return false;
      if (action === 'COMPLETE') {
        return (
          post.todoState === 'completed' &&
          post.doneVia === 'completed' &&
          post.dueAt === '' &&
          post.snoozeCount === pre.snoozeCount
        );
      }
      if (action === 'DROP') {
        return (
          post.todoState === 'archived' &&
          nonEmpty(d.reason) &&
          post.doneVia === d.reason &&
          post.dueAt === '' &&
          post.snoozeCount === pre.snoozeCount
        );
      }
      return false;
    },
  },
];
```

## Self-repair loop

Two defect classes are checked every round, in order: domain-ref gaps (a
`dataDomain` value the contract declares but the code never handles — these
are fixed FIRST, since until they're gone the checker may never even reach
what an invariant is meant to guard) and invariant violations.

| iteration | states explored | cap hit | nondeterministic | domain gaps | violations |
|---|---|---|---|---|---|
| 0 | 18 | no | no | — | — |

**Converged — no domain-ref gaps and no invariant violations reachable in the
final code**, over the explored (bounded) state space. Not a proof.

## Demo / regression trace corpus

- scenarios: **16** · windows: **105**
- corpus validated clean: no chaining/terminal problems.
- ⚠️ special rule 'reopen-is-a-new-instance' is exercised by only 0 window(s) (< 3) — thin regression coverage for that rule

## Independent replay sanity check

- windows replayed (separate process): **105** · non-pass: **0**

## Next steps

1. Review the contract and invariants above — both are the model's reading of
   your intent, not ground truth.
2. Wire the machine into the real handler/reducer via its exported `actions` —
   call the intents, do not reimplement the transition logic inline.
3. After integration, run `/polygraph:verify` against REAL captured traces to
   catch drift between this pure model and the glue code around it.