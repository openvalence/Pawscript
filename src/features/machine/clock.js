// clock.js -- the Machine view's display time (pure). Playing: the player's own continuous clock (app.player.now():
// the last presented video frame extrapolated at the playback rate), unfiltered. Paused (scrubbing, frame steps,
// seeks): each new playhead time is reached by interpolating linearly IN TIME from what is shown now, over the
// measured interval between playhead updates (an average of the last few, 8..120 ms; one video frame for a frame
// step), so the view lands exactly when the next update is due; an early update retargets from the shown value; a
// jump of more than a second of script time snaps; when updates stop it finishes and rests on the playhead.

/** The time the Machine view shows: the player's continuous clock while playing (its own panel, not over the picture:
 *  smooth, paw-osat), else the frame on screen (paw-o60v.8.1: pl.shownMs; a scrub, a seek, a step show where the
 *  picture is, not the pointer's time ahead of it). -> {t, direct} (direct: nothing to interpolate). */
export function timeSource(pl) {
  if (pl.playing) return { t: pl.now?.() ?? pl.timeMs, direct: true };
  return { t: pl.shownMs ?? pl.timeMs, direct: false };
}

export class DisplayClock {
  seg = null; last = -Infinity; interval = 33;
  /** The displayed time for playhead time `target` at performance time `now`. */
  at(target, now, { playing = false, frameMs = 1000 / 30 } = {}) {
    if (playing || !Number.isFinite(target)) { this.seg = null; this.last = now; return target; }
    if (!this.seg) { this.seg = { from: target, to: target, t0: now, dur: 0 }; this.last = now; return target; }
    if (target !== this.seg.to) {
      const cur = this.value(now), gap = now - this.last, prevTo = this.seg.to;
      this.last = now;
      if (gap > 0 && gap < 400) this.interval = this.interval * 0.6 + Math.min(120, Math.max(8, gap)) * 0.4;
      const step = Math.abs(Math.abs(target - prevTo) - frameMs) < frameMs * 0.25;
      const dur = Math.abs(target - cur) > 1000 ? 0 : step ? frameMs : this.interval;
      this.seg = { from: cur, to: target, t0: now, dur };
    }
    return this.value(now);
  }
  value(now) {
    const s = this.seg;
    if (!s || !(s.dur > 0)) return s ? s.to : NaN;
    return s.from + (s.to - s.from) * Math.min(1, (now - s.t0) / s.dur);
  }
  /** Still on its way to the playhead (keep drawing frames). */
  moving(now) { const s = this.seg; return !!s && s.dur > 0 && now - s.t0 < s.dur; }
}

/** Whether the playhead is being moved (paw-ekys): a new time while not playing marks it moving for `ms`; the panel
 *  draws only the pose then and refines when it rests. tick(t, now, playing) -> moving now. */
export class ScrubGate {
  last = NaN; movedAt = -Infinity;
  constructor(ms = 140) { this.ms = ms; }
  tick(t, now, playing) {
    if (!playing && Number.isFinite(this.last) && t !== this.last) this.movedAt = now;
    this.last = t;
    return !playing && now - this.movedAt < this.ms;
  }
}
