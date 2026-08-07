'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

const MAX_FIX_ATTEMPTS = 2;

const INITIAL_STATE = {
  docState: 'received',
  fixAttempts: 0,
  lastViolation: '',
};

const modelShape = {
  docState: { type: 'string' },
  fixAttempts: { type: 'number' },
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
    unchanged('fixAttempts', 'lastViolation');
  },

  EXTRACT_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    next.docState = 'transforming';
    unchanged('fixAttempts', 'lastViolation');
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
    unchanged('fixAttempts');
  },

  TRANSFORM_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    next.docState = 'validating';
    unchanged('fixAttempts', 'lastViolation');
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
    unchanged('fixAttempts');
  },

  VALIDATION_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }
    next.docState = 'rendering';
    next.lastViolation = '';
    unchanged('fixAttempts');
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
      unchanged('fixAttempts');
      return;
    }
    next.docState = 'transforming';
    next.fixAttempts = model.fixAttempts + 1;
    next.lastViolation = proposal.violation;
  },

  RENDER_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    next.docState = 'published';
    unchanged('fixAttempts', 'lastViolation');
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
    unchanged('fixAttempts');
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
  RENDER_DONE: (data = {}) => intents.RENDER_DONE(data),
  RENDER_FAILED: (data = {}) => intents.RENDER_FAILED(data),
};

init();

module.exports = { instance, init, actions, getState, setState };
