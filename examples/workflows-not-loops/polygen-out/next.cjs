'use strict';

/**
 * Document publishing pipeline — SAM v2 STRICT PROFILE module.
 *
 * Workflow (single document instance):
 *   received -> extracting -> transforming -> validating -> rendering -> published
 * The ONLY backward edge is validating -> transforming, taken ONLY by
 * VALIDATION_FAILED (records the exact violation, fixAttempts += 1).
 * Fix budget is bounded at 2: VALIDATION_FAILED with fixAttempts already 2
 * escalates to a human (terminal 'escalated', violation recorded).
 * Any stage failure event escalates, recording its reason.
 * Stage completions delivered outside the awaiting stage are observable
 * rejections (post == pre), never faults.
 */

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

const INITIAL_STATE = { docState: 'received', fixAttempts: 0, lastViolation: '' };

const FIX_BUDGET = 2;

const modelShape = {
  docState: { type: 'string' },
  fixAttempts: { type: 'number' },
  lastViolation: { type: 'string' },
};

/* ------------------------------------------------------------------ *
 * Actions (full v2 form: { action, schema, domain })
 * ------------------------------------------------------------------ */

const actions = {
  START: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  EXTRACT_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  EXTRACT_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'unreadable-input' }],
  },
  TRANSFORM_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  TRANSFORM_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'model-unavailable' }],
  },
  VALIDATION_PASSED: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  VALIDATION_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { violation: { type: 'string', required: true } },
    domain: [{ violation: 'missing-title' }, { violation: 'broken-schema' }],
  },
  RENDER_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  RENDER_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'render-crashed' }],
  },
};

/* ------------------------------------------------------------------ *
 * Helpers (pure, no hidden state)
 * ------------------------------------------------------------------ */

const asText = (v) => (typeof v === 'string' ? v : '');

/* ------------------------------------------------------------------ *
 * Acceptors — next-state relations over the FROZEN pre-state `model`
 * ------------------------------------------------------------------ */

const acceptors = {
  // received -> extracting
  START: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'received') {
      // Already started, mid-pipeline, or terminal: observable no-op.
      return reject('start-only-from-received');
    }
    next.docState = 'extracting';
    unchanged('fixAttempts', 'lastViolation');
  },

  // extracting -> transforming
  EXTRACT_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    next.docState = 'transforming';
    unchanged('fixAttempts', 'lastViolation');
  },

  // extracting -> escalated (reason recorded)
  EXTRACT_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      // Escalation without a recorded reason must never happen.
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },

  // transforming -> validating
  TRANSFORM_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    next.docState = 'validating';
    unchanged('fixAttempts', 'lastViolation');
  },

  // transforming -> escalated (reason recorded)
  TRANSFORM_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },

  // validating -> rendering, clearing the outstanding violation
  VALIDATION_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }
    next.docState = 'rendering';
    next.lastViolation = '';
    unchanged('fixAttempts');
  },

  // The ONLY backward edge: validating -> transforming, bounded at 2 fixes.
  VALIDATION_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }

    const violation = asText(proposal.violation);
    if (violation === '') {
      // Corrections are event-driven: a bend-back requires a concrete
      // failure signal; there is no cadence-driven re-run of a stage.
      return reject('corrections-are-event-driven');
    }

    if (model.fixAttempts > FIX_BUDGET) {
      // Defensive: the counter can never exceed the budget; if it somehow
      // did, do not grind another lap — observable no-op.
      return reject('bounded-fix-budget-escalates');
    }

    if (model.fixAttempts === FIX_BUDGET) {
      // Budget exhausted: escalate to a human, recording the violation.
      next.docState = 'escalated';
      next.lastViolation = violation;
      unchanged('fixAttempts');
      return;
    }

    // Targeted fix: the single legal backward edge, +1 exactly.
    next.docState = 'transforming';
    next.fixAttempts = model.fixAttempts + 1;
    next.lastViolation = violation;
  },

  // rendering -> published (terminal)
  RENDER_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    if (asText(model.lastViolation) !== '') {
      // Never publish with an outstanding violation.
      return reject('outstanding-violation-blocks-publish');
    }
    next.docState = 'published';
    unchanged('fixAttempts', 'lastViolation');
  },

  // rendering -> escalated (reason recorded)
  RENDER_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },
};

/* ------------------------------------------------------------------ *
 * Wiring — one anonymous component under the `component` key
 * ------------------------------------------------------------------ */

const control = instance({
  initialState: { ...INITIAL_STATE },
  component: { modelShape, actions, acceptors, reactors: [] },
});

const { intents } = control;

/* ------------------------------------------------------------------ *
 * Module contract
 * ------------------------------------------------------------------ */

const getState = () => instance({}).getState();

const setState = (snapshot) => instance({}).setState(snapshot);

const init = () => setState(INITIAL_STATE);

const namedActions = {
  START: (data = {}) => intents.START(data),
  EXTRACT_DONE: (data = {}) => intents.EXTRACT_DONE(data),
  EXTRACT_FAILED: (data = {}) => intents.EXTRACT_FAILED(data),
  TRANSFORM_DONE: (data = {}) => intents.TRANSFORM_DONE(data),
  TRANSFORM_FAILED: (data = {}) => intents.TRANSFORM_FAILED(data),
  VALIDATION_PASSED: (data = {}) => intents.VALIDATION_PASSED(data),
  VALIDATION_FAILED: (data = {}) => intents.VALIDATION_FAILED(data),
  RENDER_DONE: (data = {}) => intents.RENDER_DONE(data),
  RENDER_FAILED: (data = {}) => intents.RENDER_FAILED(data),
};

module.exports = { instance, init, actions: namedActions, getState, setState };