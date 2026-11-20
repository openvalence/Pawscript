// waveform.js -- audio peaks for the timeline's waveform lane, as a multi-resolution min/max pyramid.
// Source: the backend's peaks (app.backend.waveformPeaks, src-tauri/API.md) when offered; otherwise the file is decoded with WebAudio
// (decodeAudioData runs off the main thread) at a low sample rate and reduced in chunks that yield, so playback
// never stalls.
//
//   pyr = { sampleRate, base, length, levels: [{ per, min: Float32Array, max: Float32Array }] }
//   levels[0].per = base samples per bin; every next level halves the bins.  peaks(pyr, t0, t1, cols) for drawing.

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Next level: pairs of bins merged. */
function halve(l) {
  const n = Math.ceil(l.min.length / 2), min = new Float32Array(n), max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 2 * i, b = Math.min(a + 1, l.min.length - 1);
    min[i] = Math.min(l.min[a], l.min[b]); max[i] = Math.max(l.max[a], l.max[b]);
  }
  return { per: l.per * 2, min, max };
}

/** A pyramid from level-0 bins (each `base` samples). */
export function pyramidFrom(min, max, sampleRate, base, length = min.length * base) {
  const levels = [{ per: base, min: Float32Array.from(min), max: Float32Array.from(max) }];
  while (levels[levels.length - 1].min.length > 64) levels.push(halve(levels[levels.length - 1]));
  return { sampleRate, base, length, levels };
}

/** A pyramid from mono samples; yields to the event loop every `chunk` samples. */
export async function buildPyramid(samples, sampleRate, { base = 64, chunk = 1 << 20 } = {}) {
  const n = Math.ceil(samples.length / base), min = new Float32Array(n), max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * base, e = Math.min(samples.length, i + base); i < e; i++) { const v = samples[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[b] = lo; max[b] = hi;
    if (((b + 1) * base) % chunk < base) await tick();
  }
  return pyramidFrom(min, max, sampleRate, base, samples.length);
}

/** Per-column {min, max} for [t0, t1] ms across `cols` columns, from the coarsest level still finer than a column. */
export function peaks(pyr, t0, t1, cols) {
  const min = new Float32Array(cols), max = new Float32Array(cols);
  if (!pyr || !(t1 > t0) || cols <= 0) return { min, max };
  const perCol = ((t1 - t0) / 1000) * pyr.sampleRate / cols;
  let L = pyr.levels[0];
  for (const l of pyr.levels) if (l.per <= perCol) L = l;
  const binsPerMs = pyr.sampleRate / 1000 / L.per;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((t0 + ((t1 - t0) * c) / cols) * binsPerMs), b = Math.max(a + 1, Math.floor((t0 + ((t1 - t0) * (c + 1)) / cols) * binsPerMs));
    let lo = 0, hi = 0;
    for (let i = Math.max(0, a); i < Math.min(b, L.min.length); i++) { if (L.min[i] < lo) lo = L.min[i]; if (L.max[i] > hi) hi = L.max[i]; }
    min[c] = lo; max[c] = hi;
  }
  return { min, max };
}

// ponytail: in-webview decoding needs the whole file in memory; past this size only backend peaks are used.
const MAX_DECODE_BYTES = 768 * 1024 * 1024;

/** The backend's parsed peaks (src-tauri/js/media-data.js parsePeaks: levels of interleaved i16 min,max,rms) -> pyramid. */
export function pyramidFromBackend(pk) {
  const levels = pk.levels.map((l) => {
    const min = new Float32Array(l.count), max = new Float32Array(l.count), rms = new Float32Array(l.count);
    for (let i = 0; i < l.count; i++) { min[i] = l.data[3 * i] / 32768; max[i] = l.data[3 * i + 1] / 32768; rms[i] = l.data[3 * i + 2] / 32768; }
    return { per: l.samplesPerBucket, min, max, rms };
  }).sort((a, b) => a.per - b.per);
  return { sampleRate: pk.sampleRate, base: levels[0]?.per || 1, length: pk.totalSamples, levels };
}

/**
 * Loads the waveform for the current media. backend.waveformPeaks(path) (Rust: decoded by ffmpeg, cached) wins;
 * else fetch(url) + decodeAudioData. Returns a pyramid, or {error} (no audio track, too big, decode failed).
 */
export async function loadWaveform({ url, path, backend, sampleRate = 8000, signal } = {}) {
  try {
    if (backend?.waveformPeaks && path) {
      try {
        const pk = await backend.waveformPeaks(path).promise;
        if (pk?.levels?.length) return pyramidFromBackend(pk);
      } catch (e) {
        if (e?.code === 'no_audio') return { error: 'No audio track.' };
        if (e?.code === 'ffmpeg_failed' && !/cannot start/.test(e?.message)) return { error: "Audio can't be read" };   // paw-tjy6: ffmpeg read the file and failed: the webview would not do better
        console.warn('[waveform] backend peaks failed, decoding in the webview', e);
      }
    }
    const res = await fetch(url, { signal });
    const len = +res.headers.get('content-length');
    if (len > MAX_DECODE_BYTES) return { error: 'File too large to decode in the webview; waveform needs backend peaks.' };
    const buf = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    const audio = await ctx.decodeAudioData(buf);
    const n = audio.length, mono = new Float32Array(n);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels;
      await tick();
    }
    if (signal?.aborted) return { error: 'aborted' };
    return await buildPyramid(mono, audio.sampleRate);
  } catch (e) {
    return { error: /decod/i.test(String(e)) ? 'No decodable audio track.' : String(e?.message || e) };
  }
}
