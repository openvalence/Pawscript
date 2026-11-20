// player.svelte.js -- app.player: one transport whether or not a <video> is attached.
// With a video element: frame-accurate time from requestVideoFrameCallback (as Phosphor's clock.js), frame
// length from the probe (or learned from playback for VFR files), exact single-frame steps.
// Without one (script-only editing, the dev mock): a clock that advances on animation frames.
// features/video may attach its own <video> with attach(el); everything else just reads timeMs and calls seek().

import { stepTarget, frameMsFrom } from '../lib/video.js';

const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(() => f(performance.now()), 16);
const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

export class Player {
  timeMs = $state(0);
  scrubTime = $state(null);     // the unsnapped time under the pointer during a scrub drag (null otherwise): views that
                                // follow the script, not the video (Machine, simulator), read it; the seek stays frame-snapped
  playing = $state(false);
  rate = $state(1);
  frameMs = $state(1000 / 30);
  durationMs = $state(0);
  loop = $state.raw(null);          // { t0, t1 } | null: playback wraps inside it
  ready = $state(false);            // a video is attached and has metadata (or clock mode with a duration)
  // stabilised preview (paw-2zy): t -> {x, y} the camera's drift at t (frame widths / heights), or null; the stage shifts
  // the picture (and its overlays) by minus that, so the action sits still and the frame edges move. A feature sets it.
  stab = $state.raw(null);
  el = null;
  frameKnown = false;               // frameMs is from the probe or learned (not the 30 fps guess)
  isVfr = false;
  mediaSec = 0;                     // mediaTime of the frame on screen
  #clock = 0;
  #undo = [];

  /** Probe result: exact frame length for constant-rate files; VFR keeps learning on playback. */
  setMedia({ durationMs, fps, isVfr } = {}) {
    this.durationMs = durationMs || 0;   // 0 = unknown: the video's metadata fills it in
    if (fps) { this.frameMs = 1000 / fps; this.frameKnown = !isVfr; } else { this.frameMs = 1000 / 30; this.frameKnown = false; }
    this.isVfr = !!isVfr;
  }
  setDuration(ms) { this.durationMs = ms; if (!this.el) this.ready = ms > 0; }

  attach(el) {
    this.detach();
    if (!el) return;
    this.el = el;
    el.playbackRate = this.rate;
    const on = (ev, f) => { el.addEventListener(ev, f); this.#undo.push(() => el.removeEventListener(ev, f)); };
    on('loadedmetadata', () => { if (!this.durationMs || !this.frameKnown) this.durationMs = Math.round(el.duration * 1000); this.ready = true; });
    on('play', () => (this.playing = true));
    on('pause', () => (this.playing = false));
    on('ended', () => (this.playing = false));
    on('seeked', () => { if (el.paused) this.timeMs = el.currentTime * 1000; });
    if (el.readyState >= 1) { this.ready = true; if (!this.durationMs) this.durationMs = Math.round(el.duration * 1000); }
    if (typeof el.requestVideoFrameCallback === 'function') {
      let id, prev = null, stopped = false;
      const onFrame = (_now, md) => {
        if (!this.frameKnown || this.isVfr) {
          const f = frameMsFrom(prev, md, this.frameKnown ? this.frameMs : null);
          if (f != null) { this.frameMs = f; this.frameKnown = true; }
        }
        prev = md;
        this.mediaSec = md.mediaTime;
        this.timeMs = md.mediaTime * 1000;
        this.#wrap();
        if (!stopped) id = el.requestVideoFrameCallback(onFrame);
      };
      id = el.requestVideoFrameCallback(onFrame);
      this.#undo.push(() => { stopped = true; el.cancelVideoFrameCallback(id); });
    } else on('timeupdate', () => { this.timeMs = el.currentTime * 1000; this.#wrap(); });
  }
  detach() {
    for (const f of this.#undo.splice(0)) f();
    this.el = null; this.ready = this.durationMs > 0; this.playing = false; this.mediaSec = 0;
  }

  seek(ms) {
    ms = Math.max(0, Math.min(this.durationMs || Infinity, +ms || 0));
    this.timeMs = ms;
    this.mediaSec = 0;
    if (this.el) this.el.currentTime = ms / 1000;
  }
  play() {
    if (this.el) { this.el.play()?.catch?.(() => {}); return; }
    if (this.playing || !this.durationMs) return;
    if (this.timeMs >= this.durationMs) this.timeMs = this.loop ? this.loop.t0 : 0;
    this.playing = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      this.timeMs = Math.min(this.durationMs, this.timeMs + (now - last) * this.rate);
      last = now;
      this.#wrap();
      if (this.timeMs >= this.durationMs && !this.loop) { this.playing = false; return; }
      this.#clock = raf(tick);
    };
    this.#clock = raf(tick);
  }
  pause() {
    if (this.el) { this.el.pause(); return; }
    this.playing = false; caf(this.#clock);
  }
  toggle() { (this.el ? !this.el.paused : this.playing) ? this.pause() : this.play(); }
  /** One frame forward (dir > 0) or back; pauses. */
  step(dir) {
    this.pause();
    if (this.el) {
      const m = this.mediaSec || this.el.currentTime;
      const target = Math.min(this.el.duration || Infinity, stepTarget(m, this.frameMs, dir));
      this.el.currentTime = target; this.timeMs = target * 1000; this.mediaSec = 0;
    } else {
      const f = this.frameMs, k = Math.round(this.timeMs / f) + (dir > 0 ? 1 : -1);
      this.seek(Math.round(k * f));
    }
  }
  setRate(r) { r = Number(r); if (!Number.isFinite(r) || r <= 0) return; this.rate = r; if (this.el) this.el.playbackRate = r; }
  setLoop(l) { this.loop = l && l.t1 > l.t0 ? { t0: l.t0, t1: l.t1 } : null; }
  /** Nearest frame start to ms (for snapping new points). */
  snap(ms) { const f = this.frameMs; return Math.round(Math.round(ms / f) * f); }

  #wrap() {
    const l = this.loop;
    if (l && this.playing && this.timeMs >= l.t1) this.seek(l.t0);
  }
}
