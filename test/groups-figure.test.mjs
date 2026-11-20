// The Groups picker's body figure (paw-h8c): every groups.js part (and both sides of a paired one) is one click target
// on the figure or in its chip rows, rendered (server-side) with the part / side the drop and click code reads; the
// genitals are chips, not drawn on the figure; nothing the vocabulary lacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (url.startsWith('file:') && url.endsWith('.svelte') && !url.includes('node_modules')) {
      const file = fileURLToPath(url);
      return { format: 'module', shortCircuit: true, source: compile(readFileSync(file, 'utf8'), { filename: file, generate: 'server' }).js.code };
    }
    return next(url, ctx);
  },
});
const { render } = await import('svelte/server');
const { PARTS, PAIRED } = await import('../src/features/tracking/groups.js');
const { REGIONS, GENITALS, EXTRA, FEATURES, TARGETS, keyOf } = await import('../src/features/tracking/figure.js');
const { default: BodyFigure } = await import('../src/features/tracking/BodyFigure.svelte');

test('every part and side is one target of the figure or its chip rows', () => {
  const { body } = render(BodyFigure, { props: { who: 'c2', has: new Set(['penis', 'handl']) } });
  const got = [...body.matchAll(/<(g|button)\b[^>]*data-drop-part="([a-z]+)"[^>]*?>/g)].map(([tag, el, part]) => ({ el, part, side: /data-drop-side="([lr])"/.exec(tag)?.[1] || null, has: /\bhas\b/.test(/class="([^"]*)"/.exec(tag)?.[1] || '') }));
  const want = PARTS.filter((p) => p !== 'knot').flatMap((p) => (PAIRED.includes(p) ? ['l', 'r'].map((s) => p + s) : [p]));   // paw-njnf: the knot is a section of the penis, never a part to pick
  assert.deepEqual(got.map((t) => t.part + (t.side || '')).sort(), [...want].sort(), 'each part / side exactly once');
  assert.deepEqual(TARGETS.map((t) => keyOf(t.part, t.side)), want, 'TARGETS (the filter and keyboard order) is the same list');
  for (const g of GENITALS) assert.equal(got.find((t) => t.part === g).el, 'button', `${g}: a chip under the figure, not drawn on it`);
  for (const g of FEATURES) assert.equal(got.find((t) => t.part === g).el, 'button', `${g}: a chip row part (paw-714j)`);
  assert.deepEqual([...REGIONS.map((r) => r.part), ...GENITALS, ...EXTRA, ...FEATURES].filter((p) => !PARTS.includes(p)), [], 'no part groups.js lacks');
  assert.deepEqual(got.filter((t) => t.has).map((t) => t.part + (t.side || '')).sort(), ['handl', 'penis'], 'what this shot has is marked');
  // paw-5r1: the stored side is the character's own; the figure faces the viewer, so their L is drawn on the viewer's RIGHT, and it says so
  const cx = (part, side) => { const r = REGIONS.find((q) => q.part === part && q.side === side); return r.hit[0] + r.hit[2] / 2; };
  for (const p of PAIRED) assert.ok(cx(p, 'l') > 118 && cx(p, 'r') < 118, `${p}: the character's L on the viewer's right`);
  assert.match(body, /their L/); assert.match(body, /their R/);
  const lbl = [...body.matchAll(/data-drop-part="([a-z]+)" data-drop-side="([lr])"[\s\S]*?<text[^>]*>([LR])<\/text>/g)];
  assert.ok(lbl.length >= PAIRED.length * 2 && lbl.every((m) => m[3] === m[2].toUpperCase()), 'every side letter on the figure is the stored side');
  // each side is drawn where its target is: the shape's own centre inside its rectangle (a mirrored relative arc once landed off the figure)
  for (const r of REGIONS.filter((q) => q.side)) {
    const nums = [...r.d[0].matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)][0], x = +nums[1], y = +nums[2];
    assert.ok(x >= r.hit[0] - 4 && x <= r.hit[0] + r.hit[2] + 4 && y >= r.hit[1] - 4 && y <= r.hit[1] + r.hit[3] + 4, `${r.part} ${r.side}: drawn at ${x},${y}, inside its target`);
    const twin = REGIONS.find((q) => q.part === r.part && q.side !== r.side), arcs = (d) => [...d.matchAll(/a(-?[\d.]+) (-?[\d.]+)/g)].map((m) => m[1] + ' ' + m[2]).join('|');
    assert.equal(arcs(r.d[0]), arcs(twin.d[0]), `${r.part}: the same arcs on both sides (a mirrored arc keeps its radii)`);
  }
  for (const p of ['shoulder', 'forearm', 'shin']) assert.ok(REGIONS.some((r) => r.part === p && r.side === 'l') && REGIONS.some((r) => r.part === p && r.side === 'r'), `${p} on the figure, both sides`);
});

test('picker targets are sized by use (paw-cnfg): the busy parts are at least 28 px a side, none overlap, the nearest target wins in the gaps, the figure fits', async () => {
  const { hitLayout, hitAt, VIEW } = await import('../src/features/tracking/figure.js');
  const hits = hitLayout(), key = (t) => t.part + (t.side || '');
  for (const p of ['thighs', 'hips', 'torso', 'head', 'hand', 'paws', 'shoulder', 'forearm', 'shin']) for (const t of hits.filter((h) => h.part === p)) assert.ok(Math.min(t.w, t.h) >= 28, `${key(t)} ${t.w} x ${t.h}`);
  for (const t of hits) assert.ok(Math.min(t.w, t.h) >= 28 && t.x >= 0 && t.y >= 0 && t.x + t.w <= VIEW[0] && t.y + t.h <= VIEW[1], `${key(t)} inside the figure, >= 28 (the tail has padding too)`);
  assert.equal(hits.length, REGIONS.length);
  for (const a of hits) for (const b of hits) if (a < b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${key(a)} / ${key(b)} do not overlap`);
  for (const t of hits) assert.equal(key(hitAt(t.x + t.w / 2, t.y + t.h / 2)), key(t), `${key(t)}: its centre takes it`);
  assert.equal(key(hitAt(118, 100)), 'hips', 'between the hips and the thighs the nearer one wins');
  assert.ok(VIEW[1] <= 190 && VIEW[0] <= 236, 'fits the picker (252 px wide; paw-5r1: 28 px taller for the shins)');
  const area = (t) => t.w * t.h;
  assert.ok(area(hits.find((h) => h.part === 'thighs')) >= 800, 'a thigh target is now 28 x 30 (it was 10 x 14)');
});
