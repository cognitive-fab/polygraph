// Effect-emission invariants for the document pipeline (polyrun spec §6.2):
// rules about what the machine ∘ mapper composition may EMIT over every
// reachable path. This is where the article's claims stop being prose —
// "no ceremony" is checked as an emission rule before anything runs.
'use strict';

const countActions = (path, name) =>
  path.actions.filter((a) => a.action === name).length;

export const effectInvariants = [
  {
    // Front-loaded context: each forward stage runs at most once per pass.
    // Extraction never repeats at all — there is exactly one first pass.
    name: 'extract-emitted-at-most-once',
    pred: (path) => path.count('extract') <= 1,
  },
  {
    // Event-driven, not clock-driven: every transform emission beyond the
    // first exists ONLY because a concrete VALIDATION_FAILED demanded it.
    // A "reflect every turn" cadence is unrepresentable.
    name: 'no-correction-without-a-signal',
    pred: (path) =>
      path.count('transform') <= 1 + countActions(path, 'VALIDATION_FAILED'),
  },
  {
    // The fix budget bounds the whole composition: at most the first pass
    // plus MAX_FIX_ATTEMPTS targeted fixes, on any reachable path.
    name: 'at-most-three-transforms-per-path',
    pred: (path) => path.count('transform') <= 3,
  },
  {
    // Rendering is unreachable without validation having passed first.
    name: 'no-render-before-validation-pass',
    pred: (path) => path.emitted.every((e, i) =>
      e.kind !== 'render' || path.actionBefore('VALIDATION_PASSED', i)),
  },
  {
    // Failure blast radius is one stage: a validation failure may re-emit
    // transform + validate, but never re-emits extract.
    name: 'bend-back-never-re-runs-extraction',
    pred: (path) => path.emitted.every((e, i) =>
      e.kind !== 'extract' || !path.actionBefore('VALIDATION_FAILED', i)),
  },
];
