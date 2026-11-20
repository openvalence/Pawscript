// paw-ef73.11 (owner: "this menu is insane"): the Scenes row's right-click is short and about structure. scenes-menu.js
// for every target: at most 10 rows in the Scenes tab (+ the one Modifier submenu), short labels with tips, keys from
// the command registry; greyed items only inside the Modifier submenu (paw-ef73.20: the Refine-only kinds, with the
// reason); and every command that left the menu is still registered and has its other home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenesRowMenu, menuRows } from '../src/features/timeline/scenes-menu.js';
import { modItems } from '../src/features/timeline/fxmenu.js';
import { REFINE_WHY } from '../src/lib/fx.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : /\.(js|svelte)$/.test(e.name) ? [path.join(d, e.name)] : []));
// the registry, read from the source: literal command ids with their keys (enough for the ids this menu names)
const REG = new Map();
for (const f of files(SRC)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\{ id: '([\w.-]+)'([^\n]*)/g)) {
  const k = /keys: \[([^\]]*)\]/.exec(m[2]);
  REG.set(m[1], { keys: k ? [...k[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [], menu: /menu: '(\w+)'/.exec(m[2])?.[1] });
}
const keys = (id) => REG.get(id)?.keys[0];

const ALL = { select: true, zoom: true, newScene: true, mergeNext: true, mergePrev: true, cut: true, shotNext: true, shotPrev: true, describe: true, described: true,
  cutaway: true, join: true, mergeShots: true, own: true, oneScene: true, proposal: true, merge: true };
/** The fullest menu a target can get: every item allowed, a marked shot's options (paw-2lp7.4), a waiting bridge, the modifiers (as the row builds them). */
const full = (target, tab = 'scenes', on = target === 'cutaway') => scenesRowMenu({ tab, target, title: 'T', can: ALL, n: 3, scenes: 3, keys,
  cutaway: { kind: on ? 'cutaway' : '', timing: false, extend: on }, fx: modItems(tab, () => {}), accept: { label: 'Bake', tip: 'Make the live points here permanent' } }, {});
/** The rows and the rows of their submenus (the plain shot's "Not tracked" holds the two marks). */
const deep = (items) => menuRows(items).flatMap((r) => (r.items ? [r, ...menuRows(r.items)] : [r]));
// paw-2lp7.5: no scene block and no scene boundary any more (the Actions strip has its own right-click)
const TARGETS = ['shot', 'cutaway', 'multi', 'cut', 'move'];

test('Scenes tab: every target is a short menu (at most 10 rows + the Modifier submenu), never the old 45', () => {
  for (const t of TARGETS) {
    const rows = menuRows(full(t)).filter((r) => r.id !== 'fx');
    assert.ok(rows.length >= 1 && rows.length <= 10, `${t}: ${rows.length} rows`);
    assert.equal(full(t)[0].section, 'T', `${t}: headed by what was clicked`);
  }
  assert.ok(menuRows(full('multi', 'scenes', true)).filter((r) => r.id !== 'fx').length <= 10, 'a selection of cutaways too');
});

test('labels are a few words, the explanation in the tip; no greyed rows (greys only inside the Modifier submenu)', () => {
  for (const tab of ['scenes', 'refine']) for (const t of TARGETS) for (const r of menuRows(full(t, tab))) {
    assert.ok(r.label.split(/\s+/).length <= 4, `${t}: "${r.label}" is short`);
    assert.ok(r.tip && r.tip.length > 8, `${t}: "${r.label}" has a tip`);
    assert.ok(!r.disabled, `${t}: "${r.label}" is not greyed`);
  }
});

test('an item that cannot apply is left out, not greyed', () => {
  const none = scenesRowMenu({ tab: 'scenes', target: 'shot', title: 'Shot 1.1', can: { zoom: true }, keys }, {});
  assert.deepEqual(menuRows(none).map((r) => r.label), ['Zoom to scene']);
  // a selection: one action over it, or one shot of it; no scene items (paw-2lp7.5)
  const two = menuRows(scenesRowMenu({ tab: 'scenes', target: 'multi', title: 'S', n: 2, scenes: 2, keys, can: { join: true, mergeShots: true, own: true } }, {})).map((r) => r.label);
  assert.deepEqual(two, ['One action over them', 'Merge 2 shots']);
  const lone = menuRows(scenesRowMenu({ tab: 'scenes', target: 'shot', title: 'S', can: { mergeNext: true, mergePrev: true, newScene: true }, keys }, {})).map((r) => r.label);
  assert.deepEqual(lone, [], 'the scene merges and New scene are gone');
  // paw-2lp7.4: a plain shot gets the two marks in one row; a marked one both marks (one click converts), the timing option and,
  // with no action over it, "Carry the action across"; no older fill anywhere
  const shot = menuRows(scenesRowMenu({ tab: 'scenes', target: 'shot', title: 'S', can: ALL, keys, cutaway: { kind: '' } }, {}));
  assert.ok(!shot.some((r) => /fill|Timing|Carry/.test(r.label)));
  assert.deepEqual(shot.find((r) => r.label === 'Not tracked').items.map((r) => [r.label, r.checked]), [['Off-screen', false], ['Cutaway', false]]);
  const cut = menuRows(full('cutaway')).map((r) => r.label);
  assert.deepEqual(cut.slice(0, 4), ['Off-screen', 'Cutaway', 'Carry the action across', 'Timing from this shot']);
  assert.ok(!cut.some((l) => /Older|Motion carried|Track it/.test(l)));
  const off = menuRows(scenesRowMenu({ tab: 'scenes', target: 'cutaway', title: 'S', can: ALL, keys, cutaway: { kind: 'offscreen', timing: true } }, {}));
  assert.deepEqual(off.slice(0, 3).map((r) => [r.label, r.checked]), [['Off-screen', true], ['Cutaway', false], ['Timing from this shot', true]], 'an action covers it: nothing to carry across');
});

test('keys: every row that mirrors a command names a registered one and shows its key', () => {
  for (const t of TARGETS) for (const r of deep(full(t))) {
    if (!r.cmd) continue;
    assert.ok(REG.has(r.cmd), `${t}: "${r.label}" -> ${r.cmd} is registered`);
    assert.equal(r.shortcut, REG.get(r.cmd).keys[0], `${t}: "${r.label}" shows its key`);
  }
  const by = (t, label) => deep(full(t)).find((r) => r.label === label);
  assert.equal(by('shot', 'Cutaway').shortcut, 'Alt+C', 'paw-qbvj: C is circle select');
  assert.equal(by('shot', 'Off-screen').shortcut, 'Shift+C', 'paw-2lp7.4: off-screen as quick as a cutaway');
  assert.equal(by('cutaway', 'Off-screen').shortcut, 'Shift+C');
  // paw-ef73.18: in the Scenes tab the single keys (K / M / Shift+M, Delete on a cut); elsewhere the chords; N: an action over the selection (paw-2lp7.5)
  assert.equal(by('multi', 'One action over them').shortcut, 'N');
  assert.equal(by('shot', 'Cut here').shortcut, 'K');
  assert.equal(by('shot', 'Merge with next shot').shortcut, 'M');
  assert.equal(by('shot', 'Merge with previous shot').shortcut, 'Shift+M');
  assert.equal(by('cut', 'Merge the two shots').shortcut, 'Delete');
  const inRefine = (t, label) => menuRows(full(t, 'refine')).find((r) => r.label === label);
  assert.equal(inRefine('shot', 'Cut here').shortcut, undefined);
  assert.ok(!/drag/i.test(by('shot', 'Cutaway').tip), 'a cutaway is no longer made by a drag');
  assert.equal(by('shot', 'Zoom to scene').shortcut, 'Alt+Shift+Z');
});

test('modifiers: ONE Modifier submenu in every tab, the same kinds everywhere; the Refine-only ones greyed with the reason outside Refine', () => {
  for (const t of ['shot', 'cutaway', 'multi']) for (const tab of ['scenes', 'track', 'refine']) {
    const fx = full(t, tab).filter((r) => r.id === 'fx');
    assert.equal(fx.length, 1, `${t} / ${tab}: one Modifier submenu`);
    assert.equal(fx[0].label, 'Modifier');
    const rows = fx[0].items.filter((x) => !x.separator), grey = rows.filter((x) => x.disabled);
    assert.equal(rows.length, 9, 'every kind once');
    if (tab === 'refine') assert.equal(grey.length, 0);
    else { assert.deepEqual(grey.map((x) => x.label), ['Spurt', 'Reshape', 'Climax run-in']); assert.ok(grey.every((x) => x.tip.includes(REFINE_WHY))); }
  }
  for (const t of ['cut', 'move']) assert.ok(!full(t).some((r) => r.id === 'fx'), `${t}: a boundary has no modifiers`);
});

test('everything that left the menu is still registered and has its home', () => {
  const lane = read('features/timeline/ScenesLane.svelte'), qb = read('features/timeline/SceneQuickBar.svelte');
  for (const gone of ['tagItems', 'Guide lines', 'Spurts from balls', 'Stabilise', 'Detect cumshots (proposed', 'Group shots into scenes', 'Offered by a merge'])
    assert.ok(!lane.includes(gone), `the Scenes row no longer carries "${gone}"`);
  // tags: on the scene itself (the quick bar: Scene / Shot chips, the Inspector, the Scenes panel rows)
  assert.match(qb, /\{#each VIEW as t/); assert.match(qb, /\{#each WHERE as t/); assert.match(qb, /onclick=\{whatMenu\}/); assert.match(qb, /\{#each EVENT_KINDS as k/);
  assert.match(read('features/timeline/InspectorPanel.svelte'), /<SceneQuickBar \{app\} \/>/);
  assert.match(read('features/tracking/ScenesPanel.svelte'), /<RegionChips /);   // paw-2lp7.5: the Actions panel tags the region
  assert.match(read('features/timeline/SceneChips.svelte'), /<SceneQuickBar /);
  // merge offers: the Scene popover (and the Scenes panel through it)
  assert.match(qb, /structure\.offer\(app, span\.shot, k, true\)/);
  // modifiers, spurts, cumshots, Stabilise: their rows, the Shot popover, the menus
  assert.match(read('features/timeline/FxLane.svelte'), /balls → spurts/);
  assert.match(read('features/timeline/CumBar.svelte'), /detect cumshots/);
  assert.match(qb, /cmd\(app, 'track\.stabilise'/);   // paw-m3b6: the Shot popover's Stabilize is the command
  assert.equal(REG.get('track.stabilise')?.menu, 'Track');
  assert.equal(REG.get('timeline.view.sceneGuides')?.menu, 'View', 'the guide lines toggle is in the View menu');
  for (const id of ['fx.spurtsFromBalls', 'timeline.cum.detect', 'track.stabilise', 'timeline.scene.group', 'timeline.view.sceneGuides', 'track.describeScene',
    'timeline.scene.offer.accept', 'timeline.scene.offer.drop', 'timeline.shot.take', 'timeline.shot.bridge.timing'])
    assert.ok(REG.has(id), `${id} is still a command (the palette)`);
});

test('paw-ef73.22: Fade in / Fade out only where the shot has none, Remove fade where it has one; still at most 10 rows', () => {
  const m = (can, target = 'shot') => menuRows(scenesRowMenu({ tab: 'scenes', target, title: 'S', can: { ...ALL, ...can }, keys, cutaway: { kind: target === 'cutaway' ? 'cutaway' : '' } }, {}));   // (a waiting bridge is rare and already fills the menu to 10)
  const labels = (can, t) => m(can, t).map((r) => r.label);
  assert.deepEqual(labels({ fadeIn: true, fadeOut: true }).filter((l) => /fade/i.test(l)), ['Fade in', 'Fade out']);
  assert.deepEqual(labels({ fadeOut: true, removeIn: true }).filter((l) => /fade/i.test(l)), ['Fade out', 'Remove fade']);
  assert.deepEqual(labels({ removeIn: true, removeOut: true }).filter((l) => /fade/i.test(l)), ['Remove fade in', 'Remove fade out']);
  assert.deepEqual(labels({}).filter((l) => /fade/i.test(l)), [], 'a shot with neither known: no fade items');
  for (const t of ['shot', 'cutaway']) for (const can of [{ fadeIn: true, fadeOut: true }, { removeIn: true, removeOut: true }, { fadeIn: true, removeOut: true }]) {
    assert.ok(m(can, t).length <= 10, `${t} ${JSON.stringify(can)}: ${m(can, t).length} rows`);
    for (const r of m(can, t)) assert.ok(r.tip && r.label.split(/\s+/).length <= 4);
  }
  assert.ok(m({ fadeIn: true }).find((r) => r.label === 'Fade in').cmd === 'timeline.fade.addIn' && REG.has('timeline.fade.addIn') && REG.has('timeline.fade.addOut'));
});
