// No native tooltips, and no tooltip that stays painted. WebView2 draws its own OS tooltip for a title= attribute
// (or an SVG <title>) and leaves it up after the pointer goes, so the DOM must never carry one: every hint is the kit
// tooltip ({@attach tooltip(text)} or a kit component's `tip`). Component props named `title` are fine only on
// components that take `title` as a prop (so `...rest` never forwards it to a DOM title=).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const all = (ext) => readdirSync(src, { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => join(src, f));

// components that declare `title` as a prop (checked below), by the name they are used under
const TITLE_PROP = {
  Dialog: 'ui/kit/Dialog.svelte', 'kit.Dialog': 'ui/kit/Dialog.svelte', Section: 'ui/kit/Section.svelte',
  EmptyState: 'ui/kit/EmptyState.svelte', PanelHeader: 'ui/kit/PanelHeader.svelte', Popover: 'ui/kit/Popover.svelte',
  Palette: 'features/graph/Palette.svelte',
};

test('no DOM title= or SVG <title> in src/**/*.svelte; title props only on components that consume them', () => {
  const bad = [];
  for (const f of all('.svelte')) {
    const text = readFileSync(f, 'utf8');
    const at = (n) => `${f.slice(src.length + 1)}:${text.slice(0, n.start).split('\n').length}`;
    const walk = (n, head) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach((c) => walk(c, head));
      head = head || n.type === 'SvelteHead';
      for (const a of n.attributes || []) {
        if (a.type !== 'Attribute' || a.name !== 'title') continue;
        if (n.type === 'Component') { if (!TITLE_PROP[n.name]) bad.push(`${at(a)} <${n.name} title=…> (not a known title prop: it may reach the DOM)`); }
        else bad.push(`${at(a)} <${n.name} title=…> (use {@attach tooltip(…)})`);
      }
      if (n.type === 'RegularElement' && n.name === 'title' && !head) bad.push(`${at(n)} <title> element (SVG tooltip; use {@attach tooltip(…)})`);
      for (const k in n) if (k !== 'parent' && typeof n[k] === 'object') walk(n[k], head);
    };
    walk(parse(text, { modern: true }).fragment, false);
  }
  assert.deepEqual(bad, []);
  for (const [name, file] of Object.entries(TITLE_PROP)) {
    assert.match(readFileSync(join(src, file), 'utf8'), /let\s*\{[^}]*\btitle\b[^}]*\}\s*=\s*\$props\(\)/, `${name} destructures title from $props()`);
  }
});

test('no script sets a title attribute', () => {
  const bad = all('.js').concat(all('.svelte')).filter((f) => /setAttribute\(\s*['"]title['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.slice(src.length + 1)), []);
});

test('a closed popover (the tooltip among them) is never painted', () => {
  // .k-tip { display: flex } outranks the UA's [popover]:not(:popover-open) { display: none }: without this rule a
  // hidden tooltip stays drawn at its last place
  assert.match(readFileSync(join(src, 'ui/kit/theme.css'), 'utf8'), /\[popover\]:not\(:popover-open\)\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});
