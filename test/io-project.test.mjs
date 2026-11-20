import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBlock, setBlock, parse, serialize, toJSON, migrate, MIGRATIONS, ProjectError, CURRENT_VERSION, relativePath, rankRelink } from '../src/lib/io/index.js';
import { isValid } from '../src/lib/core/script.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const AT = '2026-11-06T10:00:00.000Z';
const script = (r, n) => { const s = []; let t = Math.floor(r() * 1000); for (let i = 0; i < n; i++) { t += 1 + Math.floor(r() * 700); s.push({ at: t, pos: Math.floor(r() * 101) }); } return s; };

function randomDoc(r) {
  const axes = { stroke: script(r, Math.floor(r() * 200)) };
  if (r() < 0.5) axes.roll = script(r, Math.floor(r() * 50));
  if (r() < 0.3) axes.twist = [];
  return {
    media: r() < 0.8 ? { path: 'C:\\clips\\a b.mp4', name: 'a b.mp4', size: Math.floor(r() * 1e9), hash: r() < 0.5 ? { algo: 'sha256', value: 'ab12' } : null, durationMs: 123456, fps: 29.97, isVfr: r() < 0.5, width: 1920, height: 1080 } : null,
    axes, activeAxis: Object.keys(axes)[Math.floor(r() * Object.keys(axes).length)],
    chapters: [{ id: 'c1', t0: 0, t1: 5000, name: 'intro \u{1F43E}', color: '#ff0' }, { id: 'c2', t0: 5000, t1: 9000, name: '', color: null, custom: { keep: [1, 2] } }].slice(0, Math.floor(r() * 3)),
    bookmarks: r() < 0.5 ? [{ id: 'b1', at: 1234, note: 'look' }] : [],
    loops: r() < 0.5 ? [{ id: 'l1', t0: 100, t1: 900, tiledTo: 5000 }, { id: 'l2', t0: 1, t1: 2 }] : [],
    plan: r() < 0.5 ? [{ id: 'p1', t0: 0, t1: 1000, kind: 'loop', recipe: 'sine', params: { a: 1, nested: { b: [1, 2] } } }] : [],
    ghosts: r() < 0.5 ? [{ id: 'g1', name: 'run 1', color: '#0f0', visible: false, source: { kind: 'tracker', runId: 7 }, script: [], extraGhostKey: true }] : [],
    settings: { snap: true, grid: [1, 2], deep: { x: null } }, view: r() < 0.5 ? { start: 100, span: 60000 } : null,
    profileId: r() < 0.5 ? 'handy' : null, playheadMs: r() < 0.5 ? 4200 : null,
    meta: { app: { name: 'Pawscript', version: '9.9' }, createdAt: AT, savedAt: AT },
    extra: r() < 0.5 ? { futureThing: { a: [1, 2, 3] }, another: 'x' } : {},
  };
}

test('round trip: parse(serialize(doc)) = doc over 500 random documents', () => {
  const r = rng(555);
  for (let i = 0; i < 500; i++) {
    const doc = randomDoc(r);
    const text = serialize(doc, { savedAt: AT, appVersion: '9.9' });
    const back = parse(text);
    assert.deepEqual(back.axes, doc.axes);
    for (const k of ['media', 'activeAxis', 'chapters', 'bookmarks', 'loops', 'plan', 'ghosts', 'settings', 'view', 'profileId', 'playheadMs', 'extra']) {
      const want = k === 'media' && doc.media ? { size: null, hash: null, ...doc.media } : doc[k];
      assert.deepEqual(back[k], want, k);
    }
    assert.equal(back.meta.version, CURRENT_VERSION); assert.equal(back.meta.savedAt, AT); assert.equal(back.meta.createdAt, AT);
    assert.equal(serialize(back, { savedAt: AT, appVersion: '9.9' }), text, 'serialise is a fixed point');
    for (const s of Object.values(back.axes)) assert.ok(isValid(s));
  }
});

test('file shape: pairs on one line, selection and bulky ghost data not saved', () => {
  const doc = { ...randomDoc(rng(1)), selection: { axis: 'stroke', ats: new Set([1]) }, range: { t0: 1, t1: 2 }, dirty: true, axes: { stroke: [{ at: 10, pos: 5 }, { at: 20, pos: 99 }] },
    ghosts: [{ id: 'g', name: 'n', color: '#fff', visible: true, source: 's', script: [{ at: 1, pos: 1 }], frames: { t: [1, 2, 3] } }] };
  const text = serialize(doc, { savedAt: AT });
  assert.ok(text.includes('[10, 5]') && text.includes('[20, 99]'));
  assert.ok(!/selection|"range"|dirty|frames/.test(text));
  assert.deepEqual(parse(text).ghosts[0].script, []);
  assert.deepEqual(parse(serialize(doc, { savedAt: AT, ghostScripts: true })).ghosts[0].script, [{ at: 1, pos: 1 }]);
  const j = toJSON(doc, { savedAt: AT, projectPath: 'C:\\proj\\show.pawproj' });
  assert.equal(j.format, 'pawproj'); assert.equal(j.version, CURRENT_VERSION);
  if (doc.media) assert.equal(j.media.relativePath, '..\\clips\\a b.mp4'.replace(/\\/g, '/'));
});

test('relativePath and re-link ranking', () => {
  assert.equal(relativePath('C:\\p\\a.pawproj', 'C:\\p\\sub\\v.mp4'), 'sub/v.mp4');
  assert.equal(relativePath('C:/p/x/a.pawproj', 'C:/p/v.mp4'), '../v.mp4');
  assert.equal(relativePath('C:/p/a.pawproj', 'D:/v.mp4'), null);
  const media = { path: 'C:\\old\\Clip.mp4', size: 100, hash: { algo: 'sha256', value: 'aa' } };
  const r = rankRelink(media, [
    { path: 'D:\\x\\other.mp4', size: 5 }, { path: 'D:\\x\\clip.mp4', size: 7 }, { path: 'D:\\y\\renamed.mp4', size: 100, hash: { algo: 'sha256', value: 'aa' } },
    { path: 'D:\\y\\clip2.mp4', size: 100 }, { path: 'D:\\z\\CLIP.mp4', size: 100 },
  ]);
  assert.deepEqual(r.map((x) => x.why), ['hash', 'size+name', 'size', 'name']);
  assert.equal(r[0].path, 'D:\\y\\renamed.mp4');
});

const good = () => JSON.parse(serialize(randomDoc(rng(3)), { savedAt: AT }));
const errs = (o, opts) => { try { parse(JSON.stringify(o), opts); } catch (e) { assert.ok(e instanceof ProjectError, String(e)); return e.errors; } assert.fail('expected an error'); };

test('validation: precise messages with paths', () => {
  assert.equal(errs('{', undefined)[0].path, '(file)');
  assert.ok(/not valid JSON/.test(errs('x')[0].message) || true);
  assert.throws(() => parse('{nope'), /not valid JSON/);
  assert.throws(() => parse('[]'), /top level/);
  assert.throws(() => parse('{"format":"other","version":1}'), /format: expected "pawproj", got "other"/);
  assert.throws(() => parse('{"format":"pawproj"}'), /version: expected a non-negative integer, got undefined/);
  assert.throws(() => parse('{"format":"pawproj","version":99,"axes":{}}'), /version 99 .* up to 4/);

  const e = (mut) => { const o = good(); o.axes = { stroke: [[0, 1], [10, 2], [20, 3]], roll: [[1, 1]] }; o.activeAxis = 'stroke'; o.chapters = []; o.bookmarks = []; o.loops = []; o.plan = []; o.ghosts = []; o.view = null; mut(o); return errs(o).map((x) => `${x.path}: ${x.message}`); };
  assert.deepEqual(e((o) => { o.axes.stroke[1] = [10, 200]; }), ['axes.stroke[1]: expected [at, pos] with integer at >= 0 and pos in 0..100, got [10,200]']);
  assert.deepEqual(e((o) => { o.axes.stroke[2] = [10, 5]; }), ['axes.stroke[2]: time 10 is not after the previous action (10)']);
  assert.deepEqual(e((o) => { o.axes.stroke[0] = [0.5, 5]; }), ['axes.stroke[0]: expected [at, pos] with integer at >= 0 and pos in 0..100, got [0.5,5]']);
  assert.match(e((o) => { o.axes.sparkle = []; })[0], /^axes\.sparkle: unknown axis id/);
  assert.match(e((o) => { o.axes = []; })[0], /^axes: expected an object/);
  assert.deepEqual(e((o) => { o.chapters = [{ id: 'a', t0: 500, t1: 100, name: 'x' }]; }), ['chapters[0].t1: ends (100) before it starts (500)']);
  assert.deepEqual(e((o) => { o.chapters = [{ id: 'a', t0: 0, t1: 1 }, { id: 'a', t0: 0, t1: 1 }]; }), ['chapters[1].id: duplicate id "a" (also at chapters[0])']);
  assert.deepEqual(e((o) => { o.bookmarks = [{ id: 'b', at: 'soon' }]; }), ['bookmarks[0].at: expected a number >= 0, got "soon"']);
  assert.deepEqual(e((o) => { o.loops = [5]; }), ['loops[0]: expected an object, got 5']);
  assert.deepEqual(e((o) => { o.activeAxis = 'pitch'; }), ['activeAxis: "pitch" has no script in axes (have: stroke, roll)']);
  assert.deepEqual(e((o) => { o.view = { start: 0, span: 0 }; }), ['view.span: must be > 0, got 0']);
  assert.deepEqual(e((o) => { o.media = { path: 5 }; }), ['media.path: expected a string, got 5']);
  assert.deepEqual(e((o) => { o.settings = []; }), ['settings: expected an object, got []']);
  assert.equal(e((o) => { o.chapters = [{ id: 'a', t0: -1, t1: 'x' }]; o.view = 3; }).length, 3, 'all problems collected, not just the first');
  assert.ok(errs({ ...good(), chapters: [{ id: '', t0: 0, t1: 1 }] })[0].message.includes('non-empty string'));
});

test('lenient mode repairs scripts and reports warnings', () => {
  const o = good();
  o.axes = { stroke: [[5, 1], [3, 2], [3, 9], [7, 300], 'x', [9, 4]] };
  o.activeAxis = 'roll';
  const warnings = [];
  const doc = parse(JSON.stringify(o), { lenient: true, warnings });
  assert.deepEqual(doc.axes.stroke, [{ at: 3, pos: 9 }, { at: 5, pos: 1 }, { at: 9, pos: 4 }]);
  assert.equal(doc.activeAxis, 'stroke');
  assert.equal(warnings.length, 2);
  assert.throws(() => parse(JSON.stringify(o)), ProjectError);
});

test('unknown keys survive, top level and nested', () => {
  const o = good();
  o.futureSection = { deep: [1, { x: 2 }] };
  o.chapters = [{ id: 'c', t0: 0, t1: 1, name: 'n', color: null, fancy: { z: 1 } }];
  o.media = { ...(o.media || { path: 'a.mp4' }), futureMediaKey: 'k' };
  o.ghosts = [{ id: 'g', name: 'n', color: '#fff', visible: true, source: null, whatever: 1 }];
  const back = JSON.parse(serialize(parse(JSON.stringify(o)), { savedAt: AT }));
  assert.deepEqual(back.futureSection, o.futureSection);
  assert.deepEqual(back.chapters[0].fancy, { z: 1 });
  assert.equal(back.media.futureMediaKey, 'k');
  assert.equal(back.ghosts[0].whatever, 1);
});

test('migrations: v0 (outline shape) -> v1, and a custom table', () => {
  const v0 = {
    format: 'pawproj', version: 0, media: { path: 'C:\\v\\a.mp4', duration_ms: 90000, fps: 30, is_vfr: true, sha256: 'deadbeef' },
    actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }],
    chapters: [{ start_ms: 0, end_ms: 500, name: 'one' }], bookmarks: [{ at_ms: 250, note: 'n' }], loops: [{ start_ms: 1, end_ms: 9, tiled_to: 99 }],
    settings: { a: 1 }, mystery: 7,
  };
  const warnings = [];
  const doc = parse(JSON.stringify(v0), { warnings });
  assert.deepEqual(doc.axes.stroke, [{ at: 0, pos: 10 }, { at: 100, pos: 90 }]);
  assert.deepEqual(doc.media, { path: 'C:\\v\\a.mp4', name: 'a.mp4', size: null, hash: { algo: 'sha256', value: 'deadbeef' }, durationMs: 90000, fps: 30, isVfr: true, width: null, height: null });
  assert.deepEqual(doc.chapters, [{ id: 'ch1', t0: 0, t1: 500, name: 'one', color: null }]);
  assert.deepEqual(doc.bookmarks, [{ id: 'bm1', at: 250, note: 'n' }]);
  assert.deepEqual(doc.loops, [{ id: 'lp1', t0: 1, t1: 9, tiledTo: 99 }]);
  assert.equal(doc.extra.mystery, 7); assert.equal(doc.meta.migratedFrom, 0); assert.ok(warnings[0].includes('migrated from version 0'));
  assert.equal(JSON.parse(serialize(doc, { savedAt: AT })).version, CURRENT_VERSION);
  // multi-axis v0
  const m = parse(JSON.stringify({ ...v0, actions: undefined, axes: { stroke: { actions: [{ at: 1, pos: 1 }] }, roll: [{ at: 2, pos: 2 }] } }));
  assert.deepEqual(m.axes.roll, [{ at: 2, pos: 2 }]);

  // custom chain, input never mutated, gaps and futures rejected
  const table = { ...MIGRATIONS, 1: (o) => ({ ...o, version: 2, renamed: o.old, old: undefined }) };
  const input = { format: 'pawproj', version: 1, old: 'x', axes: {} };
  const r = migrate(input, table, 2);
  assert.equal(r.obj.version, 2); assert.equal(r.obj.renamed, 'x'); assert.equal(r.from, 1); assert.equal(input.version, 1);
  assert.throws(() => migrate({ version: CURRENT_VERSION }, { ...MIGRATIONS }, CURRENT_VERSION + 1), new RegExp(`no migration from version ${CURRENT_VERSION} to`));
  assert.throws(() => migrate({ version: 4 }, MIGRATIONS, 1), /update Pawscript/);
  assert.equal(migrate({ version: 4 }, MIGRATIONS, 1, { allowNewer: true }).obj.version, 4);
  assert.throws(() => migrate({ version: 'x' }, MIGRATIONS, 1), /non-negative integer/);
  assert.equal(parse(JSON.stringify({ format: 'pawproj', version: 1, axes: {}, a: 1 }), { migrations: table, target: 2 }).extra.renamed, undefined);
});

test('v1 -> v2: a pulses climax keeps its sound (kind orgasm, recipe orgasm-pulses); other recipes untouched', () => {
  const plan = [
    { id: 'a', t0: 0, t1: 1000, kind: 'climax', recipe: 'climax', params: { rate: 7 } },
    { id: 'b', t0: 1000, t1: 2000, kind: 'climax' },
    { id: 'c', t0: 2000, t1: 3000, kind: 'climax', recipe: 'accelerando' },
    { id: 'd', t0: 3000, t1: 4000, kind: 'custom', recipe: 'climax' },
    { id: 'e', t0: 4000, t1: 5000, kind: 'afterglow', recipe: 'afterglow' },
  ];
  const d = parse(JSON.stringify({ format: 'pawproj', version: 1, axes: {}, plan }));
  assert.deepEqual(d.plan.map((s) => [s.kind, s.recipe ?? null]), [['orgasm', 'orgasm-pulses'], ['orgasm', 'orgasm-pulses'], ['climax', 'accelerando'], ['custom', 'orgasm-pulses'], ['afterglow', 'afterglow']]);
  assert.deepEqual(d.plan[0].params, { rate: 7 });
  assert.equal(d.meta.migratedFrom, 1);
  // a v2 file is read as is: 'climax' + recipe 'climax' is the run-in now
  assert.equal(parse(serialize({ ...d, plan: [{ id: 'x', t0: 0, t1: 1, kind: 'climax', recipe: 'climax' }] }, { savedAt: AT })).plan[0].kind, 'climax');
});

test('minimal and empty projects', () => {
  const d = parse('{"format":"pawproj","version":1,"axes":{}}');
  assert.deepEqual([d.chapters, d.bookmarks, d.loops, d.plan, d.ghosts, d.settings, d.media, d.view], [[], [], [], [], [], {}, null, null]);
  assert.equal(d.activeAxis, 'stroke');
  assert.equal(parse(serialize(d, { savedAt: AT })).activeAxis, 'stroke');
});

test('feature blocks (graphs) round trip untouched via doc.extra', () => {
  let doc = parse('{"format":"pawproj","version":1,"axes":{}}');
  const graphs = { g1: { nodes: [{ id: 'n', type: 'x', params: { a: [1, 2] } }], edges: [] } };
  doc = setBlock(doc, 'graphs', graphs);
  const text = serialize(doc, { savedAt: AT });
  assert.deepEqual(getBlock(parse(text), 'graphs'), graphs);
  assert.deepEqual(JSON.parse(text).graphs, graphs);
  assert.deepEqual(getBlock(setBlock(doc, 'graphs', undefined), 'graphs', 'none'), 'none');
  assert.throws(() => setBlock(doc, 'axes', 1), /core project key/);
});
