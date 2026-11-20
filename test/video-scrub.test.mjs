// scrub.js pure parts + the Scrubber's positioning policy against a fake VideoDecoder (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTable, indexAt, keyFor, plan, Ring, Scrubber, rangeReader, disposable, nalInfo, demux, framePlan, createScrubber, UNREADABLE, BLOCKED } from '../src/features/video/scrub.js';

const TS = 1000;   // timescale: 1 tick = 1 ms
/** decode-order samples from [cts ticks, key?] pairs, 1 tick = 1 ms, frames 10 ms long */
const mk = (list) => list.map(([cts, key], i) => ({ cts, duration: 10, timescale: TS, is_sync: !!key, offset: i * 100, size: 100 }));
/** CFR, no B-frames: n frames 10 ms apart, keyframe every gop */
const linear = (n, gop) => mk(Array.from({ length: n }, (_, i) => [i * 10, i % gop === 0]));

/** Fake VideoDecoder: outputs in presentation order once more than `depth` frames are pending (a DPB). */
function fakeDecoder(depth = 0, log = { made: 0, closed: 0, decoded: [] }) {
  return class {
    constructor({ output }) { this.output = output; this.pending = []; this.decodeQueueSize = 0; }
    configure() {}
    reset() { this.pending = []; }
    close() {}
    #emit(all) {
      this.pending.sort((a, b) => a - b);
      while (this.pending.length > (all ? 0 : depth)) {
        const ts = this.pending.shift(); log.made++;
        this.output({ timestamp: ts, close() { log.closed++; } });
      }
    }
    decode(c) { log.decoded.push(c.timestamp); this.pending.push(c.timestamp); queueMicrotask(() => this.#emit(false)); }
    flush() { return new Promise((r) => queueMicrotask(() => { this.#emit(true); r(); })); }
  };
}
const Chunk = class { constructor(o) { Object.assign(this, o); } };
const scrubber = (samples, { depth = 0, ring = 10, log } = {}) => {
  log ??= { made: 0, closed: 0, decoded: [] };
  const s = new Scrubber({ table: buildTable(samples), config: {}, read: async () => new Uint8Array(1), ringFrames: ring, waitMs: 2, Decoder: fakeDecoder(depth, log), Chunk });
  return { s, log };
};

test('sample table: presentation order, need, keyframe lookup (B-frames, open GOP)', () => {
  // decode: I0 P2 B1 | I5 (sync) B3 B4 (leading: shown before I5, reference the previous GOP) P6
  const t = buildTable(mk([[0, 1], [20, 0], [10, 0], [50, 1], [30, 0], [40, 0], [60, 0]]));
  assert.deepEqual([...t.ms], [0, 10, 20, 30, 40, 50, 60]);
  assert.deepEqual([...t.decOf], [0, 2, 1, 4, 5, 3, 6]);
  assert.deepEqual([...t.need], [0, 2, 2, 4, 5, 5, 6]);   // frame 1 (B1) is decodable only after P2 was fed
  assert.equal(indexAt(t, 0), 0);
  assert.equal(indexAt(t, 19.5), 2);   // 0.6 ms early still counts as frame 2 (funscript integer ms)
  assert.equal(indexAt(t, 18), 1);
  assert.equal(indexAt(t, 1e9), 6);
  assert.equal(keyFor(t, 2), 0);
  assert.equal(keyFor(t, 5), 3);       // I5 itself
  assert.equal(keyFor(t, 6), 3);
  assert.equal(keyFor(t, 4), 0);       // a leading frame of I5: start from the previous keyframe
  assert.equal(t.byTs.get(30000), 3);  // chunk timestamps are µs from the first presented frame
});

test('plan: forward in GOP feeds, a passed frame resets, a later GOP skips', () => {
  const t = buildTable(linear(100, 30));
  assert.deepEqual(plan(t, { next: 0, run: -1, lastOut: -1 }, 5), { op: 'reset', from: 0 });
  assert.deepEqual(plan(t, { next: 6, run: 0, lastOut: 5 }, 9), { op: 'feed' });
  assert.deepEqual(plan(t, { next: 6, run: 0, lastOut: 5 }, 3), { op: 'reset', from: 0 });   // already output (ring miss)
  assert.deepEqual(plan(t, { next: 6, run: 0, lastOut: 5 }, 65), { op: 'skip', from: 60 });
  assert.deepEqual(plan(t, { next: 66, run: 60, lastOut: 65 }, 40), { op: 'reset', from: 30 });
  assert.deepEqual(plan(t, { next: 30, run: 0, lastOut: 29 }, 31), { op: 'feed' });          // next GOP starts right here
  assert.deepEqual(plan(t, { next: 29, run: 0, lastOut: 28 }, 31), { op: 'skip', from: 30 }); // frame 29 is not needed
});

test('ring: LRU, closes on eviction and on replace', () => {
  let closed = 0;
  const f = () => ({ close() { closed++; } });
  const r = new Ring(3);
  r.put(1, f()); r.put(2, f()); r.put(3, f());
  r.get(1);              // touch: 2 is now the oldest
  r.put(4, f());
  assert.deepEqual([...r.map.keys()], [3, 1, 4]);
  assert.equal(closed, 1);
  r.put(4, f());         // duplicate decode of a frame: the old one is closed
  assert.equal(closed, 2);
  r.clear();
  assert.equal(closed, 5);
  assert.equal(r.closed, 5);
});

test('scrubber: forward k frames = k decodes, ring hit backward, jump = keyframe + n, no leaks', async () => {
  const { s, log } = scrubber(linear(200, 30), { ring: 10 });
  const at = (k) => k * 10 + 1;
  let f = await s.frameAt(at(0));
  assert.equal(f.timestamp, 0);
  assert.equal(s.stats.decodes, 1);
  f = await s.frameAt(at(5));
  assert.equal(f.timestamp, 50000);
  assert.equal(s.stats.decodes, 6);              // 5 steps forward = 5 chunks
  f = await s.frameAt(at(3));
  assert.equal(f.timestamp, 30000);
  assert.equal(s.stats.decodes, 6);              // backward within the ring: no decode
  assert.equal(s.stats.hits, 1);
  f = await s.frameAt(at(65));
  assert.equal(f.timestamp, 650000);
  assert.equal(s.stats.decodes, 6 + 6);          // skip to keyframe 60, decode 60..65
  assert.equal(s.stats.resets, 1);               // (the first request); the skip needed no reset
  f = await s.frameAt(at(40));
  assert.equal(f.timestamp, 400000);
  assert.equal(s.stats.decodes, 12 + 11);        // passed and evicted: reset to keyframe 30, decode 30..40
  assert.equal(s.stats.resets, 2);
  assert.ok(s.ring.map.size <= 10);
  assert.equal(log.made, log.closed + s.ring.map.size);   // every frame is in the ring or closed
  s.dispose();
  assert.equal(log.made, log.closed);
});

test('scrubber: newest request wins; stale targets resolve null but their frames fill the ring', async () => {
  const { s, log } = scrubber(linear(100, 50), { ring: 20 });
  const ps = [s.frameAt(21), s.frameAt(51), s.frameAt(91)];
  const [a, b, c] = await Promise.all(ps);
  assert.equal(a, null); assert.equal(b, null);
  assert.equal(c.timestamp, 90000);
  assert.equal(s.stats.coalesced, 2);
  assert.ok(s.stats.decodes <= 10);                // never more than what the newest target needs
  assert.ok(s.ring.get(5) && s.ring.get(2));       // the way there is in the ring
  const d = await s.frameAt(41);
  assert.equal(d.timestamp, 40000);
  assert.equal(s.stats.decodes, 10);
  s.dispose();
  assert.equal(log.made, log.closed);
});

test('scrubber: B-frames with a reordering decoder (learns the extra input it needs), every frame correct', async () => {
  // GOP of 6 in decode order I P B B P B (pts 0 3 1 2 5 4), repeated
  const list = [];
  for (let g = 0; g < 5; g++) for (const [c, k] of [[0, 1], [3, 0], [1, 0], [2, 0], [5, 0], [4, 0]]) list.push([(g * 6 + c) * 10, k]);
  const { s, log } = scrubber(mk(list), { depth: 2, ring: 40 });
  for (let k = 0; k < 30; k++) {
    const f = await s.frameAt(k * 10 + 1);
    assert.equal(f?.timestamp, k * 10000, 'frame ' + k);
  }
  for (let k = 29; k >= 0; k--) assert.equal((await s.frameAt(k * 10 + 1)).timestamp, k * 10000);   // all ring hits back
  assert.equal(s.stats.decodes, 30);
  assert.ok(s.stats.extra >= 1 && s.stats.extra <= 2, 'extra ' + s.stats.extra);
  s.dispose();
  assert.equal(log.made, log.closed);
});

test('rangeReader: blocks across boundaries, servers that answer shorter ranges (Tauri caps at 1000 KiB)', async () => {
  const file = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (_u, { headers }) => {
    calls++;
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(headers.Range), s = +a, e = Math.min(+b, s + 299, file.length - 1);   // at most 300 bytes
    const body = file.slice(s, e + 1);
    return { ok: true, status: 206, headers: { get: () => `bytes ${s}-${e}/${file.length}` }, arrayBuffer: async () => body.buffer };
  };
  try {
    const r = rangeReader('x', 1024);
    const got = await r.read(1000, 1500);            // spans blocks 0..2, each filled by several short answers
    assert.deepEqual([...got], [...file.slice(1000, 2500)]);
    assert.equal(r.size, 5000);
    const n = calls;
    assert.deepEqual([...(await r.read(1100, 10))], [...file.slice(1100, 1110)]);
    assert.equal(calls, n);                          // cached block
    assert.deepEqual([...(await r.read(4990, 10))], [...file.slice(4990, 5000)]);   // last, partial block
  } finally { globalThis.fetch = real; }
});

test('demux: a moov holding a non-ASCII box type (an editor\'s udta/©TIM) is still read (paw-trxk)', async () => {
  const { createFile } = await import('mp4box');
  const w = createFile();
  const id = w.addTrack({ width: 64, height: 64, timescale: 24, type: 'avc1', avcDecoderConfigRecord: new Uint8Array([1, 0x4d, 0x40, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x4d, 0x40, 0x1e, 1, 0, 2, 0x68, 0xeb]).buffer });
  for (let i = 0; i < 3; i++) w.addSample(id, new Uint8Array([0, 0, 0, 1, 0x65]), { duration: 1, is_sync: i === 0 });
  const ds = w.getBuffer(), src = new Uint8Array(ds.buffer, 0, ds.byteLength), dv = new DataView(src.buffer);
  const moov = 20, n = dv.getUint32(moov);   // ftyp (20 bytes), then the moov
  assert.equal(String.fromCharCode(...src.slice(moov + 4, moov + 8)), 'moov');
  const tim = [0, 0, 0, 12, 0xa9, 0x54, 0x49, 0x4d, 1, 2, 3, 4], udta = [0, 0, 0, 8 + tim.length, 0x75, 0x64, 0x74, 0x61, ...tim];   // udta { '©TIM' }
  const file = new Uint8Array(src.length + udta.length);
  file.set(src.subarray(0, moov + n)); file.set(udta, moov + n); file.set(src.subarray(moov + n), moov + n + udta.length);
  new DataView(file.buffer).setUint32(moov, n + udta.length);
  const reader = { size: file.length, read: async (o, l) => file.slice(o, o + l) };
  // the moov and its track are read; this writer's file is fragmented, which demux refuses next (never 'no moov box')
  await assert.rejects(demux(reader), /fragmented MP4/);
});

test('non-reference pictures: H.264 nal_ref_idc / HEVC types, and jumps skip them far from the target only', async () => {
  const nal = (len, ...bytes) => [0, 0, 0, bytes.length, ...bytes];   // 4-byte length prefix
  const avc = (...nals) => Uint8Array.from(nals.flat());
  assert.equal(disposable(avc(nal(4, 0x01, 9, 9)), 'avc', 4), true);            // non-IDR slice, nal_ref_idc 0
  assert.equal(disposable(avc(nal(4, 0x41, 9)), 'avc', 4), false);              // nal_ref_idc 2
  assert.equal(disposable(avc(nal(4, 0x09, 0xf0), nal(4, 0x01, 1)), 'avc', 4), true);   // AUD then a disposable slice
  assert.equal(disposable(avc(nal(4, 0x06, 1)), 'avc', 4), false);              // SEI only: not a picture
  assert.equal(disposable(avc(nal(4, 0x00, 1, 1)), 'hevc', 4), true);           // TRAIL_N
  assert.equal(disposable(avc(nal(4, 0x02, 1, 1)), 'hevc', 4), false);          // TRAIL_R
  assert.deepEqual(nalInfo('avc1.640028', Uint8Array.of(1, 0x64, 0, 0x28, 0xff)), { family: 'avc', len: 4 });
  assert.equal(nalInfo('vp09.00.10.08', Uint8Array.of(1)), null);

  // every odd frame disposable; ring 10: a jump to frame 80 (keyframe 0) skips odd frames below 70 only
  const samples = linear(100, 100), log = { made: 0, closed: 0, decoded: [] };
  const data = (i) => (i % 2 ? avc(nal(4, 0x01, 1)) : avc(nal(4, 0x41, 1)));
  const s = new Scrubber({ table: buildTable(samples), config: {}, read: async (off) => data(off / 100), ringFrames: 10, waitMs: 2,
    nal: { family: 'avc', len: 4 }, Decoder: fakeDecoder(0, log), Chunk });
  assert.equal((await s.frameAt(801)).timestamp, 800000);
  assert.equal(s.stats.dropped, 35);                 // 1, 3, ..., 69
  assert.equal(s.stats.decodes, 81 - 35);
  assert.equal((await s.frameAt(791)).timestamp, 790000);   // inside the ring window: decoded, a hit
  s.dispose();
});

test('scrubber: all-intra file (the scrub cache): any jump, forward or back, costs exactly 1 decode', async () => {
  const { s, log } = scrubber(linear(3000, 1), { ring: 10 });
  const at = (k) => k * 10 + 1;
  let n = 0;
  for (const k of [0, 1500, 20, 2999, 600, 601, 7]) {
    const f = await s.frameAt(at(k));
    assert.equal(f.timestamp, k * 10000, 'frame ' + k);
    assert.equal(s.stats.decodes, ++n, 'decodes after frame ' + k);
  }
  assert.equal(s.stats.extra, 0);
  s.dispose();
  assert.equal(log.made, log.closed);
});

// paw-b88b: a WebM / VP8 source had no frames at all (the stream copy to MP4 fails: "[mp4 @ ...] Could not find tag for codec
// vp8"): Copy from… compared only the frame on screen. The plan per codec, and the walk on a fake backend.
test('framePlan: an MP4 as it is, a copy for a codec MP4 holds, the cached copies before a transcode (paw-b88b)', () => {
  const alts = ['C:/c/scrub.mp4', 'C:/c/proxy-480.mp4'], A = alts.map((alt) => ({ alt }));
  assert.deepEqual(framePlan({ path: 'C:/v/a.mp4', codec: 'h264', alts }), ['direct', ...A, 'transcode']);   // HEVC without a decoder, 10-bit: the rest
  assert.deepEqual(framePlan({ path: 'C:/v/a.MOV', alts: [] }), ['direct', 'transcode']);
  for (const codec of ['h264', 'hevc', 'vp9', 'av1', '']) assert.deepEqual(framePlan({ path: 'C:/v/a.mkv', codec, alts }), ['copy', ...A, 'transcode'], codec || 'unknown');
  for (const [path, codec] of [['C:/v/a.webm', 'vp8'], ['C:/v/a.ogv', 'theora'], ['C:/v/a.ts', 'mpeg2video'], ['C:/v/a.avi', 'mpeg4'], ['C:/v/a.mkv', 'prores']]) {
    assert.deepEqual(framePlan({ path, codec, alts }), [...A, 'transcode'], `${codec}: never a copy`);
  }
  assert.deepEqual(framePlan({ path: 'C:/v/a.webm', codec: 'vp8', alts, transcode: false }), A, 'a scrub cache on its way: no transcode');
  assert.deepEqual(framePlan({ path: 'C:/v/a.webm', codec: 'vp8', alts: [...alts, alts[0], 'C:/v/a.webm', null] }), [...A, 'transcode'], 'each file once, never the source');
  assert.deepEqual(framePlan({ codec: 'vp8', alts }), ['direct', ...A], 'no path: the url, nothing to remux');
});

test('the unreadable line: plain, at most 60 characters, the fix in it, never ffmpeg\'s words', () => {
  assert.ok(UNREADABLE.length <= 60, UNREADABLE);
  assert.match(UNREADABLE, /proxy/);
  assert.doesNotMatch(UNREADABLE, /ffmpeg|remux|\[|@|codec|\.$/);
});

test('createScrubber on a VP8 WebM: the cached copies, then one shared transcode, never a copy; one plain line (paw-b88b)', async () => {
  const urls = [], asked = [], real = { fetch: globalThis.fetch, VD: globalThis.VideoDecoder, info: console.info };
  globalThis.fetch = async (u) => { urls.push(u); return { ok: false, status: 404 }; };   // nothing decodes here: every step is tried
  globalThis.VideoDecoder = class {};
  console.info = () => {};
  const stderr = 'ffmpeg failed: [mp4 @ 0000021398e54b00] Could not find tag for codec vp8 in stream #0';
  const backend = {
    mediaProbe: async () => ({ video: { codec: 'vp8' } }), mediaUrl: (p) => 'asset:' + p,
    remuxMp4: (path, o) => { asked.push(o.h264); return { promise: new Promise((_, no) => setTimeout(() => no(new Error(stderr)), 5)), cancel() {} }; },
  };
  try {
    const a = createScrubber({ url: 'u', path: 'C:/v/a.webm', backend, alts: ['C:/c/scrub.mp4', 'C:/c/proxy.mp4'] });
    const b = createScrubber({ url: 'u', path: 'C:/v/a.webm', backend });   // the shot links asking at the same time
    for (const p of [a, b]) await assert.rejects(p, (e) => e.code === 'unsupported' && e.plain === UNREADABLE && /Could not find tag/.test(e.message));
    assert.deepEqual(urls, ['asset:C:/c/scrub.mp4', 'asset:C:/c/proxy.mp4'], 'the cached copies, in order');
    assert.deepEqual(asked, [true], 'one transcode for both readers, no stream copy');
    asked.length = 0;
    await assert.rejects(createScrubber({ url: 'u', path: 'C:/v/b.mkv', backend: { ...backend, mediaProbe: async () => ({ video: { codec: 'h264' } }) } }));
    assert.deepEqual(asked, [false, true], 'H.264 in MKV: the copy, then (undecodable) the transcode');
  } finally { Object.assign(globalThis, { fetch: real.fetch, VideoDecoder: real.VD }); console.info = real.info; }
});

test('createScrubber whose reads the webview refuses (release CSP): stops at once, no transcode, BLOCKED, not "make a proxy" (paw-e3tu)', async () => {
  const urls = [], asked = [], real = { fetch: globalThis.fetch, VD: globalThis.VideoDecoder, info: console.info };
  globalThis.fetch = async (u) => { urls.push(u); throw new TypeError('Failed to fetch'); };   // what a CSP-blocked fetch does
  globalThis.VideoDecoder = class {};
  console.info = () => {};
  const backend = { mediaProbe: async () => ({ video: { codec: 'h264' } }), mediaUrl: (p) => 'asset:' + p,
    remuxMp4: (_p, o) => { asked.push(o.h264); return { promise: Promise.resolve('C:/c/remux.mp4'), cancel() {} }; } };
  try {
    await assert.rejects(createScrubber({ url: 'asset:C:/v/a.mp4', path: 'C:/v/a.mp4', backend, alts: ['C:/c/scrub.mp4'] }),
      (e) => e.code === 'unsupported' && e.plain === BLOCKED && /read blocked \(Failed to fetch\)/.test(e.message));
    assert.deepEqual(urls, ['asset:C:/v/a.mp4'], 'one read, never the cached copies');
    assert.deepEqual(asked, [], 'no transcode of a file it could not read either');
    assert.ok(BLOCKED.length <= 60 && !/proxy|codec/.test(BLOCKED), BLOCKED);
  } finally { Object.assign(globalThis, { fetch: real.fetch, VideoDecoder: real.VD }); console.info = real.info; }
});
