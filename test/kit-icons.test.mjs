// kit-icons: every icon in src/ui/kit/icons.js is valid path data, inside the 16-unit box with a margin,
// kebab-case, listed once, and its straight strokes sit on the quarter grid (icons.js header).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, ICON_NAMES, iconPaths } from '../src/ui/kit/icons.js';

const ARGS = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** Path data -> [{ cmd, args }] (cmd as written); throws on anything that is not SVG path data. */
function parse(d) {
  const out = [];
  let i = 0, cmd = null;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    ws();
    const m = NUM.exec(d.slice(i));
    if (!m) throw new Error(`number expected at ${i}: "${d.slice(i, i + 12)}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => { ws(); if (d[i] !== '0' && d[i] !== '1') throw new Error(`arc flag expected at ${i}`); return Number(d[i++]); };
  ws();
  if (!/[Mm]/.test(d[i] || '')) throw new Error('path must start with M');
  while (ws(), i < d.length) {
    if (/[A-Za-z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toLowerCase() in ARGS)) throw new Error(`unknown command "${cmd}"`);
      if (cmd.toLowerCase() === 'z') { out.push({ cmd, args: [] }); continue; }
    } else if (!cmd || cmd.toLowerCase() === 'z') throw new Error(`command expected at ${i}`);
    const n = ARGS[cmd.toLowerCase()];
    const args = cmd.toLowerCase() === 'a' ? [num(), num(), num(), flag(), flag(), num(), num()] : Array.from({ length: n }, num);
    out.push({ cmd, args });
    if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';   // implicit lineto after moveto
  }
  return out;
}

/** Points on an SVG arc (endpoint form, SVG 1.1 F.6.5), for the bounding box. */
function arcPoints(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const p = (phi * Math.PI) / 180, cos = Math.cos(p), sin = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  if (fa === fs) k = -k;
  const cxp = (k * rx * yp) / ry, cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const pts = [];
  for (let j = 1; j <= 32; j++) {
    const t = t1 + (dt * j) / 32;
    pts.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
  return pts;
}

/** Walks the path: { box: [x0, y0, x1, y1] (control points included: conservative), lines: [[x0,y0,x1,y1]] }. */
function walk(d) {
  let x = 0, y = 0, sx = 0, sy = 0;
  const pts = [], lines = [];
  for (const { cmd, args: a } of parse(d)) {
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z', ox = rel ? x : 0, oy = rel ? y : 0;
    const px = x, py = y;
    switch (cmd.toLowerCase()) {
      case 'm': x = ox + a[0]; y = oy + a[1]; sx = x; sy = y; break;
      case 'l': case 't': x = ox + a[0]; y = oy + a[1]; break;
      case 'h': x = ox + a[0]; break;
      case 'v': y = oy + a[0]; break;
      case 'c': pts.push([ox + a[0], oy + a[1]], [ox + a[2], oy + a[3]]); x = ox + a[4]; y = oy + a[5]; break;
      case 's': case 'q': pts.push([ox + a[0], oy + a[1]]); x = ox + a[2]; y = oy + a[3]; break;
      case 'a': x = ox + a[5]; y = oy + a[6]; pts.push(...arcPoints(px, py, a[0], a[1], a[2], a[3], a[4], x, y)); break;
      case 'z': x = sx; y = sy; break;
    }
    if ('lhvz'.includes(cmd.toLowerCase())) lines.push([px, py, x, y]);
    pts.push([x, y]);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], lines };
}

const HALF = 0.75;    // half the 1.5 stroke
const MARGIN = 1;     // nothing (stroke included) closer than 1 unit to the viewBox edge
const quarter = (v) => Math.abs(((v % 1) + 1) % 1 - 0.25) < 1e-6 || Math.abs(((v % 1) + 1) % 1 - 0.75) < 1e-6;

test('icon names: kebab-case, each key written once in icons.js', () => {
  for (const n of ICON_NAMES) assert.match(n, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, n);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length);
  // An object literal silently keeps the last of two equal keys: count the keys in the source.
  const src = readFileSync(new URL('../src/ui/kit/icons.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const ICONS = {'), src.indexOf('\n};', src.indexOf('export const ICONS = {')));
  const keys = [...body.matchAll(/^\s{2}'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
  const seen = new Set();
  for (const k of keys) { assert.ok(!seen.has(k), `duplicate key "${k}"`); seen.add(k); }
  assert.equal(keys.length, ICON_NAMES.length, 'every key is on its own line');
});

test('icon entries: a stroke string or { s, f }, never empty', () => {
  for (const n of ICON_NAMES) {
    const v = ICONS[n];
    assert.ok(typeof v === 'string' || (v && typeof v === 'object' && Object.keys(v).every((k) => k === 's' || k === 'f')), n);
    const { s, f } = iconPaths(n);
    assert.ok(s || f, n);
  }
  assert.throws(() => iconPaths('no-such-icon'), /unknown icon/);
});

test('every path parses as SVG path data', () => {
  for (const n of ICON_NAMES) {
    const { s, f } = iconPaths(n);
    for (const d of [s, f].filter(Boolean)) assert.doesNotThrow(() => parse(d), `${n}: ${d}`);
  }
  assert.throws(() => parse('M1 2L3'), /number expected/);
  assert.throws(() => parse('L1 2'), /start with M/);
  assert.throws(() => parse('M1 2X3'), /unknown command/);
});

test('every icon stays inside 0..16 with a 1-unit margin (stroke included)', () => {
  for (const n of ICON_NAMES) {
    const { s, f } = iconPaths(n);
    for (const [d, pad] of [[s, HALF], [f, 0]]) {
      if (!d) continue;
      const [x0, y0, x1, y1] = walk(d).box;
      assert.ok(x0 - pad >= MARGIN - 1e-6 && y0 - pad >= MARGIN - 1e-6 && x1 + pad <= 16 - MARGIN + 1e-6 && y1 + pad <= 16 - MARGIN + 1e-6,
        `${n}: box ${[x0 - pad, y0 - pad, x1 + pad, y1 + pad].map((v) => +v.toFixed(2))}`);
    }
  }
});

test('straight horizontal and vertical strokes are centred on quarter lines (n.25 / n.75)', () => {
  for (const n of ICON_NAMES) {
    const { s } = iconPaths(n);
    if (!s) continue;
    for (const [x0, y0, x1, y1] of walk(s).lines) {
      if (y0 === y1 && x0 !== x1) assert.ok(quarter(y0), `${n}: horizontal at y=${y0}`);
      if (x0 === x1 && y0 !== y1) assert.ok(quarter(x0), `${n}: vertical at x=${x0}`);
    }
  }
});

test('the bounding box walker handles relative commands and arcs', () => {
  assert.deepEqual(walk('M2 2h4v4h-4z').box, [2, 2, 6, 6]);
  const [x0, y0, x1, y1] = walk('M3 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z').box;
  assert.ok(Math.abs(x0 - 3) < 1e-6 && Math.abs(x1 - 13) < 1e-6 && Math.abs(y0 - 3) < 0.05 && Math.abs(y1 - 13) < 0.05);
});
