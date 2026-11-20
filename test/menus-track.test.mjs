// paw-u6s5: the Track menu regrouped (66 entries at its top level before) and the source menu in user words. Every command
// the Track menu listed before is still reachable (in a menu of a production build, else the palette), on the real registry
// (every feature's commands, in boot.js order, as test/guide-keys.test.mjs loads them).
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
    if (url.endsWith('.json')) return { format: 'module', shortCircuit: true, source: 'export default ' + src() };
    if (url.endsWith('.js') && src().includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: noGlob(src()) };
    return next(url, ctx);
  },
});

const root = new URL('../src/', import.meta.url);
const { Registry } = await import(new URL('app/commands.js', root));
const { coreFor } = await import(new URL('app/core-commands.js', root));
const { default: projectCommands } = await import(new URL('app/project-commands.js', root));
const { tabsCommands } = await import(new URL('app/tabs.svelte.js', root));
const { default: editorCommands } = await import(new URL('app/editor-commands.js', root));
const { menuModel } = await import(new URL('app/menus.js', root));
const { channelWord, channelHasData, labelOf } = await import(new URL('lib/runs-channel.js', root));
const { bindSettings } = await import(new URL('lib/content.js', root));
const FIRST = ['palette', 'assist', 'tracking', 'timeline', 'review', 'inspector', 'graph', 'video', 'lanes'];
const featDir = new URL('features/', root);
const features = readdirSync(featDir).filter((f) => existsSync(new URL(`${f}/commands.js`, featDir))).sort();
const rank = (f) => { const i = FIRST.indexOf(f); return i < 0 ? FIRST.length : i; };
const app = { mode: 'track', doc: { axes: {}, media: null, scenes: [] }, settings: { get: (k, d) => d, set() {} } };
const reg = new Registry({ app, onError: () => {} });
reg.register(tabsCommands(app), 'app');
reg.register(editorCommands, 'app');
for (const f of [...features].sort((a, b) => rank(a) - rank(b))) {
  const files = f === 'timeline' ? readdirSync(new URL('timeline/', featDir)).filter((n) => /^commands-.*\.js$/.test(n)).sort().map((n) => `timeline/${n}`) : [`${f}/commands.js`];
  for (const p of files) reg.register((await import(new URL(p, featDir))).default, f);
}
reg.register(projectCommands, 'project');
reg.register(coreFor(features), 'app');
const list = reg.list({ enabled: false });
const menus = (dev) => menuModel(list, (c, label) => ({ id: c.id, label }), { dev });
const track = (dev) => menus(dev).find((m) => m.label === 'Track').items;
const ids = (items) => items.flatMap((it) => (it.items ? ids(it.items) : it.id ? [it.id] : []));

// the Track menu's commands at 8991d13, before the regrouping
const BEFORE = ['assist.open', 'assist.regenerate', 'assist.reapply', 'assist.orientGhosts', 'assist.clearDecisions', 'track.gridFrame', 'track.run', 'track.full',
  'track.beside', 'track.plan', 'track.cancel', 'tracking.axisDraw', 'tracking.groups', 'tracking.groupsSuggest', 'tracking.groupsCopyFrom', 'tracking.groupsSwap',
  'tracking.groupsCircle', 'tracking.groupsGrow', 'tracking.groupsKnot', 'tracking.groupsGrowFill', 'tracking.groupsAutoFill', 'tracking.groupsRetrain',
  'tracking.axisClear', 'track.signalOverride', 'tracking.checkCamera', 'track.flipAtPlayhead', 'track.flipToEnd', 'track.flipRange', 'track.forward',
  'track.backward', 'track.both', 'tracking.followPlayhead', 'track.stabilise', 'track.flipRun', 'track.simplifyDetail', 'track.simplifyAccept',
  'tracking.anchorIn', 'tracking.anchorOut', 'tracking.anchorMid', 'tracking.shaftOut', 'tracking.shaftHilt', 'tracking.shaftMark.wentIn',
  'tracking.shaftMark.knotIn', 'tracking.shaftMark.knotOut', 'tracking.shaftMark.pulledOut', 'tracking.shaftData', 'tracking.shaftScorecard',
  'tracking.retrack', 'tracking.bake', 'tracking.bakeRun', 'tracking.bakeAll', 'tracking.unbake', 'track.export', 'track.detectScenes', 'track.describeAll',
  'track.describeRanges', 'track.loopScene', 'track.searchLoops', 'track.rangeToScene', 'track.listTrackers', 'tracking.deriveAxes',
  'tracking.addAxisLanes', 'tracking.fillFromLink', 'tracking.fillDismiss', 'tracking.fillDetach', 'tracking.flipAxis', 'graph.show', 'graph.new',
  'graph.add', 'graph.bake', 'director.run', 'director.show', 'director.cancel', 'director.exportTrace', 'draft.run', 'draft.show', 'draft.cancel'];
const DEV = ['tracking.shaftMark.wentIn', 'tracking.shaftMark.knotIn', 'tracking.shaftMark.knotOut', 'tracking.shaftMark.pulledOut', 'tracking.shaftScorecard',
  'director.run', 'director.show', 'director.cancel', 'director.exportTrace'];

test('every command the Track menu had is still reachable: a menu of a production build, else the palette', () => {
  const inMenu = new Set(menus(false).flatMap((m) => ids(m.items)));
  const palette = new Set(list.filter((c) => !c.hidden).map((c) => c.id));
  assert.deepEqual(BEFORE.filter((id) => !inMenu.has(id) && !palette.has(id)), [], 'unreachable');
  assert.deepEqual(BEFORE.filter((id) => !inMenu.has(id)), DEV, 'only the dev tools leave the menus (they stay in the palette)');
  const dev = new Set(ids(track(true)));
  assert.deepEqual(BEFORE.filter((id) => !dev.has(id)), [], 'a dev build lists every one of them under Track');
});

test('Track: at most 12 entries at its top level (the everyday commands, then a submenu per job; the rest under Advanced)', () => {
  const top = track(false).filter((it) => !it.separator);
  assert.ok(top.length <= 12, `${top.length} entries`);
  assert.deepEqual(top.filter((it) => !it.items).map((it) => it.id), ['track.gridFrame', 'track.run', 'track.plan', 'track.cancel', 'tracking.groups', 'track.flipAtPlayhead', 'tracking.bake']);
  assert.deepEqual(top.filter((it) => it.items).map((it) => it.label), ['Groups', 'Direction and anchors', 'Runs, ranges and scenes', 'Bake and export', 'Advanced']);
  const adv = top.find((it) => it.label === 'Advanced').items;
  assert.ok(adv.some((it) => it.label === 'Draft') && !adv.some((it) => it.label === 'Director'), 'Draft nested in Advanced; the Director only in a dev build');
  assert.equal(top.find((it) => it.label === 'Groups').items[0].label, 'Suggest (learned seeder + tagger)', 'the Groups prefix dropped inside its submenu');
  assert.equal(list.find((c) => c.id === 'track.gridFrame').title, 'Track the selected shot or range');
});

test('source menu words: no channel id in a label; a channel without data in the shot is known', () => {
  const words = ['primary', 'proj_cam', 'proj', 'cam_x', 'cam_y', 'who_c1_proj', 'who_pair_proj', 'p0_y', 'centroid_auto'].map(channelWord);
  for (const w of words) assert.doesNotMatch(w, /_|\bg\d|\bproj\b|\bcam [xy]\b|sidecar|\brel\b/, w);
  assert.deepEqual(words.slice(0, 5), ["Tracker's choice", 'All points, camera removed', 'All points', 'Camera left / right', 'Camera up / down']);
  const run = { channels: { g1_proj: { t: [0, 100, 200, 300], v: [NaN, NaN, 0.4, 0.6] }, sem_c1_hips_x: { t: [0, 100], v: [0.1, 0.2] }, sem_c2_penis_x: { t: [0, 100], v: [NaN, NaN] } } };
  assert.equal(channelHasData(run, 'g1_proj', 0, 200), false, 'only NaN in the shot');
  assert.equal(channelHasData(run, 'g1_proj', 0, 400), true);
  assert.equal(channelHasData(run, 'g4_proj'), false, 'not in the run');
  assert.equal(channelHasData(run, 'primary'), true);
  assert.equal(channelHasData(run, 'rel:sem_c2_penis:sem_c1_hips'), false, 'a pair needs both groups');
});

test('Furry items off still renames what it renames in a source label (content.js)', () => {
  const groups = { sem_c1_paws: { label: 'c1_paws', source: 'user' } };
  bindSettings({ get: (k) => (k === 'content.furry' ? false : undefined) });
  try { assert.equal(labelOf(groups, 'sem_c1_paws_proj'), 'Bottom feet (drawn)'); } finally { bindSettings(null); }
  assert.equal(labelOf(groups, 'sem_c1_paws_proj'), 'Bottom paws (drawn)');
});
