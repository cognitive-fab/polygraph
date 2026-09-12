'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

// Fixed shape of the pinned run: packPlan.TotalSpares / gpusPerPod === 3, so the
// declared spare-pod count is 3 (indices 0..2). gpusPerPod > 0 and
// TotalSpares % gpusPerPod === 0, so the early-return gate of emitSparePods
// never fires for this run.
const DECLARED_SPARE_PODS = 3;

// pod{i}:    'Live' | 'Gone'  — spare index i's intent pod (keyed by pod NAME)
// reason{i}: 'None' | 'Swap'  — closure reason of index i's RoleSpare lease
const INITIAL_STATE = {
  pod0: 'Gone',
  pod1: 'Gone',
  pod2: 'Gone',
  reason0: 'None',
  reason1: 'None',
  reason2: 'None',
};

const POD_KEYS = ['pod0', 'pod1', 'pod2'];
const REASON_KEYS = ['reason0', 'reason1', 'reason2'];

const validIndex = (idx) => Number.isInteger(idx) && idx >= 0 && idx < DECLARED_SPARE_PODS;

// consumedSpareCount: spares whose RoleSpare lease closed with reason "Swap".
const consumedSpareCount = (model) =>
  REASON_KEYS.reduce((n, key) => (model[key] === 'Swap' ? n + 1 : n), 0);

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
      // emitSparePods: count = TotalSpares/gpusPerPod - consumedSpareCount(run);
      // if count <= 0 it returns 0. Otherwise it walks indices 0..count-1 and
      // creates only the ones whose pod NAME is not already present (#91). Note
      // that the loop is index-based: a consumed spare at a LOW index is still
      // rebuilt, while the highest indices simply fall outside the shortened
      // range. That is the implementation's observable behavior.
      TopUp: (model) => (proposal, { reject, next, unchanged }) => {
        const count = DECLARED_SPARE_PODS - consumedSpareCount(model);
        if (count <= 0) return reject('no-spare-pods-to-emit');

        const created = [];
        const framed = [];
        for (let i = 0; i < DECLARED_SPARE_PODS; i++) {
          const key = POD_KEYS[i];
          if (i < count && model[key] === 'Gone') created.push(key);
          else framed.push(key); // present[name] -> continue, or i >= count
        }
        if (created.length === 0) return reject('spares-already-present');

        created.forEach((key) => {
          next[key] = 'Live';
        });
        unchanged(...framed, ...REASON_KEYS);
      },

      // An external deletion (eviction / drain / removeSparePodOnNodes closing a
      // sibling) makes that spare's intent pod disappear. The lease closure
      // reason is untouched.
      LosePod: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal.idx;
        if (!validIndex(idx)) return reject('invalid-spare-index');

        const key = POD_KEYS[idx];
        if (model[key] !== 'Live') return reject('spare-pod-already-absent');

        next[key] = 'Gone';
        unchanged(...POD_KEYS.filter((k) => k !== key), ...REASON_KEYS);
      },

      // A node-failure swap promotes a live, funded spare: its RoleSpare lease
      // is closed with reason "Swap" and the standby pod stops being a spare.
      SwapConsume: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal.idx;
        if (!validIndex(idx)) return reject('invalid-spare-index');

        const podKey = POD_KEYS[idx];
        const reasonKey = REASON_KEYS[idx];
        if (model[reasonKey] === 'Swap') return reject('spare-already-consumed');
        if (model[podKey] !== 'Live') return reject('no-spare-to-consume');

        next[podKey] = 'Gone';
        next[reasonKey] = 'Swap';
        unchanged(
          ...POD_KEYS.filter((k) => k !== podKey),
          ...REASON_KEYS.filter((k) => k !== reasonKey)
        );
      },
    },
    reactors: [],
  },
});

const { intents } = control;

const getState = () => instance({}).getState();
const setState = (snapshot) => {
  instance({}).setState(snapshot);
};

const init = () => {
  setState(INITIAL_STATE);
};

const actions = {
  TopUp: (data = {}) => intents.TopUp(data),
  LosePod: (data = {}) => intents.LosePod(data),
  SwapConsume: (data = {}) => intents.SwapConsume(data),
};

module.exports = { instance, init, actions, getState, setState };
