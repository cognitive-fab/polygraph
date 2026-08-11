// polynv M2 tests — the mutation adequacy grade. node:test, deterministic,
// no API key. Run: node --test polynv/test/m2.test.mjs
//
// The worked example doubles as operator calibration (decision §10.4): the
// OMS order machine with its KNOWN-GOOD hand-written invariants must kill a
// solid majority of behaviorally distinct mutants; an empty invariant set
// must kill none.
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadArtifacts } from '../../polyvers/src/artifacts.mjs';
import { enumerateGraph } from '../src/consequences.mjs';
import { adaptedOf, generateMutants, generateSchemaMutants, weakenSchemaInSource, runGrade, survivorCandidates } from '../src/grade.mjs';
import { mergeCandidates, applyDisposition } from '../src/ledger.mjs';
import { harvestTemplates } from '../src/templates.mjs';
import { precheckRecord } from '../src/precheck.mjs';
import { openQuestions } from '../src/questions.mjs';
import { buildStatus } from '../src/report.mjs';
import { buildReport, renderReport } from '../../polyvers/src/report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'bin', 'polynv.mjs');
const orderV1 = join(here, '..', '..', 'examples', 'polyvers-oms', 'order-v1');

const { domainFromManifest } = (await import('../../scripts/sam-adapter.cjs')).default;
const artifacts = await loadArtifacts(orderV1);
const adapted = adaptedOf(artifacts.module);
// The v2 module explores through the adapter with its own manifest domain;
// an already-adapted relation would need an explicit steps domain.
const baseline = enumerateGraph(artifacts);

const DATE = '2026-07-18T00:00:00.000Z';

// The fixture's hand-written invariants as a LIVE oracle (closures intact —
// a toString round-trip would strip `same`/`TERMINAL`/`AWAITS` and kill
// every mutant spuriously). This is the known-good set for calibration.
const handWrittenOracle = () => [
  ...artifacts.invariants.map((inv) => ({ id: `hand:state:${inv.name}`, target: 'state', pred: inv.pred })),
  ...artifacts.transitionInvariants.map((inv) => ({ id: `hand:trans:${inv.name}`, target: 'transition', pred: inv.pred })),
];
const emptyLedger = () => ({ format: 'polynv-ledger/1', records: [] });

// ── operators ───────────────────────────────────────────────────────────────

test('generateMutants: all six operator families (relation + verdict), stable ids, honest cap', () => {
  const { mutants, dropped } = generateMutants(artifacts.contract, baseline, { maxMutants: 1000 });
  const fams = new Set(mutants.map((m) => m.id.split(':')[0]));
  assert.deepEqual([...fams].sort(), ['drop', 'freeze', 'reason-swap', 'retarget', 'silence', 'widen']);
  assert.equal(dropped, 0);
  // Verdict family is per (action, REASON) — a guard is one fault however
  // many states it fires in — so it must stay far smaller than per-pair
  // enumeration would make it.
  const verdictCount = mutants.filter((m) => m.family === 'verdict').length;
  const relationCount = mutants.filter((m) => m.family === 'relation').length;
  assert.ok(verdictCount > 0 && verdictCount <= relationCount,
    `verdict family (${verdictCount}) should not dominate relation (${relationCount})`);
  const capped = generateMutants(artifacts.contract, baseline, { maxMutants: 5 });
  assert.equal(capped.mutants.length, 5);
  assert.equal(capped.dropped, mutants.length - 5);
});

// ── verdict family (SAM-v2 audit #3, phase A) ───────────────────────────────

test('verdict mutants: killable ONLY by rejection invariants; vacuous oracles are excluded', () => {
  // Correct obligations for this machine: SUBMIT out of fraudCheck must
  // REJECT, and SUBMIT rejections must never carry a swapped reason.
  const rejOracle = [
    { id: 'rej:submit-fraudcheck-rejects', target: 'rejection', pred: (s, a, d, v) => !(a === 'SUBMIT' && s.orderState === 'fraudCheck') || (v && v.rejected) },
    { id: 'rej:submit-reason-known', target: 'rejection', pred: (s, a, d, v) => a !== 'SUBMIT' || !v || !v.rejected || !String(v.reason ?? '').endsWith('__wrong') },
  ];
  const g = runGrade(artifacts, emptyLedger(), { maxMutants: 1000, extraOracle: rejOracle });
  const survivors = new Set(g.survivors.map((x) => x.id));
  // The targeted verdict mutants die to the rejection oracle...
  assert.ok(!survivors.has('silence:SUBMIT:amend-resets-rollup'), 'silence:SUBMIT must be killed by the rejection obligation');
  assert.ok(!survivors.has('reason-swap:SUBMIT:amend-resets-rollup'), 'reason-swap:SUBMIT must be killed by the reason check');
  // ...while unrelated guards SURVIVE — kills are earned, not inherited.
  assert.ok([...survivors].some((x) => x.startsWith('silence:CANCEL')), 'unconstrained guards must survive');
  // Without the rejection oracle the same mutants survive: state/transition
  // invariants structurally cannot see them.
  const g0 = runGrade(artifacts, emptyLedger(), { maxMutants: 1000, extraOracle: handWrittenOracle() });
  const s0 = new Set(g0.survivors.map((x) => x.id));
  assert.ok(s0.has('silence:SUBMIT:amend-resets-rollup'), 'without rejection invariants, silence survives');
  // A survivor from the verdict family elicits a REJECTION-shaped question.
  const cands = survivorCandidates(g0);
  const verdictCand = cands.find((c) => c.id.startsWith('mutation-survivor:silence:'));
  assert.ok(verdictCand && verdictCand.target === 'rejection', 'verdict survivors target rejection');
  // Baseline sanity: an oracle entry the machine itself violates is EXCLUDED
  // loudly instead of killing every mutant vacuously.
  const bad = runGrade(artifacts, emptyLedger(), { maxMutants: 40, extraOracle: [
    { id: 'rej:wrong-about-machine', target: 'rejection', pred: (s, a, d, v) => !(a === 'SUBMIT' && s.orderState !== 'pending') || (v && v.rejected && v.reason === 'already-submitted') },
  ] });
  assert.ok(bad.notes.some((n) => /violated by the MACHINE ITSELF/.test(n)));
  assert.equal(bad.killed, 0);
});

// ── schema family (SAM-v2 audit #3, phase B) ────────────────────────────────

test('schema-weaken: source-level mutants, probe-based distinctness, honest skips', () => {
  const { schemaMutants, notes } = generateSchemaMutants(artifacts, domainFromManifest(artifacts.module).steps);
  // Every required field either yields a mutant or a note — no silent caps.
  assert.ok(schemaMutants.length >= 5, `expected the OMS machine's required fields to enumerate (got ${schemaMutants.length})`);
  assert.ok(schemaMutants.every((m) => m.family === 'schema' && m.probes.length > 0 && typeof m.source === 'string'));
  // The rewrite is scoped: weakening SUBMIT.totalCents must not touch AMEND's
  // identically-named field.
  const weakened = weakenSchemaInSource(artifacts.moduleSource, 'SUBMIT', 'totalCents');
  assert.ok(weakened !== null);
  const submitBlock = weakened.slice(weakened.indexOf('SUBMIT'), weakened.indexOf('FRAUD_PASSED'));
  const amendBlock = weakened.slice(weakened.indexOf('AMEND'));
  assert.ok(!/totalCents:\s*\{[^}]*required:\s*true/.test(submitBlock), 'SUBMIT.totalCents must be weakened');
  assert.ok(/totalCents:\s*\{[^}]*required:\s*true/.test(amendBlock), "AMEND.totalCents must be untouched");
  // An unknown field is a null, not a guess.
  assert.equal(weakenSchemaInSource(artifacts.moduleSource, 'SUBMIT', 'noSuchField'), null);
  // End-to-end: the family enters the grade; distinct schema mutants are
  // survivors-or-killed with witnesses naming the malformed dispatch.
  const g = runGrade(artifacts, emptyLedger(), { maxMutants: 1000, extraOracle: handWrittenOracle() });
  assert.ok(g.families.schema >= 5, 'schema family must be measured');
  const schemaSurvivors = g.survivors.filter((x) => x.id.startsWith('schema-weaken:'));
  for (const x of schemaSurvivors) {
    assert.ok(x.witness && x.witness.action && x.witness.note, `${x.id} must carry a malformed-dispatch witness`);
  }
});

// ── the grade: calibration against the known-good oracle ────────────────────

test('runGrade: hand-written invariants kill a solid majority; empty set kills none', () => {
  const g = runGrade(artifacts, emptyLedger(), { maxMutants: 1000, extraOracle: handWrittenOracle() });
  assert.ok(g.distinct >= 10, `only ${g.distinct} distinct mutants`);
  assert.ok(g.killed / g.distinct >= 0.6, `known-good invariants kill only ${g.killed}/${g.distinct} — operator set or oracle wiring is off`);
  assert.equal(g.killed + g.survivors.length, g.distinct);
  // survivors carry concrete witnesses
  for (const s of g.survivors) assert.ok(s.witness && s.witness.action, s.id);

  const g0 = runGrade(artifacts, emptyLedger(), { maxMutants: 1000 });
  assert.equal(g0.killed, 0, 'an empty invariant set must kill nothing');
  assert.equal(g0.distinct, g.distinct, 'the denominator must not depend on the oracle');
});

test('runGrade: equivalent mutants are discarded by graph comparison', () => {
  const g = runGrade(artifacts, emptyLedger(), { maxMutants: 1000 });
  // freeze on a field some action updates is distinct; equivalents (if any)
  // never inflate the denominator: distinct + equivalent + harness = total
  assert.equal(g.distinct + g.equivalent + g.harnessKilled, g.total);
});

// ── the dialog integration: profiles, survivors, ranking, convergence ───────

test('grade profiles open candidates and ranks hypothesis-splitters first', () => {
  const ledger = emptyLedger();
  // add open template candidates and pre-check them (the M0 flow)
  const { candidates } = harvestTemplates(artifacts.contract, artifacts.manifest);
  mergeCandidates(ledger, candidates, { date: DATE });
  const graph = enumerateGraph(artifacts);
  for (const r of ledger.records.filter((x) => x.status === 'open')) precheckRecord(r, artifacts, { date: DATE, graph });

  const g = runGrade(artifacts, ledger, { maxMutants: 1000, extraOracle: handWrittenOracle() });
  const open = ledger.records.filter((r) => r.status === 'open');
  assert.ok(open.some((r) => r.grade), 'open candidates must be profiled');

  // survivor questions merge into the ledger and rank at the top tier
  mergeCandidates(ledger, survivorCandidates(g), { date: DATE });
  for (const r of ledger.records.filter((x) => x.source === 'mutation-survivor')) {
    r.precheck = { verdict: 'NOT-RUN', note: 'no predicate yet', date: DATE };
  }
  const ranked = openQuestions(ledger);
  const firstSurvivor = ranked.findIndex((r) => r.source === 'mutation-survivor' || r.grade?.newKills > 0);
  const firstPlainHolds = ranked.findIndex((r) => r.precheck?.verdict === 'HOLDS' && !(r.grade?.newKills > 0));
  if (firstSurvivor >= 0 && firstPlainHolds >= 0) assert.ok(firstSurvivor < firstPlainHolds, 'hypothesis-splitting questions must precede plain HOLDS questions');

  // a survivor question cannot be confirmed without a predicate — modify first
  const surv = ledger.records.find((r) => r.source === 'mutation-survivor');
  if (surv) {
    assert.throws(() => applyDisposition(ledger, { id: surv.id, disposition: 'confirm', author: 'jj' }, { date: DATE }), /no predicate/);
    applyDisposition(ledger, { id: surv.id, disposition: 'abandon', author: 'jj', concern: 'out of intent for this machine' }, { date: DATE });
    assert.equal(ledger.records.find((r) => r.id === surv.id).status, 'abandoned');
  }

  // convergence now sees the grade
  const s = buildStatus(ledger);
  assert.ok(s.graded);
  assert.match(s.adequacyGrade, /kills \d+\/\d+/);
});

// ── polyvers integration: the disclosed trust tier ──────────────────────────

test('compat-report carries the adequacy line, measured or not', () => {
  const classification = { changeId: 'c1', oldVersion: 'a', newVersion: 'b', lanes: ['semantic'], deferred: [], diffs: { vocabulary: { changed: false }, shape: { changed: false }, intent: { changed: false } } };
  const base = { classification, corpusInfo: { source: 'test', count: 1 }, gateResults: [{ gate: 'g', ok: true, summary: 's', failures: [] }] };

  const unmeasured = renderReport(buildReport(base));
  assert.match(unmeasured, /Invariant adequacy:\*\* NOT MEASURED/);

  const measured = renderReport(buildReport({ ...base, adequacy: { measured: true, killed: 14, distinct: 20, survivors: 6 } }));
  assert.match(measured, /kills 14\/20 behaviorally distinct machine mutant\(s\)/);
  assert.match(measured, /6 unconstrained behavior class\(es\) open/);
});

// ── CLI end-to-end ──────────────────────────────────────────────────────────

test('cli: grade writes the ledger grade, adds survivor questions, report converges only after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polynv-m2-'));
  cpSync(orderV1, dir, { recursive: true });
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { encoding: 'utf-8' });

  run('harvest', '--artifacts', dir);
  const g = run('grade', '--artifacts', dir);
  assert.match(g, /kills \d+\/\d+ behaviorally distinct/);
  const ledger = JSON.parse(readFileSync(join(dir, 'intent-ledger.json'), 'utf-8'));
  assert.ok(ledger.grade);
  assert.ok(ledger.grade.distinct > 0);
  // with zero confirmed rules, every distinct mutant survives and becomes a question
  assert.equal(ledger.grade.killed, 0);
  assert.ok(ledger.records.some((r) => r.source === 'mutation-survivor'));

  rmSync(dir, { recursive: true, force: true });
});
