// camera.js -- the Machine view's turntable camera (pure maths, Blender-like): it orbits a pivot (the opening unless
// panned) about the world up axis (z) with no roll, elevation clamped short of the poles; the view is framed so the
// whole stroke (carriage out to deep) fits with the opening in the upper third (a lens shift, so orbiting still pivots
// on the opening). State {az, el (degrees), zoom (x the auto framing), pan [x, y, z] mm, shift (ndc)}; persisted.
import { mul, perspective, lookAt, norm, cross } from './gl3d.js';

export const FOV = 0.52;   // vertical field of view, rad (~30 deg: little perspective distortion, sizes read true)
export const EL_MIN = -80, EL_MAX = 89;   // degrees: never quite at the poles, so up stays defined
export const PRESETS = Object.freeze({
  top: { az: 0, el: 89 },       // looking down on the rail: depth runs up the screen (the default)
  front: { az: 0, el: 4 },      // from the machine, into the opening
  side: { az: 90, el: 4 },
  quarter: { az: 38, el: 28 },
  // under the body looking up at the belly (the bulge), and from below at three-quarters; centred on the lower
  // abdomen (pan, mm at 175 cm: the panel scales it with the height) and closer in, no lens shift
  below: { az: 0, el: -80, zoom: 1.8, pan: [0, 190, -60], shift: 0 },
  quarterBelow: { az: -40, el: -32, zoom: 1.6, pan: [0, 190, -60], shift: 0 },   // from the receiver's left: the sigmoid's side
});
export const DEFAULT_CAM = Object.freeze({ az: PRESETS.top.az, el: PRESETS.top.el, zoom: 1, pan: [0, 0, 0], shift: 1 / 3 });

const rad = (d) => (d * Math.PI) / 180;
const clampEl = (e) => Math.max(EL_MIN, Math.min(EL_MAX, e));

/** Distance at zoom 1 that fits the extent's key points inside the canvas for this camera angle (any aspect, any
 *  preset: in Side the rail runs across the screen, in Top up it). Bisection on the projected bounds. */
export function fitDist(cam, { lo, hi, halfWidth }, w, h, margin = 0.92) {
  const pts = [[0, lo, 0], [0, hi, 0], [halfWidth, (lo + hi) / 2, 0], [-halfWidth, (lo + hi) / 2, 0], [0, (lo + hi) / 2, halfWidth * 0.7], [0, (lo + hi) / 2, -halfWidth * 0.7]];
  const c = { ...cam, zoom: 1, pan: [0, 0, 0] };
  const ok = (d) => { const v = viewOf(c, d, w, h); return pts.every((q) => { const x = v.vp[0] * q[0] + v.vp[4] * q[1] + v.vp[8] * q[2] + v.vp[12], y = v.vp[1] * q[0] + v.vp[5] * q[1] + v.vp[9] * q[2] + v.vp[13], ww = v.vp[3] * q[0] + v.vp[7] * q[1] + v.vp[11] * q[2] + v.vp[15]; return ww > 0 && Math.abs(x / ww) <= margin && Math.abs(y / ww) <= margin; }); };
  let a = 30, b = 30000;
  if (ok(a)) return a;
  for (let i = 0; i < 32; i++) { const m = Math.sqrt(a * b); if (ok(m)) b = m; else a = m; }
  return b;
}

/** The view for a camera state on a w x h canvas -> {vp, eye, dir, right, up, hh (half height at the pivot, mm)}. */
export function viewOf(cam, base, w, h) {
  const aspect = w / Math.max(1, h), dist = base / Math.max(0.05, cam.zoom), el = rad(clampEl(cam.el)), az = rad(cam.az);
  const pivot = cam.pan, dir = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const eye = [pivot[0] + dir[0] * dist, pivot[1] + dir[1] * dist, pivot[2] + dir[2] * dist];
  const proj = perspective(FOV, aspect, Math.max(2, dist / 60), dist * 8);
  proj[9] -= cam.shift || 0;   // lens shift: the pivot sits `shift` ndc above the centre
  const view = lookAt(eye, pivot, [0, 0, 1]);
  const right = norm(cross([0, 0, 1], dir)), up = cross(dir, right);
  return { vp: mul(proj, view), eye, dir, right, up, dist, hh: dist * Math.tan(FOV / 2), aspect };
}

export const orbit = (cam, dx, dy) => ({ ...cam, az: cam.az - dx * 0.45, el: clampEl(cam.el + dy * 0.45) });

/** Pan by a pointer move of (dx, dy) px on a w x h canvas: the pivot moves in the view plane. */
export function pan(cam, v, dx, dy, w, h) {
  const sx = ((2 * v.hh * v.aspect) / w) * dx, sy = ((2 * v.hh) / h) * dy;
  return { ...cam, pan: cam.pan.map((p, i) => p - v.right[i] * sx + v.up[i] * sy) };
}

/** Zoom by factor f (> 1 = closer) toward the point under the pointer at (nx, ny) in ndc. */
export function zoomAt(cam, v, f, nx, ny) {
  const z = Math.max(0.25, Math.min(12, cam.zoom * f)), k = cam.zoom / z;   // the new distance over the old
  const P = cam.pan.map((p, i) => p + v.right[i] * nx * v.hh * v.aspect + v.up[i] * (ny - (cam.shift || 0)) * v.hh);
  return { ...cam, zoom: z, pan: cam.pan.map((p, i) => P[i] + (p - P[i]) * k) };
}

const ease = (t) => 1 - (1 - t) ** 3;
/** Between two camera states (azimuth the short way round), t in 0..1, eased. */
export function blend(a, b, t) {
  const e = ease(Math.max(0, Math.min(1, t)));
  let daz = ((b.az - a.az) % 360 + 540) % 360 - 180;
  const lerp = (x, y) => x + (y - x) * e;
  return { az: a.az + daz * e, el: lerp(a.el, b.el), zoom: lerp(a.zoom, b.zoom), shift: lerp(a.shift ?? 0, b.shift ?? 0), pan: a.pan.map((p, i) => lerp(p, b.pan[i])) };
}

/** A stored camera made safe (settings can hold anything). */
export function validCam(c) {
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  if (!c || typeof c !== 'object') return { ...DEFAULT_CAM, pan: [0, 0, 0] };
  return { az: n(c.az, 0), el: clampEl(n(c.el, 89)), zoom: Math.max(0.25, Math.min(12, n(c.zoom, 1))), shift: n(c.shift, DEFAULT_CAM.shift),
    pan: Array.isArray(c.pan) && c.pan.length === 3 && c.pan.every(Number.isFinite) ? c.pan : [0, 0, 0] };
}

/** The view with the scene turned by th (rad) about x through the opening (paw-3562): the simulation's frame (the rail
 *  along y) drawn so the body stands level on its floor and the rail shows its angle against it. The camera (orbit,
 *  pan, zoom, presets) stays the floor's; eye / dir / right / up come back in the frame for the lighting. */
export function tiltView(v, th) {
  if (!th) return v;
  const c = Math.cos(th), s = Math.sin(th), R = Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
  const back = (p) => [p[0], c * p[1] + s * p[2], -s * p[1] + c * p[2]];
  return { ...v, vp: mul(v.vp, R), eye: back(v.eye), dir: back(v.dir), right: back(v.right), up: back(v.up), tilt: th };
}
