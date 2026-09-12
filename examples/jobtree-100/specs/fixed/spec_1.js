'use strict';

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

// pod{i}: 'Live' | 'Gone'   — spare index i's intent pod
// reason{i}: 'None' | 'Swap' — closure reason of index i's spare lease
const INITIAL_STATE = {
  pod0: 'Gone',
  pod1: 'Gone',
  pod2: 'Gone',
  reason0: 'None',
  reason1: 'None',
  reason2: 'None',
};

// packPlan.TotalSpares / gpusPerPod — the declared spare-pod count.
const DECLARED = 3;
const INDICES = [0, 1, 2];

const podKey = (i) => 'pod' + i;
const reasonKey = (i) => 'reason' + i;

const isIndex = (idx) => idx === 0 || idx === 1 || idx === 2;

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
      // emitSparePods: retire swap-consumed indices BY NAME, key presence by
      // pod NAME, then fill the lowest indices that are neither alive nor
      // retired, up to `target` live spares.
      TopUp: (model) => (proposal, { reject, next, unchanged }) => {
        const retired = INDICES.filter((i) => model[reasonKey(i)] === 'Swap');
        // target := declared - every swap-consumed slot
        const target = DECLARED - retired.length;
        if (target <= 0) return reject('no-spare-capacity-left');

        const present = INDICES.filter((i) => model[podKey(i)] === 'Live');
        const toCreate = target - present.length;
        if (toCreate <= 0) return reject('spares-already-at-target');

        const created = [];
        for (let i = 0; i < DECLARED && created.length < toCreate; i++) {
          if (model[podKey(i)] === 'Live' || model[reasonKey(i)] === 'Swap') {
            continue; // alive or retired: never rebuild that index
          }
          created.push(i);
        }
        if (created.length === 0) return reject('no-index-to-fill');

        const frame = [];
        for (let i = 0; i < DECLARED; i++) {
          if (created.indexOf(i) !== -1) next[podKey(i)] = 'Live';
          else frame.push(podKey(i));
          frame.push(reasonKey(i));
        }
        unchanged(...frame);
      },

      // External deletion of a spare intent pod (eviction/drain). Lease
      // closure reason is untouched — only the pod disappears.
      LosePod: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal ? proposal.idx : undefined;
        if (!isIndex(idx)) return reject('unknown-spare-index');
        if (model[podKey(idx)] !== 'Live') return reject('pod-already-gone');

        next[podKey(idx)] = 'Gone';
        const frame = [];
        for (let i = 0; i < DECLARED; i++) {
          if (i !== idx) frame.push(podKey(i));
          frame.push(reasonKey(i));
        }
        unchanged(...frame);
      },

      // A node-failure swap consumes that spare: its RoleSpare lease closes
      // with reason "Swap" and its funded capacity now carries the swapped-in
      // active work, so the spare pod is gone for good.
      SwapConsume: (model) => (proposal, { reject, next, unchanged }) => {
        const idx = proposal ? proposal.idx : undefined;
        if (!isIndex(idx)) return reject('unknown-spare-index');
        if (model[reasonKey(idx)] === 'Swap') return reject('spare-already-consumed');
        if (model[podKey(idx)] !== 'Live') return reject('no-live-spare-to-consume');

        next[podKey(idx)] = 'Gone';
        next[reasonKey(idx)] = 'Swap';
        const frame = [];
        for (let i = 0; i < DECLARED; i++) {
          if (i !== idx) {
            frame.push(podKey(i));
            frame.push(reasonKey(i));
          }
        }
        unchanged(...frame);
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
