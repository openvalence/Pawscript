// draw.js -- the Machine panel's canvas: a top-down view of the rail, the carriage with the toy at real scale (its
// side-profile picture when it has one, else its outline), the hole at the top in the character's body silhouette,
// lips coloured by strain, a depth ruler, a mm scale bar and the strain trace. Depth runs UP the panel.
import { hexToRgb } from '../../ui/kit/color.js';
import { radiusAt, maxRadius } from './toys.js';
import { depthOf } from './physics.js';

export const TRACE_H = 44;   // px of the strain trace strip at the bottom

/** Theme colours for the canvas, read through get(name) (kit cssVar). */
export function readColors(get) {
  const c = {};
  for (const k of ['bg', 'bg-sunken', 'bg-raised', 'bg-card', 'line-1', 'line-2', 'line-3', 'line-4', 'tx', 'tx-mut', 'tx-faint', 'accent', 'ok', 'warn', 'bad', 'series-violet', 'series-sky', 'font', 'mono'])
    c[k] = get('--' + k);
  return c;
}

const rgb = (s) => { try { return hexToRgb(s); } catch { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128]; } };
const mix = (a, b, f) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',')})`; };
/** Strain -> colour: ok up to 0.5, ok->warn to 1, warn->bad to 1.5. */
export function strainColor(C, s) {
  if (!(s > 0.5)) return C.ok;
  if (s < 1) return mix(C.ok, C.warn, (s - 0.5) / 0.5);
  return mix(C.warn, C.bad, Math.min(1, (s - 1) / 0.5));
}

/** Geometry for a canvas of w x h CSS px: scale k (px/mm), the rail's x, the ring's y, y(depth). Stable while the
 *  toy and the rig stay (it never follows the motion). */
export function layout(w, h, toy, rig) {
  const L = toy.length_mm, deep = Math.min(rig.offsetMm + rig.strokeMm, toy.usable_mm || L);
  const top = Math.max(deep, 0) + 30, bottom = Math.max(0, L - rig.offsetMm) + 40;
  const wide = Math.max(2.4 * maxRadius(toy), 70);
  const k = Math.max(0.2, Math.min((h - TRACE_H - 14) / (top + bottom), (w - 120) / wide));
  const yRing = 6 + top * k, x = Math.round(w / 2 - 6);
  return { k, x, yRing, y: (d) => yRing - d * k, w, h, top, bottom };
}

/** Rig handles in canvas px: out = the carriage at pos 100, deep = at pos 0 (the base's y). */
export function handles(G, toy, rig) {
  const L = toy.length_mm, hx = G.x + Math.max(40, maxRadius(toy) * 1.3 * G.k) + 18;
  return { x: hx, out: G.y(depthOf(rig, 100) - L), deep: G.y(Math.min(depthOf(rig, 0), toy.usable_mm || L) - L) };
}

const parts = new Map();
/** A character path split into its sub-paths (cached per path string). */
function bodyParts(d) {
  if (!parts.has(d)) parts.set(d, d.split(/(?=M )/).map((x) => new Path2D(x)));
  return parts.get(d);
}

/** Outline edges [left, right] (mm, about the centreline) at s mm from the tip. */
function edgesAt(toy, s) {
  const o = toy.outline;
  if (!o) { const r = radiusAt(toy, s); return [-r, r]; }
  if (s <= 0) return [o[0][1], o[0][2]];
  const i = Math.min(o.length - 2, Math.floor((s / toy.length_mm) * (o.length - 1))), f = Math.min(1, (s - o[i][0]) / (o[i + 1][0] - o[i][0] || 1));
  return [o[i][1] + (o[i + 1][1] - o[i][1]) * f, o[i][2] + (o[i + 1][2] - o[i][2]) * f];
}

function toyPath(toy, G, d) {
  const p = new Path2D(), n = 90, L = toy.length_mm;
  const pt = (s, side) => { const e = edgesAt(toy, s); return [G.x + e[side] * G.k, G.y(d - s)]; };
  for (let i = 0; i <= n; i++) { const [x, y] = pt((i / n) * L, 0); i ? p.lineTo(x, y) : p.moveTo(x, y); }
  for (let i = n; i >= 0; i--) { const [x, y] = pt((i / n) * L, 1); p.lineTo(x, y); }
  p.closePath();
  return p;
}

/** Draw the toy: the picture box spans tip -> base (pic.top / bottom), centreline at pic.cx. */
function drawToy(g, toy, img, G, d, C) {
  const L = toy.length_mm;
  if (img && toy.pic && img.complete && img.naturalWidth) {
    const H = L / (toy.pic.bottom - toy.pic.top), W = toy.pic.aspect * L;   // aspect = picture width / toy height in px
    const yTip = G.y(d), top = yTip - toy.pic.top * H * G.k;
    g.drawImage(img, G.x - toy.pic.cx * W * G.k, top, W * G.k, H * G.k);
  } else {
    g.fillStyle = C['series-violet']; g.globalAlpha *= 0.85; g.fill(toyPath(toy, G, d)); g.globalAlpha /= 0.85;
  }
}

/**
 * One frame. f = {toy, img, rig, char: {path}, state: {a, r, strain, knot}, depth, lipShift (mm, + = dragged in),
 * trace: {t0, every, values}, t, knot: {from_mm, peak_mm, to_mm} | null, hover: 'out'|'deep'|null}
 */
export function drawFrame(g, G, f, C) {
  const { toy, rig, state: s } = f, L = toy.length_mm, k = G.k, d = f.depth;
  g.clearRect(0, 0, G.w, G.h);
  g.fillStyle = C['bg-sunken']; g.fillRect(0, 0, G.w, G.h - TRACE_H);
  const sc = strainColor(C, s.strain);

  // rail and carriage
  const railW = Math.max(6, 16 * k), yRail0 = G.yRing + 12 * k, yRail1 = G.h - TRACE_H - 4;
  g.fillStyle = C['bg-raised']; g.strokeStyle = C['line-2']; g.lineWidth = 1;
  g.fillRect(G.x - railW / 2, yRail0, railW, yRail1 - yRail0); g.strokeRect(G.x - railW / 2 + 0.5, yRail0 + 0.5, railW - 1, yRail1 - yRail0 - 1);
  g.strokeStyle = C['line-3']; g.beginPath(); g.moveTo(G.x + 0.5, yRail0); g.lineTo(G.x + 0.5, yRail1); g.stroke();
  const yBase = G.y(d - L), carW = Math.max(40, maxRadius(toy) * 2.2) * k, carH = 22 * k;
  g.fillStyle = C['line-2']; g.strokeStyle = C['line-4'];
  g.beginPath(); g.roundRect(G.x - carW / 2, yBase - 2, carW, carH, 3 * k); g.fill(); g.stroke();

  // the stroke range and its handles
  const H = handles(G, toy, rig);
  g.strokeStyle = C['line-4']; g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(H.x + 0.5, H.out); g.lineTo(H.x + 0.5, H.deep); g.stroke(); g.setLineDash([]);
  for (const [key, y] of [['out', H.out], ['deep', H.deep]]) {
    g.fillStyle = f.hover === key ? C.accent : C['bg-raised']; g.strokeStyle = f.hover === key ? C.accent : C['tx-mut'];
    g.beginPath(); g.moveTo(H.x - 7, y); g.lineTo(H.x + 7, y); g.stroke();
    g.beginPath(); g.arc(H.x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.fillStyle = C['tx-mut']; g.font = `11px ${C.font || 'sans-serif'}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText('out', H.x + 9, H.out); g.fillText('deep', H.x + 9, H.deep);
  g.fillText(`${Math.round(rig.strokeMm)} mm`, H.x + 9, (H.out + H.deep) / 2);

  // the toy, whole, then the body over its inside part, then the inside part as a ghost
  drawToy(g, toy, f.img, G, d, C);
  g.save();
  g.translate(G.x, G.yRing); g.scale(k, k);
  // each sub-path filled on its own (a tail over the back must not punch a hole), then all outlined
  g.fillStyle = C['bg-card'] || C['bg-raised']; g.lineWidth = 1.2 / k; g.strokeStyle = C['line-3'];
  for (const part of bodyParts(f.char.path)) g.fill(part);
  for (const part of bodyParts(f.char.path)) g.stroke(part);
  g.restore();
  if (d > 0) {
    g.save();
    g.beginPath(); g.rect(0, 0, G.w, G.yRing); g.clip();
    g.globalAlpha = 0.28; drawToy(g, toy, f.img, G, d, C); g.globalAlpha = 1;
    // canal walls hugging the toy inside, fading with depth past the ring
    const depthIn = Math.min(d, 60);
    for (const side of [0, 1]) {
      g.beginPath();
      for (let i = 0; i <= 30; i++) {
        const x = (i / 30) * depthIn, e = edgesAt(toy, d - x), r = e[side] + (side ? 1.2 : -1.2);
        const px = G.x + r * k, py = G.yRing - x * k;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      const grad = g.createLinearGradient(0, G.yRing, 0, G.yRing - depthIn * k);
      grad.addColorStop(0, sc); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.strokeStyle = grad; g.lineWidth = 2; g.stroke();
    }
    g.restore();
  }

  // the hole: lips at the aperture, around the toy's centreline at the ring, dragged along with the motion
  const e = s.r > 0 ? edgesAt(toy, Math.min(d, L)) : [-1, 1], mid = (e[0] + e[1]) / 2;
  const a = Math.max(s.a, s.r), lipR = Math.max(3, 5 * k), yl = G.yRing - (f.lipShift || 0) * k;
  g.fillStyle = sc; g.strokeStyle = C['line-4'];
  for (const sx of [-1, 1]) {
    const x = G.x + (mid + sx * a) * k + sx * lipR * 0.6;
    g.beginPath(); g.ellipse(x, yl, lipR * 1.1, lipR * 0.8, 0, 0, Math.PI * 2); g.fill();
    // the rim of the body edge out to the lip
    g.beginPath(); g.moveTo(x + sx * lipR, yl); g.quadraticCurveTo(x + sx * lipR * 3, G.yRing, x + sx * lipR * 5, G.yRing + 1); g.lineWidth = 2; g.strokeStyle = sc; g.stroke();
  }
  // knot marker on the toy (the widest point)
  if (f.knot) {
    const yk = G.y(d - f.knot.peak_mm), ek = edgesAt(toy, f.knot.peak_mm);
    g.strokeStyle = C.accent; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(G.x + ek[0] * k - 8, yk); g.lineTo(G.x + ek[0] * k - 3, yk); g.stroke();
    g.beginPath(); g.moveTo(G.x + ek[1] * k + 3, yk); g.lineTo(G.x + ek[1] * k + 8, yk); g.stroke();
  }

  // depth ruler up from the ring (left), mm scale bar (bottom left)
  const rx = 22;
  g.strokeStyle = C['line-3']; g.fillStyle = C['tx-faint']; g.lineWidth = 1; g.textAlign = 'right'; g.font = `10px ${C.mono || 'monospace'}`;
  g.beginPath(); g.moveTo(rx + 0.5, G.yRing); g.lineTo(rx + 0.5, Math.max(4, G.y(G.top - 10))); g.stroke();
  for (let mm = 0; mm <= G.top - 10; mm += 10) {
    const y = Math.round(G.y(mm)) + 0.5, big = mm % 50 === 0;
    g.beginPath(); g.moveTo(rx, y); g.lineTo(rx + (big ? 7 : 4), y); g.stroke();
    if (big && mm) { g.textAlign = 'left'; g.fillText(String(mm), rx + 9, y); }
  }
  g.textAlign = 'left'; g.fillText('0', rx + 9, G.yRing);
  const bar = [10, 20, 50, 100].find((v) => v * k >= 40) || 100, by = G.h - TRACE_H - 12;
  g.strokeStyle = C['tx-mut']; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, by); g.lineTo(10 + bar * k, by); g.stroke();
  g.lineWidth = 1; g.beginPath(); g.moveTo(10.5, by - 4); g.lineTo(10.5, by + 4); g.moveTo(10.5 + bar * k, by - 4); g.lineTo(10.5 + bar * k, by + 4); g.stroke();
  g.fillStyle = C['tx-mut']; g.textBaseline = 'bottom'; g.fillText(`${bar} mm`, 12, by - 4); g.textBaseline = 'middle';

  drawTrace(g, G, f.trace, C);
}

/** Strain over the trace window, coloured per bucket; the dashed line is strain 1 (full). */
function drawTrace(g, G, tr, C) {
  const y0 = G.h - TRACE_H, h = TRACE_H - 14, top = y0 + 10;
  g.fillStyle = C.bg; g.fillRect(0, y0, G.w, TRACE_H);
  g.strokeStyle = C['line-1']; g.beginPath(); g.moveTo(0, y0 + 0.5); g.lineTo(G.w, y0 + 0.5); g.stroke();
  g.fillStyle = C['tx-faint']; g.font = `10px ${C.font || 'sans-serif'}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('strain, last 10 s', 6, y0 + 2);
  const yv = (v) => top + h - Math.min(1.5, v) / 1.5 * h;
  g.strokeStyle = C['line-3']; g.setLineDash([2, 3]);
  g.beginPath(); g.moveTo(0, Math.round(yv(1)) + 0.5); g.lineTo(G.w, Math.round(yv(1)) + 0.5); g.stroke(); g.setLineDash([]);
  if (!tr) return;
  const n = tr.values.length, bw = G.w / n;
  for (let i = 0; i < n; i++) {
    const v = tr.values[i];
    if (!(v > 0.01)) continue;
    g.fillStyle = strainColor(C, v);
    g.fillRect(i * bw, yv(v), Math.max(1, bw - 0.5), top + h - yv(v));
  }
}

/** The 3D view's strip under the scene: the strain trace (top, last 10 s) and the knot events over the visible
 *  timeline range (bottom): a hollow dot where a rigid toy would have knotted / popped (the carriage), a filled dot
 *  where the silicone toy really did, joined; a cross for a failed knot (and a dashed line to when it gave up). */
export function drawStrip(g, w, h, tr, events, view, t, C) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
  const th = Math.round(h * 0.55), top = 12, ph = th - top - 2;
  g.fillStyle = C['tx-faint']; g.font = `10px ${C.font || 'sans-serif'}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('strain, last 10 s', 6, 1);
  const yv = (v) => top + ph - (Math.min(1.5, v) / 1.5) * ph;
  g.strokeStyle = C['line-3']; g.setLineDash([2, 3]);
  g.beginPath(); g.moveTo(0, Math.round(yv(1)) + 0.5); g.lineTo(w, Math.round(yv(1)) + 0.5); g.stroke(); g.setLineDash([]);
  if (tr) {
    const n = tr.values.length, bw = w / n;
    for (let i = 0; i < n; i++) { const v = tr.values[i]; if (v > 0.01) { g.fillStyle = strainColor(C, v); g.fillRect(i * bw, yv(v), Math.max(1, bw - 0.5), top + ph - yv(v)); } }
  }
  // events over the visible range
  const y = th + (h - th) / 2 + 4, x = (ms) => ((ms - view.start) / view.span) * w;
  g.strokeStyle = C['line-1']; g.beginPath(); g.moveTo(0, th + 0.5); g.lineTo(w, th + 0.5); g.stroke();
  g.fillStyle = C['tx-faint']; g.fillText('knots in view: o rigid  * real  x failed   bends: \u25B2 passed  \u25B3 stalled   bar: hilted', 6, th + 2);
  for (const e of events || []) {
    const x0 = x(e.tRigid), x1 = x(e.t);
    if (e.kind === 'limit') {   // the machine at its force limit: a calm grey bar along the bottom (normal operation)
      if (x1 < -10 || x0 > w + 10) continue;
      g.fillStyle = C['tx-faint']; g.fillRect(x0, h - 2, Math.max(1, x1 - x0), 2);
      continue;
    }
    if (e.kind === 'hilt') {   // the base pressed against the body: a short bar at the top of the lane with its peak force
      if (x1 < -10 || x0 > w + 10) continue;
      g.fillStyle = C['tx-mut']; g.fillRect(x0, th + 13, Math.max(2, x1 - x0), 3);
      if (x1 - x0 > 26) { g.fillStyle = C['tx-faint']; g.fillText(`hilt ${Math.round(e.peak)} N`, x0 + 2, th + 17); }
      continue;
    }
    if (e.kind === 'bend' || e.kind === 'bendstall') {   // depth: a triangle, pass (forced = red) or stall (hollow)
      if (x1 < -10 || x0 > w + 10) continue;
      const yy = h - 4, col = e.kind === 'bendstall' ? C.bad : e.forced ? C.bad : C.ok, xx = e.kind === 'bend' ? x1 : x0;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke();
      g.beginPath(); g.moveTo(xx, yy - 6 + (e.bend ? 0 : 2)); g.lineTo(xx - 3.5, yy); g.lineTo(xx + 3.5, yy); g.closePath();
      if (e.kind === 'bend') g.fill(); else g.stroke();
      continue;
    }
    if (x1 < -10 || x0 > w + 10) continue;
    const col = e.kind === 'in' ? C.accent : e.kind === 'pop' ? C.warn : C.bad, yy = e.kind === 'pop' || e.kind === 'popfail' ? y + 5 : y - 3;
    g.strokeStyle = col; g.lineWidth = 1.2;
    if (e.kind === 'fail' || e.kind === 'popfail') g.setLineDash([2, 2]);
    g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); g.setLineDash([]);
    if (e.kind === 'fail' || e.kind === 'popfail') {
      g.beginPath(); g.moveTo(x0 - 3, yy - 3); g.lineTo(x0 + 3, yy + 3); g.moveTo(x0 + 3, yy - 3); g.lineTo(x0 - 3, yy + 3); g.stroke();
    } else {
      g.beginPath(); g.arc(x0, yy, 2.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(x1, yy, 2.5, 0, Math.PI * 2); g.fill();
    }
  }
  const px = x(t);
  if (px >= 0 && px <= w) { g.strokeStyle = C.tx; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(px) + 0.5, th); g.lineTo(Math.round(px) + 0.5, h); g.stroke(); }
}
