// filmstrip.js -- the Scenes tab's filmstrip layout (paw-ef73.7), pure: per shot on screen its cell, its first frame at the
// left and its last at the right, so each cut reads by eye as a pair: the last frame of the shot before | the first of the
// shot after (paw-3fal: the owner judges cuts by them). A cutaway is a card raised LIFT px above the others. Under COMPACT
// px of height: no pictures, the labelled cells only.
// Widths: a shot at least two pictures wide (+ GAP) shows both whole; narrower, each end gets half the cell, cropped to the
// middle of the picture; the two tiles at a cut take the narrower of their two shots' halves, so they are the same size;
// a tile under MIN_TILE px is left out (the cut line alone, as the grips go under 6 px a shot), and then its neighbour
// across the cut keeps its own width (there is no pair to match).
// paw-rw84 fillers: between a shot's two edge tiles, whole pictures through the shot (`fills`), FILL_GUT px apart, as many
// as fit, the run centred between the edge tiles so the room left over widens the two gaps (`gaps`, at least EDGE_GAP px of
// the lane's background): the gaps are always wider than the gutters, so the edge tiles stand apart. Laid out from the
// shot's own x, so a pan moves them with it and their frames stay the same; each the frame at its own centre time. The
// edge tiles are laid out first and never move or shrink for them; a shot without room for one whole picture has none.
export const COMPACT = 44, LIFT = 10, PAD = 2, GAP = 8, MIN_TILE = 4, EDGE_GAP = 8, FILL_GUT = 2;

/** Shot i's [first, last] frame index: the frame its start falls in, and the frame before the one its end (the next shot's
 *  start) falls in; the last shot's end at the video's end is the video's last frame (the player clock clamps there). */
export function shotFrames(list, i, frameAt, last = Infinity) {
  const s = list[i], nF = frameAt(s.start_ms), e = frameAt(s.end_ms);
  return [nF, Math.max(nF, Math.min(last, i === list.length - 1 && e >= last ? last : e - 1))];
}

/** list: the shots; x(ms) -> px; {w, h, aspect (width / height), cut(i) -> bool, frameAt(ms) -> frame index (the player
 *  clock's), last (the video's last frame index)}. -> [{i, x0, x1, y0, y1, card, fs (label px), frames: [{x, y, w, h, crop
 *  (0..1 of the picture's width shown, centred), n (frame index), side: 'first' | 'last'}], fills: [{x, y, w, h, crop: 1, n,
 *  side: 'fill', lo, hi (the shot's first / last frame)}], gaps: [{x, w}] (edge tile to filler: lane background)} for the
 *  shots on screen. A shot's last frame is the frame before the frame its end (the next shot's start) falls in: by index,
 *  never a time near the end. */
export function filmCells(list, x, { w, h, aspect = 16 / 9, cut = () => false, frameAt = (t) => Math.floor(t * 0.03 + 1e-6), last = Infinity }) {
  const compact = h < COMPACT, out = [];
  const fh = h - LIFT - 2 * PAD, fw = fh * aspect;   // a card and a plain cell are the same height
  const half = list.map((s) => { const cw = x(s.end_ms) - x(s.start_ms) - 2 * PAD; return cw >= 2 * fw + GAP ? fw : Math.max(0, (cw - PAD) / 2); });
  list.forEach((s, i) => {
    const x0 = x(s.start_ms), x1 = x(s.end_ms);
    if (x1 < 0 || x0 > w || x1 <= x0) return;
    const card = !!cut(i), y0 = compact ? 0 : card ? 0 : LIFT, y1 = compact ? h : card ? h - LIFT : h;
    const fs = Math.max(8, Math.min(11, Math.round((y1 - y0) / 4)));
    const c = { i, x0, x1, y0, y1, card, fs, frames: [], fills: [], gaps: [] };
    if (!compact && fh >= 12) {
      const [nF, nL] = shotFrames(list, i, frameAt, last);
      const pair = (nb) => (nb >= MIN_TILE ? Math.min(half[i], nb) : half[i]);   // a neighbour with no tile there: no pair to match
      const wF = pair(half[i - 1] ?? 0), wL = pair(half[i + 1] ?? 0);
      const tile = (tx, tw, n, side) => { if (tw >= MIN_TILE && tx + tw > 0 && tx < w) c.frames.push({ x: tx, y: y0 + PAD, w: tw, h: fh, crop: tw / fw, n, side }); };
      tile(x0 + PAD, wF, nF, 'first');
      tile(x1 - PAD - wL, wL, nL, 'last');
      // fillers: k whole pictures FILL_GUT apart, centred in [a, b); only the ones on screen are made
      const eF = x0 + PAD + wF, eL = x1 - PAD - wL, a = eF + EDGE_GAP, b = eL - EDGE_GAP, pitch = fw + FILL_GUT, k = Math.floor((b - a + FILL_GUT) / pitch);
      if (k > 0 && wF >= MIN_TILE && wL >= MIN_TILE) {
        const s0 = a + (b - a - (k * pitch - FILL_GUT)) / 2, s1 = s0 + k * pitch - FILL_GUT, ms = (s.end_ms - s.start_ms) / (x1 - x0);
        if (eF < w && s0 > 0) c.gaps.push({ x: eF, w: s0 - eF });
        if (s1 < w && eL > 0) c.gaps.push({ x: s1, w: eL - s1 });
        for (let j = Math.max(0, Math.floor((-s0 - fw) / pitch)), j1 = Math.min(k - 1, Math.ceil((w - s0) / pitch)); j <= j1; j++) {
          const fx = s0 + j * pitch, cx = fx + fw / 2;
          if (fx + fw <= 0 || fx >= w) continue;
          c.fills.push({ x: fx, y: y0 + PAD, w: fw, h: fh, crop: 1, n: Math.max(nF, Math.min(nL, frameAt(s.start_ms + (cx - x0) * ms))), side: 'fill', lo: nF, hi: nL });
        }
      }
    }
    out.push(c);
  });
  return out;
}

/** The lane's still decoder queue (paw-3fal, paw-rw84), one decode at a time. want(reqs) replaces what waits (a pan or
 *  zoom drops the stale asks; the one decoding finishes), edge tiles first, then fillers (req.fill), one key once. Before
 *  each filler it waits gapMs() (the lane: FILL_PLAY_MS while the video plays, else 0) and goes on only if that filler is
 *  still next, so playback and scrubbing keep the decoder and an edge asked meanwhile jumps ahead. decode(req) ->
 *  bitmap | null; done(req, bitmap) (false: stop, e.g. another video); idle(missed) when the queue runs dry. */
export const FILL_PLAY_MS = 120;
export function stillQueue({ decode, done, idle = () => {}, gapMs = () => 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let wanted = [], busy = false;
  async function pump() {
    busy = true;
    let missed = false;
    while (wanted.length) {
      const r = wanted[0];
      if (r.fill) { const ms = gapMs(); if (ms > 0) { await sleep(ms); if (wanted[0]?.key !== r.key) continue; } }
      wanted.shift();
      const b = await Promise.resolve(decode(r)).catch(() => null);
      if (done(r, b) === false) break;
      if (!b) missed = true;
    }
    busy = false;
    idle(missed);
  }
  return {
    want(reqs) {
      const seen = new Set();
      wanted = [...reqs.filter((r) => !r.fill), ...reqs.filter((r) => r.fill)].filter((r) => !seen.has(r.key) && seen.add(r.key));
      if (!busy && wanted.length) pump();
    },
    get waiting() { return wanted.length; },
  };
}
