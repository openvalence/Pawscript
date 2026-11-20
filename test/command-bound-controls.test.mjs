// paw-m3b6: a control bound to a command (data-command="id", or app/cmd.js cmd(app, 'id')) names a registered command: a typo
// would be a button that is greyed for ever and a right click that offers nothing. Every command list the app registers
// (boot.js: every feature's commands.js, the project's, the shell's core; app.svelte.js: tabs, editor, usage) against every
// literal id in src (a template id like `timeline.mod.toggle.${k}` must match at least one). Also: kit Button keeps a
// disabled bound control hoverable and right-clickable (aria-disabled, the press ignored), paw-z0ym.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

const root = new URL('../src/', import.meta.url);
const srcDir = fileURLToPath(root);
const featDir = new URL('features/', root);
const features = readdirSync(featDir).filter((f) => existsSync(new URL(`${f}/commands.js`, featDir)));
const app = { settings: { get: (k, d) => d, set() {} }, doc: {}, player: {}, commands: {} };
const lists = [
  (await import(new URL('app/tabs.svelte.js', root))).tabsCommands(app),
  (await import(new URL('app/editor-commands.js', root))).default,
  (await import(new URL('app/usage.svelte.js', root))).usageCommands,
  (await import(new URL('app/project-commands.js', root))).default,
  (await import(new URL('app/core-commands.js', root))).coreFor(features),
];
for (const f of features) {
  // the timeline's commands.js gathers commands-*.js with import.meta.glob: load those directly
  const files = f === 'timeline' ? readdirSync(new URL('timeline/', featDir)).filter((n) => /^commands-.*\.js$/.test(n)).map((n) => `timeline/${n}`) : [`${f}/commands.js`];
  for (const p of files) lists.push((await import(new URL(p, featDir))).default);
}
const ids = new Set([lists].flat(Infinity).filter(Boolean).map((c) => c.id));

const files = readdirSync(srcDir, { recursive: true }).filter((f) => /\.(svelte|js)$/.test(f)).map((f) => join(srcDir, f));
// data-command="id" / data-command={'id'} / data-command={`a.${k}`} and cmd(app, 'id' ...) / cmd(app, `a.${k}` ...)
const USES = [/data-command=(?:"([^"{}]+)"|\{'([^']+)'\}|\{`([^`]+)`\})/g, /\bcmd\(\s*app\s*,\s*(?:'([^']+)'|`([^`]+)`)/g];

test('every control bound to a command names a registered one', () => {
  assert.ok(ids.size > 300 && ids.has('track.run') && ids.has('edit.undo'), `loaded ${ids.size} command ids`);
  const bad = [];
  let n = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const re of USES) for (const m of text.matchAll(re)) {
      const id = m.slice(1).find(Boolean);
      n++;
      const ok = id.includes('${') ? [...ids].some((x) => new RegExp(`^${id.split(/\$\{[^}]*\}/).map((s) => s.replace(/[.*+?^()|[\]\\]/g, '\\$&')).join('.+')}$`).test(x)) : ids.has(id);
      if (!ok) bad.push(`${f.slice(srcDir.length)}:${text.slice(0, m.index).split('\n').length} ${id}`);
    }
  }
  assert.ok(n > 50, `found ${n} bound controls`);
  assert.deepEqual(bad, []);
});

test('kit Button: a disabled bound control is aria-disabled (hover, tooltip and right click work); others stay natively disabled', async () => {
  const { render } = await import('svelte/server');
  const { default: Button } = await import(new URL('ui/kit/Button.svelte', root));
  const html = (props) => render(Button, { props: { label: 'x', ...props } }).body;
  const bound = html({ disabled: true, 'data-command': 'edit.undo' });
  assert.match(bound, /aria-disabled="true"/);
  assert.doesNotMatch(bound, /\sdisabled(=|\s|>)/);
  assert.match(html({ disabled: true }), /\sdisabled(=""|\s|>)/);
  assert.doesNotMatch(html({ 'data-command': 'edit.undo' }), /disabled/);
});

test('keyWhen: where the keys reach a command; its button / menu row (run) work wherever when holds', async () => {
  const { Registry } = await import(new URL('app/commands.js', root));
  const a = { mode: 'refine' }, ran = [];
  const reg = new Registry({ app: a });
  reg.register([{ id: 't.k', title: 'K', keys: ['T'], keyWhen: (x) => x.mode === 'track', why: () => 'never said', run: () => ran.push('t.k') }]);
  const key = { key: 't', code: 'KeyT', timeStamp: 1, target: null, preventDefault() {} };
  assert.equal(reg.winner('T'), null);
  assert.equal(reg.handleKey(key), false);
  assert.equal(reg.enabled('t.k'), true);
  assert.equal(reg.run('t.k'), true);
  a.mode = 'track';
  assert.equal(reg.winner('T'), 't.k');
  assert.equal(reg.handleKey({ ...key, timeStamp: 2000 }), true);
  assert.deepEqual(ran, ['t.k', 't.k']);
});

test('cmd(): run, greyed with the why, pressed from checked, the key from the registry, data-command', async () => {
  const { cmd } = await import(new URL('app/cmd.js', root));
  const ran = [];
  let on = false;
  const c = { id: 'x.y', title: 'Do it', tip: 'how', checked: () => true };
  const a = { commands: { get: (id) => (id === 'x.y' ? c : null), enabled: () => on, whyNot: () => (on ? '' : 'not now'), keysFor: () => ['Ctrl+K'], run: (id, args) => ran.push([id, args]) } };
  const p = cmd(a, 'x.y', { n: 1 });
  assert.deepEqual({ ...p, onclick: typeof p.onclick }, { 'data-command': 'x.y', disabled: true, pressed: true, tip: 'Do it\nhow\nnot now', shortcut: 'Ctrl+K', onclick: 'function' });
  on = true;
  const q = cmd(a, 'x.y', { n: 1 }, { tip: 'Mine' });
  assert.equal(q.disabled, false);
  assert.equal(q.tip, 'Mine');
  q.onclick();
  assert.deepEqual(ran, [['x.y', { n: 1 }]]);
  assert.deepEqual(cmd(a, 'nope'), { disabled: true });
});
