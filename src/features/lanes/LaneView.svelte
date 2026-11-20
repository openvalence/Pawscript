<script>
  // One lane: two stacked canvases (base = grid/hints/ghosts/script/selection, over = playhead/hover/drag feedback)
  // and every pointer interaction. Keys never handled here (commands.js); edits go through app.edit/app.transact.
  import { onMount } from 'svelte';
  import { xToMs, msToX, zoomAt, panBy, headMs, gridOf, frameLen } from '../../lib/lane.js';
  import { lowerBound } from '../../lib/core/script.js';
  import { edgeFollow } from '../../lib/edge-scroll.js';
  import { selTarget, inCircle, circleBox } from '../../lib/selmodal.js';
  import { setPointAt } from '../../lib/edit/points.js';
  import { lanes } from './state.svelte.js';
  import { posToY, yToPos, hitPoint, hitSegment, boxSelect, bounds, boxRect, hitHandle, dragBox, wheelIntent, snapTime, snapFrame, extremes, frameOf, loopWrap, GUTTER_W } from './geom.js';
  import { indices, combine, toggle, inRange, boxMode, EMPTY } from './select.js';
  import { resolveMove, applyMove, boxLimits, applyBox } from './drag.js';
  import { drawBase, drawOverlay, readTheme, readout, axisColor, fmtT, acceptableGhost, ghostKind } from './render.js';
  import OutOfRange from '../timeline/OutOfRange.svelte';
  import { posAtInt } from './ops.js';
  import { contextItems } from './commands.js';
  import { problemFor, heatScaleOf, heatMaxOf, speedLimit, pointWhy } from './deps.js';
  import { depthOf, hitDepth, depthTarget } from './depth.js';
  import { remapRange } from '../../lib/edit/amplitude.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live
  import { elements, hitElement, elementsWhere, combineElements, addElements, removeElements, isSelected, atsOf, loopOf, pathOf, activeIdx, elementOfPoint, MODE_LABEL } from './elements.js';

  // paw-unuy (the Track tab's combined lane, tracking/TrackingLane.svelte): `under` = a layer drawn between the base canvas and the
  // pointer canvas (the runs' traces); `claim` = its gestures, asked where no point, box handle or depth grip of this lane is:
  // {down(e) -> true if it takes the press (then move / up / cancel go to it), hover(e) -> a cursor if something of it is there,
  // leave(), dbl(e) -> true if handled, menu(e) -> true if handled, else extra items for this lane's menu}
  // `edge` (px): a band of the claim layer inside the lane along its bottom edge (the combined lane's overrides / direction marks): the
  // points' 0..100 scale and both canvases end above it, so nothing of this lane is under it and it takes no press meant for a point
  let { app, axis, under = null, claim = null, edge = 0 } = $props();
  const st = lanes(app);

  let base = $state(), over = $state(), w = $state(0), hAll = $state(0);
  const h = $derived(Math.max(0, hAll - edge));   // the plot: the lane less its edge band
  let dpr = $state(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  let theme = $state.raw(readTheme());
  let preview = $state.raw(null);        // {script, idx} while a drag edits; drawn instead of the document
  let ov = $state.raw({});               // overlay-only feedback: {hover, box, tbox hot, guide, tip}
  let drag = null;                        // the active gesture (not reactive)
  let handlesShown = false;               // whether the last paint drew point handles (points are grabbable)
  let bufs = null, wrapNow = {};          // wrapNow: the last paint's loop wrap (geom.js loopWrap), for the hover words
  const BOX_OUT = 8;                      // transform handles sit this far outside the selection box

  const doc = $derived(scriptOf(app, axis));   // paw-x7w7: baked + live (an edit of a live shot bakes it)
  const xf = $derived(st.xform?.axis === axis ? st.xform : null);   // a modal G / S transform (commands.js) previewing here
  const script = $derived(preview ? preview.script : xf ? xf.script : doc);
  const selSet = $derived(app.doc.selection.axis === axis ? app.doc.selection.ats : EMPTY);
  const selIdx = $derived(preview ? preview.idx : xf ? xf.idx : indices(doc, selSet));
  // paw-5zpf: the active element (the last one clicked: Blender's lighter highlight), not while a drag or G / S previews
  const activeI = $derived(!preview && !xf && app.doc.selection.axis === axis ? activeIdx(doc, app.doc.selection) : null);
  const focused = $derived(app.doc.activeAxis === axis);
  const editable = $derived(st.editable(axis));
  const ghosts = $derived(st.ghostsFor(axis));
  const dur = () => app.durationMs;
  const fms = () => gridOf(app.player);   // the frame grid (lane.js: the player's clock; paw-kxz4)
  const inVideo = (t) => t >= 0 && t <= dur();   // paw-g56v: the view pans past both ends; nothing is made out there
  const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // a ghost's colour is a series key (or, from older documents, any CSS colour)
  const ghostCol = (c) => (c && theme.series[c]) || c || theme.val;
  /** paw-g56v: what the header bar said (points, selection, hidden, the ghosts' names), drawn faintly behind the curve. */
  function infoOf() {
    if (h < 30) return null;
    const items = [{ text: `${group(doc.length)} point${doc.length === 1 ? '' : 's'}` }];
    if (selIdx.length) items.push({ text: `${group(selIdx.length)} selected`, color: theme.hi });
    if (st.flag('hidden', axis)) items.push({ text: 'hidden' });
    if (!editable) items.push({ text: st.flag('locked', axis) ? 'locked' : 'not soloed' });
    // paw-unuy: the ghosts' names ("S14-S15 0:30.4-0:37.5 #1 ...") are the gutter's tooltip (LaneHeader); here just how many
    if (ghosts.length) items.push({ text: `${ghosts.length} ghost${ghosts.length === 1 ? '' : 's'}` });
    return { x: GUTTER_W + 6, items };
  }

  // ---- painting: effects only mark layers dirty; one animation frame paints what is dirty ----
  let raf = 0, dirtyBase = true, dirtyOver = true;
  const schedule = (b) => { if (b) dirtyBase = true; dirtyOver = true; if (!raf) raf = requestAnimationFrame(paint); };
  $effect(() => {
    script; selIdx; activeI; app.view; w; h; dpr; theme; ghosts; focused; editable;
    app.doc.range; app.doc.loops; app.player.frameMs; app.player.loop; app.durationMs;
    st.speedColors; st.maxSpeed; st.flag('hidden', axis); problemFor(axis); heatScaleOf(app); heatMaxOf(app); app.doc.scenes; app.settings.get('timeline.sceneGuides', true);
    schedule(true);
  });
  $effect(() => { app.player.timeMs; app.player.scrubTime; ov; st.rec; schedule(false); });
  // the playhead moves with the clock while playing (paw-ef73.7: smooth, not frame steps)
  $effect(() => { if (!app.player.playing) return; let id = 0; const f = () => { schedule(false); id = requestAnimationFrame(f); }; id = requestAnimationFrame(f); return () => cancelAnimationFrame(id); });
  // keyboard focus follows the focused lane (Alt+n, Alt+Up/Down) when it was on another lane's canvas
  $effect(() => {
    if (!focused || !over) return;
    const a = document.activeElement;
    if (a !== over && Object.values(st.els).includes(a)) over.focus({ preventScroll: true });
  });

  const perf = (typeof window !== 'undefined' && (window.__lanesPerf ||= { base: [], over: [] })) || { base: [], over: [] };
  function fit(c) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function paint() {
    raf = 0;
    if (!base || !over || w < 2 || h < 2) return;
    if (dirtyBase) {
      dirtyBase = false;
      const t0 = performance.now();
      const r = drawBase(fit(base), w, h, app.view, {
        script, color: axisColor(axis, theme), speedColors: st.speedColors && focused, maxSpeed: heatMaxOf(app) || st.maxSpeed, heatScale: heatScaleOf(app), selIdx, active: activeI, clamped: xf?.clamped || null,
        focused, locked: !editable, hidden: st.flag('hidden', axis), ghosts, range: app.doc.range, scenes: app.doc.scenes, sceneGuides: app.settings.get('timeline.sceneGuides', true) !== false,
        loops: app.doc.loops, fms: fms(), theme, bufs, problem: problemFor(axis), dur: dur(), left: GUTTER_W, info: infoOf(),
        wrap: (wrapNow = loopWrap(script, app.player.loop, dur(), app.view, frameLen(fms()) || 1000 / 30)),
      });
      bufs = r.bufs; handlesShown = r.handles;
      push(perf.base, performance.now() - t0);
    }
    if (dirtyOver) {
      dirtyOver = false;
      const t0 = performance.now();
      drawOverlay(fit(over), w, h, overlayModel());
      push(perf.over, performance.now() - t0);
    }
  }
  const push = (a, v) => { a.push(v); if (a.length > 600) a.splice(0, a.length - 600); };

  function overlayModel() {
    const v = app.view, X = (t) => msToX(v, w, t);
    let tbox = null;
    const b = boxOf();
    if (b) tbox = { r: pad(boxRect(b, v, w, h)), hot: ov.hot ?? null };
    const rec = st.rec?.axis === axis ? st.rec : null;
    let trail = null;
    if (rec?.samples?.length) {
      trail = [];
      const lo = lowerBoundT(rec.samples, v.start - 1000);
      for (let i = lo; i < rec.samples.length; i++) { const s = rec.samples[i]; if (s.t > v.start + v.span) break; trail.push([X(s.t), posToY(h, s.pos)]); }
    }
    const d = depthNow();
    return {
      depth: d && (!drag || drag.kind === 'depth' || drag.kind === 'move') ? { d, view: v, hot: drag?.kind === 'depth' ? drag.which : ov.dhot ?? null } : null,
      theme, playhead: X(headMs(app.player)), hover: drag ? null : ov.hover, box: ov.box, tbox: drag && drag.kind !== 'box' ? (drag.kind === 'tbox' ? tbox : null) : tbox,
      guide: ov.guide, drag: ov.tip, trail, recording: !!rec,
      rec: rec && st.hover?.axis === axis && rec.mode === 'live' ? { x: X(headMs(app.player)), y: st.hover.y } : null,
    };
  }
  function lowerBoundT(a, t) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t < t) lo = m + 1; else hi = m; } return lo; }
  const pad = (r) => ({ x0: r.x0 - BOX_OUT, x1: r.x1 + BOX_OUT, y0: r.y0 - BOX_OUT, y1: r.y1 + BOX_OUT });
  /** The transform box for the current (or previewed) multi-selection, or null. */
  function boxOf() {
    if (!editable || selIdx.length < 2 || !focused) return null;
    const b = bounds(script, selIdx);
    if (!b || b.t1 <= b.t0) return null;
    const r = boxRect(b, app.view, w, h);
    return r.x1 - r.x0 >= 6 ? b : null;
  }

  /** Depth handles for the current (or previewed) selection of >= 3 points, or null. */
  const depthNow = () => (editable && focused ? depthOf(script, selIdx, app.doc.range) : null);

  // ---- geometry helpers ----
  const local = (e) => { const r = over.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const tAt = (x) => xToMs(app.view, w, x);
  const snapOn = (e) => st.snap.frames && !e.shiftKey;
  // paw-ef73.14: the playhead from the pointer is smooth (it rests between frames; the video shows the one containing it);
  // Shift puts it on a frame. Snap to frames is the points' setting, not the playhead's.
  const clampT = (t) => Math.max(0, Math.min(dur(), t));
  const seekAt = (t, e) => (e?.shiftKey ? app.player.seek(clampT(snapFrame(clampT(t), fms()))) : app.player.seek(clampT(t), { exact: true }));
  // paw-o60v.8: a drag of the playhead shows decoded frames while paused (player.dragTo); scrubDone lands the <video> once
  const dragAt = (t, e) => (e?.shiftKey ? app.player.dragTo(clampT(snapFrame(clampT(t), fms())), { snap: true }) : app.player.dragTo(clampT(t)));
  /** Snap targets in ms (sorted): ghost extremes, cuts (scene edges, loop edges, doc.cuts). */
  let targetOwner = new Map();   // snap time -> ghost id (snapping onto a ghost counts as using it)
  function targets() {
    const out = [];
    targetOwner = new Map();
    if (st.snap.ghosts) for (const g of ghosts) if (acceptableGhost(g)) for (const a of extremes(g.script)) { out.push(a.at); targetOwner.set(a.at, g.id); }
    if (st.snap.cuts) {
      for (const sc of app.doc.scenes || []) { if (sc.start_ms != null) out.push(sc.start_ms); if (sc.end_ms != null) out.push(sc.end_ms); }
      for (const l of app.doc.loops || []) out.push(l.t0, l.t1);
      for (const t of app.doc.cuts || []) out.push(t);
    }
    return out.sort((a, b) => a - b);
  }
  const tolMs = (px = 8) => (px / w) * app.view.span;

  // ---- cursor feedback ----
  const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
  let cursor = $state('crosshair');

  /** What is under (x, y): {kind: 'handle'|'point'|'playhead'|'segment'|'empty', ...}. */
  function hitAt(x, y) {
    const b = boxOf();
    if (b) { const hd = hitHandle(pad(boxRect(b, app.view, w, h)), x, y, 7); if (hd) return { kind: 'handle', hd, b }; }
    // depth handles: the grip tab beats points; the bar itself only where no point is
    const dh = hitDepth(depthNow(), app.view, w, h, x, y);
    if (dh?.grip) return { kind: 'depth', which: dh.which };
    const s = doc;
    const i = handlesShown || selIdx.length ? hitPoint(s, app.view, w, h, x, y, 8) : -1;
    if (i >= 0) return { kind: 'point', i };
    if (dh) return { kind: 'depth', which: dh.which };
    if (Math.abs(x - msToX(app.view, w, headMs(app.player))) <= 4) return { kind: 'playhead' };   // where it is drawn
    const j = handlesShown ? hitSegment(s, app.view, w, h, x, y, 5) : -1;
    if (j >= 0) return { kind: 'segment', j };
    return { kind: 'empty' };
  }

  // ---- pointer ----
  const OWN = new Set(['point', 'handle', 'depth']);   // what of this lane beats the `claim` layer under the pointer
  let claimed = false;                                  // the claim layer took the press: its move / up / cancel
  function onDown(e) {
    if (e.button === 2) return;   // contextmenu event handles it
    const [x, y] = local(e);
    if (!focused) app.setActiveAxis(axis);
    over.focus({ preventScroll: true });
    over.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && st.spaceHeld)) {
      e.preventDefault();
      drag = { kind: 'pan', x0: x, view0: app.view };
      cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const hit = hitAt(x, y), s = doc;
    const base0 = { x0: x, y0: y, x, y, moved: false, e0: e, t0: tAt(x) };
    // paw-5zpf: modes 2-4 take the element under the pointer (it beats the claim layer and the playhead, as a point does)
    const ek = hit.kind === 'handle' || hit.kind === 'depth' ? -1 : elAt(x, y);
    if (ek >= 0) { drag = { ...base0, ...pressEl(e, s, elements(s, st.selMode), ek, x) }; return; }
    if (claim && !OWN.has(hit.kind) && claim.down?.(e)) { claimed = true; return; }
    if (hit.kind === 'handle' && editable) {
      const idx = selIdx.slice();
      drag = { ...base0, kind: 'tbox', hd: hit.hd, from: hit.b, idx, s0: s, lim: boxLimits(s, idx, dur()) };
      return;
    }
    if (hit.kind === 'depth' && editable) {
      const d = depthNow(), idx = selIdx.slice();
      drag = { ...base0, kind: 'depth', which: hit.which, d, s0: s, idx, ats: idx.map((i) => s[i].at), off: (hit.which === 'top' ? d.max : d.min) - yToPos(h, y) };
      cursor = 'ns-resize';
      return;
    }
    if (hit.kind === 'point') {
      const at = s[hit.i].at, isSel = selSet.has(at), add = e.shiftKey;
      let after = null;   // what a click (no drag) does on release
      // paw-5zpf (Blender): Alt+click = loop (every peak / trough of the passage), Ctrl+click = path from the active point; Shift
      // adds to either. Shift+click toggles one; a drag moves (Alt+drag duplicates, Ctrl+drag keeps to one axis)
      if (e.altKey) after = () => loopAt(s, 'point', { i: hit.i }, [at], add);
      else if (e.ctrlKey) after = () => pathTo(s, elements(s, 'point'), hit.i, add);
      else if (add) { if (isSel) after = () => setSel(toggle(selSet, at)); else setSel(combine(selSet, [at], 'add'), [at]); }
      else if (!isSel) setSel([at], [at]);
      else after = () => setSel([at], [at]);
      drag = { ...base0, kind: 'move', anchorAt: at, after, press: [at] };
      return;
    }
    // a segment whose two ends are selected drags them; any other segment is empty space for a drag (box select) and a
    // click on it selects its two ends (on release)
    if (hit.kind === 'segment' && selSet.has(s[hit.j - 1].at) && selSet.has(s[hit.j].at)) { drag = { ...base0, kind: 'move', anchorAt: s[hit.j].at, segment: true }; return; }
    if (hit.kind === 'playhead') { drag = { ...base0, kind: 'scrub' }; app.player.pause(); return; }
    // setting lanes.dragAction 'pan': a plain drag pans (a click still selects / seeks on release); a modifier box-selects
    const mode = boxMode(e);
    drag = { ...base0, kind: 'box', mode, sel0: selSet, pair: hit.kind === 'segment' ? [s[hit.j - 1].at, s[hit.j].at] : null, pan: mode === 'replace' && st.dragAction === 'pan' };
  }

  function onMove(e) {
    const [x, y] = local(e);
    st.hover = { axis, x, y, h };
    if (claimed) { claim.move?.(e); return; }
    if (!drag) return hover(x, y, e);
    drag.x = x; drag.y = y; drag.e = e;
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
    if (!drag.moved) startDrag(e);
    drag.moved = true;
    if (drag.kind !== 'pan') (follow ??= edgeFollow({ app, el: over, step, x0: drag.e0.clientX })).move(e.clientX);
    step();
  }

  function startDrag(e) {
    if (drag.kind === 'box' && drag.pan) { drag = { ...drag, kind: 'pan', view0: app.view }; cursor = 'grabbing'; return; }
    if (drag.kind === 'move') {
      if (!editable) { app.toast(axis + ' is locked', 'quiet'); drag = { ...drag, kind: 'none' }; return; }
      const s = doc;
      // an Alt / Ctrl press left the selection alone (its click is a loop / path): dragging what is not selected takes it first
      if (drag.press && !drag.press.every((t) => selSet.has(t))) setSel(drag.press, drag.press);
      const idx = indices(s, app.doc.selection.axis === axis ? app.doc.selection.ats : EMPTY);
      const anchor = lowerBound(s, drag.anchorAt);
      drag = { ...drag, s0: s, idx, anchor, mode: e.altKey ? 'dup' : st.push || e.metaKey ? 'push' : 'clamp', targets: targets(), offT: s[anchor].at - drag.t0, offP: s[anchor].pos - yToPos(h, drag.y0) };
      cursor = 'grabbing';
    }
  }

  /** Re-evaluate the gesture for the current pointer (also after an auto-scroll moved the view). */
  function step() {
    if (!drag) return;
    const { x, y } = drag, e = drag.e || drag.e0;
    if (drag.kind === 'pan') { app.setView(panBy(drag.view0, x - drag.x0, w, dur())); return; }
    if (drag.kind === 'scrub') { app.player.scrubTime = clampT(tAt(x)); app.player.scrubPxMs = app.view.span / w; drag.scrubT = tAt(x); dragAt(tAt(x), e); return; }
    if (drag.kind === 'box') {
      const x0 = msToX(app.view, w, drag.t0);   // the box start is pinned in time, so it survives auto-scroll
      ov = { ...ov, box: { x0, y0: drag.y0, x1: x, y1: y, timeOnly: drag.mode === 'time' || drag.mode === 'span', sub: drag.mode === 'sub' }, hover: null };
      if (drag.mode === 'time') app.doc.range = { t0: Math.round(clampT(Math.min(drag.t0, tAt(x)))), t1: Math.round(clampT(Math.max(drag.t0, tAt(x)))) };
      return;
    }
    if (drag.kind === 'move' && drag.s0) {
      const r = resolveMove({ script: drag.s0, idx: drag.idx, anchor: drag.anchor, t: tAt(x) + drag.offT, pos: yToPos(h, y) + drag.offP, mode: drag.mode,
        fms: fms(), snap: snapOn(e), targets: drag.targets, tolMs: tolMs(), constrain: e.ctrlKey, dxPx: x - drag.x0, dyPx: y - drag.y0, minGap: 1, dur: dur() });
      const next = applyMove(drag.s0, drag.idx, r.dt, r.dp, drag.mode);
      let idx = drag.idx;
      if (drag.mode === 'dup') { const k = lowerBound(next, drag.s0[drag.idx[0]].at + r.dt); idx = drag.idx.map((_, q) => k + q); }
      drag.result = { script: next, idx, dt: r.dt, dp: r.dp, target: r.target ? drag.s0[drag.anchor].at + r.dt : null };
      preview = { script: next, idx };
      const a = next[idx[drag.idx.indexOf(drag.anchor)] ?? idx[0]];
      // drag scrub: the video shows the dragged point's frame on the fast path (decoded frames, no seek per move);
      // a vertical-only drag never scrubs. Release: scrubEnd() lands one real seek there.
      if (st.dragScrub && !app.player.playing && (r.dt || drag.scrubT != null)) { drag.scrubT = a.at; const p = app.player; p.scrubTime = a.at; p.scrubPxMs = app.view.span / w; p.scrub ? p.scrub(a.at) : p.seek(a.at, { exact: true }); }
      const f = Math.round(r.dt / frameLen(fms()));
      ov = { ...ov, hover: null, guide: r.target ? msToX(app.view, w, a.at) : null,
        tip: { x, y, lines: [`${fmtT(a.at)}  f${frameOf(a.at, fms())}  pos ${a.pos}`, `Δ ${r.dt >= 0 ? '+' : ''}${r.dt} ms (${f >= 0 ? '+' : ''}${f} f)  ${r.dp >= 0 ? '+' : ''}${r.dp} pos` + (drag.mode !== 'clamp' ? '  ' + drag.mode : '')] } };
      return;
    }
    if (drag.kind === 'depth') {
      const d = drag.d, mode = e.shiftKey ? 'move' : e.altKey ? 'sym' : 'scale';
      const { lo, hi } = depthTarget(d, drag.which, yToPos(h, y) + drag.off, mode);
      const same = lo === d.min && hi === d.max;
      const next = same ? drag.s0 : remapRange(drag.s0, { ats: drag.ats }, { lo, hi, srcLo: d.min, srcHi: d.max }).script;
      drag.result = same ? null : { script: next, idx: drag.idx };
      preview = { script: next, idx: drag.idx };
      ov = { ...ov, hover: null, tip: { x, y, lines: [`depth ${lo}–${hi} (was ${d.min}–${d.max})`, mode === 'move' ? 'Shift: move both' : mode === 'sym' ? 'Alt: about the center' : `${drag.which === 'top' ? 'top' : 'bottom'} · Shift moves both · Alt symmetric`] } };
      return;
    }
    if (drag.kind === 'tbox') {
      let t = tAt(x);
      if (snapOn(e) && /[ew]/.test(drag.hd)) t = snapTime(t, fms(), drag.targets ||= targets(), tolMs()).t;
      const to = dragBox(drag.from, drag.hd, t, Math.max(0, Math.min(100, yToPos(h, y))), e.altKey, drag.lim);
      const r = applyBox(drag.s0, drag.idx, drag.from, to);
      const k0 = lowerBound(r.script, r.ats[0]), idx = r.ats.map((at) => lowerBound(r.script, at));
      drag.result = { script: r.script, idx, ats: r.ats };
      preview = { script: r.script, idx };
      const kt = (to.t1 - to.t0) / (drag.from.t1 - drag.from.t0), kp = drag.from.p1 > drag.from.p0 ? (to.p1 - to.p0) / (drag.from.p1 - drag.from.p0) : 1;
      ov = { ...ov, hot: drag.hd, tip: { x, y, lines: [`time ×${kt.toFixed(3)} · span ${Math.round(to.t1 - to.t0)} ms`, `amplitude ×${kp.toFixed(2)} · ${Math.round(Math.min(to.p0, to.p1))}–${Math.round(Math.max(to.p0, to.p1))}`] } };
      void k0;
    }
  }

  function onUp(e) {
    if (claimed) { claimed = false; try { over.releasePointerCapture(e.pointerId); } catch {} claim.up?.(e); return; }
    if (!drag) return;
    const d = drag;
    drag = null; stopEdge(false);
    try { over.releasePointerCapture(e.pointerId); } catch {}
    const s = doc;
    if (!d.moved) {
      if (d.kind === 'move') d.after?.();
      else if (d.kind === 'box' && d.pair) app.select(d.e0.shiftKey || d.e0.ctrlKey ? combine(selSet, d.pair, 'add') : d.pair, axis);   // a segment click
      else if (d.kind === 'box' && d.mode !== 'time') {
        // a click on empty space: clear the selection (unless adding) and put the playhead there
        if (d.mode === 'replace') app.select([], axis);
        seekAt(d.t0, e);
      } else if (d.kind === 'scrub') seekAt(tAt(d.x), e);
    } else if (d.kind === 'box' && d.mode !== 'time') {
      const x0 = msToX(app.view, w, d.t0);
      if (st.selMode !== 'point') app.select(combineElements(d.sel0, s, ...elIn(x0, d.y0, d.x, d.y, d.mode === 'span'), d.mode), axis);   // whole elements (paw-5zpf)
      else app.select(combine(d.sel0, d.mode === 'span' ? inRange(s, d.t0, tAt(d.x)) : boxSelect(s, app.view, w, h, x0, d.y0, d.x, d.y), d.mode), axis);
    } else if ((d.kind === 'move' || d.kind === 'tbox' || d.kind === 'depth') && d.result && d.result.script !== d.s0) {
      const r = d.result, ats = r.idx.map((i) => r.script[i].at);
      const n = ats.length, label = d.kind === 'depth' ? 'Scene depth' : d.kind === 'tbox' ? 'Transform points' : d.mode === 'dup' ? `Duplicate ${n} point${n === 1 ? '' : 's'}` : `Move ${n} point${n === 1 ? '' : 's'}`;
      if (doc === d.s0) app.transact(label, () => { app.edit(label, axis, r.script); app.select(ats, axis); });
      if (r.target != null && targetOwner.has(r.target)) st.lastGhost = targetOwner.get(r.target);
    }
    scrubDone(d);
    preview = null;
    ov = { hover: ov.hover };
    const [x, y] = local(e);
    hover(x, y, e);
  }

  function onCancel() { if (claimed) { claimed = false; claim.cancel?.(); } if (drag) { scrubDone(drag); drag = null; preview = null; stopEdge(true); ov = {}; } }
  /** End a drag scrub: one real seek to the last scrubbed time (scrubEnd's; the seek fallback already sought). */
  function scrubDone(d) { app.player.scrubTime = null; if (d.scrubT != null && app.player.scrub) app.player.scrubEnd?.(); }

  function hover(x, y, e) {
    if (x < 0 || y < 0 || x > w || y > h) { if (ov.hover) ov = {}; cursor = 'crosshair'; claim?.leave?.(); return; }
    const hit = hitAt(x, y), s = doc;
    // paw-5zpf: modes 2-4 light the element a click would take (it beats the claim layer, as on a press)
    const ek = hit.kind === 'handle' || hit.kind === 'depth' ? -1 : elAt(x, y);
    if (ek >= 0) { claim?.leave?.(); ov = { ...ov, hover: elHover(s, elements(s, st.selMode)[ek], x, y), hot: null, dhot: null }; cursor = st.spaceHeld ? 'grab' : 'pointer'; return; }
    const cc = claim && !OWN.has(hit.kind) ? claim.hover?.(e) : (claim?.leave?.(), null);
    if (cc) { if (ov.hover || ov.hot || ov.dhot) ov = {}; cursor = cc; return; }   // the claim layer's own words (its tip), not this lane's readout
    let hv;
    if (hit.kind === 'point') { const a = s[hit.i], why = pointWhy(app, a.at); hv = { x, y, ring: [msToX(app.view, w, a.at), posToY(h, a.pos)], lines: [...readout(s, hit.i, 0, 0, fms(), speedLimit(app)), ...(why ? [why] : [])] }; }
    else if (!inVideo(tAt(x))) hv = { x, y, cross: false, lines: [tAt(x) < 0 ? 'before the video: nothing plays here' : 'past the end of the video: nothing plays here', ...((tAt(x) < 0 ? wrapNow.before : wrapNow.after) ? ['dashed: the loop repeating (not editable)'] : [])] };
    else {
      const t = tAt(x);
      hv = { x, y, cross: false, lines: hit.kind === 'empty' || hit.kind === 'segment' ? segReadout(s, t, yToPos(h, y)) : null };
    }
    ov = { ...ov, hover: hv, hot: hit.kind === 'handle' ? hit.hd : null, dhot: hit.kind === 'depth' ? hit.which : null };
    cursor = st.spaceHeld ? 'grab' : hit.kind === 'depth' ? 'ns-resize' : hit.kind === 'handle' ? CURSORS[hit.hd] : hit.kind === 'point' ? (editable ? 'grab' : 'pointer') : hit.kind === 'playhead' ? 'col-resize' : hit.kind === 'segment' ? (editable && selSet.has(s[hit.j - 1].at) && selSet.has(s[hit.j].at) ? 'move' : 'crosshair') : 'crosshair';
    void e;
  }
  const segReadout = (s, t, pos) => readout(s, -1, t, Math.max(0, Math.min(100, pos)), fms(), speedLimit(app));
  function onLeave() { claim?.leave?.(); if (!drag) { ov = {}; if (st.hover?.axis === axis) st.hover = null; } }

  // ---- paw-5zpf: selection modes 2-4 (elements.js), the active element, Alt+click loop, Ctrl+click path ----
  /** The element under (x, y) in the current mode (-1 in Point mode: points have their own hit). */
  const elAt = (x, y) => (st.selMode === 'point' || x < 0 || x > w ? -1 : hitElement(doc, elements(doc, st.selMode), app.view, w, h, x, y));
  /** Replace the selection; active = the element's point times (it becomes the active one), else the old one stays while still selected. */
  function setSel(ats, active) {
    if (!focused) app.setActiveAxis(axis);
    const s = new Set(ats);
    if (active?.length && active.every((t) => s.has(t))) app.doc.selection = { axis, ats: s, active };
    else app.select(s, axis);
  }
  /** A press on element k of els: what a plain / Shift / Ctrl / Alt click does, and the drag that moves it (anchor: its end nearest x). */
  function pressEl(e, s, els, k, x) {
    const el = els[k], ats = atsOf(s, el), isSel = isSelected(selSet, s, el), add = e.shiftKey, mode = st.selMode;
    let after = null;
    if (e.altKey) after = () => loopAt(s, mode, { el }, ats, add);
    else if (e.ctrlKey) after = () => pathTo(s, els, k, add);
    else if (add) { if (isSel) after = () => setSel(removeElements(selSet, s, els, [k])); else setSel(addElements(selSet, s, els, [k]), ats); }
    else if (!isSel) setSel(ats, ats);
    else after = () => setSel(ats, ats);
    const near = Math.abs(msToX(app.view, w, s[el[0]].at) - x) <= Math.abs(msToX(app.view, w, s[el[1]].at) - x) ? el[0] : el[1];
    return { kind: 'move', anchorAt: s[near].at, after, press: ats };
  }
  /** Alt+click: the loop (elements.js loopOf) replaces the selection or (Shift) adds to it; the clicked element becomes active. */
  function loopAt(s, mode, at, ats, add) {
    const r = loopOf(s, mode, at);
    if (!r) { app.toast(mode === 'point' ? 'Alt+click a peak or a trough: every peak (or trough) of the passage' : 'A hold has no loop: Alt+click a stroke', 'quiet'); setSel(add ? [...selSet, ...ats] : ats, ats); return; }
    setSel(add ? [...selSet, ...r] : r, ats);
  }
  /** Ctrl+click: every element from the active one to element k replaces the selection or (Shift) adds to it; k becomes active. */
  function pathTo(s, els, k, add) {
    const a = activeIdx(s, app.doc.selection), ats = atsOf(s, els[k]);
    let ka = a ? elementOfPoint(els, a[0]) : -1;
    if (ka >= 0 && els[ka][0] !== a[0] && els[ka + 1]?.[0] === a[0]) ka++;   // a shared end: the element that starts there (the active one)
    const r = ka >= 0 ? pathOf(s, els, ka, k) : ats;
    setSel(add ? [...selSet, ...r] : r, ats);
  }
  /** Element hover: its line lit, and what it is. */
  function elHover(s, el, x, y) {
    const v = app.view, line = [];
    for (let i = el[0]; i <= el[1] && line.length < 4000; i++) line.push([msToX(v, w, s[i].at), posToY(h, s[i].pos)]);
    const a = s[el[0]], b = s[el[1]];
    return { x, y, el: line, lines: [`${MODE_LABEL[st.selMode]} ${fmtT(a.at)}–${fmtT(b.at)}  ${a.pos} → ${b.pos}`, 'click selects · Shift toggles · Alt loop · Ctrl path'] };
  }
  /** [els, indices] of the elements whose centre is in the px box (timeOnly: any height), for a drag on empty space and B. */
  function elIn(x0, y0, x1, y1, timeOnly = false) {
    const els = elements(doc, st.selMode), lo = Math.min(x0, x1), hi = Math.max(x0, x1), top = Math.min(y0, y1), bot = Math.max(y0, y1);
    return [els, elementsWhere(doc, els, app.view, w, h, tAt(lo), tAt(hi), (cx, cy) => cx >= lo && cx <= hi && (timeOnly || (cy >= top && cy <= bot)))];
  }

  // ---- B / C (lib/selmodal.js): the same box hit as a drag on empty space; C keeps the points inside its circle ----
  const cur = () => (app.doc.selection.axis === axis ? app.doc.selection.ats : EMPTY);
  const pick = (hits, mode) => { if (!focused) app.setActiveAxis(axis); app.select(combine(cur(), hits, mode), axis); };
  const pickEls = ([els, ks], mode) => { if (!focused) app.setActiveAxis(axis); app.select(combineElements(cur(), doc, els, ks, mode), axis); };
  const select = {
    box: (x0, y0, x1, y1, mode) => (st.selMode !== 'point' ? pickEls(elIn(x0, y0, x1, y1), mode) : pick(boxSelect(doc, app.view, w, h, x0, y0, x1, y1), mode)),
    circle: (cx, cy, r, mode) => (st.selMode !== 'point'
      ? pickEls([elements(doc, st.selMode), elementsWhere(doc, elements(doc, st.selMode), app.view, w, h, tAt(cx - r), tAt(cx + r), (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)], mode)
      : pick(inCircle(boxSelect(doc, app.view, w, h, ...circleBox(cx, cy, r)).map((at) => ({ at, x: msToX(app.view, w, at), y: posToY(h, doc[lowerBound(doc, at)].pos) })), cx, cy, r).map((p) => p.at), mode)),
  };

  // ---- auto-scroll while dragging near / past an edge (lib/edge-scroll.js, as every timeline row): step() re-runs the drag ----
  let follow = null;
  function stopEdge(restore) { follow?.stop(restore); follow = null; }

  // ---- double-click: add a point on empty space / numeric edit on a point ----
  function onDbl(e) {
    const [x, y] = local(e), hit = hitAt(x, y);
    if (hit.kind === 'point') { app.select([doc[hit.i].at], axis); st.popover = { axis, at: doc[hit.i].at }; return; }
    if (hit.kind === 'handle' || hit.kind === 'depth') return;
    if (claim?.dbl?.(e)) return;   // 'playhead' counts as empty: the first click of a double-click put it here
    if (st.dblClick === 'fit') { app.setView({ start: 0, span: app.durationMs }); return; }   // setting lanes.dblClick (View › Zoom to fit)
    if (!editable) { app.toast(axis + ' is locked', 'quiet'); return; }
    if (!inVideo(tAt(x))) { app.toast('Outside the video: no point there', 'quiet'); return; }
    const t = clampT(snapOn(e) ? snapFrame(tAt(x), fms()) : Math.round(tAt(x)));
    const pos = hit.kind === 'segment' && !e.altKey ? posAtInt(doc, t) : Math.round(Math.max(0, Math.min(100, yToPos(h, y))));
    const r = setPointAt(doc, null, { at: t, pos, tolerance: Math.floor(frameLen(fms()) / 2) });
    app.transact('Add point', () => { app.edit('Add point', axis, r.script); app.select(r.ats, axis); });
  }

  // ---- right-click ----
  function onMenu(e) {
    e.preventDefault();
    const [x, y] = local(e);
    if (e.shiftKey) { app.player.seek(clampT(tAt(x)), { exact: true }); return; }   // Blender: Shift+RMB = the cursor (smooth, paw-ef73.14)
    const hit = hitAt(x, y);
    const extra = claim && !OWN.has(hit.kind) ? claim.menu?.(e) : null;
    if (extra === true) return;   // the claim layer's own (a baseline knot removed)
    if (!focused) app.setActiveAxis(axis);
    const ek = hit.kind === 'handle' || hit.kind === 'depth' ? -1 : elAt(x, y), els = ek >= 0 ? elements(doc, st.selMode) : null;
    if (ek >= 0) { if (!isSelected(selSet, doc, els[ek])) { const a = atsOf(doc, els[ek]); setSel(a, a); } }   // paw-5zpf: the element under it
    else if (hit.kind === 'point' && !selSet.has(doc[hit.i].at)) app.select([doc[hit.i].at], axis);
    const t = clampT(snapFrame(tAt(x), fms())), pos = Math.round(Math.max(0, Math.min(100, yToPos(h, y))));
    st.menu = { x: e.clientX, y: e.clientY, items: [
      { label: inVideo(tAt(x)) ? `Add point here (${pos})` : 'Add point here (outside the video)', disabled: !editable || !inVideo(tAt(x)), run: () => { const r = setPointAt(scriptOf(app, axis), null, { at: t, pos, tolerance: Math.floor(frameLen(fms()) / 2) }); app.transact('Add point', () => { app.edit('Add point', axis, r.script); app.select(r.ats, axis); }); } },
      { label: 'Move playhead here', run: () => app.player.seek(t) },
      { sep: true },
      ...contextItems(app, axis),
      ...(Array.isArray(extra) && extra.length ? [{ sep: true }, ...extra] : []),
    ] };
  }

  // ---- wheel: zoom about the cursor, Shift = pan, Ctrl = lane height, pinch = zoom ----
  function onWheel(e) {
    e.preventDefault();
    const [x] = local(e), it = wheelIntent(e);
    if (it.kind === 'zoom') app.setView(zoomAt(app.view, tAt(x), it.amount, dur()));
    else if (it.kind === 'pan') app.setView(panBy(app.view, -it.amount, w, dur()));
    else st.resizeLane?.(axis, it.amount * 16);   // as the lane's grip would: never past what the timeline can give
  }

  onMount(() => {
    st.els[axis] = over;
    const offSel = selTarget({ el: over, ...select });
    over.addEventListener('wheel', onWheel, { passive: false });
    const mq = () => {
      const m = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const f = () => { dpr = window.devicePixelRatio || 1; m.removeEventListener('change', f); mq(); };
      m.addEventListener('change', f);
      return () => m.removeEventListener('change', f);
    };
    const offDpr = mq();
    const mo = new MutationObserver(() => (theme = readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { offSel(); over.removeEventListener('wheel', onWheel); offDpr(); mo.disconnect(); if (st.els[axis] === over) delete st.els[axis]; cancelAnimationFrame(raf); stopEdge(); };
  });
</script>

<div class="lane" class:focused class:locked={!editable} bind:clientWidth={w} bind:clientHeight={hAll}>
  <canvas class="base" bind:this={base} style:height={edge ? h + 'px' : null} aria-hidden="true"></canvas>
  {@render under?.()}
  <OutOfRange {app} />
  <canvas class="over" bind:this={over} style:height={edge ? h + 'px' : null} tabindex={focused ? 0 : -1} style:cursor={cursor}
    aria-label="{axis} lane: {doc.length} points{selIdx.length ? ', ' + selIdx.length + ' selected' : ''}"
    onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onCancel} onlostpointercapture={() => drag && onCancel()}
    onpointerleave={onLeave} ondblclick={onDbl} oncontextmenu={onMenu}></canvas>
</div>

<style>
  .lane { position: relative; height: 100%; min-height: 0; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .over { touch-action: none; outline: none; }
  .lane.focused::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(var(--highlight-rgb), .18); }
  /* keyboard focus on the editing surface (the focused lane is the one tab stop among the lanes) */
  .lane:has(.over:focus-visible)::after { box-shadow: inset 0 0 0 var(--ring-w) var(--focus); }
</style>
