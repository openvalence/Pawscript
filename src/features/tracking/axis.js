// axis.js -- the stroke axis: one arrow drawn on the video, from the OUT end (x0, y0) to the IN end (x1, y1), in
// normalised 0..1 frame coords (trackers/README.md: moving toward (x1, y1) = lower pos, pos 0 = deepest).
// Pure parts (node-tested, test/tracking-axis.test.mjs): axisOk, axisInfo, axisParams, axisTool. drawAxis paints.

export const AXIS_MODES = ['auto', 'vertical', 'horizontal', 'custom'];
export const AXIS_KEYS = ['axis', 'axis_x0', 'axis_y0', 'axis_x1', 'axis_y1'];
const inUnit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** A usable arrow: four coords in 0..1 and not a point. */
export const axisOk = (a) => !!a && [a.x0, a.y0, a.x1, a.y1].every(inUnit) && (a.x0 !== a.x1 || a.y0 !== a.y1);
/** A clean copy (4 decimals) or null. */
export const axisClean = (a) => (axisOk(a) ? { x0: r4(a.x0), y0: r4(a.y0), x1: r4(a.x1), y1: r4(a.y1) } : null);

/** Angle (degrees, screen counter-clockwise from horizontal, of out -> in) and length (frame heights). aspect = w / h. */
export function axisInfo(a, aspect = 16 / 9) {
  if (!axisOk(a)) return null;
  const dx = (a.x1 - a.x0) * aspect, dy = a.y1 - a.y0;
  return { angle: Math.round((Math.atan2(-dy, dx) * 180) / Math.PI) || 0, length: Math.hypot(dx, dy) };
}

/**
 * Tracker params for the stroke axis. schema = the tracker's PARAM list, mode = '' (tracker default) | auto |
 * vertical | horizontal | custom, axis = the drawn arrow, current = the params about to be sent.
 * -> a patch ({} when the tracker has no `axis` param, or nothing applies).
 *  custom + a tracker with a custom axis: axis_x0..y1 from the arrow, and `primary: 'proj'` if that is a choice and
 *  primary is still at its default. custom + a tracker without one (lk_box: up / right = higher): the nearer of
 *  vertical / horizontal, with pipe_invert toggled when the arrow points up / right (toward the in end must be lower).
 */
export function axisParams(schema, mode, axis, current = {}, aspect = 1) {
  const by = Object.fromEntries((schema || []).map((p) => [p.key, p]));
  const choices = by.axis?.choices || [];
  if (!by.axis || !mode) return {};
  if (mode !== 'custom') return choices.includes(mode) ? { axis: mode } : {};
  if (!axisOk(axis)) return {};
  if (choices.includes('custom') && AXIS_KEYS.every((k) => by[k])) {
    const out = { axis: 'custom', axis_x0: r4(axis.x0), axis_y0: r4(axis.y0), axis_x1: r4(axis.x1), axis_y1: r4(axis.y1) };
    const pr = by.primary;
    if (pr?.choices?.includes('proj') && (current.primary ?? pr.default) === pr.default) out.primary = 'proj';
    return out;
  }
  const dx = (axis.x1 - axis.x0) * aspect, dy = axis.y1 - axis.y0;
  const m = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
  if (!choices.includes(m)) return {};
  const flip = m === 'vertical' ? dy < 0 : dx > 0;
  return flip && by.pipe_invert ? { axis: m, pipe_invert: !(current.pipe_invert ?? by.pipe_invert.default) } : { axis: m };
}

const HIT_PX = 12, CLICK_PX = 6;
/**
 * The pointer tool (app.player.overlays tool shape). Press at the out end, release at the in end; or two clicks.
 * Dragging an end (within 12 px) moves it. get() -> axis, set(axis) commits, editable() -> bool, done() after a
 * commit, map() -> env.map of the last paint (px hit test; null = none), changed() whenever the draft changes.
 * state() -> {axis (draft or committed), pend: [x, y] | null}; cancel() -> true if it dropped a draft.
 */
export function axisTool({ id = 'tracking.axis', get, set, editable = () => true, done = () => {}, map = () => null, changed = () => {} }) {
  let drag = null, draft = null, pend = null;
  const px = (x, y) => map()?.(x, y) || null;
  const near = (p, x, y) => { const q = px(x, y); return !!q && Math.hypot(q[0] - p.x, q[1] - p.y) <= HIT_PX; };
  const reset = () => { const had = !!(drag || pend); drag = draft = pend = null; changed(); return had; };
  return {
    id, cursor: 'crosshair',
    hint: () => (!editable() ? '' : pend ? 'Click the IN end of the stroke (Esc cancels)' : 'Press at the OUT end, release at the IN end (or two clicks) · Esc cancels'),
    state: () => ({ axis: draft || get(), pend }),
    down(p, e) {
      if (!editable() || e?.button) return false;
      const a = get();
      if (pend) { draft = { x0: pend[0], y0: pend[1], x1: p.nx, y1: p.ny }; drag = { end: 1 }; pend = null; changed(); return true; }
      if (a && near(p, a.x1, a.y1)) { drag = { end: 1 }; draft = { ...a }; return true; }
      if (a && near(p, a.x0, a.y0)) { drag = { end: 0 }; draft = { ...a }; return true; }
      drag = { end: 'new', x: p.x, y: p.y, at: [p.nx, p.ny] };
      draft = { x0: p.nx, y0: p.ny, x1: p.nx, y1: p.ny };
      changed();
      return true;
    },
    move(p) {
      if (!drag) return;
      draft = drag.end === 0 ? { ...draft, x0: p.nx, y0: p.ny } : { ...draft, x1: p.nx, y1: p.ny };
      changed();
    },
    up(p) {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.end === 'new' && !(Math.hypot(p.x - d.x, p.y - d.y) > CLICK_PX)) { pend = d.at; draft = null; changed(); return; }   // a click: wait for the second
      const a = draft; draft = null;
      if (axisOk(a)) { set(a); done(); }
      changed();
    },
    context() { return reset(); },
    cancel: reset,
  };
}

/** The arrow: line out -> in, a head at the in end, ringed ends labelled "out" / "in"; pend = a lone out end. */
export function drawAxis(ctx, env, axis, { color, pend = null, dim = false } = {}) {
  if (!axisOk(axis) && !pend) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = dim ? 0.55 : 1;
  ctx.textBaseline = 'middle';
  // halo opposite to the ink (a light theme's tokens are dark): readable on any picture
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(color).trim());
  const halo = m && 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) < 128 ? 'rgba(255, 255, 255, .85)' : 'rgba(0, 0, 0, .75)';
  const label = (X, Y, ux, uy, s) => {
    ctx.textAlign = ux < -0.3 ? 'right' : ux > 0.3 ? 'left' : 'center';
    const x = X + ux * 14, y = Y + uy * 14;
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(s, x, y); ctx.restore(); ctx.fillText(s, x, y);
  };
  ctx.font = '600 12px Chakra Petch, sans-serif';
  if (axisOk(axis)) {
    const [X0, Y0] = env.map(axis.x0, axis.y0), [X1, Y1] = env.map(axis.x1, axis.y1);
    const L = Math.hypot(X1 - X0, Y1 - Y0) || 1, ux = (X1 - X0) / L, uy = (Y1 - Y0) / L;
    ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1 - ux * 6, Y1 - uy * 6); ctx.stroke();
    const h = Math.min(12, L / 2);
    ctx.beginPath(); ctx.moveTo(X1, Y1);
    ctx.lineTo(X1 - ux * h - uy * h * 0.5, Y1 - uy * h + ux * h * 0.5); ctx.lineTo(X1 - ux * h + uy * h * 0.5, Y1 - uy * h - ux * h * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(X0, Y0, 5, 0, 2 * Math.PI); ctx.stroke();
    label(X0, Y0, -ux, -uy, 'out'); label(X1, Y1, ux, uy, 'in');
  } else {
    const [X, Y] = env.map(pend[0], pend[1]);
    ctx.beginPath(); ctx.arc(X, Y, 5, 0, 2 * Math.PI); ctx.stroke();
    label(X, Y, 0, -1, 'out');
  }
  ctx.restore();
}
