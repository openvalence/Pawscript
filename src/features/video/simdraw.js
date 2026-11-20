// simdraw.js -- drawing for the machine preview beside the video (Simulator.svelte). Pure geometry helpers plus two
// canvas painters that take a 2D context, a reusable state object and resolved theme colours. Nothing here
// allocates per frame: geometry and the sim result are written into objects the caller keeps.
//
// Speed colours are not defined here: the caller passes the ramp (S.ramp, colour strings slow -> fast, the same
// buckets the lanes draw with, from the review heat settings) and the speed at its top (S.max). The device limit
// (S.limit, units/s; S.mode 'hard' | 'planner') only marks "over".

import { lowerBound, posAt } from '../../lib/core/script.js';
import { colorAt } from '../../lib/analyze/heatmap.js';

export const SIM_MIN_W = 120, SIM_MAX_W = 420;
export const clampSimWidth = (w) => Math.round(Math.max(SIM_MIN_W, Math.min(SIM_MAX_W, Number(w) || 168)));

const TAU = Math.PI * 2;
/** lanes/geom.js PAD: the lanes' machine painters put pos 100 / 0 this far inside their canvas (a test checks it). */
export const LANE_PAD = 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** How far ahead the incoming trace reaches by default (ms across the panel; the wheel over it changes ui.simLead). */
export const SIM_LEAD = 1000;
export const clampLead = (ms) => Math.round(Math.max(400, Math.min(6000, Number(ms) || SIM_LEAD)) / 50) * 50;

/** Graph geometry for a w x h canvas (CSS px), written into g. paw-gwmd: the rail is docked to the edge beside the
 *  video (side 'right': the panel's left edge; 'left': its right edge) and the script's next `lead` ms flow in from the
 *  far edge toward it (g.dir: +1 time runs rightward from the rail, -1 leftward). No lead (folded): the rail centred.
 *  hw: the meteor head's half width (wider than the tw track it rides). Margins: the tip label above, the hilt below. */
export function simGeometry(g, w, h, lead, side = 'right') {
  g.left = 6; g.right = w - 6; g.top = 15; g.bot = h - 21;
  g.tw = 20; g.hw = clamp(Math.round(w * 0.12), 16, 24);   // owner: "that box it rides in, make it 5x larger and then keep the carriage about 2x as big"
  g.dir = side === 'left' ? -1 : 1;
  const on = lead > 0 && g.right - g.left > 4 * g.hw;
  g.nowX = !on ? w / 2 : g.dir > 0 ? g.left + g.hw : g.right - g.hw;
  g.farX = !on ? g.nowX : g.dir > 0 ? g.right : g.left;
  g.ppm = on ? Math.abs(g.farX - g.nowX) / lead : 0;
  return g;
}
/** pos (0 deepest .. 100 out) -> y: 100 at the top, 0 at the bottom. */
export const posToY = (g, pos) => g.bot - (pos / 100) * (g.bot - g.top);
export const yToPos = (g, y) => ((g.bot - y) / (g.bot - g.top)) * 100;
/** Script time -> x of the incoming trace: `now` on the rail, later times further out (one fixed ms -> px scale). */
export const timeToX = (g, now, t) => g.nowX + g.dir * (t - now) * g.ppm;

// ---- the meteor (ported from Phosphor src/ui/hero/RailWidget.svelte, the hero rail's comet) ----
// The tail is the true recent path, TAIL_MS of what the head rode, fading with age, so its length is the speed and it
// collapses onto the head at rest; the head glows more the faster it goes (a sprite drawn once per theme / scale).
// Changed from Phosphor: the rail stands up (the tail runs along y), the tail is shorter (a stroke crosses the whole
// rail in ~150 ms here, Phosphor's carriage a fraction of it) and as wide as the head, and a reversal flashes (PULSE_MS).
export const TAIL_MS = 100, TAIL_N = 24, GLOW_REST = 16, GLOW_FAST = 34, PULSE_MS = 150, HARD_REF = 400;
/** 0..1 how fast the head reads (Phosphor's rule, the root keeps slow strokes visible; its "full travel in a second is fast"
 *  made HARD_REF u/s here, a script's strokes being far quicker than Phosphor's carriage). */
export const meteorSpeed = (pxPerMs, travelPx) => (travelPx > 0 ? Math.min(1, Math.sqrt(Math.max(0, pxPerMs) / ((travelPx * HARD_REF) / 100 / 1000))) : 0);
/** The last reversal of the script at or before t and less than win ms old: the point the motion arrives at before it
 *  turns back (a hold there counts as part of the turn), written into o {at, pos, hard 0.35..1 from the speeds in and out
 *  against HARD_REF u/s}. null: none. */
export function turnInto(o, script, t, win = PULSE_MS) {
  const n = script.length;
  for (let i = lowerBound(script, t + 1e-6) - 1; i > 0 && script[i].at > t - win; i--) {
    const a = script[i - 1], b = script[i], din = b.pos - a.pos;
    if (!din) continue;
    let j = i;
    while (j + 1 < n && j - i < 8 && script[j + 1].pos === b.pos) j++;
    if (j + 1 >= n) continue;
    const c = script[j + 1], dout = c.pos - b.pos;
    if (!dout || (dout > 0) === (din > 0)) continue;
    const vin = (Math.abs(din) * 1000) / (b.at - a.at), vout = (Math.abs(dout) * 1000) / (c.at - script[j].at);
    o.at = b.at; o.pos = b.pos; o.hard = clamp(Math.sqrt((vin + vout) / 2 / HARD_REF), 0.35, 1);
    return o;
  }
  return null;
}
/** The reversal's light age ms after it: full at the turn's own frame, gone after PULSE_MS. */
export const pulseOf = (age, hard = 1) => (age >= 0 && age < PULSE_MS ? hard * (1 - age / PULSE_MS) ** 2 : 0);
/** The head's glow sprite (Phosphor's buildGlow): a radial fade of `color`, 2 * GLOW_FAST css px across at dpr. */
export function makeGlow(color, dpr = 1) {
  const px = Math.ceil(2 * GLOW_FAST * dpr), cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d'), grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, `color-mix(in srgb, ${color} 45%, transparent)`);
  grad.addColorStop(0.6, `color-mix(in srgb, ${color} 10%, transparent)`);
  grad.addColorStop(1, 'transparent');
  g.fillStyle = grad; g.fillRect(0, 0, px, px);
  return cv;
}

/** simAt (sim.js) written into `out` instead of a new object: {pos (exactly posAt), speed u/s, dir}. */
export function simInto(out, script, t) {
  const n = script ? script.length : 0;
  out.speed = 0; out.dir = 0;
  if (!n) { out.pos = NaN; return out; }
  out.pos = posAt(script, t);
  const i = lowerBound(script, t);
  if (i > 0 && i < n) {
    const a = script[i - 1], b = script[i], dp = b.pos - a.pos;
    out.speed = (Math.abs(dp) * 1000) / (b.at - a.at); out.dir = Math.sign(dp);
  }
  return out;
}

/** The machine's speed is a central difference over SPEED_WIN ms of its plan (steadier than per-tick speeds). */
export const SPEED_WIN = 40;

// ---- speed colours ----
/** Ramp index for a speed: the lanes' bucket rule (round to the nearest of n buckets, 0..max). */
export const rampIndex = (speed, max, n) => {
  const b = Math.floor((speed / (max > 0 ? max : 400)) * (n - 1) + 0.5);
  return b < 0 || !(b === b) ? 0 : b >= n ? n - 1 : b;
};
export const rampColor = (ramp, max, speed) => ramp[rampIndex(speed, max, ramp.length)];
/** n colour strings for a scale name or stop list, from the analyze scales (used when the lanes' ramp is absent). */
export const rampOf = (scale = 'heat', n = 12) =>
  Array.from({ length: n }, (_, i) => { const [r, g, b] = colorAt(scale, i / (n - 1)); return `rgb(${r},${g},${b})`; });

// ---- secondary axes ----
const KINDS = { roll: 'roll', r1: 'roll', pitch: 'pitch', r2: 'pitch', twist: 'twist', r0: 'twist' };
/** Axis id -> how its indicator is drawn: 'roll' | 'pitch' | 'twist' (rotations) | 'linear'. */
export const axisKind = (id) => KINDS[String(id).toLowerCase()] || 'linear';
/** Rotation (radians, clockwise positive) for pos; 50 = neutral. roll/pitch +-30 deg, twist +-180 deg. */
export const axisAngle = (kind, pos) => ((pos - 50) / 50) * (kind === 'twist' ? Math.PI : Math.PI / 6);
/** Readout for an indicator: '+12°' for rotations, '47' for linear axes. */
export function axisValue(kind, pos) {
  if (!Number.isFinite(pos)) return '–';
  if (kind === 'linear') return String(Math.round(pos));
  const d = Math.round((axisAngle(kind, pos) * 180) / Math.PI);
  return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d) + '°';
}
export const AXIS_CELL_W = 38, AXIS_CELL_H = 54;
/** Grid for n indicator cells in width w: {cols, rows, height}. */
export function axesGrid(n, w) {
  const cols = Math.max(1, Math.floor((w - 8) / AXIS_CELL_W)), rows = n ? Math.ceil(n / cols) : 0;
  return { cols, rows, height: rows * AXIS_CELL_H };
}

/** Theme colours the painters need, from CSS tokens (read on mount and on a theme change). `get(name)` reads one. */
export function readColors(get, seriesKeys = []) {
  const v = (n, f) => get(n) || f;
  const mono = v('--mono', 'monospace'), font = v('--font', 'sans-serif');
  const c = {
    bg: v('--bg', '#08090B'), sunken: v('--bg-sunken', '#040507'),
    line1: v('--line-1', '#1D2026'), line2: v('--line-2', '#272B31'), line3: v('--line-3', '#33373E'), line4: v('--line-4', '#454A54'),
    ghost: v('--tx-ghost', '#5C626C'), mut: v('--tx-mut', '#848A96'), val: v('--tx-val', '#A8AEB9'), hi: v('--tx-hi', '#ECEFF4'),
    bad: v('--bad-ink', '#FF5C6A'), info: v('--info-ink', '#4DA6FF'), warn: v('--warn-ink', '#F5B94D'), accent: v('--accent', '#4DA6FF'), series: {},
  };
  for (const k of seriesKeys) c.series[k] = v('--series-' + k, c.val);
  c.mono9 = '9px ' + mono; c.label9 = '500 9px ' + font;
  return c;
}

/** Debug / measurement hook (harness and tests read it): the last drawn frame. */
export const simDebug = { t: NaN, pos: NaN, raw: NaN, src: '', headY: NaN, drawnPos: NaN, pulse: 0, pulseY: NaN, speed: 0, frames: 0, drawMs: 0, drawSum: 0, drawMax: 0 };

/** Reusable per-component state: create once, mutate per frame. S.plan: the machine preview's plan ({t0, dtMs, pos}
 *  at the planner's tick) with S.misses / S.clamps (device-preview.svelte.js); S.lanes: the main timeline's machine
 *  painters {drawMachine, drawMisses, T} (lanes/render.js), so the band and the misses look the same in both places. */
export function makeSimState() {
  return {
    script: [], plan: null, misses: null, clamps: null, lanes: null, t: 0, frameMs: 0, lead: SIM_LEAD, side: 'right', w: 0, h: 0, dpr: 1,
    ramp: rampOf('heat'), max: 400, limit: Infinity, mode: 'hard',
    unapplied: false, quiet: false, glow: null, glowWarn: null,   // following unapplied data (warn ink); scrubbing (no reversal light); the head's sprites (makeGlow)
    out: { pos: NaN, speed: 0, dir: 0, raw: NaN, src: 'script', over: false, miss: false },
    tmp: { pos: NaN, speed: 0, dir: 0 }, g: {}, fade: null, fadeX: NaN, view: { start: 0, span: 1 }, mg: { samples: null, misses: null, clamps: null },
    tail: new Float64Array(TAIL_N + 1), turn: { at: 0, pos: 0, hard: 0 },
  };
}

/** The span a plan covers: [t0, t1] ms. */
export const planSpan = (sm) => [sm.t0, sm.t0 + (sm.pos.length - 1) * sm.dtMs];
/** The machine at t from its plan, written into `out`: {pos (linear between ticks), speed u/s (central difference over
 *  SPEED_WIN ms, clipped to the plan), dir}. */
export function planInto(out, sm, t) {
  const P = sm.pos, n = P.length, dt = sm.dtMs, [t0, t1] = planSpan(sm);
  const at = (x) => { const f = clamp((x - t0) / dt, 0, n - 1), i = Math.floor(f), j = i + 1 < n ? i + 1 : i; return P[i] + (P[j] - P[i]) * (f - i); };
  out.pos = at(t);
  const a = Math.max(t0, t - SPEED_WIN / 2), b = Math.min(t1, t + SPEED_WIN / 2);
  const d = b > a ? ((at(b) - at(a)) * 1000) / (b - a) : 0;
  out.speed = Math.abs(d); out.dir = Math.abs(d) < 1 ? 0 : Math.sign(d);
  return out;
}
/** Can the machine not follow at t? The script point it is heading to is one the plan misses (misses [{at}]), or the
 *  plan is held at a window edge (clamps [{t0, t1}]). */
export function missAt(script, misses, clamps, t) {
  const j = lowerBound(script, t);
  if (misses?.length && j < script.length) { const k = lowerBound(misses, script[j].at); if (k < misses.length && misses[k].at === script[j].at) return true; }
  if (clamps) for (const c of clamps) if (t >= c.t0 && t <= c.t1) return true;
  return false;
}

/**
 * The rail and the script coming at it (paw-gwmd). The rail is docked at the edge beside the video (simGeometry); the
 * script's next S.lead ms come in from the far edge as one calm line fading with distance, so the motion arrives at the
 * rail as it will happen; 100 (tip, out) at the top, 0 (hilt, deepest) at the bottom. Draws on ctx (already scaled to
 * CSS px) over S.w x S.h and leaves the device state at S.t in S.out.
 *  - the head is a meteor (Phosphor's comet): a glowing head wider than the rail, its tail the last TAIL_MS of the path
 *    (length and brightness = speed and direction), in the accent (the warn ink while S.unapplied);
 *  - a reversal of the script lights up at the turn's position for PULSE_MS from its own frame (not while S.quiet);
 *  - S.plan (the machine preview): the planner's motion as the main timeline's band under the line and its misses over
 *    it (S.lanes painters); inside the plan the head follows the machine, a hollow marker shows the commanded position
 *    and a warn bar along the rail the shortfall between them;
 *  - outside the plan / without one the head is the script (exactly posAt).
 */
export function drawGraph(ctx, S, C) {
  const { script, t, w, h, out } = S;
  const lead = Math.max(0, S.lead || 0);
  const g = simGeometry(S.g, w, h, lead, S.side);
  const { top, bot, nowX, farX, ppm, tw, hw, dir } = g, H = bot - top, n = script.length;
  const plan = S.plan?.pos?.length ? S.plan : null;
  const span = plan ? planSpan(plan) : null;
  const machine = !!plan && t >= span[0] && t <= span[1];

  // device state: the machine inside its plan, else the script (exactly posAt either way)
  simInto(S.tmp, script, t);
  out.raw = S.tmp.pos;
  if (machine) { planInto(out, plan, t); out.src = 'machine'; }
  else { out.pos = S.tmp.pos; out.speed = S.tmp.speed; out.dir = S.tmp.dir; out.src = 'script'; }
  out.over = out.speed > S.limit;
  out.miss = machine && missAt(script, S.misses, S.clamps, t);

  ctx.clearRect(0, 0, w, h);
  simDebug.t = t; simDebug.pos = out.pos; simDebug.raw = out.raw; simDebug.src = out.src; simDebug.pulse = 0; simDebug.pulseY = NaN;
  if (H <= 4 || w <= 20) { simDebug.headY = simDebug.drawnPos = NaN; return out; }
  const X = (at) => nowX + dir * (at - t) * ppm, Y = (p) => bot - (p / 100) * H;
  const x0 = Math.min(nowX, farX), x1 = Math.max(nowX, farX), t1 = t + lead;
  const hot = S.unapplied ? C.warn : C.accent;

  if (ppm > 0) {
    // the lanes' painters: their x runs 0..w over view, their y puts 100 / 0 at PAD / h - PAD (mirrored on the left side)
    const L = plan ? S.lanes : null;
    if (L) { S.view.start = t; S.view.span = lead; S.mg.samples = plan; S.mg.misses = S.misses; S.mg.clamps = S.clamps; }
    const inLane = (fn) => { ctx.save(); ctx.translate(nowX, top - LANE_PAD); if (dir < 0) ctx.scale(-1, 1); fn(x1 - x0, H + 2 * LANE_PAD); ctx.restore(); };
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, top - 6, x1 - x0, H + 12); ctx.clip();
    if (L) inLane((lw, lh) => L.drawMachine(ctx, lw, lh, S.view, S.mg, 0, L.T));
    if (n) {
      // the incoming script: one line from the head out to t + lead (held flat before the first / after the last action)
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = C.val;
      ctx.beginPath(); ctx.moveTo(nowX, Y(out.raw));
      for (let i = lowerBound(script, t + 1e-6); i < n && script[i].at < t1; i++) ctx.lineTo(X(script[i].at), Y(script[i].pos));
      ctx.lineTo(X(t1), Y(posAt(script, t1)));
      ctx.stroke();
    }
    if (L) inLane((lw, lh) => L.drawMisses(ctx, lw, lh, S.view, S.mg, L.T));
    ctx.restore();
    // fade with distance: erase toward the far edge (from just past the head)
    const fk = nowX * 1e4 + farX;
    if (S.fadeX !== fk) {
      S.fadeX = fk;
      S.fade = ctx.createLinearGradient(nowX + dir * hw, 0, farX, 0);
      S.fade.addColorStop(0, 'rgba(0,0,0,0)'); S.fade.addColorStop(1, 'rgba(0,0,0,0.92)');
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = S.fade; ctx.fillRect(x0, 0, x1 - x0, h);
    // the stroke window's ends, faint, underneath (destination-over: the fade never dims them)
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = C.line1;
    for (const p of [0, 100]) ctx.fillRect(x0, Math.round(Y(p)), x1 - x0, 1);
    ctx.globalCompositeOperation = 'source-over';
  }

  // the rail: a thin recessed track, its frame in the warn / bad / info ink while the machine cannot follow / is over
  const rx = nowX - tw / 2;
  ctx.fillStyle = C.sunken; ctx.fillRect(rx, top - 4, tw, H + 8);
  ctx.strokeStyle = out.miss ? C.warn : out.over ? (S.mode === 'planner' ? C.info : C.bad) : C.line3; ctx.lineWidth = 1;
  ctx.strokeRect(rx - 0.5, top - 4.5, tw + 1, H + 9);
  ctx.fillStyle = C.line4;
  for (const p of [0, 100]) ctx.fillRect(nowX - hw / 2, Math.round(Y(p)), hw, 1);
  ctx.font = C.mono9; ctx.textAlign = 'center'; ctx.fillStyle = C.ghost;
  const lx = clamp(nowX, g.left + 12, g.right - 12);
  ctx.textBaseline = 'bottom'; ctx.fillText('tip', lx, top - 5);
  ctx.textBaseline = 'top'; ctx.fillText(w >= 64 ? '0 hilt' : '0', clamp(nowX, g.left + 16, g.right - 16), bot + 9);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

  const y = Y(out.pos);
  if (Number.isFinite(y)) {
    if (machine && Number.isFinite(out.raw) && Math.abs(out.raw - out.pos) > 2) {   // the shortfall: head -> command
      const yr = Y(out.raw);
      ctx.fillStyle = C.warn; ctx.globalAlpha = 0.55; ctx.fillRect(nowX + hw - 2, Math.min(y, yr), 2, Math.abs(yr - y)); ctx.globalAlpha = 1;
    }
    // the tail: where the head was over the last TAIL_MS (the machine inside its plan, else the script)
    const T = S.tail, dt = TAIL_MS / TAIL_N;
    for (let k = 0; k <= TAIL_N; k++) T[k] = Y(machine ? planInto(S.tmp, plan, t - k * dt).pos : posAt(script, t - k * dt));
    const kq = TAIL_N / 4, s = meteorSpeed(Math.abs(T[0] - T[kq]) / (kq * dt), H);
    simDebug.speed = s;
    ctx.fillStyle = hot;
    tail(ctx, T, nowX, hw * 1.1, 0.22, S.dpr);   // bloom
    tail(ctx, T, nowX, hw * 0.5, 0.9, S.dpr);
    const glow = S.unapplied ? S.glowWarn : S.glow;
    // the reversal's light, at the turn, from its own frame (the frame shown at t lasts S.frameMs: a turn in its first half
    // is this frame's; the player can report a frame a ms before its nominal time)
    const tn = S.quiet || !n ? null : turnInto(S.turn, script, t + (S.frameMs || 0) / 2);
    const a = tn ? pulseOf(Math.max(0, t - tn.at), tn.hard) : 0;
    if (a > 0.01) {
      const yt = Y(tn.pos), r = GLOW_FAST * (1.2 + 0.8 * tn.hard);
      ctx.globalAlpha = a;
      if (glow) ctx.drawImage(glow, nowX - r, yt - r, 2 * r, 2 * r);
      ctx.fillRect(nowX - 1.6 * hw, Math.round(yt) - 1, 3.2 * hw, 2);
      simDebug.pulse = a; simDebug.pulseY = yt;
    }
    // the head: its glow grows with speed, a bar across the rail, a light core on the exact position
    const gr = GLOW_REST + (GLOW_FAST - GLOW_REST) * s;
    ctx.globalAlpha = 0.5 + 0.5 * s;
    if (glow) ctx.drawImage(glow, nowX - gr, y - gr, 2 * gr, 2 * gr);
    ctx.globalAlpha = 0.8; ctx.fillRect(nowX - hw, y - 2, 2 * hw, 4);
    ctx.globalAlpha = 1; ctx.fillStyle = C.hi; ctx.fillRect(nowX - hw * 0.55, y - 3, hw * 1.1, 6);
    if (machine && Number.isFinite(out.raw)) {   // the commanded position: a hollow marker
      const yr = Math.round(Y(out.raw)) + 0.5;
      ctx.strokeStyle = C.val; ctx.globalAlpha = 0.85; ctx.lineWidth = 1;
      ctx.strokeRect(nowX - hw - 1.5, yr - 3, 2 * hw + 3, 6);
      ctx.globalAlpha = 1;
    }
  }
  simDebug.headY = y; simDebug.drawnPos = yToPos(g, y);
  return out;
}

/** Phosphor's drawTail, stood up: the path ys (newest first) as tapering quads along the rail at x, alpha fading with
 *  age; device-pixel edges so abutting pieces share an exact edge. */
function tail(ctx, ys, x, half, alpha, dpr = 1) {
  const snap = (v) => Math.round(v * dpr) / dpr;
  let y0 = snap(ys[0]);
  for (let k = 0; k < TAIL_N; k++) {
    const y1 = snap(ys[k + 1]);
    if (y1 !== y0) {
      const a0 = 1 - k / TAIL_N, a1 = 1 - (k + 1) / TAIL_N, am = (a0 + a1) / 2, w0 = Math.max(0.3, half * a0), w1 = Math.max(0.3, half * a1);
      ctx.globalAlpha = alpha * am * am;
      ctx.beginPath(); ctx.moveTo(x - w0, y0); ctx.lineTo(x - w1, y1); ctx.lineTo(x + w1, y1); ctx.lineTo(x + w0, y0); ctx.closePath(); ctx.fill();
    }
    y0 = y1;
  }
  ctx.globalAlpha = 1;
}

const tick = (ctx, cx, cy, r, q) => {
  const c = Math.cos(q), s = Math.sin(q);
  ctx.moveTo(cx + c * (r - 2), cy + s * (r - 2)); ctx.lineTo(cx + c * (r + 2), cy + s * (r + 2));
};

/** Secondary-axis indicators: one cell per {id, label, kind, color, script} in `axes`, laid out by axesGrid. */
export function drawAxes(ctx, axes, t, w, h, C) {
  ctx.clearRect(0, 0, w, h);
  const n = axes.length;
  if (!n || w < 24 || h < 24) return;
  const { cols } = axesGrid(n, w), perRow = Math.min(n, cols), cw = w / perRow;
  const r = Math.max(4, Math.min(12, cw / 2 - 6));
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = axes[i], kind = a.kind, pos = posAt(a.script, t), col = a.color || C.hi;
    const cx = Math.round(cw * ((i % cols) + 0.5)), cy = Math.floor(i / cols) * AXIS_CELL_H + 4 + r;
    ctx.lineWidth = 1;
    if (kind === 'linear') {
      const x0 = cx - r - 4, bw = 2 * r + 8, f = clamp(pos / 100, 0, 1);
      ctx.fillStyle = C.sunken; ctx.fillRect(x0, cy - 3, bw, 6);
      ctx.strokeStyle = C.line3; ctx.strokeRect(x0 + 0.5, cy - 2.5, bw - 1, 5);
      ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.fillRect(x0 + 1, cy - 2, (bw - 2) * f, 4); ctx.globalAlpha = 1;
      ctx.fillRect(Math.round(x0 + (bw - 2) * f), cy - 5, 2, 10);
    } else {
      const ang = axisAngle(kind, pos), s = Math.sin(ang), c = Math.cos(ang);
      ctx.strokeStyle = C.line3; ctx.beginPath();
      if (kind === 'pitch') { ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); ctx.moveTo(cx, cy); ctx.lineTo(cx + r, cy); }
      else ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      // limit ticks at +-30 deg (roll, pitch) / the neutral mark (twist)
      ctx.strokeStyle = C.line4; ctx.beginPath();
      if (kind === 'twist') { ctx.moveTo(cx, cy - r - 2); ctx.lineTo(cx, cy - r + 2); }
      else { const L = Math.PI / 6, base = kind === 'pitch' ? 0 : -Math.PI / 2; tick(ctx, cx, cy, r, base - L); tick(ctx, cx, cy, r, base + L); }
      ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
      if (kind === 'roll') {           // a horizon bar with an "up" tick, rotated
        ctx.moveTo(cx - c * (r - 2), cy - s * (r - 2)); ctx.lineTo(cx + c * (r - 2), cy + s * (r - 2));
        ctx.moveTo(cx, cy); ctx.lineTo(cx + s * (r * 0.5), cy - c * (r * 0.5));
      } else if (kind === 'pitch') {   // side view: a nose pointing right, up for positive
        ctx.moveTo(cx - 3 * c, cy + 3 * s); ctx.lineTo(cx + c * (r - 1), cy - s * (r - 1));
      } else {                          // twist: a needle from the centre, up = neutral
        ctx.moveTo(cx, cy); ctx.lineTo(cx + s * (r - 2), cy - c * (r - 2));
      }
      ctx.stroke();
      if (kind === 'twist' && Math.abs(ang) > 0.01) {
        ctx.globalAlpha = 0.6; ctx.lineWidth = 2; ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang, ang < 0); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, TAU); ctx.fill();
    }
    ctx.font = C.label9; ctx.fillStyle = C.mut;
    ctx.fillText(a.label, cx, cy + r + 13);
    ctx.font = C.mono9; ctx.fillStyle = C.val;
    ctx.fillText(axisValue(kind, pos), cx, cy + r + 25);
  }
}
