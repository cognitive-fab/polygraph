// Invariants for the document pipeline — the article's claims, machine-checked.
// "Workflows, not loops": the pipeline is directed, bends back only on a real
// signal, and a bounded fix budget escalates instead of grinding another lap.
const TERMINAL = ['published', 'escalated'];
const STAGE_ORDER = {
  received: 0,
  extracting: 1,
  transforming: 2,
  validating: 3,
  rendering: 4,
  published: 5,
};
const STATES = [...Object.keys(STAGE_ORDER), 'escalated'];
const MAX_FIX_ATTEMPTS = 2;

const same = (a, b) =>
  a.docState === b.docState &&
  a.fixAttempts === b.fixAttempts &&
  a.lastViolation === b.lastViolation;

export const stateInvariants = [
  {
    name: 'doc-state-is-valid',
    pred: (s) => STATES.includes(s.docState),
  },
  {
    // The fix budget is finite: the workflow cannot loop unboundedly.
    name: 'fix-attempts-within-budget',
    pred: (s) =>
      Number.isInteger(s.fixAttempts) &&
      s.fixAttempts >= 0 &&
      s.fixAttempts <= MAX_FIX_ATTEMPTS,
  },
  {
    // Publishing with an outstanding violation is unreachable.
    name: 'published-implies-no-outstanding-violation',
    pred: (s) => s.docState !== 'published' || s.lastViolation === '',
  },
  {
    // Escalation always carries the concrete signal that caused it.
    name: 'escalated-records-why',
    pred: (s) =>
      s.docState !== 'escalated' ||
      (typeof s.lastViolation === 'string' && s.lastViolation.length > 0),
  },
];

export const transitionInvariants = [
  {
    // Terminal states never re-open or mutate under any action.
    name: 'terminal-states-are-frozen',
    pred: (pre, action, data, post) =>
      !TERMINAL.includes(pre.docState) || same(pre, post),
  },
  {
    // Completions outside their awaiting stage must leave the model
    // byte-for-byte unchanged (at-least-once / duplicate-signal safety).
    name: 'stale-completions-are-no-ops',
    pred: (pre, action, data, post) => {
      const awaits = {
        EXTRACT_DONE: 'extracting',
        EXTRACT_FAILED: 'extracting',
        TRANSFORM_DONE: 'transforming',
        TRANSFORM_FAILED: 'transforming',
        VALIDATION_PASSED: 'validating',
        VALIDATION_FAILED: 'validating',
        RENDER_DONE: 'rendering',
        RENDER_FAILED: 'rendering',
      };
      if (!(action in awaits)) return true;
      if (pre.docState === awaits[action]) return true;
      return same(pre, post);
    },
  },
  {
    // The article's thesis as a rule: a correction cycle exists ONLY because a
    // concrete validation failure demanded it — fixAttempts can never move
    // except by exactly +1 under VALIDATION_FAILED in validating.
    name: 'corrections-only-on-a-real-signal',
    pred: (pre, action, data, post) =>
      post.fixAttempts === pre.fixAttempts ||
      (action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        post.fixAttempts === pre.fixAttempts + 1 &&
        post.docState === 'transforming'),
  },
  {
    // The pipeline is directed: the only backward edge is the event-driven
    // bend validating -> transforming, and only VALIDATION_FAILED takes it.
    name: 'pipeline-only-bends-back-on-validation-failure',
    pred: (pre, action, data, post) => {
      if (!(pre.docState in STAGE_ORDER) || !(post.docState in STAGE_ORDER)) return true;
      if (STAGE_ORDER[post.docState] >= STAGE_ORDER[pre.docState]) return true;
      return (
        action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        post.docState === 'transforming'
      );
    },
  },
  {
    // Folded in from the polygen run (2026-08-06): the exact violation is
    // routed back (or up) VERBATIM — a VALIDATION_FAILED in validating must
    // record data.violation in lastViolation whether it bends or escalates;
    // a signal without a violation is an observable no-op.
    name: 'validation-failure-records-exact-violation',
    pred: (pre, action, data, post) => {
      if (action !== 'VALIDATION_FAILED' || pre.docState !== 'validating') return true;
      const v = typeof (data && data.violation) === 'string' ? data.violation : '';
      if (v === '') return same(pre, post);
      return post.lastViolation === v;
    },
  },
  {
    // Folded in from the polygen run (2026-08-06): publishing only happens
    // via a clean RENDER_DONE from rendering, and VALIDATION_PASSED is the
    // only thing that clears a violation without escalating.
    name: 'publish-requires-clean-render',
    pred: (pre, action, data, post) => {
      if (post.docState === 'published' && pre.docState !== 'published') {
        if (
          !(
            action === 'RENDER_DONE' &&
            pre.docState === 'rendering' &&
            pre.lastViolation === '' &&
            post.lastViolation === '' &&
            post.fixAttempts === pre.fixAttempts
          )
        ) {
          return false;
        }
      }
      if (pre.lastViolation !== '' && post.lastViolation === '') {
        return (
          action === 'VALIDATION_PASSED' &&
          pre.docState === 'validating' &&
          post.docState === 'rendering'
        );
      }
      return true;
    },
  },
  {
    // An exhausted fix budget escalates to a human — never another lap.
    name: 'fix-budget-exhaustion-escalates',
    pred: (pre, action, data, post) =>
      !(action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        pre.fixAttempts >= MAX_FIX_ATTEMPTS) ||
      post.docState === 'escalated',
  },
];
