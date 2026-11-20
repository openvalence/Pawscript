// paw-kxwz: the guide cannot rot silently. Every key and menu title the quick start and the requirements page name is
// asserted against the real command registry (every feature's commands, in boot.js order), and every row of the keys
// page (docs/guide/keys.md) names commands that exist with the keys it lists.
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

const root = new URL('../src/', import.meta.url), guide = new URL('../docs/guide/', import.meta.url);
const { Registry } = await import(new URL('app/commands.js', root));
const { parseKeys } = await import(new URL('app/keymap.js', root));
const { coreFor } = await import(new URL('app/core-commands.js', root));
const { default: projectCommands } = await import(new URL('app/project-commands.js', root));
const { tabsCommands } = await import(new URL('app/tabs.svelte.js', root));
const { default: editorCommands } = await import(new URL('app/editor-commands.js', root));
const FIRST = ['palette', 'assist', 'tracking', 'timeline', 'review', 'inspector', 'graph', 'video', 'lanes'];
const featDir = new URL('features/', root);
const features = readdirSync(featDir).filter((f) => existsSync(new URL(`${f}/commands.js`, featDir))).sort();
const rank = (f) => { const i = FIRST.indexOf(f); return i < 0 ? FIRST.length : i; };
const app = { mode: 'track', doc: { axes: {}, media: null, scenes: [] }, settings: { get: (k, d) => d, set() {} } };
const reg = new Registry({ app, onError: () => {} });
reg.register(tabsCommands(app), 'app');
reg.register(editorCommands, 'app');   // createApp: right after the tabs (paw-5z78)
for (const f of [...features].sort((a, b) => rank(a) - rank(b))) {
  const files = f === 'timeline' ? readdirSync(new URL('timeline/', featDir)).filter((n) => /^commands-.*\.js$/.test(n)).sort().map((n) => `timeline/${n}`) : [`${f}/commands.js`];
  for (const p of files) reg.register((await import(new URL(p, featDir))).default, f);
}
reg.register(projectCommands, 'project');
reg.register(coreFor(features), 'app');

// a key as the guide writes it in backticks: modifiers + one key (Esc for Escape)
const KEY = /^((Ctrl|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|Space|Esc|Escape|Enter|Delete|Backspace|Tab|Home|End|PageUp|PageDown|Insert|[[\],.;'/\\=`-])$/;
const read = (f) => readFileSync(new URL(f, guide), 'utf8').replace(/\r\n/g, '\n');

/** A page's `<!-- guide-keys: ... -->` block -> {keys: [[key, id]], titles: [[title, id]]}, and the page without it. */
function guideKeys(text) {
  const m = text.match(/<!-- guide-keys:[^\n]*\n([\s\S]*?)-->/);
  assert.ok(m, 'the page has its guide-keys block');
  const keys = [], titles = [];
  for (const line of m[1].split('\n').map((l) => l.trim()).filter(Boolean)) {
    const t = line.match(/^"(.+)"\s*=\s*([\w.]+)$/), k = line.match(/^(\S+)\s*=\s*([\w.]+)$/);
    if (t) titles.push([t[1], t[2]]);
    else if (k) keys.push([k[1], k[2]]);
    else assert.fail(`unreadable guide-keys line: ${line}`);
  }
  return { keys, titles, body: text.replace(m[0], '') };
}

for (const page of ['quick-start.md', 'requirements.md']) {
  test(`${page}: every key it names runs the command it says, every menu title is the command's`, () => {
    const { keys, titles, body } = guideKeys(read(page));
    const bad = [];
    for (const [k, id] of keys) {
      if (!reg.get(id)) { bad.push(`${k}: no command ${id}`); continue; }
      if (!reg.keysFor(id).includes(parseKeys(k))) bad.push(`${k}: ${id} is bound to ${reg.keysFor(id).join(', ') || 'nothing'}`);
    }
    for (const [t, id] of titles) if (!reg.get(id) || !String(reg.get(id).title).startsWith(t)) bad.push(`"${t}": ${id} is ${reg.get(id) ? `"${reg.get(id).title}"` : 'not a command'}`);
    assert.deepEqual(bad, []);
    // and nothing in the text escapes the list
    const listed = new Set(keys.map(([k]) => parseKeys(k)));
    const named = [...body.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]).filter((s) => KEY.test(s));
    assert.deepEqual(named.filter((s) => !listed.has(parseKeys(s))), [], 'keys in the text that the guide-keys block does not check');
    assert.ok(named.length >= (page === 'quick-start.md' ? 20 : 5), `${page} names its keys (${named.length})`);
  });
}

// docs/guide/keys.md: a table row `| keys | `command.id` (/ `id`) | what |`. The keys column: '—' for none, alternatives split
// by ', ' or ' / ', a shorthand second half ('Ctrl+PgUp / PgDn', 'Shift+↑ / ↓') takes the first one's modifiers, 'A … B' = A and B.
function rowKeys(cell) {
  const out = [];
  let mods = '';
  for (let part of cell.replace(/\([^)]*\)/g, ' ').replace(/`/g, '').split(/\s+\/\s+|(?<=\S),\s+/)) {
    part = part.trim();
    if (!part || part === '—' || part === '–' || part === '-') continue;
    for (const end of part.split(/\s*…\s*/)) {
      const k = parseKeys(end);
      if (!k) continue;
      const m = k.includes('+') ? k.slice(0, k.lastIndexOf('+') + 1) : '';
      out.push(m || !mods ? [k] : [k, mods + k]);   // a bare key after a modified one may be shorthand for the same modifiers
      if (m) mods = m;
    }
  }
  return out;
}

test('keys.md: every row names commands that exist, with the keys it lists', () => {
  const bad = [];
  let rows = 0;
  for (const line of read('keys.md').split('\n')) {
    const m = line.match(/^\|([^|]+)\|([^|]+)\|/);
    // ids; a short second one (`prevCut` / `nextCut`, `.selection` / `.tools`) replaces the full one's last part
    const ids = [];
    for (const [, t] of m ? m[2].matchAll(/`(\.?[a-z][\w-]*(?:\.[\w-]+)*)`/gi) : []) {
      if (/^[a-z][\w-]*(\.[\w-]+)+$/i.test(t)) ids.push(t);
      else if (ids.length) ids.push(ids[0].replace(/[^.]+$/, '') + t.replace(/^\./, ''));
    }
    if (!ids.length) continue;
    rows++;
    const gone = ids.filter((id) => !reg.get(id));
    if (gone.length) { bad.push(`no command ${gone.join(', ')}: ${line.slice(0, 90)}`); continue; }
    const bound = new Set(ids.flatMap((id) => reg.keysFor(id)));
    for (const alts of rowKeys(m[1])) if (!alts.some((k) => bound.has(k))) bad.push(`${alts[0]} is not on ${ids.join(' / ')} (${[...bound].join(', ') || 'no keys'})`);
  }
  assert.ok(rows > 200, `read the table rows (${rows})`);
  assert.deepEqual(bad, []);
});

test('the first-run hint lines and the Projects card name commands that exist and have keys', async () => {
  const { LINES, CARD } = await import(new URL('features/onboard/steps.js', root));
  const ids = [...Object.values(LINES).map(([, t]) => t), ...CARD, '{mode.scenes} {mode.track} {palette.help} {help.quickStart}'].flatMap((t) => [...t.matchAll(/\{([\w.]+)\}/g)].map((m) => m[1]));
  assert.deepEqual(ids.filter((id) => !reg.get(id)), [], 'unknown commands');
  assert.deepEqual(ids.filter((id) => id !== 'help.quickStart' && !reg.keysFor(id).length), [], 'commands without a key');
});
