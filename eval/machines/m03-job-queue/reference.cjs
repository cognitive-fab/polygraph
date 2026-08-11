'use strict';
// Apparent-intent reference: HEARTBEAT is a pure liveness no-op in every state
// (what its name and its running-state use imply). Differs from the code at
// exactly one window: HEARTBEAT on a failed job.
//
// SAM v2 strict-profile port of the 1.x bare-next reference (8.0.0):
// transition-table-identical over every reachable state × declared payload;
// former identity fall-throughs are observable reject(reason)s.
const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'm03-reference' });

const INITIAL_STATE = { status: 'idle' };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { status: { type: 'string' } },
    actions: {
      START: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      COMPLETE: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      FAIL: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      RESET: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      HEARTBEAT: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      START: (model) => (p, { reject, next }) => {
        if (model.status !== 'idle') return reject('not-idle');
        next.status = 'running';
      },
      COMPLETE: (model) => (p, { reject, next }) => {
        if (model.status !== 'running') return reject('not-running');
        next.status = 'done';
      },
      FAIL: (model) => (p, { reject, next }) => {
        if (model.status !== 'running') return reject('not-running');
        next.status = 'failed';
      },
      RESET: (model) => (p, { next }) => {
        next.status = 'idle'; // applies in every state (identity from idle)
      },
      HEARTBEAT: (model) => (p, { reject }) => reject('heartbeat-is-noop'), // no-op everywhere
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
