// interact.js -- shared pointer behaviour for the interval lanes (plan, loops) so they all hit-test,
// snap and drag the same way. Modifiers while dragging:
//   Shift  no snap targets (still on frames)   Ctrl  push neighbours along   Alt (edges)  detach from a touching neighbour
// Snap targets: scene cuts, plan edges, loop edges, the range, the playhead, a fade's or dissolve's
// start / darkest frame / first clean frame (paw-ef73.3: a cut dragged near one lands where the owner wants it);
// within SNAP_PX pixels; otherwise the frame grid. A snapped drag sets tl.snap and every lane draws the guide.
import { msToX, xToMs, zoomAt, gridOf, frameStartOf } from '../../lib/lane.js';
import { snapTargets, move, resize, create } from './intervals.js';
import { tl, listOf, setDraft, clearDraft, cutsOf } from './state.svelte.js';
import { run as runXform } from '../../lib/xform.js';
import { fadeSnaps } from './transitions.svelte.js';

export const SNAP_PX = 7, EDGE_PX = 6, CLICK_PX = 3;

// ---- the gesture in progress (one at a time), so Esc can cancel it ----
// CanvasLane registers every press with the lane's own pointercancel handler (which drops its draft and restores
// what it changed live); cancelDrag() runs it and the rest of that gesture is ignored. Nothing is committed, so
// there is no undo entry.
let active = null;
export const dragActive = () => !!active;
/** -> release(): call when the gesture ends normally. */
export function beginDrag(cancel) {
  const me = { cancel };
  active = me;
  return () => { if (active === me) active = null; };
}
export function cancelDrag() {
  const a = active;
  active = null;
  if (!a) return false;
  a.cancel();
  tl.snap = null;
  return true;
}

/** Pointer x in CSS px relative to el. */
export const localX = (e, el) => e.clientX - el.getBoundingClientRect().left;

/** The interval part under x: {item, part: 't0' | 't1' | 'body'} or null. Edges win within EDGE_PX (inside a third of narrow items). */
export function hitInterval(list, view, w, x, edgePx = EDGE_PX) {
  let edge = null, body = null;
  for (const it of list) {
    const x0 = msToX(view, w, it.t0), x1 = msToX(view, w, it.t1);
    if (x1 < x - edgePx || x0 > x + edgePx) continue;
    const e = Math.min(edgePx, (x1 - x0) / 3);
    const d0 = Math.abs(x - x0), d1 = Math.abs(x - x1);
    if (d0 <= edgePx && x <= x0 + e && (!edge || d0 < edge.d)) edge = { item: it, part: 't0', d: d0 };
    if (d1 <= edgePx && x >= x1 - e && (!edge || d1 < edge.d)) edge = { item: it, part: 't1', d: d1 };
    if (x >= x0 && x < x1) body = { item: it, part: 'body' };
  }
  return edge ? { item: edge.item, part: edge.part } : body;
}

/** Drag options from a pointer event's modifiers. */
export const modsOf = (e) => ({ snap: !e.shiftKey, push: e.ctrlKey || e.metaKey, edge: e.ctrlKey || e.metaKey ? 'push' : e.altKey ? 'clamp' : 'roll' });

/** Snap targets for a drag; `exclude` = {plan: Set(ids), loops: Set} items being dragged. */
export function snapContext(app, w, exclude = {}) {
  const view = app.view, ex = (k) => exclude[k] || new Set();
  const edges = (k, label) => listOf(app, k).filter((x) => !ex(k).has(x.id)).flatMap((x) => [{ t: x.t0, label }, { t: x.t1, label }]);
  const r = app.doc.range;
  const targets = snapTargets(
    fadeSnaps(app),   // first: where a cut sits on a fade's place, the place's name wins the tie
    cutsOf(app).map((t) => ({ t, label: 'cut' })),
    edges('plan', 'segment'), edges('loops', 'loop'),
    r ? [{ t: r.t0, label: 'range' }, { t: r.t1, label: 'range' }] : [],
    [{ t: app.player.timeMs, label: 'playhead' }],
  );
  return { targets, tol: (SNAP_PX * view.span) / w, frameMs: gridOf(app.player) };   // frameMs: the frame grid (lane.js: the clock)
}

/**
 * One drag on an interval lane. key: 'plan' | 'loops'. hit from hitInterval (or null to create).
 * ids: the items a body drag moves (the selection if it contains the hit item). make(t0, t1) builds a new item
 * for a create drag. Returns {move(e), end(e) -> 'click' | 'edit' | 'none', cancel()}.
 * The drag draws through tl.draft; end() commits ONE app.transact labelled `label`.
 */
export function intervalDrag({ app, key, el, e, hit, ids, make, minLen = 1, label, w = el.clientWidth }) {
  const x0 = localX(e, el), t0 = xToMs(app.view, w, x0), base = listOf(app, key);
  const dur = Math.max(1, Math.round(app.durationMs));
  const moving = new Set(hit?.part === 'body' ? ids : hit ? [hit.item.id] : []);
  let moved = false, result = base;
  const apply = (ev) => {
    const x = localX(ev, el), t = xToMs(app.view, w, x), m = modsOf(ev);   // the view as it is now: it pans under a drag held at an edge
    if (!moved && Math.abs(x - x0) < CLICK_PX) return;
    moved = true;
    const sc = m.snap ? snapContext(app, w, { [key]: moving }) : { targets: [], tol: 0, frameMs: gridOf(app.player) };   // Shift: no targets, still on frames (paw-ef73.14)
    let r;
    if (!hit) {
      const s = sc.targets.length || sc.frameMs ? snapPoint(t, sc) : { t: Math.round(t), target: null };
      const list = create(base, make(t0, s.t), { dur, minLen, anchor: t0 });
      r = { list: list || base, snap: list ? s.target : null };
    } else if (hit.part === 'body') r = move(base, [...moving], t - t0, { dur, push: m.push, ...sc });
    else r = resize(base, hit.item.id, hit.part, t, { dur, minLen, mode: m.edge, ...sc });
    result = r.list;
    setDraft(key, result);
    tl.snap = r.snap ? { t: r.snap.t, label: r.snap.label } : null;
  };
  const finish = () => { clearDraft(key); tl.snap = null; };
  return {
    move: apply,
    end(ev) {
      if (ev) apply(ev);
      finish();
      if (!moved) return 'click';
      if (result === base) return 'none';
      app.transact(label, () => { app.doc[key] = result; });
      return 'edit';
    },
    cancel: finish,
  };
}
function snapPoint(t, sc) {
  let best = null;
  for (const x of sc.targets) if (Math.abs(x.t - t) <= sc.tol && (!best || Math.abs(x.t - t) < Math.abs(best.t - t))) best = x;
  if (best) return { t: Math.round(best.t), target: best };
  return { t: frameStartOf(t, sc.frameMs), target: null };
}

/**
 * Blender G on a timeline row: the selected items of doc[key] follow the mouse in time (lib/xform.js, time only; a typed
 * number is an exact offset in ms; whole frames: structure always (paw-ef73.14), effects unless Shift). apply(base, dt) -> {list, dt (applied)}; done(list)
 * commits ONE transact. Drawn through tl.draft like a drag; Esc / right click drops the draft.
 */
export function grabRow(app, lane, key, apply, done, cancelled = null) {
  const el = document.querySelector(`[data-tl-lane="${lane}"]`), base = listOf(app, key), w = el?.clientWidth || 1000, fms = app.player.frameMs || 0, motion = key === 'fx';
  let out = base;
  runXform({ kind: 'grab', axes: 'x', origin: tl.hover?.lane === lane ? [tl.hover.x, tl.hover.y] : null, follow: el ? { app, el } : null,
    mouse: (o, p, e) => { const dt = ((p[0] - o[0]) / w) * app.view.span; return { dt: fms && !(motion && e.shiftKey) ? Math.round(dt / fms) * fms : dt, dp: 0 }; },
    preview: (a) => { const r = apply(base, Math.round(a.dt)); out = r.list; setDraft(key, out); return { dt: r.dt, dp: 0 }; },
    cancel: () => { clearDraft(key); cancelled?.(); },
    confirm: () => { clearDraft(key); if (out !== base) done(out); else cancelled?.(); } });
}

/** Wheel over any timeline strip: zoom at the cursor (vertical), pan (horizontal / Shift). Same factor as the lanes. */
export function wheelView(app, e, w, x) {
  const v = app.view, unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;   // as the axis lanes (lanes/geom.js wheelIntent)
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    const d = (e.shiftKey ? e.deltaY || e.deltaX : e.deltaX) * unit;
    app.setView({ start: v.start + (d / w) * v.span, span: v.span });
  } else {   // Ctrl: a touchpad pinch, faster
    // zoomAt: zooming out past the whole video lands on exactly 0..dur (it used to land with time 0 mid-row: the owner's "half of it off screen")
    app.setView(zoomAt(v, xToMs(v, w, x), Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), app.durationMs));
  }
}
