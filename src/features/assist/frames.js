// frames.js -- video frames for the assist viewer. get(ms) -> Promise<ImageBitmap | null>, peek(ms) -> bitmap | null,
// want([ms]) prefetches. A small pool of hidden <video> elements works through a priority queue in the background, so
// the next questions' frames are decoded while the user answers this one. (features/video/preview.js keeps only the
// newest request, which suits hover scrubbing but would drop a prefetch queue; its LRU is reused here.)

import { LRU } from '../video/preview.js';

const once = (el, ok) => new Promise((res, rej) => {
  const a = () => { el.removeEventListener('error', b); res(); }, b = () => { el.removeEventListener(ok, a); rej(new Error('video error')); };
  el.addEventListener(ok, a, { once: true }); el.addEventListener('error', b, { once: true });
});

/** url: playable media URL. maxH caps the bitmap height (memory: max x w x h x 4 bytes). onFrame(ms) after each decode. */
export function createFrames({ url, frameMs = 1000 / 30, maxH = 540, max = 160, workers = 2, onFrame = () => {} }) {
  const cache = new LRU(max);
  const waiting = new Map();      // frame index -> [resolve]
  let queue = [];                 // frame indices, most urgent first
  const els = [], busy = [];
  let dead = false;
  const idx = (ms) => Math.max(0, Math.floor(ms / frameMs));

  function video(i) {
    if (!els[i]) {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, preload: 'auto', playsInline: true, crossOrigin: 'anonymous' });
      v.src = url;
      els[i] = v;
    }
    return els[i];
  }
  async function grab(v, k) {
    if (v.readyState < 1) await once(v, 'loadedmetadata');
    v.currentTime = ((k + 0.5) * frameMs) / 1000;
    await once(v, 'seeked');
    const h = Math.min(maxH, v.videoHeight || maxH), w = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight));
    return createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
  }
  async function work(i) {
    while (queue.length && !dead) {
      const k = queue.shift();
      if (!waiting.has(k)) continue;
      let bmp = cache.get(k) || null;
      if (!bmp) { try { bmp = await grab(video(i), k); } catch { bmp = null; } if (bmp && !dead) cache.set(k, bmp); }
      const rs = waiting.get(k) || [];
      waiting.delete(k);
      for (const r of rs) r(dead ? null : bmp);
      if (bmp && !dead) onFrame(k * frameMs);
    }
    busy[i] = false;
  }
  function pump() { for (let i = 0; i < workers; i++) if (!busy[i]) { busy[i] = true; work(i); } }
  function enqueue(ks, front) {
    const fresh = ks.filter((k) => !cache.has(k));
    for (const k of fresh) if (!waiting.has(k)) waiting.set(k, []);
    const s = new Set(fresh);
    queue = front ? [...fresh, ...queue.filter((k) => !s.has(k))] : [...queue, ...fresh.filter((k) => !queue.includes(k))];
    pump();
  }

  return {
    cache, frameMs,
    /** The frame showing at ms (urgent: goes to the front of the queue). */
    get(ms) {
      const k = idx(ms), hit = cache.get(k);
      if (hit) return Promise.resolve(hit);
      return new Promise((res) => { enqueue([k], true); waiting.get(k).push(res); });
    },
    peek: (ms) => cache.get(idx(ms)) || null,
    /** Prefetch, in this order, behind anything already queued (front: ahead of it). */
    want(list, { front = false } = {}) { enqueue([...new Set(list.map(idx))], front); },
    get pending() { return waiting.size; },
    dispose() {
      dead = true; queue = [];
      for (const rs of waiting.values()) for (const r of rs) r(null);
      waiting.clear(); cache.clear();
      for (const v of els) if (v) { v.removeAttribute('src'); v.load(); }
    },
  };
}

/** 16 x 9 RGB thumbnail of a bitmap (learning: scenes that look alike). */
export function thumbOf(bmp) {
  if (!bmp || typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(16, 9), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, 16, 9);
  const d = g.getImageData(0, 0, 16, 9).data, out = new Uint8Array(16 * 9 * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2]; }
  return out;
}
