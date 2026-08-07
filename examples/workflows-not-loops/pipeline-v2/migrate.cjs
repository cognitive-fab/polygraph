'use strict';
// migrate.cjs — SCAFFOLDED by polyvers from the shape diff
// (old contract 02982eae47d8 → new contract 8f85704080ab).
// Pure by contract: (oldState) → newState, no I/O, no clock — the migrate
// gate enforces determinism by double application.
// HOLE: an unfilled TODO fails the migrate gate loudly — each hole throws
// independently, so deleting one line cannot silently drop a key.
const HOLE = (msg) => { throw new Error(msg); };
module.exports.migrate = function migrate(oldState) {
  const next = {};
  // carried over unchanged
  next["fixAttempts"] = oldState["fixAttempts"];
  next["lastViolation"] = oldState["lastViolation"];
  // added in the new shape — initialized from the new contract's initState
  next["lintAttempts"] = 0;
  // retyped: enum: 'received' | 'extracting' | 'transforming' | 'validating' | 'rendering' | 'published' | 'escalated' → enum: 'received' | 'extracting' | 'transforming' | 'validating' | 'linting' | 'rendering' | 'published' | 'escalated'
  // Pure widening: v2 adds the 'linting' member; every v1 value is a valid
  // v2 value unchanged. An in-flight v1 doc never claims to have been linted
  // (lintAttempts starts at 0 and docState is never 'linting'), so a doc
  // migrated while validating will pass through the new gate on its way
  // forward — no instance skips linting.
  next["docState"] = ['received', 'extracting', 'transforming', 'validating', 'rendering', 'published', 'escalated'].includes(oldState["docState"])
    ? oldState["docState"]
    : HOLE(`unknown v1 docState: ${oldState["docState"]}`);
  return next;
};
