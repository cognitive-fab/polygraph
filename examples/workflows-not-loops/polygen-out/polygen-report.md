# polygen — authored spec report

> Consistency check, not a proof. This code has been model-checked against
> its own stated invariants and its demo corpus has been independently
> replayed — that is not the same as being correct. Review the contract and
> invariants below before trusting either.

- artifact: **SAM v2 strict-profile module** (`{ instance, init, actions, getState, setState }`, vendored sam-lib 2.0.0-alpha; strict validate() gate at every stage boundary)

## Contract

```json
{
  "lang": "javascript",
  "stateKeys": [
    {
      "name": "docState",
      "type": "enum: 'received' | 'extracting' | 'transforming' | 'validating' | 'rendering' | 'published' | 'escalated'"
    },
    {
      "name": "fixAttempts",
      "type": "integer 0..2, how many times validation sent the document back for a targeted fix"
    },
    {
      "name": "lastViolation",
      "type": "string, the exact signal that caused the last bend-back or escalation ('' when none outstanding)"
    }
  ],
  "initState": {
    "docState": "received",
    "fixAttempts": 0,
    "lastViolation": ""
  },
  "actions": {
    "START": {
      "dataFields": {}
    },
    "EXTRACT_DONE": {
      "dataFields": {}
    },
    "EXTRACT_FAILED": {
      "dataFields": {
        "reason": "string"
      }
    },
    "TRANSFORM_DONE": {
      "dataFields": {}
    },
    "TRANSFORM_FAILED": {
      "dataFields": {
        "reason": "string"
      }
    },
    "VALIDATION_PASSED": {
      "dataFields": {}
    },
    "VALIDATION_FAILED": {
      "dataFields": {
        "violation": "string - the exact schema/content rule that failed; routed back to the transform stage verbatim"
      }
    },
    "RENDER_DONE": {
      "dataFields": {}
    },
    "RENDER_FAILED": {
      "dataFields": {
        "reason": "string"
      }
    }
  },
  "dataDomain": {
    "START": {},
    "EXTRACT_DONE": {},
    "EXTRACT_FAILED": {
      "reason": [
        "unreadable-input"
      ]
    },
    "TRANSFORM_DONE": {},
    "TRANSFORM_FAILED": {
      "reason": [
        "model-unavailable"
      ]
    },
    "VALIDATION_PASSED": {},
    "VALIDATION_FAILED": {
      "violation": [
        "missing-title",
        "broken-schema"
      ]
    },
    "RENDER_DONE": {},
    "RENDER_FAILED": {
      "reason": [
        "render-crashed"
      ]
    }
  },
  "terminalKey": "docState",
  "terminalStates": [
    "published",
    "escalated"
  ],
  "specialRules": [
    {
      "name": "corrections-are-event-driven",
      "note": "The pipeline only ever bends backward (validating -> transforming) on a VALIDATION_FAILED carrying the exact violation. There is no reflect-every-turn cadence: no action exists that re-runs a stage without a concrete failure signal.",
      "whenState": "docState == 'validating'",
      "whenAction": "VALIDATION_FAILED"
    },
    {
      "name": "bounded-fix-budget-escalates",
      "note": "VALIDATION_FAILED with fixAttempts already at 2 escalates to a human (terminal 'escalated', lastViolation recorded) instead of grinding another lap.",
      "whenState": "docState == 'validating' && fixAttempts >= 2",
      "whenAction": "VALIDATION_FAILED"
    },
    {
      "name": "stale-completions-reject",
      "note": "Stage completions arriving in any state other than the stage that awaits them are observable rejections (post == pre), never faults — at-least-once delivery and duplicate signals are safe by construction.",
      "whenState": "any non-awaiting state",
      "whenAction": "EXTRACT_DONE | EXTRACT_FAILED | TRANSFORM_DONE | TRANSFORM_FAILED | VALIDATION_PASSED | VALIDATION_FAILED | RENDER_DONE | RENDER_FAILED"
    }
  ],
  "noOpRule": "An action that does not apply in the current state is reject(reason) — an observable no-op with post == pre."
}
```

## Code (`C:\Users\jjdub\code\polygraph\examples\workflows-not-loops\polygen-out\next.cjs`)

```javascript
'use strict';

/**
 * Document publishing pipeline — SAM v2 STRICT PROFILE module.
 *
 * Workflow (single document instance):
 *   received -> extracting -> transforming -> validating -> rendering -> published
 * The ONLY backward edge is validating -> transforming, taken ONLY by
 * VALIDATION_FAILED (records the exact violation, fixAttempts += 1).
 * Fix budget is bounded at 2: VALIDATION_FAILED with fixAttempts already 2
 * escalates to a human (terminal 'escalated', violation recorded).
 * Any stage failure event escalates, recording its reason.
 * Stage completions delivered outside the awaiting stage are observable
 * rejections (post == pre), never faults.
 */

const { createInstance } = require('@cognitive-fab/sam-pattern');

const instance = createInstance({ strict: true, hasAsyncActions: false });

const INITIAL_STATE = { docState: 'received', fixAttempts: 0, lastViolation: '' };

const FIX_BUDGET = 2;

const modelShape = {
  docState: { type: 'string' },
  fixAttempts: { type: 'number' },
  lastViolation: { type: 'string' },
};

/* ------------------------------------------------------------------ *
 * Actions (full v2 form: { action, schema, domain })
 * ------------------------------------------------------------------ */

const actions = {
  START: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  EXTRACT_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  EXTRACT_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'unreadable-input' }],
  },
  TRANSFORM_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  TRANSFORM_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'model-unavailable' }],
  },
  VALIDATION_PASSED: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  VALIDATION_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { violation: { type: 'string', required: true } },
    domain: [{ violation: 'missing-title' }, { violation: 'broken-schema' }],
  },
  RENDER_DONE: {
    action: (data = {}) => ({ ...data }),
    schema: {},
    domain: [{}],
  },
  RENDER_FAILED: {
    action: (data = {}) => ({ ...data }),
    schema: { reason: { type: 'string', required: true } },
    domain: [{ reason: 'render-crashed' }],
  },
};

/* ------------------------------------------------------------------ *
 * Helpers (pure, no hidden state)
 * ------------------------------------------------------------------ */

const asText = (v) => (typeof v === 'string' ? v : '');

/* ------------------------------------------------------------------ *
 * Acceptors — next-state relations over the FROZEN pre-state `model`
 * ------------------------------------------------------------------ */

const acceptors = {
  // received -> extracting
  START: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'received') {
      // Already started, mid-pipeline, or terminal: observable no-op.
      return reject('start-only-from-received');
    }
    next.docState = 'extracting';
    unchanged('fixAttempts', 'lastViolation');
  },

  // extracting -> transforming
  EXTRACT_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    next.docState = 'transforming';
    unchanged('fixAttempts', 'lastViolation');
  },

  // extracting -> escalated (reason recorded)
  EXTRACT_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'extracting') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      // Escalation without a recorded reason must never happen.
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },

  // transforming -> validating
  TRANSFORM_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    next.docState = 'validating';
    unchanged('fixAttempts', 'lastViolation');
  },

  // transforming -> escalated (reason recorded)
  TRANSFORM_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'transforming') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },

  // validating -> rendering, clearing the outstanding violation
  VALIDATION_PASSED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }
    next.docState = 'rendering';
    next.lastViolation = '';
    unchanged('fixAttempts');
  },

  // The ONLY backward edge: validating -> transforming, bounded at 2 fixes.
  VALIDATION_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'validating') {
      return reject('stale-completions-reject');
    }

    const violation = asText(proposal.violation);
    if (violation === '') {
      // Corrections are event-driven: a bend-back requires a concrete
      // failure signal; there is no cadence-driven re-run of a stage.
      return reject('corrections-are-event-driven');
    }

    if (model.fixAttempts > FIX_BUDGET) {
      // Defensive: the counter can never exceed the budget; if it somehow
      // did, do not grind another lap — observable no-op.
      return reject('bounded-fix-budget-escalates');
    }

    if (model.fixAttempts === FIX_BUDGET) {
      // Budget exhausted: escalate to a human, recording the violation.
      next.docState = 'escalated';
      next.lastViolation = violation;
      unchanged('fixAttempts');
      return;
    }

    // Targeted fix: the single legal backward edge, +1 exactly.
    next.docState = 'transforming';
    next.fixAttempts = model.fixAttempts + 1;
    next.lastViolation = violation;
  },

  // rendering -> published (terminal)
  RENDER_DONE: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    if (asText(model.lastViolation) !== '') {
      // Never publish with an outstanding violation.
      return reject('outstanding-violation-blocks-publish');
    }
    next.docState = 'published';
    unchanged('fixAttempts', 'lastViolation');
  },

  // rendering -> escalated (reason recorded)
  RENDER_FAILED: (model) => (proposal, { reject, next, unchanged }) => {
    if (model.docState !== 'rendering') {
      return reject('stale-completions-reject');
    }
    const reason = asText(proposal.reason);
    if (reason === '') {
      return reject('escalation-requires-reason');
    }
    next.docState = 'escalated';
    next.lastViolation = reason;
    unchanged('fixAttempts');
  },
};

/* ------------------------------------------------------------------ *
 * Wiring — one anonymous component under the `component` key
 * ------------------------------------------------------------------ */

const control = instance({
  initialState: { ...INITIAL_STATE },
  component: { modelShape, actions, acceptors, reactors: [] },
});

const { intents } = control;

/* ------------------------------------------------------------------ *
 * Module contract
 * ------------------------------------------------------------------ */

const getState = () => instance({}).getState();

const setState = (snapshot) => instance({}).setState(snapshot);

const init = () => setState(INITIAL_STATE);

const namedActions = {
  START: (data = {}) => intents.START(data),
  EXTRACT_DONE: (data = {}) => intents.EXTRACT_DONE(data),
  EXTRACT_FAILED: (data = {}) => intents.EXTRACT_FAILED(data),
  TRANSFORM_DONE: (data = {}) => intents.TRANSFORM_DONE(data),
  TRANSFORM_FAILED: (data = {}) => intents.TRANSFORM_FAILED(data),
  VALIDATION_PASSED: (data = {}) => intents.VALIDATION_PASSED(data),
  VALIDATION_FAILED: (data = {}) => intents.VALIDATION_FAILED(data),
  RENDER_DONE: (data = {}) => intents.RENDER_DONE(data),
  RENDER_FAILED: (data = {}) => intents.RENDER_FAILED(data),
};

module.exports = { instance, init, actions: namedActions, getState, setState };
```

⚠️ **Proposed invariants — review before trusting; these encode the model's
reading of intent, not a verified spec.**

```javascript
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
```

## Self-repair loop

Two defect classes are checked every round, in order: domain-ref gaps (a
`dataDomain` value the contract declares but the code never handles — these
are fixed FIRST, since until they're gone the checker may never even reach
what an invariant is meant to guard) and invariant violations.

| iteration | states explored | cap hit | nondeterministic | domain gaps | violations |
|---|---|---|---|---|---|
| 0 | 27 | no | no | — | — |

**Converged — no domain-ref gaps and no invariant violations reachable in the
final code**, over the explored (bounded) state space. Not a proof.

## Demo / regression trace corpus

- scenarios: **12** · windows: **94**
- corpus validated clean: no chaining/terminal problems.

## Independent replay sanity check

- windows replayed (separate process): **94** · non-pass: **0**

## Next steps

1. Review the contract and invariants above — both are the model's reading of
   your intent, not ground truth.
2. Wire the machine into the real handler/reducer via its exported `actions` —
   call the intents, do not reimplement the transition logic inline.
3. After integration, run `/polygraph:verify` against REAL captured traces to
   catch drift between this pure model and the glue code around it.