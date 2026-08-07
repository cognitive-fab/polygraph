// Invariants for the v2 document pipeline — v1's rules carried forward, plus
// the new intent: linting is a second event-driven gate with its own bounded
// budget, and rendering is unreachable without it.
const TERMINAL = ['published', 'escalated'];
const STAGE_ORDER = {
  received: 0,
  extracting: 1,
  transforming: 2,
  validating: 3,
  linting: 4,
  rendering: 5,
  published: 6,
};
const STATES = [...Object.keys(STAGE_ORDER), 'escalated'];
const MAX_FIX_ATTEMPTS = 2;
const MAX_LINT_ATTEMPTS = 1;

// A v1 snapshot has no lintAttempts key; its lint count is semantically 0.
// Normalizing here keeps every transition rule true across the fleet-wide
// $migrate step (polyvers checks the migration AS a transition) without
// weakening the rules for ordinary steps.
const lint = (s) => s.lintAttempts ?? 0;

const same = (a, b) =>
  a.docState === b.docState &&
  a.fixAttempts === b.fixAttempts &&
  lint(a) === lint(b) &&
  a.lastViolation === b.lastViolation;

export const stateInvariants = [
  {
    name: 'doc-state-is-valid',
    pred: (s) => STATES.includes(s.docState),
  },
  {
    name: 'fix-attempts-within-budget',
    pred: (s) =>
      Number.isInteger(s.fixAttempts) &&
      s.fixAttempts >= 0 &&
      s.fixAttempts <= MAX_FIX_ATTEMPTS,
  },
  {
    // The new gate's budget is finite too.
    name: 'lint-attempts-within-budget',
    pred: (s) =>
      Number.isInteger(s.lintAttempts) &&
      s.lintAttempts >= 0 &&
      s.lintAttempts <= MAX_LINT_ATTEMPTS,
  },
  {
    name: 'published-implies-no-outstanding-violation',
    pred: (s) => s.docState !== 'published' || s.lastViolation === '',
  },
  {
    name: 'escalated-records-why',
    pred: (s) =>
      s.docState !== 'escalated' ||
      (typeof s.lastViolation === 'string' && s.lastViolation.length > 0),
  },
];

export const transitionInvariants = [
  {
    name: 'terminal-states-are-frozen',
    pred: (pre, action, data, post) =>
      !TERMINAL.includes(pre.docState) || same(pre, post),
  },
  {
    name: 'stale-completions-are-no-ops',
    pred: (pre, action, data, post) => {
      const awaits = {
        EXTRACT_DONE: 'extracting',
        EXTRACT_FAILED: 'extracting',
        TRANSFORM_DONE: 'transforming',
        TRANSFORM_FAILED: 'transforming',
        VALIDATION_PASSED: 'validating',
        VALIDATION_FAILED: 'validating',
        LINT_PASSED: 'linting',
        LINT_FAILED: 'linting',
        RENDER_DONE: 'rendering',
        RENDER_FAILED: 'rendering',
      };
      if (!(action in awaits)) return true;
      if (pre.docState === awaits[action]) return true;
      return same(pre, post);
    },
  },
  {
    // Both correction counters move only under their own concrete signal.
    name: 'corrections-only-on-a-real-signal',
    pred: (pre, action, data, post) => {
      const fixMoved = post.fixAttempts !== pre.fixAttempts;
      const lintMoved = lint(post) !== lint(pre);
      if (!fixMoved && !lintMoved) return true;
      if (fixMoved && lintMoved) return false;
      if (fixMoved) {
        return (
          action === 'VALIDATION_FAILED' &&
          pre.docState === 'validating' &&
          post.fixAttempts === pre.fixAttempts + 1 &&
          post.docState === 'transforming'
        );
      }
      return (
        action === 'LINT_FAILED' &&
        pre.docState === 'linting' &&
        lint(post) === lint(pre) + 1 &&
        post.docState === 'transforming'
      );
    },
  },
  {
    // v1's rule, carried forward under its own name: a backward edge out of
    // validating is still only ever the VALIDATION_FAILED bend. (In v1 this
    // covered every backward edge; the linting gate's bend is governed by the
    // umbrella rule below.)
    name: 'pipeline-only-bends-back-on-validation-failure',
    pred: (pre, action, data, post) => {
      if (pre.docState !== 'validating' || !(post.docState in STAGE_ORDER)) return true;
      if (STAGE_ORDER[post.docState] >= STAGE_ORDER[pre.docState]) return true;
      return action === 'VALIDATION_FAILED' && post.docState === 'transforming';
    },
  },
  {
    // Still a directed pipeline: the only backward edges are the two
    // event-driven bends into the transform stage.
    name: 'pipeline-only-bends-back-on-a-failure-signal',
    pred: (pre, action, data, post) => {
      if (!(pre.docState in STAGE_ORDER) || !(post.docState in STAGE_ORDER)) return true;
      if (STAGE_ORDER[post.docState] >= STAGE_ORDER[pre.docState]) return true;
      if (post.docState !== 'transforming') return false;
      return (
        (action === 'VALIDATION_FAILED' && pre.docState === 'validating') ||
        (action === 'LINT_FAILED' && pre.docState === 'linting')
      );
    },
  },
  {
    // Folded in from the polygen run: the exact violation is routed back (or
    // up) VERBATIM under VALIDATION_FAILED; an empty signal is a no-op.
    name: 'validation-failure-records-exact-violation',
    pred: (pre, action, data, post) => {
      if (action !== 'VALIDATION_FAILED' || pre.docState !== 'validating') return true;
      const v = typeof (data && data.violation) === 'string' ? data.violation : '';
      if (v === '') return same(pre, post);
      return post.lastViolation === v;
    },
  },
  {
    // The lint gate gets the same verbatim-recording guarantee.
    name: 'lint-failure-records-exact-violation',
    pred: (pre, action, data, post) => {
      if (action !== 'LINT_FAILED' || pre.docState !== 'linting') return true;
      const v = typeof (data && data.violation) === 'string' ? data.violation : '';
      if (v === '') return same(pre, post);
      return post.lastViolation === v;
    },
  },
  {
    // Folded in from the polygen run, widened for the two-gate flow:
    // publishing only happens via a clean RENDER_DONE, and a violation is
    // only ever cleared by passing a gate (VALIDATION_PASSED into linting,
    // LINT_PASSED into rendering) — never silently.
    name: 'publish-requires-clean-render',
    pred: (pre, action, data, post) => {
      if (post.docState === 'published' && pre.docState !== 'published') {
        if (
          !(
            action === 'RENDER_DONE' &&
            pre.docState === 'rendering' &&
            pre.lastViolation === '' &&
            post.lastViolation === '' &&
            post.fixAttempts === pre.fixAttempts &&
            lint(post) === lint(pre)
          )
        ) {
          return false;
        }
      }
      if (pre.lastViolation !== '' && post.lastViolation === '') {
        return (
          (action === 'VALIDATION_PASSED' &&
            pre.docState === 'validating' &&
            post.docState === 'linting') ||
          (action === 'LINT_PASSED' &&
            pre.docState === 'linting' &&
            post.docState === 'rendering')
        );
      }
      return true;
    },
  },
  {
    name: 'fix-budget-exhaustion-escalates',
    pred: (pre, action, data, post) =>
      !(action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        pre.fixAttempts >= MAX_FIX_ATTEMPTS) ||
      post.docState === 'escalated',
  },
  {
    name: 'lint-budget-exhaustion-escalates',
    pred: (pre, action, data, post) =>
      !(action === 'LINT_FAILED' &&
        pre.docState === 'linting' &&
        pre.lintAttempts >= MAX_LINT_ATTEMPTS) ||
      post.docState === 'escalated',
  },
  {
    // The new intent: rendering is only reachable through the lint gate.
    name: 'rendering-only-entered-through-lint-pass',
    pred: (pre, action, data, post) =>
      post.docState !== 'rendering' ||
      pre.docState === 'rendering' ||
      (action === 'LINT_PASSED' && pre.docState === 'linting'),
  },
];
