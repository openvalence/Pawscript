// orient.js -- span orientation overrides on a run. Pure (test/tracking-orient.test.mjs).
// An orientation override {t0, t1, sign} says, absolutely, which way that span goes: sign +1 = as the tracker produced it,
// -1 = mirrored. Overrides win over scene flips inside their span, so a later scene flip never undoes a decision the user
// made per span (assist's direction answers). paw-vtec: they are part of the run's one direction map (lib/polarity.js
// directionOf), applied to the signal when the run is composed (runs-channel.js channelPatch), never to its points.

/** Insert an override, replacing whatever part of earlier overrides it covers. Sorted by t0. */
export function addOrientation(list, o) {
  const out = [];
  for (const x of list || []) {
    if (x.t1 <= o.t0 || x.t0 >= o.t1) { out.push(x); continue; }
    if (x.t0 < o.t0) out.push({ ...x, t1: o.t0 });
    if (x.t1 > o.t1) out.push({ ...x, t0: o.t1 });
  }
  out.push({ t0: o.t0, t1: o.t1, sign: o.sign < 0 ? -1 : 1 });
  return out.sort((a, b) => a.t0 - b.t0);
}
