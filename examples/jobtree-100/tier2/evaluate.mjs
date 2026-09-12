import fs from 'node:fs';

const canon = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
const compile = (js) => new Function('canon', `return (${js});`)(canon);

function loadWindows(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    for (const l of fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n')) {
      const w = JSON.parse(l); w._f = f; out.push(w);
    }
  }
  return out;
}

const pre = loadWindows('/home/claude/study/traces');        // BROKEN implementation
const fix = loadWindows('/home/claude/study/traces-fixed');  // FIXED implementation

// does the predicate hold across every window in a corpus?
function holds(c, wins) {
  let fn;
  try { fn = compile(c.js); } catch { return { ok: null, why: 'uncompilable' }; }
  for (const w of wins) {
    try {
      if (c.target === 'state') {
        for (const s of [w.pre, w.post]) if (fn(s) !== true) return { ok: false, at: `${w._f}:${w.action}` };
      } else {
        if (fn(w.pre, w.action, w.data, w.post) !== true) return { ok: false, at: `${w._f}:${w.action}` };
      }
    } catch { return { ok: null, why: 'threw' }; }
  }
  return { ok: true };
}

const all = [];
for (const f of ['cand_0.json', 'cand_1.json', 'cand_2.json']) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(f, 'utf8').trim().replace(/^```(json)?\n?|```$/g, '')); }
  catch (e) { console.log('!! could not parse', f, e.message); continue; }
  for (const c of arr) all.push({ ...c, _src: f });
}

const buckets = { CATCHES: [], BENIGN: [], TOO_STRONG: [], ODD: [], BROKEN: [] };
for (const c of all) {
  const a = holds(c, pre), b = holds(c, fix);
  if (a.ok === null || b.ok === null) { buckets.BROKEN.push([c, a, b]); continue; }
  if (a.ok === false && b.ok === true) buckets.CATCHES.push([c, a, b]);
  else if (a.ok === true && b.ok === true) buckets.BENIGN.push([c, a, b]);
  else if (a.ok === false && b.ok === false) buckets.TOO_STRONG.push([c, a, b]);
  else buckets.ODD.push([c, a, b]);
}

console.log(`total candidates: ${all.length}  (${['cand_0.json','cand_1.json','cand_2.json'].map(f=>all.filter(c=>c._src===f).length).join(' + ')})`);
console.log();
console.log(`CATCHES THE BUG  (fails on broken, holds on fixed) : ${buckets.CATCHES.length}`);
console.log(`benign           (holds on both)                   : ${buckets.BENIGN.length}`);
console.log(`too strong       (fails on both)                   : ${buckets.TOO_STRONG.length}`);
console.log(`odd              (holds broken, fails fixed)       : ${buckets.ODD.length}`);
console.log(`unusable         (threw / uncompilable)            : ${buckets.BROKEN.length}`);
console.log();
console.log('════════ CANDIDATES THAT CATCH THE DEFECT ════════');
for (const [c, a] of buckets.CATCHES) {
  console.log(`\n[${c._src}] ${c.id}  (${c.kind}, ${c.target})`);
  console.log(`  q: ${c.question}`);
  console.log(`  js: ${c.js}`);
  console.log(`  first violation on broken corpus: ${a.at}`);
}
console.log('\n════════ TOO STRONG (would be false alarms) ════════');
for (const [c] of buckets.TOO_STRONG) console.log(`  [${c._src}] ${c.id}: ${c.js.slice(0,120)}`);
