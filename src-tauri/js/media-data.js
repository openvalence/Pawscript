// Pure helpers for the binary peaks format and thumbnail sprite sheets (see src-tauri/API.md). No imports.

// Little-endian host assumed (x86/ARM): Int16Array views are used directly over the buffer.
export function parsePeaks(buf) {
  if (!(buf instanceof ArrayBuffer)) throw new Error('parsePeaks: expected an ArrayBuffer');
  if (buf.byteLength < 24) throw new Error('parsePeaks: buffer too short for header');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'PWPK') throw new Error(`parsePeaks: bad magic "${magic}"`);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`parsePeaks: unsupported version ${version}`);
  const sampleRate = dv.getUint32(8, true);
  const n = dv.getUint32(12, true);
  const totalSamples = Number(dv.getBigUint64(16, true));
  let off = 24 + n * 8;
  if (buf.byteLength < off) throw new Error('parsePeaks: truncated level table');
  const levels = [];
  for (let i = 0; i < n; i++) {
    const samplesPerBucket = dv.getUint32(24 + i * 8, true);
    const count = dv.getUint32(28 + i * 8, true);
    if (off % 2) off++; // levels are 2-byte aligned
    if (buf.byteLength < off + count * 6) throw new Error(`parsePeaks: truncated data in level ${i}`);
    levels.push({ samplesPerBucket, bucketMs: samplesPerBucket * 1000 / sampleRate, count, data: new Int16Array(buf, off, count * 3) });
    off += count * 6;
  }
  return { version, sampleRate, totalSamples, durationMs: totalSamples * 1000 / sampleRate, levels };
}

/** Level with the largest bucketMs still <= msPerPixel (finest level if none). */
export function pickLevel(peaks, msPerPixel) {
  let best = peaks.levels[0];
  for (const l of peaks.levels) if (l.bucketMs <= msPerPixel && l.bucketMs > best.bucketMs) best = l;
  return best;
}

/** Sprite tile for the frame nearest `ms`, or null if its sheet is not available yet. */
export function thumbAt(strip, ms, level) {
  const per = strip.columns * strip.rows;
  if (level == null) {
    let hi = -1;
    level = -1;
    strip.levels.forEach((l, i) => {
      if (l.sheets.length === Math.ceil(l.count / per)) level = i; // last complete level
      if (l.sheets.length) hi = i;
    });
    if (level < 0) level = hi;
  }
  const lv = strip.levels[level];
  if (!lv || !lv.times_ms.length) return null;
  const t = lv.times_ms;
  let lo = 0, hi2 = t.length - 1;
  while (lo < hi2) { const m = (lo + hi2) >> 1; if (t[m] < ms) lo = m + 1; else hi2 = m; }
  const index = lo > 0 && ms - t[lo - 1] <= t[lo] - ms ? lo - 1 : lo;
  const sheet = lv.sheets[Math.floor(index / per)];
  if (!sheet) return null;
  const k = index % per;
  return { index, sheet, x: (k % strip.columns) * strip.tile_w, y: Math.floor(k / strip.columns) * strip.tile_h, w: strip.tile_w, h: strip.tile_h, timeMs: t[index] };
}
