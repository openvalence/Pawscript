import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/lib/core/script.js';
import { GENERIC, findProblems, compare } from '../src/lib/analyze/index.js';
import * as P from '../src/features/review/logic/problems.js';
import * as F from '../src/features/review/logic/fixes.js';
import * as C from '../src/features/review/logic/charts.js';
import * as K from '../src/features/review/logic/compare.js';
import * as D from '../src/features/review/logic/profiles.js';

const prof = { ...GENERIC, maxSpeed: 300, minIntervalMs: 80, range: [0, 100] };
const stroke = (n, step = 400, t = 0) => Array.from({ length: n }, (_, i) => ({ at: t + i * step, pos: i % 2 ? 10 : 90 }));
const find = (s) => findProblems(s, prof);
const norm = (s) => P.normalizeProblems(find(s), 'stroke');
const seeded = () => normalize([...stroke(10), { at: 4000, pos: 0 }, { at: 4050, pos: 100 }, ...stroke(10, 400, 6000),
  { at: 10000, pos: 50 }, { at: 10300, pos: 50 }, { at: 10600, pos: 50 }, { at: 11000, pos: 90 }, ...stroke(10, 400, 20000)]);

test('real finder sees speed, closeness, gaps, redundancy', () => {
  const k = norm(seeded()).map((p) => p.kind);
  for (const x of ['speed-limit', 'too-close', 'long-gap', 'redundant']) assert.ok(k.includes(x), x + ' in ' + k);
});

test('ids are stable under edits elsewhere and unique for same start', () => {
  const s = seeded(), a = norm(s);
  const b = norm(normalize([...s, { at: 99000, pos: 50 }, { at: 99400, pos: 5 }]));
  const d = P.diffProblems(a.filter((p) => p.kind !== 'long-gap'), b.filter((p) => p.kind !== 'long-gap'));
  assert.equal(d.removed.length, 0);
  assert.ok(d.added.every((p) => p.t0 >= 20000));
  const dup = P.normalizeProblems([{ kind: 'x', t0: 5 }, { kind: 'x', t0: 5 }], 'a');
  assert.notEqual(dup[0].id, dup[1].id);
});

test('changedRange: equal, insert, delete, edit', () => {
  const s = stroke(50);
  assert.equal(P.changedRange(s, s.slice()), null);
  const [a, b] = P.changedRange(s, normalize([...s, { at: 1000, pos: 55 }]));
  assert.ok(a <= 1000 && b >= 1000 && b - a < 1500);
  const r = P.changedRange(s, s.filter((x) => x.at !== 4000)); assert.ok(r[0] <= 4000 && r[1] >= 4000);
  assert.deepEqual(P.changedRange(s, s.map((x, i) => (i === 7 ? { ...x, pos: 55 } : x))), [2400, 3200]);
});

test('incremental update equals a full recompute', () => {
  const big = []; for (let i = 0; i < 6000; i++) big.push({ at: i * 300, pos: i % 2 ? 5 : 95 });
  const idx = new P.ProblemIndex(find, { minPartial: 100 });
  idx.update('stroke', big, prof, 'k');
  let cur = big;
  const edits = [(s) => s.map((a, i) => (i === 3000 ? { at: a.at, pos: 50 } : a)), (s) => s.filter((a) => a.at < 900000 || a.at > 900100),
    (s) => normalize([...s, { at: 1000001, pos: 0 }, { at: 1000030, pos: 100 }]), (s) => s.filter((a) => a.at < 1500000 || a.at > 1503000)];
  for (const edit of edits) {
    cur = edit(cur);
    const inc = idx.update('stroke', cur, prof, 'k'), full = norm(cur);
    assert.deepEqual(inc.map((p) => p.id), full.map((p) => p.id));
  }
  assert.ok(idx.stats.partial >= 3, JSON.stringify(idx.stats));
  assert.ok(idx.update('stroke', cur, { ...prof, maxSpeed: 50 }, 'k2').length > 0);
});

test('filter, sort, ignore, counts, neighbour', () => {
  const list = P.normalizeProblems([
    { kind: 'speed-limit', severity: 'error', t0: 3000, message: 'Speed 500' }, { kind: 'long-gap', severity: 'info', t0: 1000, t1: 9000, message: 'gap 8s' },
    { kind: 'too-close', severity: 'warning', t0: 2000, message: 'close' }], 'stroke');
  assert.equal(list[0].kind, 'long-gap');
  const f = P.defaultFilter();
  assert.equal(P.filterProblems(list, f, null).length, 3);
  assert.equal(P.filterProblems(list, { ...f, severities: ['error'] }, null).length, 1);
  assert.equal(P.filterProblems(list, { ...f, kinds: ['long-gap', 'too-close'] }, null).length, 2);
  assert.equal(P.filterProblems(list, { ...f, q: 'SPEED' }, null)[0].kind, 'speed-limit');
  assert.deepEqual(P.sortProblems(list, 'severity').map((p) => p.kind), ['speed-limit', 'too-close', 'long-gap']);
  assert.equal(P.sortProblems(list, 'length')[0].kind, 'long-gap');
  let ig = P.ignoreKind(P.emptyIgnore(), 'long-gap');
  assert.equal(P.filterProblems(list, f, ig).length, 2);
  assert.equal(P.filterProblems(list, { ...f, showIgnored: true }, ig).length, 3);
  ig = P.ignoreId(ig, list[1].id);
  assert.equal(P.countBy(list, ig).total, 1);
  assert.equal(P.pruneIgnore(ig, [list[0]]).ids.length, 0);
  assert.equal(P.ignoreKind(ig, 'long-gap', false).kinds.length, 0);
  const s = P.sortProblems(list);
  assert.equal(P.neighbour(s, 1500, 1).kind, 'too-close');
  assert.equal(P.neighbour(s, 3000, 1).kind, 'long-gap', 'wraps');
  assert.equal(P.neighbour(s, 2000, -1).kind, 'long-gap');
  assert.equal(P.neighbour(s, 1000, -1).kind, 'speed-limit', 'wraps back');
});

test('every fix resolves its problem; all-of-kind resolves every one; no-op returns same array', () => {
  const s = seeded(), probs = norm(s);
  for (const kind of ['speed-limit', 'too-close', 'redundant']) {
    const p = probs.find((x) => x.kind === kind);
    assert.ok(F.hasFix(p), kind);
    const out = F.applyFix(s, p);
    assert.notEqual(out, s, kind);
    assert.ok(!norm(out).some((q) => q.id === p.id), `${kind} problem gone`);
    const all = F.applyFix(s, p, { all: true });
    assert.equal(norm(all).filter((q) => q.kind === kind).length, 0, `all ${kind}`);
  }
  assert.ok(!F.hasFix(probs.find((x) => x.kind === 'long-gap')), 'gaps need a human');
  const p = probs.find((x) => x.kind === 'speed-limit');
  const fixed = F.applyFix(s, p, { all: true });
  assert.equal(F.applyFix(fixed, p, { all: true }), fixed, 'idempotent, same array when nothing to do');
  const jit = normalize([{ at: 0, pos: 50 }, { at: 100, pos: 52 }, { at: 200, pos: 50 }, { at: 300, pos: 52 }, { at: 400, pos: 90 }]);
  const jp = { fix: { op: 'removeMicroReversals', opts: { threshold: 3 } } };
  assert.ok(F.applyFix(jit, jp).length < jit.length);
  assert.equal(F.applyFix(jit, { fix: { op: 'nope' } }), jit);
});

test('charts: speed histogram, amplitude series, spm resample', () => {
  const s = stroke(21, 400); // 80 pos in 400 ms = 200 u/s
  const h = C.speedHistogram(s, 0, 8000, { bins: 12, cap: 600, limit: 150 });
  assert.equal(h.n, 20); assert.equal(h.counts[4], 20); assert.equal(h.overShare, 1);
  assert.ok(C.amplitudeSeries(s, 0, 8000, 4).values.every((v) => v === 80));
  assert.deepEqual(C.spmSeries([{ t0: 0, t1: 500, spm: 60 }, { t0: 500, t1: 1000, spm: null }], 0, 1000, 4).values, [60, 60, null, null]);
  assert.equal(C.fmtDur(3725000), '1:02:05');
});

test('profiles: validation and duplication', () => {
  const ok = D.validateForm(D.toForm(D.GENERIC));
  assert.ok(ok.ok); assert.deepEqual(ok.value.range, [0, 100]);
  const bad = D.validateForm({ ...D.toForm(D.GENERIC), name: ' ', maxSpeed: 'abc', rangeLo: 60, rangeHi: 40, latencyMs: 99999 });
  assert.ok(!bad.ok); assert.ok(bad.errors.name && bad.errors.maxSpeed && bad.errors.rangeHi && bad.errors.latencyMs);
  assert.ok(bad.value.range[0] < bad.value.range[1]); assert.equal(bad.value.maxSpeed, D.GENERIC.maxSpeed); assert.equal(bad.value.latencyMs, 5000);
  const all = D.listProfiles([]), dup = D.duplicateProfile(D.GENERIC, all);
  assert.ok(!all.some((p) => p.id === dup.id));
  assert.ok(D.isBuiltin('handy') && !D.isBuiltin(dup.id));
  assert.notEqual(D.profileKey(D.GENERIC), D.profileKey({ ...D.GENERIC, maxSpeed: 1 }));
});

test('compare: shaping, mismatches, disagreements', () => {
  const rows = K.shapeScore({ f1: 0.8123, precision: 0.9, recall: 0.75, lag_ms: 40, dtMedianMs: 33.2, tp: 8, fp: 1, fn: 2 });
  assert.equal(rows.find((r) => r.key === 'f1').value, '81.2%'); assert.ok(rows.some((r) => r.key === 'dt_median_ms' && r.value === '33 ms'));
  assert.equal(rows[0].value, '8 / 1 / 2');
  assert.equal(K.grade(0.9), 'good'); assert.equal(K.grade(0.3), 'poor'); assert.equal(K.grade(null), 'none');
  assert.equal(K.shapeScenes([{ t0: 0, t1: 1000, f1: 0.5 }])[0].f1, 0.5);
  const a = stroke(21, 400), b = a.map((x, i) => (i >= 10 ? { ...x, pos: 100 - x.pos } : x));
  const d = K.disagreements(a, b, 0, 8000, { binMs: 2000 });
  assert.ok(d.length && d.every((x) => x.t0 >= 3000));
  assert.deepEqual(K.disagreements(a, a, 0, 8000), []);
  const cmp = compare(a.filter((_, i) => i !== 6), a, { t0: 0, t1: 8000 });
  const m = K.mismatches(cmp);
  assert.ok(m.length > 0 && m.every((x) => x.what === 'missing' || x.what === 'extra'));
  assert.ok(m.every((x, i) => !i || x.at >= m[i - 1].at));
});

test('kind labels and unit wording', () => {
  assert.equal(P.kindLabel('speed-limit'), 'Speed limit');
  assert.equal(P.kindLabel('jitter'), 'Jitter');
  const [p] = P.normalizeProblems([{ kind: 'speed-limit', t0: 0, message: 'Peak 900 units/s exceeds' }], 'stroke');
  assert.equal(p.message, 'Peak 900 u/s exceeds');
  assert.equal(P.filterProblems([p], { ...P.defaultFilter(), q: 'speed limit' }, P.emptyIgnore()).length, 1);
});

test('around(): per-chapter statistics on the slice equal those on the whole script', async () => {
  const { statistics } = await import('../src/lib/analyze/index.js');
  const s = seeded();
  for (const [t0, t1] of [[0, 4025], [1234, 9876], [3990, 4060], [10100, 25000], [-500, 1e6]]) {
    const cut = C.around(s, t0, t1);
    assert.ok(cut.length <= s.length);
    assert.deepEqual(statistics(cut, { t0, t1 }), statistics(s, { t0, t1 }), `stats ${t0}-${t1}`);
    assert.deepEqual(C.speedHistogram(cut, t0, t1, { bins: 1, cap: 1e9, limit: 300 }), C.speedHistogram(s, t0, t1, { bins: 1, cap: 1e9, limit: 300 }));
  }
});

test('stat labels match the inspector and counts group like the lane header', () => {
  assert.equal(C.fmtCount(2503), '2 503');
  assert.equal(C.fmtCount(999), '999');
  const labels = C.STAT_ROWS.map(([k]) => k);
  assert.ok(labels.includes('Strokes/min') && !labels.some((k) => k.includes('Strokes / min')));
  assert.equal(C.STAT_ROWS.find(([k]) => k === 'Actions')[1]({ actions: 12345 }), '12 345');
});

test('stroke window: Capstan max speed follows strokeMm, clamps to strokeRange, others unchanged', () => {
  const cap = D.getProfile('nucleus-capstan');
  assert.deepEqual(D.strokeRangeOf(cap), [100, 300]);
  assert.equal(D.withStrokeMm(cap, null), cap);
  assert.equal(D.withStrokeMm(cap, 300).maxSpeed, 400);
  assert.equal(D.withStrokeMm(cap, 100).maxSpeed, 1200);
  assert.equal(D.withStrokeMm(cap, 20).kinematics.strokeMm, 100);
  assert.notEqual(D.profileKey(D.withStrokeMm(cap, 150)), D.profileKey(cap));
  assert.equal(D.withStrokeMm(D.GENERIC, 150), D.GENERIC);
  const custom = { ...D.withStrokeMm(cap, 200), id: 'c', maxSpeed: 500, maxSpeedDerived: false };
  assert.equal(D.withStrokeMm(custom, 100).maxSpeed, 500, 'a typed max speed is kept');
  const settings = (o) => ({ get: (k, d) => (k in o ? o[k] : d) });
  assert.equal(D.activeProfile(settings({ 'review.profile': 'nucleus-capstan', 'review.strokeMm': { 'nucleus-capstan': 250 } })).maxSpeed, 480);
  assert.equal(D.activeProfile(settings({})).id, 'generic');
});
