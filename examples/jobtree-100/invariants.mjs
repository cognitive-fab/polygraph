// Port of NodeFailure.tla's ConsumedSpareStaysConsumed (jobtree 6d4bb25):
//
//   ConsumedSpareStaysConsumed ==
//     \A s \in SpareIds:
//       leaseReason[s] = "Swap" =>
//         /\ podState[s]    = "Gone"
//         /\ dupPodState[s] = "Gone"
//         /\ ~leaseOpen[s]
//
// This contract's observable state does not model duplicate pods or lease
// openness, so only the podState conjunct is expressible here. Stated plainly
// rather than silently dropped.
const IDX = [0, 1, 2];

export const stateInvariants = [
  {
    name: 'consumed-spare-stays-consumed',
    pred: (s) => IDX.every((i) => s['reason' + i] !== 'Swap' || s['pod' + i] === 'Gone'),
  },
];

export const transitionInvariants = [];
