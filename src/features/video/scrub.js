// scrub.js -- WebCodecs frame source for hover scrub: every frame, source quality, no cache on disk.
// A <video> re-decodes from the keyframe on every currentTime change; this keeps one VideoDecoder positioned and
// walks it: forward inside a GOP costs one chunk per frame step, recent frames come back from a ring of decoded
// VideoFrames, anything else is "keyframe <= target, decode forward" (the frames on the way fill the ring).
//
//   const s = await createScrubber({ url, path, fps, ringS, backend });   // throws {code:'unsupported'} if it can't
//   const f = await s.frameAt(ms);   // VideoFrame | null (superseded by a newer request). Owned by the ring:
//                                    // draw it now, never close it; valid until the next frameAt.
//   s.frameMs(ms) -> presentation time of the frame shown for ms;  s.stats;  s.dispose()
//
// MP4/MOV is demuxed with mp4box (ranged fetch through the same URL the <video> plays); other containers are
// stream-copied to an MP4 in the media cache first (backend.remuxMp4), or read from a cached copy / an H.264 transcode
// when the codec cannot be copied (framePlan, paw-b88b). The pure parts (sample table, keyframe
// lookup, the positioning plan, the ring) are exported for test/video-scrub.test.mjs.

import { TOL_MS } from './frames.js';

const unsupported = (why) => Object.assign(new Error('scrub: ' + why), { code: 'unsupported' });

// ---------------------------------------------------------------- sample table

/**
 * mp4box samples (decode order: {cts, duration, timescale, is_sync, offset, size}) -> table.
 * Times start at 0 at the first presented frame (what the <video> reports for an edit-listed MP4).
 * ponytail: a shifted first-cts is the only edit list handled; multi-entry edit lists would need elst parsing.
 */
export function buildTable(samples) {
  const n = samples.length;
  let c0 = Infinity;
  for (const s of samples) c0 = Math.min(c0, s.cts / s.timescale);
  const order = [...samples.keys()].sort((a, b) => samples[a].cts / samples[a].timescale - samples[b].cts / samples[b].timescale);
  const ms = new Float64Array(n), decOf = new Int32Array(n), presOf = new Int32Array(n), need = new Int32Array(n);
  let mx = -1;
  order.forEach((d, p) => { ms[p] = (samples[d].cts / samples[d].timescale - c0) * 1000; decOf[p] = d; presOf[d] = p; need[p] = mx = Math.max(mx, d); });
  const dec = samples.map((s, d) => ({ offset: s.offset, size: s.size, key: !!s.is_sync, ts: Math.round(ms[presOf[d]] * 1000), dur: Math.round((s.duration / s.timescale) * 1e6) }));
  const keys = dec.flatMap((s, d) => (s.key ? [d] : []));
  const byTs = new Map(dec.map((s, d) => [s.ts, presOf[d]]));
  let reorder = 0;   // the stream's reorder depth: frames a conformant decoder holds before it outputs one
  for (let p = 0; p < n; p++) reorder = Math.max(reorder, need[p] - p);
  return { n, dec, ms, decOf, presOf, need, keys, byTs, reorder };
}

/** Presentation index of the frame whose interval contains ms (TOL_MS early accepted, like the player clock). */
export function indexAt(t, ms) {
  let lo = 0, hi = t.n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t.ms[m] <= ms + TOL_MS) lo = m; else hi = m - 1; }
  return lo;
}

/** Decode index of the keyframe to start from for presentation index p (not one whose leading frames include p). */
export function keyFor(t, p) {
  const d = t.decOf[p], K = t.keys;
  let lo = 0, hi = K.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (K[m] <= d) lo = m; else hi = m - 1; }
  while (lo > 0 && t.ms[t.presOf[K[lo]]] > t.ms[p]) lo--;
  return K[lo] ?? 0;
}

/**
 * Positioning plan for presentation index p (ring miss). st = {next: decode index fed next, run: decode index the
 * current contiguous run started at (-1 = needs a keyframe), lastOut: newest presentation index output}.
 * -> {op: 'feed'} keep feeding from st.next | {op: 'skip', from} feed from keyframe `from` (no reset: it is ahead)
 *  | {op: 'reset', from} flush the decoder and start at `from`.
 */
export function plan(t, st, p) {
  const k = keyFor(t, p);
  if (st.run < 0 || k < st.run || st.lastOut >= p) return { op: 'reset', from: k };
  if (k > st.next) return { op: 'skip', from: k };
  return { op: 'feed' };
}

// ---------------------------------------------------------------- non-reference pictures

/** {family, len} for length-prefixed H.264 / HEVC samples (from the avcC / hvcC record), else null. */
export function nalInfo(codec, description) {
  if (!description) return null;
  if (/^avc[13]/.test(codec) && description.length > 4) return { family: 'avc', len: (description[4] & 3) + 1 };
  if (/^(hev1|hvc1)/.test(codec) && description.length > 21) return { family: 'hevc', len: (description[21] & 3) + 1 };
  return null;
}

/** True if no other picture references this sample (H.264 nal_ref_idc 0; HEVC sub-layer non-reference types). */
export function disposable(data, family, len) {
  let vcl = false;
  for (let i = 0; i + len < data.length;) {
    let n = 0;
    for (let k = 0; k < len; k++) n = n * 256 + data[i + k];
    const h = data[i + len];
    if (family === 'avc') { const ty = h & 31; if (ty === 1 || ty === 5) { if (h & 0x60) return false; vcl = true; } }
    else { const ty = (h >> 1) & 63; if (ty < 32) { if (ty > 14 || ty % 2) return false; vcl = true; } }
    i += len + n;
  }
  return vcl;
}

// ---------------------------------------------------------------- ring of decoded frames

/** LRU of decoded frames keyed by presentation index; evicted frames are closed. */
export class Ring {
  map = new Map();
  closed = 0;
  constructor(cap) { this.cap = Math.max(1, cap | 0); }
  get(p) { const f = this.map.get(p); if (f) { this.map.delete(p); this.map.set(p, f); } return f; }
  put(p, f) {
    const old = this.map.get(p);
    if (old) { this.map.delete(p); if (old !== f) { old.close(); this.closed++; } }
    this.map.set(p, f);
    while (this.map.size > this.cap) { const [k, v] = this.map.entries().next().value; this.map.delete(k); v.close(); this.closed++; }
  }
  clear() { for (const f of this.map.values()) { f.close(); this.closed++; } this.map.clear(); }
}

// ---------------------------------------------------------------- the scrubber

export class Scrubber {
  stats = { requests: 0, decodes: 0, dropped: 0, hits: 0, coalesced: 0, resets: 0, skips: 0, served: 0, meanMs: 0, lastMs: 0, extra: 0 };
  #want = null;      // {p, at, resolve}: the newest request (older ones resolved with null)
  #st = { next: 0, run: -1, lastOut: -1 };
  #extra = 0;        // chunks past need[p] the decoder wants before it outputs p (learned)
  #kick = null; #pumping = false; #outs = 0;
  error = null;

  /** table: buildTable(); config: VideoDecoderConfig; read(offset, size) -> Promise<Uint8Array>; copy: frames go to
   *  ImageBitmaps at once (hardware decoders stall while their few output frames are held); nal: {family:'avc'|'hevc',
   *  len: NAL length size} lets jumps skip non-reference pictures (nalInfo()); Decoder/Chunk for tests. */
  constructor({ table, config, read, ringFrames = 90, waitMs = 40, copy = false, nal = null, Decoder = globalThis.VideoDecoder, Chunk = globalThis.EncodedVideoChunk }) {
    Object.assign(this, { t: table, config, read, waitMs, copy, nal, Chunk });
    this.ring = new Ring(ringFrames);
    this.dec = new Decoder({ output: (f) => this.#out(f), error: (e) => this.#fail(e) });
    this.dec.configure(config);
  }

  frameMs(ms) { return this.t.ms[indexAt(this.t, ms)]; }

  frameAt(ms) {
    if (this.error || !this.dec) return Promise.resolve(null);
    const p = indexAt(this.t, ms), at = performance.now();
    this.stats.requests++;
    const hit = this.ring.get(p);
    if (hit) { this.#drop(); this.stats.hits++; this.#served(at); return Promise.resolve(hit); }
    this.#drop();
    const pr = new Promise((resolve) => (this.#want = { p, at, resolve }));
    this.#kick?.();   // a pump waiting on output re-plans for the new target now
    this.#pump();
    return pr;
  }

  dispose() {
    this.#drop();
    try { this.dec?.close(); } catch { /* already closed */ }
    this.dec = null;
    this.ring.clear();
  }

  #drop() { const w = this.#want; if (w) { this.#want = null; this.stats.coalesced++; w.resolve(null); } }
  #served(at) { const s = this.stats, d = performance.now() - at; s.served++; s.lastMs = d; s.meanMs += (d - s.meanMs) / s.served; }
  #fail(e) { this.error = e; const w = this.#want; this.#want = null; w?.resolve(null); this.#kick?.(); }

  #out(f) {
    const p = this.t.byTs.get(f.timestamp), st = this.#st;
    // a run's leading frames (shown before its keyframe, open GOP) reference the previous GOP: not trustworthy
    if (p == null || !this.dec || (st.run >= 0 && this.t.decOf[p] >= st.run && p < this.t.presOf[st.run])) { f.close(); return; }
    if (this.copy) { const run = this.stats.resets; createImageBitmap(f).then((bm) => { f.close(); this.#keep(p, bm, run); }, () => f.close()); return; }
    this.#keep(p, f, this.stats.resets);
  }
  #keep(p, f, run) {
    const st = this.#st;
    if (!this.dec) { f.close(); return; }
    this.#outs++;
    if (run === this.stats.resets) st.lastOut = Math.max(st.lastOut, p);   // a copy finishing after a reset is from the old run
    this.ring.put(p, f);
    const w = this.#want;
    if (w && w.p === p) { this.#want = null; this.#served(w.at); w.resolve(f); }
    this.#kick?.();
  }

  #reset(from) {
    this.dec.reset(); this.dec.configure(this.config);
    Object.assign(this.#st, { next: from, run: from, lastOut: -1 });
    this.stats.resets++;
  }

  async #pump() {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#want && this.dec && !this.error) {
        const p = this.#want.p, t = this.t, st = this.#st;
        const hit = this.ring.get(p);
        if (hit) { const w = this.#want; this.#want = null; this.stats.hits++; this.#served(w.at); w.resolve(hit); break; }
        const pl = plan(t, st, p);
        if (pl.op === 'reset') this.#reset(pl.from);
        else if (pl.op === 'skip') { Object.assign(st, { next: pl.from, run: pl.from }); this.stats.skips++; }
        // fed enough when p's references are in (need) and `reorder` later frames push it out of the DPB
        const to = Math.min(t.n - 1, Math.max(t.need[p], st.run + p - t.presOf[st.run] + t.reorder) + this.#extra);
        if (st.next <= to) {
          const d = st.next, s = t.dec[d], data = await this.read(s.offset, s.size);
          if (!this.dec || this.error || st.next !== d) continue;   // disposed, or repositioned meanwhile
          // long way to a jump target: pictures nothing references and the ring would not keep are not decoded
          if (this.nal && !s.key && t.presOf[d] < p - this.ring.cap && disposable(data, this.nal.family, this.nal.len)) { st.next++; this.stats.dropped++; continue; }
          this.dec.decode(new this.Chunk({ type: s.key ? 'key' : 'delta', timestamp: s.ts, duration: s.dur, data }));
          st.next++; this.stats.decodes++;
          continue;
        }
        if (st.next >= t.n) {   // end of stream: only a flush releases the last frames; then a keyframe is required
          await this.dec.flush().catch(() => {});
          if (this.#want?.p === p) { this.#want.resolve(null); this.#want = null; }
          st.run = -1;
          continue;
        }
        // everything p needs is in the decoder: wait for output; if none comes while idle it wants more input
        const outs = this.#outs;
        const why = await new Promise((r) => { this.#kick = r; setTimeout(() => r('timeout'), st.lastOut < 0 ? 5 * this.waitMs : this.waitMs); });
        this.#kick = null;
        if (why !== 'timeout' || this.#outs !== outs || !this.dec || this.dec.decodeQueueSize) continue;
        if (this.#extra >= 16) { this.#fail(new Error('scrub: decoder stalled')); break; }
        this.stats.extra = ++this.#extra;
      }
    } finally { this.#pumping = false; }
  }
}

// ---------------------------------------------------------------- IO + demux

/**
 * read(offset, size) over HTTP Range in blocks (LRU of 32). B = Tauri's asset-protocol cap per range response
 * (1000 KiB), so a block is one request; shorter answers are completed with follow-up ranges. A server without
 * Range support answers 200: the whole file is kept (ponytail: fine for the dev server, not for GB files).
 */
export function rangeReader(url, B = 1000 * 1024) {
  const blocks = new Map();
  let whole = null;
  const r = { size: NaN };
  const load = async (i) => {
    const parts = [];
    let at = i * B, end = i * B + B - 1, got = 0;
    while (at <= end) {
      // paw-e3tu: a fetch that rejects never reached the file (a release build's CSP without asset.localhost in connect-src):
      // 'blocked', so the plan stops there instead of transcoding a copy it could not read either
      const res = await fetch(url, { headers: { Range: `bytes=${at}-${end}` } }).catch((e) => { throw Object.assign(new Error(`scrub: read blocked (${e?.message || e})`), { code: 'blocked' }); });
      if (!res.ok) throw new Error(`scrub: read failed (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (res.status === 200) { whole = buf; r.size = buf.length; return buf.subarray(i * B, i * B + B); }
      const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
      if (m) { r.size = +m[1]; end = Math.min(end, r.size - 1); }
      if (!buf.length) break;
      parts.push(buf); at += buf.length; got += buf.length;
    }
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const block = (i) => {
    if (whole) return Promise.resolve(whole.subarray(i * B, (i + 1) * B));
    let b = blocks.get(i);
    if (b) { blocks.delete(i); blocks.set(i, b); return b; }
    b = load(i);
    b.catch(() => blocks.delete(i));
    blocks.set(i, b);
    if (blocks.size > 32) blocks.delete(blocks.keys().next().value);
    return b;
  };
  r.read = async (off, len) => {
    const i0 = Math.floor(off / B), i1 = Math.floor((off + len - 1) / B);
    if (i0 === i1) { const b = await block(i0); return b.subarray(off - i0 * B, off - i0 * B + len); }
    const out = new Uint8Array(len);
    for (let i = i0; i <= i1; i++) {
      const b = await block(i), s = Math.max(off, i * B), e = Math.min(off + len, (i + 1) * B);
      out.set(b.subarray(s - i * B, e - i * B), s - off);
    }
    return out;
  };
  return r;
}

/** Parse the moov through `reader` -> {samples (decode order), codec, description, width, height}. paw-trxk: box types
 *  outside printable ASCII are allowed (an editor's '©TIM' timecode box in an 'mp42' file's moov made mp4box drop the whole
 *  moov: no frames for hover scrub, Copy from… and the crop / loop links on such a video). */
export async function demux(reader) {
  const { createFile, DataStream, Endianness, MP4BoxBuffer } = await import('mp4box');
  const f = createFile(false, undefined, { allowInvalidBoxTypes: true });
  let info = null, err = null;
  f.onReady = (i) => (info = i);
  f.onError = (_m, e) => (err = e);
  await reader.read(0, 1);   // learns the size
  const size = reader.size;
  let pos = 0;
  for (let guard = 0; !info && !err && pos < size && guard < 4096; guard++) {
    const len = Math.min(1 << 20, size - pos), u8 = await reader.read(pos, len);
    const next = f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(u8.slice().buffer, pos), pos + len >= size);
    pos = next > pos ? next : pos + len;
  }
  if (!info) throw unsupported(err ? 'not an MP4 (' + err + ')' : 'no moov box');
  const tr = info.videoTracks?.[0];
  if (!tr) throw unsupported('no video track');
  if (info.isFragmented) throw unsupported('fragmented MP4');   // ponytail: moof sample tables not read; remux would fix
  const m = tr.matrix;
  if (m && (m[0] !== 65536 || m[1] !== 0 || m[3] !== 0 || m[4] !== 65536)) throw unsupported('rotated video');   // frames come unrotated
  const trak = f.getTrackById(tr.id);
  let description, tagged = false;
  for (const e of trak.mdia.minf.stbl.stsd.entries) {
    const box = e.avcC || e.hvcC || e.vpcC || e.av1C;
    tagged ||= !!e.colr;
    if (box) { const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN); box.write(s); description = new Uint8Array(s.buffer, 8); break; }
  }
  const samples = f.getTrackSamplesInfo(tr.id).map(({ cts, duration, timescale, is_sync, offset, size }) => ({ cts, duration, timescale, is_sync, offset, size }));
  if (!samples.length) throw unsupported('no samples');
  return { samples, codec: tr.codec, description, tagged, width: tr.video?.width || tr.track_width, height: tr.video?.height || tr.track_height };
}

/**
 * The first config the platform decodes. Software first: its frames live in memory, so the ring can hold seconds
 * of them; a hardware decoder's output pool is a dozen frames and decoding stalls while the ring holds them, so
 * hardware frames are copied to ImageBitmaps (RGBA, ~2.7x the memory). Chromium has no software HEVC decoder.
 */
async function pickConfig(base, hw) {
  for (const hardwareAcceleration of hw ? ['prefer-hardware', 'prefer-software'] : ['prefer-software', 'prefer-hardware']) {
    const c = { ...base, hardwareAcceleration, optimizeForLatency: true };
    try { if ((await VideoDecoder.isConfigSupported(c)).supported) return c; } catch { /* malformed config */ }
  }
  return null;
}

const MP4_EXT = /\.(mp4|m4v|mov|3gp)$/i;
// ponytail: fixed budget for the ring (software NV12/I420 1.5 B/px, hardware copies RGBA 4 B/px): 3 s of 4K would
// be ~1.1 GB (software) / 3 GB (hardware); raise it if the machine allows.
const RING_BYTES = 384 * 1024 * 1024;

// paw-b88b: codecs (ffprobe codec_name) ffmpeg's MP4 muxer holds and WebView2's WebCodecs decodes: a stream copy reads them.
// VP8, Theora, MPEG-2 ... have no MP4 tag (the copy fails) or no WebCodecs decoder.
const COPY = new Set(['h264', 'hevc', 'vp9', 'av1']);
/** What the reader says when no step could read a video's frames (the raw reasons go to the console / usage log, never here). */
export const UNREADABLE = 'Frames of this video cannot be read yet: make a proxy';
/** paw-e3tu: the webview refused every read (no file was reached): no proxy or transcode helps, an updated Pawscript does. */
export const BLOCKED = 'This build cannot read video frames: update Pawscript';

/**
 * paw-b88b: where a video's frames are read from, tried in order until one decodes. 'direct': the MP4 / MOV as it is (no path:
 * the url). 'copy': backend.remuxMp4, a stream copy (a codec MP4 holds; codec '' = unknown, tried). {alt}: an MP4 already in the
 * media cache with the same frames at the same times from the first frame (the scrub cache, a proxy): read before a transcode
 * is made. 'transcode': backend.remuxMp4 h264 (shells from paw-b88b; an older shell copies again and fails).
 */
export function framePlan({ path = '', codec = '', alts = [], transcode = true } = {}) {
  const steps = !path || MP4_EXT.test(path) ? ['direct'] : !codec || COPY.has(codec) ? ['copy'] : [];
  for (const a of new Set(alts)) if (a && a !== path) steps.push({ alt: a });
  if (transcode && path) steps.push('transcode');
  return steps;
}

// one remux job per (video, kind) at a time: the hover scrub, Groups and the shot links ask for the same one
const jobs = new Map();
/** paw-56pz: the abort reason of a reader whose pane went (its tab hidden): it lets go, but a frame copy it started goes on (the
 *  same file's next scrubber joins it); any other abort (a new source) stops it once no reader is left. */
export const DETACHED = 'detached';
function remuxed(backend, path, h264, signal, task) {
  if (!backend?.remuxMp4 || !backend.mediaUrl) throw unsupported('no remux');
  const k = `${h264}|${path}`;
  let e = jobs.get(k);
  if (!e) {
    let t = null, job = null;
    job = backend.remuxMp4(path, { h264, onProgress: (f) => { t ??= task?.('Frame copy', { cancel: () => job.cancel() }); t?.update(Math.round(f * 100), 100); } });
    e = { p: Promise.resolve(job.promise).finally(() => { t?.end(); jobs.delete(k); }), cancel: () => job.cancel(), users: 0 };
    jobs.set(k, e);
  }
  e.users++;
  signal?.addEventListener('abort', () => { if (--e.users === 0 && signal.reason !== DETACHED) e.cancel(); });   // the last reader gone: stop it
  return e.p.then((p) => backend.mediaUrl(p));
}

/**
 * -> Scrubber for the media, or throws (code 'unsupported', `plain` = UNREADABLE when no step of framePlan could).
 * hw: try the hardware decoder first (setting video.scrubHw).
 * url: what the <video> plays; path: the file (decides the plan); backend: app.backend (mediaProbe, remuxMp4, mediaUrl).
 * alts: MP4 files with the same frames (player.frameFiles()); transcode: false = never start one (a scrub cache is coming);
 * task: app.task, for a transcode's progress and Cancel in the status bar.
 */
export async function createScrubber({ url, path, fps = 30, ringS = 3, hw = false, backend = null, signal = null, alts = [], transcode = true, task = null } = {}) {
  if (typeof VideoDecoder === 'undefined') throw unsupported('no WebCodecs');
  const codec = !path || MP4_EXT.test(path) ? '' : await Promise.resolve().then(() => backend?.mediaProbe?.(path)).then((p) => p?.video?.codec || '', () => '');
  const why = [];
  let blocked = false;
  for (const step of framePlan({ path, codec, alts, transcode })) {
    if (signal?.aborted) throw unsupported('aborted');
    try {
      const src = step === 'direct' ? url : step.alt ? (backend?.mediaUrl ? backend.mediaUrl(step.alt) : step.alt) : await remuxed(backend, path, step === 'transcode', signal, task);
      return await open(src, { fps, ringS, hw, signal });
    } catch (e) {
      if (signal?.aborted) throw unsupported('aborted');
      why.push(`${step.alt ? 'cached copy' : step}: ${String(e?.message || e).replace(/^scrub: /, '')}`);
      if (e?.code === 'blocked') { blocked = true; break; }   // every later step is read the same way
    }
  }
  const e = unsupported((codec ? codec + ': ' : '') + why.join('; '));
  console.info('[frames] cannot read', path || url, '-', e.message);
  throw Object.assign(e, { plain: blocked ? BLOCKED : UNREADABLE });
}

async function open(src, { fps, ringS, hw, signal }) {
  const reader = rangeReader(src);
  const d = await demux(reader);
  if (signal?.aborted) throw unsupported('aborted');
  const base = { codec: d.codec, description: d.description, codedWidth: d.width, codedHeight: d.height };
  // untagged SD: the <video> converts with BT.601, a VideoFrame defaults to BT.709 (a visible tint); match the video
  // (only when untagged: a config colorSpace overrides the bitstream's own)
  if (!d.tagged && d.height < 720) base.colorSpace = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
  const config = await pickConfig(base, hw);
  if (!config) throw unsupported('codec not decodable (' + d.codec + ')');
  const copy = config.hardwareAcceleration === 'prefer-hardware', px = d.width * d.height * (copy ? 4 : 1.5) || 1;
  const ringFrames = Math.max(8, Math.min(Math.round(ringS * fps), Math.floor(RING_BYTES / px)));
  const s = new Scrubber({ table: buildTable(d.samples), config, read: reader.read, ringFrames, copy, nal: nalInfo(d.codec, d.description) });
  Object.assign(s, { width: d.width, height: d.height, codec: d.codec, hardware: config.hardwareAcceleration });
  return s;
}
