// scheduler.js -- the active script to timed device commands, following the video transport. Pure: no Svelte,
// no app, no I/O; test/playback-scheduler.test.mjs drives it with a fake clock.
//
// Ported from Phosphor's funscript player (plugins/factory/funscript-player/scheduler.js), re-cut for buttplug's
// LinearCmd, which executes on arrival (no timestamped queue on the device side):
// - Span k (knot k-1 -> k) is ONE command: position pos[k], duration the span's wall time. It goes out when the
//   device should start it, `lead` ms early: lead = profile latency - user offset (offset: + = machine later,
//   Phosphor's T.offsetMs sign). In script time the device starts what we send now at u = media + lead * rate.
// - A command sent late (timer jitter, a rate limit) still arrives on time: its duration is what is left until
//   its knot. A knot already behind u is skipped, never sent.
// - Play start and seek: one transition segment to where the script is transitionMs on (Phosphor's seek
//   transition), then the next span joins at its end, so no jump. Unknown device position: SLOW_MS transition.
// - Pause: one stop segment along the line for min(STOP_MS, time to the next knot), ending at rest (Phosphor's
//   stop()). Paused seeks (scrub) follow the playhead at most every scrubMs, at a limited speed; for SETTLE_MS
//   after the stop the clock snapping back to the frame on screen is not a seek.
// - Edits: the script is read every tick; a new script re-finds the next knot by time, so the next command is
//   the edited one. Rate changes need nothing: every duration is computed at the rate in force.
// - Mapping (Phosphor's applyT): device = lo + (invert ? 1 - n : n) * (hi - lo), n = pos / 100. pos 0 = deepest
//   = device 0, as Phosphor and buttplug strokers. Everything leaves through out(): clamped to [0, 1], never NaN.
// - Limits: hard profiles clamp each command's travel to maxSpeed (units/s = % of the device's stroke per s;
//   the target is pulled in, the timing kept) and space commands minIntervalMs apart. A 'planner' profile
//   (Nucleus Capstan) reshapes over-limit input itself: maxSpeed 0 = no clamp; the caller passes it so.
// - endVel (device units/s, for a planner sink such as Valence segments; buttplug ignores it): a span ends on the
//   script's PCHIP tangent at its knot (knotVel, SPEC §9.6's Fritsch-Butland angle), 0 at a reversal, a hold edge,
//   the last knot or before a gap over GAP_MS; every other command (transition, stop, scrub, a clamped span) ends at 0.

import { posAt } from '../../lib/core/script.js';

export const TRANSITION_MS = 300, SLOW_MS = 1000, STOP_MS = 200, SEEK_TOL_MS = 250, MIN_DUR_MS = 10;
export const SCRUB_MS = 100, SCRUB_SPEED = 150;   // paused follow: one command per 100 ms, 150 units/s at most
export const SETTLE_MS = 300;   // after a pause the player's clock settles on the presented frame: not a scrub

export const DEFAULT_CONFIG = Object.freeze({ offsetMs: 0, latencyMs: 0, lo: 0, hi: 100, invert: false, maxSpeed: 0, minIntervalMs: 0, scrub: true });

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Script pos 0..100 -> device 0..1 under {lo, hi (percent), invert}. */
export function toDevice(pos, c = DEFAULT_CONFIG) {
  const n = clamp01(pos / 100), lo = clamp01(c.lo / 100), hi = clamp01(c.hi / 100);
  return clamp01(lo + (c.invert ? 1 - n : n) * (hi - lo));
}

export const GAP_MS = 500;   // Phosphor's EXPECT_MS: a successor further away (wall ms) is a rest

/** End velocity at knot k (device units per wall second, see the header); 0 = rest. */
export function knotVel(sc, k, rate = 1, c = DEFAULT_CONFIG) {
  if (!(k > 0 && k < sc.length - 1)) return 0;
  const h1 = sc[k].at - sc[k - 1].at, h2 = sc[k + 1].at - sc[k].at;
  if (!(h1 > 0 && h2 > 0) || h2 / rate > GAP_MS) return 0;
  const d1 = (sc[k].pos - sc[k - 1].pos) / h1, d2 = (sc[k + 1].pos - sc[k].pos) / h2;   // pos per script ms
  if (d1 * d2 <= 0) return 0;
  const w1 = 2 * h2 + h1, w2 = h2 + 2 * h1;
  const s = (w1 + w2) / (w1 / d1 + w2 / d2);
  const span = (clamp01(c.hi / 100) - clamp01(c.lo / 100)) * (c.invert ? -1 : 1);
  return (s * 1000 * rate / 100) * span;
}

/** First index with at > t (binary search); script.length when none. */
export function indexAfter(script, t) {
  let a = 0, b = script.length;
  while (a < b) { const m = (a + b) >> 1; if (script[m].at <= t) a = m + 1; else b = m; }
  return a;
}

/**
 * send({pos: 0..1, durMs, why: 'span'|'transition'|'stop'|'scrub', endVel}) does the I/O.
 * tick(now, {script, playing, rate, mediaMs}) once per timer fire; mediaMs is the media time at `now`.
 */
export function createScheduler({ send }) {
  let c = { ...DEFAULT_CONFIG };
  let prev = null;          // last observation {now, mediaMs, rate, playing}
  let script = null;        // the script the cursor indexes
  let cursor = 0;           // next knot to command
  let nextAt = null;        // media ms where the next command starts (a transition's end, else the last knot)
  let lastSendAt = -Infinity, scrubAt = null, stoppedAt = -Infinity;
  const s = { last: null, count: 0 };   // last: {pos, durMs, why, at (now)}

  function emit(now, pos, durMs, why, endVel = 0) {
    let p = clamp01(pos);
    const d = Math.max(MIN_DUR_MS, Math.round(durMs));
    const from = s.last ? s.posAt(now) : null;
    if (c.maxSpeed > 0 && from != null) {   // hard limit: pull the target in, keep the timing
      const reach = (c.maxSpeed / 100) * (d / 1000);
      p = clamp01(Math.min(from + reach, Math.max(from - reach, p)));
    }
    if (p !== clamp01(pos)) endVel = 0;
    s.last = { pos: p, durMs: d, why, at: now, from: from ?? p };
    s.count++;
    lastSendAt = now;
    send({ pos: p, durMs: d, why, endVel });
  }
  const dev = (sc, t) => toDevice(posAt(sc, t), c);

  function start(now, sc, u, rate) {
    const tr = s.last ? TRANSITION_MS : SLOW_MS, end = u + tr * rate;
    emit(now, dev(sc, end), tr, 'transition');
    script = sc; cursor = indexAfter(sc, end); nextAt = end;
  }

  s.configure = (cfg) => { c = { ...c, ...cfg }; };
  s.tick = (now, st) => {
    const sc = st.script, rate = st.rate > 0 ? st.rate : 1, m = st.mediaMs;
    const was = prev;
    prev = { now, mediaMs: m, rate, playing: !!st.playing };
    if (!sc?.length || !Number.isFinite(m)) { script = null; return; }
    if (!st.playing) {
      if (was?.playing && script) {   // pause: stop along the line, at rest
        const u = m + (c.latencyMs - c.offsetMs) * was.rate;   // where the device is when this arrives
        const k = indexAfter(sc, u), d = k < sc.length ? Math.min(STOP_MS, (sc[k].at - u) / was.rate) : STOP_MS;
        emit(now, dev(sc, u + Math.max(0, d) * was.rate), Math.max(MIN_DUR_MS, d), 'stop');
        scrubAt = m; stoppedAt = now;
      } else if (now - stoppedAt < SETTLE_MS) scrubAt = m;
      else if (c.scrub && m !== scrubAt && now - lastSendAt >= SCRUB_MS) {
        const target = dev(sc, m), from = s.last ? s.posAt(now) : target;
        const speed = c.maxSpeed > 0 ? Math.min(SCRUB_SPEED, c.maxSpeed) : SCRUB_SPEED;
        emit(now, target, Math.max(SCRUB_MS, (Math.abs(target - from) * 100 * 1000) / speed), 'scrub');
        scrubAt = m;
      }
      script = null;
      return;
    }
    const u = m + (c.latencyMs - c.offsetMs) * rate;
    const jumped = !was?.playing || Math.abs(m - (was.mediaMs + (now - was.now) * was.rate)) > SEEK_TOL_MS;
    if (jumped || !script) { start(now, sc, u, rate); return; }
    if (sc !== script) { script = sc; cursor = indexAfter(sc, Math.max(nextAt, u)); }   // an edit: next knot by time
    while (cursor < sc.length && sc[cursor].at <= u) cursor++;   // knots behind the device are never sent
    if (cursor >= sc.length || nextAt > u) return;
    if (now - lastSendAt < c.minIntervalMs) return;
    const k = cursor++;
    emit(now, toDevice(sc[k].pos, c), (sc[k].at - u) / rate, 'span', knotVel(sc, k, rate, c));
    nextAt = sc[k].at;
  };
  /** The commanded position at `now` (0..1), interpolated along the last command: the live readout. */
  s.posAt = (now) => {
    const L = s.last;
    if (!L) return null;
    const f = Math.min(1, Math.max(0, (now - L.at) / L.durMs));
    return L.from + (L.pos - L.from) * f;
  };
  /** Forget the transport (device lost, re-enabled): the next playing tick starts with a transition. */
  s.reset = (forgetPos = false) => { prev = null; script = null; nextAt = null; scrubAt = null; lastSendAt = -Infinity; stoppedAt = -Infinity; if (forgetPos) s.last = null; };
  return s;
}
