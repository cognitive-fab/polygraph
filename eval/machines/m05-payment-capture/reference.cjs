'use strict';
// Apparent-intent reference: a partial authorization (approved < requested
// amount) is declined; only a full-or-over authorization captures. Differs from
// the code at exactly one window: a partial approval on a pending request.
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm05-reference' });

const INITIAL_STATE = { status: 'pending', amount: 0, approved: 0 };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' }, amount: { type: 'number' }, approved: { type: 'number' } },
    actions: {
      REQUEST: {
        action: (d = {}) => ({ ...d }),
        schema: { amount: { type: 'number', required: true } },
        domain: [{ amount: 50 }, { amount: 100 }],
      },
      AUTHORIZE: {
        action: (d = {}) => ({ ...d }),
        schema: { approved: { type: 'number', required: true } },
        domain: [{ approved: 0 }, { approved: 50 }, { approved: 60 }, { approved: 100 }, { approved: 120 }],
      },
    },
    acceptors: {
      REQUEST: (model) => (p, { reject, next }) => {
        if (model.status !== 'pending') return reject('not-pending');
        next.status = 'pending';
        next.amount = p.amount;
        next.approved = 0;
      },
      AUTHORIZE: (model) => (p, { reject, next, unchanged }) => {
        if (model.status !== 'pending') return reject('not-pending');
        if (p.approved < model.amount) {
          next.status = 'declined'; // reject partials
          next.approved = 0;
          unchanged('amount');
          return;
        }
        next.status = 'captured';
        next.approved = p.approved;
        unchanged('amount');
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
