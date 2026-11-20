// Style ratchet: raw colors, font sizes, radii and rgba() literals in src/**/*.svelte may only go down.
// Use the tokens in src/ui/kit/theme.css instead. When you remove some, lower the ceiling; never raise one.
// `node test/style-ratchet.test.mjs` prints the current counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SKIP = /[\/]ui[\/]kit[\/](_gallery|_demo)[\/]/;

function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = dir + e.name;
    if (e.isDirectory()) files(p + '/', out);
    else if (p.endsWith('.svelte') && !SKIP.test(p)) out.push(p);
  }
  return out;
}

// a hex color after a quote, colon or paren: in a style block, an inline style or a JS string (not &#9656; or #120 in text)
const HEX = /['":(]\s*#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
export function measure() {
  const n = { hex: 0, fontSize: 0, radius: 0, rgba: 0 };
  for (const f of files(SRC)) {
    const s = readFileSync(f, 'utf8');
    const styles = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const inline = [...s.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]);
    const all = styles.concat(inline).join('\n');
    n.hex += (s.match(HEX) || []).length;
    n.fontSize += (all.match(/font-size:\s*\d+(\.\d+)?px/g) || []).length;
    n.radius += (all.match(/border-radius:\s*\d+(\.\d+)?px/g) || []).length;
    n.rgba += (all.match(/rgba?\(\s*\d/g) || []).length;
  }
  return n;
}

// Ceilings: the counts when paw-wfd2.1 started, lowered as each class is cleaned. They only go down.
const CEIL = { hex: 0, fontSize: 8, radius: 0, rgba: 0 };

test('style ratchet', () => {
  const n = measure();
  for (const k of Object.keys(CEIL)) assert.ok(n[k] <= CEIL[k], `${k}: ${n[k]} > ceiling ${CEIL[k]}; use a token`);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(measure());
