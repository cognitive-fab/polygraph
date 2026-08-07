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