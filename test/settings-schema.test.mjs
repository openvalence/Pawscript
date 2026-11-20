// paw-9fop: the settings schema is the Settings panel (features/settings is generated from it), so every entry must name its
// group and label, read as UI copy, render with a control, and keep today's defaults; private settings are logged by key only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { SCHEMA, GROUPS, Settings, schemaEntries, metaOf } = await import('../src/app/settings.svelte.js');
const L = await import('../src/features/settings/logic.js');

test('every setting names a known group and a label; groups keep their order', () => {
  const bad = Object.keys(SCHEMA).filter((k) => !GROUPS.includes(metaOf(k).group) || metaOf(k).label === k || !SCHEMA[k].doc);
  assert.deepEqual(bad, []);
  assert.deepEqual(GROUPS, ['General', 'Keyboard', 'Playback & device', 'Video & cache', 'Tracking', 'Models', 'Timeline & lanes', 'Machine & Stroker', 'Projects & tabs', 'Content', 'Updates', 'Advanced']);
  const order = schemaEntries().map((e) => GROUPS.indexOf(e.group));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(Object.keys(SCHEMA).length >= 100, `${Object.keys(SCHEMA).length} settings`);
  assert.equal(SCHEMA['keys.uiNavigation'].label, 'Keyboard navigation of the interface');
  assert.equal(SCHEMA['keys.uiNavigation'].group, 'Keyboard');
});

// docs/copy.md (Phosphor COPY.md rules 2, 3, 10; strings.md Everywhere; governance C-11): the panel shows label and doc
test('labels and docs read as UI copy: short, one fragment, sentence case, plain words, American spelling', () => {
  const bad = [];
  for (const k of Object.keys(SCHEMA)) {
    for (const [what, t] of [['label', metaOf(k).label], ['doc', String(SCHEMA[k].doc || '')]]) {
      const why = t.length > 60 ? 'over 60 characters' : /[a-z)]\. \S/.test(t) ? 'a second sentence' : /[a-z)]\.$/.test(t) ? 'a trailing period'
        : /^[a-z]/.test(t) ? 'not sentence case' : /\b(so that|allows you|in order to|simply|just|please|successfully)\b/i.test(t) ? 'filler'
        : /\u2014|\bAI\b/.test(t) ? 'em dash or AI' : /\b(sidecar|pawtrack|paw-[a-z0-9]{3,})\b|\bowner\b/i.test(t) ? 'internal name'
        : /\b(colours?|behaviour|centres?|grey|favourite|modell(ed|ing)|labell(ed|ing))\b/i.test(t) ? 'British spelling' : '';
      if (why) bad.push(`${k} ${what}: ${why}: "${t}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every preference renders with a control (type coverage); only read-only and internal ones show a summary', () => {
  const kinds = new Set(), bad = [];
  for (const e of schemaEntries()) {
    const c = L.controlOf(e, e.options || (e.key === 'review.profile' || e.key === 'tracking.lastTracker' ? [{ value: '', label: 'x' }, { value: 'a', label: 'y' }, { value: 'b', label: 'z' }, { value: 'c', label: 'w' }] : undefined));
    kinds.add(c);
    if (c === 'readonly' && !e.internal && !e.readonly) bad.push(e.key);
    if (e.options && !e.options.some((o) => o.value === e.default)) bad.push(`${e.key}: default is not a choice`);
    // a null default is derived (machine.forceLbf: the machine's own; machine.height: the character's own)
    if (e.type === 'number' && !e.options && e.default !== null && !(e.min <= e.default && e.default <= e.max)) bad.push(`${e.key}: default outside min / max`);
    // the kit NumberField snaps to min + k * step: a default off that grid would move the first time the field is touched
    if (e.type === 'number' && !e.options && e.default !== null && Math.abs(Math.round((e.default - e.min) / (e.step ?? 1)) * (e.step ?? 1) - (e.default - e.min)) > 1e-9) bad.push(`${e.key}: default off the field's step grid`);
  }
  assert.deepEqual(bad, []);
  for (const k of ['switch', 'segmented', 'select', 'number', 'folders', 'readonly']) assert.ok(kinds.has(k), k);
});

// the resolved defaults of the 66 settings the schema had before the panel (HEAD d923e88): unchanged by its metadata
const BEFORE = { 'autosave.seconds': 30, 'backup.keep': 10, 'content.furry': true, 'edit.cleanMicro': true, 'edit.cleanMicroMs': 60, 'edit.cleanMicroPos': 6, 'edit.posStep': 5, 'edit.snapFrames': true, 'feedback.markers': true, 'history.capActions': 4000000, 'history.coalesceMs': 1000, 'keys.overrides': {}, 'layout': null, 'layout.docks': {}, 'media.cacheGb': 2, 'mode': 'scenes', 'palette.recent': [], 'player.follow': true, 'player.rate': 1, 'recent': [], 'timeline.frameCursor': 'full', 'timeline.repeats': true, 'tracking.blobs.axis': true, 'tracking.blobs.bodies': true, 'tracking.blobs.bodiesOpacity': 100, 'tracking.blobs.camera': true, 'tracking.blobs.cameraOpacity': 80, 'tracking.blobs.decimate': 'all', 'tracking.blobs.extra': true, 'tracking.blobs.follow': 'selection', 'tracking.blobs.fusion': true, 'tracking.blobs.heat': true, 'tracking.blobs.heatOpacity': 70, 'tracking.blobs.heatShows': 'both', 'tracking.blobs.heatSize': 1.6, 'tracking.blobs.hud': false, 'tracking.blobs.hulls': false, 'tracking.blobs.hullsOpacity': 40, 'tracking.blobs.labels': 'short', 'tracking.blobs.occluded': false, 'tracking.blobs.opacity': 100, 'tracking.blobs.points': true, 'tracking.blobs.pointsOpacity': 90, 'tracking.blobs.primary': true, 'tracking.blobs.seeded': true, 'tracking.blobs.seededOpacity': 100, 'tracking.blobs.smooth': 'off', 'tracking.blobs.spark': true, 'tracking.blobs.trails': true, 'tracking.channelFit': {}, 'tracking.direction': 'both', 'tracking.dock.collapsed': false, 'tracking.dock.hidden': [], 'tracking.gridPoints': 512, 'tracking.lastTracker': '', 'tracking.laneGroups': true, 'tracking.seeder.features': 'auto', 'tracking.seeder.folders': [], 'tracking.seeder.sam': true, 'tracking.trails': 'groups', 'ui.density': 'default', 'ui.theme': 'dark', 'usage.log': true, 'video.scrubCache': true, 'view.seekStepMs': 1000 };
// the settings promoted from hard-coded behaviour: their default is what the code did before
const PROMOTED = { 'ui.toastErrorS': 9, 'video.proxyHeight': 720, 'tracking.model': 'auto', 'tracking.boxPoints': 64, 'tracking.smartStroke': true, 'tracking.retrackKeep': false, 'tracking.groups.barOpacity': 48,
  'lanes.dragAction': 'box', 'lanes.dblClick': 'add', 'project.newIn': 'beside', 'tabs.reopen': true, 'project.checkpoints': 20, 'project.unchangedSave': 'dialog', 'project.commitAsk': true, 'content.taggerTags': true,
  'tabs.memoryMB': 1200, 'tracking.stallTimeoutS': 600, 'tracking.startTimeoutS': 180, 'tracking.describeTimeoutS': 180, 'tracking.groups.brush': 0.04, 'tracking.groups.margin': 15, 'tracking.suggest.confidence': 0.8, 'onboard.hints': null, 'review.profile': 'generic' };
test('defaults are today’s behaviour: the earlier schema’s resolved defaults, the promoted ones, every literal fallback in src/', async () => {
  const s = new Settings(null), J = JSON.stringify;
  for (const [k, v] of Object.entries({ ...BEFORE, ...PROMOTED })) assert.equal(J(s.get(k)), J(v), k);
  // a feature's get('key', fallback) ignores the fallback once the key is in the schema: each literal one must equal the default
  const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : /\.(js|svelte)$/.test(n) && o.push(p); } return o; };
  const re = /\b(?:get|g)\??\.?\(\s*'([\w.]+)'\s*,\s*(true|false|null|-?[\d.]+|'[^']*'|\[\]|\{\}|\[[\d, ]+\])\s*\)/g, bad = [];
  let n = 0;
  for (const f of walk(join(ROOT, 'src'))) for (const m of readFileSync(f, 'utf8').matchAll(re)) {
    if (!SCHEMA[m[1]]) continue;
    n++;
    if (J(JSON.parse(m[2].replace(/'/g, '"'))) !== J(SCHEMA[m[1]].default)) bad.push(`${f.slice(ROOT.length)}: ${m[1]} ${m[2]} vs ${J(SCHEMA[m[1]].default)}`);
  }
  assert.ok(n > 60, `fallbacks read (${n})`);
  assert.deepEqual(bad, []);
  // the hard-coded values the promoted settings replace
  const { defaultProxy } = await import('../src/features/video/transport.js');
  assert.equal(defaultProxy([1080, 720, 480]), 720);
  assert.equal(defaultProxy([1080, 720, 480], 480), 480);
  assert.equal(defaultProxy([1080, 720, 480], 1080), 1080);
  const { pruneCheckpoints } = await import('../src/app/project-history.js');
  const day = Date.UTC(2026, 10, 18, 12), list = Array.from({ length: 30 }, (_, i) => ({ id: String(i), at: day + i * 60000, auto: true }));
  assert.equal(pruneCheckpoints(list).keep.length, 20);
  assert.equal(pruneCheckpoints(list, { recent: s.get('project.checkpoints') }).keep.length, 20);
  assert.equal(pruneCheckpoints(list, { recent: 5 }).keep.length, 5);
});

test('a value that does not fit the schema reads as the default; accepts() says so before a write', () => {
  const s = new Settings(null);
  s.set('video.proxyHeight', 900); s.set('tabs.memoryMB', 'lots'); s.set('lanes.dragAction', 'fly'); s.set('onboard.hints', 'yes'); s.set('media.cacheGb', 0.1);
  assert.equal(s.get('video.proxyHeight'), 720); assert.equal(s.get('tabs.memoryMB'), 1200); assert.equal(s.get('lanes.dragAction'), 'box'); assert.equal(s.get('onboard.hints'), null); assert.equal(s.get('media.cacheGb'), 2);
  s.set('tracking.stallTimeoutS', 0.15);   // a field's min / max bound the panel only: what features (and tests) set stays as before
  assert.equal(s.get('tracking.stallTimeoutS'), 0.15);
  assert.equal(s.accepts('video.proxyHeight', 480), true); assert.equal(s.accepts('video.proxyHeight', 481), false);
  assert.equal(s.accepts('no.such.key', { az: 1 }), true);   // a key the schema does not list: anything
  assert.equal(s.accepts('machine.cam', { az: 1 }), true);   // an object held as state (default null): any object
  s.set('onboard.hints', false);
  assert.equal(s.get('onboard.hints'), false);
});

test('panel model: search by label, doc or key; internal rows only with advanced; changed and reset', () => {
  const s = new Settings(null);
  const keys = (o) => L.visibleEntries(o).map((e) => e.key);
  assert.ok(keys({ query: 'checkpoints' }).includes('project.checkpoints'));
  assert.ok(keys({ query: 'tabs.memory' }).includes('tabs.memoryMB'));
  assert.ok(keys({ query: 'quiet note' }).includes('project.unchangedSave'));   // its doc
  assert.ok(!keys({}).includes('layout') && keys({ advanced: true }).includes('layout'));
  assert.ok(!keys({}).some((k) => k.startsWith('tracking.blobs.')));
  assert.deepEqual(L.grouped(L.visibleEntries({ query: 'zzz-nothing' })), []);
  assert.equal(L.isChanged(s, 'tabs.memoryMB'), false);
  s.set('tabs.memoryMB', 2000);
  assert.equal(L.isChanged(s, 'tabs.memoryMB'), true);
  const seen = [];
  s.onSet = (k, from, to) => seen.push([k, from, to]);
  s.reset('tabs.memoryMB');
  assert.equal(L.isChanged(s, 'tabs.memoryMB'), false);
  assert.deepEqual(seen, [['tabs.memoryMB', 2000, undefined]]);
});

test('export / import a settings file; Reset all clears preferences, keeps internal state and unknown keys', () => {
  const s = new Settings(null);
  s.set('ui.theme', 'light'); s.set('layout', { scenes: {} }); s.set('machine.cam', { az: 2 }); s.set('lanes.dragAction', 'pan');
  const text = L.exportText(s);
  const t = new Settings(null);
  const { values, skipped } = L.parseImport(text, t);
  assert.deepEqual(skipped, []);
  t.setMany(values);
  assert.equal(t.get('ui.theme'), 'light'); assert.equal(t.get('lanes.dragAction'), 'pan'); assert.deepEqual(t.get('machine.cam'), { az: 2 });
  assert.deepEqual(L.parseImport(JSON.stringify({ 'video.proxyHeight': 333, 'ui.density': 'compact' }), t), { values: { 'ui.density': 'compact' }, skipped: ['video.proxyHeight'] });
  assert.throws(() => L.parseImport('[1,2]', t));
  assert.deepEqual(L.resettable(s).sort(), ['lanes.dragAction', 'ui.theme']);
});

test('private settings reach the usage log by key only; the Stroker size not at all', async () => {
  const { createApp } = await import('../src/app/app.svelte.js');
  const app = createApp({ storage: null, commands: [] });
  app.settings.set('tracking.seeder.folders', ['D:/Private/Seeds']);
  app.settings.set('ui.toastErrorS', 12);
  app.settings.set('stroker.body', { lengthMm: 4817293 });
  app.usage.flushAll?.();
  const logged = JSON.stringify([app.usage.log, app.usage.lines || []]);
  assert.match(logged, /tracking\.seeder\.folders/);
  assert.doesNotMatch(logged, /Private|Seeds/);
  assert.match(logged, /ui\.toastErrorS/);
  assert.doesNotMatch(logged, /stroker\.body|4817293/);
  assert.ok(Object.entries(SCHEMA).filter(([, sc]) => sc.private).map(([k]) => k).includes('tracking.seeder.folders'));
  app.destroy();
});

test('Smart stroke on new runs: off, a new run arrives without it', async () => {
  const { arrivalShots } = await import('../src/lib/rederive.js');
  const shots = [{ start_ms: 0, end_ms: 1000 }], run = { id: 'r1', range: { start: 0, end: 1000 } };
  const on = arrivalShots(shots, run, { fuse: true }), off = arrivalShots(shots, run, { fuse: false });
  assert.notEqual(on, shots);
  assert.equal(JSON.stringify(on).includes('"smart":true'), true);
  assert.equal(off, shots);
});

// paw-m3b6: a setting the app writes is a property: listed here, so it is in Settings, in the palette's search and has a default
// (Prop.svelte). Every literal key written anywhere in src/ (settings.set / S.set / reset, StrokerView's S('k', v), a
// `const KEY = '…'` written through settings.set(KEY …)). Per-file families keyed by a path (video.posbar:<path>,
// tracking.spans:<id>) are state, not settings, and are left out.
test('every settings key written anywhere in src/ is in SCHEMA', () => {
  const walk = (d, o = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, o) : /\.(js|svelte)$/.test(n) && o.push(p); } return o; };
  const prop = /<Prop\b[^>]*?\bkey="([a-z]\w*(?:\.\w+)+)"/g;   // app/Prop.svelte writes its key
  const lit = /(?:\b(?:settings|S|s)\s*\.\s*(?:set|reset)|\bS)\(\s*'([a-z]\w*(?:\.\w+)+)'/g, viaKey = /settings\.set\(\s*KEY\b/, keyConst = /const KEY = '([a-z]\w*(?:\.\w+)+)'/;
  const written = new Map();
  for (const f of walk(join(ROOT, 'src'))) {
    const t = readFileSync(f, 'utf8'), rel = f.slice(ROOT.length);
    for (const m of t.matchAll(lit)) written.set(m[1], rel);
    for (const m of t.matchAll(prop)) written.set(m[1], rel);
    if (viaKey.test(t) && keyConst.test(t)) written.set(t.match(keyConst)[1], rel);
  }
  assert.ok(written.size > 80, `keys written (${written.size})`);
  for (const k of ['machine.height', 'machine.forceLbf', 'stroker.grip', 'tracking.panel.open', 'video.sr6view', 'playback.valence.port']) assert.ok(written.has(k), k);
  assert.deepEqual([...written].filter(([k]) => !SCHEMA[k]).map(([k, f]) => `${k} (${f})`), []);
});

test('the Machine and Stroker settings keep the defaults the panels used; machine choices are machines.js; old files load', async () => {
  const s = new Settings(null);
  const OLD = { 'machine.mode': 'machine', 'machine.machine': 'capstan', 'machine.forceLbf': null, 'machine.experience': 'some', 'machine.warmup': 'none', 'machine.height': null,
    'machine.weight': 0.25, 'machine.genitals': 'male', 'machine.depthSrc': 'script', 'machine.char': 'generic', 'machine.charV': 0, 'machine.size': 'medium', 'machine.toys': [],
    'machine.params': {}, 'machine.firmness': {}, 'machine.hilt': {}, 'machine.theme': {}, 'machine.roll': {}, 'machine.rig': {}, 'machine.layers': {}, 'machine.bodyFit': {},
    'machine.readouts': true, 'stroker.style': 'clean', 'stroker.heatOverlay': false, 'stroker.grip': 0, 'stroker.skinTone': 0.3, 'stroker.sleeveTint': 'clear', 'stroker.orientation': 'up',
    'stroker.case': true, 'stroker.scrotum': true, 'stroker.cut2d': false, 'stroker.sleeve': 'closed-long', 'stroker.sleeves': {}, 'stroker.imported': [], 'stroker.weights': {},
    'stroker.rig': null, 'stroker.readouts': true, 'playback.valence.host': '', 'playback.valence.port': 82, 'review.heatmapScale': 'heat', 'review.heatmapMax': 0, 'review.scope': 'active' };
  for (const [k, v] of Object.entries(OLD)) assert.equal(JSON.stringify(s.get(k)), JSON.stringify(v), k);
  const { MACHINES } = await import('../src/features/machine/machines.js');
  assert.deepEqual(SCHEMA['machine.machine'].choices.map((c) => c[0]), MACHINES.map((m) => m.id));
  const { PARAMS, EXPERIENCE_LEVELS, WARMUPS } = await import('../src/features/machine/physics.js');
  assert.equal(SCHEMA['machine.bodyGive'].default, PARAMS.bodyGive);
  assert.deepEqual(SCHEMA['machine.experience'].choices.map((c) => c[0]), [...EXPERIENCE_LEVELS]);
  assert.deepEqual(SCHEMA['machine.warmup'].choices.map((c) => c[0]), [...WARMUPS]);
  // an old settings file: its stored values read back as they were (min / max bound the panel only)
  const old = { 'machine.height': 182, 'machine.forceLbf': 90, 'machine.weight': 0.6, 'machine.cam': { az: 1, el: 0.2, zoom: 1 }, 'machine.params': { tone: 40 }, 'stroker.rig': { down: 0.1, up: 0.9 },
    'stroker.camUp': { az: 0 }, 'machine.toy': 'my-toy', 'playback.valence.port': 12345, 'review.heatmapMax': 35 };
  const t = new Settings({ getItem: () => JSON.stringify(old), setItem() {} });
  for (const [k, v] of Object.entries(old)) assert.deepEqual(t.get(k), v, k);
  for (const k of ['stroker.rig', 'stroker.cam', 'stroker.camUp', 'playback.valence.tokens']) assert.ok(SCHEMA[k].private, k);
});
