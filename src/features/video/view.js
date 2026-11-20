// view.js -- pure transform maths for the video stage: fit / fill / 100 % / custom zoom, pan, quarter-turn
// rotation and flips, as one affine matrix from video pixels to stage CSS pixels. The <video> element (sized to
// its intrinsic pixels, transform-origin 0 0) and the overlay canvas use the same matrix, so overlays stay glued.
// 100 % means one video pixel per device pixel (the only pixel-crisp scale on a HiDPI screen).

export const DEFAULT_VIEW = { mode: 'fit', zoom: 1, panX: 0, panY: 0, rot: 0, flipH: false, flipV: false };
export const MIN_ZOOM = 0.05, MAX_ZOOM = 32;

const COS = { 0: 1, 90: 0, 180: -1, 270: 0 }, SIN = { 0: 0, 90: 1, 180: 0, 270: -1 };
const norm = (r) => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

/** Size of the video after rotation, in video pixels. */
export const rotatedSize = (view, vw, vh) => (norm(view.rot) % 180 ? [vh, vw] : [vw, vh]);

/** CSS px per video px for the view's mode. */
export function scaleOf(view, cw, ch, vw, vh, dpr = 1) {
  const [rw, rh] = rotatedSize(view, vw, vh);
  if (!(rw > 0 && rh > 0 && cw > 0 && ch > 0)) return 1;
  if (view.mode === 'fit') return Math.min(cw / rw, ch / rh);
  if (view.mode === 'fill') return Math.max(cw / rw, ch / rh);
  if (view.mode === '1:1') return 1 / dpr;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom)) / dpr;
}

/**
 * {a,b,c,d,e,f, s} with x' = a·x + c·y + e, y' = b·x + d·y + f (CSS / canvas matrix order). The video's
 * on-screen bounding box is snapped to whole device pixels so 100 % (and integer zooms) stay crisp.
 */
export function viewMatrix(view, cw, ch, vw, vh, dpr = 1) {
  const s = scaleOf(view, cw, ch, vw, vh, dpr), r = norm(view.rot);
  const fx = view.flipH ? -1 : 1, fy = view.flipV ? -1 : 1, cos = COS[r], sin = SIN[r];
  const a = s * cos * fx, b = s * sin * fx, c = -s * sin * fy, d = s * cos * fy;
  const pan = view.mode === 'fit' || view.mode === 'fill' ? [0, 0] : [view.panX || 0, view.panY || 0];
  const cx = cw / 2 + pan[0], cy = ch / 2 + pan[1];
  const [rw, rh] = rotatedSize(view, vw, vh);
  const left = cx - (s * rw) / 2, top = cy - (s * rh) / 2;
  const sx = Math.round(left * dpr) / dpr - left, sy = Math.round(top * dpr) / dpr - top;
  return { a, b, c, d, e: cx - (a * vw + c * vh) / 2 + sx, f: cy - (b * vw + d * vh) / 2 + sy, s };
}

/** m with the picture moved by (dx, dy) video px first (the stabilised preview): the overlays follow, they map through m. */
export const shifted = (m, dx, dy) => (dx || dy ? { ...m, e: m.e + m.a * dx + m.c * dy, f: m.f + m.b * dx + m.d * dy } : m);
/** m with the camera taken out of the picture first (the stabilised preview, paw-a3n): st = {x, y (frame widths / heights),
 *  s (zoom), th (rotation, radians)} of the camera, removed about the frame centre: P -> c + R(-th) (P - c - d) / s.
 *  Translation only (s 1, th 0) = shifted(m, -x * vw, -y * vh). */
export function stabilised(m, st, vw, vh) {
  if (!st) return m;
  const s = st.s || 1, th = st.th || 0;
  if (s === 1 && !th) return shifted(m, -st.x * vw, -st.y * vh);
  const co = Math.cos(th) / s, si = Math.sin(th) / s, cx = vw / 2, cy = vh / 2, px = cx + st.x * vw, py = cy + st.y * vh;
  const A = [co, -si, si, co], bx = cx - (co * px + si * py), by = cy - (-si * px + co * py);   // A = [[co, si], [-si, co]] column-major as a, b, c, d
  return { ...m, a: m.a * A[0] + m.c * A[1], b: m.b * A[0] + m.d * A[1], c: m.a * A[2] + m.c * A[3], d: m.b * A[2] + m.d * A[3], e: m.e + m.a * bx + m.c * by, f: m.f + m.b * bx + m.d * by };
}

export const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

/** Stage CSS px -> video px. */
export function invert(m, X, Y) {
  const det = m.a * m.d - m.b * m.c, x = X - m.e, y = Y - m.f;
  return [(m.d * x - m.c * y) / det, (-m.b * x + m.a * y) / det];
}

/** Stage CSS px -> normalised 0..1 video coordinates (unclamped). */
export function toNorm(m, vw, vh, X, Y) { const [x, y] = invert(m, X, Y); return [x / vw, y / vh]; }
/** Normalised 0..1 video coordinates -> stage CSS px. */
export const fromNorm = (m, vw, vh, nx, ny) => apply(m, nx * vw, ny * vh);

/** Zoom % as shown to the user (100 = one video px per device px). */
export const zoomPercent = (m, dpr = 1) => m.s * dpr * 100;

/** Keeps at least `keep` px of the video on stage. */
export function clampPan(view, cw, ch, vw, vh, dpr = 1, keep = 48) {
  const s = scaleOf(view, cw, ch, vw, vh, dpr), [rw, rh] = rotatedSize(view, vw, vh);
  const mx = Math.max(0, (cw + s * rw) / 2 - keep), my = Math.max(0, (ch + s * rh) / 2 - keep);
  return { ...view, panX: Math.max(-mx, Math.min(mx, view.panX || 0)), panY: Math.max(-my, Math.min(my, view.panY || 0)) };
}

/** The view zoomed by `factor` keeping the stage point (px, py) over the same video pixel. */
export function zoomAround(view, cw, ch, vw, vh, px, py, factor, dpr = 1) {
  const s = scaleOf(view, cw, ch, vw, vh, dpr);
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s * dpr * factor)), f = z / (s * dpr);
  const pan = view.mode === 'fit' || view.mode === 'fill' ? [0, 0] : [view.panX || 0, view.panY || 0];
  const qx = px - cw / 2 - pan[0], qy = py - ch / 2 - pan[1];
  return clampPan({ ...view, mode: 'custom', zoom: z, panX: px - cw / 2 - qx * f, panY: py - ch / 2 - qy * f }, cw, ch, vw, vh, dpr);
}

/** The view panned by (dx, dy) CSS px; fit/fill become a custom view at the same scale. */
export function panView(view, cw, ch, vw, vh, dx, dy, dpr = 1) {
  const s = scaleOf(view, cw, ch, vw, vh, dpr);
  const base = view.mode === 'custom' || view.mode === '1:1' ? view : { ...view, mode: 'custom', zoom: s * dpr, panX: 0, panY: 0 };
  return clampPan({ ...base, panX: (base.panX || 0) + dx, panY: (base.panY || 0) + dy }, cw, ch, vw, vh, dpr);
}

/** Quarter turn clockwise (dir 1) or anticlockwise (-1). */
export const rotateView = (view, dir = 1) => ({ ...view, rot: norm(view.rot + 90 * dir) });
