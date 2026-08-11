#!/usr/bin/env node
// Scripted negative control (verify-enhancements plan M4).
//
// The skill mandates a negative control — break one rule, confirm the corpus
// catches it — but it was hand work (copy the spec, edit a guard, eyeball the
// delta), so under time pressure it gets skipped; and it is the only step
// that proves the harness CAN fail. This tool makes it one command:
//
//   node mutate.mjs --spec control.js --contract c.json --traces traces/ --list
//   node mutate.mjs --spec control.js --contract c.json --traces traces/ --apply <mutation-id>
//   node mutate.mjs --spec control.js --contract c.json --traces traces/ --all
//
// Mutations are polynv's four state-machine operators (guard negation,
// transition retarget, acceptor widening, update-drop) enumerated from the
// machine's OWN reachable graph — reused, not forked, so ids and semantics
// match the adequacy grade. Applying one replays original and mutant against
// the trace corpus in-process and reports the flipped windows.
//
// The two possible outcomes are both first-class results:
//   * windows flipped  -> the corpus discriminates this rule ✓ (exit 0)
//   * ZERO flipped     -> no captured trace exercises this rule: a real
//     regression here would replay clean. That is a CORPUS BLIND SPOT — the
//     trace-side view of the frozen-key class check.mjs warns about (M1) —
//     and it exits 1 so a scripted control cannot half-pass silently.
//
// The spec is a v2 SAM strict-profile module, driven through the same
// {init, transition} adapter the checker uses.
// Deliberate scope cut (recorded in the plan): no --out mutated-spec file —
// mutants are closures over the adapted surface, and the replay+delta happens
// here, so nothing in the workflow needs one on disk.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWindows } from './replay.mjs';
import { loadSpec, stable } from './load-spec.mjs';
import samAdapter from './sam-adapter.cjs';
import { generateMutants, graphDigest } from '../polynv/src/grade.mjs';
import { enumerateGraph } from '../polynv/src/consequences.mjs';

const { isSamV2Module, makeSamAdapter, domainFromManifest } = samAdapter;

/** The pipeline replayers' scoreability rule: an empty/missing post measures nothing. */
const isScoreable = (w) => w.post && typeof w.post === 'object' && Object.keys(w.post).length > 0;

/**
 * Replay an in-memory {init,next} module against windows, with the SAME rules
 * the pipeline replayers use (tv.mjs / sam-tv.mjs — parity is the whole
 * point: this delta must be representative of what verify would measure):
 * - PROJECTION: only keys present in the trace post-state must match; a spec
 *   carrying extra keys (a v2 adapter snapshot merges init-defaulted keys
 *   into every post) still passes.
 * - data defaults to {} (sam-tv dispatches handler(data ?? {})).
 * - a window with an empty/missing post is 'unscoreable', never pass/fail.
 */
function replayModule(mod, windows) {
  return windows.map((w) => {
    if (!isScoreable(w)) return 'unscoreable';
    let post;
    try { post = mod.transition(JSON.parse(JSON.stringify(w.pre)), w.action, w.data ?? {}); }
    catch { return 'fail'; }
    if (post === null || typeof post !== 'object') return 'fail';
    return Object.keys(w.post).every((k) => stable(post[k]) === stable(w.post[k])) ? 'pass' : 'fail';
  });
}

/**
 * Enumerate the applicable mutations for a spec over its own reachable graph.
 * Returns { mutants, dropped, notes, adapted, steps }.
 */
// maxStates default is deliberately far below the checker's (a graph is
// enumerated per MUTANT here, twice each via the determinism double-pass;
// equivalence under a cap is already reported as bounded, so a bigger default
// buys grind, not soundness — raise it explicitly for a full-equivalence run).
export function enumerateMutations({ specModule, contract, windows = [], maxStates = 5000, maxMutants = 40 }) {
  if (!isSamV2Module(specModule)) {
    throw new Error('spec must export the v2 SAM surface { instance, init, actions, getState, setState } — the 1.x bare-next module was removed in 8.0.0');
  }
  const adapted = makeSamAdapter(specModule);
  // Alphabet parity with the checker: the module's own manifest domain —
  // mutants and baseline are enumerated over the SAME steps, so a
  // "behaviorally distinct" verdict can never be a domain artifact.
  const { steps, notes } = domainFromManifest(specModule);
  if (!steps.length) throw new Error(`cannot enumerate mutations — the exploration domain is empty${notes.length ? ` (${notes.join('; ')})` : ''}`);
  const baseline = enumerateGraph({ module: adapted, contract }, { maxStates, steps, driftThreshold: Infinity });
  if (baseline.error) throw new Error(`baseline graph failed: ${baseline.error}`);
  // A machine whose own graph is incomplete (throwing steps) or chimeric
  // (nondeterministic union of two explorations) cannot anchor a control —
  // same refusal as the polynv grade. A CAP-TRUNCATED baseline is allowed
  // (unbounded machines are routine) but marks equivalence claims as bounded.
  if (baseline.throws.length || baseline.nondeterministic) {
    throw new Error(`control refused: the reference itself ${baseline.nondeterministic ? 'is nondeterministic' : `throws on ${baseline.throws.length} explored step(s) (first: ${baseline.throws[0].invariant})`} — fix the reference before running a negative control`);
  }
  const { mutants: allMutants, dropped, notes: opNotes } = generateMutants(contract, baseline, { maxMutants });
  // Family filter: verdict-level operators (silence, reason-swap) mutate the
  // REJECTION verdict while leaving every state identical — a trace corpus
  // records no verdicts, so it structurally cannot discriminate them. They
  // are polynv-grade material (killable by rejectionInvariants); running
  // them here would only manufacture impossible blind-spot demands.
  const mutants = allMutants.filter((m) => m.family !== 'verdict');
  const excluded = allMutants.length - mutants.length;
  if (excluded) opNotes.push(`${excluded} verdict-family mutant(s) excluded — a trace corpus cannot discriminate verdict-only faults; grade them with polynv rejectionInvariants`);
  return { mutants, dropped, notes: [...notes, ...opNotes], adapted, steps, baseDigest: graphDigest(baseline, { verdicts: false }), baselineBounded: baseline.capHit, maxStates };
}

/**
 * Apply the listed mutations (all, or the one matching `id`) and replay
 * original + mutant against the corpus. Returns per-mutation reports:
 * { id, describe, originalPassed, mutantPassed, flipped: [windowLabel…] }.
 * A window "flips" when the original passes it and the mutant fails it —
 * the corpus demonstrably discriminates the mutated rule.
 */
export function applyMutations({ specModule, contract, windows, maxStates, maxMutants, id = null }) {
  if (!windows.length) throw new Error('no trace windows — a negative control over an empty corpus proves nothing');
  const { mutants, dropped, notes, adapted, steps, baseDigest, baselineBounded, maxStates: ms } = enumerateMutations({ specModule, contract, windows, maxStates, maxMutants });
  const chosen = id === null ? mutants : mutants.filter((m) => m.id === id);
  if (id !== null && !chosen.length) {
    throw new Error(`no mutation with id '${id}' — run --list for the ${mutants.length} applicable id(s)`);
  }
  const original = replayModule(adapted, windows);
  const scoreable = original.filter((s) => s !== 'unscoreable').length;
  if (!scoreable) throw new Error('every window is unscoreable (empty/missing post) — the corpus measures nothing; fix capture first');
  // Step-3 doctrine: the POSITIVE control must be 100% before a negative
  // control means anything. Refusing here also catches scoring-parity bugs
  // loudly instead of laundering them into "blind spot" verdicts, and makes
  // fail->pass flips (the corpus siding with a MUTANT over the reference — a
  // red flag about the reference) impossible by construction.
  const originalPassed = original.filter((s) => s === 'pass').length;
  if (originalPassed < scoreable) {
    throw new Error(`control refused: the reference passes ${originalPassed}/${scoreable} scoreable window(s) — the positive control must be 100% before a negative control means anything (fix the reference or the corpus first)`);
  }
  const reports = chosen.map((m) => {
    // Wrappers are step-shaped ((step) => (s,a,d) => { state, verdict, reason });
    // the corpus replay only needs the state projection.
    const wrapped = m.wrap(adapted.step.bind(adapted));
    const mutant = { init: adapted.init, step: wrapped, transition: (s, a, d) => wrapped(s, a, d).state };
    // Equivalent-mutant discard (same digest as the polynv grade): a mutant
    // whose reachable graph is identical to the original's is not a rule the
    // corpus FAILED to exercise — no corpus could distinguish it, so calling
    // it a blind spot would send the user chasing an impossible trace. Sound
    // only over COMPLETE graphs (consequences.mjs completeness contract): a
    // cap-truncated comparison is reported as 'equivalent-bounded' — two
    // identical prefixes, NOT proof of equivalence.
    const g = enumerateGraph({ module: mutant, contract }, { maxStates: ms, steps, driftThreshold: Infinity });
    const graphNote = g.error ? `mutant graph enumeration failed (${g.error}) — equivalence undetermined, classified by replay only` : null;
    if (!g.error && !g.throws.length && !g.nondeterministic && graphDigest(g, { verdicts: false }) === baseDigest) {
      const bounded = baselineBounded || g.capHit;
      return { id: m.id, describe: m.describe, status: bounded ? 'equivalent-bounded' : 'equivalent' };
    }
    const mutated = replayModule(mutant, windows);
    const flipped = windows
      .map((w, i) => (original[i] === 'pass' && mutated[i] === 'fail' ? `${w.scenario}#${w.index}` : null))
      .filter(Boolean);
    return {
      id: m.id,
      describe: m.describe,
      status: flipped.length ? 'discriminated' : 'blind-spot',
      originalPassed,
      mutantPassed: mutated.filter((s) => s === 'pass').length,
      flipped,
      ...(graphNote ? { graphNote } : {}),
    };
  });
  return { reports, dropped, notes, windows: windows.length, scoreable };
}

export function renderReports({ reports, dropped, notes, windows, scoreable }) {
  const L = [];
  const denom = scoreable ?? windows;
  if (scoreable !== undefined && scoreable < windows) {
    L.push(`NOTE: ${windows - scoreable} window(s) unscoreable (empty/missing post) — excluded from every count below`);
  }
  for (const r of reports) {
    if (r.status === 'equivalent') {
      L.push(`mutation ${r.id}: behaviorally EQUIVALENT to the original over the full explored graph — no corpus can distinguish it; not a blind spot`);
      continue;
    }
    if (r.status === 'equivalent-bounded') {
      L.push(`mutation ${r.id}: identical to the original over the BOUNDED exploration (cap hit) — indistinguishable within the bound, NOT proof of equivalence; raise --max-states for a full comparison`);
      continue;
    }
    if (r.graphNote) L.push(`NOTE: ${r.graphNote}`);
    if (r.flipped.length) {
      L.push(`mutation ${r.id}: ${r.mutantPassed}/${denom} (original ${r.originalPassed}/${denom}); ${r.flipped.length} window(s) flipped — the corpus discriminates this rule ✓`);
      L.push(`  flipped: ${r.flipped.join(', ')}`);
    } else {
      L.push(`mutation ${r.id}: ⚠️ ZERO windows flipped (original ${r.originalPassed}/${denom}, mutant ${r.mutantPassed}/${denom}) — no captured trace exercises this rule; a real regression here would replay CLEAN. Corpus blind spot: capture a trace that drives '${r.describe}' before trusting a clean replay.`);
    }
  }
  if (dropped) L.push(`NOTE: ${dropped} mutation(s) dropped by --max-mutants — this control covers a SUBSET of the operator space`);
  for (const n of notes) L.push(`NOTE: ${n}`);
  return L.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const BOOLEAN_FLAGS = new Set(['list', 'all']);
  const args = {};
  try {
    for (let i = 2; i < process.argv.length; i++) {
      if (!process.argv[i].startsWith('--')) throw new Error(`unexpected argument '${process.argv[i]}'`);
      const key = process.argv[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) { args[key] = true; continue; }
      const nxt = process.argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) throw new Error(`missing value for --${key}`);
      args[key] = nxt; i++;
    }
    if (!args.spec || !args.contract) throw new Error('missing --spec / --contract');
    const modes = ['list', 'all', 'apply'].filter((m) => args[m]);
    if (modes.length !== 1) throw new Error('choose exactly one of --list | --apply <id> | --all');
    if (!args.list && !args.traces) throw new Error('--apply/--all need --traces (the corpus is what a negative control measures)');
    // NaN here would silently explore nothing / generate nothing — a wrong-
    // looking result instead of a usage error.
    for (const k of ['max-states', 'max-mutants']) {
      if (args[k] !== undefined && (!Number.isInteger(Number(args[k])) || Number(args[k]) <= 0)) {
        throw new Error(`--${k} must be a positive integer (got '${args[k]}')`);
      }
    }
  } catch (e) {
    console.error(`[mutate] ${e.message}`);
    console.error('usage: mutate.mjs --spec <mod.js> --contract <c.json> (--list [--traces <dir>] | --apply <mutation-id> --traces <dir> | --all --traces <dir>) [--max-states N (default 5000)] [--max-mutants N]');
    process.exit(2);
  }
  try {
    const specModule = loadSpec(args.spec);
    const contract = JSON.parse(readFileSync(args.contract, 'utf-8'));
    const windows = args.traces ? loadWindows(args.traces) : [];
    const common = {
      specModule, contract, windows,
      ...(args['max-states'] ? { maxStates: Number(args['max-states']) } : {}),
      ...(args['max-mutants'] ? { maxMutants: Number(args['max-mutants']) } : {}),
    };
    if (args.list) {
      const { mutants, dropped, notes } = enumerateMutations(common);
      for (const m of mutants) console.log(`${m.id}\n  ${m.describe}`);
      if (dropped) console.log(`NOTE: ${dropped} mutation(s) dropped by --max-mutants`);
      for (const n of notes) console.log(`NOTE: ${n}`);
      if (!mutants.length) { console.error('[mutate] no applicable mutations (see notes)'); process.exit(1); }
      process.exit(0);
    }
    const result = applyMutations({ ...common, id: args.apply ?? null });
    console.log(renderReports(result));
    // Exit contract: a control that cannot fail is a failed control —
    // exit 1 when any DISTINGUISHABLE mutation flipped zero windows.
    process.exit(result.reports.some((r) => r.status === 'blind-spot') ? 1 : 0);
  } catch (e) {
    console.error(`[mutate] ${e.message}`);
    process.exit(1);
  }
}
