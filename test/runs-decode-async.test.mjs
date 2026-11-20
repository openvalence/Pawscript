// paw-o60v.5: decodeRunsAsync decodes a run per slice (a macrotask between runs) and gives exactly what decodeRuns gives:
// the runs, the file key (runsFileKey), the copy-on-write state (runsFileState), the block checks (verifyRuns), for a
// version-1 and a version-2 file, a damaged version-2 file (a bad record left out, a bad block named), and a broken file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRuns, decodeRuns, decodeRunsAsync, runsFileKey, runsFileState, verifyRuns } from '../src/lib/runs-file.js';
import { createServer } from 'node:http';
import { writeRunsCow, readInParts } from '../src/lib/runs-cow.js';
import { cowCommands } from '../dev/mock-cow.js';
import { synthRuns } from '../dev/perf/synth-runs.mjs';
import { strayFence } from '../src/lib/runs.js';

const P = 'C:/v/p.pawruns';
const v1 = (runs) => Buffer.from(encodeRuns(runs)).toString('base64');
const plain = (r) => ({ ...r, frames: r.frames && JSON.parse(JSON.stringify(r.frames)) });
const strip = (st) => st && { ...st, buf: st.buf.length, blocks: st.blocks && [...st.blocks] };

async function same(bytes) {
  const a = decodeRuns(bytes);
  let slices = 0, done = false;
  const p = decodeRunsAsync(bytes, { budget: 0 }).then((r) => { done = true; return r; });
  while (!done) { await new Promise((r) => setTimeout(r, 0)); slices++; }
  const b = await p;
  assert.deepEqual(b.map(plain), a.map(plain));
  assert.equal(v1(b), v1(a));
  assert.deepEqual(runsFileKey(b) && { json: runsFileKey(b).json, n: runsFileKey(b).secs.length }, runsFileKey(a) && { json: runsFileKey(a).json, n: runsFileKey(a).secs.length });
  assert.deepEqual(strip(runsFileState(b)), strip(runsFileState(a)));
  assert.deepEqual([...await verifyRuns(b)], [...await verifyRuns(a)]);
  return { runs: b, slices };
}

test('decodeRunsAsync: a version-1 file, the same runs, key and state; one run per slice', async () => {
  const fx = synthRuns({ runs: 4, frames: 40, points: 32, groups: 2 }), bytes = encodeRuns(decodeRuns(encodeRuns(fx)));
  const { runs, slices } = await same(bytes);
  assert.equal(runs.length, 4);
  assert.ok(slices >= 3, `${slices} slices`);
});

test('decodeRunsAsync: a version-2 file, also damaged (a bad block, a missing record), the same as decodeRuns', async () => {
  const fx = synthRuns({ runs: 3, frames: 40, points: 32, groups: 2 }), files = new Map(), be = { files, ...cowCommands(files) };
  await writeRunsCow(be, P, fx, null);
  const good = files.get(P);
  const { runs } = await same(good);
  assert.equal(runsFileState(runs).v, 2);
  // a byte inside run 1's frame block flipped: verifyRuns names it, the same either way
  const st = runsFileState(decodeRuns(good)), sec = JSON.parse(new TextDecoder().decode(good.subarray(...(([o, l]) => [o, o + l])(st.blocks.get(st.runs[1]))))).frames.sec;
  const [o] = st.blocks.get(sec), bad = good.slice();
  bad[o + 20] ^= 0xff;
  const r2 = await same(bad);
  assert.equal((await verifyRuns(r2.runs)).get(r2.runs[1].id), 'frames');
  // run 2's record block gone from the manifest's reach: that run is left out (damaged), the others open
  const rec = st.blocks.get(st.runs[2]), cut = good.slice();
  cut.fill(0x20, rec[0], rec[0] + rec[1]);
  const r3 = await same(cut);
  assert.equal(r3.runs.length, 2);
  assert.equal(runsFileState(r3.runs).damaged.length, 1);
});

test('readInParts: the file in byte ranges, as the asset protocol serves them (206, at most ~1 MB); anything else reads as before', async () => {
  const data = new Uint8Array(3_500_123);
  for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
  let mode = 'tauri', requests = 0;
  const srv = createServer((q, s) => {
    requests++;
    if (q.url !== '/f') { s.writeHead(404); return s.end(); }
    const m = /bytes=(\d+)-(\d+)/.exec(q.headers.range || '');
    if (mode === 'plain' || !m) { s.writeHead(200, { 'content-length': data.length }); return s.end(data); }
    const a = +m[1], b = Math.min(+m[2], a + 1_023_999, data.length - 1);   // (tauri: at most 1 024 000 bytes a range)
    s.writeHead(206, { 'content-range': `bytes ${a}-${b}/${mode === 'shrink' && a > 0 ? data.length - 1 : data.length}` });
    s.end(data.subarray(a, b + 1));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`, viaIpc = [];
  const be = (path) => ({ mediaUrl: () => base + path, readBytes: async (p) => { viaIpc.push(p); return data; } });
  try {
    const got = await readInParts(be('/f'), 'f');
    assert.deepEqual(Buffer.from(got), Buffer.from(data));
    assert.equal(viaIpc.length, 0, 'never through IPC');
    assert.ok(requests >= 4, `${requests} ranges`);
    for (const [m, path] of [['tauri', '/missing'], ['plain', '/f'], ['shrink', '/f']]) {
      mode = m; viaIpc.length = 0;
      assert.deepEqual(Buffer.from(await readInParts(be(path), 'f')), Buffer.from(data), m);
      assert.deepEqual(viaIpc, ['f'], `${m} ${path}: read as before`);
    }
    viaIpc.length = 0;
    await readInParts({ mediaUrl: (p) => p, readBytes: async (p) => { viaIpc.push(p); return data; } }, 'C:/x.pawruns');   // (no asset URL: tests, the mock shell)
    assert.deepEqual(viaIpc, ['C:/x.pawruns']);
  } finally { srv.close(); }
});

test('strayFence: the typed sort gives the comparator sort\'s fence (NaN gaps, -0 / 0, ties, strays, short and flat channels)', () => {
  const old = (v) => {   // before paw-o60v.5
    const s = Array.from(v).filter((y) => y === y).sort((a, b) => a - b), n = s.length;
    if (n < 8) return null;
    const q1 = s[n >> 2], q3 = s[(3 * n) >> 2], k = 3 * (q3 - q1);
    if (!(k > 0)) return null;
    let c = 0;
    for (const y of s) if (y < q1 - k || y > q3 + k) c++;
    return c && c <= Math.max(3, n / 100) ? [q1 - k, q3 + k] : null;
  };
  let seed = 9, fences = 0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 3000; k++) {
    const n = 1 + Math.floor(rnd() * 700), v = new Float32Array(n), kind = k % 5;
    for (let i = 0; i < n; i++) {
      const r = rnd();
      v[i] = r < 0.05 ? NaN : kind === 0 ? (r < 0.5 ? -0 : 0) : kind === 1 ? Math.round(r * 4) / 4 : kind === 2 && r > 0.995 ? 50 + r : r - 0.5;
    }
    if (kind === 3) for (let j = 0; j < 3; j++) v[Math.floor(rnd() * n)] = -40;
    const a = strayFence(v), b = old(v);
    assert.deepEqual(a, b, `case ${k}`);
    if (a) fences++;
  }
  assert.ok(fences > 300, `${fences} fences found`);
  assert.deepEqual(strayFence([1, 2, 3, null, 4, 5, 6, 7, 8, 100]), old([1, 2, 3, null, 4, 5, 6, 7, 8, 100]), 'a plain array: as before');
});

test('decodeRunsAsync: a broken file rejects as decodeRuns throws', async () => {
  const bytes = encodeRuns(synthRuns({ runs: 2, frames: 10, points: 8, groups: 1 })).slice(0, 40);
  assert.throws(() => decodeRuns(bytes), { code: 'corrupt' });
  await assert.rejects(decodeRunsAsync(bytes), { code: 'corrupt' });
});
