<script>
  // The Modifiers row (paw-ef73.20, owner: "two places you can mark knotting, two places you can mark orgasm, they need to
  // be one"): every modifier (doc.fx, lib/fx.js) as a block in its kind's colour, in every tab. The event kinds (orgasm,
  // knotting, throbbing, idle, insertion, pull-out) are marked and edited in any tab; the kinds that only modify existing
  // strokes (Reshape, Climax run-in, Spurt) are drawn everywhere but dimmed and not editable outside Refine. Modifiers are
  // layers: they may overlap (applied in t0 order, later on top) and overlaps stack in sub-rows (fx-edit fxRows).
  // Gestures: drag on empty row = mark a modifier (the last used kind; a kind picker at release changes it), Alt / Shift /
  // Ctrl+drag on empty row = box select (Shift adds, Ctrl subtracts); drag a body to move (an orgasm takes its spurts), an
  // edge to resize (snaps to the stroke's turns, cuts, edges, range, playhead; Shift no snap; others never move); Alt+drag a
  // modifier = a copy; double-click = the kind's default span (fx-edit defaultSpan: re-fits one, or adds one on the empty
  // row); edges and spurts take the pointer within FX_EDGE_PX; the strength envelope is drawn on the block; click selects (Shift adds;
  // in Refine it also opens the curve popover: FxEditor, direct manipulation); right-click: the kinds at the click, or
  // the modifier's own menu. Keys: commands-fx.js (G / S / X / Shift+D / A ...) and commands-mods.js (Shift+O / Shift+K
  // mark in / out). A pending mark-in is a dashed line. Spurts are diamonds on their frame (an orgasm's inner events).
  // The tagger's detected orgasm / knotting (a scene never has one as a tag, paw-8b4h) is a dashed box over its scene
  // until one of the kind is there: a click on it makes the modifier over the scene (mods.js modHints, paw-ef73.24).
  // Tracked or generated (mods-tracked.js): each event modifier's label says which it is ("tracked: balls" when a run
  // over it has its reacting part's signal, else "generated"); in the Track tab the modifier at the playhead (or the
  // selected one) that is not tracked offers ONE prompt, "seed <part> for accurate depth": the Groups tool on a frame of
  // the shot inside it, that part armed (paint, then Track that shot). Nothing is switched by hand: track it and it is.
  // A suggestion, never automatic: when the scene at the playhead has a balls contraction channel (the pinned balls group
  // seeded from the tagger, sem_balls_scale, else a tracked part named balls with a _scale channel; the label says which),
  // a quiet button offers its contraction peaks as spurts (first click / hover = hollow ghost diamonds, then place = one
  // undo step; commands-fx ballsSpurts / placeSpurts). Off (no run, no balls group, balls seen too rarely, a run from
  // before PROTOCOL v4.6) the button still shows, greyed, with the reason (tip, inline hint, status line on click), on an
  // orgasm / throbbing and on any scene while the row is focused or hovered (balls.js ballsReason).
  import { untrack } from 'svelte';
  import { xToMs } from '../../lib/lane.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { fmtMs } from '../../lib/video.js';
  import { Popover, showContextMenu } from '../../ui/kit/index.js';
  import FxEditor from './FxEditor.svelte';
  import CanvasLane from './CanvasLane.svelte';
  import { tl, listOf, cutsOf, newId, durOf, setDraft, clearDraft, scenesOf } from './state.svelte.js';
  import { sceneAtPlayhead } from './scenes.js';
  import { trackingOf, machineKnots } from './deps.js';
  import { hitInterval, snapContext, localX, CLICK_PX } from './interact.js';
  import { snapDelta, snapTime, spansIn, combineIds } from './intervals.js';
  import { theme, font, X, ellipsize, drawRange } from './draw.js';
  import { fitText, thin, freeSlot } from './lod.js';
  import { KIND, rgba } from './kinds.js';
  import { FX_KINDS, isPointFx, fxParams, envFlat, strength, knotMode, baseTurns } from '../../lib/fx.js';
  import { modItems, kindHere } from './fxmenu.js';
  import { detectedMods } from './acts.js';
  import { dropSpan, fxRows, dragFx, linkMembers, FX_EDGE_PX, turnSnaps, defaultSpan } from './fx-edit.js';
  import { makeMod, modAt, modLabel, modHints, modOver } from './mods.js';
  import { REACTS, sourceText, sourcesOf } from './mods-tracked.js';
  import { trackChoices, trackerWord, ownRuns, hasSeed, seedsOf, ARM } from './mod-runs.js';
  import { paintSeed, trackMod, setSource, correctHere } from '../tracking/mod-track.js';
  import { trackingFor } from '../tracking/tracking.svelte.js';
  import { commitFx, focusFxLane, ballsSpurts, ballsWhy, placeSpurts, selIds, addModifier, spurtAtPlayhead, trackedOf, shotRun } from './commands-fx.js';
  import { toggleModCmd, MARK_KEYS } from './commands-mods.js';
  import CumBar from './CumBar.svelte';
  import { drawCum, cumTip, cumScene } from './cum.svelte.js';   // proposed cumshots (detect cumshots): ghost diamonds + bar
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  let { app } = $props();
  const fxColor = (k) => KIND[k]?.color ?? FX_KINDS[k]?.color ?? theme().txMut;
  const list = $derived(listOf(app, 'fx'));
  const lay = $derived(fxRows(list));
  const tab = $derived(app.mode);
  /** Editable here: an event kind anywhere, the rest in Refine. */
  const editable = (e) => kindHere(e.kind, app.mode);
  /** The kind a drag on empty row marks: the last used one when it can be made in this tab, else orgasm. */
  const drawKind = () => (kindHere(tl.modKind, app.mode) && !FX_KINDS[tl.modKind]?.point ? tl.modKind : 'orgasm');
  const minLen = () => Math.round(app.player.frameMs) || 100;
  let root = $state(), lw = $state(0), hover = $state.raw(null), drag = null, press = null, box = $state.raw(null);
  const isSel = (id) => id === tl.fx || tl.fxSel.includes(id);
  const cursor = $derived(hover?.part === 't0' || hover?.part === 't1' ? 'ew-resize' : hover ? 'grab' : 'crosshair');
  const keyText = Object.values(MARK_KEYS).join(' / ');
  /** id -> what drives it (mods-tracked trackedBy) for the tracked ones; the rest are generated. */
  const tracked = $derived.by(() => { app.doc.fx; app.doc.ghosts; scriptOf(app, 'stroke'); trackingOf(app)?.runs; return untrack(() => trackedOf(app).by); });
  /** The label's tail: ' · tracked: SAM shaft · own run' / ' · tracked: balls · shot run' / ' · generated' (event kinds; idle is generated only). */
  const how = (e) => knotText(e) + (!FX_KINDS[e.kind]?.event ? '' : tracked.get(e.id) ? ` · ${sourceText(tracked.get(e.id), trackerWord)}` : ' · generated');
  /** paw-r9nh: a knotting's mode as it plays (auto flips with the strokes under it: said, never silent); paw-35pp: a One knot
   *  / Unknot over 3 strokes or more is flagged (it replaces them all with one push). -> {mode, auto, strokes, many} | null. */
  const knotOf = (e) => {
    if (e.kind !== 'knotting') return null;
    const p = fxParams(e), base = app.doc.axes?.stroke || [], mode = knotMode(p, base, e.t0, e.t1), strokes = Math.floor(baseTurns(base, e.t0, e.t1).length / 2);
    return { mode, auto: !p.mode, strokes, many: mode !== 'cycles' && strokes >= 3 };
  };
  const knotText = (e) => { const k = knotOf(e); return k ? ` · ${k.mode === 'single' ? 'one knot' : k.mode}${k.auto ? ' (auto)' : ''}${k.many ? ` over ${k.strokes} strokes!` : ''}` : ''; };
  /** paw-ef73.24: the tagger's detected orgasm / knotting with none of the kind over its scene: dashed, a click adds it. */
  const hints = $derived(modHints(scenesOf(app), list));
  const hintAt = (t) => hints.find((g) => t >= g.t0 && t < g.t1) ?? null;

  // paw-bg90: spurts closer than their diamonds are thinned (lod.js thin, a selected one always): a row of diamonds at a
  // whole-video zoom, never a bar. Only the drawn ones take the pointer (hitAt / anyAt); zoom in for the others.
  let shownPts = new Set();
  function thinPoints(w, rh) {
    const r = Math.max(3, Math.min(6, rh / 2 - 1)), byRow = new Map();
    for (const e of list) if (isPointFx(e)) { const k = lay.row.get(e.id); byRow.set(k, [...(byRow.get(k) || []), e]); }
    shownPts = new Set();
    for (const g of byRow.values()) {
      const keep = thin(g.map((e) => { const x = X(app.view, w, e.t0); return { x0: x - r, x1: x + r, force: isSel(e.id) }; }), 1);
      g.forEach((e, k) => { if (keep[k]) shownPts.add(e.id); });
    }
  }
  function paint(ctx, w, h) {
    const T = theme(), v = app.view, rh = h / lay.rows;
    thinPoints(w, rh);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    if (!list.length && !tl.modMark && !hints.length && w > 300) { ctx.font = font(9); ctx.fillStyle = T.txMut; ctx.fillText(`Modifiers: drag here to mark ${modLabel(drawKind()).toLowerCase()} · ${keyText}: in, again: out · right-click: the kinds`, 6, h / 2 + 0.5); }
    for (const g of hints) {   // paw-ef73.24: the tagger's detection, dashed over its scene (a click makes it; nothing applied)
      const a = Math.max(0, X(v, w, g.t0)) + 1, b = Math.min(w, X(v, w, g.t1)) - 1;
      if (b - a < 2) continue;
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = fxColor(g.kind); ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, 1.5, b - a - 1, h - 3); ctx.restore();
      if (b - a > 40 && h >= 10) { ctx.font = font(Math.min(10, h - 4)); ctx.fillStyle = T.txMut; const txt = ellipsize(ctx, `${modLabel(g.kind).toLowerCase()}? tagger · click to add`, b - a - 10); if (txt) ctx.fillText(txt, a + 5, h / 2 + 0.5); }
    }
    for (const e of list) {
      const x0 = X(v, w, e.t0), x1 = X(v, w, e.t1), dim = !editable(e);
      if (x1 < -6 || x0 > w + 6) continue;
      if (isPointFx(e)) {   // a spurt: a diamond on its frame, not a block
        if (!shownPts.has(e.id)) continue;
        const cy = lay.row.get(e.id) * rh + rh / 2, r = Math.max(3, Math.min(6, rh / 2 - 1)), sel = isSel(e.id);
        ctx.globalAlpha = e.muted || dim ? 0.35 : 1;
        ctx.beginPath(); ctx.moveTo(x0, cy - r); ctx.lineTo(x0 + r, cy); ctx.lineTo(x0, cy + r); ctx.lineTo(x0 - r, cy); ctx.closePath();
        if (e.baked) { ctx.strokeStyle = fxColor(e.kind); ctx.lineWidth = 1.5; ctx.stroke(); } else { ctx.fillStyle = fxColor(e.kind); ctx.fill(); }   // baked: hollow
        if (sel) { ctx.strokeStyle = T.txHi; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.globalAlpha = 1;
        continue;
      }
      const a = Math.max(0, x0), b = Math.min(w, x1), c = fxColor(e.kind), sel = isSel(e.id), y = lay.row.get(e.id) * rh, bh = rh - 1;
      ctx.globalAlpha = e.muted || dim ? 0.35 : 1;
      if (!e.baked) { ctx.fillStyle = rgba(c, sel ? 0.42 : 0.24); ctx.fillRect(a, y + 1, b - a, bh - 1); }   // baked: hollow (in the axis already)
      else { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, y + 1.5, b - a - 1, bh - 2); }
      ctx.fillStyle = c; ctx.fillRect(a, y + bh - 1, b - a, 1.5);
      if (x0 >= 0) ctx.fillRect(x0, y + 1, 2, bh - 1);
      if (x1 <= w) ctx.fillRect(x1 - 2, y + 1, 2, bh - 1);
      if (sel) { ctx.strokeStyle = T.txHi; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, y + 1.5, b - a - 1, bh - 2); }
      if (!e.baked && !e.muted && x1 - x0 > 16 && rh >= 8) {   // paw-r9nh: the strength envelope drawn on the block (flat: nothing)
        const p = fxParams(e);
        if (!envFlat(p)) {
          ctx.strokeStyle = c; ctx.lineWidth = 1.25; ctx.beginPath();
          for (let k = 0; k <= 40; k++) { const xx = x0 + ((x1 - x0) * k) / 40, yy = y + bh - 2 - (bh - 4) * strength(k / 40, p) * (1 - p.follow / 2); k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
          ctx.stroke();
        }
      }
      const kv = e.kind === 'knotting' && !e.muted ? machineKnots?.verdict(app, e.t0, e.t1) : null;
      if (((kv && !kv.ok) || knotOf(e)?.many) && x1 - 12 > a) {   // the Machine says this knot would not go in, or a One knot over many strokes (paw-35pp): a warning glyph at its end
        const gx = Math.min(b, x1) - 9, gy = y + rh / 2;
        ctx.fillStyle = T.warn; ctx.beginPath(); ctx.moveTo(gx, gy - 5); ctx.lineTo(gx + 5, gy + 4); ctx.lineTo(gx - 5, gy + 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = T.bg; ctx.fillRect(gx - 0.75, gy - 2, 1.5, 3.5); ctx.fillRect(gx - 0.75, gy + 2.25, 1.5, 1.25);
      }
      if (rh >= 10) {   // paw-tog0: its name while three letters and an ellipsis fit (lod.js fitText)
        ctx.font = font(Math.min(10, rh - 2), false, sel ? 600 : 400); ctx.fillStyle = sel ? T.txHi : T.txVal;
        const txt = fitText(ctx, (e.label || FX_KINDS[e.kind]?.label || e.kind) + (e.muted ? ' · muted' : e.baked ? ' · baked' : how(e)), b - a - 10);
        if (txt) ctx.fillText(txt, a + 6, y + rh / 2);
      }
      ctx.globalAlpha = 1;
    }
    const groups = new Map();   // linked modifiers: a thin line along the top from the first member to the last, a tick at each
    for (const e of list) if (e.link) groups.set(e.link + '|' + e.kind, [...(groups.get(e.link + '|' + e.kind) || []), e]);
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const xs = g.map((e) => X(v, w, (e.t0 + e.t1) / 2)), lo = Math.min(...xs), hi = Math.max(...xs);
      if (hi < 0 || lo > w) continue;
      ctx.fillStyle = rgba(fxColor(g[0].kind), 0.8);
      ctx.fillRect(Math.max(0, lo), 0, Math.min(w, hi) - Math.max(0, lo), 1);
      for (const x of xs) ctx.fillRect(x - 0.5, 0, 1, 4);
    }
    if (box) {
      const a = X(v, w, Math.min(box.t0, box.t1)), b = X(v, w, Math.max(box.t0, box.t1));
      ctx.fillStyle = T.txHi; ctx.globalAlpha = 0.08; ctx.fillRect(a, 0, b - a, h); ctx.globalAlpha = 1;
      ctx.strokeStyle = T.txHi; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, 0.5, b - a - 1, h - 1);
    }
    if (tl.modMark) {   // a pending mark-in (Shift+O / Shift+K once): a dashed line and "orgasm from here"
      const x = X(v, w, tl.modMark.t), col = fxColor(tl.modMark.id);
      ctx.strokeStyle = col; ctx.setLineDash([2, 2]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = font(9, false, 600); ctx.fillStyle = col; ctx.fillText(`${modLabel(tl.modMark.id).toLowerCase()} from here`, x + 4, h / 2 + 0.5);
    }
    if (sug && (sugGhost || sugArmed)) {   // the suggested spurts: hollow, dashed diamonds (nothing placed yet)
      const cy = rh / 2, r = Math.max(3, Math.min(6, rh / 2 - 1));
      ctx.strokeStyle = fxColor('spurt'); ctx.lineWidth = 1.25; ctx.setLineDash([2, 2]);
      for (const t of sug.times) {
        const x = X(v, w, t);
        if (x < -6 || x > w + 6) continue;
        ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy); ctx.closePath(); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    drawCum(ctx, app, w, rh, fxColor('spurt'));   // proposed cumshots (strong solid, weak hollow)
    drawRange(ctx, v, w, h, app.doc.range);
  }

  /** The editable modifier part under the pointer, in the sub-row under it. */
  function hitAt(e) {
    const el = root?.querySelector('canvas');
    if (!el) return null;
    const r = el.getBoundingClientRect(), row = Math.floor(((e.clientY - r.top) / Math.max(1, r.height)) * lay.rows), x = e.clientX - r.left;
    const inRow = list.filter((it) => lay.row.get(it.id) === row && editable(it));
    let best = null, bd = FX_EDGE_PX;   // spurt markers first (a point has no edges: the whole marker moves it)
    for (const it of inRow) if (isPointFx(it) && shownPts.has(it.id)) { const d = Math.abs(X(app.view, r.width, it.t0) - x); if (d < bd) { bd = d; best = it; } }
    return best ? { item: best, part: 'body' } : hitInterval(inRow.filter((it) => !isPointFx(it)), app.view, r.width, x, FX_EDGE_PX);
  }
  /** The editable modifiers a box from t0 to t1 touches: the drag on empty space, B and C (lib/selmodal.js). */
  const boxHits = (a, b) => spansIn(list.filter(editable), a, b).map((x) => x.id);
  const pick = (ids) => { tl.fxSel = ids; tl.fx = ids[0] ?? null; };
  const select = { box: (t0, _y0, t1, _y1, mode) => pick(combineIds(selIds(app), boxHits(t0, t1), mode)) };
  /** Any modifier under the pointer (a dimmed one too): for its words. */
  function anyAt(e) {
    const el = root?.querySelector('canvas');
    if (!el) return null;
    const r = el.getBoundingClientRect(), row = Math.floor(((e.clientY - r.top) / Math.max(1, r.height)) * lay.rows), t = xToMs(app.view, r.width, e.clientX - r.left);
    return list.find((it) => lay.row.get(it.id) === row && (isPointFx(it) ? shownPts.has(it.id) && Math.abs(X(app.view, r.width, it.t0) - (e.clientX - r.left)) < FX_EDGE_PX : t >= it.t0 && t < it.t1)) ?? null;
  }
  const hoverText = (_t, _x, ev) => {
    const e = ev ? anyAt(ev) : null, g = !e ? hintAt(_t) : null;
    if (g) return `The tagger saw ${modLabel(g.kind).toLowerCase()} in this scene: a suggestion, nothing applied\nclick: a ${modLabel(g.kind)} modifier over the scene (then trim it)`;
    if (!e) return cumTip(app, _x, lw) || `Modifiers: drag to mark one (${modLabel(drawKind()).toLowerCase()}; a picker at release changes it; its edges land on stroke turns, Shift: free) · double-click: one over the shot · ${keyText} at the playhead: in, again: out · right-click: the kinds`;
    const kv = e.kind === 'knotting' && machineKnots ? machineKnots.text(machineKnots.verdict(app, e.t0, e.t1)) : '';
    const tip = !editable(e) ? 'modifies existing strokes: edit it in Refine' : tab === 'refine' ? 'click: its curve · right-click: more' : 'drag the ends or the middle · right-click: kind, delete · its curve: Refine';
    const k = knotOf(e), many = k?.many ? `\n${k.strokes} tracked strokes under it all become ONE ${k.mode === 'single' ? 'push' : 'pull'}: Knot mode › Cycles (Refine) keeps a knot on each` : '';
    return `${FX_KINDS[e.kind]?.label ?? e.kind}${e.muted ? ' (muted)' : how(e)}\n${isPointFx(e) ? fmtMs(e.t0) : `${fmtMs(e.t0)}–${fmtMs(e.t1)}`} · ${tip} · double-click: fit it to the ${e.kind === 'insertion' || e.kind === 'pullout' ? 'stroke' : 'shot'} · Alt+drag: a copy${kv ? `\nMachine: ${kv}` : ''}${many}`;
  };

  // one drag at a time: tl.draft.fx while moving, ONE app.transact on release; other modifiers never move (layers)
  /** paw-r9nh: the stroke's turns in view join the snap targets (an edge lands on a turn by default; Shift: free, on frames). */
  const withTurns = (sc) => { const v = app.view; sc.targets = [...sc.targets, ...turnSnaps(app.doc.axes?.stroke, v.start, v.start + v.span)].sort((a, b) => a.t - b.t); return sc; };
  function down(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget, w = el.clientWidth, hit = hitAt(e), x0 = localX(e, el), sc = withTurns(snapContext(app, w));
    press = { hit, t: xToMs(app.view, w, x0), shift: e.shiftKey };
    if (!hit) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) {   // a box once it moves (a click stays a click: up)
        box = { t0: press.t, t1: press.t, el, w, x0, moved: false, mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'sub' : 'replace', sel0: selIds(app) };
      } else drag = { el, w, x0, t0: press.t, base: app.doc.fx || [], draw: drawKind(), sc, moved: false, result: null };   // mark one: the last used kind
      el.setPointerCapture?.(e.pointerId);
      return;
    }
    let base = app.doc.fx || [], it = hit.item, dup = false;
    if (e.altKey) {   // paw-r9nh: Alt+drag a modifier = a copy follows the pointer, the original stays (its spurts stay with it)
      it = { ...it, id: newId('fx') }; delete it.baked;
      base = [...base, it].sort((a, b) => a.t0 - b.t0); dup = true;
    }
    if (!e.shiftKey) { tl.fx = it.id; tl.fxSel = []; }
    sc.targets = [...sc.targets, ...base.filter((x) => x.id !== it.id).flatMap((x) => [{ t: x.t0, label: 'modifier' }, { t: x.t1, label: 'modifier' }])].sort((a, b) => a.t - b.t);
    drag = { el, w, x0, t0: press.t, base, it, part: dup ? 'body' : hit.part, sc, moved: false, result: base, dup, orig: hit.item.id };
    el.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (box) {   // a drag on empty space: every editable modifier the box touches, combined with the selection by the key held
      const x = localX(e, box.el);
      if (!box.moved && Math.abs(x - box.x0) < CLICK_PX) return;
      const t = xToMs(app.view, box.w, x);
      box = { ...box, t1: t, moved: true };
      pick(combineIds(box.sel0, boxHits(box.t0, t), box.mode));
      return;
    }
    if (drag) {
      const d = drag, x = localX(e, d.el);
      if (!d.moved && Math.abs(x - d.x0) < CLICK_PX) return;
      d.moved = true;
      const t = xToMs(app.view, d.w, x), o = { dur: durOf(app), minLen: minLen() };
      const sc = e.shiftKey ? { targets: [], tol: 0, frameMs: d.sc.frameMs } : d.sc;
      let s;
      if (d.draw) {   // marking: from the press to the pointer, frame-snapped (Shift: no targets)
        const a = snapTime(d.t0, sc.targets, sc.tol, sc.frameMs).t; s = snapTime(t, sc.targets, sc.tol, sc.frameMs);
        d.id ??= newId('fx');
        const t0 = Math.max(0, Math.min(a, s.t)), t1 = Math.min(o.dur, Math.max(a, s.t));
        d.result = t1 - t0 >= 1 ? [...d.base, makeMod(d.id, d.draw, t0, t1, null, app.doc.axes?.stroke)].sort((p, q) => p.t0 - q.t0) : null;
      } else if (d.part === 'body') { s = snapDelta([d.it.t0, d.it.t1], t - d.t0, sc.targets, sc.tol, sc.frameMs); d.result = dragFx(d.base, d.it.id, 'body', { ...o, dt: s.dt, inner: !d.dup }); }
      else { s = snapTime(t, sc.targets, sc.tol, sc.frameMs); d.result = dragFx(d.base, d.it.id, d.part, { ...o, t: s.t }); }
      tl.snap = s.target ? { t: s.target.t, label: s.target.label } : null;
      setDraft('fx', d.result ?? d.base);
      // the video shows the frame under the dragged edge (a body: its start; marking: the pointer's end), as an action region's
      // drag does (ScenesLane actMove: player.dragTo, decoded frames while paused; scrubEnd on release)
      const it = d.draw ? null : d.result?.find((x) => x.id === d.it.id), at = d.draw ? s.t : it?.[d.part === 't1' ? 't1' : 't0'];
      if (Number.isFinite(at)) app.player.dragTo(Math.max(0, at), { snap: true });
      return;
    }
    const h = hitAt(e), next = h ? { id: h.item.id, part: h.part } : null;
    if (next?.id !== hover?.id || next?.part !== hover?.part) hover = next;
  }
  function up(e) {
    const p = press, d = drag; press = null; drag = null;
    if (d?.moved) app.player.scrubEnd?.();
    const b = box;
    box = null;
    if (b?.moved || (b && b.mode !== 'replace')) return;   // a box, or Shift / Ctrl+click on empty space (nothing)
    const g = d?.draw && !d.moved && p && e.button === 0 ? hintAt(p.t) : null;
    if (g) { clearDraft('fx'); toggleModCmd(app, g.kind, { t0: g.t0, t1: g.t1 }); app.usage?.note?.('mods:hint', { kind: g.kind }); return; }   // the tagger's suggestion taken
    if (b || (d?.draw && !d.moved)) { clearDraft('fx'); if (p && e.button === 0) { tl.fx = tl.fxPop = null; tl.fxSel = []; app.player.seek(p.t, { exact: true }); } return; }
    if (!d) return;
    clearDraft('fx'); tl.snap = null;
    if (d.draw) {   // a marked modifier: committed, then a kind picker at the pointer
      if (!d.result) return;
      commitFx(app, `Mark ${modLabel(d.draw)}`, d.result);
      tl.fx = d.id; tl.fxSel = [];
      app.usage?.note?.('mods:add', { kind: d.draw, how: 'draw' });
      showContextMenu(e, [{ section: 'Kind' }, ...modItems(tab, (k) => setKind(d.id, k), { checked: d.draw, points: false })], { source: root });
      return;
    }
    if (!d.moved && p?.shift) {   // Shift+click: add to / take out of the selection
      const id = d.it.id, cur = tl.fxSel.length ? tl.fxSel : tl.fx ? [tl.fx] : [];
      tl.fxSel = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      tl.fx = tl.fxSel.includes(id) ? id : tl.fxSel[0] ?? null;
      return;
    }
    if (d.dup && !d.moved) { tl.fx = d.orig; return; }   // an Alt+click: nothing copied
    if (!d.moved) { if (tab === 'refine') tl.fxPop = d.it.id; return; }   // the curve is a Refine thing
    if (d.result !== d.base || d.dup) commitFx(app, d.dup ? 'Duplicate modifier' : d.part === 'body' ? 'Move modifier' : 'Resize modifier', d.result);
  }
  /** paw-r9nh: double-click = the kind's default span at that time (fx-edit defaultSpan: a push / pull from turn to turn, the
   *  rest the shot): on a modifier it re-fits that one (one undo step), on the empty row it adds the drawing kind there. */
  function dbl(e) {
    if (e.button !== 0 || !root) return;
    const r = root.getBoundingClientRect(), t = xToMs(app.view, r.width, e.clientX - r.left), hit = hitAt(e)?.item ?? null, kind = hit?.kind ?? drawKind();
    const g = defaultSpan(kind, t, { cuts: cutsOf(app), dur: durOf(app), script: app.doc.axes?.stroke || [], minLen: minLen() });
    if (!g) return;
    if (!hit) { addModifier(app, kind, g); return; }
    if (g.t0 === hit.t0 && g.t1 === hit.t1) return;
    commitFx(app, `Fit ${modLabel(kind)} to the ${kind === 'insertion' || kind === 'pullout' ? 'stroke' : 'shot'}`, (app.doc.fx || []).map((x) => (x.id === hit.id ? (({ baked: _, ...q }) => ({ ...q, t0: g.t0, t1: g.t1 }))(x) : x)).sort((a, b) => a.t0 - b.t0));
  }
  function cancel() { drag = null; press = null; box = null; clearDraft('fx'); tl.snap = null; }
  /** The kind picker's pick: modifier id becomes kind k (its params back to k's defaults). */
  function setKind(id, k) {
    tl.modKind = k;
    app.commands.run(`timeline.fx.kind.${k}`, { id });
  }

  function menu(e) {
    e.preventDefault();
    const r = root.getBoundingClientRect(), t = xToMs(app.view, r.width, e.clientX - r.left), at = Math.round(app.player.snap ? app.player.snap(t) : t);
    const fx = hitAt(e)?.item ?? null;
    const run = (id, args) => () => app.commands.run(id, args);
    if (!fx) {   // the kinds at the click: an event kind 4 s from here (drag its ends), Reshape / Climax over the scene, a spurt on this frame
      showContextMenu(e, [{ section: 'Modifier here' }, ...modItems(tab, (k) => menuAdd(at, k))], { source: root });
      return;
    }
    if (!tl.fxSel.includes(fx.id)) tl.fxSel = [];
    tl.fx = fx.id;
    const sel = selIds(app), kinds = sel.map((id) => list.find((x) => x.id === id)?.kind), multi = sel.length > 1;
    const linkable = kinds.some((k, i) => kinds.indexOf(k) !== i), linked = multi ? sel.some((id) => list.find((x) => x.id === id)?.link) : !!fx.link;
    showContextMenu(e, [
      { section: multi ? `${sel.length} modifiers selected` : `${FX_KINDS[fx.kind]?.label ?? fx.kind} ${fmtMs(fx.t0)}${isPointFx(fx) ? '' : `–${fmtMs(fx.t1)}`}` },
      ...(multi ? [{ label: 'Link', tip: 'Same kind: one set of params (their spans stay their own)', disabled: !linkable, run: run('timeline.fx.link') }] : []),
      ...(linked ? [{ label: multi ? 'Unlink' : `Unlink (×${linkMembers(list, fx.id).length})`, tip: 'Each keeps the params it has now', run: run('timeline.fx.unlink', multi ? undefined : { id: fx.id }) }] : []),
      ...(multi || linked ? [{ separator: true }] : []),
      ...(tab === 'refine' ? [{ label: 'Curve…', tip: 'Its curve: drag the handles', run: () => { tl.fxPop = fx.id; } }] : []),
      ...(isPointFx(fx) ? [] : [{ label: 'Kind', tip: 'Change the kind, with that kind\'s default params', items: modItems(tab, (k) => setKind(fx.id, k), { checked: fx.kind, points: false }) }]),
      ...(fx.kind === 'orgasm' ? [{ label: 'Detect cumshots', tip: 'Propose one spurt per cumshot in this orgasm', disabled: !app.commands.enabled('timeline.cum.detect'), run: () => app.commands.run('timeline.cum.detect', { t0: fx.t0, t1: fx.t1 }) }] : []),
      ...(isPointFx(fx) ? [] : [{ label: 'Select its range', tip: 'The I / O range over it', run: () => { app.doc.range = { t0: fx.t0, t1: fx.t1 }; } }]),
      ...(REACTS[fx.kind] && !multi ? trackItems(fx) : []),
      { label: fx.muted ? 'Unmute' : 'Mute', tip: 'Off: nothing is lost', run: run('timeline.fx.mute', { id: fx.id }) },
      ...(fx.baked ? [{ label: 'Un-bake', tip: 'Live again (it was taken into the axis)', run: run('timeline.fx.unbake', { id: fx.id }) }] : []),
      { label: 'Duplicate', tip: 'A copy right after it', run: run('timeline.fx.duplicate', { id: fx.id }) },
      { separator: true },
      multi ? { label: 'Delete this one', tip: 'X deletes the whole selection', run: run('timeline.fx.remove', { id: fx.id }) }   // X deletes the whole selection: its key belongs to that, not to this one
        : { label: 'Delete', tip: fx.kind === 'orgasm' ? 'With its spurts' : 'Undo brings it back', shortcut: app.commands.keysFor('timeline.fx.delete')?.[0], run: run('timeline.fx.remove', { id: fx.id }) },
    ], { source: root });
  }

  // ---- paw-ef73.26: a modifier's own runs (Track ▸), its source (Source ▸), its SAM masks (see / correct) ----
  function trackItems(fx) {
    const tr = trackingFor(app);
    if (!tr.listed) tr.ensureListed?.();
    const choices = trackChoices(tr.trackers), mine = ownRuns(tr.runs, fx), seeded = hasSeed(fx), cur = tracked.get(fx.id);
    const cands = sourcesOf(fx, mine, shotRun(app, fx.t0, fx.t1), scriptOf(app, 'stroke'));
    const same = (c) => !!cur && !cur.auto && cur.run === c.run && cur.ch === c.ch;
    const srcLabel = (c) => `${sourceText(c, trackerWord).replace(/^tracked: /, '')} (${c.ch.replace(/^sem_/, '').replace(/_(in|scale)$/, '')})`;
    const samRun = mine.findLast((r) => r.tracker === 'sam2_mask');
    return [
      { separator: true },
      { label: 'Track', tip: `Own run from its own seed (paint ${ARM[fx.kind]?.map(([w, p]) => `${w === 'c1' ? 'Bottom' : 'Top'} ${p}`).join(' + ')})`,
        items: choices.length ? choices.map((c) => ({ label: seeded ? c.label : `${c.label} (paint its seed first)`, tip: c.tip, run: () => (seeded ? trackMod(app, fx.id, c.id) : paintSeed(app, fx.id, c.id)) })) : [{ label: tr.listed ? 'No tracker takes a painted seed' : 'Trackers not loaded yet', disabled: true }] },
      { label: seeded ? `Paint its seed (${seedsOf(fx).length > 1 ? `${seedsOf(fx).length - 1} correction${seedsOf(fx).length > 2 ? 's' : ''} too` : fmtMs(seedsOf(fx)[0].t_ms)})` : 'Paint its seed…', tip: 'Paint parts for this modifier only, not the shot', run: () => paintSeed(app, fx.id) },
      ...(samRun ? [{ label: 'Correct its SAM mask here', tip: "Repaint the run's mask on this frame, T re-tracks", run: () => { tr.select(samRun.id); correctHere(app, samRun.id); } },
        { label: 'Show its SAM masks', tip: 'Select its run to see its mask on every frame', run: () => tr.select(samRun.id) }] : []),
      { label: 'Source', tip: "Its own run, a part of the shot's run, or generated",
        items: [
          ...cands.map((c) => ({ label: srcLabel(c), type: 'radio', checked: same(c) || (!!cur?.auto && cur.run === c.run && cur.ch === c.ch), run: () => setSource(app, fx.id, { run: c.run, ch: c.ch }) })),
          ...(cands.length ? [{ separator: true }] : [{ label: 'Nothing tracked over it yet', disabled: true }]),
          { label: 'Generated (none)', type: 'radio', checked: fx.src === 'none' || (!cur && fx.src !== undefined), run: () => setSource(app, fx.id, 'none') },
          ...(fx.src !== undefined ? [{ label: 'Default (the one candidate, if exactly one)', run: () => setSource(app, fx.id, null) }] : []),
        ] },
    ];
  }
  /** The menu's add at t: an event kind from t (4 s, clipped to the scene; drag its ends), a spurt on that frame, Reshape /
   *  Climax over the scene around t. */
  function menuAdd(t, kind) {
    if (FX_KINDS[kind]?.event) toggleModCmd(app, kind, { t, here: true });
    else if (FX_KINDS[kind]?.point) spurtAtPlayhead(app, t);
    else { const g = dropSpan(t, { cuts: cutsOf(app), dur: durOf(app), minLen: minLen() }); if (g) addModifier(app, kind, g); }
    focusFxLane();
  }

  // ---- the balls -> spurts suggestion (recomputed when the scene, the runs or the sign change; no doc scenes: each second) ----
  let sugSign = $state(-1), sugGhost = $state(false), sugArmed = $state(false);
  const sugKey = $derived.by(() => { const i = sceneAtPlayhead(scenesOf(app), app.player); return i >= 0 ? 's' + i : 't' + Math.floor(app.player.timeMs / 1000); });
  const sug = $derived.by(() => { sugKey; sugSign; trackingOf(app)?.runs; app.doc.ghosts; return untrack(() => ballsSpurts(app, app.player.timeMs, sugSign)); });
  $effect(() => { sug?.ch; sug?.t0; untrack(() => { sugArmed = false; sugGhost = false; }); });   // another scene / part: back to the quiet button
  const SUG_TIP = (s) => `${s?.seeded ? `The run has a balls group in this scene (${s?.ch}: seeded from the tagger, or drawn with Groups)` : `The tracker found a part named balls in this scene (${s?.ch}, PROTOCOL v3.4)`}: its own size change peaks where it contracts. Click to preview spurt markers at those peaks (hollow diamonds), then place them: one undo step, nothing automatic`;
  // off: why, shown on an orgasm / throbbing, or anywhere while the row is focused / hovered
  let inside = $state(false);
  const sceneNow = $derived.by(() => { sugKey; const l = scenesOf(app); return untrack(() => l[sceneAtPlayhead(l, app.player)]) ?? null; });
  const eventNow = $derived(!!modAt(app.doc.fx, app.player.timeMs, 'orgasm') || !!modAt(app.doc.fx, app.player.timeMs, 'throbbing'));
  const showOff = $derived(!sug && (tl.focus === 'fx' || inside || eventNow || (!!sceneNow && (!!modOver(app.doc.fx, 'orgasm', sceneNow.start_ms, sceneNow.end_ms) || detectedMods(sceneNow).includes('orgasm')))));
  const why = $derived.by(() => { if (!showOff) return null; sugKey; trackingOf(app)?.runs; app.doc.ghosts; return untrack(() => ballsWhy(app, app.player.timeMs)); });
  function placeSug() { if (sug?.times.length && placeSpurts(app, sug.times)) { sugArmed = false; sugGhost = false; } }

  // ---- the Track tab's one prompt: seed the reacting part of the modifier at the playhead (or the selected one) ----
  const seedMod = $derived.by(() => {
    if (tab !== 'track') return null;
    const fx = app.doc.fx || [], sel = fx.find((e) => e.id === tl.fx && REACTS[e.kind]);
    const m = sel ?? fx.filter((e) => REACTS[e.kind] && !e.muted && app.player.timeMs >= e.t0 && app.player.timeMs < e.t1).sort((a, b) => b.t0 - a.t0)[0];
    return m && !tracked.has(m.id) ? m : null;
  });
  /** paw-ef73.26: the prompt paints the modifier's OWN seed (its own frame and run, never the shot's groups). */
  function seed(m) { if (paintSeed(app, m.id)) app.usage?.note?.('mods:seed', { kind: m.kind, part: REACTS[m.kind] }); }

  // ---- curve popover (Refine; kit Popover on a DOM stand-in for the block, like the plan lane's inspector) ----
  let anchorEl = $state();
  const pop = $derived(tl.fxPop && tab === 'refine' ? (app.doc.fx || []).find((x) => x.id === tl.fxPop) ?? null : null);
  const popSpan = $derived.by(() => {
    if (!pop || !lw) return null;
    const x0 = Math.max(0, Math.min(lw - 1, X(app.view, lw, pop.t0))), x1 = Math.max(x0 + 1, Math.min(lw, X(app.view, lw, pop.t1)));
    return { x: x0, w: x1 - x0 };
  });
  $effect(() => { popSpan; anchorEl?.dispatchEvent(new Event('scroll')); });

  // ---- paw-h2e2: the suggestion strip never lies over a modifier, a spurt or a tagger hint (it took the press there): it sits in
  // the row's right-most empty stretch that holds it (clear of the row's fold chip, Timeline.svelte .fold, 70 px); with none, a
  // "suggest" button opens it in a popover (in an empty stretch too, else beside the fold chip). The inline strip is still laid
  // out (hidden, inert) to be measured.
  const TAG_W = 74;
  let sugW = $state(0), btnW = $state(0), sugBtn = $state(), sugOpen = $state(false);
  const hasSug = $derived(!!seedMod || !!sug || !!(why && !why.enabled) || !!cumScene(app));
  const busyPx = $derived.by(() => {
    if (!lw) return [];
    const x = (t) => X(app.view, lw, t);
    return [...list.map((e) => (isPointFx(e) ? [x(e.t0) - 7, x(e.t0) + 7] : [x(e.t0) - FX_EDGE_PX, x(e.t1) + FX_EDGE_PX])), ...hints.map((g) => [x(g.t0), x(g.t1)])];
  });
  const sugLeft = $derived(hasSug && lw && sugW ? freeSlot(busyPx, lw - TAG_W, sugW + 4) : null);
  const btnLeft = $derived(hasSug && sugLeft == null && btnW ? freeSlot(busyPx, lw - TAG_W, btnW + 4) : null);
  $effect(() => { if (sugLeft != null || !hasSug) sugOpen = false; });
</script>

{#snippet sugBody()}
    {#if seedMod}
      <button class="go" {@attach tooltip(`Paint the ${REACTS[seedMod.kind]} on its own seed, then T tracks this modifier`)} onclick={() => (hasSeed(seedMod) ? trackMod(app, seedMod.id) : seed(seedMod))}>{hasSeed(seedMod) ? 'track' : 'paint'} {REACTS[seedMod.kind]} for its own run</button>
    {/if}
    {#if sug}
      {#if !sugArmed}
        <button {@attach tooltip(SUG_TIP(sug))} onpointerenter={() => (sugGhost = true)} onpointerleave={() => (sugGhost = false)} onclick={() => (sugArmed = true)}>balls contraction peaks ({sug.ch === 'sem_balls_scale' ? 'seeded' : sug.ch.replace('_scale', '').replace(/^sem_/, '')}) → place spurts</button>
      {:else}
        <span>{sug.ch} · {sug.times.length ? `${sug.times.length} peak${sug.times.length === 1 ? '' : 's'}` : 'no clear peaks'}</span>
        <button {@attach tooltip('Peaks on contraction or swelling (try both)')} onclick={() => (sugSign = -sugSign)}>{sugSign < 0 ? 'contraction' : 'swelling'}</button>
        <button class="go" disabled={!sug.times.length} {@attach tooltip('Place a spurt on each diamond')} onclick={placeSug}>place</button>
        <button aria-label="Cancel" {@attach tooltip('Cancel: nothing placed')} onclick={() => (sugArmed = false)}>×</button>
      {/if}
    {:else if why && !why.enabled}
      <button class="off" aria-disabled="true" {@attach tooltip(`Balls contraction peaks → place spurts is off: ${why.reason}`)} onclick={() => app.toast(`Spurts from balls: ${why.reason}`, 'info')}>balls → spurts</button>
      <span class="hint">{why.short}</span>
    {/if}
    <CumBar {app} />   <!-- the "detect cumshots" slot: after the balls block, same .sug row -->
{/snippet}

<div class="fx" bind:this={root} bind:clientWidth={lw} role="presentation" ondblclick={dbl} onpointerenter={() => (inside = true)} onpointerleave={() => { hover = null; inside = false; }}>
  <CanvasLane {app} lane="fx" label="Modifiers" tag={list.length ? 'Modifiers' : null} {paint} {cursor} {hoverText} {select}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} oncontextmenu={menu} />
  <div class="sug" class:parked={sugLeft == null} role="group" aria-label="Modifier suggestions" inert={sugLeft == null} bind:clientWidth={sugW} style:left="{(sugLeft ?? 0) + 2}px">{@render sugBody()}</div>
  {#if hasSug && sugLeft == null}
    <button class="sugbtn" class:go={!!seedMod} bind:this={sugBtn} bind:clientWidth={btnW} style:left={btnLeft == null ? null : btnLeft + 2 + 'px'} style:right={btnLeft == null ? TAG_W + 'px' : null} aria-haspopup="dialog" aria-expanded={sugOpen} {@attach tooltip('Suggestions for this row, folded: no room between modifiers')} onclick={() => (sugOpen = !sugOpen)}>suggest ▾</button>
  {/if}
  {#if popSpan}<div class="anchor" bind:this={anchorEl} style:left="{popSpan.x}px" style:width="{popSpan.w}px"></div>{/if}
</div>
{#if sugBtn && sugOpen}
  <Popover open={true} anchor={sugBtn} placement="bottom-end" label="Modifier suggestions" class="fx-sug" onclose={() => (sugOpen = false)}>
    <div class="sug inpop" role="group" aria-label="Modifier suggestions">{@render sugBody()}</div>
  </Popover>
{/if}
{#if anchorEl && pop}
  <Popover open={true} anchor={anchorEl} label="Modifier curve" class="fx-pop" onclose={() => { tl.fxPop = null; focusFxLane(); }}>
    {#key pop.id}<FxEditor {app} id={pop.id} />{/key}
  </Popover>
{/if}

<style>
  .fx { position: absolute; inset: 0; }
  .sug { position: absolute; top: 1px; z-index: 2; display: flex; gap: 2px; font: var(--fs-1)/14px var(--mono); color: var(--tx-ghost); white-space: nowrap; background: var(--bg); border-radius: var(--radius); }
  .sug.parked { visibility: hidden; pointer-events: none; }   /* measured only (paw-h2e2) */
  .sug.inpop { position: static; flex-wrap: wrap; max-width: 420px; padding: 4px; white-space: normal; background: none; }
  .sugbtn { position: absolute; top: 1px; z-index: 2; padding: 0 5px; font: var(--fs-1)/14px var(--mono); white-space: nowrap; color: var(--tx-mut); background: var(--line-0); border-radius: var(--radius); }
  .sugbtn.go { color: var(--highlight); background: rgba(var(--highlight-rgb), .18); }
  .sugbtn:hover { color: var(--tx-hi); }
  .sugbtn:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  .sug span { padding: 0 4px; background: var(--bg); border-radius: var(--radius); }
  .sug button { padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: inherit; }
  .sug button:hover:not(:disabled):not(.off) { background: var(--line-3); color: var(--tx-hi); }
  .sug button:disabled, .sug button.off { opacity: .45; cursor: default; }
  .sug span.hint { background: none; padding: 0 2px; }
  .sug button.go { color: var(--highlight); background: rgba(var(--highlight-rgb), .18); }
  .sug button:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  .anchor { position: absolute; top: 0; bottom: 0; pointer-events: none; }
  :global(.k-popover.fx-pop) { padding: var(--space-3) 0; }
</style>
