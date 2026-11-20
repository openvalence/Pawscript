// paw-yt8q: T / Ctrl+T (track.gridFrame / track.run) and the Track / Track ROI buttons of the chips and the quick bar are one
// path: the command. It tracks what the chips name (quickbar.js currentSpan): the live selection as it is, else the selected
// shots / the scene at the playhead, which become the range first. A stand-in tracking store records the range it ran over.
// Before: the buttons set that range, the keys tracked the I-O range or the whole video.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

const noGlob = (s) => s.replace(/import\.meta\.glob\(/g, '((..._) => ({}))(');
registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    const file = fileURLToPath(url), src = () => readFileSync(file, 'utf8');
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: noGlob(compileModule(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: noGlob(compile(src(), { filename: file, generate: 'server' }).js.code) };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});

const root = new URL('../src/', import.meta.url);
const { default: list } = await import(new URL('features/tracking/commands.js', root));
const { adoptTracking } = await import(new URL('features/tracking/tracking.svelte.js', root));
const { setSel } = await import(new URL('features/timeline/state.svelte.js', root));
const byId = Object.fromEntries(list.map((c) => [c.id, c]));

// paw-x8we: Ctrl+T tracks one painted part (parts: the names painted in the range); none painted, a box set by code (box) is tracked
function setup({ mode = 'track', range = null, t = 5000, parts = [], box = true } = {}) {
  const ran = [];
  const app = {
    mode, durationMs: 10000, doc: { media: { path: 'x.mp4', durationMs: 10000 }, range, fx: [], scenes: [{ start_ms: 0, end_ms: 4000 }, { start_ms: 4000, end_ms: 10000 }] },
    player: { timeMs: t }, settings: { get: (k, d) => d, set() {} }, toast: (m, k, o) => ran.push(['toast', m, o?.action?.label]), commands: { keysFor: () => [], winner: () => null, run: (id) => ran.push(['cmd', id]) },
  };
  const span = () => (app.doc.range ? { ...app.doc.range } : 'whole video');
  adoptTracking(app, { videoPath: 'x.mp4', canGrid: true, canTrack: true, canPart: true, trackers: [], trackRoi: box ? { kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 } : null, selected: null,
    paintedParts: () => parts.map((name) => ({ name, group: { name, t_ms: 4500, poly: [] } })), trackPart: (n) => ran.push(['part', n, span()]),
    gridFrame: () => ran.push(['grid', span()]), track: () => ran.push(['roi', span()]), trackShots: (s) => ran.push(['shots', s]) });
  return { app, ran, run: (id, a) => { assert.ok(byId[id].when(app), `${id} enabled`); return byId[id].run(app, a); } };
}

test('Ctrl+T, one part painted: that part, over the scene at the playhead (the range first)', () => {
  setSel();
  const { run, ran } = setup({ parts: ['c2_penis'] });
  run('track.run');
  assert.deepEqual(ran, [['part', 'c2_penis', { t0: 4000, t1: 10000 }]]);
});

test('Ctrl+T with a part named (the pick menu\'s row) tracks it; {all} is the old panel Track', () => {
  setSel();
  const { run, ran } = setup({ parts: ['c2_penis', 'c1_anus'] });
  run('track.run', { part: 'c1_anus' });
  run('track.run', { all: true });
  assert.deepEqual(ran, [['part', 'c1_anus', { t0: 4000, t1: 10000 }], ['roi', { t0: 4000, t1: 10000 }]]);
});

test('Ctrl+T with nothing painted and no box: opens the Groups tool on the video and says to paint the part; nothing tracked (paw-bunr)', () => {
  setSel();
  const { run, ran } = setup({ box: false });
  run('track.run');
  assert.deepEqual(ran, [['cmd', 'tracking.groups'], ['toast', 'Paint the part to track on the video', undefined]]);
});

test('T with nothing selected tracks the scene at the playhead (what the chips name), not the whole video', () => {
  setSel();
  const { run, ran } = setup();
  run('track.gridFrame');
  assert.deepEqual(ran, [['grid', { t0: 4000, t1: 10000 }]]);
});

test('Ctrl+T with nothing selected: Track ROI on the scene at the playhead', () => {
  setSel();
  const { run, ran } = setup();
  run('track.run');
  assert.deepEqual(ran, [['roi', { t0: 4000, t1: 10000 }]]);
});

test('an I-O range set with nothing selected is tracked as it is (T and the buttons)', () => {
  setSel();
  const { run, ran } = setup({ range: { t0: 1000, t1: 9000 } });
  run('track.gridFrame');
  run('track.run');
  assert.deepEqual(ran, [['grid', { t0: 1000, t1: 9000 }], ['roi', { t0: 1000, t1: 9000 }]]);
});

test('selected shots win over a range set after them: they become the range', () => {
  setSel({ active: 0, shots: [0] });
  const { run, ran } = setup({ range: { t0: 1000, t1: 9000 } });
  run('track.gridFrame');
  assert.deepEqual(ran, [['grid', { t0: 0, t1: 4000 }]]);
  setSel();
});

test('a live selection is tracked as it is', () => {
  setSel({ active: 0, shots: [0] });
  const { run, ran } = setup({ range: { t0: 0, t1: 4000 } });
  run('track.gridFrame');
  assert.deepEqual(ran, [['grid', { t0: 0, t1: 4000 }]]);
  setSel();
});

// paw-ws19: T right after start, the tracker list still loading: the press waits for the list, then tracks; never "needs a GPU"
function loading({ arrive }) {
  const ran = [];
  const app = { mode: 'track', durationMs: 10000, doc: { media: { path: 'x.mp4' }, range: null, fx: [], scenes: [] }, player: { timeMs: 0 },
    settings: { get: (k, d) => d, set() {} }, toast: (m) => ran.push(['toast', m]), commands: { keysFor: () => [], winner: () => null } };
  let done;
  const s = { videoPath: 'x.mp4', busy: 'list', listed: false, trackers: [], error: '', queued: '', gridTracker: null, get canGrid() { return !!this.gridTracker && !this.busy; },
    ensureListed() {}, listingNow: () => new Promise((r) => { done = r; }), gridFrame: () => ran.push(['grid']) };
  adoptTracking(app, s);
  const land = () => { s.busy = ''; s.listed = true; s.trackers = arrive; s.gridTracker = arrive.find((t) => t.id === 'tapnext_points') ?? null; done(); };
  return { app, s, ran, land };
}

test('T while the tracker list loads waits for it, the button busy, then tracks', async () => {
  setSel();
  const { app, s, ran, land } = loading({ arrive: [{ id: 'tapnext_points' }] });
  const p = byId['track.gridFrame'].run(app);
  assert.equal(s.queued, 'grid', 'shown as waiting');
  assert.ok(!ran.some(([k, m]) => k === 'toast' && /needs/.test(m)), JSON.stringify(ran));
  land();
  await p;
  assert.equal(s.queued, '');
  assert.deepEqual(ran.filter(([k]) => k === 'grid'), [['grid']]);
});

test('the list came without a point tracker: then, and only then, "needs a point tracker"', async () => {
  const { app, ran, land } = loading({ arrive: [{ id: 'lk_box' }] });
  const p = byId['track.gridFrame'].run(app);
  land();
  await p;
  assert.match(ran.at(-1)[1], /needs a point tracker/);
  assert.equal(ran.filter(([k]) => k === 'grid').length, 0);
});

test('the Track buttons show in every tab but Scenes, and so do their commands; the keys stay in the Track tab', () => {
  setSel();
  for (const mode of ['refine', 'review']) {
    const { run, ran, app } = setup({ mode });
    run('track.gridFrame');
    assert.equal(ran[0][0], 'grid', mode);
    assert.equal(byId['track.gridFrame'].keyWhen(app) || byId['track.run'].keyWhen(app), false, `${mode}: T / Ctrl+T`);
  }
  assert.equal(byId['track.gridFrame'].keyWhen(setup().app), true);
  const { app } = setup({ mode: 'scenes' });
  assert.equal(byId['track.gridFrame'].when(app), false);
  assert.equal(byId['track.run'].when(app), false);
});
