'use strict';
// Apparent-intent reference: identical to source.js. A faithful reader derives
// conflict -> active from the source literally, so there is NO single-step
// divergence — the method correctly finds nothing. The real risk is at the
// external-service boundary (a replayed decline returned as a conflict).
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s. A declined
// CHARGE writes status back unchanged (the code ACTS — identity-by-mutation),
// matching the 1.x reference's explicit `return { status: 'pending' }`.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm08-reference' });

const INITIAL_STATE = { status: 'pending' };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' } },
    actions: {
      CHARGE: {
        action: (d = {}) => ({ ...d }),
        schema: { result: { type: 'string', required: true } },
        domain: [{ result: 'ok' }, { result: 'declined' }, { result: 'conflict' }],
      },
    },
    acceptors: {
      CHARGE: (model) => (p, { reject, next }) => {
        if (model.status !== 'pending') return reject('not-pending');
        if (p.result === 'ok') { next.status = 'active'; return; }
        if (p.result === 'conflict') { next.status = 'active'; return; } // treats conflict as already-paid
        next.status = 'pending'; // declined: the code acts, status stays pending
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
