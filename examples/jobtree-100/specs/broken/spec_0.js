'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

// pod0/pod1/pod2:   'Live' | 'Gone' — the run's spare intent pods, by index
// reason0/1/2:      'None' | 'Swap' — closure reason of each index's spare lease
const INITIAL_STATE = {
  pod0: 'Gone',
  pod1: 'Gone',
  pod2: 'Gone',
  reason0: 'None',
  reason1: 'None',
  reason2: 'None',
};

// The run declares three spare pods (TotalSpares / gpusPerPod === 3).
const DECLARED_SPARES = 3;

const POD_KEYS = ['pod0', 'pod1', 'pod2'];
const REASON_KEYS = ['reason0', 'reason1', 'reason2'];

// consumedSpareCount: spares whose RoleSpare lease closed with reason "Swap".
const consumedSpareCount = (model) =>
  REASON_KEYS.reduce((n, k) => (model[k] === 'Swap' ? n + 1 : n), 0);

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
      // emitSparePods: top up only the genuinely-missing spare indices below
      // count, where count = declared spares - spares consumed by a swap.
      TopUp: (model) => (proposal, { reject, next, unchanged }) => {
        const count = DECLARED_SPARES - consumedSpareCount(model);
        if (count <= 0) return reject('no-spare-slots-left');

        const pods = POD_KEYS.map((k) => model[k]);
        let created = 0;
        for (let i = 0; i < count && i < pods.length; i += 1) {
          if (pods[i] === 'Live') continue; // present[name] — survivor keeps its index
          pods[i] = 'Live';
          created += 1;
        }
        if (created === 0) return reject('all-spares-present');

        next.pod0 = pods[0];
        next.pod1 = pods[1];
        next.pod2 = pods[2];
        unchanged('reason0', 'reason1', 'reason2');
      },

      // An external deletion (eviction / drain) removes that index's spare pod.
      LosePod: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal && proposal.idx;
        if (typeof idx !== 'number' || idx < 0 || idx >= POD_KEYS.length) {
          return reject('bad-index');
        }
        const podKey = POD_KEYS[idx];
        if (model[podKey] !== 'Live') return reject('pod-already-gone');

        next[podKey] = 'Gone';
        unchanged(...POD_KEYS.filter((k) => k !== podKey));
        unchanged(...REASON_KEYS);
      },

      // A node-failure swap closes that index's RoleSpare lease with "Swap":
      // the funded capacity now carries the swapped-in active work, so the
      // slot is never re-provisioned (it lowers emitSparePods' count).
      SwapConsume: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal && proposal.idx;
        if (typeof idx !== 'number' || idx < 0 || idx >= REASON_KEYS.length) {
          return reject('bad-index');
        }
        const reasonKey = REASON_KEYS[idx];
        if (model[reasonKey] === 'Swap') return reject('spare-already-consumed');

        next[reasonKey] = 'Swap';
        unchanged(...REASON_KEYS.filter((k) => k !== reasonKey));
        unchanged(...POD_KEYS);
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
