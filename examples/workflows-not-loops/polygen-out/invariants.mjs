const ORDER = {
  received: 0,
  extracting: 1,
  transforming: 2,
  validating: 3,
  rendering: 4,
  published: 5,
};

const TERMINAL = new Set(['published', 'escalated']);

const AWAITING = {
  EXTRACT_DONE: 'extracting',
  EXTRACT_FAILED: 'extracting',
  TRANSFORM_DONE: 'transforming',
  TRANSFORM_FAILED: 'transforming',
  VALIDATION_PASSED: 'validating',
  VALIDATION_FAILED: 'validating',
  RENDER_DONE: 'rendering',
  RENDER_FAILED: 'rendering',
};

const sameState = (a, b) =>
  a.docState === b.docState &&
  a.fixAttempts === b.fixAttempts &&
  a.lastViolation === b.lastViolation;

const text = (v) => (typeof v === 'string' ? v : '');

export const stateInvariants = [
  {
    // Only the workflow's own states exist; the fix budget is hard-bounded at 2;
    // a published document never carries an outstanding violation; an escalation
    // always carries the reason/violation that caused it.
    name: 'reachable-states-are-well-formed',
    pred: (state) =>
      (Object.prototype.hasOwnProperty.call(ORDER, state.docState) ||
        state.docState === 'escalated') &&
      Number.isInteger(state.fixAttempts) &&
      state.fixAttempts >= 0 &&
      state.fixAttempts <= 2 &&
      typeof state.lastViolation === 'string' &&
      (state.docState !== 'published' || state.lastViolation === '') &&
      (state.docState !== 'escalated' || state.lastViolation !== ''),
  },
];

export const transitionInvariants = [
  {
    // Terminal states never mutate: nothing re-opens published or escalated.
    name: 'terminal-states-are-frozen',
    pred: (pre, action, data, post) =>
      !TERMINAL.has(pre.docState) || sameState(pre, post),
  },
  {
    // The ONLY backward edge in the machine is validating -> transforming, and it
    // is taken only by VALIDATION_FAILED. Every other move is forward (or into
    // the escalated sink, or a no-op).
    name: 'only-backward-edge-is-the-validation-bend',
    pred: (pre, action, data, post) => {
      if (post.docState === 'escalated') return true;
      if (!(pre.docState in ORDER) || !(post.docState in ORDER)) return true;
      if (ORDER[post.docState] >= ORDER[pre.docState]) return true;
      return (
        action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        post.docState === 'transforming'
      );
    },
  },
  {
    // fixAttempts changes only by exactly +1, only under VALIDATION_FAILED taken
    // in validating while under budget, and only when it actually bends back.
    name: 'fix-counter-moves-only-by-the-bend',
    pred: (pre, action, data, post) => {
      if (post.fixAttempts === pre.fixAttempts) return true;
      return (
        action === 'VALIDATION_FAILED' &&
        pre.docState === 'validating' &&
        pre.fixAttempts < 2 &&
        post.docState === 'transforming' &&
        post.fixAttempts === pre.fixAttempts + 1
      );
    },
  },
  {
    // Corrections are event-driven and bounded: in validating, a VALIDATION_FAILED
    // carrying a concrete violation either bends back recording that exact
    // violation (under budget) or escalates recording it (budget exhausted);
    // a signal without a violation is a no-op, never a silent re-run.
    name: 'validation-failed-bends-or-escalates-with-exact-violation',
    pred: (pre, action, data, post) => {
      if (action !== 'VALIDATION_FAILED' || pre.docState !== 'validating') return true;
      const violation = text(data && data.violation);
      if (violation === '') return sameState(pre, post);
      if (pre.fixAttempts >= 2) {
        return (
          post.docState === 'escalated' &&
          post.lastViolation === violation &&
          post.fixAttempts === pre.fixAttempts
        );
      }
      return (
        post.docState === 'transforming' &&
        post.lastViolation === violation &&
        post.fixAttempts === pre.fixAttempts + 1
      );
    },
  },
  {
    // Stage completions delivered outside the stage that awaits them are
    // observable rejections (post == pre), never faults: duplicates and stale
    // at-least-once deliveries are safe.
    name: 'stale-completions-are-no-ops',
    pred: (pre, action, data, post) => {
      const awaits = AWAITING[action];
      if (!awaits) return true;
      if (pre.docState === awaits) return true;
      return sameState(pre, post);
    },
  },
  {
    // Publishing is gated: only rendering with no outstanding violation may
    // publish, and VALIDATION_PASSED is the only thing that clears a violation
    // without escalating.
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
];