<!--
  GraphEditor: the infinite canvas of the active graph (DESIGN 8.2-8.6).
  .gview (pointer capture, grid background) > .glayer (translate + scale) > frames, one <svg> of wires, DOM node
  cards. Every graph change goes through the controller (ctl.mutate / ctl.gesture): one undo entry per gesture.
  View and selection are editor state (ui.svelte.js); the view persists per graph in app.settings.

  Why DOM cards + one SVG: cards hold real inputs (scrub fields, selects) and must be accessible; pan/zoom only
  rewrites the layer's transform (no layout, no style recalc of the cards: the grid's per-frame variables live on
  their own element). Measured: will-change: transform on the layer made Chrome re-layerize 200 cards every
  frame (40 fps); plain transforms repaint ~3 ms/frame instead. Wires are one SVG inside the layer. Sparklines are per-card canvases that repaint
  only when their value or the time view changes; the playhead and hover cursor are CSS variables on the layer.

  PROVENANCE: ported from OpenValence/Phosphor (same owner, Apache-2.0) src/ui/graph/GraphEditor.svelte: view,
  wheel zoom, pinch, fit (l.190-246), the gest state machine (l.307-437), Bézier wires and fat hit paths
  (l.925-958), marquee, kwire socket wiring (l.470-492), link-drag-search and openPalette placement (l.444-468).
-->
<script>
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import NodeCard from './NodeCard.svelte';
  import Palette from './Palette.svelte';
  import Minimap from './Minimap.svelte';
  import { compat, summarize, TYPES } from '../../lib/graph/types.js';
  import {
    addNode, removeNodes, moveNodes, setParams, setNodeProps, planLink, connect, disconnect, insertOnLink, dissolveNodes,
    duplicate as dupNodes, addFrame, patchFrame, removeFrames, toPreset, applyPreset, snap, GRID,
  } from '../../lib/graph/model.js';
  import {
    toWorld, zoomAt, fitView, boundsOf, boxOf, boxSelect, visibleWorld, overlaps, wirePath, wireAt, strokeCutsWire,
    distToWire, gridOf, centerOn, wheelFactor, K_MIN, K_MAX,
  } from './editor/geometry.js';
  import { eventChord } from '../../app/keymap.js';
  import { classifyDown, passed, pressSelect, releaseSelect, escapeTarget, canvasKey } from './editor/gestures.js';
  import { align as alignRects, distribute as distRects, autoLayout, freeSpot } from './editor/layout.js';
  import { neighbour, followWire as follow, siblings, connectTargets, readingOrder } from './editor/keyboard.js';
  import { writeClip, readClip, pasteSpot, plural } from './editor/clipboard.js';
import { createParamGesture, endOnRelease } from './editor/paramgesture.js';
  import { paletteItems, compatibleItems, titleOf, portLabel, autoBindParams } from './editor/cards.js';
  import { TYPE_COLOR, clearColors, fmtT } from './editor/plot.js';
  import { clip } from './ui.svelte.js';
  import { PRESETS, resolveSlot } from './deps.js';

  let { app, ctl, ui } = $props();

  const g = $derived(ctl.graph);
  const reg = $derived(ctl.registry);
  const prog = $derived(ctl.program);
  const NODE_W = 224, HEAD = 26;

  // ---- derived graph facts --------------------------------------------------------------------------------
  const byId = $derived(new Map((g?.nodes || []).map((n) => [n.id, n])));
  const portsOf = $derived.by(() => {
    const m = new Map();
    for (const n of g?.nodes || []) m.set(n.id, reg.portsOf(n, g));
    return m;
  });
  const titleById = (id) => { const n = byId.get(id); return n ? titleOf(n, reg.get(n.type)) : id; };
  /** Resolved type of a port: declared, or the compiler's resolution of 'any'. */
  function typeAt(id, side, port) {
    const ps = portsOf.get(id);
    const p = ps && (side === 'out' ? ps.outs : [...ps.ins, ...ps.params]).find((q) => q.name === port);
    if (p && p.type !== 'any') return p.type;
    return prog?.types?.get(`${id}:${port}`) || p?.type || 'any';
  }
  const linkInfo = $derived.by(() => {
    const ins = new Map(), outs = new Map();
    for (const n of g?.nodes || []) { ins.set(n.id, new Map()); outs.set(n.id, new Map()); }
    for (const l of g?.links || []) {
      ins.get(l.to)?.set(l.in, { link: l, label: `${titleById(l.from)}.${l.out}` });
      const o = outs.get(l.from);
      if (o) o.set(l.out, (o.get(l.out) || 0) + 1);
    }
    return { ins, outs };
  });
  const frames = $derived(g?.frames || []);

  // ---- view ------------------------------------------------------------------------------------------------
  let vp = $state(), layer = $state();
  let vw = $state(0), vh = $state(0);
  let view = $state({ x: 40, y: 40, k: 1 });
  let moving = $state(false);
  let movingT = 0, saveT = 0;
  const viewKey = (id) => `graph.view.${id}`;
  let viewFor = null, pendingFit = false;
  /** Fit once every card has been measured (a fit on guessed sizes lands off-centre). */
  function fitWhenMeasured() {
    if (!pendingFit || !g || !vw) return;
    if (g.nodes.some((n) => !geo.has(n.id))) return;
    pendingFit = false;
    fit();
  }
  // restore the view when the active graph changes (fit when none was saved)
  $effect(() => {
    const id = g?.id;
    if (!id || id === viewFor) return;
    viewFor = id;
    const saved = untrack(() => app.settings?.get?.(viewKey(id)));
    if (saved && Number.isFinite(saved.k)) view = { x: saved.x, y: saved.y, k: Math.min(K_MAX, Math.max(K_MIN, saved.k)) };
    else { pendingFit = true; tick().then(fitWhenMeasured); }
    untrack(() => ui.select([]));
  });
  $effect(() => { void vw; void vh; untrack(fitWhenMeasured); });   // the viewport may be measured after the cards
  function setView(v) {
    view = v;
    moving = true;
    clearTimeout(movingT);
    movingT = setTimeout(() => { moving = false; reportVisible(); }, 160);
    clearTimeout(saveT);
    const id = g?.id;
    saveT = setTimeout(() => id && app.settings?.set?.(viewKey(id), { x: Math.round(view.x), y: Math.round(view.y), k: +view.k.toFixed(4) }), 400);
  }
  const grid = $derived(gridOf(view, GRID));
  const lod = $derived(view.k < 0.5);

  // ---- measured geometry (ResizeObserver per card) -----------------------------------------------------------
  let geo = $state.raw(new Map());   // id -> { w, h, in: {port: y}, out: {port: y} }
  function readGeo(el) {
    const id = el.dataset.gid, gi = { w: el.offsetWidth, h: el.offsetHeight, in: {}, out: {} };
    if (el.dataset.collapsed == null) {
      for (const row of el.querySelectorAll('[data-row]')) {
        const y = row.offsetTop + row.offsetHeight / 2;
        if (row.dataset.in) gi.in[row.dataset.in] = y;
        if (row.dataset.out) gi.out[row.dataset.out] = y;
      }
    }
    return [id, gi];
  }
  const sameGeo = (a, b) => a && a.w === b.w && a.h === b.h && JSON.stringify(a.in) === JSON.stringify(b.in) && JSON.stringify(a.out) === JSON.stringify(b.out);
  // Created at init, not in onMount: card attachments run before onMount, and the cards present at first mount
  // must be observed too (else geo never fills for them and the initial fit never happens).
  const ro = new ResizeObserver((entries) => {
    let next = null;
    for (const e of entries) {
      if (!e.target.isConnected) continue;
      const [id, gi] = readGeo(e.target);
      if (!sameGeo(geo.get(id), gi)) { next ??= new Map(geo); next.set(id, gi); }
    }
    if (next) { geo = next; if (pendingFit) tick().then(fitWhenMeasured); }
  });
  onDestroy(() => ro.disconnect());
  /** Attachment for each card: observe while mounted. Re-measure after content changes that keep the size. */
  const measure = (el) => {
    ro.observe(el);
    const mo = new MutationObserver(() => {
      const [id, gi] = readGeo(el);
      if (!sameGeo(geo.get(id), gi)) { geo = new Map(geo).set(id, gi); if (pendingFit) tick().then(fitWhenMeasured); }
    });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-collapsed'] });
    return () => { ro.unobserve(el); mo.disconnect(); };
  };
  const sizeOf = (id) => geo.get(id) || { w: NODE_W, h: 90, in: {}, out: {} };

  // ---- drag offsets, positions, sockets ----------------------------------------------------------------------
  let drag = $state.raw(null);        // { ids: Set, dx, dy } while a selection moves (world units)
  let resize = $state.raw(null);      // { id, w, h } while a frame resizes
  const posOf = (n) => (drag && drag.ids.has(n.id) ? [n.x + drag.dx, n.y + drag.dy] : [n.x, n.y]);
  function sockXY(id, side, port) {
    const n = byId.get(id);
    if (!n) return null;
    const [x, y] = posOf(n), s = sizeOf(id);
    const sy = (side === 'out' ? s.out : s.in)[port] ?? HEAD / 2;
    return [side === 'out' ? x + s.w : x, y + sy];
  }
  const rectOf = (n) => { const [x, y] = posOf(n), s = sizeOf(n.id); return { id: n.id, x, y, w: s.w, h: s.h }; };
  const frameRect = (f) => {
    const d = drag && drag.ids.has(f.id) ? [drag.dx, drag.dy] : [0, 0];
    const r = resize && resize.id === f.id ? resize : f;
    return { id: f.id, x: f.x + d[0], y: f.y + d[1], w: r.w, h: r.h };
  };

  const wires = $derived.by(() => {
    const out = [];
    for (const l of g?.links || []) {
      const p1 = sockXY(l.from, 'out', l.out), p2 = sockXY(l.to, 'in', l.in);
      if (!p1 || !p2) continue;
      const t = typeAt(l.from, 'out', l.out);
      out.push({ l, p1, p2, d: wirePath(p1, p2), t, adapter: prog?.adapters?.get(l.id) || null, param: String(l.in).startsWith('p:') });
    }
    return out;
  });
  const touched = $derived(new Set((g?.links || []).filter((l) => ui.sel.has(l.from) || ui.sel.has(l.to)).map((l) => l.id)));

  // ---- culling: tell the controller which cards are on screen (windowed preview) ---------------------------
  let lastVisible = '';
  function reportVisible() {
    if (!g || !vw) return;
    const b = visibleWorld(view, vw, vh, 80);
    const ids = g.nodes.filter((n) => overlaps(rectOf(n), b)).map((n) => n.id);
    const key = ids.join(',');
    if (key !== lastVisible) { lastVisible = key; ctl.setVisible?.(ids); }
  }
  $effect(() => { void g; void vw; void vh; untrack(reportVisible); });
  // the shared time view, widened 25 % each side, is the preview window
  $effect(() => {
    const v = app.view, dur = app.durationMs || 0;
    if (!v || !g) return;
    const pad = v.span * 0.25;
    untrack(() => ctl.requestPreview?.({ t0: Math.max(0, v.start - pad), t1: Math.min(dur || Infinity, v.start + v.span + pad) }));
  });
  // playhead and hover cursor for every sparkline at once: CSS variables (fractions of the time view)
  $effect(() => {
    if (!layer) return;
    const v = app.view, t = app.player?.timeMs ?? 0, h = ctl.hoverTime;
    layer.style.setProperty('--ph', v ? String((t - v.start) / v.span) : '-1');
    layer.style.setProperty('--hv', v && h != null ? String((h - v.start) / v.span) : '-1');
  });
  onMount(() => onThemeChange(() => { clearColors(); geo = new Map(geo); }));
  // a 'select' fix from the controller
  $effect(() => {
    const r = ctl.selectRequest;
    if (r?.node) untrack(() => { ui.select([r.node]); revealNode(r.node); });
  });

  // ---- messages ---------------------------------------------------------------------------------------------
  let flash = $state(null);   // { text, x, y } viewport px
  let flashT = 0;
  function refuse(text, sx, sy) {
    if (!text) return;
    flash = { text, x: Math.max(4, Math.min(sx, vw - 260)), y: Math.min(sy + 14, vh - 40) };
    ui.say(text);
    clearTimeout(flashT);
    flashT = setTimeout(() => { flash = null; }, 3500);
  }
  const vpRect = () => vp.getBoundingClientRect();
  const local = (e) => { const r = vpRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const worldOf = (e) => toWorld(view, ...local(e));

  // ---- mutations --------------------------------------------------------------------------------------------
  function mutate(label, fn, at) {
    const why = ctl.mutate(label, fn);
    if (why) { const p = at || [vw / 2, vh / 2]; refuse(why, p[0], p[1]); }
    return why;
  }
  const paramGest = createParamGesture({ gesture: (l) => ctl.gesture(l), mutate: (l, fn) => ctl.mutate(l, fn) });   // a scrub on a card field = one undo entry
  $effect(() => endOnRelease(paramGest));
  function onParam(id, p, v, commit) {
    const label = `set ${p.label || p.key}`;
    const why = paramGest.change(`${id}:${p.key}`, label, (gr) => setParams(gr, reg, id, { [p.key]: v }), v, commit, byId.get(id)?.params?.[p.key]);
    if (why) refuse(why, vw / 2, vh / 2);
  }
  const onProps = (id, props) => mutate(Object.keys(props)[0] === 'muted' ? (props.muted ? 'bypass' : 'un-bypass') : 'node', (gr) => setNodeProps(gr, id, props));

  // ---- pointer gestures ------------------------------------------------------------------------------------
  let gest = null;
  let box = $state.raw(null);         // { x0, y0, x1, y1 } viewport px
  let knife = $state.raw(null);       // world points
  let wiring = $state.raw(null);      // { from: {node, port, side}, x, y (world), over, why, adapter, reroute }
  let hints = $state.raw(null);       // Map 'node:side:port' -> 'ok' | 'adapter' | 'bad'
  let kwire = $state.raw(null);       // { node, side, port }: a wire started by a click, waiting for its other end
  let spliceTarget = $state(null);    // link id a dragged node would be spliced into
  let space = false;
  let boxMode = $state(false);
  let lastPt = null;                  // last pointer position (viewport px), for paste/add at pointer
  let pasteState = null;              // pasteSpot state: repeated pastes at one spot step down-right
  const touches = new Map();

  function targetKind(t) {
    if (t.closest('.gpal, .gmini, .gover, .ghover')) return { on: 'overlay' };
    const sock = t.closest('[data-sock]');
    if (sock) return { on: 'socket', sock };
    if (t.closest('input, textarea, select, [role=combobox], .k-number-field, .k-switch, .gbtn, .gbadge, .gspark canvas, .gnote-text')) return { on: 'control' };
    if (t.closest('.gwire-hit')) return { on: 'wire', wire: t.closest('.gwire-hit').dataset.link };
    if (t.closest('[data-fedge]')) return { on: 'frameEdge', frame: t.closest('[data-fid]').dataset.fid };
    const node = t.closest('[data-gid]');
    if (node) return { on: 'node', id: node.dataset.gid };
    const fr = t.closest('[data-fhead]');
    if (fr) return { on: 'frame', id: fr.closest('[data-fid]').dataset.fid };
    return { on: 'canvas' };
  }

  let pointerFocus = false;
  function down(e) {
    pointerFocus = true;
    setTimeout(() => (pointerFocus = false), 0);
    lastPt = local(e);
    const tk = targetKind(e.target);
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) {
        const [[ax, ay], [bx, by]] = [...touches.values()];
        gest = { kind: 'pinch', d: Math.hypot(bx - ax, by - ay) || 1, mx: (ax + bx) / 2, my: (ay + by) / 2, v: { ...view } };
        drag = null; box = null; wiring = null;
        return;
      }
    }
    const linked = tk.sock && tk.sock.dataset.side === 'in' && tk.sock.dataset.linked != null;
    const kind = classifyDown({ on: tk.on, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, space, boxMode, linked, side: tk.sock?.dataset.side });
    if (!kind) return;
    if (tk.on !== 'overlay') vp.focus({ preventScroll: true });
    const [sx, sy] = local(e);
    const base = { kind, px: e.clientX, py: e.clientY, sx, sy, moved: false, pid: e.pointerId };
    if (kind === 'pan') {
      e.preventDefault();
      gest = { ...base, v: { ...view } };
    } else if (kind === 'box' || kind === 'box-add' || kind === 'box-toggle') {
      gest = { ...base, base: ui.sel, mode: kind === 'box-add' ? 'add' : kind === 'box-toggle' ? 'toggle' : 'replace' };
    } else if (kind === 'knife') {
      gest = { ...base, pts: [toWorld(view, sx, sy)] };
    } else if (kind === 'move') {
      const id = tk.id, was = ui.sel.has(id);
      const sel = pressSelect(ui.sel, id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      if (sel !== ui.sel) ui.select(sel);
      // moving a frame carries the nodes inside it
      const ids = new Set(sel);
      for (const fid of sel) {
        const f = frames.find((x) => x.id === fid);
        if (f) for (const n of g.nodes) if (n.x >= f.x && n.y >= f.y && n.x <= f.x + f.w && n.y <= f.y + f.h) ids.add(n.id);
      }
      const solo = ids.size === 1 && byId.has(id) && !g.links.some((l) => l.from === id || l.to === id);
      gest = { ...base, id, ids, was, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, solo };
    } else if (kind === 'resize') {
      const f = frames.find((x) => x.id === tk.frame);
      if (f) gest = { ...base, f };
    } else if (kind === 'wire' || kind === 'reroute') {
      const d = tk.sock.dataset;
      let from = { node: d.owner, side: d.side, port: d.port }, reroute = null;
      if (kind === 'reroute') {
        const l = g.links.find((x) => x.to === d.owner && x.in === d.port);
        if (l) { reroute = l; from = { node: l.from, side: 'out', port: l.out }; }
      }
      gest = { ...base, from, reroute, sock: { node: d.owner, side: d.side, port: d.port } };
    } else if (kind === 'wire-select') {
      ui.sel = new Set(); ui.wire = tk.wire;
      gest = null;
      return;
    }
    try { vp.setPointerCapture(e.pointerId); } catch { /* gone */ }
  }

  function move(e) {
    lastPt = local(e);
    if (!gest) return;
    if (gest.kind === 'pinch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      const [[ax, ay], [bx, by]] = [...touches.values()], r = vpRect();
      const k = Math.min(K_MAX, Math.max(K_MIN, (gest.v.k * Math.hypot(bx - ax, by - ay)) / gest.d));
      const wx = (gest.mx - r.left - gest.v.x) / gest.v.k, wy = (gest.my - r.top - gest.v.y) / gest.v.k;
      setView({ k, x: (ax + bx) / 2 - r.left - wx * k, y: (ay + by) / 2 - r.top - wy * k });
      return;
    }
    const dx = e.clientX - gest.px, dy = e.clientY - gest.py;
    if (!gest.moved && !passed(dx, dy)) return;
    const first = !gest.moved;
    gest.moved = true;
    const [sx, sy] = local(e);
    if (gest.kind === 'pan') setView({ ...gest.v, x: gest.v.x + dx, y: gest.v.y + dy });
    else if (gest.kind.startsWith('box')) {
      box = { x0: gest.sx, y0: gest.sy, x1: sx, y1: sy };
    } else if (gest.kind === 'knife') {
      gest.pts.push(toWorld(view, sx, sy));
      knife = [...gest.pts];
    } else if (gest.kind === 'move') {
      drag = { ids: gest.ids, dx: dx / view.k, dy: dy / view.k };
      if (gest.solo) {
        const [wx, wy] = toWorld(view, sx, sy);
        let best = null, bd = 14 / view.k;
        for (const w of wires) { const d = distToWire([wx, wy], w.p1, w.p2); if (d < bd) { bd = d; best = w.l.id; } }
        spliceTarget = best;
      }
    } else if (gest.kind === 'resize') {
      resize = { id: gest.f.id, w: Math.max(120, gest.f.w + dx / view.k), h: Math.max(60, gest.f.h + dy / view.k) };
    } else if (gest.kind === 'wire' || gest.kind === 'reroute') {
      if (first) startWiring(gest.from, gest.reroute);
      const [x, y] = toWorld(view, sx, sy);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const s = hit?.closest?.('[data-sock]');
      let over = null, why = '', adapter = null, body = null;
      if (s && s.dataset.side !== gest.from.side && s.dataset.owner !== gest.from.node) {
        over = { node: s.dataset.owner, side: s.dataset.side, port: s.dataset.port };
        const r = planFor(gest.from, over, gest.reroute);
        why = r.ok ? '' : r.reason; adapter = r.ok ? r.adapter || null : null;
      } else if (!s) {
        const nb = hit?.closest?.('[data-gid]');
        if (nb && nb.dataset.gid !== gest.from.node) body = nb.dataset.gid;
      }
      wiring = { ...wiring, x, y, over, why, adapter, body };
    }
  }

  function up(e) {
    touches.delete(e.pointerId);
    const g0 = gest;
    gest = null;
    if (!g0) return;
    try { vp.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    const [sx, sy] = local(e);
    if (g0.kind === 'pinch' || g0.kind === 'pan') {
      if (g0.kind === 'pan' && !g0.moved && e.button === 0 && !space) { ui.select([]); kwire = null; }
    } else if (g0.kind.startsWith('box')) {
      if (box) {
        const [ax, ay] = toWorld(view, box.x0, box.y0), [bx, by] = toWorld(view, box.x1, box.y1);
        const wb = boxOf(ax, ay, bx, by);
        const rects = [...g.nodes.map(rectOf), ...frames.filter((f) => f.x >= wb.x0 && f.y >= wb.y0 && f.x + f.w <= wb.x1 && f.y + f.h <= wb.y1).map(frameRect)];
        const s = boxSelect(rects, wb, g0.base, g0.mode);
        ui.select(s);
        ui.say(`${s.size} selected`);
      } else if (g0.mode === 'replace') ui.select([]);
      box = null;
    } else if (g0.kind === 'knife') {
      const cut = g0.pts.length > 1 ? wires.filter((w) => strokeCutsWire(g0.pts, w.p1, w.p2)).map((w) => w.l.id) : [];
      knife = null;
      if (cut.length) { mutate(`cut ${cut.length} wire${cut.length > 1 ? 's' : ''}`, (gr) => disconnect(gr, cut)); ui.say(`${cut.length} wires cut`); }
    } else if (g0.kind === 'move') {
      const d = drag;
      drag = null;
      const splice = spliceTarget;
      spliceTarget = null;
      if (g0.moved && d) {
        const lead = byId.get(g0.id) || frames.find((f) => f.id === g0.id);
        const ddx = snap(lead.x + d.dx) - lead.x, ddy = snap(lead.y + d.dy) - lead.y;
        const nodeIds = [...g0.ids].filter((id) => byId.has(id)), fids = [...g0.ids].filter((id) => !byId.has(id));
        mutate(splice ? 'insert on wire' : 'move', (gr) => {
          let r = moveNodes(gr, nodeIds, ddx, ddy);
          for (const fid of fids) { const f = (r.frames || []).find((x) => x.id === fid); if (f) r = patchFrame(r, fid, { x: f.x + ddx, y: f.y + ddy }); }
          if (splice) { const s = insertOnLink(r, reg, splice, g0.id); if (!s.reason) r = s.graph; else ui.say(s.reason); }
          return r;
        }, [sx, sy]);
      } else {
        ui.select(releaseSelect(ui.sel, g0.id, { shift: g0.shift, ctrl: g0.ctrl, was: g0.was }));
      }
    } else if (g0.kind === 'resize') {
      const r = resize;
      resize = null;
      if (r) mutate('resize frame', (gr) => patchFrame(gr, r.id, { w: snap(r.w), h: snap(r.h) }));
    } else if (g0.kind === 'wire' || g0.kind === 'reroute') {
      const w = wiring;
      endWiring();
      if (!g0.moved) { sockClick(g0.sock, sx, sy); return; }
      if (!w) return;
      if (w.over) {
        if (w.why) refuse(w.why, sx, sy);
        else finishLink(w.from, w.over, g0.reroute, [sx, sy]);
      } else if (w.body) {
        portPicker(w.from, w.body, g0.reroute, e);
      } else if (g0.reroute) {
        mutate('detach wire', (gr) => disconnect(gr, [g0.reroute.id]));
      } else {
        openPalette({ at: [sx, sy], from: w.from });
      }
    }
  }

  // ---- wiring ------------------------------------------------------------------------------------------------
  /** planLink for a drag from `from` to socket `to` (either direction); a re-route ignores the link it moves. */
  function planFor(from, to, reroute = null) {
    const link = from.side === 'out' ? { from: from.node, out: from.port, to: to.node, in: to.port } : { from: to.node, out: to.port, to: from.node, in: from.port };
    const gr = reroute ? disconnect(g, [reroute.id]) : g;
    return planLink(gr, reg, link);
  }
  function startWiring(from, reroute) {
    const [x, y] = sockXY(from.node, from.side, from.port) || [0, 0];
    wiring = { from, x, y, over: null, why: '', reroute };
    const h = new Map();
    for (const n of g.nodes) {
      if (n.id === from.node) continue;
      const ps = portsOf.get(n.id);
      const list = from.side === 'out' ? [...ps.ins, ...ps.params].map((p) => ['in', p]) : ps.outs.map((p) => ['out', p]);
      for (const [side, p] of list) {
        const r = planFor(from, { node: n.id, side, port: p.name }, reroute);
        h.set(`${n.id}:${side}:${p.name}`, r.ok ? (r.adapter ? 'adapter' : 'ok') : 'bad');
      }
    }
    hints = h;
  }
  function endWiring() { wiring = null; hints = null; }
  function finishLink(from, to, reroute, at) {
    const link = from.side === 'out' ? { from: from.node, out: from.port, to: to.node, in: to.port } : { from: to.node, out: to.port, to: from.node, in: from.port };
    const why = mutate(reroute ? 're-route wire' : 'connect', (gr) => {
      const base = reroute ? disconnect(gr, [reroute.id]) : gr;
      const r = connect(base, reg, link);
      return r.reason ? { graph: gr, reason: r.reason } : r.graph;
    }, at);
    if (!why) ui.say(`connected ${titleById(link.from)} → ${titleById(link.to)}.${link.in}`);
  }
  /** A wire dropped on a node body: wire the only compatible port, or offer the ports (mod params included). */
  function portPicker(from, nodeId, reroute, e) {
    const ps = portsOf.get(nodeId);
    const list = from.side === 'out' ? [...ps.ins, ...ps.params].map((p) => ['in', p]) : ps.outs.map((p) => ['out', p]);
    const ok = list.map(([side, p]) => ({ side, p, r: planFor(from, { node: nodeId, side, port: p.name }, reroute) })).filter((x) => x.r.ok);
    const at = local(e);
    if (!ok.length) { refuse(`no port of ${titleById(nodeId)} accepts ${typeAt(from.node, from.side, from.port)}`, ...at); return; }
    const unlinked = ok.filter((x) => !linkInfo.ins.get(nodeId)?.has(x.p.name) && !x.p.name.startsWith('p:'));
    if (ok.length === 1 || (unlinked.length === 1 && from.side === 'out')) {
      const x = ok.length === 1 ? ok[0] : unlinked[0];
      finishLink(from, { node: nodeId, side: x.side, port: x.p.name }, reroute, at);
      return;
    }
    showContextMenu(e, [{ section: `Connect to ${titleById(nodeId)}` }, ...ok.map((x) => ({
      label: `${portLabel(x.p)}${x.p.name.startsWith('p:') ? ' (param)' : ''}`, shortcut: x.r.adapter ? x.r.adapter : typeAt(nodeId, x.side, x.p.name),
      run: () => finishLink(from, { node: nodeId, side: x.side, port: x.p.name }, reroute, at),
    }))], { source: vp });
  }
  /** Click a socket, then another (keyboard and touch path, Phosphor kwire). */
  function sockClick(s, sx, sy) {
    if (kwire && kwire.side !== s.side && kwire.node !== s.node) {
      const from = kwire, r = planFor(from, s);
      kwire = null; hints = null;
      if (!r.ok) { refuse(r.reason, sx, sy); return; }
      finishLink(from, s, null, [sx, sy]);
      return;
    }
    if (kwire && kwire.node === s.node && kwire.side === s.side && kwire.port === s.port) { kwire = null; hints = null; ui.say('wiring cancelled'); return; }
    kwire = s;
    startWiring(s, null);
    wiring = null;
    ui.say(`wiring from ${titleById(s.node)}.${s.port}: click a ${s.side === 'out' ? 'input' : 'output'}, Esc cancels`);
  }

  // ---- wheel: pinch / Ctrl = zoom; trackpad two-finger = pan; mouse wheel = zoom ---------------------------
  $effect(() => {
    const el = vp;
    if (!el) return;
    const wheel = (e) => {
      if (e.target.closest('.gpal, .gover, .k-pop')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const trackpad = !e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY * 2)));
      if (trackpad || e.shiftKey) setView({ ...view, x: view.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY) });
      else setView(zoomAt(view, sx, sy, wheelFactor(e.ctrlKey ? e.deltaY * 4 : e.deltaY, e.deltaMode)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  // Keys belong to the command registry (graph keys are `when: focused` commands; Enter on a card is
  // graph.editParam). The canvas only: tracks Space held for Space-drag pan (the registry still runs Space's
  // command on release, and skips it when the pointer was used meanwhile), opens the node search on a letter no
  // command takes, swallows other unclaimed plain keys, and brings focus back to the card on Esc in a card field.
  function keydown(e) {
    const t = e.target;
    const inField = !!t.closest('input, textarea, select, [contenteditable], .gpal, [role=combobox], [role=listbox]');
    const chord = eventChord(e);
    const act = canvasKey({
      chord, inField, prevented: e.defaultPrevented, onCardControl: !!t.closest('[data-gid] .gctl'),
      winner: inField || !chord ? null : app.commands?.winner?.(chord) ?? null,
    });
    if (act === 'card') { const card = t.closest('[data-gid]'); t.blur?.(); card?.focus({ preventScroll: true }); e.stopPropagation(); }
    else if (act === 'search') { e.preventDefault(); openPalette({ query: e.key }); }
    else if (act === 'swallow') e.preventDefault();
  }
  function keyup(e) { if (e.code === 'Space') space = false; }
  /** Enter on a focused card (graph.editParam): its first inline control takes focus; Esc comes back. */
  function editCard() {
    const card = document.activeElement?.closest?.('[data-gid]');
    const c = card?.querySelector('.gctl input, .gctl button, .gctl [tabindex="0"]');
    if (c) { c.focus(); return true; }
    return false;
  }

  // ---- context menus ------------------------------------------------------------------------------------------
  function contextmenu(e) {
    if (e.target.closest('input, textarea, .gpal, .gover')) return;
    e.preventDefault();
    lastPt = local(e);
    const tk = targetKind(e.target);
    if (tk.on === 'node') {
      if (!ui.sel.has(tk.id)) ui.select([tk.id]);
      showContextMenu(e, nodeMenu(tk.id), { source: vp });
    } else if (tk.on === 'wire') {
      ui.select([]); ui.wire = tk.wire;
      showContextMenu(e, [
        { label: 'Insert node on wire…', icon: 'add', run: () => openPalette({ at: lastPt, splice: tk.wire }) },
        { label: 'Delete wire', icon: 'delete', shortcut: 'Del', run: () => mutate('delete wire', (gr) => disconnect(gr, [tk.wire])) },
      ], { source: vp });
    } else if (tk.on === 'frame') {
      ui.select([tk.id]);
      showContextMenu(e, frameMenu(tk.id), { source: vp });
    } else {
      openPalette({ at: lastPt });
    }
  }
  const SERIES_KEYS = ['sky', 'orange', 'green', 'yellow', 'blue', 'vermilion', 'pink', 'grey', 'violet', 'lime'];
  function nodeMenu(id) {
    const n = byId.get(id), many = ui.sel.size > 1;
    return [
      { label: 'Probe output', icon: 'target', shortcut: 'P', run: () => ctl.setProbe?.(id) },
      { label: 'Pin as A', shortcut: 'Alt+A', run: () => ctl.pin?.('A', id) },
      { label: 'Pin as B', shortcut: 'Alt+B', run: () => ctl.pin?.('B', id) },
      { label: 'Snapshot to ghost', icon: 'pin', shortcut: 'S', run: () => ctl.snapshot?.(id) },
      { separator: true },
      { label: n?.muted ? 'Un-bypass' : 'Bypass', icon: 'power', shortcut: 'M', run: () => api.toggleMute() },
      { label: n?.collapsed ? 'Expand' : 'Collapse', shortcut: 'H', run: () => api.toggleCollapse() },
      { label: 'Colour', items: [{ label: 'None', run: () => colorSel(null) }, ...SERIES_KEYS.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), run: () => colorSel(k) }))] },
      { separator: true },
      { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', run: () => api.duplicate() },
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', run: () => api.copy() },
      { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', run: () => api.cut() },
      { label: 'Group in frame', icon: 'frame', shortcut: 'Ctrl+G', run: () => api.group() },
      { label: 'Save selection as preset…', run: () => api.savePreset() },
      ...(many ? [{ label: 'Align', items: [
        { label: 'Left', run: () => api.align('left') }, { label: 'Right', run: () => api.align('right') },
        { label: 'Top', run: () => api.align('top') }, { label: 'Bottom', run: () => api.align('bottom') },
        { label: 'Centre horizontally', run: () => api.align('hcenter') }, { label: 'Centre vertically', run: () => api.align('vcenter') },
        { separator: true }, { label: 'Distribute horizontally', run: () => api.distribute('x') }, { label: 'Distribute vertically', run: () => api.distribute('y') },
      ] }, { label: 'Auto-arrange', run: () => api.arrange() }] : []),
      { separator: true },
      { label: 'Dissolve (keep wires)', shortcut: 'Ctrl+Delete', run: () => api.remove(true) },
      { label: 'Delete', icon: 'delete', shortcut: 'Del', run: () => api.remove(false) },
    ];
  }
  function frameMenu(id) {
    const f = frames.find((x) => x.id === id);
    return [
      { label: f?.note ? 'Edit note' : 'Rename', icon: 'pen', run: () => { editFrame = id; } },
      { label: 'Colour', items: [{ label: 'None', run: () => mutate('frame colour', (gr) => patchFrame(gr, id, { color: null })) },
        ...SERIES_KEYS.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), run: () => mutate('frame colour', (gr) => patchFrame(gr, id, { color: k })) }))] },
      { label: 'Fit to contents', run: () => fitFrame(id) },
      { separator: true },
      { label: f?.note ? 'Delete note' : 'Delete frame (keep nodes)', icon: 'delete', run: () => mutate('delete frame', (gr) => removeFrames(gr, [id])) },
    ];
  }
  function colorSel(k) {
    const ids = [...ui.sel].filter((id) => byId.has(id));
    mutate('colour', (gr) => ids.reduce((acc, id) => setNodeProps(acc, id, { color: k }), gr));
  }

  // ---- palette -----------------------------------------------------------------------------------------------
  let pal = $state.raw(null);  // { x, y (viewport), wx, wy (world), from?, append?, before?, splice?, query, mode }
  const allItems = $derived(paletteItems(reg.list()));
  const presetItems = $derived(PRESETS.map((p) => ({ key: 'preset:' + p.id, type: null, title: p.name, group: 'Presets', help: p.description, aliases: p.tags || [], params: [], ins: [], outs: [], preset: p })));
  const palItems = $derived.by(() => {
    if (!pal) return [];
    if (pal.mode === 'targets') return pal.items;
    const from = pal.from || appendFrom(pal.append);
    if (from) {
      const t = typeAt(from.node, from.side, from.port);
      return compatibleItems(allItems, { side: from.side, type: t, port: from.port }, compat).map((c) => ({ ...c.item, port: c.port, adapter: c.adapter, hint: c.convert ? 'converts' : c.adapter || '' }));
    }
    if (pal.splice) {
      const l = g.links.find((x) => x.id === pal.splice);
      if (!l) return allItems;
      const t = typeAt(l.from, 'out', l.out);
      return compatibleItems(allItems, { side: 'out', type: t, port: l.out }, compat).filter((c) => (c.item.def.outs || []).length).map((c) => c.item);
    }
    return [...allItems, ...presetItems];
  });
  /** Shift+A on a node: append after its first output, like a wire dragged from it (null: no output to wire). */
  function appendFrom(id) {
    const n = id && byId.get(id), o = n && portsOf.get(id)?.outs[0];
    return o ? { node: id, side: 'out', port: o.name } : null;
  }
  function openPalette({ at = null, from = null, append = null, before = null, splice = null, query = '', mode = 'add', items = null, title = '' } = {}) {
    if (!vp || !g) return;
    let p = at;
    if (!p) {
      const r = vpRect();
      const inside = lastPt && lastPt[0] >= 0 && lastPt[1] >= 0 && lastPt[0] <= r.width && lastPt[1] <= r.height;
      p = inside ? lastPt : [vw / 2 - 150, vh / 3];
    }
    let [wx, wy] = toWorld(view, p[0], p[1]);
    if (append || before) {
      const n = byId.get(append || before), s = sizeOf(n.id);
      [wx, wy] = append ? [n.x + s.w + 80, n.y] : [n.x - NODE_W - 80, n.y];
      p = [wx * view.k + view.x, wy * view.k + view.y];
    } else if (from?.side === 'in') wx -= NODE_W;
    if (!from && !splice && !append && !before) {
      const spot = freeSpot(g.nodes.map(rectOf), snap(wx), snap(wy), NODE_W, 100);
      wx = spot.x; wy = spot.y;
    }
    pal = { x: p[0], y: p[1], wx: snap(wx), wy: snap(wy), from, append, before, splice, query, mode, items, title };
  }
  function closePalette() { pal = null; vp?.focus({ preventScroll: true }); }

  function pick(it) {
    const P = pal;
    pal = null;
    vp?.focus({ preventScroll: true });
    if (!P) return;
    if (P.mode === 'targets') { it.run?.(); return; }
    if (it.preset) {
      const r = ctl.applyPreset?.(it.preset.id, { x: P.wx, y: P.wy });
      if (r?.reason) refuse(r.reason, P.x, P.y);
      else if (r?.ids?.length) { ui.select(r.ids); ui.noteRecent(it.key); ui.say(`placed preset ${it.title}`); }
      return;
    }
    ui.noteRecent(it.key);
    let id = null, unwired = '';
    const params = { ...autoBindParams(it.def, ctl.sources, resolveSlot), ...(it.variant?.params || {}) };
    const why = mutate(`add ${it.title}`, (gr) => {
      const r = addNode(gr, reg, it.type, { x: P.wx, y: P.wy, params });
      id = r.id;
      let out = r.graph;
      const ports = reg.portsOf(out.nodes.find((n) => n.id === id), out);
      const tryLink = (link) => { const c = connect(out, reg, link); if (!c.reason) out = c.graph; return c.reason; };
      const from = P.from || appendFrom(P.append);
      if (from) {
        const port = it.port || (from.side === 'out' ? ports.ins[0]?.name : ports.outs[0]?.name);
        const why2 = !port ? 'no compatible port' : from.side === 'out' ? tryLink({ from: from.node, out: from.port, to: id, in: port }) : tryLink({ from: id, out: port, to: from.node, in: from.port });
        if (why2) unwired = why2;
      } else if (P.before) {
        const dst = byId.get(P.before), first = reg.portsOf(dst, gr).ins[0], up = first && gr.links.find((l) => l.to === P.before && l.in === first.name);
        if (up) { const s = insertOnLink(out, reg, up.id, id); if (!s.reason) out = s.graph; }
        else if (first && ports.outs[0]) tryLink({ from: id, out: ports.outs[0].name, to: P.before, in: first.name });
      } else if (P.splice) {
        const s = insertOnLink(out, reg, P.splice, id);
        if (!s.reason) out = s.graph; else ui.say(s.reason);
      }
      return out;
    }, [P.x, P.y]);
    if (!why && id) {
      ui.select([id]); focusNode(id);
      if (unwired) refuse(`added ${it.title}, not connected: ${unwired}`, P.x, P.y); else ui.say(`added ${it.title}`);
    }
  }

  // ---- keyboard API (commands call these through ui.editor) ---------------------------------------------------
  async function focusNode(id) {
    await tick();
    layer?.querySelector(`[data-gid="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
  function revealNode(id) {
    const n = byId.get(id);
    if (!n) return;
    const r = rectOf(n), b = visibleWorld(view, vw, vh, -40);
    if (!(r.x >= b.x0 && r.y >= b.y0 && r.x + r.w <= b.x1 && r.y + r.h <= b.y1)) setView(centerOn(view, r.x + r.w / 2, r.y + r.h / 2, vw, vh));
  }
  function fit() {
    if (!g || !vw) return;
    const rs = [...g.nodes.map(rectOf), ...frames.map(frameRect)];
    setView(rs.length ? fitView(boundsOf(rs), vw, vh, { pad: 48, kMax: 1 }) : { x: 40, y: 40, k: 1 });
  }
  function frameSelection() {
    const rs = [...g.nodes.filter((n) => ui.sel.has(n.id)).map(rectOf), ...frames.filter((f) => ui.sel.has(f.id)).map(frameRect)];
    if (!rs.length) { fit(); return; }
    setView(fitView(boundsOf(rs), vw, vh, { pad: 80, kMax: 1.25 }));
  }
  const selNodes = () => [...ui.sel].filter((id) => byId.has(id));
  const selFrames = () => [...ui.sel].filter((id) => frames.some((f) => f.id === id));
  function current() {
    const a = document.activeElement?.closest?.('[data-gid]')?.dataset.gid;
    return a && byId.has(a) ? a : ui.one && byId.has(ui.one) ? ui.one : null;
  }
  function moveSel(dx, dy) {
    const ids = selNodes(), fids = selFrames();
    if (!ids.length && !fids.length) return;
    mutate('nudge', (gr) => {
      let r = moveNodes(gr, ids, dx, dy);
      for (const fid of fids) { const f = r.frames.find((x) => x.id === fid); r = patchFrame(r, fid, { x: f.x + dx, y: f.y + dy }); }
      return r;
    });
  }
  function walk(dir) {
    const from = current();
    const rects = g.nodes.map(rectOf);
    const id = from ? neighbour(rects, from, dir) : readingOrder(rects)[0];
    if (id) { ui.select([id]); revealNode(id); focusNode(id); }
  }
  let wireIdx = 0, wireFrom = null;
  function followWire(dir) {
    const from = current();
    if (!from) return;
    if (dir === 'down' || dir === 'up') {
      if (wireFrom !== from + dir) { wireFrom = from + dir; wireIdx = 0; }
      const r = follow(g, from, dir, { index: wireIdx++, posOf: (id) => posOf(byId.get(id)), portOrder: (id) => { const p = portsOf.get(id); return [...p.ins, ...p.params].map((q) => q.name); } });
      if (r) { ui.select([r.node]); ui.wire = null; revealNode(r.node); focusNode(r.node); wireFrom = r.node + dir; wireIdx = 0; ui.say(`${titleById(r.node)}`); }
      else ui.say(dir === 'down' ? 'nothing downstream' : 'nothing upstream');
    } else {
      const sib = siblings(g, from, (id) => posOf(byId.get(id)));
      const i = sib.indexOf(from), next = sib[(i + (dir === 'next' ? 1 : -1) + sib.length) % sib.length];
      if (next && next !== from) { ui.select([next]); revealNode(next); focusNode(next); }
    }
  }
  function connectPicker() {
    const id = current();
    if (!id) { ui.say('select a node first'); return; }
    const ps = portsOf.get(id);
    const centre = (nid) => { const r = rectOf(byId.get(nid)); return [r.x + r.w / 2, r.y + r.h / 2]; };
    const plan = (link) => planLink(g, reg, link);
    const opts = [];
    for (const p of ps.outs) for (const t of connectTargets({ graph: g, from: { node: id, port: p.name, side: 'out' }, portsOf: (n) => portsOf.get(n), plan, posOf: centre }))
      opts.push({ key: `o:${p.name}>${t.node}:${t.port}`, title: `${portLabel(p)} → ${titleById(t.node)} · ${t.label}`, group: t.adapter ? `via ${t.adapter}` : 'direct', help: t.replace ? 'replaces its current wire' : '', ins: [], outs: [t.type], run: () => finishLink({ node: id, side: 'out', port: p.name }, { node: t.node, side: 'in', port: t.port }, null) });
    for (const p of [...ps.ins, ...ps.params]) for (const t of connectTargets({ graph: g, from: { node: id, port: p.name, side: 'in' }, portsOf: (n) => portsOf.get(n), plan, posOf: centre }))
      opts.push({ key: `i:${p.name}<${t.node}:${t.port}`, title: `${portLabel(p)} ← ${titleById(t.node)} · ${t.label}`, group: t.adapter ? `via ${t.adapter}` : 'direct', help: linkInfo.ins.get(id)?.has(p.name) ? 'replaces its current wire' : '', ins: [t.type], outs: [], run: () => finishLink({ node: id, side: 'in', port: p.name }, { node: t.node, side: 'out', port: t.port }, null) });
    if (!opts.length) { ui.say('nothing on the canvas can connect to this node'); return; }
    const r = rectOf(byId.get(id));
    openPalette({ at: [(r.x + r.w) * view.k + view.x + 8, r.y * view.k + view.y], mode: 'targets', items: opts, title: `Connect ${titleById(id)}` });
  }
  function copy(cut = false) {
    const ids = selNodes();
    if (!ids.length) { ui.say('nothing selected'); return; }
    const frag = toPreset(g, ids, { name: g.name });
    clip.text = writeClip(frag);
    navigator.clipboard?.writeText?.(clip.text).catch(() => {});
    if (cut) mutate(`cut ${plural(ids.length, 'node')}`, (gr) => removeFrames(removeNodes(gr, ids), selFrames()));
    ui.say(`${cut ? 'cut' : 'copied'} ${plural(ids.length, 'node')}`);
  }
  async function paste() {
    let frag = readClip(clip.text);
    if (!frag) { try { frag = readClip(await navigator.clipboard.readText()); } catch { /* no permission */ } }
    if (!frag) { ui.say('nothing to paste'); return; }
    const p = lastPt || [vw / 2, vh / 2];
    const [wx, wy] = toWorld(view, p[0], p[1]);
    const spot = pasteSpot(pasteState, snap(wx), snap(wy), 2 * GRID);
    let ids = [];
    const why = mutate(`paste ${plural(frag.nodes.length, 'node')}`, (gr) => { const r = applyPreset(gr, reg, frag, { x: spot.x, y: spot.y }); ids = r.ids; return r.graph; });
    if (!why) pasteState = spot.state;
    if (ids.length) { ui.select(ids); ui.say(`pasted ${plural(ids.length, 'node')}`); }
  }
  function duplicate() {
    const ids = selNodes();
    if (!ids.length) return;
    let map = {};
    mutate(`duplicate ${ids.length}`, (gr) => { const r = dupNodes(gr, ids, { dx: 2 * GRID, dy: 2 * GRID }); map = r.map; return r.graph; });
    const made = Object.values(map);
    if (made.length) { ui.select(made); focusNode(made[0]); }
  }
  function remove(heal = false) {
    if (ui.wire) { const w = ui.wire; ui.wire = null; mutate('delete wire', (gr) => disconnect(gr, [w])); return; }
    const ids = selNodes(), fids = selFrames();
    if (!ids.length && !fids.length) return;
    mutate(heal ? `dissolve ${ids.length}` : `delete ${ids.length + fids.length}`, (gr) => removeFrames(heal ? dissolveNodes(gr, reg, ids) : removeNodes(gr, ids), fids));
    ui.select([]);
    vp?.focus({ preventScroll: true });
  }
  function selectAll() { ui.select([...g.nodes.map((n) => n.id), ...frames.map((f) => f.id)]); }
  function applyMoves(label, moves) {
    if (!moves.length) return;
    mutate(label, (gr) => ({ ...gr, nodes: gr.nodes.map((n) => { const m = moves.find((x) => x.id === n.id); return m ? { ...n, x: m.x, y: m.y } : n; }) }));
  }
  const selRects = () => g.nodes.filter((n) => ui.sel.has(n.id)).map(rectOf);
  function group(note = false) {
    const rs = note ? [] : [...selRects(), ...frames.filter((f) => ui.sel.has(f.id)).map(frameRect)];
    let id;
    if (note || !rs.length) {
      const p = lastPt || [vw / 2, vh / 2], [wx, wy] = toWorld(view, p[0], p[1]);
      mutate('add note', (gr) => { const r = addFrame(gr, { title: 'Note', x: snap(wx), y: snap(wy), w: 220, h: 120, color: 'yellow' }); id = r.id; return patchFrame(r.graph, r.id, { note: true, text: '' }); });
    } else {
      const b = boundsOf(rs);
      mutate('group in frame', (gr) => { const r = addFrame(gr, { title: 'Frame', x: snap(b.x0 - 20), y: snap(b.y0 - 60), w: snap(b.x1 - b.x0 + 40) + 20, h: snap(b.y1 - b.y0 + 80) + 20, color: null }); id = r.id; return r.graph; });
    }
    if (id) { ui.select([id]); editFrame = id; }
  }
  function fitFrame(id) {
    const f = frames.find((x) => x.id === id);
    const inside = g.nodes.filter((n) => n.x >= f.x && n.y >= f.y && n.x <= f.x + f.w && n.y <= f.y + f.h).map(rectOf);
    const b = boundsOf(inside);
    if (b) mutate('fit frame', (gr) => patchFrame(gr, id, { x: snap(b.x0 - 20), y: snap(b.y0 - 60), w: snap(b.x1 - b.x0 + 40) + 20, h: snap(b.y1 - b.y0 + 80) + 20 }));
  }
  function savePreset() {
    const ids = selNodes();
    if (!ids.length) { ui.say('select the nodes to save'); return; }
    const name = (typeof prompt === 'function' ? prompt('Preset name', 'My preset') : 'My preset')?.trim();
    if (!name) return;
    const p = { ...toPreset(g, ids, { name }), id: 'user-' + Date.now().toString(36), user: true };
    const list = app.settings?.get?.('graph.presets') || [];
    app.settings?.set?.('graph.presets', [...list, p]);
    ui.say(`saved preset ${name}`);
    app.toast?.(`Saved preset "${name}" (${ids.length} nodes)`, 'ok');
  }
  const escState = () => ({ gesture: !!(gest || wiring || kwire || box || knife), palette: !!pal, maximised: ui.maximised, selection: ui.sel.size, wire: ui.wire });
  function escape() {
    const t = escapeTarget(escState());
    if (t === 'gesture') {
      if (gest?.kind === 'move') drag = null;
      if (gest?.kind === 'resize') resize = null;
      gest = null; endWiring(); kwire = null; box = null; knife = null; spliceTarget = null;
      ui.say('cancelled');
    } else if (t === 'palette') closePalette();
    else if (t === 'maximise') ui.maximised = false;
    else if (t === 'selection') ui.select([]);
    return !!t;
  }
  const api = {
    openPalette, fit, frameSelection, connectPicker, followWire, walk, moveSel, copy, cut: () => copy(true), paste, duplicate,
    remove, selectAll, escape, editCard, escapable: () => !!escapeTarget(escState()), focusNode, revealNode, savePreset, group, note: () => group(true),
    align: (m) => applyMoves('align', alignRects(selRects(), m)),
    distribute: (axis) => applyMoves('distribute', distRects(selRects(), axis)),
    arrange: () => {
      const ids = ui.sel.size > 1 ? new Set(selNodes()) : null;
      const rs = g.nodes.filter((n) => !ids || ids.has(n.id)).map(rectOf);
      applyMoves('auto-arrange', autoLayout(rs, g.links));
      if (!ids) tick().then(fit);
    },
    toggleMute: () => { const ids = selNodes(); if (!ids.length) return; const on = !ids.every((id) => byId.get(id).muted); mutate(on ? 'bypass' : 'un-bypass', (gr) => ids.reduce((a, id) => setNodeProps(a, id, { muted: on }), gr)); },
    toggleCollapse: () => { const ids = selNodes(); if (!ids.length) return; const on = !ids.every((id) => byId.get(id).collapsed); mutate(on ? 'collapse' : 'expand', (gr) => ids.reduce((a, id) => setNodeProps(a, id, { collapsed: on }), gr)); },
    toggleDiff: () => { const ids = selNodes(); const s = new Set(ui.diff); for (const id of ids) if (s.has(id)) s.delete(id); else s.add(id); ui.diff = s; },
    /** Place a preset (or a saved selection) below the existing nodes and frame it. */
    placePreset(p) {
      const rs = [...g.nodes.map(rectOf), ...frames.map(frameRect)], b = boundsOf(rs);
      const [cx, cy] = toWorld(view, 60, 60);
      const at = b ? { x: snap(b.x0), y: snap(b.y1 + 80) } : { x: snap(cx), y: snap(cy) };
      let ids = [];
      if (p.user) mutate(`place ${p.name}`, (gr) => { const r = applyPreset(gr, reg, p, at); ids = r.ids; return r.graph; });
      else { const r = ctl.applyPreset?.(p.id, at); if (r?.reason) refuse(r.reason, vw / 2, vh / 3); ids = r?.ids || []; }
      if (ids.length) { ui.select(ids); ui.say(`placed ${p.name}`); tick().then(() => tick()).then(frameSelection); }
    },
    current,
    get pointer() { return lastPt; },
  };
  $effect(() => { ui.editor = api; return () => { if (ui.editor === api) ui.editor = null; }; });

  // ---- frames: inline title / note editing ------------------------------------------------------------------
  let editFrame = $state(null);
  function commitFrame(id, patch) { editFrame = null; mutate('edit frame', (gr) => patchFrame(gr, id, patch)); vp?.focus({ preventScroll: true }); }
  const autofocus = (el) => { el.focus(); el.select?.(); };

  // ---- wire hover card -----------------------------------------------------------------------------------------
  let hover = $state.raw(null);
  let hoverT = 0;
  function wireEnter(e, w) {
    clearTimeout(hoverT);
    const at = local(e);
    hoverT = setTimeout(() => {
      const v = ctl.valueOf?.(w.l.from, w.l.out);
      let sum = '';
      try { sum = v === undefined ? 'no value yet' : summarize(w.t, v); } catch { sum = ''; }
      hover = { x: at[0], y: at[1], w, sum };
    }, 300);
  }
  function wireLeave() { clearTimeout(hoverT); hover = null; }

  // ---- card props --------------------------------------------------------------------------------------------
  const sparkFor = (n) => {
    const ps = portsOf.get(n.id), o = ps?.outs?.[0];
    if (!o) return null;
    const t = typeAt(n.id, 'out', o.name);
    if (t === 'number') return null;
    const v = ctl.valueOf?.(n.id, o.name);
    const view2 = app.view;
    if (!view2) return null;
    let overlay = null, overlayType = null;
    if (ui.diff.has(n.id)) {
      const first = ps.ins[0], l = first && linkInfo.ins.get(n.id)?.get(first.name)?.link;
      if (l) { overlay = ctl.valueOf?.(l.from, l.out); overlayType = typeAt(l.from, 'out', l.out); }
    }
    return { type: t, value: v, t0: view2.start, t1: view2.start + view2.span, overlay, overlayType };
  };
  const minimapRects = $derived((g?.nodes || []).map((n) => ({ ...rectOf(n), sel: ui.sel.has(n.id), err: false })));
</script>

<!-- paw-ks21: Space reaches only the key map (commands.js guardKey), so Space-held for Space-drag pan is observed on window -->
<svelte:window onkeydowncapture={(e) => { if (e.code === 'Space' && !e.repeat && vp?.contains(document.activeElement)) space = true; }} />
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="gview" bind:this={vp} bind:clientWidth={vw} bind:clientHeight={vh} tabindex="0" role="application"
     aria-label={`Graph canvas: ${g?.name ?? ''}. Shift+A adds a node, C connects, arrows move, Alt+arrows follow wires.`}
     data-mode={boxMode ? 'box' : 'pan'} data-moving={moving ? '' : null}
     onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={contextmenu}
     onkeydown={keydown} onkeyup={keyup}
     onscroll={() => { if (vp.scrollLeft || vp.scrollTop) { vp.scrollLeft = 0; vp.scrollTop = 0; } }}
     onfocusin={(e) => { const id = e.target.closest?.('[data-gid]')?.dataset.gid; if (id && !pointerFocus) { if (e.target.dataset.gid && !ui.sel.has(id)) ui.select([id]); revealNode(id); } }}
     ondblclick={(e) => { const tk = targetKind(e.target); if (tk.on === 'canvas') openPalette({ at: local(e) }); else if (tk.on === 'frame') editFrame = tk.id; }}>
  <!-- the grid's variables live on their own element: changing them per frame on .gview would restyle every card -->
  <div class="ggrid" aria-hidden="true" style:--cell={grid.cell + 'px'} style:--major={grid.major + 'px'}
       style:transform={`translate(${(((grid.x % grid.major) + grid.major) % grid.major) - grid.major}px, ${(((grid.y % grid.major) + grid.major) % grid.major) - grid.major}px)`}></div>
  <div class="glayer" bind:this={layer} data-lod={lod ? '' : null} style:transform={`translate(${view.x}px, ${view.y}px) scale(${view.k})`}>
    {#each frames as f (f.id)}
      {@const r = frameRect(f)}
      <div class="gframe" data-fid={f.id} data-note={f.note ? '' : null} data-sel={ui.sel.has(f.id) ? '' : null}
           style:left={r.x + 'px'} style:top={r.y + 'px'} style:width={r.w + 'px'} style:height={r.h + 'px'}
           style:--fc={f.color ? `var(--series-${f.color})` : 'var(--line-4)'}>
        <div class="gframe-head" data-fhead>
          {#if editFrame === f.id && !f.note}
            <input class="gframe-in" value={f.title} {@attach autofocus} aria-label="Frame title"
                   onkeydown={(e) => { if (e.key === 'Enter') commitFrame(f.id, { title: e.currentTarget.value }); if (e.key === 'Escape') { e.stopPropagation(); editFrame = null; } }}
                   onblur={(e) => commitFrame(f.id, { title: e.currentTarget.value })} />
          {:else}
            <span class="gframe-title">{f.note ? 'Note' : f.title || 'Frame'}</span>
          {/if}
        </div>
        {#if f.note}
          {#if editFrame === f.id}
            <textarea class="gnote-text" value={f.text || ''} {@attach autofocus} aria-label="Note text"
                      onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); commitFrame(f.id, { text: e.currentTarget.value }); } }}
                      onblur={(e) => commitFrame(f.id, { text: e.currentTarget.value })}></textarea>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="gnote-body" data-fhead ondblclick={() => (editFrame = f.id)}>{f.text || 'Double-click to write a note'}</div>
          {/if}
        {/if}
        <div class="gframe-edge" data-fedge aria-hidden="true"></div>
      </div>
    {/each}

    <svg class="gwires" aria-hidden="true">
      {#each wires as w (w.l.id)}
        <path class="gwire" d={w.d} style:--wc={`var(--series-${TYPE_COLOR[w.t] || 'grey'})`}
              data-sel={ui.wire === w.l.id ? '' : null} data-touch={touched.has(w.l.id) ? '' : null}
              data-param={w.param ? '' : null} data-splice={spliceTarget === w.l.id ? '' : null} />
        <path class="gwire-hit" d={w.d} data-link={w.l.id} role="presentation"
              onpointerenter={(e) => wireEnter(e, w)} onpointerleave={wireLeave} />
        {#if w.adapter}
          {@const m = wireAt(w.p1, w.p2, 0.5)}
          <rect class="gadapt" x={m[0] - 4} y={m[1] - 4} width="8" height="8" transform={`rotate(45 ${m[0]} ${m[1]})`}
                {@attach tooltip(w.adapter === 'sample' ? `script read as signal: linear @ ${g.rate} Hz` : 'number read as a constant signal')} />
        {/if}
      {/each}
    </svg>

    {#each g?.nodes || [] as n (n.id)}
      {@const def = reg.get(n.type)}
      {@const [x, y] = posOf(n)}
      <NodeCard node={n} {def} ports={portsOf.get(n.id)} typeOf={(side, port) => typeAt(n.id, side, port)}
                inLinks={linkInfo.ins.get(n.id)} outCount={linkInfo.outs.get(n.id)} {x} {y} selected={ui.sel.has(n.id)}
                status={ctl.statusOf?.(n.id)} bake={n.type === 'out.axis' ? ctl.bakeStatus?.(n.id) : null}
                spark={n.collapsed ? null : sparkFor(n)} sources={ctl.sources} {hints} armed={kwire ? `${kwire.node}:${kwire.side}:${kwire.port}` : null}
                {lod} diffOn={ui.diff.has(n.id)} dropTarget={wiring?.body === n.id} {measure}
                onparam={(p, v, c) => onParam(n.id, p, v, c)} onprops={(pr) => onProps(n.id, pr)}
                onsock={(e, side, port) => { if (e.detail === 0) sockClick({ node: n.id, side, port }, ...local(e)); }}
                onhover={(t) => { if (ctl) ctl.hoverTime = t; }} onseek={(t) => app.player?.seek?.(t)}
                onbadge={() => { ui.select([n.id]); ui.setInspector(true); }} />
    {/each}

    <!-- the wire being dragged, the link-drag-search stub and the knife draw above the cards -->
    <svg class="gwires" aria-hidden="true">
      {#if wiring}
        {@const p = sockXY(wiring.from.node, wiring.from.side, wiring.from.port)}
        {#if p}
          {@const q = wiring.over ? sockXY(wiring.over.node, wiring.over.side, wiring.over.port) || [wiring.x, wiring.y] : [wiring.x, wiring.y]}
          <path class="gwire gwire-live" data-bad={wiring.why ? '' : null} data-adapter={wiring.adapter ? '' : null}
                style:--wc={`var(--series-${TYPE_COLOR[typeAt(wiring.from.node, wiring.from.side, wiring.from.port)] || 'grey'})`}
                d={wiring.from.side === 'out' ? wirePath(p, q) : wirePath(q, p)} />
        {/if}
      {/if}
      {#if pal?.from}
        {@const p = sockXY(pal.from.node, pal.from.side, pal.from.port)}
        {#if p}<path class="gwire gwire-live" d={pal.from.side === 'out' ? wirePath(p, [pal.wx, pal.wy + 13]) : wirePath([pal.wx + NODE_W, pal.wy + 13], p)} />{/if}
      {/if}
      {#if knife && knife.length > 1}
        <polyline class="gknife" points={knife.map((p) => p.join(',')).join(' ')} />
      {/if}
    </svg>
  </div>

  {#if !g?.nodes?.length}
    <div class="gempty">
      <p class="gempty-t">Empty graph</p>
      <p>Double-click, right-click or press <kbd>Shift</kbd>+<kbd>A</kbd> to add a node · type to search</p>
      <p>or start from a preset in the toolbar</p>
    </div>
  {/if}
  {#if box}
    <div class="gbox" style:left={Math.min(box.x0, box.x1) + 'px'} style:top={Math.min(box.y0, box.y1) + 'px'}
         style:width={Math.abs(box.x1 - box.x0) + 'px'} style:height={Math.abs(box.y1 - box.y0) + 'px'}></div>
  {/if}
  {#if wiring && (wiring.over || wiring.body)}
    <p class="gcursor" data-bad={wiring.why ? '' : null} style:left={wiring.x * view.k + view.x + 16 + 'px'} style:top={wiring.y * view.k + view.y + 14 + 'px'}>
      {wiring.why || (wiring.body ? 'release to pick a port' : wiring.adapter ? `release to connect (${wiring.adapter} adapter)` : 'release to connect')}
    </p>
  {/if}
  {#if flash}<p class="gcursor gflash" data-bad style:left={flash.x + 'px'} style:top={flash.y + 'px'} role="alert">{flash.text}</p>{/if}
  {#if hover}
    <div class="ghover k-pop" style:left={Math.min(hover.x + 14, vw - 240) + 'px'} style:top={Math.min(hover.y + 14, vh - 70) + 'px'}>
      <div class="ghover-t"><span class="gchip" style:--tc={`var(--series-${TYPE_COLOR[hover.w.t]})`}></span>{TYPES[hover.w.t]?.label || hover.w.t}
        {#if hover.w.adapter}<span class="ghover-a">◆ {hover.w.adapter}</span>{/if}</div>
      <div class="ghover-s k-num">{hover.sum}</div>
      <div class="ghover-p">{titleById(hover.w.l.from)}.{hover.w.l.out} → {titleById(hover.w.l.to)}.{hover.w.l.in}</div>
    </div>
  {/if}

  <div class="gover gzoom" role="toolbar" aria-label="View">
    <button type="button" class="gzb" onclick={() => setView(zoomAt(view, vw / 2, vh / 2, 1 / 1.25))} aria-label="Zoom out" {@attach tooltip('Zoom out')}><Icon name="zoom-out" size={14} /></button>
    <button type="button" class="gzb gzk k-num" onclick={() => setView(zoomAt(view, vw / 2, vh / 2, 1 / view.k))} {@attach tooltip('Reset zoom to 100 %')}>{Math.round(view.k * 100)}%</button>
    <button type="button" class="gzb" onclick={() => setView(zoomAt(view, vw / 2, vh / 2, 1.25))} aria-label="Zoom in" {@attach tooltip('Zoom in')}><Icon name="zoom-in" size={14} /></button>
    <button type="button" class="gzb" onclick={fit} aria-label="Fit all" {@attach tooltip('Fit all', 'Home')}><Icon name="zoom-fit" size={14} /></button>
    <button type="button" class="gzb" aria-pressed={boxMode} onclick={() => (boxMode = !boxMode)} aria-label="Box select" {@attach tooltip('Drag selects (else Shift+drag)')}><Icon name="select" size={14} /></button>
  </div>
  {#if g?.nodes?.length}
    <Minimap rects={minimapRects} frames={frames.map(frameRect)} {view} {vw} {vh} onview={setView} />
  {/if}
  {#if pal}
    <Palette items={palItems} x={pal.x} y={pal.y} {vw} {vh} query={pal.query} flat={!!pal.from || !!appendFrom(pal.append) || !!pal.splice || pal.mode === 'targets'}
             title={pal.title || (pal.from ? `Connect ${typeAt(pal.from.node, pal.from.side, pal.from.port)} ${pal.from.side === 'out' ? 'to' : 'from'}…` : pal.splice ? 'Insert on wire' : pal.append ? `Append after ${titleById(pal.append)}` : pal.before ? `Insert before ${titleById(pal.before)}` : 'Add node')}
             recent={ui.recent} favs={ui.favs} onfav={(k) => ui.toggleFav(k)} onpick={pick} onclose={closePalette} />
  {/if}
</div>

<style>
  .gview { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; outline: none; touch-action: none; cursor: default; background-color: var(--bg-sunken);
    user-select: none; -webkit-user-select: none; }   /* Shift+click on cards and frames selects them, never page text */
  .gview :global(input), .gview :global(textarea) { user-select: text; -webkit-user-select: text; }
  /* panning moves the grid by a compositor transform (never a repaint); only zoom changes its cell size */
  .ggrid {
    position: absolute; left: 0; top: 0; width: calc(100% + 2 * var(--major)); height: calc(100% + 2 * var(--major)); pointer-events: none; will-change: transform;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--line-2) 55%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--line-2) 55%, transparent) 1px, transparent 1px),
      radial-gradient(circle, var(--line-2) 1px, transparent 1.2px);
    background-size: var(--major) var(--major), var(--major) var(--major), var(--cell) var(--cell);
    background-position: 0 0, 0 0, calc(var(--cell) / -2) calc(var(--cell) / -2);
  }
  .gview:focus-visible { box-shadow: inset 0 0 0 1px rgba(var(--highlight-rgb), .45); }
  .gview[data-mode='box'] { cursor: crosshair; }
  .glayer { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
  .gwires { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
  .gwire { fill: none; stroke: var(--wc); stroke-width: 2; opacity: .78; stroke-linecap: round; }
  .gwire[data-param] { stroke-dasharray: 5 3; }
  .gwire[data-touch] { opacity: 1; stroke-width: 2.5; }
  .gwire[data-sel] { stroke: var(--highlight); opacity: 1; stroke-width: 3; }
  .gwire[data-splice] { stroke: var(--reality); opacity: 1; stroke-width: 4; }
  .gwire-live { opacity: 1; stroke-dasharray: 6 4; }
  .gwire-live[data-bad] { stroke: var(--bad-ink); }
  .gwire-live[data-adapter] { stroke-dasharray: 2 4; }
  .gwire-hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: pointer; }
  .gadapt { fill: var(--bg-card); stroke: var(--warn-ink); stroke-width: 1.5; pointer-events: auto; }
  .gknife { fill: none; stroke: var(--bad-ink); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .gview[data-moving] .gwire-hit { pointer-events: none; }

  .gframe { position: absolute; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--fc) 55%, transparent); border-radius: var(--radius);
    background: color-mix(in srgb, var(--fc) 7%, transparent); }
  .gframe[data-sel] { border-color: var(--highlight); }
  .gframe-head { height: 28px; display: flex; align-items: center; padding: 0 8px; cursor: grab;
    background: color-mix(in srgb, var(--fc) 16%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--fc) 30%, transparent); }
  .gframe-title { font-family: var(--font-head, var(--font)); font-size: var(--fs-3); font-weight: 600; color: var(--tx-hi); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gframe-in { width: 100%; height: 22px; font: inherit; font-size: var(--fs-3); color: var(--tx-hi); background: var(--bg-sunken); border: 1px solid var(--focus); border-radius: var(--radius); padding: 0 6px; }
  .gframe-edge { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--fc) 60%, transparent) 50%); }
  .gframe[data-note] { background: color-mix(in srgb, var(--fc) 13%, var(--bg-card)); box-shadow: 0 4px 14px -6px rgba(var(--shade-rgb), .5); }
  .gnote-body { padding: 8px 10px; font-size: var(--fs-2); line-height: 1.45; color: var(--tx); white-space: pre-wrap; overflow: hidden; height: calc(100% - 28px); box-sizing: border-box; cursor: grab; }
  .gnote-text { display: block; width: 100%; height: calc(100% - 28px); box-sizing: border-box; padding: 8px 10px; resize: none; font: inherit; font-size: var(--fs-2); line-height: 1.45;
    color: var(--tx-hi); background: var(--bg-sunken); border: 0; outline: 1px solid var(--focus); }

  .gempty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 4px; pointer-events: none; color: var(--tx-mut); font-size: var(--fs-2); }
  .gempty p { margin: 0; }
  .gempty-t { font-family: var(--font-head, var(--font)); font-size: var(--fs-5) !important; color: var(--tx) !important; margin-bottom: 4px !important; }
  .gempty kbd { font-family: var(--mono); font-size: var(--fs-1); padding: 0 4px; border: 1px solid var(--line-3); border-radius: var(--radius); background: var(--bg-card); color: var(--tx); }
  .gbox { position: absolute; border: 1px solid var(--highlight); background: rgba(var(--highlight-rgb), .08); pointer-events: none; }
  .gcursor { position: absolute; z-index: 4; max-width: 260px; margin: 0; padding: 3px 7px; font-size: var(--fs-1); pointer-events: none;
    background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius); color: var(--tx); box-shadow: var(--shadow-1); }
  .gcursor[data-bad] { color: var(--bad-ink); border-color: color-mix(in srgb, var(--bad-ink) 60%, transparent); }
  .ghover { position: absolute; z-index: 5; min-width: 180px; max-width: 260px; padding: 6px 8px; pointer-events: none; font-size: var(--fs-1);
    background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius); box-shadow: var(--shadow-2); }
  .ghover-t { display: flex; align-items: center; gap: 6px; color: var(--tx-hi); font-weight: 600; }
  .ghover-a { margin-left: auto; color: var(--warn-ink); font-weight: 400; }
  .ghover-s { margin-top: 3px; color: var(--tx-val); }
  .ghover-p { margin-top: 3px; color: var(--tx-mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gchip { width: 8px; height: 8px; border-radius: 50%; background: var(--tc); flex: none; }

  .gzoom { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 1px; padding: 2px; z-index: 3;
    background: color-mix(in srgb, var(--bg-card) 92%, transparent); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-1); }
  .gzb { display: grid; place-items: center; min-width: 24px; height: 22px; padding: 0 4px; border: 1px solid transparent; border-radius: var(--radius);
    background: none; color: var(--tx-mut); cursor: pointer; font-size: var(--fs-1); }
  .gzb:hover { color: var(--tx-hi); border-color: var(--line-3); }
  .gzb[aria-pressed='true'] { color: var(--reality); border-color: var(--reality); }
  .gzk { min-width: 40px; }
</style>
