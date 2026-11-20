// snapshot.js -- the plain document Snapshot the graph reads (contract §9), built from `app`, the tracking
// feature's store and the controller's audio envelope. Pure apart from reading those objects; values are
// passed through by identity (never copied), so the engine's identity tokens stay exact.

import { axesOf } from '../../../lib/script-of.js';

const EMPTY = Object.freeze([]);

/** tracking: the tracking store (features/tracking peekTracking(app)) or null. audio: {i0, dt, v} | null. */
export function readSnapshot(app, tracking = null, audio = null) {
  const d = app.doc;
  return {
    axes: tracking?.liveAll && [...tracking.liveAll.values()].some(Boolean) ? axesOf(app) : d.axes || {},   // paw-x7w7: the live runs in (each axis's array keeps its identity while it does not change)
    ghosts: d.ghosts || EMPTY,
    plan: d.plan || EMPTY,
    fx: d.fx || EMPTY,                            // effects layer (lib/fx.js), src.fx
    chapters: d.chapters || EMPTY,
    loops: d.loops || EMPTY,
    bookmarks: d.bookmarks || EMPTY,
    range: d.range ?? null,
    selection: d.selection ?? null,
    media: d.media ?? null,
    runs: tracking?.runs || EMPTY,
    scenes: tracking?.scenes?.length ? tracking.scenes : Array.isArray(d.scenes) ? d.scenes : EMPTY,
    trackSpans: tracking?.spans || EMPTY,
    audio: audio ?? null,
    tags: null,                                   // no tags provider yet (DESIGN §13 P3)
    durationMs: Math.max(1, Math.round(app.durationMs || d.media?.durationMs || 1)),
    frameMs: app.player?.frameMs || (d.media?.fps ? 1000 / d.media.fps : 1000 / 30),
  };
}

/**
 * Touches every document value readSnapshot (or the controller) can read, unconditionally, so the wrapper's
 * $effect re-runs when any of them changes. Must stay a superset of readSnapshot's reads (a test checks it).
 */
export function readDeps(app, tracking = null, undoMode = 'local') {
  const d = app.doc;
  void [d.axes, d.ghosts, d.plan, d.fx, d.chapters, d.loops, d.bookmarks, d.range, d.selection, d.media, d.scenes, d.project, d.activeAxis,
    app.durationMs, app.player?.frameMs];
  if (undoMode === 'app') void d.graphs;
  if (tracking) void [tracking.runs, tracking.scenes, tracking.spans, tracking.liveAll];
}

/**
 * Audio peak envelope for src.audio: a features/video/waveform.js pyramid -> { i0: 0, dt, v: Float32Array }
 * with v in 0..1 (normalised to the loudest bin), one sample every dt ms (the max |amplitude| around it).
 */
export function pyramidToEnvelope(pyr, dt = 10) {
  if (!pyr?.levels?.length || !pyr.sampleRate) return null;
  const binMsOf = (l) => (l.per / pyr.sampleRate) * 1000;
  let L = pyr.levels[0];
  for (const l of pyr.levels) if (binMsOf(l) <= dt) L = l;     // the coarsest level still at least as fine as dt
  const binMs = binMsOf(L), nb = L.min.length;
  const n = Math.max(1, Math.floor(((pyr.length / pyr.sampleRate) * 1000) / dt) + 1);
  const v = new Float32Array(n);
  let peak = 0;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, Math.floor((k * dt - dt / 2) / binMs)), b = Math.min(nb - 1, Math.floor((k * dt + dt / 2) / binMs));
    let m = 0;
    for (let i = a; i <= b; i++) { const x = Math.max(Math.abs(L.min[i]), Math.abs(L.max[i])); if (x > m) m = x; }
    v[k] = m; if (m > peak) peak = m;
  }
  if (peak > 0) for (let k = 0; k < n; k++) v[k] /= peak;
  return { i0: 0, dt, v };
}
