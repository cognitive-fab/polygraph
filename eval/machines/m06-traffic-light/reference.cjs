'use strict';
// Apparent-intent reference: identical to source.js (clean machine, no divergence).
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s. STOP is not
// handled by the controller in any state — the contract's stop-is-noop rule —
// so it is an observable rejection here.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm06-reference' });

const INITIAL_STATE = { light: 'red' };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { light: { type: 'string' } },
    actions: {
      NEXT: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      STOP: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      NEXT: (model) => (p, { next }) => {
        const cycle = { red: 'green', green: 'yellow', yellow: 'red' };
        next.light = cycle[model.light];
      },
      STOP: (model) => (p, { reject }) => reject('stop-is-noop'),
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
