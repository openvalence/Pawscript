// paw-yx6q part 2: grow is the smooth blob on the limb, never "little arms that reach everywhere". SAM's larger levels take in
// similar-coloured thin things touching the part; a dab stepped up to them. Now a dab steps back down from a level whose arms
// reach out (grow.js hasArms), arms that reach out are opened away, ears / fingers / a compact larger level stay, the stroke stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMask, cleanMask, openArms, hasArms } from '../src/features/tracking/grow.js';

const W = 320, H = 180;
const draw = (f) => { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x + 0.5, y + 0.5) ? 1 : 0; return a; };
const segD = (x, y, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
const limb = (x, y) => segD(x, y, [80, 100], [220, 80]) < 13;
const strands = (x, y) => segD(x, y, [130, 93], [150, 20]) < 2 || segD(x, y, [180, 86], [260, 160]) < 2.5 || segD(x, y, [110, 96], [40, 170]) < 2;
const area = (a) => a.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0);
const outside = (a, f) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] >= 0.5 && !f((i % W) + 0.5, Math.floor(i / W) + 0.5)) n++; return n; };

test('a dab steps back down from the level with arms to the smooth limb; without arms it walks up as before', () => {
  const sub = { a: draw((x, y) => limb(x, y) && x < 140), score: 0.8 }, part = { a: draw(limb), score: 0.9 }, armed = { a: draw((x, y) => limb(x, y) || strands(x, y)), score: 0.4 };
  const dab = [[150, 90]];
  assert.equal(pickMask([sub, part, armed], dab, W, H).index, 2, 'the old rule: up to the largest level (the arms)');
  assert.equal(pickMask([sub, part, armed], dab, W, H, { arms: true }).index, 1, 'back down to the limb');
  const whole = { a: draw((x, y) => limb(x, y) || Math.hypot(x - 240, y - 70) < 30), score: 0.4 };   // a compact larger level: no arms
  assert.equal(pickMask([sub, part, whole], dab, W, H, { arms: true }).index, 2, 'a larger level without arms is still taken (no hesitation)');
  assert.ok(hasArms(openArms(armed.a, W, H)) && !hasArms(openArms(part.a, W, H)) && !hasArms(openArms(whole.a, W, H)));
});

test('cleanMask: arms that reach out go, ears stay, the brushed stroke is always kept', () => {
  const armed = draw((x, y) => limb(x, y) || strands(x, y));
  const plain = cleanMask(armed, W, H, [[150, 90]], { margin: 0 }).a, clean = cleanMask(armed, W, H, [[150, 90]], { margin: 0, arms: true }).a;
  assert.ok(outside(plain, limb) > 150, `before: the strands stay (${outside(plain, limb)} px off the limb)`);
  assert.ok(outside(clean, limb) < 0.02 * area(clean), `after: ${outside(clean, limb)} px off the limb`);
  assert.ok(area(clean) > 0.9 * area(draw(limb)), 'the limb itself stays');
  const head = (x, y) => Math.hypot(x - 160, y - 100) < 35 || (y < 75 && y > 40 && Math.abs(x - 160 + (x < 160 ? 22 : -22)) < (y - 40) * 0.3);
  const h = cleanMask(draw(head), W, H, [[160, 100]], { margin: 0, arms: true }).a, h0 = cleanMask(draw(head), W, H, [[160, 100]], { margin: 0 }).a;
  assert.ok(Math.abs(area(h) - area(h0)) < 0.01 * area(h0), 'ears are the part: not opened away');
  const stroke = draw((x, y) => segD(x, y, [150, 20], [150, 60]) < 4);   // the owner brushed up a strand
  const s = cleanMask(armed, W, H, [[150, 90]], { margin: 0, arms: true, stroke }).a;
  for (let i = 0; i < s.length; i++) if (stroke[i] >= 0.5) assert.ok(s[i] >= 0.5, 'the stroke is kept');
});
