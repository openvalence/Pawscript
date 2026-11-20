// render.js -- lane canvas drawing. Two layers per lane: drawBase (grid, info, ghosts, script, selection) only
// when the script, view, size, selection or styling changed; drawOverlay (playhead, hover, drag feedback) on every
// pointer move / playback frame. Only the visible slice is touched; no per-point allocation in the hot paths.
import { msToX, tickStep, frameAt, frameTime, frameLen } from '../../lib/lane.js';
import { lowerBound } from '../../lib/core/script.js';
import { colorAt } from '../../lib/analyze/heatmap.js';
import { cssVar, hexToRgb } from '../../ui/kit/color.js';
import { PAD, posToY, envelope, lod, frameOf, envelopeAt } from './geom.js';
import { drawDepth } from './depth.js';
import { fmtTime } from '../../lib/time-format.js';

// Speed colours for a line: the theme's --spd-0 (slow) .. --spd-8 (fast) tokens (theme.css); these are the dark values for a
// page without the stylesheet.
const SPD_DARK = ['#5b7fd9', '#3a9ee4', '#2fbcd8', '#35d1b0', '#45d468', '#bfdd46', '#ecb832', '#f47f2f', '#ff4a3d'];
const spdNow = () => SPD_DARK.map((f, i) => { try { return cssVar('--spd-' + i).trim() || f; } catch { return f; } });
export const NB = 12;
const bucketCache = new Map();
/** NB colours for a scale name (review heat settings); 'heat' interpolates the line ramp `spd` (hex x 9; the theme's by default). */
export function bucketColors(scale = 'heat', spd = scale === 'heat' ? spdNow() : null) {
  const key = scale === 'heat' ? 'heat|' + spd.join() : scale;
  let c = bucketCache.get(key);
  if (!c) {
    const stops = scale === 'heat' ? spd.map((h, i) => { try { return hexToRgb(h); } catch { return hexToRgb(SPD_DARK[i]); } }) : scale;
    bucketCache.set(key, (c = Array.from({ length: NB }, (_, i) => { const [r, g, b] = colorAt(stops, i / (NB - 1)); return `rgb(${r},${g},${b})`; })));
  }
  return c;
}
let BUCKET_COLORS = bucketColors();

/**
 * How a ghost is drawn: 'machine' (the device-preview plan: drawMachine, a curve under the script), 'preview'
 * (live previews from the inspector, plan, assist, graphs: dashed, bright, on top of the other ghosts), 'ref' (pinned
 * reference), 'run' (tracker output).
 */
export function ghostKind(g) {
  const src = typeof g.source === 'string' ? g.source : g.source?.kind || '';
  if (g.id === 'device-preview' || src === 'device-preview') return 'machine';
  if (/-preview$/.test(src) || /-preview$/.test(g.id || '') || src.startsWith('graph:') || src === 'plan') return 'preview';
  if (g.pinned || src === 'reference') return 'ref';
  return 'run';
}
/** Only tracker runs and the reference may be accepted into the script (previews have their own apply paths). */
export const acceptableGhost = (g) => { const k = ghostKind(g); return k === 'run' || k === 'ref'; };
const GHOST_ORDER = { run: 0, ref: 1, preview: 2, machine: 3 };
const GHOST_STYLE = { run: { width: 1.25, dash: [4, 3], alpha: 0.6 }, ref: { width: 1.5, dash: [8, 4], alpha: 0.75 }, preview: { width: 1.9, dash: [6, 3], alpha: 1 } };
const bucket = (spd, max) => { const b = Math.floor((spd / max) * (NB - 1) + 0.5); return b < 0 ? 0 : b >= NB ? NB - 1 : b; };

/** Each axis's kit series key (the colour follows the theme): chips, header swatches and the lane's line (the focused
 *  lane draws in speed colours instead when they are on). */
export const AXIS_SERIES = { stroke: 'sky', surge: 'green', sway: 'yellow', twist: 'violet', roll: 'orange', pitch: 'blue', vib: 'pink', valve: 'vermilion', suck: 'lime', lube: 'grey' };
export const axisSeries = (id) => AXIS_SERIES[id] || 'grey';
/** Resolved canvas colour of an axis, from a readTheme() result. */
export const axisColor = (id, T = readTheme()) => T.series[axisSeries(id)];
const SERIES_KEYS = ['sky', 'orange', 'green', 'yellow', 'blue', 'vermilion', 'pink', 'grey', 'violet', 'lime'];
/** A document colour (a series key, or any CSS colour stored by older code) for canvas. */
const docColor = (c, T) => (c && (T.series[c] || T.series[/^var\(--series-(\w+)\)$/.exec(c)?.[1]])) || c;

/** Marks {t, t0?, kind} over a lane: 'in' a filled dot at the top, 'pop' a hollow one, each joined by a thin line to a
 *  tick at t0 (the script stroke that caused it); 'fail' a cross (bad); 'pass' / 'forced' (warn) a small triangle at the
 *  bottom, 'stall' a bad one; 'span' a quiet bar along the bottom from t0 to t; 'stim' a warm bar along the top. */
function drawMarks(ctx, w, h, view, marks, col, T) {
  const X = (t) => msToX(view, w, t), a = view.start, b = view.start + view.span, y = 6;
  ctx.save(); ctx.lineWidth = 1.25;
  for (const m of marks) {
    if ((m.t0 ?? m.t) > b || m.t < a) continue;
    const x = X(m.t) + 0.5;
    if (m.kind === 'stim') { ctx.globalAlpha = 0.25 + 0.6 * (m.peak ?? 1); ctx.fillStyle = T.warn; const x0 = X(m.t0); ctx.fillRect(x0, 0, Math.max(1, x - x0), 3); ctx.globalAlpha = 1; continue; }   // prostate stimulation (paw-xdcy): a bar along the top, stronger with its peak
    if (m.kind === 'span') { ctx.globalAlpha = 0.45; ctx.fillStyle = T.mut; const x0 = X(m.t0); ctx.fillRect(x0, h - 2, Math.max(1, x - x0), 2); ctx.globalAlpha = 1; continue; }
    if (m.kind === 'pass' || m.kind === 'forced' || m.kind === 'stall') {
      ctx.fillStyle = m.kind === 'pass' ? col : m.kind === 'forced' ? T.warn : T.bad;
      ctx.beginPath(); ctx.moveTo(x - 3.5, h - 2); ctx.lineTo(x + 3.5, h - 2); ctx.lineTo(x, h - 8); ctx.closePath(); ctx.fill(); continue;
    }
    if (m.t0 != null && Math.abs(X(m.t0) - x) > 2) {   // from the stroke that caused it
      const x0 = X(m.t0) + 0.5;
      ctx.strokeStyle = m.kind === 'fail' ? T.bad : col; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(x0, y - 3); ctx.lineTo(x0, y + 3); ctx.moveTo(x0, y); ctx.lineTo(x, y); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (m.kind === 'fail') { ctx.strokeStyle = T.bad; ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); continue; }
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
    if (m.kind === 'in') { ctx.fillStyle = col; ctx.fill(); } else { ctx.strokeStyle = col; ctx.stroke(); }
  }
  ctx.restore();
}

/** Theme colours for canvas, read from the kit tokens (re-read on theme change). */
export function readTheme() {
  const v = (n, f) => { try { return cssVar(n).trim() || f; } catch { return f; } };
  const t = {
    bg: v('--bg-sunken', '#040507'), line0: v('--line-0', '#121419'), line1: v('--line-1', '#1D2026'), line2: v('--line-2', '#272B31'),
    line3: v('--line-3', '#33373E'), ghostTx: v('--tx-ghost', '#5C626C'), mut: v('--tx-mut', '#666C78'), val: v('--tx-val', '#A8AEB9'),
    hi: v('--highlight', '#FF5CB3'), hiTx: v('--tx-hi', '#ECEFF4'), reality: v('--reality', '#4DA6FF'), intent: v('--intent', '#A78BFA'),
    warn: v('--warn', '#F5B94D'), overlay: v('--bg-raised', '#0D0F13'), mono: v('--mono', 'ui-monospace, monospace'),
    bad: v('--bad', '#FF4757'), realityRgb: v('--reality-rgb', '77,166,255'), badRgb: v('--bad-rgb', '255,71,87'),
    machine: v('--series-yellow', '#E8C547'),
    spd: spdNow(),
    series: Object.fromEntries(SERIES_KEYS.map((k) => [k, v('--series-' + k, '#A0A3A8')])),
  };
  // grid hairlines: in the contrast theme every grid line is --line-0 (the brighter steps read as content there)
  const hc = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'contrast';
  return { ...t, grid1: hc ? t.line0 : t.line1, grid2: hc ? t.line0 : t.line2 };
}

const speedCache = new WeakMap();
/** Float32Array: speed (pos units/s) of the segment ending at i; cached per Script identity. */
export function speedsOf(script) {
  let s = speedCache.get(script);
  if (!s) {
    s = new Float32Array(script.length);
    for (let i = 1; i < script.length; i++) s[i] = (Math.abs(script[i].pos - script[i - 1].pos) * 1000) / Math.max(1, script[i].at - script[i - 1].at);
    speedCache.set(script, s);
  }
  return s;
}

function vline(ctx, x, y0, y1) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }

/**
 * The script (or a ghost) as a line. Polyline when sparse, per-column envelope when dense.
 * st: {color, width, dash, alpha, speeds (Float32Array|null), maxSpeed}. Returns {i0, i1, mode} for the caller.
 */
function strokeScript(ctx, s, view, w, h, st, bufs) {
  const a = view.start, b = view.start + view.span;
  const i0 = Math.max(0, lowerBound(s, a) - 1), i1 = Math.min(s.length, lowerBound(s, Math.ceil(b)) + 1);
  if (i1 - i0 < 1) return { i0, i1, mode: 'none', bufs };
  // ghosts turn into their outline envelope sooner than the script (they are context, not the thing being edited)
  const L = lod(st.dash ? (i1 - i0) * 1.75 : i1 - i0, w), k = w / view.span, sc = (h - 2 * PAD) / 100;
  ctx.lineWidth = st.width; ctx.setLineDash(st.dash || []); ctx.globalAlpha = st.alpha ?? 1; ctx.lineJoin = 'round';
  // speed colours only where segments are wide enough to read as colour (zoomed out they are 1-2 px speckle)
  const spd = L.heat ? st.speeds : null;
  if (L.envelope) {
    if (st.dash) { ctx.setLineDash([]); ctx.globalAlpha = (st.alpha ?? 1) * 0.8; }   // dense ghosts: a solid outline, dashes would be noise
    bufs = envelope(s, i0, i1, view, w, h, null, bufs);
    const { min, max, first, last } = bufs, W = bufs.w;
    // Per column, the y range the line covers there: its own points plus the piece of the segment that joins the
    // previous non-empty column (so a sparse envelope stays one continuous band). Runs of more than GAP empty
    // columns are real gaps in the script and get a plain line instead.
    if (!bufs.lo || bufs.lo.length < W) { bufs.lo = new Float32Array(W); bufs.hi = new Float32Array(W); }
    const lo = bufs.lo, hi = bufs.hi, GAP = 6;
    lo.fill(NaN, 0, W);
    let gaps = false;
    for (let c = 0, prev = -1; c < W; c++) {
      if (first[c] !== first[c]) continue;
      lo[c] = min[c]; hi[c] = max[c];
      const n = c - prev;
      if (prev >= 0 && n > GAP) gaps = true;
      else if (prev >= 0) {
        const ya = last[prev], dy = first[c] - ya;
        for (let j = prev; j <= c; j++) {   // segment from x = prev + .5 to c + .5, clipped to column j
          const u0 = Math.max(0, (j - prev - 0.5) / n), u1 = Math.min(1, (j - prev + 0.5) / n);
          const y0 = ya + dy * u0, y1 = ya + dy * u1, t = y0 < y1 ? y0 : y1, b = y0 < y1 ? y1 : y0;
          if (!(t >= lo[j])) lo[j] = t;   // NaN (empty column) too
          if (!(b <= hi[j])) hi[j] = b;
        }
      }
      prev = c;
    }
    // widen each covered column by its neighbours: a single stroke peak then reaches the full height of its column
    // instead of stopping halfway, so the band shows the stroke amplitude without stripes or a dotted midline
    for (let c = 0, pl = NaN, ph = NaN; c < W; c++) {
      const l = lo[c], u = hi[c];
      if (l === l) {
        let t = l, b = u;
        if (pl < t) t = pl;
        if (ph > b) b = ph;
        if (c + 1 < W && lo[c + 1] < t) t = lo[c + 1];
        if (c + 1 < W && hi[c + 1] > b) b = hi[c + 1];
        lo[c] = t; hi[c] = b;
      }
      pl = l; ph = u;
    }
    // Zoomed out the lane is one calm shape in the line colour: a translucent body plus its top and bottom edge
    // (no speed colours here; they only speckle at this density). Ghosts: outline only.
    const outline = st.dash;
    const ea = ctx.globalAlpha;
    ctx.fillStyle = ctx.strokeStyle = st.color;
    if (!outline) {
      ctx.globalAlpha = ea * 0.3;
      for (let c = 0; c < W; c++) if (lo[c] === lo[c]) ctx.fillRect(c, lo[c] - 0.75, 1, hi[c] - lo[c] + 1.5);
    }
    ctx.globalAlpha = ea;
    for (let c = 0; c < W; c++) {
      if (lo[c] !== lo[c]) continue;
      if (hi[c] - lo[c] < 3) ctx.fillRect(c, lo[c] - 0.75, 1, hi[c] - lo[c] + 1.5);
      else { ctx.fillRect(c, lo[c] - 0.75, 1, 1.5); ctx.fillRect(c, hi[c] - 0.75, 1, 1.5); }
    }
    if (gaps) {
      ctx.lineWidth = 1; ctx.beginPath();
      for (let c = 0, prev = -1; c < W; c++) {
        if (first[c] !== first[c]) continue;
        if (prev >= 0 && c - prev > GAP) { ctx.moveTo(prev + 0.5, last[prev]); ctx.lineTo(c + 0.5, first[c]); }
        prev = c;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    return { i0, i1, mode: 'envelope', bufs, handles: false };
  }
  if (st.dash && !L.handles) { ctx.setLineDash([]); ctx.globalAlpha = (st.alpha ?? 1) * 0.6; }   // dashes only where points are sparse: dense dashed lines are noise and slow
  // Raster cost (measured, software canvas): one long path of many overlapping strokes is ~10x slower than the same
  // segments stroked 16 at a time, and a 1-device-pixel hairline is another ~4x cheaper. Dense views use hairlines.
  const dense = (i1 - i0) * 4 > w;
  if (dense) ctx.lineWidth = 1 / (ctx.getTransform().a || 1);
  const passes = spd ? NB : 1, CH = 16;
  for (let p = 0; p < passes; p++) {
    ctx.strokeStyle = spd ? BUCKET_COLORS[p] : st.color;
    ctx.beginPath();
    let px = (s[i0].at - a) * k, py = PAD + (100 - s[i0].pos) * sc, n = 0, joined = false;
    for (let i = i0 + 1; i < i1; i++) {
      const x = (s[i].at - a) * k, y = PAD + (100 - s[i].pos) * sc;
      if (!spd || bucket(spd[i], st.maxSpeed) === p) {
        if (!joined) ctx.moveTo(px, py);
        ctx.lineTo(x, y); joined = true;
        if (++n === CH) { ctx.stroke(); ctx.beginPath(); n = 0; joined = false; }
      } else joined = false;
      px = x; py = y;
    }
    if (n) ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  return { i0, i1, mode: 'poly', bufs, handles: L.handles };
}

/**
 * Base layer. L = {
 *   script, color, speedColors, maxSpeed, selIdx (sorted indices into script), focused, locked, hidden,
 *   ghosts: doc.ghosts entries (styled by ghostKind), problem: {t0,t1,severity}|null, heatScale, range: {t0,t1}|null, loops, scenes, fms (frame ms), theme, bufs,
 *   dur (the video's end: no grid past it), left (px the name gutter covers), info: {x, items: [{text, color?, dash?}]}|null (paw-g56v: what the header bar said, faint,
 *   behind the curve), wrap: {before, after} (geom.js loopWrap: the looped script in the out-of-range, a ghost)
 * }. Returns {bufs, handles} (handles: whether point handles were drawn, i.e. points are grabbable).
 */
export function drawBase(ctx, w, h, view, L) {
  const T = L.theme, a = view.start, b = view.start + view.span, X = (t) => msToX(view, w, t);
  ctx.globalAlpha = 1; ctx.setLineDash([]);
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);

  // range (I/O)
  if (L.range) {
    const x0 = Math.max(0, X(L.range.t0)), x1 = Math.min(w, X(L.range.t1));
    if (x1 > x0) { ctx.fillStyle = `rgba(${T.realityRgb},.07)`; ctx.fillRect(x0, 0, x1 - x0, h); }
    ctx.fillStyle = `rgba(${T.realityRgb},.55)`;
    for (const t of [L.range.t0, L.range.t1]) { const x = X(t); if (x >= 0 && x <= w) ctx.fillRect(x, 0, 1, h); }
  }
  // time grid: frames when they are far enough apart, then the major ticks
  ctx.lineWidth = 1;
  const pxPerFrame = frameLen(L.fms) ? (frameLen(L.fms) / view.span) * w : 0;   // L.fms: the frame grid (lane.js: the clock)
  if (pxPerFrame >= 6) {
    ctx.strokeStyle = T.line0; ctx.beginPath();
    for (let f = Math.max(0, frameAt(a, L.fms)), f1 = frameAt(Math.min(b, (L.dur ?? Infinity) - 1e-6), L.fms); f <= f1; f++) { const t = frameTime(f, L.fms); if (t >= a) vline(ctx, X(t) + 0.5, PAD, h - PAD); }
    ctx.stroke();
  }
  const step = tickStep(view.span, w, 90);
  ctx.strokeStyle = T.grid1; ctx.beginPath();
  for (let t = Math.ceil(Math.max(0, a) / step) * step, t1 = Math.min(b, L.dur ?? Infinity); t <= t1; t += step) { const x = X(t) + 0.5; vline(ctx, x, 0, h); }
  ctx.stroke();
  // pos grid 0/25/50/75/100
  for (const [p, col, dash] of [[25, T.line0, null], [75, T.line0, null], [50, T.grid1, [3, 3]], [0, T.grid2, null], [100, T.grid2, null]]) {
    const y = Math.round(posToY(h, p)) + 0.5;
    ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (h >= 60) {
    ctx.font = '9px ' + T.mono; ctx.fillStyle = T.ghostTx; ctx.textBaseline = 'middle';
    for (const p of h >= 110 ? [100, 50, 0] : [100, 0]) ctx.fillText(String(p), (L.left || 0) + 3, Math.round(posToY(h, p)) + (p === 100 ? 6 : p === 0 ? -6 : -6));   // left: the name gutter over the lane
    ctx.textBaseline = 'alphabetic';
  }
  // loops: tint + dashed edges; tiled cycles as faint ticks
  for (const l of L.loops || []) {
    const end = Math.max(l.t1, l.tiledTo || 0);
    if (end < a || l.t0 > b) continue;
    const x0 = Math.max(0, X(l.t0)), x1 = Math.min(w, X(l.t1));
    ctx.fillStyle = T.intent; ctx.globalAlpha = 0.06; ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.globalAlpha = 0.7; ctx.strokeStyle = T.intent; ctx.setLineDash([4, 3]); ctx.beginPath();
    for (const t of [l.t0, l.t1]) if (t >= a && t <= b) vline(ctx, X(t) + 0.5, 0, h);
    ctx.stroke();
    const per = l.t1 - l.t0;
    if (l.tiledTo > l.t1 && per > 0 && (per / view.span) * w > 4) {
      ctx.globalAlpha = 0.3; ctx.beginPath();
      for (let t = l.t1 + per; t <= Math.min(l.tiledTo, b); t += per) if (t >= a) vline(ctx, X(t) + 0.5, 0, h);
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  // the review problem the user jumped to: a quiet tint and an underline in its severity colour
  if (L.problem && L.problem.t1 >= a && L.problem.t0 <= b) {
    const p = L.problem, x0 = Math.max(0, X(p.t0)), x1 = Math.min(w, Math.max(X(p.t1), X(p.t0) + 2));
    ctx.fillStyle = p.severity === 'error' ? T.bad : p.severity === 'warn' ? T.warn : T.reality;
    ctx.globalAlpha = 0.07; ctx.fillRect(x0, 0, x1 - x0, h); ctx.globalAlpha = 0.9; ctx.fillRect(x0, h - 2, x1 - x0, 2); ctx.globalAlpha = 1;
  }
  // the Scenes row's boundaries carried down (paw-k2u; timeline/shots.js): a scene boundary = a faint line through the
  // lane (sceneGuides, setting 'timeline.sceneGuides', on by default; off: ticks like a cut), a cut = short ticks at the
  // top and bottom edges, a camera move (same take) = nothing (paw-p2p0: one take goes on; the Shots strip marks it).
  // Quiet enough to sit under everything.
  if (L.scenes?.length) {
    ctx.fillStyle = T.line3;
    L.scenes.forEach((sc, i) => {
      const t = sc.start_ms ?? sc.t0;
      if (!(i > 0 && t > a && t <= b)) return;
      const x = X(t);
      if (sc.join !== true && L.sceneGuides !== false) { ctx.globalAlpha = 0.55; ctx.fillRect(x, 0, 1, h); ctx.globalAlpha = 1; }
      else if (sc.join !== true || sc.split !== 'camera') { ctx.fillRect(x, 0, 1, 7); ctx.fillRect(x, h - 7, 1, 7); }
    });
  }
  if (L.info) drawInfo(ctx, w, L.info, T);

  // ghosts underneath, dashed, in their own colours
  const ghosts = (L.ghosts || []).map((g) => [ghostKind(g), g]).sort((x, y) => GHOST_ORDER[x[0]] - GHOST_ORDER[y[0]]);
  for (const [kind, g] of ghosts) {
    if (!g.script?.length || kind === 'machine') continue;
    const col = docColor(g.color, T) || (kind === 'preview' ? T.series.orange : kind === 'ref' ? T.series.yellow : T.val);
    const r = strokeScript(ctx, g.script, view, w, h, { color: col, ...GHOST_STYLE[kind] }, L.gbufs);
    L.gbufs = r.bufs;
    if (r.mode === 'poly' && r.handles) {
      ctx.fillStyle = col; ctx.globalAlpha = kind === 'preview' ? 0.95 : 0.7;
      for (let i = r.i0; i < r.i1; i++) { const p = g.script[i]; ctx.fillRect(X(p.at) - 1.5, Math.round(posToY(h, p.pos)) - 1.5, 3, 3); }
      ctx.globalAlpha = 1;
    }
  }

  // marks-only ghosts (the Machine's simulated knot events: lanes/deps.js machineGhost) along the top and bottom
  for (const [, g] of ghosts) if (g.marks?.length) drawMarks(ctx, w, h, view, g.marks, docColor(g.color, T) || T.val, T);

  const s = L.script;
  if (!s.length) return { bufs: L.bufs, handles: false };   // an empty lane shows nothing (owner 2026-11-15: no "Empty lane" hint)
  if (L.hidden) return { bufs: L.bufs, handles: false };
  const dim = L.locked ? 0.55 : 1;
  BUCKET_COLORS = bucketColors(L.heatScale || 'heat', T.spd);
  // the machine preview (the planner's motion): its curve under the script line (the command stays crisp on top), its
  // misses and window clamps over it, below the selection; never handles
  const mg = ghosts.find(([k, g]) => k === 'machine' && g.samples?.pos)?.[1];
  if (mg) drawMachine(ctx, w, h, view, mg, lowerBound(s, b) - lowerBound(s, a), T);
  if (L.wrap) drawWrap(ctx, w, h, view, L.wrap, L.color, L.dur, T);
  const r = strokeScript(ctx, s, view, w, h, { color: L.color, width: 1.6, alpha: dim, speeds: L.speedColors ? speedsOf(s) : null, maxSpeed: L.maxSpeed || 400 }, L.bufs);
  if (mg) drawMisses(ctx, w, h, view, mg, T);
  const sel = L.selIdx || [];
  // selection
  if (sel.length) {
    const k0 = lowerIdx(sel, r.i0), k1 = lowerIdx(sel, r.i1);
    if (r.mode === 'envelope') {
      // dense: mark the columns that hold selected points with a strip along the bottom and top
      ctx.fillStyle = T.hi; ctx.globalAlpha = 0.85;
      let run0 = -1, prev = -2;
      for (let k = k0; k <= k1; k++) {
        const c = k < k1 ? Math.floor(X(s[sel[k]].at)) : -9;
        if (c !== prev && c !== prev + 1) { if (run0 >= 0) { ctx.fillRect(run0, h - 3, prev - run0 + 1, 3); ctx.fillRect(run0, 0, prev - run0 + 1, 2); } run0 = c; }
        prev = c;
      }
      ctx.globalAlpha = 1;
    } else {
      // segments between two selected neighbours, then the handles
      ctx.strokeStyle = T.hi; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.9; ctx.beginPath();
      for (let k = Math.max(1, k0); k < k1; k++) if (sel[k] === sel[k - 1] + 1) {
        const p = s[sel[k - 1]], q = s[sel[k]];
        ctx.moveTo(X(p.at), posToY(h, p.pos)); ctx.lineTo(X(q.at), posToY(h, q.pos));
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  if (r.mode === 'poly' && r.handles) {
    // unselected handles: hollow rings in the line colour
    ctx.lineWidth = 1.5; ctx.fillStyle = T.bg; ctx.globalAlpha = dim;
    const spd = L.speedColors ? speedsOf(s) : null;
    let k = lowerIdx(sel, r.i0);
    ctx.beginPath();
    ctx.strokeStyle = L.color;
    for (let i = r.i0; i < r.i1; i++) {
      if (sel[k] === i) { k++; continue; }
      const x = X(s[i].at), y = posToY(h, s[i].pos);
      ctx.moveTo(x + 3.5, y); ctx.arc(x, y, 3.5, 0, 6.2832);
    }
    ctx.fill(); ctx.strokeStyle = spd ? T.val : L.color; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (r.mode === 'poly' && sel.length) {
    // selected handles: filled, larger, always drawn (even when unselected ones are hidden)
    const k0 = lowerIdx(sel, r.i0), k1 = lowerIdx(sel, r.i1);
    if (k1 - k0 <= w) {
      ctx.beginPath();
      for (let k = k0; k < k1; k++) { const p = s[sel[k]], x = X(p.at), y = posToY(h, p.pos); ctx.moveTo(x + 4.5, y); ctx.arc(x, y, 4.5, 0, 6.2832); }
      ctx.fillStyle = T.hi; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = T.bg; ctx.stroke();
    }
  }
  // paw-5zpf: the active element (L.active [i0, i1]: the last one clicked), Blender's lighter highlight over the selection
  if (r.mode === 'poly' && L.active && L.active[1] >= r.i0 - 1 && L.active[0] <= r.i1) {
    const [i0, i1] = L.active;
    if (i1 > i0) {
      ctx.strokeStyle = T.hiTx; ctx.lineWidth = 2.4; ctx.beginPath();
      ctx.moveTo(X(s[i0].at), posToY(h, s[i0].pos));
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(X(s[i].at), posToY(h, s[i].pos));
      ctx.stroke();
    }
    if (i1 - i0 <= w) {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const x = X(s[i].at), y = posToY(h, s[i].pos); ctx.moveTo(x + 4.5, y); ctx.arc(x, y, 4.5, 0, 6.2832); }
      ctx.fillStyle = T.hiTx; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = T.hi; ctx.stroke();
    }
  }
  // paw-5zpf: while S / R previews, the levels it holds at 0 / 100 (L.clamped indices) get a warning ring: nothing flattens unseen
  if (L.clamped?.length) {
    ctx.strokeStyle = T.warn; ctx.lineWidth = 1.5; ctx.beginPath();
    for (const i of L.clamped.slice(0, 4000)) { const p = s[i]; if (!p) continue; const x = X(p.at), y = posToY(h, p.pos); ctx.moveTo(x + 7, y); ctx.arc(x, y, 7, 0, 6.2832); }
    ctx.stroke();
  }
  return { bufs: r.bufs, handles: r.mode === 'poly' && r.handles };
}

/**
 * The machine preview curve from g.samples ({t0, dtMs, pos}: the planner's motion at its 1 ms tick), at device-pixel
 * resolution: every sample when they are fewer than the device columns, else each column's min and max in the order
 * they occur (a peak inside a column is never lost). Drawn as a soft band with a thin core so the script line on top
 * stays readable where the two agree. Where the script is dense (strokes under ~4 px apart) the curve would only fill
 * the lane: then only the misses show (drawMisses) and a note says so. Cost ~ the visible samples, no allocation once
 * the point buffer is sized.
 */
let mxy = new Float32Array(0);
export function drawMachine(ctx, w, h, view, g, nScript, T) {
  const sm = g.samples, P = sm.pos, n = P.length, dt = sm.dtMs, a = view.start, sc = (h - 2 * PAD) / 100;
  if (nScript * 4 > w) {
    const txt = 'machine preview: misses only';
    ctx.font = '9px ' + T.mono; ctx.textAlign = 'right';
    const tw = ctx.measureText(txt).width + 10;
    ctx.globalAlpha = 0.85; ctx.fillStyle = T.bg; ctx.fillRect(w - tw - 2, PAD + 1, tw, 13);
    ctx.globalAlpha = 0.9; ctx.fillStyle = T.machine; ctx.fillText(txt, w - 7, PAD + 10); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    return;
  }
  const dpr = Math.abs(ctx.getTransform().a) || 1, W = Math.ceil(w * dpr), k = w / view.span, Y = (p) => PAD + (100 - p) * sc;   // abs: the machine preview mirrors it on its left side (paw-gwmd)
  const idx = (t) => Math.max(0, Math.min(n - 1, Math.floor((t - sm.t0) / dt)));
  const i0 = idx(a), i1 = Math.min(n - 1, idx(a + view.span) + 1);
  if (i1 <= i0) return;
  if (mxy.length < 4 * W + 8) mxy = new Float32Array(4 * W + 8);
  let m = 0;
  const put = (x, y) => { mxy[m++] = x; mxy[m++] = y; };
  if (i1 - i0 <= W) for (let i = i0; i <= i1; i++) put((sm.t0 + i * dt - a) * k, Y(P[i]));
  else {
    const jOf = (c) => Math.max(i0, Math.min(i1 + 1, Math.ceil((a + c / (dpr * k) - sm.t0) / dt)));
    for (let c = 0, j = jOf(0); c < W; c++) {
      const e = jOf(c + 1);
      if (e <= j) continue;
      let lo = j, hi = j;
      for (let i = j + 1; i < e; i++) { if (P[i] < P[lo]) lo = i; else if (P[i] > P[hi]) hi = i; }
      const x = (c + 0.5) / dpr;
      if (lo < hi) { put(x, Y(P[lo])); put(x, Y(P[hi])); } else { put(x, Y(P[hi])); put(x, Y(P[lo])); }
      j = e;
    }
  }
  ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.strokeStyle = T.machine;
  for (const [lw, al] of [[3.5, 0.28], [1.1, 0.95]]) {   // band, then core; stroked in short runs (cheap on a software canvas)
    ctx.lineWidth = lw; ctx.globalAlpha = al; ctx.beginPath(); ctx.moveTo(mxy[0], mxy[1]);
    for (let q = 2, c = 0; q < m; q += 2) {
      ctx.lineTo(mxy[q], mxy[q + 1]);
      if (++c === 64) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(mxy[q], mxy[q + 1]); c = 0; }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Where the machine cannot follow, over the script: at each script point it misses (g.misses: the planner trimmed it,
 *  > 2 units short) a line from the commanded point to where the machine is then, with a tick there; where the plan
 *  left the window and was held at the edge (g.clamps), a bar along that edge. */
export function drawMisses(ctx, w, h, view, g, T) {
  const a = view.start, b = a + view.span, k = w / view.span, ms = g.misses || [], i0 = lowerBound(ms, a);
  ctx.setLineDash([]); ctx.fillStyle = T.warn; ctx.globalAlpha = 0.22;   // a soft wash: the gap reads against speed colours
  for (let i = i0; i < ms.length && ms[i].at <= b; i++) {
    const p = ms[i], x = Math.round((p.at - a) * k), y0 = posToY(h, p.pos), y1 = posToY(h, p.got);
    ctx.fillRect(x - 2, Math.min(y0, y1), 5, Math.abs(y1 - y0));
  }
  ctx.strokeStyle = T.warn; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.9; ctx.beginPath();
  for (let i = i0; i < ms.length && ms[i].at <= b; i++) {
    const p = ms[i], x = Math.round((p.at - a) * k) + 0.5, y = posToY(h, p.got);
    ctx.moveTo(x, posToY(h, p.pos)); ctx.lineTo(x, y); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
  }
  ctx.stroke();
  ctx.fillStyle = T.bad; ctx.globalAlpha = 0.85;
  for (const c of g.clamps || []) {
    if (c.t1 < a || c.t0 > b) continue;
    const x0 = Math.max(0, (c.t0 - a) * k), x1 = Math.min(w, (c.t1 - a) * k);
    ctx.fillRect(x0, c.edge === 'out' ? 0 : h - 2, Math.max(1, x1 - x0), 2);
  }
  ctx.globalAlpha = 1;
}

/** paw-g56v: the header bar's words, faint, top-left behind the curve: items in a row, a ghost's with its line swatch;
 *  whatever does not fit before the lane's buttons (right 132 px) is left out. */
function drawInfo(ctx, w, info, T) {
  ctx.save(); ctx.font = '10px ' + T.mono; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.5;
  let x = info.x;
  const y = 7, right = w - 132;
  for (const it of info.items) {
    const sw = it.dash != null ? 16 : 0, tw = ctx.measureText(it.text).width;
    if (x + sw + tw > right) break;
    if (sw) {
      ctx.strokeStyle = it.color || T.val; ctx.lineWidth = 2; ctx.setLineDash(it.dash ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + 12, y + 0.5); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = it.color && !sw ? it.color : T.mut; ctx.fillText(it.text, x + sw, y + 0.5);
    x += sw + tw + 12;
  }
  ctx.restore();
}

/** paw-g56v: the looped script wrapped into the out-of-range (geom.js loopWrap): dim and dashed, never handles, with the
 *  join across the boundary and a label saying it is a repeat. */
function drawWrap(ctx, w, h, view, wrap, color, dur, T) {
  const X = (t) => msToX(view, w, t);
  ctx.save(); ctx.font = '10px ' + T.mono; ctx.textBaseline = 'alphabetic';
  for (const [pts, label, t] of [[wrap.before, '↻ end of loop', 0], [wrap.after, '↻ start of loop', dur]]) {
    if (!pts?.length) continue;
    strokeScript(ctx, pts, view, w, h, { color, width: 1.5, dash: [5, 4], alpha: 0.75 }, null);
    const x = X(t), tw = ctx.measureText(label).width, before = t === 0, lx = before ? x - tw - 6 : x + 6;
    if (lx < 4 || lx + tw > w - 4) continue;
    ctx.globalAlpha = 0.85; ctx.fillStyle = T.bg; ctx.fillRect(lx - 3, h - 17, tw + 6, 14);
    ctx.globalAlpha = 1; ctx.fillStyle = T.val; ctx.fillText(label, lx, h - 6);
  }
  ctx.restore();
}

/** First k with arr[k] >= x (sorted numeric array). */
function lowerIdx(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

const fmtT = fmtTime;   // a point's time: the transport's form (paw-p8o2)
export { fmtT };

/**
 * Overlay layer. o = { theme, playhead, hover: {x, y, ring: [x,y]|null, lines: [str]}|null,
 *   box: {x0,y0,x1,y1, timeOnly}|null, tbox: {r: rect, hot: handleId|null}|null, guide: x|null, trail: [[x,y]]|null,
 *   drag: {x, y, lines}|null, recording: bool, rec: {x, y}|null }
 */
export function drawOverlay(ctx, w, h, o) {
  const T = o.theme;
  ctx.clearRect(0, 0, w, h);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (o.tbox) {
    const r = o.tbox.r;
    ctx.strokeStyle = T.hi; ctx.lineWidth = 1; ctx.globalAlpha = 0.55; ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(r.x0) + 0.5, Math.round(r.y0) + 0.5, Math.round(r.x1 - r.x0), Math.round(r.y1 - r.y0));
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
    const P = { nw: [r.x0, r.y0], n: [mx, r.y0], ne: [r.x1, r.y0], e: [r.x1, my], se: [r.x1, r.y1], s: [mx, r.y1], sw: [r.x0, r.y1], w: [r.x0, my] };
    for (const id in P) {
      const [x, y] = P[id], hot = o.tbox.hot === id, z = hot ? 4.5 : 3.5;
      ctx.fillStyle = hot ? T.hi : T.bg; ctx.strokeStyle = T.hi; ctx.lineWidth = 1.25;
      ctx.fillRect(Math.round(x - z), Math.round(y - z), z * 2, z * 2); ctx.strokeRect(Math.round(x - z) + 0.5, Math.round(y - z) + 0.5, z * 2 - 1, z * 2 - 1);
    }
  }
  if (o.depth) drawDepth(ctx, w, h, o.depth, T);
  if (o.box) {
    const b = o.box, x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
    const y0 = b.timeOnly ? 0 : Math.min(b.y0, b.y1), y1 = b.timeOnly ? h : Math.max(b.y0, b.y1);
    ctx.fillStyle = `rgba(${b.sub ? T.badRgb : T.realityRgb},.08)`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = `rgba(${b.sub ? T.badRgb : T.realityRgb},${b.sub ? .8 : .85})`; ctx.lineWidth = 1; ctx.setLineDash(b.timeOnly ? [] : [4, 2]);
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0)); ctx.setLineDash([]);
  }
  if (o.env) drawEnvelope(ctx, w, h, o.env, T);
  if (o.guide != null) { ctx.fillStyle = T.warn; ctx.globalAlpha = 0.8; ctx.fillRect(Math.round(o.guide), 0, 1, h); ctx.globalAlpha = 1; }
  if (o.trail && o.trail.length > 1) {
    ctx.strokeStyle = T.hi; ctx.lineWidth = 2; ctx.globalAlpha = 0.9; ctx.beginPath();
    ctx.moveTo(o.trail[0][0], o.trail[0][1]);
    for (let i = 1; i < o.trail.length; i++) ctx.lineTo(o.trail[i][0], o.trail[i][1]);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (o.hover?.el?.length > 1) {   // paw-5zpf: the element a click would take (selection modes 2-4)
    const p = o.hover.el;
    ctx.strokeStyle = T.hiTx; ctx.lineWidth = 4; ctx.globalAlpha = 0.45; ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (o.hover?.ring) {
    const [x, y] = o.hover.ring;
    ctx.strokeStyle = T.hiTx; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (o.hover?.cross) {
    ctx.fillStyle = T.line3; ctx.fillRect(Math.round(o.hover.x), 0, 1, h);
  }
  // playhead last so it is never covered
  if (o.playhead != null && o.playhead >= -1 && o.playhead <= w + 1) {
    ctx.fillStyle = o.recording ? T.hi : T.hi; ctx.fillRect(o.playhead - (o.recording ? 1 : 0.5), 0, o.recording ? 2 : 1, h);   // centred on its time, like every timeline row's playhead
  }
  if (o.rec) { ctx.fillStyle = T.hi; ctx.beginPath(); ctx.arc(o.rec.x, o.rec.y, 5, 0, 6.2832); ctx.fill(); }
  const tip = o.drag || o.hover;
  if (tip?.lines?.length) label(ctx, w, h, tip.x, tip.y, tip.lines, T, tip.thumb);
}

const ENV_N = 48;
const envX = new Float64Array(ENV_N + 1), envLo = new Float64Array(ENV_N + 1), envHi = new Float64Array(ENV_N + 1);   // scratch: no per-frame allocation
/**
 * Reachability envelope: env = {prev, next, view, limits} (prev/next {at,pos} or null). The band the device can be in
 * between the two neighbours, one Path2D per frame, shaded in the series colour; outside it a point cannot be reached in time.
 */
function drawEnvelope(ctx, w, h, env, T) {
  const { prev, next, view, limits } = env;
  if (!prev && !next) return;
  const t0 = Math.max(view.start, prev ? prev.at : view.start), t1 = Math.min(view.start + view.span, next ? next.at : view.start + view.span);
  if (!(t1 > t0)) return;
  let n = 0;
  for (let i = 0; i <= ENV_N; i++) {
    const t = t0 + ((t1 - t0) * i) / ENV_N, e = envelopeAt(prev, next, t, limits);
    if (e.hi < e.lo) continue;
    envX[n] = msToX(view, w, t); envLo[n] = posToY(h, e.lo); envHi[n] = posToY(h, e.hi); n++;
  }
  if (n < 2) return;
  const p = new Path2D();
  p.moveTo(envX[0], envHi[0]);
  for (let i = 1; i < n; i++) p.lineTo(envX[i], envHi[i]);
  for (let i = n - 1; i >= 0; i--) p.lineTo(envX[i], envLo[i]);
  p.closePath();
  ctx.fillStyle = T.reality; ctx.globalAlpha = 0.1; ctx.fill(p);
  ctx.strokeStyle = T.reality; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(p);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function label(ctx, w, h, x, y, lines, T, thumb = null) {
  ctx.font = '10px ' + T.mono;
  let tw = 0;
  for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
  const th = thumb ? Math.round(thumb.height * (Math.max(Math.ceil(tw) + 12, 96) / thumb.width)) : 0;   // frame scaled to the tip's width
  const bw = Math.max(Math.ceil(tw) + 12, thumb ? 96 : 0), bh = lines.length * 13 + 7 + th;
  let bx = x + 14, by = y - bh - 8;
  if (bx + bw > w - 2) bx = x - bw - 14;
  if (by < 2) by = Math.min(h - bh - 2, y + 16);
  ctx.globalAlpha = 0.94; ctx.fillStyle = T.overlay; ctx.fillRect(bx, by, bw, bh);
  if (thumb) { ctx.globalAlpha = 1; ctx.drawImage(thumb, bx, by, bw, th); by += th; }
  ctx.globalAlpha = 1; ctx.strokeStyle = T.line3; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = T.val;
  const tone = lines.tone === 'bad' ? T.bad : lines.tone === 'info' ? T.reality : T.val;
  lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? T.hiTx : i === 2 ? tone : T.val; ctx.fillText(l, bx + 6, by + 14 + i * 13); });
}

/**
 * Hover readout lines for action i (or a free point at t/pos). lim = {max, mode: 'hard'|'planner'} from the device
 * profile: a speed over max marks the speed line (lines.tone): 'bad' under hard limits, 'info' when a planner
 * reshapes the motion anyway.
 */
export function readout(script, i, t, pos, fms, lim = null) {
  let lines, top = 0;
  if (i >= 0) {
    const a = script[i], p = script[i - 1], n = script[i + 1];
    const si = p ? Math.round((Math.abs(a.pos - p.pos) * 1000) / (a.at - p.at)) : null, so = n ? Math.round((Math.abs(n.pos - a.pos) * 1000) / (n.at - a.at)) : null;
    top = Math.max(si ?? 0, so ?? 0);
    lines = [`${fmtT(a.at)}  f${frameOf(a.at, fms)}`, `pos ${a.pos}` + (si != null || so != null ? `  in ${si ?? '–'} · out ${so ?? '–'} /s` : '')];
  } else {
    const k = lowerBound(script, t);
    lines = [`${fmtT(t)}  f${frameOf(t, fms)}`, `pos ${Math.round(pos)}`];
    if (k > 0 && k < script.length) { const a = script[k - 1], b = script[k]; top = Math.round((Math.abs(b.pos - a.pos) * 1000) / (b.at - a.at)); lines[1] += `  seg ${top} /s`; }
  }
  return withLimit(lines, top, lim);
}
function withLimit(lines, speed, lim) {
  if (!lim?.max || !(speed > lim.max)) return lines;
  if (lim.mode === 'planner') { lines.push(`over ${Math.round(lim.max)} /s: the planner reshapes it`); lines.tone = 'info'; }
  else { lines.push(`over the device limit ${Math.round(lim.max)} /s`); lines.tone = 'bad'; }
  return lines;
}
