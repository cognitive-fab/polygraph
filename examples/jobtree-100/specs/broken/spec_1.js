'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

// The run declares TOTAL_SPARES spare intent pods (packPlan.TotalSpares/gpusPerPod).
const TOTAL_SPARES = 3;

const POD_KEYS = ['pod0', 'pod1', 'pod2'];
const REASON_KEYS = ['reason0', 'reason1', 'reason2'];

// pod{i}: 'Live' | 'Gone' — spare index i's intent pod
// reason{i}: 'None' | 'Swap' — closure reason of index i's spare lease
const INITIAL_STATE = {
  pod0: 'Gone',
  pod1: 'Gone',
  pod2: 'Gone',
  reason0: 'None',
  reason1: 'None',
  reason2: 'None',
};

const validIndex = (idx) =>
  typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < TOTAL_SPARES;

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
      // emitSparePods: tops up only the genuinely-missing spare indices below
      // the declared count, which is itself reduced by the spares a node-failure
      // swap already consumed (consumedSpareCount).
      TopUp: (model) => (proposal, { reject, next, unchanged }) => {
        let consumed = 0;
        for (let i = 0; i < TOTAL_SPARES; i += 1) {
          if (model[REASON_KEYS[i]] === 'Swap') consumed += 1;
        }
        // count := packPlan.TotalSpares/gpusPerPod - c.consumedSpareCount(run)
        const count = TOTAL_SPARES - consumed;
        if (count <= 0) return reject('no-spare-slots-remaining');

        // Presence is keyed by pod NAME (#91): only missing indices are filled.
        const pods = POD_KEYS.map((k) => model[k]);
        let created = 0;
        for (let i = 0; i < count; i += 1) {
          if (pods[i] === 'Live') continue; // present[name] -> skip
          pods[i] = 'Live';
          created += 1;
        }
        if (created === 0) return reject('all-declared-spares-present');

        next.pod0 = pods[0];
        next.pod1 = pods[1];
        next.pod2 = pods[2];
        unchanged('reason0', 'reason1', 'reason2');
      },

      // External deletion of a spare intent pod (eviction / drain /
      // removeSparePodOnNodes) — possibly out of index order.
      LosePod: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal.idx;
        if (!validIndex(idx)) return reject('no-such-spare-index');
        if (model[POD_KEYS[idx]] !== 'Live') return reject('spare-pod-already-gone');

        if (idx === 0) {
          next.pod0 = 'Gone';
          unchanged('pod1', 'pod2');
        } else if (idx === 1) {
          next.pod1 = 'Gone';
          unchanged('pod0', 'pod2');
        } else {
          next.pod2 = 'Gone';
          unchanged('pod0', 'pod1');
        }
        unchanged('reason0', 'reason1', 'reason2');
      },

      // A node-failure swap promotes the spare: its RoleSpare lease closes with
      // reason "Swap" and its funded capacity now carries the swapped-in active
      // work, so the spare intent pod is gone and is never re-provisioned.
      SwapConsume: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal.idx;
        if (!validIndex(idx)) return reject('no-such-spare-index');
        if (model[REASON_KEYS[idx]] === 'Swap') return reject('spare-already-consumed-by-swap');

        if (idx === 0) {
          next.pod0 = 'Gone';
          next.reason0 = 'Swap';
          unchanged('pod1', 'pod2', 'reason1', 'reason2');
        } else if (idx === 1) {
          next.pod1 = 'Gone';
          next.reason1 = 'Swap';
          unchanged('pod0', 'pod2', 'reason0', 'reason2');
        } else {
          next.pod2 = 'Gone';
          next.reason2 = 'Swap';
          unchanged('pod0', 'pod1', 'reason0', 'reason1');
        }
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
