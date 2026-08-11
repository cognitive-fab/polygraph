'use strict';
// Apparent-intent reference: PUBLISH is the approval gate — it only applies from
// `approved`; from any other state it is a no-op. Differs from the code at
// exactly one window: PUBLISH from draft.
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm04-reference' });

const INITIAL_STATE = { status: 'draft' };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' } },
    actions: {
      SUBMIT: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      APPROVE: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      REJECT: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      RECALL: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      PUBLISH: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      SUBMIT: (model) => (p, { reject, next }) => {
        if (model.status !== 'draft') return reject('not-draft');
        next.status = 'review';
      },
      APPROVE: (model) => (p, { reject, next }) => {
        if (model.status !== 'review') return reject('not-in-review');
        next.status = 'approved';
      },
      REJECT: (model) => (p, { reject, next }) => {
        if (model.status !== 'review') return reject('not-in-review');
        next.status = 'rejected';
      },
      RECALL: (model) => (p, { reject, next }) => {
        if (model.status !== 'review') return reject('not-in-review');
        next.status = 'draft';
      },
      PUBLISH: (model) => (p, { reject, next }) => {
        if (model.status !== 'approved') return reject('publish-gate'); // not approved: no-op
        next.status = 'published';
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
