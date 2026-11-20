// mockdata.js -- deterministic fake scripts for the editor mock (no randomness between reloads, so
// screenshots compare). Action = { at: ms, pos: 0..100 }.
export const DURATION = 190_000;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A stroke script: tempo and depth drift through "chapters", with a few pauses. */
export function makeScript(seed = 7, dur = DURATION) {
  const r = rng(seed), out = [];
  let t = 1200, up = false;
  while (t < dur) {
    const phase = Math.sin(t / 23_000) * 0.5 + 0.5;               // 0..1, slow drift
    const half = 180 + (1 - phase) * 380 + r() * 60;              // half-stroke ms
    const depth = 40 + phase * 45 + r() * 10;
    const mid = 50 + Math.sin(t / 9000) * 8;
    out.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(mid + (up ? depth : -depth) / 2))) });
    up = !up;
    t += half;
    if (r() < 0.006) t += 2500 + r() * 3000;                      // a pause
  }
  return out;
}

/** A ghost: the script shifted in time and a little off in pos (a tracker run, a reference). */
export function ghostOf(script, seed, shift, wobble) {
  const r = rng(seed);
  return script.map((a) => ({ at: a.at + shift + Math.round((r() - 0.5) * 40), pos: Math.max(0, Math.min(100, Math.round(a.pos + (r() - 0.5) * wobble))) }));
}

/** A slow secondary axis (roll): a lazy sine. */
export function makeSlow(dur = DURATION, period = 2400) {
  const out = [];
  for (let t = 0; t < dur; t += period / 4) out.push({ at: t, pos: Math.round(50 + 30 * Math.sin((t / period) * Math.PI * 2)) });
  return out;
}

/** Speed per second (pos units / s) for the heatmap. */
export function speedBins(script, dur = DURATION) {
  const bins = new Float32Array(Math.ceil(dur / 1000));
  for (let i = 1; i < script.length; i++) {
    const a = script[i - 1], b = script[i], v = Math.abs(b.pos - a.pos) / ((b.at - a.at) / 1000);
    const k = Math.floor(a.at / 1000);
    if (k < bins.length) bins[k] = Math.max(bins[k], v);
  }
  return bins;
}

export const CHAPTERS = [
  { t0: 0, t1: 31_000, name: 'Intro', color: 'grey' },
  { t0: 31_000, t1: 78_000, name: 'Build', color: 'sky' },
  { t0: 78_000, t1: 121_000, name: 'Loop A', color: 'green' },
  { t0: 121_000, t1: 162_000, name: 'Peak', color: 'orange' },
  { t0: 162_000, t1: DURATION, name: 'Outro', color: 'violet' },
];
