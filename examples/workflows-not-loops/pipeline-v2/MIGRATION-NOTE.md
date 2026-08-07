# MIGRATION-NOTE — contract 02982eae47d8 → 8f85704080ab

## Why the shape changed

v2 inserts a `linting` stage between validating and rendering — a second
event-driven gate with its own bounded fix budget (`lintAttempts`, 0..1).
The workflow evolved by adding a step where a real signal can bend it back;
no loop, no re-plan, and the fleet mid-flight must cross the deploy without
replay gymnastics — which is exactly what this migration + the polyvers
gates certify.

## What each hole maps

- **`docState` (retyped)** — the enum widened by one member (`'linting'`).
  Pure widening: every v1 value maps to itself; the migration passes known
  v1 values through unchanged and throws on anything else (there is
  nothing else — v1's model check proves the enum is closed). No v1
  instance can land IN `linting`, so no instance skips the new gate: a doc
  migrated while `validating` reaches linting on its next forward step.
- **`lintAttempts` (added)** — initialized to `0` from the new contract's
  `initState`: no v1 document has ever been sent back by the linter.

## Meaning-gap instances

None. v1's state space embeds injectively into v2's; no v1 instance holds
information the v2 shape cannot represent, and no v2 semantics are
retroactively claimed for v1 instances (`lintAttempts: 0` is literally true
of every migrated doc).
