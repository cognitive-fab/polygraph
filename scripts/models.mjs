// Model-id resolution.
//
// The plugin has NO default model — callers must pass --model. These aliases
// are conveniences that map friendly names to Anthropic API model ids. Any
// value NOT in this table is passed through VERBATIM, so you can always supply
// the exact API id yourself.
//
// NOTE: verify each id against the current Anthropic model list before relying
// on it (https://platform.claude.com/docs/en/about-claude/models). Ids change;
// this table reflects the published list as of 2026-07-24 (all five verified
// current on that date by a live API call; there is no "sonnet-4.8" — the
// current Sonnet is claude-sonnet-5) and is intentionally small.
export const MODEL_ALIASES = {
  'fable-5': 'claude-fable-5',
  'opus-5': 'claude-opus-5',
  'opus-4.8': 'claude-opus-4-8',
  'sonnet-5': 'claude-sonnet-5',
  'haiku-4.5': 'claude-haiku-4-5-20251001',
};

// Per-step model recommendations, from the 2026-07-24 Opus 5 vs Fable 5 study
// (docs/opus5_consolidated_report.md; raw per-machine tables in
// eval/AB-V2-RESULTS.md). These are RECOMMENDATIONS surfaced in usage text and
// docs — they are never applied as defaults; the no-default-model doctrine
// stands and callers still pass --model explicitly.
//
// The study's split, in one line: on READING code (spec derivation), opus-5
// beat fable-5 outright at half the price (5/5 seeded bugs, 0 false alarms vs
// fable-5's 1); on WRITING formal artifacts ONE-SHOT, fable-5 was ahead
// (passed cold where opus-5 needed one error-feedback retry — small sample,
// fable-5 n=1), and the gap closes to nothing as soon as a repair loop feeds
// the checker's error back. So: opus-5 everywhere a retry/repair/pre-check
// loop exists, fable-5 only for one-shot formal authoring with no retry.
//
// `onRefusal` is the model observed to answer prompts the recommended model
// refused on policy grounds (stop_reason=refusal, category=cyber — triggered
// by source comments describing bugs, which is the shape of this whole
// pipeline). Both opus-5 and fable-5 refused at least one machine in the
// study; opus-4.8 refused none.
export const RECOMMENDED_MODELS = {
  // verify / spec derivation (generate.mjs): reading code. opus-5 was
  // strictly better than fable-5 here AND costs half as much.
  verify: {
    model: 'opus-5',
    onRefusal: 'opus-4.8',
    why: '5/5 seeded bugs, 0 false alarms on the 8-machine A/B; fable-5 also went 5/5 but flagged the out-of-scope machine, at 2x the price',
  },
  // polygen with its self-repair loop enabled (--repair-max >= 1, the
  // default): the repair loop feeds model-checker errors back, which is
  // exactly the regime where the cheaper model catches up.
  polygen: {
    model: 'opus-5',
    onRefusal: 'opus-4.8',
    why: 'authoring failures were one-line syntax habits that a single error-feedback retry fixed completely; with the repair loop on, pay half',
  },
  // polygen --repair-max 0: one-shot formal authoring, no retry. The only
  // regime where fable-5 earned its 2x price — it passed the model checker
  // cold where opus-5 went 1/5 first-try. Caveat: fable-5 n=1 in the study.
  'polygen-oneshot': {
    model: 'fable-5',
    onRefusal: 'opus-4.8',
    why: 'one shot, no retry, formal output: fable-5 passed cold; opus-5 needed the retry this mode forbids (suggestive — single fable-5 sample)',
  },
  // polynv headless harvest (polynv/src/llm.mjs): candidates are dropped or
  // pre-checked mechanically at the door, so the retry-regime logic applies.
  'polynv-harvest': {
    model: 'opus-5',
    onRefusal: 'opus-4.8',
    why: 'every candidate is pre-checked/dropped mechanically downstream — the loop exists, so the reading-accuracy winner at half price applies',
  },
};

/**
 * Recommendation for a pipeline step, or null if the step has none (e.g. the
 * engines that make no model calls: polyvers, polyviz, polyrun).
 */
export function recommendedFor(step) {
  return Object.prototype.hasOwnProperty.call(RECOMMENDED_MODELS, step)
    ? RECOMMENDED_MODELS[step]
    : null;
}

/**
 * Resolve a friendly alias to an API id, or pass the value through unchanged.
 * Returns { id, resolved } where resolved=true if an alias matched.
 */
export function resolveModel(name) {
  if (!name) return { id: name, resolved: false };
  if (Object.prototype.hasOwnProperty.call(MODEL_ALIASES, name)) {
    return { id: MODEL_ALIASES[name], resolved: true };
  }
  return { id: name, resolved: false };
}
