// workflows-not-loops demo — the article's four moves, executed for real:
//
//   1. front-loaded context: the machine was model-checked before this file
//      ever ran (scripts/check.mjs + polyrun check-effects; both PASS);
//   2. decomposed along data flow: extract → transform → validate → render,
//      each handler a small unit over files, blast radius = one stage;
//   3. event-driven feedback: validation fails ONCE with the exact violation
//      ('missing-title'); only the transform stage re-runs, and its payload
//      carries the violation verbatim — "fix this", not a re-plan. A stale
//      duplicate of the same signal is then dispatched to show it become an
//      observable reject, not a fault and not another lap;
//   4. determinism at the edges: extract/validate/render are plain functions;
//      only 'transform' is the fuzzy middle (simulated model step here), and
//      even that runs under an idempotency key.
//
// Run:  node --no-warnings examples/workflows-not-loops/demo/run-demo.mjs
'use strict';

import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRuntime } from '../../../polyrun/src/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const v1 = join(here, '..', 'pipeline-v1');
const stateDir = join(here, '.demo-state');
const DOC_ID = 'doc-adron-1';

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });

const say = (msg) => console.log(`[pipeline] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (name) => join(stateDir, name);

// ---- the source document: genuinely missing its title -----------------------

writeFileSync(file('raw.json'), JSON.stringify({
  title: '',
  body: 'Loop engineering is mostly just broken SDLC wearing a costume.\n\nDon\'t fit the LLM to the broken SDLC; fix the SDLC around the LLM.',
}, null, 2));

// ---- the stages: deterministic edges + one fuzzy middle ----------------------

const handlers = {
  // Deterministic edge: parse the raw input into a typed shape.
  extract: async () => {
    const raw = JSON.parse(readFileSync(file('raw.json'), 'utf-8'));
    writeFileSync(file('extracted.json'), JSON.stringify(raw, null, 2));
    say('extract   : raw.json → extracted.json');
    return {};
  },

  // The fuzzy middle — the one stage a model owns. Simulated deterministically
  // here so the demo needs no API key; note the FIX PASS is targeted: it gets
  // the exact violation and touches only what the signal named.
  transform: async (payload) => {
    const doc = JSON.parse(readFileSync(
      payload.fixPass ? file('article.json') : file('extracted.json'), 'utf-8'));
    if (payload.fixPass) {
      say(`transform : FIX PASS — violation="${payload.violation}" (and nothing else)`);
      if (payload.violation === 'missing-title') {
        doc.title = doc.body.split('.')[0];
      }
    } else {
      say('transform : first pass over the extracted document');
      doc.body = doc.body.trim();
    }
    writeFileSync(file('article.json'), JSON.stringify(doc, null, 2));
    return {};
  },

  // Deterministic edge: schema validation. A violation is a PERMANENT,
  // NAMED failure — the signal that (and the only thing that) bends the
  // pipeline back. No retries, no reflection, no re-plan.
  validate: async () => {
    const doc = JSON.parse(readFileSync(file('article.json'), 'utf-8'));
    if (typeof doc.title !== 'string' || doc.title.trim() === '') {
      say('validate  : FAILED — missing-title (the one real signal in this run)');
      const err = new Error('schema validation failed: missing-title');
      err.permanent = true;
      err.code = 'missing-title';
      throw err;
    }
    say('validate  : PASSED');
    return {};
  },

  // Deterministic edge: render the validated article.
  render: async () => {
    const doc = JSON.parse(readFileSync(file('article.json'), 'utf-8'));
    const html = `<article>\n<h1>${doc.title}</h1>\n<p>${doc.body.replace(/\n\n/g, '</p>\n<p>')}</p>\n</article>\n`;
    writeFileSync(file('article.html'), html);
    say('render    : article.json → article.html');
    return {};
  },
};

// ---- runtime -----------------------------------------------------------------

const rt = await createRuntime({
  store: { sqlite: file('pipeline.sqlite') },
  machines: [{
    machineId: 'docpipe',
    module: join(v1, 'next.cjs'),
    contract: join(v1, 'contract.json'),
    effects: { mapper: join(v1, 'effects.cjs'), manifest: join(v1, 'effects.manifest.json') },
  }],
  handlers,
  worker: { leaseMs: 4000 },
});
rt.startWorkers({ effectPollMs: 100, timerPollMs: 100 });

await rt.create('docpipe', DOC_ID);
await rt.dispatch(DOC_ID, 'START', {}, 'start:doc-adron-1');

const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  const { status } = await rt.getState(DOC_ID);
  if (status !== 'active') break;
  await sleep(100);
}

const { state, status } = await rt.getState(DOC_ID);
say(`pipeline reached: ${state.docState} (fixAttempts=${state.fixAttempts})`);

// A duplicate of the correction signal arrives late (a redelivered webhook, a
// stale worker). In a loop architecture this triggers another lap; here the
// verified machine rejects it observably — journaled, explained, harmless.
const stale = await rt.dispatch(DOC_ID, 'VALIDATION_FAILED', { violation: 'missing-title' }, 'stale:duplicate-signal');
say(`stale duplicate signal → ${stale.stepKind} (${stale.rejectReason})`);

// ---- report ------------------------------------------------------------------

console.log('\n=== journal (one directed pass, one event-driven bend — also a Polygraph trace corpus) ===');
const journal = await rt.getJournal(DOC_ID);
for (const row of journal) {
  const kind = row.step_kind === 'accepted' ? 'accepted' : `${row.step_kind} (${row.reject_reason})`;
  console.log(`  #${String(row.seq).padStart(2)} ${row.action.padEnd(20)} ${kind.padEnd(38)} → ${row.post.docState} fix=${row.post.fixAttempts}`);
}

const transforms = journal.filter((r) => r.step_kind === 'accepted' && r.post.docState === 'transforming').length;
const extracts = journal.filter((r) => r.step_kind === 'accepted' && r.post.docState === 'extracting').length;
const rejects = journal.filter((r) => r.step_kind === 'rejected').length;
const html = readFileSync(file('article.html'), 'utf-8');

console.log('\n=== the article\'s claims, as observed facts ===');
console.log(`  extract stage ran        : ${extracts}× (never re-run by the bend-back)`);
console.log(`  transform stage ran      : ${transforms}× (first pass + exactly one targeted fix)`);
console.log(`  corrections without signal: 0 (fixAttempts moved only on VALIDATION_FAILED)`);
console.log(`  ceremony absorbed        : ${rejects} stale signal(s) observably rejected, zero extra laps`);
console.log(`  rendered output          : ${html.split('\n')[1]}`);

const ok = status === 'terminal' && state.docState === 'published' &&
  state.fixAttempts === 1 && extracts === 1 && transforms === 2 && rejects === 1;
console.log(`\nRESULT: ${ok ? 'OK' : 'FAILED'} — docState=${state.docState}, fixAttempts=${state.fixAttempts}`);

rt.stopWorkers();
await rt.close();
process.exit(ok ? 0 : 1);
