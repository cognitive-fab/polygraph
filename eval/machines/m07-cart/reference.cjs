'use strict';
// Apparent-intent reference: identical to source.js (clean machine, no divergence).
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm07-reference' });

const INITIAL_STATE = { status: 'empty', count: 0 };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' }, count: { type: 'number' } },
    actions: {
      ADD: {
        action: (d = {}) => ({ ...d }),
        schema: { qty: { type: 'number', required: true } },
        domain: [{ qty: 1 }, { qty: 2 }],
      },
      REMOVE: {
        action: (d = {}) => ({ ...d }),
        schema: { qty: { type: 'number', required: true } },
        domain: [{ qty: 1 }, { qty: 2 }],
      },
      CHECKOUT: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      ADD: (model) => (p, { reject, next }) => {
        if (model.status === 'checked_out') return reject('checked-out');
        next.count = model.count + (p.qty || 1);
        next.status = 'active';
      },
      REMOVE: (model) => (p, { reject, next }) => {
        if (model.status !== 'active') return reject('not-active');
        const c = Math.max(0, model.count - (p.qty || 1));
        next.count = c;
        next.status = c === 0 ? 'empty' : 'active';
      },
      CHECKOUT: (model) => (p, { reject, next, unchanged }) => {
        if (model.status !== 'active') return reject('not-active');
        next.status = 'checked_out';
        unchanged('count');
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
