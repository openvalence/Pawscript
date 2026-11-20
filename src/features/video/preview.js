// preview.js -- hover-scrub thumbnails for other surfaces (the timeline's tooltip): getFrame(ms, height) ->
// ImageBitmap | null. A second, hidden <video> seeks on demand (one seek at a time; a newer request replaces a
// waiting one, whose promise resolves null) and every grabbed frame lands in an LRU cache. When the backend
// has made a thumbnail strip (app.backend.thumbnailStrip, src-tauri/API.md), a tile within `tolMs` of the request
// is cut from its sprite sheets instead (no decode at all); otherwise the exact frame is decoded.

import { thumbAt } from '../../../src-tauri/js/media-data.js';

export class LRU {
  constructor(max, onEvict = null) { this.max = max; this.map = new Map(); this.onEvict = onEvict; }
  get size() { return this.map.size; }
  has(k) { return this.map.has(k); }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) { const old = this.map.get(k); this.map.delete(k); if (old !== v) this.onEvict?.(old); }
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const [ok, ov] = this.map.entries().next().value;
      this.map.delete(ok); this.onEvict?.(ov);
    }
  }
  clear() { for (const v of this.map.values()) this.onEvict?.(v); this.map.clear(); }
}

const once = (el, ok, bad = 'error') => new Promise((res, rej) => {
  const a = () => { el.removeEventListener(bad, b); res(); }, b = () => { el.removeEventListener(ok, a); rej(new Error(bad)); };
  el.addEventListener(ok, a, { once: true }); el.addEventListener(bad, b, { once: true });
});

/**
 * url: playable media URL; frameMs: frame length used to quantise requests; strip: a finished thumbnail_strip
 * result (set later with setStrip); sheetUrl(path) -> URL for a sheet (convertFileSrc).
 */
export function createPreview({ url, frameMs = 1000 / 30, max = 240, strip = null, sheetUrl = (p) => p }) {
  const cache = new LRU(max);   // evicted bitmaps are left to GC: a caller may still be drawing one
  const sheets = new Map();
  let el = null, cur = null, want = null, running = false, dead = false;

  const video = () => {
    if (!el) {
      el = document.createElement('video');
      Object.assign(el, { muted: true, preload: 'auto', playsInline: true });   // no crossOrigin: the asset protocol may not send CORS headers
      el.src = url;
    }
    return el;
  };

  // an <img> (CSP allows asset: images; fetch would need connect-src)
  const sheet = (path) => {
    if (!sheets.has(path)) sheets.set(path, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = sheetUrl(path); }));
    return sheets.get(path);
  };
  async function fromStrip(tile, h) {
    const img = await sheet(tile.sheet);
    return createImageBitmap(img, tile.x, tile.y, tile.w, tile.h, { resizeHeight: h, resizeWidth: Math.max(1, Math.round((h * tile.w) / tile.h)), resizeQuality: 'medium' });
  }

  async function grab(w) {
    const v = video();
    if (v.readyState < 1) await once(v, 'loadedmetadata');
    v.currentTime = w.ms / 1000;
    await once(v, 'seeked');
    const h = w.h, wd = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight));
    return createImageBitmap(v, { resizeWidth: wd, resizeHeight: h, resizeQuality: 'medium' });
  }

  async function pump() {
    if (running) return;
    running = true;
    while (want && !dead) {
      cur = want; want = null;
      let bmp = cache.get(cur.key) || null;
      if (!bmp) { try { bmp = await grab(cur); } catch { bmp = null; } if (bmp && !dead) cache.set(cur.key, bmp); }
      for (const r of cur.res) r(dead ? null : bmp);
      cur = null;
    }
    running = false;
  }

  return {
    cache,
    /** Use a finished thumbnail strip from now on. */
    setStrip(s) { strip = s; },
    /**
     * The frame at ms, `h` px tall (width from the aspect). Resolves null if superseded or on failure.
     * tolMs > 0 accepts a strip tile that close to ms (e.g. the timeline's ms-per-pixel) instead of decoding.
     */
    getFrame(ms, h = 90, { tolMs = 0 } = {}) {
      const tile = tolMs > 0 && strip ? thumbAt(strip, ms) : null;
      if (tile && Math.abs(tile.timeMs - ms) <= tolMs) {
        const key = 's' + tile.index + ':' + h, hit = cache.get(key);
        if (hit) return Promise.resolve(hit);
        return fromStrip(tile, h).then((b) => { if (!dead) cache.set(key, b); return b; }, () => null);
      }
      const k = Math.max(0, Math.floor(ms / frameMs)), key = k + ':' + h;
      const hit = cache.get(key);
      if (hit) return Promise.resolve(hit);
      return new Promise((res) => {
        if (cur?.key === key) { cur.res.push(res); return; }
        if (want && want.key !== key) { for (const r of want.res) r(null); want = null; }
        want ??= { key, ms: (k + 0.5) * frameMs, h, res: [] };
        want.res.push(res);
        pump();
      });
    },
    /** A cached frame near ms (same height), for showing something while the exact one decodes. */
    peek(ms, h = 90) { return cache.get(Math.max(0, Math.floor(ms / frameMs)) + ':' + h) || null; },
    dispose() {
      dead = true; cache.clear();
      if (want) for (const r of want.res) r(null);
      want = null;
      if (el) { el.removeAttribute('src'); el.load(); el = null; }
      sheets.clear();
    },
  };
}
