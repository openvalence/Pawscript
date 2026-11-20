// paw-m2cg perf fix: the overlay's animation driver keeps ONE loop however often it is asked (entering / leaving the assign
// state N times left N loops once: the owner's "seconds per frame after a few selections").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driver } from '../src/features/tracking/anim.js';
import { readFileSync } from 'node:fs';

const fake = () => { let n = 0; const live = new Map(); return { live, raf: (f) => { live.set(++n, f); return n; }, cancel: (i) => live.delete(i), step() { const all = [...live]; live.clear(); all.forEach(([, f]) => f()); } }; };

test('asking for animation 50 times leaves one subscription; stopping leaves none', () => {
  const s = fake();
  let ticks = 0;
  const d = driver(() => { ticks++; d.run(true); }, s);   // a draw that asks again, as the overlay's draw does
  for (let i = 0; i < 50; i++) d.run(true);
  assert.equal(s.live.size, 1, 'one scheduled frame');
  for (let i = 0; i < 10; i++) s.step();
  assert.equal(s.live.size, 1); assert.equal(ticks, 10);
  for (let i = 0; i < 50; i++) { d.run(false); d.run(true); }   // enter / leave the state
  assert.equal(s.live.size, 1);
  d.stop();
  assert.equal(s.live.size, 0); assert.equal(d.live, 0);
});

test('the loop ends by itself when nothing wants it any more', () => {
  const s = fake();
  let want = true;
  const d = driver(() => { want = false; }, s);
  d.run(true);
  s.step();
  assert.equal(s.live.size, 1, 'one more frame was queued before want was read (the tick ran first)');
  d.run(false); s.step();
  assert.equal(s.live.size, 0);
});

test('the overlay starts no animation of its own per draw: no requestAnimationFrame / setInterval in draw(), the highlight is CSS', () => {
  const src = readFileSync(new URL('../src/features/tracking/GroupsOverlay.svelte', import.meta.url), 'utf8');
  const draw = src.slice(src.indexOf('  function draw(ctx, env)'), src.indexOf('  // ---- the cursor canvas'));
  assert.ok(draw.length > 500 && !/requestAnimationFrame|setInterval|setTimeout/.test(draw), 'draw() schedules nothing');
  assert.ok(/animation: gmarch/.test(src) && /animation: gpulse/.test(src) && /prefers-reduced-motion/.test(src), 'the pulse and the dashes are CSS and honour reduced motion');
  assert.ok(/tracking\.groups\.pulse/.test(src), 'a setting turns the pulse off');
});
