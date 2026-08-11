'use strict';
// Apparent-intent reference: what a faithful reader derives from source.js —
// the 5xx-is-transient guard applied to BOTH the renewal and dunning paths (the
// symmetry the source's structure implies). Differs from the code at exactly one
// window: RENEW_CHARGE{err5xx} in active.
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm01-reference' });

const INITIAL_STATE = { status: 'active', attempts: 0 };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' }, attempts: { type: 'number' } },
    actions: {
      RENEW_CHARGE: {
        action: (d = {}) => ({ ...d }),
        schema: { result: { type: 'string', required: true } },
        domain: [{ result: 'ok' }, { result: 'declined' }, { result: 'err5xx' }],
      },
      DUNNING_RETRY: {
        action: (d = {}) => ({ ...d }),
        schema: { result: { type: 'string', required: true } },
        domain: [{ result: 'ok' }, { result: 'declined' }, { result: 'err5xx' }],
      },
      CANCEL: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      RENEW_CHARGE: (model) => (p, { reject, next, unchanged }) => {
        if (model.status !== 'active') return reject('not-active');
        if (p.result === 'ok') { next.status = 'active'; next.attempts = 0; return; }
        if (p.result === 'err5xx') return reject('5xx-is-transient'); // transient: no-op
        next.status = 'grace';
        next.attempts = 1;
      },
      DUNNING_RETRY: (model) => (p, { reject, next, unchanged }) => {
        if (model.status !== 'grace') return reject('not-in-grace');
        if (p.result === 'ok') { next.status = 'active'; next.attempts = 0; return; }
        if (p.result === 'err5xx') return reject('5xx-is-transient');
        if (model.attempts >= 3) { next.status = 'canceled'; unchanged('attempts'); return; }
        next.attempts = model.attempts + 1;
        unchanged('status');
      },
      CANCEL: (model) => (p, { next, unchanged }) => {
        next.status = 'canceled';
        unchanged('attempts');
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
