// thumbs.js -- frame thumbnails for the lane hover / drag tip. paint() never awaits: get(at) returns the cached
// ImageBitmap for that frame index (LRU 64) or null and, when missing, asks app.player.getFrame once (tolMs = half a
// frame: a strip tile is fine) and calls onReady when the bitmap lands so the overlay repaints.

export const THUMB_H = 54, THUMB_MAX = 64;

export function createThumbs(app, onReady) {
  const cache = new Map();   // frame index -> ImageBitmap | null (null = asked, nothing yet)
  const t = {
    /** The frame bitmap for media time `at`, or null (a fetch is then in flight). */
    get(at) {
      const p = app.player;
      if (!app.doc.media || !p?.getFrame || !p.url) return null;
      const fms = p.frameMs || 1000 / 30, k = Math.max(0, Math.floor(at / fms));
      if (cache.has(k)) { const b = cache.get(k); if (b) { cache.delete(k); cache.set(k, b); } return b; }   // LRU touch
      cache.set(k, null);
      if (cache.size > THUMB_MAX) cache.delete(cache.keys().next().value);
      Promise.resolve(p.getFrame(at, THUMB_H, { tolMs: fms / 2 })).then((b) => { if (b && cache.has(k)) { cache.set(k, b); onReady(); } else if (!b) cache.delete(k); }, () => cache.delete(k));
      return null;
    },
    clear() { cache.clear(); },
  };
  return t;
}
