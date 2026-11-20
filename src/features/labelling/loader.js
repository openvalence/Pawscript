// loader.js -- the labelling workspace's image loading (paw-cbw2): pure, no Svelte, no Tauri. A prioritised read queue (at most
// MAX_READS in flight, thumbnails at most MAX_LOW of them, a timeout per read, queued reads cancellable), a decoded-image cache
// capped by BYTES (least recently used out, bitmaps closed), the read-ahead window, and the thumbnail file name.
// test/labelling-load.test.mjs.

export const MAX_READS = 6;            // file reads in flight (a 10 Gb share keeps this many busy; 1 slot of the pool is never a thumbnail)
export const MAX_LOW = 2;              // of those, thumbnail jobs
export const READ_TIMEOUT_MS = 20000;  // a read that takes longer fails ("could not read this image", Retry) and frees its slot
export const CACHE_BYTES = 640 * 2 ** 20;  // decoded images kept: 640 MiB = 13 pictures of 4000 x 3000 (48 MiB each, RGBA)
export const AHEAD = 4, BEHIND = 2;
export const THUMB_PX = 160;

const cancelled = () => Object.assign(new Error('cancelled'), { code: 'cancelled' });

/** The indices to load while the owner is on image i: the next AHEAD, the previous BEHIND (nearest first, forwards first),
 *  and the next UNLABELLED image when "next unlabelled" would skip past those (`next`: that index when the caller knows it). */
export function readAhead(images, labelled, i, { ahead = AHEAD, behind = BEHIND, next } = {}) {
  const n = images.length, out = [];
  for (let k = 1; k <= ahead; k++) if (i + k < n) out.push(i + k);
  for (let k = 1; k <= behind; k++) if (i - k >= 0) out.push(i - k);
  if (next !== undefined) { if (next >= 0 && next !== i && !out.includes(next)) out.push(next); return out; }
  for (let k = 1; k <= n; k++) {   // the next one with no label (forwards, wrapping)
    const j = (i + k) % n;
    if (j === i) break;
    if (!labelled.has(images[j].key)) { if (!out.includes(j)) out.push(j); break; }
  }
  return out;
}

/** The small-thumbnail file for an image key, in the thumbs folder (a changed file has a new key, so a new thumbnail). */
export const thumbFile = (dir, key) => dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/') + key + '.jpg';
/** The keys a thumbs-folder listing holds. */
export const thumbKeys = (entries) => new Set((entries || []).filter((e) => !e.is_dir && /^i[0-9a-f]{14}\.jpg$/.test(e.name)).map((e) => e.name.slice(0, -4)));

/** Jobs by priority (lower first), at most `max` running, `maxLow` of the `low` ones. run() -> promise; a job past `timeoutMs`
 *  fails and frees its slot (the read itself cannot be recalled; its late result is dropped). */
export class ReadQueue {
  #q = []; flying = 0; flyingLow = 0; peak = 0;
  constructor({ max = MAX_READS, maxLow = MAX_LOW, timeoutMs = READ_TIMEOUT_MS } = {}) { Object.assign(this, { max, maxLow, timeoutMs }); }
  /** Queue (or find) the job `key`; a queued one takes the better priority. -> promise of run()'s result. */
  add(key, prio, run, { low = false, kind = '' } = {}) {
    const same = this.#q.find((j) => j.key === key) || this.running?.get(key);
    if (same) { same.prio = Math.min(same.prio, prio); return same.promise; }
    const job = { key, prio, run, low, kind };
    job.promise = new Promise((res, rej) => { job.res = res; job.rej = rej; });
    this.#q.push(job);
    queueMicrotask(() => this.#pump());
    return job.promise;
  }
  running = new Map();
  /** A queued job takes a better priority. */
  bump(key, prio) { const j = this.#q.find((x) => x.key === key); if (j) j.prio = Math.min(j.prio, prio); }
  /** Drop the queued (not yet started) jobs for which pred(job) is true: their promises reject 'cancelled'. */
  cancel(pred) {
    this.#q = this.#q.filter((j) => { if (!pred(j)) return true; j.rej(cancelled()); return false; });
  }
  get queued() { return this.#q.length; }
  #pump() {
    while (this.flying < this.max) {
      let best = -1;
      this.#q.forEach((j, k) => { if (!(j.low && this.flyingLow >= this.maxLow) && (best < 0 || j.prio < this.#q[best].prio)) best = k; });
      if (best < 0) return;
      const [job] = this.#q.splice(best, 1);
      this.#start(job);
    }
  }
  #start(job) {
    this.flying++; if (job.low) this.flyingLow++;
    this.peak = Math.max(this.peak, this.flying);
    this.running.set(job.key, job);
    let done = false, timer;
    const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); this.flying--; if (job.low) this.flyingLow--; this.running.delete(job.key); fn(v); this.#pump(); };
    timer = setTimeout(() => end(job.rej, Object.assign(new Error('timed out'), { code: 'timeout' })), this.timeoutMs);
    Promise.resolve().then(job.run).then((v) => end(job.res, v), (e) => end(job.rej, e));
  }
}

/** Decoded images by key: LRU by total bytes (w * h * 4), bitmaps closed on eviction, one pinned (the one on screen). */
export class BitmapCache {
  #m = new Map(); bytes = 0;
  constructor(maxBytes = CACHE_BYTES) { this.maxBytes = maxBytes; }
  pinned = null;
  get size() { return this.#m.size; }
  get(key) { const b = this.#m.get(key); if (b) { this.#m.delete(key); this.#m.set(key, b); } return b; }
  has(key) { return this.#m.has(key); }
  keys() { return [...this.#m.keys()]; }
  set(key, bmp) {
    this.#drop(key);
    this.#m.set(key, bmp); this.bytes += cost(bmp);
    for (const k of [...this.#m.keys()]) {
      if (this.bytes <= this.maxBytes) break;
      if (k !== this.pinned && k !== key) this.#drop(k);
    }
  }
  #drop(key) { const b = this.#m.get(key); if (!b) return; this.#m.delete(key); this.bytes -= cost(b); b.close?.(); }
  clear() { for (const k of [...this.#m.keys()]) this.#drop(k); }
}
const cost = (b) => (b.width || 0) * (b.height || 0) * 4;

/** Reads and decodes images: get(img, prio) -> bitmap (cached, de-duplicated, prioritised); prefetch(); keep(keys) cancels
 *  queued prefetches outside the wanted set. read(path) -> Blob | bytes; decode(blob) -> bitmap (off the main thread). */
export class ImageLoader {
  #pending = new Map(); #gen = 0;
  constructor({ read, decode, delay = () => 0, queue = new ReadQueue(), cache = new BitmapCache() }) { Object.assign(this, { read, decode, delay, queue, cache }); }
  peek(key) { return this.cache.get(key); }
  get(img, prio = 0) {
    const hit = this.cache.get(img.key);
    if (hit) return Promise.resolve(hit);
    const gen = this.#gen;
    let p = this.#pending.get(img.key);
    if (p) { this.queue.bump('img:' + img.key, prio); return p; }   // already queued / running: only its priority improves
    p = this.queue.add('img:' + img.key, prio, async () => { const d = this.delay(); if (d) await new Promise((r) => setTimeout(r, d)); return this.read(img.path); }, { kind: 'img' })
      .then((data) => this.decode(data))
      .then((bmp) => { if (gen !== this.#gen) { bmp.close?.(); throw cancelled(); } this.cache.set(img.key, bmp); return bmp; })
      .finally(() => this.#pending.delete(img.key));
    this.#pending.set(img.key, p);
    return p;
  }
  prefetch(img, prio) { return this.get(img, prio).catch(() => {}); }
  /** Cancel queued image reads for images not in `keys`. */
  keep(keys) { this.queue.cancel((j) => j.kind === 'img' && !keys.has(j.key.slice(4))); }
  pin(key) { this.cache.pinned = key; }
  /** Forget everything (leaving the workspace): queued reads cancelled, cached bitmaps closed, late results dropped. */
  clear() { this.#gen++; this.queue.cancel(() => true); this.cache.clear(); }
}
