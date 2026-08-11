// polynv test fixture — a SAM v2 machine whose BOOM acceptor THROWS on one
// reachable step. The machine-problem fixture for attribution and
// graph-completeness tests (a throw must surface, never be silently dropped).
'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false, instanceName: 'throwing' });

const INITIAL_STATE = { st: 'a', n: 0 };

const control = instance({
  initialState: JSON.parse(JSON.stringify(INITIAL_STATE)),
  component: {
    modelShape: { st: { type: 'string' }, n: { type: 'number' } },
    actions: {
      GO: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
      BOOM: { action: (d = {}) => ({ ...d }), schema: {}, domain: [{}] },
    },
    acceptors: {
      GO: (model) => (p, { reject, next, unchanged }) => {
        if (model.st !== 'a') return reject('already-advanced');
        next.st = 'b';
        next.n = model.n + 1;
      },
      BOOM: (model) => () => {
        if (model.st === 'a') throw new Error('kaboom');
        return undefined;
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
