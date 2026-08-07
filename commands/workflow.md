---
description: Build a feature as a workflow, not an agentic loop — design stages/signals/budgets with the user, front-load contract + invariants, author with polygen, declare effects, prove the anti-loop rules with check-effects, and stand it up under polyrun.
argument-hint: "<feature description>" [--out <dir>]
allowed-tools: Bash, Read, Write, Glob, Grep
---

Invoke the `workflow` skill over `$ARGUMENTS` and follow its steps in order.

This is the COMPOSITION command: it drives the whole toolset end-to-end for
a NEW feature built the workflows-not-loops way (polygen authors the
machine, polyrun's checkers gate the effect composition, polyrun executes,
polyvers evolves later). The design conversation in Step 1 — stages along
the data flow, every failure answered with either a targeted bend-back or a
human escalation, the fuzzy middle scoped to named stages — happens WITH the
user before any file is written.

Reference material shipped with the plugin:
- `${CLAUDE_PLUGIN_ROOT}/examples/workflows-not-loops/MANUAL.md` — the recipe
- `${CLAUDE_PLUGIN_ROOT}/examples/workflows-not-loops/` — document pipeline
  (incl. the polygen bisimulation and the v1→v2 polyvers evolution)
- `${CLAUDE_PLUGIN_ROOT}/examples/todo-machine/` — an ordinary app (durable
  timers replace the cron scan; clickable HTTP shell)

No API key is required end-to-end: machine authoring follows the `polygen`
skill's Step 0 choice (scripted with `ANTHROPIC_API_KEY` for the CI-grade,
pinned-model run — or keyless in-session authoring gated by the same local
checkers), and every checking tier (`check.mjs`, `check-effects`, deploy
gate) and polyrun itself never need one. Always state the standard disclosure: exhaustive over the declared
domains — a consistency check, not a proof.
