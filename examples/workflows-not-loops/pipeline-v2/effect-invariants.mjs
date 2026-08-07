// Effect-emission invariants for the v2 pipeline: v1's rules, widened for the
// second event-driven gate. The correction accounting now admits two signal
// kinds — and still nothing else.
'use strict';

const countActions = (path, name) =>
  path.actions.filter((a) => a.action === name).length;

export const effectInvariants = [
  {
    name: 'extract-emitted-at-most-once',
    pred: (path) => path.count('extract') <= 1,
  },
  {
    // Every transform emission beyond the first exists ONLY because a
    // concrete failure signal (validation or lint) demanded it.
    name: 'no-correction-without-a-signal',
    pred: (path) =>
      path.count('transform') <=
      1 + countActions(path, 'VALIDATION_FAILED') + countActions(path, 'LINT_FAILED'),
  },
  {
    // First pass + 2 validation fixes + 1 lint fix bounds the composition.
    name: 'at-most-four-transforms-per-path',
    pred: (path) => path.count('transform') <= 4,
  },
  {
    // The new gate sits strictly between validation and rendering.
    name: 'no-lint-before-validation-pass',
    pred: (path) => path.emitted.every((e, i) =>
      e.kind !== 'lint' || path.actionBefore('VALIDATION_PASSED', i)),
  },
  {
    name: 'no-render-before-lint-pass',
    pred: (path) => path.emitted.every((e, i) =>
      e.kind !== 'render' || path.actionBefore('LINT_PASSED', i)),
  },
  {
    // Failure blast radius is one stage: neither bend re-runs extraction.
    name: 'bend-back-never-re-runs-extraction',
    pred: (path) => path.emitted.every((e, i) =>
      e.kind !== 'extract' ||
      (!path.actionBefore('VALIDATION_FAILED', i) && !path.actionBefore('LINT_FAILED', i))),
  },
];
