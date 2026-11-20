// Every feature's real command list in one Registry, in boot.js order, and which command a key reaches in a few
// situations: the Blender keys (A, Alt+A, Ctrl+I, G, S, X, Shift+D) go to the editor that holds the keyboard and never
// take a key another feature owns there (L loop mark, digits, Insert); B / C are the timeline's box / circle select (paw-qbvj). Also: no two unguarded commands
// share a default key. The .svelte / .svelte.js modules compile for the server on load (runes become plain fields).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };   // Vite imports JSON without attributes
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});

const root = new URL('../src/', import.meta.url);
const { Registry } = await import(new URL('app/commands.js', root));
const { coreFor } = await import(new URL('app/core-commands.js', root));
const { default: projectCommands } = await import(new URL('app/project-commands.js', root));
const { tl } = await import(new URL('features/timeline/state.svelte.js', root));
const { tabsCommands } = await import(new URL('app/tabs.svelte.js', root));
const { default: editorCommands } = await import(new URL('app/editor-commands.js', root));

// boot.js FIRST: contextual features register before the broad editors, the shell's core last
const FIRST = ['palette', 'assist', 'tracking', 'timeline', 'review', 'inspector', 'graph', 'video', 'lanes'];
const featDir = new URL('features/', root);
const features = readdirSync(featDir).filter((f) => existsSync(new URL(`${f}/commands.js`, featDir))).sort();
const rank = (f) => { const i = FIRST.indexOf(f); return i < 0 ? FIRST.length : i; };
const lists = [];
for (const f of [...features].sort((a, b) => rank(a) - rank(b))) {
  // the timeline's commands.js gathers commands-*.js with import.meta.glob: load those directly, in file order
  const files = f === 'timeline' ? readdirSync(new URL('timeline/', featDir)).filter((n) => /^commands-.*\.js$/.test(n)).sort().map((n) => `timeline/${n}`) : [`${f}/commands.js`];
  for (const p of files) lists.push([f, (await import(new URL(p, featDir))).default]);
}

const stroke = Array.from({ length: 20 }, (_, i) => ({ at: i * 100, pos: i % 2 ? 90 : 10 }));
const app = {
  mode: 'refine', durationMs: 10000, mediaMs: 10000, view: { start: 0, span: 10000 }, follow: true, tasks: [],
  doc: { axes: { stroke }, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set() }, media: { path: 'x.mp4', durationMs: 10000, fps: 30 },
    range: null, plan: [], fx: [], scenes: [], chapters: [], bookmarks: [], loops: [], ghosts: [], cuts: [] },
  get script() { return this.doc.axes[this.doc.activeAxis] || []; },
  settings: { get: (k, d) => d, set() {} }, player: { timeMs: 0, frameMs: 1000 / 30, playing: false, rate: 1, loop: null },
  history: { canUndo: false, canRedo: false }, toast() {}, select() {}, edit() {}, transact(l, f) { f(); },
};
const reg = new Registry({ app, onError: () => {} });
app.commands = { keysFor: (id) => reg.keysFor(id), enabled: (id) => reg.enabled(id), get: (id) => reg.get(id), list: () => reg.list(), winner: (k, skip) => reg.winner(k, skip) };
reg.register(tabsCommands(app), 'app');   // createApp registers the tabs first (Ctrl+Tab)
reg.register(editorCommands, 'app');   // createApp: right after the tabs (paw-5z78)
for (const [f, l] of lists) reg.register(l, f);
reg.register(projectCommands, 'project');
reg.register(coreFor(features), 'app');

/** Keyboard focus: in an editor with role=application (a timeline row, the graph canvas) or not. */
const focusIn = (editor) => { globalThis.document = { activeElement: { closest: (sel) => (editor && /role=application|data-tl-lane/.test(sel) ? { matches: (s) => editor !== 'graph' && /data-tl-lane/.test(s) } : null), dataset: {} } }; };
const select = (ats) => { app.doc.selection = { axis: 'stroke', ats: new Set(ats) }; };
const expect = (table) => { for (const [k, id] of Object.entries(table)) assert.equal(reg.winner(k), id, k); };

test('loaded every feature\'s commands', () => {
  assert.ok(features.includes('lanes') && features.includes('timeline'));
  assert.ok(reg.get('lanes.grab') && reg.get('timeline.select.box') && reg.get('loop.mark'));
});

test('no default key is shared by two unguarded commands', () => {
  assert.deepEqual(reg.conflicts().map((c) => `${c.keys}: ${c.ids.join(', ')}`), []);
});

test("paw-idb5: F1 is the shortcut overlay (Shift+/ too), Ctrl+J the bottom tray; F1 is no other command's, in any tab", () => {
  assert.deepEqual(reg.keysFor('palette.help'), ['F1', 'Shift+/']);
  assert.equal(reg.get('layout.toggleBottom').title, 'Toggle bottom tray');
  assert.deepEqual(reg.keysFor('layout.toggleBottom'), ['Ctrl+J']);
  assert.deepEqual(reg.cmds.filter((c) => reg.keysFor(c.id).includes('F1')).map((c) => c.id), ['palette.help']);
  assert.deepEqual(reg.cmds.filter((c) => reg.keysFor(c.id).includes('Ctrl+J')).map((c) => c.id), ['layout.toggleBottom']);
  const was = app.mode;
  try { for (const m of ['scenes', 'track', 'refine', 'review']) { app.mode = m; expect({ F1: 'palette.help', 'Shift+/': 'palette.help' }); } } finally { app.mode = was; }
});

test('axis editor with a selection: the Blender keys; owned keys stay with their owners', () => {
  focusIn(false); select([100, 200]); tl.focus = null; tl.segs = [];
  expect({ G: 'lanes.grab', S: 'lanes.scale', X: 'lanes.deleteSelected', 'Shift+D': 'lanes.duplicateGrab', A: 'lanes.selectToggle', 'Alt+A': 'lanes.selectNone',
    'Ctrl+A': 'edit.selectAll', B: 'timeline.select.box', C: 'timeline.select.circle', M: 'video.sim',
    'Ctrl+I': 'lanes.invertSelection', Delete: 'lanes.delete', L: 'loop.mark', 5: null, Num5: 'lanes.point5', 1: 'lanes.mode.point', 3: 'lanes.mode.stroke', Insert: 'lanes.addPoint',
    'Shift+A': null, Space: 'player.toggle', ArrowLeft: 'lanes.nudgeLeft' });
});

test('axis editor without a selection: G / S / X / Shift+D do nothing, A still selects all', () => {
  focusIn(false); select([]);
  expect({ G: null, S: null, X: null, 'Shift+D': null, A: 'lanes.selectToggle', Num5: 'lanes.point5', 2: 'lanes.mode.segment' });
});

test('paw-qbvj: bookmarks are gone (no command, no key); B, C and A are the selection keys, Alt+C the cutaway; old overrides still win', () => {
  for (const id of ['bookmarks.add', 'bookmarks.delete', 'bookmarks.next', 'bookmarks.prev', 'palette.marks']) assert.equal(reg.get(id), null, id);
  assert.deepEqual(reg.bindings().filter(([id]) => /bookmark/i.test(id)), []);
  assert.deepEqual(reg.keysFor('timeline.select.box'), ['B']);
  assert.deepEqual(reg.keysFor('timeline.select.circle'), ['C']);
  assert.deepEqual(reg.keysFor('timeline.shot.cutaway'), ['Alt+C']);
  assert.deepEqual(reg.bindings().filter(([, k]) => k === 'Alt+C').map(([id]) => id), ['timeline.shot.cutaway'], 'Alt+C is no other command in any tab');
  assert.deepEqual(reg.bindings().filter(([, k]) => k === 'B').map(([id]) => id), ['timeline.select.box'], 'B is box select alone');
  assert.ok(!reg.conflicts({ all: true }).some((c) => c.ids.includes('timeline.shot.cutaway') || c.ids.includes('timeline.select.box')), 'the conflict finder: nothing');
  focusIn(false); select([]);
  for (const m of ['scenes', 'track', 'refine', 'review']) { app.mode = m; expect({ B: 'timeline.select.box', C: 'timeline.select.circle' }); }
  app.mode = 'refine';
  focusIn('graph');
  for (const k of ['B', 'C', 'A']) assert.ok(!/^(timeline\.select|lanes\.select)/.test(String(reg.winner(k))), 'the node graph keeps ' + k);
  focusIn(false);
  const getO = reg.getOverrides;
  reg.getOverrides = () => ({ 'timeline.shot.cutaway': ['C'], 'timeline.select.circle': ['Ctrl+Alt+Shift+F12'] }); reg.rebuild();
  try {
    assert.deepEqual(reg.keysFor('timeline.shot.cutaway'), ['C'], 'a stored override of the old key keeps winning');
    assert.deepEqual(reg.keysFor('timeline.select.circle'), ['Ctrl+Alt+Shift+F12']);
  } finally { reg.getOverrides = getO; reg.rebuild(); }
});

test('track mode: X stays the stroke-axis tool', () => {
  focusIn(false); select([100]); app.mode = 'track';
  try { assert.equal(reg.winner('X'), 'tracking.axisDraw'); } finally { app.mode = 'refine'; }
});

test('track mode: Tab is the Groups tool; G is move, always: it never opens Groups (selected points: grab)', () => {
  app.mode = 'track';
  try {
    focusIn(false); select([]);
    assert.deepEqual(reg.keysFor('tracking.groups'), ['Tab']);
    assert.equal(reg.winner('Tab'), 'tracking.groups');
    assert.notEqual(reg.winner('G'), 'tracking.groups', 'nothing selected: G does not open Groups');
    assert.ok(!reg.cmds.some((c) => c.id === 'tracking.groups' && reg.keysFor(c.id).includes('G')), 'G is no key of tracking.groups');
    select([100, 200]);
    assert.equal(reg.winner('G'), 'lanes.grab');
    assert.equal(reg.winner('Tab'), 'tracking.groups', 'selected points do not take Tab');
    // paw-iphl: a focused row keeps the key only when a command of its own applies there (none here: Groups; the test below)
  } finally { app.mode = 'refine'; select([]); }
});

test('Tab = Groups: a held Tab (auto-repeat) does not toggle it again; a user override of its keys wins', () => {
  app.mode = 'track';
  const cmd = reg.byId.get('tracking.groups'), run = cmd.run, ran = [];
  cmd.run = () => ran.push('toggle');
  const tab = (repeat) => ({ key: 'Tab', code: 'Tab', repeat, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, target: null, timeStamp: 1, preventDefault() { this.prevented = true; } });
  try {
    focusIn(false); select([]);
    assert.ok(reg.handleKey(tab(false)));
    for (let k = 0; k < 5; k++) { const e = tab(true); assert.ok(reg.handleKey(e), 'a repeat is eaten'); assert.ok(e.prevented); }
    assert.deepEqual(ran, ['toggle'], 'one press, one toggle');
    assert.ok(reg.handleKey(tab(false)));
    assert.deepEqual(ran, ['toggle', 'toggle'], 'the next press toggles again');
    const getO = reg.getOverrides;
    reg.getOverrides = () => ({ 'tracking.groups': ['Ctrl+Alt+Shift+F11'] }); reg.rebuild();
    try {
      assert.deepEqual(reg.keysFor('tracking.groups'), ['Ctrl+Alt+Shift+F11']);
      assert.equal(reg.winner('Ctrl+Alt+Shift+F11'), 'tracking.groups', 'the stored override keeps winning');
      assert.notEqual(reg.winner('Tab'), 'tracking.groups', 'and Tab is no longer its key');
    } finally { reg.getOverrides = getO; reg.rebuild(); }
  } finally { cmd.run = run; app.mode = 'refine'; }
});

test('paw-rw84: T is Track (the point grid), Ctrl+T is Track ROI (the panel tracker); each runs its own command', async () => {
  const { trackingFor } = await import(new URL('features/tracking/tracking.svelte.js', root));
  const T = trackingFor(app), ran = [];
  let grid = true, roi = true;
  Object.defineProperty(T, 'canGrid', { get: () => grid, configurable: true });
  Object.defineProperty(T, 'canTrack', { get: () => roi, configurable: true });
  // paw-x8we: no part painted here; Ctrl+T tracks a box set by code (as Describe / a plan / Fix leave one)
  Object.defineProperty(T, 'trackRoi', { get: () => (roi ? { kind: 'box', x: 0.3, y: 0.3, w: 0.2, h: 0.2 } : null), configurable: true });
  T.gridFrame = () => ran.push('grid');
  T.track = () => ran.push('roi');
  app.mode = 'track';
  try {
    focusIn(false); select([]);
    expect({ T: 'track.gridFrame', 'Ctrl+T': 'track.run', 'Shift+T': 'track.plan' });
    assert.deepEqual(reg.keysFor('track.gridFrame'), ['T']);
    assert.deepEqual(reg.keysFor('track.run'), ['Ctrl+T']);
    reg.run(reg.winner('T')); reg.run(reg.winner('Ctrl+T'));
    assert.deepEqual(ran, ['grid', 'roi']);
    grid = false;   // no point tracker / busy: T says why (paw-u0ik: it was a dead key), Ctrl+T still tracks the ROI
    expect({ T: 'track.gridFrame', 'Ctrl+T': 'track.run' });
    const toast = app.toast, said = [];
    app.toast = (m) => said.push(m);
    try { reg.run('track.gridFrame'); } finally { app.toast = toast; }
    assert.deepEqual(ran, ['grid', 'roi'], 'no grid run');
    assert.equal(said.length, 1, 'one toast says why');
    roi = false;
    expect({ T: 'track.gridFrame', 'Ctrl+T': null });
    // the Track menu lists Track first, then Track ROI
    const menu = reg.list({ enabled: false }).filter((c) => c.menu === 'Track' && c.source === 'tracking').map((c) => c.id);
    assert.deepEqual(menu.slice(0, 2), ['track.gridFrame', 'track.run']);
  } finally { app.mode = 'refine'; grid = false; roi = false; }
});

test('stage tabs (paw-ef73.1): Ctrl+1..4 = Scenes, Track, Refine, Review; the Track keys stay in Track', () => {
  expect({ 'Ctrl+1': 'mode.scenes', 'Ctrl+2': 'mode.track', 'Ctrl+3': 'mode.refine', 'Ctrl+4': 'mode.review' });
  for (const mode of ['scenes', 'refine', 'review']) {
    app.mode = mode;
    try {
      focusIn(false); select([]);
      for (const k of ['T', 'Ctrl+T', 'G', 'Tab', ...(mode === 'scenes' ? ['F'] : [])]) assert.ok(!/^(track|tracking)\./.test(String(reg.winner(k))), `${mode}: ${k} -> ${reg.winner(k)}`);
      if (mode !== 'scenes') assert.equal(reg.winner('F'), 'track.flipAtPlayhead', `${mode}: F flips`);   // paw-7mj0
      select([100]);
      assert.equal(reg.winner('X'), 'lanes.deleteSelected', `${mode}: X deletes the selected points`);
    } finally { app.mode = 'refine'; }
  }
});

test('another editor holds the keyboard: the axis editor lets its Blender keys go', () => {
  focusIn(true); select([100, 200]); tl.focus = null;
  for (const k of ['G', 'S', 'X', 'Shift+D', 'A', 'Alt+A', 'Ctrl+I']) assert.ok(!String(reg.winner(k)).startsWith('lanes.'), k);
});

test('a focused timeline row takes A / Alt+A / Ctrl+I / G / X for its own selection', () => {
  focusIn(true); select([100, 200]);
  app.doc.plan = [{ id: 's1', t0: 0, t1: 1000, kind: 'main' }, { id: 's2', t0: 1000, t1: 2000, kind: 'main' }];
  app.doc.fx = [{ id: 'f1', kind: 'orgasm', t0: 0, t1: 500 }];
  app.doc.scenes = [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }];
  app.doc.chapters = [{ id: 'c1', t0: 0, t1: 3000, name: 'a' }];
  try {
    tl.focus = 'plan'; tl.segs = ['s1'];
    expect({ A: 'timeline.plan.selectToggle', 'Ctrl+A': 'timeline.plan.selectAll', 'Alt+A': 'timeline.plan.selectNone', 'Ctrl+I': 'timeline.plan.invertSelection', G: 'timeline.plan.grab', X: 'timeline.plan.delete', S: 'timeline.plan.split', B: 'timeline.select.box', C: 'timeline.select.circle' });
    reg.run('timeline.plan.selectToggle');
    assert.deepEqual(tl.segs, [], 'A with a segment selected: none');
    reg.run('timeline.plan.selectToggle');
    assert.deepEqual(tl.segs, ['s1', 's2'], 'A with none: all');
    tl.segs = ['s1'];
    reg.run('timeline.plan.invertSelection');
    assert.deepEqual(tl.segs, ['s2']);
    tl.segs = [];
    expect({ G: null, X: null, A: 'timeline.plan.selectToggle' });
    tl.focus = 'fx'; tl.fx = 'f1'; tl.fxSel = [];
    expect({ A: 'timeline.fx.selectToggle', 'Ctrl+A': 'timeline.fx.selectAll', 'Alt+A': 'timeline.fx.selectNone', 'Ctrl+I': 'timeline.fx.invertSelection', G: 'timeline.fx.grab', X: 'timeline.fx.delete' });
    reg.run('timeline.fx.invertSelection');
    assert.deepEqual([tl.fx, tl.fxSel], [null, []]);
    reg.run('timeline.fx.selectToggle');
    assert.deepEqual([tl.fx, tl.fxSel], ['f1', ['f1']], 'A with none: every modifier');
    reg.run('timeline.fx.selectToggle');
    assert.deepEqual([tl.fx, tl.fxSel], [null, []], 'A again: none');
    const fx0 = app.doc.fx, toast = app.toast, said = [];
    app.doc.fx = []; app.toast = (m) => said.push(m);
    try { reg.run('timeline.fx.selectToggle'); } finally { app.doc.fx = fx0; app.toast = toast; }
    assert.deepEqual(said, ['No modifiers to select'], 'nothing to select: it says why');
    tl.focus = 'scenes';
    // paw-k2u: the Scenes row selects shots: A / Alt+A / Ctrl+I, and X / Delete remove the cuts in the selection
    expect({ A: 'timeline.scene.selectToggle', 'Ctrl+A': 'timeline.scene.selectAll', 'Alt+A': 'timeline.scene.selectNone', 'Ctrl+I': 'timeline.scene.invertSelection', X: 'timeline.scene.delete', G: null });
    reg.run('timeline.scene.selectAll');
    assert.deepEqual([tl.scene, tl.shots], [0, [0, 1]]);
    reg.run('timeline.scene.invertSelection');
    assert.deepEqual(tl.shots, []);
    // paw-1w0x: no Chapters row, so no marker selection keys
    for (const id of ['chapters.selectNone', 'chapters.delete', 'chapters.add', 'chapters.next']) assert.equal(reg.get(id), null, id);
  } finally {
    tl.focus = null; tl.segs = []; tl.fx = null; tl.scene = -1; tl.shots = [];
    Object.assign(app.doc, { plan: [], fx: [], scenes: [], chapters: [] });
  }
});

test('shiftFx moves a group of effects as one, clamped inside the video', async () => {
  const { shiftFx } = await import(new URL('features/timeline/commands-fx.js', root));
  const l = [{ id: 'a', t0: 100, t1: 300 }, { id: 'b', t0: 500, t1: 900 }, { id: 'c', t0: 0, t1: 50 }];
  assert.deepEqual(shiftFx(l, ['a', 'b'], 50, 1000).list.map((e) => [e.t0, e.t1]), [[150, 350], [550, 950], [0, 50]]);
  assert.equal(shiftFx(l, ['a', 'b'], 500, 1000).dt, 100, 'b stops at the end');
  assert.equal(shiftFx(l, ['a', 'b'], -500, 1000).dt, -100, 'a stops at 0');
  assert.equal(shiftFx(l, ['zz'], 50, 1000).list, l);
});

test('paw-ef73.18: the Scenes tab single keys win there and only there; each edit is one undo step, on frame starts', () => {
  focusIn(false); select([]); tl.focus = null; tl.scene = -1; tl.shots = []; tl.cut = null;
  const fm = 1000 / 30, F = (n) => Math.round(n * fm), seek = app.player.seek, transact = app.transact;
  const three = () => [{ start_ms: 0, end_ms: F(90) }, { start_ms: F(90), end_ms: F(180), join: true }, { start_ms: F(180), end_ms: 10000 }];
  const starts = () => app.doc.scenes.map((s) => s.start_ms), bounds = () => app.doc.scenes.map((s, k) => (k && s.join !== true ? 'S' : k ? 'c' : '')).join('');
  let steps = 0;
  app.player.seek = (t) => { app.player.timeMs = t; };
  app.transact = (l, f) => { steps++; f(); };
  app.doc.scenes = three();
  try {
    for (const m of ['track', 'refine', 'review']) {   // the letters keep their meanings outside the Scenes tab
      app.mode = m;
      for (const k of ['K', 'M', 'Shift+M', 'N', '[', ']', 'Shift+[', 'Shift+]', ',', '.', 'S', 'E', '1', '5', 'Enter']) assert.ok(!/^timeline\.(key|acts)\./.test(String(reg.winner(k))), `${m}: ${k} -> ${reg.winner(k)}`);
      assert.equal(reg.get('timeline.key.cut').when(app), false);
    }
    app.mode = 'scenes';
    expect({ K: 'timeline.key.cut', M: 'timeline.key.mergeNext', 'Shift+M': 'timeline.key.mergePrev', N: 'timeline.acts.new', C: 'timeline.select.circle', 'Alt+C': 'timeline.shot.cutaway', 'Shift+C': 'timeline.shot.offscreen', 1: 'timeline.acts.mru1', 9: 'timeline.acts.mru9', E: null,
      '[': 'timeline.key.prevCut', ']': 'timeline.key.nextCut', 'Shift+[': 'timeline.key.prevScene', 'Shift+]': 'timeline.key.nextScene',
      ',': 'timeline.key.nudgeEarlier', '.': 'timeline.key.nudgeLater', 'Shift+Z': 'timeline.zoom.frames', Space: 'player.toggle',
      'Alt+Shift+K': 'timeline.scene.split', 'Alt+Shift+M': 'timeline.scene.merge' });
    // K: the shot cut at the playhead's frame start
    app.player.timeMs = F(40) + 7; steps = 0;
    reg.run('timeline.key.cut');
    assert.deepEqual([steps, starts()], [1, [0, F(40), F(90), F(180)]]);
    // M: the shot there (now selected: 1) with the one to its right; again across the scene boundary: the scenes merge too
    reg.run('timeline.key.mergeNext');
    assert.deepEqual([steps, starts(), bounds()], [2, [0, F(40), F(180)], 'cS']);
    reg.run('timeline.key.mergeNext');
    assert.deepEqual([steps, starts(), bounds()], [3, [0, F(40)], 'c']);
    reg.run('timeline.key.mergePrev');
    assert.deepEqual([steps, starts()], [4, [0]]);
    // paw-2lp7.5, the keyboard path: N = an action region over the selected shots (else the shot at the playhead) with the
    // last-used action; 1-9 = the recent actions (none yet: nothing); with a region selected S / K / M / [ / ] / Delete / Enter are its
    app.doc.scenes = three(); app.doc.acts = []; tl.scene = -1; tl.shots = []; app.player.timeMs = F(120); steps = 0;
    const regs = () => app.doc.acts.map((r) => `${r.layer}:${Math.round(r.t0 / fm)}-${Math.round(r.t1 / fm)}:${r.tags.join('+')}`);
    reg.run('timeline.acts.new');
    assert.deepEqual([steps, regs(), starts()], [1, ['0:90-180:'], [0, F(90), F(180)]], 'an untagged region over the shot at the playhead; the cuts stay');
    reg.run('timeline.acts.mru1');
    assert.equal(steps, 1, 'no recent action yet: nothing');
    const settings = app.settings;
    let mru = [['anal', 'penetration'], ['oral', 'penetration']];
    app.settings = { get: (k, d) => (k === 'timeline.actMru' ? mru : d), set: (k, v) => { if (k === 'timeline.actMru') mru = v; } };
    tl.scene = 0; tl.shots = [0];
    reg.run('timeline.acts.mru2');
    assert.deepEqual([steps, regs()], [2, ['0:0-90:oral+penetration', '0:90-180:']], '2 = the second recent action, over the selected shot');
    assert.deepEqual(mru[0], ['oral', 'penetration'], 'it is the most recent now');
    tl.act = app.doc.acts[1].id; tl.scene = -1; tl.shots = [];
    expect({ S: 'timeline.acts.split', K: 'timeline.acts.split', M: 'timeline.acts.mergeKey', '[': 'timeline.acts.startHere', ']': 'timeline.acts.endHere',
      Delete: 'timeline.acts.delete', Enter: 'timeline.acts.enter', 1: 'timeline.acts.mru1', E: 'timeline.acts.extend' });
    reg.run('timeline.acts.mru2');   // on the selected region: its tags
    assert.deepEqual([steps, regs()], [3, ['0:0-90:oral+penetration', '0:90-180:anal+penetration']]);
    app.player.timeMs = F(130);
    reg.run('timeline.acts.split');
    assert.deepEqual([steps, regs()], [4, ['0:0-90:oral+penetration', '0:90-130:anal+penetration', '0:130-180:anal+penetration']]);
    reg.run('timeline.acts.mergeKey');
    assert.deepEqual([steps, regs()], [5, ['0:0-90:oral+penetration', '0:90-180:anal+penetration']], 'M: merged with the same action again');
    app.player.timeMs = F(100);
    reg.run('timeline.acts.startHere');
    assert.deepEqual([steps, regs()], [6, ['0:0-90:oral+penetration', '0:100-180:anal+penetration']], '[: its start to the playhead');
    app.player.timeMs = F(150);
    reg.run('timeline.acts.endHere');
    assert.deepEqual([steps, regs()], [7, ['0:0-90:oral+penetration', '0:100-150:anal+penetration']], ']: its end to the playhead');
    reg.run('timeline.acts.extend');
    assert.deepEqual([steps, regs()], [8, ['0:0-90:oral+penetration', '0:100-180:anal+penetration']], 'E: to the end of this shot');
    reg.run('timeline.acts.extend');
    assert.equal(regs()[1], '0:100-300:anal+penetration', 'E again: through the next cut');
    reg.run('timeline.acts.delete');
    assert.deepEqual([regs(), tl.act], [['0:0-90:oral+penetration'], null], 'Delete: the selected region');
    app.settings = settings; app.doc.acts = []; steps = 0;
    // , / .: the cut nearest the playhead a frame later / earlier, the playhead with it; a selected cut first
    app.doc.scenes = three(); tl.scene = -1; tl.shots = []; app.player.timeMs = F(100); steps = 0;
    reg.run('timeline.key.nudgeLater');
    assert.deepEqual([steps, starts(), app.player.timeMs], [1, [0, F(91), F(180)], F(91)]);
    reg.run('timeline.key.nudgeEarlier');
    assert.deepEqual(starts(), [0, F(90), F(180)]);
    tl.cut = F(180);
    reg.run('timeline.key.nudgeEarlier');
    assert.deepEqual([starts(), tl.cut], [[0, F(90), F(179)], F(179)]);
    // Delete on the selected cut (the row not focused): merge across it, the scenes too
    assert.equal(reg.winner('Delete'), 'timeline.scene.delete');
    reg.run('timeline.scene.delete');
    assert.deepEqual([starts(), bounds(), tl.cut], [[0, F(90)], 'c', null]);
    // [ ] cuts, Shift+[ ] scenes
    app.doc.scenes = three(); app.player.timeMs = F(100);
    reg.run('timeline.key.nextCut'); assert.equal(app.player.timeMs, F(180));
    reg.run('timeline.key.prevCut'); assert.equal(app.player.timeMs, F(90));
    app.doc.acts = [{ id: 'a1', kind: 'act', t0: F(40), t1: F(180), layer: 0, tags: [] }];   // paw-2lp7.5: Shift+[ ] = the action edges
    reg.run('timeline.key.nextScene'); assert.equal(app.player.timeMs, F(180));
    app.player.timeMs = F(100); reg.run('timeline.key.prevScene'); assert.equal(app.player.timeMs, F(40));
    reg.run('timeline.key.prevScene'); assert.equal(app.player.timeMs, F(40), 'no earlier action edge: stays');
    app.doc.acts = [];
    app.doc.scenes = [];
    assert.equal(reg.get('timeline.key.cut').when(app), false, 'no scenes: the keys are free');
  } finally {
    app.mode = 'refine'; app.player.seek = seek; app.transact = transact; app.player.timeMs = 0;
    tl.scene = -1; tl.shots = []; tl.cut = null; tl.act = null; app.doc.scenes = []; app.doc.acts = [];
  }
});

test('paw-pj8l: the panic stop is the only `anywhere` command, on Shift+Esc and Pause, whatever the tab scope', () => {
  assert.deepEqual(reg.cmds.filter((c) => c.anywhere).map((c) => c.id), ['playback.panic']);
  assert.deepEqual(reg.keysFor('playback.panic'), ['Shift+Escape', 'Pause']);
  const was = reg.scope;
  reg.scope = () => false;   // the project page
  try { assert.equal(reg.enabled('playback.panic'), true); } finally { reg.scope = was; }
});

test('paw-rbrd: the first-run card\'s "Hide furry items" (view.furry) runs on the project page with a document open behind it', async () => {
  const { homeAllows } = await import(new URL('app/tabs.svelte.js', root));
  assert.ok(reg.get('view.furry'));
  assert.equal(homeAllows('view.furry'), true);
  const was = reg.scope;
  reg.scope = (c) => homeAllows(c.id);   // the home tab hides a document: only what homeAllows admits runs
  try { assert.equal(reg.enabled('view.furry'), true); assert.equal(reg.enabled('lanes.grab'), false); } finally { reg.scope = was; }
});
test('the Quick menu: Shift+Q, no other command\'s key in any tab (Q stays Repeat last stroke), rebindable, on the project page too', async () => {
  const { homeAllows } = await import(new URL('app/tabs.svelte.js', root));
  assert.deepEqual(reg.keysFor('quick.open'), ['Shift+Q']);
  assert.deepEqual(reg.bindings().filter(([, k]) => k === 'Shift+Q' || k.startsWith('Shift+Q ')).map(([id]) => id), ['quick.open']);
  assert.ok(!reg.conflicts({ all: true }).some((c) => c.ids.includes('quick.open')), 'the conflict finder: nothing');
  assert.ok(reg.keysFor('lanes.repeatStroke').includes('Q'));
  const was = app.mode;
  try { for (const m of ['scenes', 'track', 'refine', 'review']) { app.mode = m; focusIn(false); select([100]); expect({ 'Shift+Q': 'quick.open' }); } } finally { app.mode = was; select([]); }
  assert.equal(homeAllows('quick.open'), true);
  const scope = reg.scope;
  reg.scope = (c) => homeAllows(c.id);
  try { assert.equal(reg.winner('Shift+Q'), 'quick.open'); } finally { reg.scope = scope; }
  // the keybinding editor's path (setKeys): a rebinding takes, null resets
  const o = {}, r = new Registry({ app, getOverrides: () => o, setOverrides: (x) => { for (const k in o) delete o[k]; Object.assign(o, x); } });
  r.register(reg.cmds.filter((c) => c.id === 'quick.open'));
  r.setKeys('quick.open', ['Alt+Q']);
  assert.deepEqual(r.keysFor('quick.open'), ['Alt+Q']);
  r.setKeys('quick.open', null);
  assert.deepEqual(r.keysFor('quick.open'), ['Shift+Q']);
});

test('paw-iphl: Track tab, a focused timeline row (the shot band, the ruler): Tab opens Groups; a user who put Groups back on G: selected points keep their G and the press says why', () => {
  const was = app.mode, getO = reg.getOverrides;
  app.mode = 'track';
  try {
    focusIn(true); select([]);
    assert.equal(reg.winner('Tab'), 'tracking.groups', 'a focused row: Tab is Groups');
    reg.getOverrides = () => ({ 'tracking.groups': ['G'] }); reg.rebuild();
    assert.equal(reg.winner('G'), 'tracking.groups', 'overridden to G, a focused row that has no G: Groups');
    focusIn(false); select([100, 200]);
    assert.equal(reg.winner('G'), 'lanes.grab', 'selected points: their grab');
    assert.match(reg.whyNot('tracking.groups'), /G goes to/, 'and the press says why');
  } finally { reg.getOverrides = getO; reg.rebuild(); app.mode = was; select([]); focusIn(false); }
});
test('paw-5zpf: E extrudes, F flips in every tab; R rotates, V records, . is the pivot', () => {
  focusIn(false); select([100, 200]); tl.focus = null; tl.segs = [];
  expect({ E: 'lanes.extrude', F: 'track.flipAtPlayhead', R: 'lanes.rotate', V: 'lanes.record', '.': 'lanes.pivotMenu', W: 'lanes.nextPoint', 'Shift+W': 'lanes.prevPoint' });
  assert.equal(reg.keyOk('track.flipAtPlayhead'), true, 'F reaches the flip in Refine too');
  select([]);
});