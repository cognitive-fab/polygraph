'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

const MAX_FIX_ATTEMPTS = 2;
const MAX_LINT_ATTEMPTS = 1;

const INITIAL_STATE = {
  docState: 'received',
  fixAttempts: 0,
  lintAttempts: 0,
  lastViolation: '',
};

const modelShape = {
  docState: { type: 'string' },
  fixAttempts: { type: 'number' },
  lintAttempts: { type: 'number' },
  lastViolation: { type: 'string' },
};

const actionDefs = {
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
  LINT_PASSED: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  LINT_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { violation: { type: 'string', required: true } },
    domain: [{ violation: 'broken-links' }],
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

const acceptors = {
  START: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'received') {
      return reject('start-not-applicable');
    }
    next.docState = 'extracting';
    unchanged('fixAttempts', 'lintAttempts', 'lastViolation');
  },

  EXTRACT_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    next.docState = 'transforming';
    unchanged('fixAttempts', 'lintAttempts', 'lastViolation');
  },

  EXTRACT_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    if (typeof proposal.reason !== 'string' || proposal.reason === '') {
      return reject('invalid-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = proposal.reason;
    unchanged('fixAttempts', 'lintAttempts');
  },

  TRANSFORM_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    next.docState = 'validating';
    unchanged('fixAttempts', 'lintAttempts', 'lastViolation');
  },

  TRANSFORM_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    if (typeof proposal.reason !== 'string' || proposal.reason === '') {
      return reject('invalid-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = proposal.reason;
    unchanged('fixAttempts', 'lintAttempts');
  },

  VALIDATION_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }
    next.docState = 'linting';
    next.lastViolation = '';
    unchanged('fixAttempts', 'lintAttempts');
  },

  VALIDATION_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }
    if (typeof proposal.violation !== 'string' || proposal.violation === '') {
      return reject('invalid-violation');
    }
    if (model.fixAttempts >= MAX_FIX_ATTEMPTS) {
      next.docState = 'escalated';
      next.lastViolation = proposal.violation;
      unchanged('fixAttempts', 'lintAttempts');
      return;
    }
    next.docState = 'transforming';
    next.fixAttempts = model.fixAttempts + 1;
    next.lastViolation = proposal.violation;
    unchanged('lintAttempts');
  },

  LINT_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'linting') {
      return reject('stale-completions-reject');
    }
    next.docState = 'rendering';
    next.lastViolation = '';
    unchanged('fixAttempts', 'lintAttempts');
  },

  LINT_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'linting') {
      return reject('stale-completions-reject');
    }
    if (typeof proposal.violation !== 'string' || proposal.violation === '') {
      return reject('invalid-violation');
    }
    if (model.lintAttempts >= MAX_LINT_ATTEMPTS) {
      next.docState = 'escalated';
      next.lastViolation = proposal.violation;
      unchanged('fixAttempts', 'lintAttempts');
      return;
    }
    next.docState = 'transforming';
    next.lintAttempts = model.lintAttempts + 1;
    next.lastViolation = proposal.violation;
    unchanged('fixAttempts');
  },

  RENDER_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    next.docState = 'published';
    unchanged('fixAttempts', 'lintAttempts', 'lastViolation');
  },

  RENDER_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    if (typeof proposal.reason !== 'string' || proposal.reason === '') {
      return reject('invalid-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = proposal.reason;
    unchanged('fixAttempts', 'lintAttempts');
  },
};

const { intents } = instance({
  component: {
    modelShape,
    actions: actionDefs,
    acceptors,
  },
});

const getState = () => instance({}).getState();
const setState = (snapshot) => instance({}).setState(snapshot);
const init = () => setState(INITIAL_STATE);

const actions = {
  START: (data = {}) => intents.START(data),
  EXTRACT_DONE: (data = {}) => intents.EXTRACT_DONE(data),
  EXTRACT_FAILED: (data = {}) => intents.EXTRACT_FAILED(data),
  TRANSFORM_DONE: (data = {}) => intents.TRANSFORM_DONE(data),
  TRANSFORM_FAILED: (data = {}) => intents.TRANSFORM_FAILED(data),
  VALIDATION_PASSED: (data = {}) => intents.VALIDATION_PASSED(data),
  VALIDATION_FAILED: (data = {}) => intents.VALIDATION_FAILED(data),
  LINT_PASSED: (data = {}) => intents.LINT_PASSED(data),
  LINT_FAILED: (data = {}) => intents.LINT_FAILED(data),
  RENDER_DONE: (data = {}) => intents.RENDER_DONE(data),
  RENDER_FAILED: (data = {}) => intents.RENDER_FAILED(data),
};

init();

module.exports = { instance, init, actions, getState, setState };
