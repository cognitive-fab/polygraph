// VERBATIM from blind elicitation — NOT written by me and NOT ported from the TLA.
// Source: cand_1.json, id "prior:consumed-slot-stays-empty", kind domain-prior.
export const stateInvariants = [
  { name: 'prior:consumed-slot-stays-empty',
    pred: (s) => [0,1,2].every(i => s['reason'+i] !== 'Swap' || s['pod'+i] === 'Gone') },
];
// Source: cand_2.json, id "llm:topup-restores-every-unconsumed-index", kind code-reading.
export const transitionInvariants = [
  { name: 'llm:topup-restores-every-unconsumed-index',
    pred: (pre, action, data, post) => action !== 'TopUp' ||
      [0,1,2].every(i => post['reason'+i] === 'Swap' || post['pod'+i] === 'Live') },
];
