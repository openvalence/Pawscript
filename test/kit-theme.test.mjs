// The kit's themes, measured from src/ui/kit/theme.css itself: text 4.5:1 (7:1 in the contrast theme),
// control boundaries and the focus ring 3:1, on every surface they sit on; the series palette apart under
// colour-vision deficiencies. `node test/kit-theme.test.mjs --report` prints the measured table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, deltaE, hexToRgb } from '../src/ui/kit/color.js';
import { SERIES } from '../src/ui/kit/tokens.js';

const css = readFileSync(new URL('../src/ui/kit/theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selectorPart) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(css)); ) {
    if (m[1].includes(selectorPart)) {
      const out = {};
      for (const d of m[2].split(';')) {
        const i = d.indexOf(':');
        if (i > 0 && d.trim().startsWith('--')) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
      return out;
    }
  }
  throw new Error('no block for ' + selectorPart);
}
const dark = block(":root, [data-theme='dark']");
const THEMES = {
  dark,
  light: { ...dark, ...block(":root[data-theme='light']") },
  contrast: { ...dark, ...block(":root[data-theme='contrast']") },
};

function resolve(t, v, depth = 0) {
  assert.ok(depth < 20, 'var cycle');
  return v.replace(/var\((--[\w-]+)\)/g, (_, k) => {
    assert.ok(k in t, 'undefined token ' + k);
    return resolve(t, t[k], depth + 1);
  });
}
const toHex = (rgb) => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
/** A token as an opaque hex; rgba() is composited over `under`. */
function color(t, k, under) {
  const v = resolve(t, t[k]);
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return v;
  const m = v.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
  assert.ok(m && under, `${k} is not a colour I can measure: ${v}`);
  const a = +m[4], u = hexToRgb(under);
  return toHex([+m[1], +m[2], +m[3]].map((c, i) => c * a + u[i] * (1 - a)));
}

const SURFACES = ['--bg-sunken', '--bg', '--bg-raised', '--bg-card', '--bg-hover'];
const TEXT = ['--tx-hi', '--tx', '--tx-val', '--tx-mut', '--accent-ink', '--ok-ink', '--warn-ink', '--bad-ink', '--info-ink'];
const UI = ['--line-ctl', '--focus', '--accent', '--highlight', '--bad'];
const rows = [];
function check(theme, fg, bg, need, fgHex, bgHex) {
  const r = contrast(fgHex, bgHex);
  rows.push({ theme, fg, bg, ratio: +r.toFixed(2), need });
  assert.ok(r >= need, `${theme}: ${fg} ${fgHex} on ${bg} ${bgHex} is ${r.toFixed(2)}:1, needs ${need}:1`);
}

for (const [name, t] of Object.entries(THEMES)) {
  const textNeed = name === 'contrast' ? 7 : 4.5;
  test(`${name}: text tokens read on every surface`, () => {
    for (const s of SURFACES) for (const k of TEXT) check(name, k, s, textNeed, color(t, k), color(t, s));
  });
  test(`${name}: selected rows keep their text`, () => {
    for (const s of ['--bg', '--bg-card']) {
      const under = color(t, s);
      for (const k of ['--sel-bg', '--sel-bg-hover']) {
        const sel = color(t, k, under);
        for (const fg of ['--tx-hi', '--tx', '--accent-ink']) check(name, fg, `${k} over ${s}`, textNeed, color(t, fg), sel);
      }
    }
  });
  test(`${name}: glyphs on an accent fill`, () => {
    check(name, '--on-accent', '--accent', textNeed, color(t, '--on-accent'), color(t, '--accent'));
    for (const k of ['ok', 'warn', 'bad']) check(name, `--on-${k}`, `--${k}`, textNeed, color(t, `--on-${k}`), color(t, `--${k}`));
  });
  test(`${name}: control boundaries and the focus ring clear 3:1`, () => {
    for (const s of SURFACES) for (const k of UI) check(name, k, s, 3, color(t, k), color(t, s));
  });
  test(`${name}: series colours clear 3:1 on the lane and the page`, () => {
    for (const { key } of SERIES) for (const s of ['--bg-sunken', '--bg', '--bg-card'])
      check(name, '--series-' + key, s, 3, color(t, '--series-' + key), color(t, s));
  });
  test(`${name}: the script speed ramp (--spd-0..8) clears 3:1 on the lane`, () => {
    for (let i = 0; i <= 8; i++) check(name, `--spd-${i}`, '--bg-sunken', 3, color(t, `--spd-${i}`), color(t, '--bg-sunken'));
  });
  test(`${name}: the first eight series stay apart for every vision`, () => {
    const hex = SERIES.slice(0, 8).map(({ key }) => color(t, '--series-' + key));
    for (const cvd of [undefined, 'protan', 'deutan', 'tritan']) {
      const need = cvd ? 0.05 : 0.1;
      for (let i = 0; i < hex.length; i++) for (let j = i + 1; j < hex.length; j++) {
        const d = deltaE(hex[i], hex[j], cvd);
        assert.ok(d >= need, `${name} ${cvd || 'normal'}: ${SERIES[i].key}/${SERIES[j].key} only ${d.toFixed(3)} apart`);
      }
    }
  });
}

test('every theme defines the same token names', () => {
  for (const k of Object.keys(dark)) for (const t of Object.values(THEMES)) assert.ok(k in t);
  for (const { key } of SERIES) assert.ok('--series-' + key in dark, 'series token for ' + key);
});

if (process.argv.includes('--report')) {
  process.on('exit', () => {
    const worst = {};
    for (const r of rows) {
      const k = r.theme + ' ' + r.fg;
      if (!worst[k] || r.ratio < worst[k].ratio) worst[k] = r;
    }
    for (const r of Object.values(worst)) console.log(`${r.theme.padEnd(9)} ${r.fg.padEnd(18)} min ${String(r.ratio).padStart(5)}:1 (on ${r.bg}, needs ${r.need})`);
  });
}
