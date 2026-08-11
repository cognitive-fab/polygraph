'use strict';
// Apparent-intent reference: MAX_ATTEMPTS = 3, lock when the count REACHES 3
// (the >= a reader infers from the constant's name and intent). Differs from the
// code at exactly one window: the 3rd consecutive LOGIN_FAIL.
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm02-reference' });

const MAX_ATTEMPTS = 3;
const INITIAL_STATE = { status: 'active', attempts: 0 };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' }, attempts: { type: 'number' } },
    actions: {
      LOGIN_FAIL: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      LOGIN_OK: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      UNLOCK: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      LOGIN_FAIL: (model) => (p, { reject, next }) => {
        if (model.status !== 'active') return reject('locked');
        const a = model.attempts + 1;
        next.attempts = a;
        next.status = a >= MAX_ATTEMPTS ? 'locked' : 'active';
      },
      LOGIN_OK: (model) => (p, { reject, next }) => {
        if (model.status !== 'active') return reject('locked');
        next.status = 'active';
        next.attempts = 0;
      },
      UNLOCK: (model) => (p, { reject, next }) => {
        if (model.status !== 'locked') return reject('not-locked');
        next.status = 'active';
        next.attempts = 0;
      },
    },
    reactors: [],
  },
});

const { intents } = control;
const getState = () => instance({}).getState();
const setState = (s) => { instance({}).setState(s); };
const init = () => { setState(INITIAL_STATE); };
const actions = Object.fromEntries(Object.keys(intents).map((k) => [k, (d = {}) => intents[k](d)]));
module.exports = { instance, init, actions, getState, setState };
