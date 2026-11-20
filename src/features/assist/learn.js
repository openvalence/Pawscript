// learn.js -- suggestions from the answers so far, pure (test/assist-model.test.mjs). After a few direction answers in a
// video, the relation between "this span needed flipping" and cheap cues (the run's own sign per scene, the sign of its
// correlation with a second run, the stroke asymmetry, a scene that looks like an answered one) pre-fills the rest as a
// SUGGESTION. Nothing is applied until the user confirms it (Enter).
//
// sample = {flip: bool, cues: {sign, corr, asym} (each -1 | 0 | 1), thumb: Uint8Array | null, label}

/** Mean absolute difference of two RGB thumbnails (0..255), Infinity if either is missing or they differ in size. */
export function thumbDist(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * Suggestion for an open direction question, or null: {flip, reason, source}.
 *  1. a scene that looks the same (thumbnail distance <= sameDist) -> same answer as that scene;
 *  2. a cue that predicted the flip in >= minAgree of >= minN answers (or the opposite in <= 1 - minAgree).
 */
export function suggest(q, samples, thumb = null, { minN = 3, minAgree = 0.8, sameDist = 8 } = {}) {
  if (!samples.length) return null;
  let near = null, nd = Infinity;
  for (const s of samples) { const d = thumbDist(thumb, s.thumb); if (d < nd) { nd = d; near = s; } }
  if (near && nd <= sameDist) return { flip: near.flip, reason: `looks like ${near.label}`, source: 'thumb' };
  let best = null;
  for (const cue of ['sign', 'corr', 'asym']) {
    const c = q.cues?.[cue];
    if (!c) continue;
    const xs = samples.filter((s) => s.cues?.[cue]);
    if (xs.length < minN) continue;
    const agree = xs.filter((s) => s.flip === (s.cues[cue] < 0)).length / xs.length;   // "flip where the cue is negative"
    const conf = Math.max(agree, 1 - agree);
    if (conf < minAgree || (best && conf <= best.conf)) continue;
    const flip = agree >= minAgree ? c < 0 : c > 0;
    best = { conf, flip, reason: `${CUE_NAME[cue]} matched ${Math.round(conf * xs.length)} of ${xs.length} answers`, source: cue };
  }
  return best && { flip: best.flip, reason: best.reason, source: best.source };
}
const CUE_NAME = { sign: 'the tracker sign', corr: 'the second run', asym: 'stroke asymmetry' };
