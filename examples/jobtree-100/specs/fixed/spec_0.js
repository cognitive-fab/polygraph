'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

// Three declared spare slots (declared = TotalSpares / gpusPerPod = 3).
//   podN    : 'Live' | 'Gone' — spare index N's intent pod
//   reasonN : 'None' | 'Swap' — closure reason of index N's spare lease
const DECLARED = 3;

const INITIAL_STATE = {
  pod0: 'Gone',
  pod1: 'Gone',
  pod2: 'Gone',
  reason0: 'None',
  reason1: 'None',
  reason2: 'None',
};

const POD = ['pod0', 'pod1', 'pod2'];
const REASON = ['reason0', 'reason1', 'reason2'];

const isIndex = (i) => Number.isInteger(i) && i >= 0 && i < DECLARED;

const control = instance({
  initialState: { ...INITIAL_STATE },
  component: {
    modelShape: {
      pod0: { type: 'string' },
      pod1: { type: 'string' },
      pod2: { type: 'string' },
      reason0: { type: 'string' },
      reason1: { type: 'string' },
      reason2: { type: 'string' },
    },
    actions: {
      TopUp: {
        action: (data = {}) => ({ ...data }),
        schema: {},
        domain: [{}],
      },
      LosePod: {
        action: (data = {}) => ({ ...data }),
        schema: { idx: { type: 'number', required: true } },
        domain: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
      },
      SwapConsume: {
        action: (data = {}) => ({ ...data }),
        schema: { idx: { type: 'number', required: true } },
        domain: [{ idx: 0 }, { idx: 1 }, { idx: 2 }],
      },
    },
    acceptors: {
      // emitSparePods: retire swap-consumed spares BY NAME, then fill the lowest
      // indices that are neither alive nor retired, up to `target` live spares.
      TopUp: (model) => (proposal, { reject, next, unchanged }) => {
        const retired = [];
        for (let i = 0; i < DECLARED; i++) {
          if (model[REASON[i]] === 'Swap') retired.push(i);
        }
        // target = declared - every swap-consumed slot (no legacy unnamed leases here)
        const target = DECLARED - retired.length;
        if (target <= 0) return reject('no-spare-slots-left');

        const present = [];
        for (let i = 0; i < DECLARED; i++) {
          if (model[POD[i]] === 'Live') present.push(i);
        }
        const toCreate = target - present.length;
        if (toCreate <= 0) return reject('spares-already-at-target');

        const created = [];
        for (let i = 0; i < DECLARED && created.length < toCreate; i++) {
          if (model[POD[i]] === 'Live' || model[REASON[i]] === 'Swap') continue;
          created.push(i);
        }
        if (created.length === 0) return reject('no-fillable-spare-index');

        const untouched = [];
        for (let i = 0; i < DECLARED; i++) {
          if (created.indexOf(i) !== -1) next[POD[i]] = 'Live';
          else untouched.push(POD[i]);
          untouched.push(REASON[i]);
        }
        unchanged(...untouched);
      },

      // External deletion (eviction/drain) of a spare intent pod: presence is
      // keyed by pod NAME, so the slot simply goes missing at its own index.
      LosePod: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal ? proposal.idx : undefined;
        if (!isIndex(idx)) return reject('bad-spare-index');
        if (model[POD[idx]] !== 'Live') return reject('spare-pod-already-gone');

        const untouched = [];
        for (let i = 0; i < DECLARED; i++) {
          if (i !== idx) untouched.push(POD[i]);
          untouched.push(REASON[i]);
        }
        next[POD[idx]] = 'Gone';
        unchanged(...untouched);
      },

      // Node-failure swap consumes that spare: its RoleSpare lease closes with
      // reason "Swap" and the funded capacity now carries the swapped-in active
      // work, so the spare pod is gone and the slot is retired for good.
      SwapConsume: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal ? proposal.idx : undefined;
        if (!isIndex(idx)) return reject('bad-spare-index');
        if (model[REASON[idx]] === 'Swap') return reject('spare-already-consumed');

        const untouched = [];
        for (let i = 0; i < DECLARED; i++) {
          if (i !== idx) {
            untouched.push(POD[i]);
            untouched.push(REASON[i]);
          }
        }
        next[POD[idx]] = 'Gone';
        next[REASON[idx]] = 'Swap';
        unchanged(...untouched);
      },
    },
    reactors: [],
  },
});

const { intents } = control;

const getState = () => instance({}).getState();
const setState = (snapshot) => { instance({}).setState(snapshot); };

const init = () => { setState(INITIAL_STATE); };

const actions = {
  TopUp: (data = {}) => intents.TopUp(data),
  LosePod: (data = {}) => intents.LosePod(data),
  SwapConsume: (data = {}) => intents.SwapConsume(data),
};

module.exports = { instance, init, actions, getState, setState };
