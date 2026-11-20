import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeaks, pickLevel, thumbAt } from '../src-tauri/js/media-data.js';

function build(levels, { sr = 8000, total = 80000, magic = 'PWPK', ver = 1 } = {}) {
  let size = 24 + levels.length * 8;
  for (const l of levels) { if (size % 2) size++; size += l.count * 6; }
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint32(4, ver, true); dv.setUint32(8, sr, true); dv.setUint32(12, levels.length, true); dv.setBigUint64(16, BigInt(total), true);
  levels.forEach((l, i) => { dv.setUint32(24 + i * 8, l.spb, true); dv.setUint32(28 + i * 8, l.count, true); });
  let off = 24 + levels.length * 8, v = 1;
  for (const l of levels) {
    if (off % 2) off++;
    for (let j = 0; j < l.count * 3; j++, off += 2) dv.setInt16(off, j % 3 === 0 ? -v++ : v, true);
  }
  return buf;
}
const L = [{ spb: 64, count: 3 }, { spb: 128, count: 1 }]; // 8 ms and 16 ms buckets

test('parsePeaks reads header, levels, views', () => {
  const buf = build(L);
  const p = parsePeaks(buf);
  assert.equal(p.version, 1); assert.equal(p.sampleRate, 8000); assert.equal(p.totalSamples, 80000);
  assert.equal(p.durationMs, 10000);
  assert.deepEqual(p.levels.map((l) => [l.samplesPerBucket, l.bucketMs, l.count, l.data.length]), [[64, 8, 3, 9], [128, 16, 1, 3]]);
  assert.equal(p.levels[0].data.buffer, buf); // view, no copy
  assert.deepEqual([...p.levels[0].data.slice(0, 3)], [-1, 2, 2]);
  assert.deepEqual([...p.levels[1].data], [-4, 5, 5]);
});

test('parsePeaks rejects bad input', () => {
  assert.throws(() => parsePeaks(build(L, { magic: 'XXXX' })), /magic/);
  assert.throws(() => parsePeaks(build(L, { ver: 2 })), /version/);
  assert.throws(() => parsePeaks(build(L).slice(0, 40)), /truncated/);
  assert.throws(() => parsePeaks(new ArrayBuffer(8)), /short/);
});

test('pickLevel', () => {
  const p = parsePeaks(build(L));
  assert.equal(pickLevel(p, 1).count, 3); // none qualifies -> finest
  assert.equal(pickLevel(p, 8).bucketMs, 8);
  assert.equal(pickLevel(p, 15.9).bucketMs, 8);
  assert.equal(pickLevel(p, 16).bucketMs, 16);
  assert.equal(pickLevel(p, 1000).bucketMs, 16);
});

const times = (n, step) => Array.from({ length: n }, (_, i) => i * step + step / 2);
const strip = () => ({
  tile_w: 160, tile_h: 90, columns: 10, rows: 10,
  levels: [
    { count: 20, times_ms: times(20, 5000), sheets: ['c0.jpg'] }, // complete
    { count: 250, times_ms: times(250, 400), sheets: ['f0.jpg', 'f1.jpg'] }, // 3 sheets needed, 2 present
  ],
});

test('thumbAt default level and cell math', () => {
  const s = strip();
  assert.deepEqual(thumbAt(s, 0), { index: 0, sheet: 'c0.jpg', x: 0, y: 0, w: 160, h: 90, timeMs: 2500 });
  assert.equal(thumbAt(s, 1e9).index, 19);
  const b = thumbAt(s, 105 * 400 + 200, 1);
  assert.deepEqual([b.index, b.sheet, b.x, b.y], [105, 'f1.jpg', 800, 0]);
  const c = thumbAt(s, 11 * 400 + 200, 1);
  assert.deepEqual([c.index, c.sheet, c.x, c.y], [11, 'f0.jpg', 160, 90]);
});

test('thumbAt fallback, rounding, null', () => {
  const s = strip();
  s.levels[1].sheets.push('f2.jpg'); // fine level complete -> default picks it
  assert.equal(thumbAt(s, 0).sheet, 'f0.jpg');
  s.levels[1].sheets.pop();
  s.levels[0].sheets = []; // nothing complete -> highest level with a sheet
  assert.equal(thumbAt(s, 0).sheet, 'f0.jpg');
  assert.equal(thumbAt(s, 240 * 400, 1), null); // frame 240 is in missing sheet 2
  assert.equal(thumbAt(s, 399, 1).index, 0); // times 200, 600: 399 is nearer 200
  assert.equal(thumbAt(s, 401, 1).index, 1);
  s.levels.forEach((l) => (l.sheets = []));
  assert.equal(thumbAt(s, 0), null);
});
