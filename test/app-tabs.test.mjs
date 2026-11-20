// The stage tabs (paw-ef73.1): Scenes, Track, Refine, Review. The stored mode migrates (script -> refine) with nothing
// else lost, the stored layouts follow (layout v7), and each tab shows its own panels and overlays (every panel.js and
// overlay.js, their .svelte components stubbed: only the metadata matters here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') };
    if (url.endsWith('.js') && readFileSync(fileURLToPath(url), 'utf8').includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8').replace(/import\.meta\.glob\(/g, '((..._) => ({}))(') };
    return next(url, ctx);
  },
});

const src = new URL('../src/', import.meta.url);
const { MODES, modeOf, migrateMode } = await import(new URL('app/modes.js', src));
const { Layout, migrateLayout, LAYOUT_V } = await import(new URL('app/layout.svelte.js', src));

const fakeSettings = (values) => { const v = { ...values }; return { v, get: (k) => v[k], set: (k, x) => { v[k] = x; } }; };

test('the tabs in order; a stored script opens as Refine, an unknown one as Scenes', () => {
  assert.deepEqual(MODES, ['scenes', 'track', 'refine', 'review']);
  assert.deepEqual(['script', 'track', 'review', 'refine', 'scenes', undefined, 'draft'].map(modeOf), ['refine', 'track', 'review', 'refine', 'scenes', 'scenes', 'scenes']);
});

test('migrateMode: writes the tab back, moves a mode.script rebinding to mode.refine, keeps every other setting', () => {
  const s = fakeSettings({ mode: 'script', 'keys.overrides': { 'mode.script': ['Ctrl+9'], 'track.run': ['Y'] }, 'player.rate': 1.5, layout: { x: 1 } });
  assert.equal(migrateMode(s), 'refine');
  assert.deepEqual(s.v, { mode: 'refine', 'keys.overrides': { 'mode.refine': ['Ctrl+9'], 'track.run': ['Y'] }, 'player.rate': 1.5, layout: { x: 1 } });
  const t = fakeSettings({ mode: 'track' });
  assert.equal(migrateMode(t), 'track');
  assert.deepEqual(t.v, { mode: 'track' }, 'nothing written');
  assert.equal(migrateMode(fakeSettings({})), 'scenes', 'a fresh install opens on Scenes');
});

test('layout v7: Script\'s layout is Refine\'s; Scenes starts from Track\'s areas with its own rows; nothing dropped', () => {
  const tree = { dir: 'row', kids: [{ id: 'l', home: 'left', tabs: ['tracking', 'tracking.scenes'], size: 420 }, { id: 'v', kind: 'video' }] };
  const old = { script: { tree: { id: 's' }, rows: { 'timeline.loops': { height: 40 } } }, track: { tree, rows: { tracking: { height: 200 } } }, review: { rows: { x: {} } } };
  const m = migrateLayout(old, 6);
  assert.deepEqual(Object.keys(m).sort(), ['refine', 'review', 'scenes', 'track']);
  assert.deepEqual(m.refine, old.script);
  assert.deepEqual([m.track, m.review], [{ ...old.track, rows: { tracking: { height: 200 + 47 } } }, old.review], 'kept (v8, paw-idb5, then grows a stored Tracker height by the strip and the Chapters row)');
  assert.deepEqual(m.scenes, { tree }, 'the areas only: the Scenes tab folds the Tracker row by its own default');
  assert.deepEqual(migrateLayout({ scenes: { tree: { id: 'mine' } }, track: { tree } }, 6).scenes, { tree: { id: 'mine' } }, 'a Scenes layout already there stays');
  assert.equal(LAYOUT_V, 8);
  const v = { layout: old, 'layout.v': 6 };
  const app = { mode: 'scenes', panels: [], settings: { get: (k, d) => v[k] ?? d, set: (k, x) => { v[k] = x; } } };
  const L = new Layout(app);
  assert.equal(v['layout.v'], 8);
  assert.equal(L.row('timeline.loops').collapsed, false, 'Scenes: the Loops row shown');
  assert.equal(L.row('timeline.scenes').collapsed, false, 'Scenes: the Scenes row shown');
  app.mode = 'refine';
  assert.equal(L.row('timeline.loops').height, 40, 'Refine kept Script\'s rows');
});

// ---- the panels and overlays of each tab ----
const featDir = new URL('features/', src);
const load = async (name) => {
  const out = [];
  for (const f of readdirSync(featDir)) if (existsSync(new URL(`${f}/${name}`, featDir))) out.push(...[(await import(new URL(`${f}/${name}`, featDir))).default].flat());
  return out;
};
const panels = await load('panel.js'), overlays = await load('overlay.js'), lanes = await load('lane.js');
const inTab = (list, m) => list.filter((p) => !p.modes || p.modes.includes(m)).map((p) => p.id).sort();

test('every panel and overlay names only real tabs', () => {
  for (const p of [...panels, ...overlays]) for (const m of p.modes || []) assert.ok(MODES.includes(m), `${p.id}: ${m}`);
});

test("Scenes: the Scenes panel, the Inspector, History, the tray's Rows, Settings (every tab); no tracking, point or finishing tools (no Chapters: paw-1w0x; no Shortcuts tab: F1, paw-idb5)", () => {
  assert.deepEqual(inTab(panels, 'scenes'), ['history.entries', 'inspector.history', 'settings', 'timeline.inspector', 'timeline.rows', 'tracking.scenes']);
  assert.deepEqual(inTab(overlays, 'scenes'), ['tracking-roi', 'video-posbar', 'video-sr6'], 'only the describe tag boxes (no groups painting) and the position bar (every tab)');
});

test('Track: the Tracking panel, the overlays and the Inspector; the Scenes panel is the Scenes tab\'s', () => {
  const t = inTab(panels, 'track');
  for (const id of ['tracking', 'timeline.inspector', 'machine.view', 'inspector.history']) assert.ok(t.includes(id), id);
  assert.ok(!t.includes('tracking.scenes'));
  assert.deepEqual(inTab(overlays, 'track'), ['tracking-groups', 'tracking-roi', 'video-posbar', 'video-sr6']);
});

test('Refine holds what Script held; Review as it was', () => {
  assert.deepEqual(inTab(panels, 'refine'), ['director', 'fix', 'graph', 'history.entries', 'inspector.history', 'inspector.quick', 'inspector.selection', 'inspector.snippets', 'inspector.tools',
    'machine.view', 'playback', 'settings', 'timeline.inspector', 'timeline.plan', 'timeline.rows']);
  assert.deepEqual(inTab(overlays, 'refine'), ['video-posbar', 'video-sr6']);
  assert.deepEqual(inTab(panels, 'review'), ['assist', 'director', 'fix', 'history.entries', 'inspector.history', 'inspector.selection', 'inspector.tools', 'machine.view', 'playback',
    'review.compare', 'review.device', 'review.problems', 'review.stats', 'settings', 'timeline.rows']);
});

// ---- the timeline rows of each tab (paw-ef73.7): Timeline.svelte filters by `modes`, sorts by `orderIn`, fills `fillIn` ----
const rowsIn = (m) => lanes.filter((r) => !r.modes || r.modes.includes(m)).sort((a, b) => (a.orderIn?.[m] ?? a.order) - (b.orderIn?.[m] ?? b.order)).map((r) => r.id);

test('Scenes tab rows: the ruler, the compact Scenes / Shots strips, the Modifiers row, the filmstrip taking the leftover height (the loops: on the Shots strip, paw-llaa), the chips; nothing else (no Chapters: paw-1w0x; no hint line: F1 and the status bar, paw-idb5)', () => {
  assert.deepEqual(rowsIn('scenes'), ['timeline.ruler', 'timeline.scenes', 'timeline.fx', 'timeline.filmstrip', 'timeline.chips']);
  assert.deepEqual(lanes.filter((r) => r.height === 'fill' && (!r.modes || r.modes.includes('scenes'))).map((r) => r.id), ['timeline.filmstrip'], 'no point lanes: the filmstrip fills');
  assert.equal(lanes.find((r) => r.id === 'timeline.scenes').height, 56, 'the Scenes / Shots strips stay compact');
});

test('the other tabs keep every row they had, in the old order (no chip bar, no filmstrip)', () => {
  for (const m of ['track', 'refine', 'review']) {
    const ids = rowsIn(m);
    // paw-unuy: the Track tab has no Tracker row (its stroke lane is the tracker lane)
    assert.deepEqual(ids, lanes.filter((r) => !['timeline.chips', 'timeline.filmstrip', ...(m === 'track' ? ['tracking'] : [])].includes(r.id)).sort((a, b) => a.order - b.order).map((r) => r.id), m);
  }
});

test('drag-to-scrub is the ruler only, in every tab (the owner: "drag to scrub should only happen on the ruler")', () => {
  for (const m of ['scenes', 'track', 'refine', 'review']) {
    const sc = lanes.filter((r) => r.scrubs && (!r.modes || r.modes.includes(m)));
    assert.deepEqual(sc.map((r) => r.id), ['timeline.ruler'], m + ': only the ruler scrub band');
  }
});
