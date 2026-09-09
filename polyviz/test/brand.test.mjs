// Branding is configurable (spec §4.12): the wordmark and tagline are defaults,
// not constants. Precedence is defaults < model.meta/annotations < CLI flags,
// and --no-brand renders no footer row at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderInvariants } from '../src/diagrams/invariants.mjs';
import { renderCompat } from '../src/diagrams/compat.mjs';
import { loadTheme } from '../src/render/theme.mjs';
import { DEFAULT_BRAND, DEFAULT_FOOTER, applyBrandOverrides, brandOf } from '../src/brand.mjs';
import { fixture, ROOT } from './helpers.mjs';

const tokens = loadTheme('dark');

function withMeta(meta) {
  const model = fixture();
  return { ...model, meta: { ...model.meta, ...meta } };
}

test('a model with no brand meta gets the built-in defaults', async () => {
  const model = fixture();
  delete model.meta.brand;
  delete model.meta.footer;
  const { svg } = await renderInvariants(model, { tokens });
  assert.ok(svg.includes(DEFAULT_BRAND));
  assert.ok(svg.includes(DEFAULT_FOOTER));
});

test('the shipped default tagline is the Cognitive Fab one', () => {
  assert.equal(DEFAULT_FOOTER, 'Provable Trust');
  assert.equal(brandOf({}).footer, 'Provable Trust');
});

test('meta.brand / meta.footer replace the defaults', async () => {
  const { svg } = await renderInvariants(
    withMeta({ brand: 'ACME · QA', footer: 'ship it twice' }), { tokens });
  assert.ok(svg.includes('ACME · QA'));
  assert.ok(svg.includes('ship it twice'));
  assert.ok(!svg.includes(DEFAULT_BRAND));
  assert.ok(!svg.includes(DEFAULT_FOOTER));
});

test('empty strings suppress each line independently', async () => {
  const { svg } = await renderInvariants(withMeta({ brand: '', footer: 'just a tagline' }), { tokens });
  assert.ok(!svg.includes(DEFAULT_BRAND));
  assert.ok(svg.includes('just a tagline'));
});

test('every diagram honours the override, not just one', async () => {
  const model = withMeta({ brand: 'ACME · QA', footer: 'ship it twice' });
  for (const render of [renderInvariants, renderCompat]) {
    const { svg } = await render(model, { tokens });
    assert.ok(svg.includes('ACME · QA'));
    assert.ok(!svg.includes(DEFAULT_FOOTER));
  }
});

test('applyBrandOverrides beats meta, and --no-brand beats everything', () => {
  const model = withMeta({ brand: 'FROM META', footer: 'from meta' });
  assert.equal(applyBrandOverrides(model, { brand: 'FROM CLI' }).meta.brand, 'FROM CLI');
  assert.equal(applyBrandOverrides(model, { brand: 'FROM CLI' }).meta.footer, 'from meta');
  const stripped = applyBrandOverrides(model, { noBrand: true });
  assert.equal(stripped.meta.brand, '');
  assert.equal(stripped.meta.footer, '');
  // an explicit --brand alongside --no-brand still wins: you asked for it by name
  assert.equal(applyBrandOverrides(model, { noBrand: true, brand: 'X' }).meta.brand, 'X');
});

test('applyBrandOverrides never mutates the caller model', () => {
  const model = withMeta({ brand: 'FROM META' });
  const out = applyBrandOverrides(model, { brand: 'FROM CLI' });
  assert.equal(model.meta.brand, 'FROM META');
  assert.notEqual(out, model);
  assert.equal(applyBrandOverrides(model, {}), model, 'no overrides → same object');
});

test('--no-brand renders no footer row', async () => {
  const model = applyBrandOverrides(fixture(), { noBrand: true });
  const { svg } = await renderInvariants(model, { tokens });
  assert.ok(!svg.includes(DEFAULT_BRAND));
  assert.ok(!svg.includes(DEFAULT_FOOTER));
  assert.ok(!svg.includes("verify, don't review"));
});

// --- repo guards: the retired tagline stays retired, and the live one has one home.

const REPO = join(ROOT, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'out']);
const SCAN_EXT = ['.mjs', '.cjs', '.js', '.json', '.jsonc', '.md', '.svg'];
const RETIRED = "verify, don't review"; // Polygraph's line, never the footer tagline

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test('the retired tagline appears nowhere in polyviz or its example figures', () => {
  const roots = [ROOT, join(REPO, 'examples')];
  const offenders = [];
  for (const root of roots) {
    for (const f of walk(root)) {
      if (f.endsWith('brand.test.mjs')) continue; // this file names the string on purpose
      const body = readFileSync(f, 'utf8');
      if (body.includes(RETIRED) || body.includes(RETIRED.replace("'", '&#39;'))) {
        offenders.push(relative(REPO, f));
      }
    }
  }
  assert.deepEqual(offenders, [], `retired tagline still present in: ${offenders.join(', ')}`);
});

test('brand strings live only in src/brand.mjs', () => {
  const offenders = walk(join(ROOT, 'src'))
    .filter((f) => !f.endsWith('brand.mjs'))
    .filter((f) => {
      const body = readFileSync(f, 'utf8');
      return body.includes(DEFAULT_BRAND) || body.includes(DEFAULT_FOOTER);
    })
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, [], `hard-coded brand text in: ${offenders.join(', ')}`);
});
