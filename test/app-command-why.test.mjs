// paw-m3b6 step 2: every command says why it is off. Every feature's real command list in one Registry (as
// app-keys-scopes loads them); each non-hidden command with a `when` carries a reason (its own `why`, or the `guard`
// on its `when`), and in two fixture apps (a loaded document, an empty one) every one that is off says a non-empty
// reason. CENSUS=1 prints the commands still without one.
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
const { Registry, guard } = await import(new URL('app/commands.js', root));
const { coreFor } = await import(new URL('app/core-commands.js', root));
const { default: projectCommands } = await import(new URL('app/project-commands.js', root));
const { tabsCommands } = await import(new URL('app/tabs.svelte.js', root));
const { default: editorCommands } = await import(new URL('app/editor-commands.js', root));
const { usageCommands } = await import(new URL('app/usage.svelte.js', root));

const featDir = new URL('features/', root);
const features = readdirSync(featDir).filter((f) => existsSync(new URL(`${f}/commands.js`, featDir))).sort();
const lists = [];
for (const f of features) {
  const files = f === 'timeline' ? readdirSync(new URL('timeline/', featDir)).filter((n) => /^commands-.*\.js$/.test(n)).sort().map((n) => `timeline/${n}`) : [`${f}/commands.js`];
  for (const p of files) lists.push([p, (await import(new URL(p, featDir))).default]);
}

globalThis.document ??= { activeElement: { closest: () => null, dataset: {} }, querySelector: () => null };
const stroke = Array.from({ length: 20 }, (_, i) => ({ at: i * 100, pos: i % 2 ? 90 : 10 }));
const fixture = (loaded) => ({
  mode: 'refine', durationMs: loaded ? 10000 : 0, mediaMs: loaded ? 10000 : 0, view: { start: 0, span: 10000 }, follow: true, tasks: [],
  doc: { axes: loaded ? { stroke } : {}, activeAxis: 'stroke', selection: { axis: 'stroke', ats: new Set() }, media: loaded ? { path: 'x.mp4', durationMs: 10000, fps: 30 } : null,
    range: null, plan: [], fx: [], scenes: [], chapters: [], bookmarks: [], loops: [], ghosts: [], cuts: [], acts: [] },
  get script() { return this.doc.axes[this.doc.activeAxis] || []; },
  settings: { get: (k, d) => d, set() {} }, player: { timeMs: 0, frameMs: 1000 / 30, playing: false, rate: 1, loop: null },
  history: { canUndo: false, canRedo: false }, tabs: { home: false }, backend: {}, toast() {}, select() {}, edit() {}, transact(l, f) { f(); }, panelsIn: () => [],
});
const load = (app) => {
  const reg = new Registry({ app, onError: () => {} });
  app.commands = { keysFor: (id) => reg.keysFor(id), enabled: (id) => reg.enabled(id), get: (id) => reg.get(id), list: () => reg.list(), winner: (k, skip) => reg.winner(k, skip), whyNot: (id) => reg.whyNot(id) };
  reg.register(tabsCommands(app), 'app');
  reg.register(editorCommands, 'app');
  for (const [f, l] of lists) reg.register(l, f);
  reg.register(projectCommands, 'project');
  reg.register(coreFor(features), 'app');
  reg.register(usageCommands, 'app');
  return reg;
};
// the palette's Here section lists a few hidden commands too (here.js): they say why as well
const { HERE } = await import(new URL('features/palette/here.js', root));
const hereIds = new Set(Object.values(HERE).flatMap((l) => l.flatMap(([ids]) => (typeof ids === 'object' && !Array.isArray(ids) ? [] : [ids].flat()))));
const guarded = (reg) => reg.cmds.filter((c) => (!c.hidden || hereIds.has(c.id)) && c.when);
const silent = (reg) => guarded(reg).filter((c) => !c.why && !c.when.why);

if (process.env.CENSUS) {
  const reg = load(fixture(true)), g = guarded(reg), s = silent(reg);
  console.log(`guarded ${g.length}, with a reason ${g.length - s.length}, without ${s.length}`);
  for (const c of s) console.log(`  ${c.source}\t${c.id}`);
}

test('guard: the same predicate, carrying its reason; whyNot falls back to it', () => {
  let on = false;
  const p = (app) => on && app.x;
  const g = guard(p, 'Open a video first');
  assert.equal(g.why, 'Open a video first');
  assert.equal(g({ x: 1 }), false);
  on = true;
  assert.equal(g({ x: 1 }), 1, 'the predicate\'s own result, untouched');
  const reg = new Registry({ app: { x: 0 } });
  reg.register([{ id: 'a', run() {}, when: g }, { id: 'b', run() {}, when: g, why: () => 'its own' }, { id: 'c', run() {}, when: guard(() => false, (app) => `x is ${app.x}`) }]);
  assert.equal(reg.whyNot('a'), 'Open a video first');
  assert.equal(reg.whyNot('b'), 'its own', 'a command\'s own why wins');
  assert.equal(reg.whyNot('c'), 'x is 0', 'a reason may be a function of the app');
  reg.app.x = 1;
  assert.equal(reg.whyNot('a'), '', 'enabled: no reason');
});

test('every non-hidden command (and every one a Here list names) with a `when` carries a reason', () => {
  const reg = load(fixture(true));
  assert.ok(guarded(reg).length > 300, 'loaded the real lists');
  assert.deepEqual(silent(reg).map((c) => `${c.source} ${c.id}`), []);
});

for (const loaded of [true, false]) {
  test(`every command that is off says a non-empty reason (${loaded ? 'a loaded document' : 'nothing loaded'})`, () => {
    const reg = load(fixture(loaded));
    const off = guarded(reg).filter((c) => !reg.enabled(c.id));
    assert.ok(off.length > 50, `${off.length} commands off`);
    assert.deepEqual(off.filter((c) => !reg.whyNot(c.id).trim()).map((c) => `${c.source} ${c.id}`), []);
  });
}
