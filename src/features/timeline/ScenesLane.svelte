<script>
  // The Scenes and shots row: two strips on one time axis. paw-2lp7.5 (regions stage 2; owner: "shots, which are marked as cuts,
  // actions which are what is happening at any moment, not bound to cuts, then modifiers which describe an effect within the
  // time"): the upper strip draws the action regions (app.doc.acts), the lower one the shots; the modifiers are their own row.
  //   ACTIONS (upper; actions-strip.js stripLayout): the main line (layer 0, the primary driver) as full blocks named by the
  //     action ("anal penetration"), tinted by its act's kind; secondary actions (layers 1, 2 ...) as thin bands above it, the
  //     row growing a band for each one that has a region in view, each with its mix chip (mix / layer / ignore); the
  //     no-action kinds the owner marks in grey with their word (intro / idle / outro / after; rest dotted); positioning
  //     hatched in a lane of its own right over the shots (it may lie over an action); a proposal (auto) dashed and hollow;
  //     an empty main-line region (it held a multi-shot scene together in an old project) faint, "untagged"; gaps empty
  //     ("no action is actionless"). Drag on empty space: a new region (that lane; Alt+drag on a region: a new one on the
  //     layer above it); a region's edge: resize; its body: move, up / down: change layer (what lay there swaps with it);
  //     click: select (a proposal: accept); double-click / Enter: its tag chips in place (RegionChips); right-click: its menu
  //     (a proposal: dismiss). Edges snap to cuts, other regions' edges, the playhead, and always land on frame starts
  //     (Shift: frames only); the video shows the frame under the dragged edge. One undo step each.
  //   SHOTS (lower): the shots numbered 1, 2, 3 through the video (owner: "shots are just 123"), tinted by the main-line
  //     action over their middle, the camera glyph, the view drawn as a fill (internal inset, blank black), a 2 px
  //     tracked-state line at the bottom, a "?" badge for re-found groups, the loops along the top (paw-llaa), and a marker
  //     where the main-line action changes inside a shot (stage 1's middle rule: the shot is tracked as one, its whole-shot
  //     facts follow the action at its middle). paw-tog0: nothing turns off for the whole strip as you zoom out: each grip stays while it
  //     has room, each number while it fits (lod.js), thinned where they would touch; the one under the pointer always.
  //   CUTAWAYS (paw-ef73.2): a cutaway shot is a raised card over its neighbours; under an action region it reads "the action
  //     continues" (carried through), with none over it it is an intermission. A proposed cutaway is a dashed card.
  //   Boundaries (paw-p2p0): a cut = a solid line through the strip, its notch and its filled grey grip; a camera move (same
  //     take) = no line, no notch: the same grip hollow, then the shot's number and its camera glyph (zoom / pan ...), and
  //     the shot after it keeps the block's shade (one take reads as one block). Filled = cut, hollow = move. Fades /
  //     dissolves keep their ramp / cross. A cut moves only from its grip (paw-ef73.18); the action edges on it move with it.
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import Popover from '../../ui/kit/Popover.svelte';
  import CanvasLane from './CanvasLane.svelte';
  import { xToMs, frameStartOf, gridOf } from '../../lib/lane.js';
  import { theme, font, X, drawRange, drawHint, drawProgress, drawGrip } from './draw.js';
  import { shownGrips, layoutLabels, textW, fitText } from './lod.js';
  import { snapContext, localX, CLICK_PX, hitInterval, intervalDrag } from './interact.js';
  import { untrack } from 'svelte';
  import LoopPopover, { loopPop } from './LoopPopover.svelte';
  import * as LP from './loops.js';
  import * as A from './loop-actions.js';
  import { loopsInWords } from './loop-actions.js';
  import { loopLooks, linksOf, showMatch, showLoopMatch, clearMatch, seekSame } from './loop-look.svelte.js';   // paw-llaa: the loops on the Shots strip
  import { loopBand, isAuto, passAt, passesText } from './loop-marks.js';
  import { fmtMs } from '../../lib/video.js';
  import { tl, scenesOf, setScenes, setDraft, clearDraft, durOf, sceneSelected, setSel, selOf, listOf } from './state.svelte.js';
  import { rowHit, rowNear, shotGrips, boxSelect, shotButtons, shotsGrip, scenesGrip, pillOf, CUT_REACH } from './scenes-hit.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { chipsOf, transitionText, moveCut, sceneIndexAt, sceneStatus } from './scenes.js';
  import { kindOf, rgba } from './kinds.js';
  import { isInternal, isBlank, sceneTags, sceneCamera, sceneStructure, actText, actWords, tagSpan, partial, tintOf, tagLabel, tagColor, skipReason, ALIASES, TAG } from './acts.js';
  import { sceneRuns, sceneRange, sceneSpanOf, shotLabel, sceneNo, splitScene, splitShot, setTake, mergeScenesIn, selShot, selExtend, selToggle, selScene, selText,
    ownScene, joinSelected, moveSceneCut, boundaryKind, boundaryWord, blockShade, sceneShotsOf, wholeScenes, isCutaway, cutawayMode, layerRects, cutawayAt } from './shots.js';
  import { runForScene } from '../../lib/runs.js';
  import { addModifier, spurtAtPlayhead } from './commands-fx.js';
  import { stripLayout, bandsIn, regionRects, actHit, mixChip, regionTargets, snapAt, regionKind, coverOf, midShotEdges, laneOf, laneAt, partOfShot } from './actions-strip.js';
  import { moveToLayer, addRegion, resizeRegion, setRegionMix, regionWords, mergeRegion, MIXES, actsAt, layerCap, carryAcross } from './regions.js';
  import { selectAct, removeAct, acceptAct, commitActs, mruOf, noteMru, actLabel, shotsUnder } from './acts-edit.js';
  import { acts as actCmds } from './commands-acts.js';
  import RegionChips from './RegionChips.svelte';
  import { playheadFrameStart } from '../../lib/lane.js';
  import { modItems } from './fxmenu.js';
  import { FX_KINDS } from '../../lib/fx.js';
  import { scenesRowMenu } from './scenes-menu.js';
  import { trackingOf, noteUsage } from './deps.js';
  import { continuations, markAction } from '../../lib/scenes-continue.js';
  import { fillHint, structure, applySel, selectedCut, MARK_WORDS, seedsOf } from './commands-scenes.js';
  import { seedFrom, seedStep } from '../tracking/seed-marks.js';   // paw-46du: the seed frames at the foot of the Shots strip
  import { partLabel } from '../tracking/groups.js';
  import { peekGroups } from './deps.js';
  import { frameAt, frameLen } from '../../lib/lane.js';
  import { drawOffers, offerAt, takeOffer, dropOffer } from './repeat-offers.svelte.js';   // paw-ef73.4: the repeated frames' offers on the boundaries
  import { paintFades, fadeGesture, fadeCursor, fadeTip, fadesOfShot, addFade, removeFade, shownTransitions } from './transitions.svelte.js';   // paw-ef73.13: fades on their shots, adjustable

  let { app } = $props();
  const GAP = 2, TICK_MIN = 6, CAP_W = 64;   // CAP_W: the strip names + "?" at the right edge (labels stop short of it)
  const list = $derived(scenesOf(app));
  const select = { box: (t0, _y0, t1, _y1, mode) => applySel(app, boxSelect(list, t0, t1, mode, selOf(), 'shots'), 'box', { seek: false }) };   // B / C (lib/selmodal.js)
  const runs = $derived(sceneRuns(list));
  const tr = $derived(trackingOf(app));
  const IN = { internal: isInternal, blank: isBlank };
  const view = $derived(tr?.liveScenes?.(list) ?? list);   // proposals applied (continues 'auto')
  const conts = $derived(continuations(view, IN));
  let drag = null, cursor = $state('default'), box = $state.raw(null), legend = $state(false), qEl = $state(null);
  let hot = $state.raw(null);   // what the pointer is over (scenes-hit.js rowHit, + shot for a body): it highlights
  let near = $state('');   // paw-ef73.28: the grip the pointer is near ('strip:i', scenes-hit.js rowNear): it grows
  const icons = new Map();
  // paw-2lp7.5: the regions (a drag's draft too), the secondary bands in view (the row grows for them: lane.js extra)
  const actList = $derived(listOf(app, 'acts'));
  const nLayers = $derived(bandsIn(actList, app.view.start, app.view.start + app.view.span));
  $effect(() => { tl.actLayers = nLayers; });
  const midEdges = $derived(midShotEdges(list, actList));
  /** The strips (actions-strip.js stripLayout): Actions [0, sh), Shots [sh + 1, h). */
  const lay = (h) => stripLayout(h, tl.actLayers);
  const split = (h) => lay(h).sh;
  const band = (el) => [split(el.clientHeight) + 1, el.clientHeight];   // the Shots strip, for the fades on it
  let fade = null;   // a fade handle being dragged (transitions.svelte.js fadeGesture)
  /** The layers (shots.js layerRects) for a w x H row: scene blocks, shots, the raised cutaways. */
  const layersOf = (w, H) => layerRects(list, (t) => X(app.view, w, t), { sh: split(H), y1: split(H) + 1, h: H, gap: GAP });
  /** The proposed cutaways (shots of a continuation the fingerprints / tags propose, not yet one scene): [{k, c}]. */
  const proposed = $derived(conts.filter((c) => view[c.c].continues === 'auto').flatMap((c) => Array.from({ length: c.b1 - c.b0 + 1 }, (_, n) => c.b0 + n).filter((k) => !c.internal.includes(k)).map((k) => ({ k, c }))));
  /** The proposal whose dashed card's raised part (over the scene block, above y1 = the Shots strip) is under (x, y),
   *  else null: below it a click still selects the shot. */
  const proposalAt = (L, x, y, y1) => proposed.find(({ k }) => { const r = L.shots[k]; return r && x >= r.x0 && x < r.x1 && y >= L.top && y < y1; })?.c ?? null;
  const glyph = (id) => { let p = icons.get(id); if (!p) icons.set(id, (p = new Path2D(TAG[id].icon))); return p; };
  /** A camera tag's glyph (stroked), size px, vertically centred in [y0, y1). */
  function camGlyph(ctx, cam, x, y0, y1, col, size = 10) {
    ctx.save(); ctx.translate(x, Math.round((y0 + y1 - size) / 2)); ctx.scale(size / 16, size / 16); ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.stroke(glyph(cam)); ctx.restore();
  }
  const round = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  /** Shot i's tracked state: 'baked' | 'live' (paw-x7w7) | 'filled' | 'bridged' | 'generated' | '' (not yet). */
  function trackState(i) {
    const s = list[i], why = skipReason(view[i] ?? s);
    if (why.startsWith('filled')) return 'filled';
    if (why.startsWith('off-screen')) return 'bridged';
    if (why) return 'generated';
    const bk = tr?.bakeState?.(i).state;
    if (bk) return bk;
    const st = sceneStatus(s, app.doc.axes[app.doc.activeAxis] || [], tr?.ghost?.(runForScene(s, tr.links, tr.ghosts)) ?? null);
    return st.state === 'accepted' ? 'baked' : st.state === 'ghost' ? 'live' : '';
  }
  const STATE_WORD = { baked: 'baked: its points are permanent (Unbake gives it back to its run)', live: 'live: it plays its run (Bake makes it permanent)', filled: 'filled from its neighbors (not tracked)', bridged: 'off-screen: bridged from the shots around it', generated: 'generated (blank / insertion / structure: not tracked)', '': 'not tracked yet' };
  /** Groups found again after a cut and not yet accepted, drawn on shot i's frames. */
  const unconfirmed = (i) => (list[i]?.groups || []).filter((g) => g.unconfirmed && g.t_ms >= list[i].start_ms && g.t_ms < list[i].end_ms).length;
  /** A scene's marked shots in words (paw-2lp7.4): '1 off-screen', '2 cutaways', ''. */
  function fillWords(lo, hi) {
    const k = list.slice(lo, hi + 1).filter(isCutaway), off = k.filter((s) => s.tags?.includes('offscreen')).length, cut = k.length - off;
    return [off ? `${off} off-screen` : '', cut ? `${cut} cutaway${cut > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  }
  /** The scene's words: '3 · anal penetration' (+ fill / structure / offers). Its action only: modifiers are the row below (paw-8b4h). */
  function sceneWords(S, k, first, allBlank, lo, hi) {
    const st = sceneStructure(S), act = actText(S), fw = fillWords(lo, hi);
    const head = act || (st ? tagLabel(st) : allBlank ? 'blank' : '');
    const extra = [...(fw ? [fw] : []), ...(first.offers?.length ? [`${first.offers.length} offered`] : [])];
    return { num: String(k + 1), text: [head || 'untagged', ...extra].join(' · '), untagged: !head };
  }

  // ---- paw-llaa: the loops, merged into the Shots strip (the Loops row is gone; owner: "we merge the loops at the bottom
  // into the shots, they get the solid then dashed for every repeat, and you can edit or remove them from there") ----
  // A band along the top of the Shots strip (the fades' band: a fade's handles still win there): each loop's first pass
  // solid in its colour, every repeat a dash-box (pass by pass, to count them), a tint only when a pass is under 3 px; an
  // approximate loop (the loop search) dotted and lighter; its words ("8 f × 28") on the shot's label line, the rest in its
  // tip. Click: select it and highlight where its pictures play; drag the solid first pass: move (its edges: resize); the
  // end handle of a tiled loop / the tab right of an untiled one: tiles; ×: remove; double-click / Enter: options;
  // right-click: its menu. Shots that hold the same loop footage get a chain on their label: click it to highlight them
  // and go to the next one.
  const loops = $derived(listOf(app, 'loops'));
  const light = $derived((tl.themeTick, typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'));
  const looks = $derived((loops, light, loopLooks(app, light)));
  const loopMeta = $derived.by(() => {
    const m = new Map();
    for (const l of loops) {
      const P = LP.periodOf(l, A.fmOf(app)), s = A.scriptOf(app, l), cyc = LP.cycleOf(s, l, P);
      m.set(l.id, { P, points: cyc.length, warn: LP.seamWarning(cyc, P), stale: LP.needsRetile(s, l, P), info: LP.loopInfo(l, A.fmOf(app)) });
    }
    return m;
  });
  // the loop search's finds under loop_min_confidence are no suggestion (paw-ef73.10); none over a loop already there
  const minConf = $derived(+(tr?.loopVals?.loop_min_confidence ?? 0.5));
  const sugs = $derived(LP.suggestions(list).filter((s) => (s.confidence ?? 0) >= minConf).filter((s) => !loops.some((l) => l.t0 < s.t1 && s.t0 < Math.max(l.t1, l.tiledTo || 0, l.auto?.end || 0))));
  // re-tile prompt: one toast when a tiled loop goes stale (not on every edit of the burst)
  const staleIds = $derived(app.doc.loops.filter((l) => A.isStale(app, l)).map((l) => l.id));
  const notified = new Set();
  $effect(() => {
    const ids = new Set(staleIds);
    untrack(() => {
      for (const id of notified) if (!ids.has(id)) notified.delete(id);
      for (const id of ids) {
        if (notified.has(id)) continue;
        notified.add(id);
        app.toast('Loop cycle edited: its tiles are out of date', 'info', { timeout: 8000, action: { label: 'Re-tile', run: () => A.retileLoop(app, id) } });
      }
    });
  });
  let loopDrag = null, hotLoop = $state(null), readout = $state(null), chains = [];   // chains: the chain glyphs painted [{x0, x1, y0, y1, i}]
  const TAB_W = 9;
  /** The loops' band in a Shots strip [y1, H): {a, b} px. */
  const bandOf = (y1, H) => { const bh = Math.max(5, Math.min(8, Math.round((H - y1) * 0.32))); return { a: y1 + 2, b: y1 + 2 + bh }; };
  const loopText = (o) => `${o.l.auto?.approx && isAuto(o.l) ? '~' : ''}${o.g.frames} f × ${passesText(o.g)}`;
  const shotsOf = (t0, t1) => list.flatMap((s, i) => (s.start_ms < t1 && t0 < s.end_ms ? [i] : []));
  /** Shot i holds (part of) a loop: its label sits under the loops' band. */
  const loopIn = (i) => { const s = list[i]; if (!s) return false; for (const o of looks.values()) if (o.l.t0 < s.end_ms && s.start_ms < o.g.end) return true; return false; };

  function paintLoops(ctx, w, H, T, y1) {
    const v = app.view, B = bandOf(y1, H), bh = B.b - B.a;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y1, w, H - y1); ctx.clip();
    for (const s of sugs) {   // a detected period not marked yet: a faint dotted box (click: add it)
      const x0 = X(v, w, s.t0), x1 = X(v, w, s.t1);
      if (x1 < 0 || x0 > w) continue;
      ctx.setLineDash([1, 2]); ctx.strokeStyle = T.txMut; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, B.a + 0.5, Math.max(1, x1 - x0 - 1), bh - 1); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const o of looks.values()) {
      const l = o.l, bd = loopBand(l, o.g, v, w), m = loopMeta.get(l.id);
      if (bd.xe < 0 || bd.x0 > w) continue;
      const sel = tl.loop === l.id, lit = sel || hotLoop === l.id, approx = !!l.auto?.approx && isAuto(l), col = o.color, rep = m?.stale ? T.warn : col;
      // the repeats: one dash per pass (a lighter block, a gap between: count them); an approximate loop's dotted boxes;
      // under 4 px a pass, the dashes would merge: a tint
      if (!bd.passes || bd.passes.some((p) => p.x1 - p.x0 < 4)) { ctx.fillStyle = rep; ctx.globalAlpha = approx ? 0.18 : 0.38; ctx.fillRect(bd.x1, B.a, Math.max(1, bd.xe - bd.x1), bh); }
      else for (const p of bd.passes) {
        const pw = p.x1 - p.x0, gap = pw >= 10 ? 2 : 1;
        if (p.x1 < 0 || p.x0 > w) continue;
        if (approx) { ctx.strokeStyle = rep; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([1, 2]); ctx.strokeRect(p.x0 + gap + 0.5, B.a + 0.5, pw - 2 * gap - 1, bh - 1); ctx.setLineDash([]); continue; }
        ctx.fillStyle = rep; ctx.globalAlpha = 0.5; ctx.fillRect(p.x0 + gap, B.a + 1, pw - 2 * gap, bh - 2);
      }
      ctx.globalAlpha = 1;
      // the first pass: solid (an approximate loop: dotted, lighter)
      const cw = Math.max(1, bd.x1 - bd.x0);
      ctx.fillStyle = col; ctx.globalAlpha = approx ? 0.3 : 0.9; ctx.fillRect(bd.x0, B.a, cw, bh); ctx.globalAlpha = 1;
      if (approx) { ctx.setLineDash([1, 2]); ctx.strokeStyle = col; ctx.strokeRect(bd.x0 + 0.5, B.a + 0.5, cw - 1, bh - 1); ctx.setLineDash([]); }
      if (A.isLooping(app, l)) { ctx.fillStyle = T.highlight; ctx.fillRect(bd.x0, B.a - 2, cw, 2); }
      if (m?.warn && bd.x1 >= 0 && bd.x1 <= w) { ctx.fillStyle = T.warnInk; ctx.fillRect(bd.x1 - 0.5, B.a - 1, 1.5, bh + 2); }   // the seam jumps
      if (sel) { ctx.strokeStyle = T.txHi; ctx.lineWidth = 1.5; ctx.strokeRect(bd.x0 - 0.25, B.a - 1.25, Math.max(1, bd.xe - bd.x0) + 0.5, bh + 2.5); }
      if (!lit) continue;
      if (LP.isTiled(l)) { ctx.fillStyle = col; ctx.fillRect(bd.xe - 1.5, B.a - 2, 3, bh + 4); }   // the tiles' end handle
      else if (!isAuto(l) && (m?.points ?? 0) >= 2) { ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.moveTo(bd.x1 + 1, B.a); ctx.lineTo(bd.x1 + TAB_W, B.a + bh / 2); ctx.lineTo(bd.x1 + 1, B.b); ctx.fill(); ctx.globalAlpha = 1; }   // drag right: tile
      const xr = xOf(bd);
      if (xr != null) {   // ×: remove
        ctx.fillStyle = T.card; ctx.fillRect(xr - 5, B.a - 1, 10, bh + 2); ctx.strokeStyle = T.txHi; ctx.lineWidth = 1.2; ctx.beginPath();
        const c = (B.a + B.b) / 2; ctx.moveTo(xr - 2.5, c - 2.5); ctx.lineTo(xr + 2.5, c + 2.5); ctx.moveTo(xr + 2.5, c - 2.5); ctx.lineTo(xr - 2.5, c + 2.5); ctx.stroke();
      }
    }
    ctx.restore();
  }
  /** The × of a loop drawn as bd: its centre x (inside the right end of its band, clear of a tiles' handle), or null when too narrow. */
  const xOf = (bd) => (bd.xe - bd.x0 >= 22 ? bd.xe - 9 : null);
  /** The loops' words on their shots' label line: "8 f × 28" in the loop's colour, after the shot's own label (labEnd[i]). */
  function paintLoopWords(ctx, w, H, y1, labEnd) {
    const v = app.view, B = bandOf(y1, H), y = (B.b + H) / 2 + 0.5;
    ctx.save(); ctx.font = font(9, true, 600); ctx.textBaseline = 'middle';
    let last = -Infinity;
    for (const o of [...looks.values()].sort((a, b) => a.l.t0 - b.l.t0)) {
      const i = sceneIndexAt(list, o.l.t0), x = Math.max(X(v, w, o.l.t0) + 3, (labEnd[i] ?? -Infinity) + 6, last + 8, 2);
      const end = Math.min(X(v, w, o.g.end), list[i] ? X(v, w, list[i].end_ms) - CUT_REACH - 2 : w, w - CAP_W), txt = loopText(o);
      if (end - x < ctx.measureText(txt).width + 2) continue;
      ctx.fillStyle = o.color; ctx.fillText(txt, x, y);
      last = x + ctx.measureText(txt).width;
    }
    ctx.restore();
  }
  /** The highlighted matches (tl.match): every span outlined on the Shots strip, in its colour. */
  function paintMatch(ctx, w, H, T, y1) {
    const M = tl.match;
    if (!M) return;
    const v = app.view, spans = M.spans || [];
    ctx.strokeStyle = M.color || T.txHi; ctx.fillStyle = M.color || T.txHi; ctx.lineWidth = 2;
    for (const s of spans) {
      const a = X(v, w, s.t0), b = X(v, w, s.t1);
      if (b < 0 || a > w) continue;
      ctx.globalAlpha = 0.12; ctx.fillRect(a, y1, Math.max(2, b - a), H - y1); ctx.globalAlpha = 1;
      ctx.strokeRect(a + 1, y1 + 1, Math.max(1, b - a - 2), H - y1 - 2);
    }
  }
  /** A chain (two links), 11 x 7 px from (x, cy - 3.5). */
  function chainGlyph(ctx, x, cy, col, hollow = false) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = hollow ? 1 : 1.4;
    if (hollow) ctx.setLineDash([1.5, 1.2]);   // paw-0zwb: found by the loop-pair search (the same loop re-framed), not exact repeats
    const r = (cx) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx, cy - 2.5, 6, 5, 2.5); else ctx.rect(cx, cy - 2.5, 6, 5); ctx.stroke(); };
    r(x + 0.5); r(x + 4.5); ctx.restore();
  }
  const mss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  /** The chain's words for shot i: "Same loop as shot 20.1 (1:43) and 23.2 (3:10) · same footage as shot 14, cropped ×1.8". */
  function chainText(i) {
    const e = linksOf(app).get(i);
    if (!e) return '';
    const cj = new Set((e.crops || []).map((c) => c.j)), names = e.others.filter((k) => !cj.has(k)).map((k) => `${shotLabel(list, k)} (${mss(list[k].start_ms)})`);
    const loop = names.length ? `Same loop as shot ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}` : '';
    const crops = (e.crops || []).map((c) => (c.via === 'loops'   // paw-0zwb
      ? `same loop as shot ${shotLabel(list, c.j)}, ${c.tighter ? 'this one ' : ''}re-framed ×${(+c.scale || 1).toFixed(1)}: matched on all ${c.frames} frames, ${c.checks?.ok ?? 0} spot checks ok`
      : `same footage as shot ${shotLabel(list, c.j)}, ${c.tighter ? 'this one ' : ''}cropped ×${(+c.scale || 1).toFixed(1)}`));
    const t = [loop, ...crops].filter(Boolean).join(' · ');
    return `${t[0].toUpperCase()}${t.slice(1)} · click: highlight them and go to the next`;
  }
  const chainColor = (i, T) => {
    const f = linksOf(app).get(i)?.fams[0], s = list[i];
    for (const o of looks.values()) if (f != null && o.group === f) return o.color;
    for (const o of looks.values()) if (s && o.l.t0 < s.end_ms && s.start_ms < o.g.end) return o.color;   // a crop link: the colour of a loop on the shot
    return T.txVal;
  };
  /** A click on shot i's chain: its linked shots highlighted, the playhead on the next one (round the set). The hook for
   *  paw-ef73.33 (reuse the linked shot's script / run): linksOf(app).get(i).others, the shots that play the same loop. */
  function followChain(i) {
    const e = linksOf(app).get(i);
    if (!e) return;
    const all = [i, ...e.others].sort((a, b) => a - b), next = all[(all.indexOf(i) + 1) % all.length], s = list[next];
    showMatch(app, { shots: all, color: chainColor(i, theme()), text: 'chain' });
    app.player.seek(s.start_ms);
    const v = app.view;
    if (s.start_ms < v.start || s.end_ms > v.start + v.span) app.setView({ start: Math.max(0, s.start_ms - v.span * 0.2), span: v.span });
    app.usage?.note?.('loops:chain', { shots: all.length });
  }
  /** What the pointer is on among the loops (the Shots strip's band), or null:
   *  {kind: 'loopX' | 'loopEnd' | 'loopCycle' (part: t0 | t1 | body) | 'loopPasses' | 'loopSug', l?, s?, t}. */
  function loopHit(x, y, w, H, y1) {
    const B = bandOf(y1, H), v = app.view;
    if (y < B.a - 3 || y > B.b + 3) return null;
    for (const o of looks.values()) {
      const l = o.l, bd = loopBand(l, o.g, v, w), xr = xOf(bd);
      if ((tl.loop === l.id || hotLoop === l.id) && xr != null && Math.abs(x - xr) <= 5) return { kind: 'loopX', l };
      if (LP.isTiled(l) && Math.abs(x - bd.xe) <= 5) return { kind: 'loopEnd', l };
      if (!LP.isTiled(l) && !isAuto(l) && (loopMeta.get(l.id)?.points ?? 0) >= 2 && x > bd.x1 + 1 && x <= bd.x1 + TAB_W + 2) return { kind: 'loopEnd', l };
    }
    const hi = hitInterval(loops, v, w, x, 4);
    if (hi) return { kind: 'loopCycle', l: hi.item, part: hi.part };
    const t = xToMs(v, w, x);
    for (const o of looks.values()) if (t >= o.l.t0 && t < o.g.end) return { kind: 'loopPasses', l: o.l, t };
    const s = sugs.find((q) => t >= q.t0 && t < q.t1);
    return s ? { kind: 'loopSug', s, t } : null;
  }
  const chainAt = (x, y) => chains.find((c) => x >= c.x0 - 2 && x < c.x1 + 2 && y >= c.y0 - 2 && y < c.y1 + 2) ?? null;
  const LOOP_CURSOR = { loopX: 'pointer', loopEnd: 'ew-resize', loopPasses: 'pointer', loopSug: 'pointer' };
  function loopHint(h) {
    const k = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');
    if (h.kind === 'loopSug') return `Detected loop period (${h.s.frames ? h.s.frames + ' f' : Math.round(h.s.period) + ' ms'}) · click: add it as a loop`;
    if (h.kind === 'loopX') return `Remove this loop (${k('loops.delete')})`;
    if (h.kind === 'loopEnd') {
      // paw-j3to: the footage goes on at another phase: a click on the tiles' end continues it there
      const c = LP.isTiled(h.l) ? h.l.cont : null, more = c ? ` · the pictures go on with the same cycle ${Math.abs(c.shift)} frame${Math.abs(c.shift) > 1 ? 's' : ''} ${c.shift > 0 ? 'later' : 'earlier'}: click to continue from here, shifted` : '';
      return LP.isTiled(h.l) ? `Tiles' end${more} · drag: tile extent (whole cycles; Shift free)` : 'Drag right: tile this cycle';
    }
    const words = loopsInWords(app).get(h.l.id)?.short ?? '';
    return `Loop ${words} · click: select it and show where it plays · ${h.kind === 'loopCycle' ? (h.part === 'body' ? 'drag: move it' : 'drag: resize its cycle') + ' · ' : ''}× / ${k('loops.delete')}: remove · ${k('loops.open')} / double-click: options · ${k('loops.pickPrev')} / ${k('loops.pickNext')}: its preferred frame · ${k('loop.playToggle')}: loop playback · right-click: more`;
  }
  function loopTip(h) {
    if (h.kind === 'loopSug') return `Detected loop ${h.s.frames ? h.s.frames + ' f · ' : ''}${LP.sugPeriod(h.s, A.fmOf(app)).toFixed(1)} ms (${h.s.kind ?? 'motion'} ${Math.round((h.s.confidence ?? 0) * 100)}%) · click: add it`;
    if (h.kind !== 'loopCycle' && h.kind !== 'loopPasses') return loopHint(h);
    const l = h.l, m = loopMeta.get(l.id), o = looks.get(l.id), wd = loopsInWords(app).get(l.id);
    const lines = [wd?.long ?? '', `${LP.loopLabel(l, A.fmOf(app))}${m?.info.exact ? '' : ' (not a whole number of frames)'}`];
    if (h.kind === 'loopPasses' && o) lines.push(`pass ${passAt(l, o.g, h.t, gridOf(app.player)) + 1} of ${o.g.n}`);
    if (LP.isTiled(l)) lines.push(`tiled ×${((l.tiledTo - l.t0) / m.P).toFixed(1)}${m.stale ? ' · out of date: re-tile' : ''}`);
    if (m?.warn) lines.push(`seam jumps ${m.warn.dpos} in ${Math.round(m.warn.dt)} ms`);
    return lines.filter(Boolean).join('\n');
  }
  /** A press on a loop (the band). -> true when handled. */
  function loopDown(e, el, h) {
    const w = el.clientWidth, x = localX(e, el);
    tl.cut = null;
    if (h.kind === 'loopX') { A.deleteLoop(app, h.l.id); clearMatch(); hotLoop = null; return true; }
    if (h.kind === 'loopSug') { loopDrag = { sug: h.s, x0: x }; return true; }
    tl.loop = h.l.id;
    el.setPointerCapture?.(e.pointerId);
    if (h.kind === 'loopEnd') {
      const l = h.l, P = loopMeta.get(l.id).P, max = LP.roomOf(app.doc.loops, l, durOf(app)).hi;
      const d = { id: l.id, end: l.tiledTo ?? l.t1, x0: x, cont: LP.isTiled(l) && !!l.cont, tile: (ev) => {
        d.end = LP.tiledEndAt(l, xToMs(app.view, w, localX(ev, el)), { P, snap: !ev.shiftKey, max });
        setDraft('loops', app.doc.loops.map((q) => (q.id === l.id ? { ...q, tiledTo: d.end } : q)));
        const n = (d.end - l.t0) / P;
        readout = { x: X(app.view, w, d.end), text: d.end <= LP.cycleEnd(l, P) ? 'no tiles' : `×${Number.isInteger(Math.round(n * 1000) / 1000) ? Math.round(n) : n.toFixed(2)} · to ${fmtMs(d.end)}` };
      } };
      loopDrag = d;
      return true;
    }
    if (h.kind === 'loopCycle') {
      loopDrag = { id: h.l.id, part: h.part, looping: A.isLooping(app, h.l), d: intervalDrag({ app, key: 'loops', el, e, hit: { item: h.l, part: h.part }, ids: [h.l.id],
        label: h.part === 'body' ? 'Move loop' : 'Resize loop', minLen: Math.max(1, Math.round(app.player.frameMs || 1)) }) };
      cursor = h.part === 'body' ? 'grabbing' : 'ew-resize';
      return true;
    }
    loopDrag = { click: h.l.id };   // the passes: a click selects and highlights
    return true;
  }
  function loopMove(e, el) {
    const d = loopDrag, w = el.clientWidth;
    if (d.d) {
      d.d.move(e);
      const it = tl.draft.loops?.find((q) => q.id === d.id), at = d.part === 't0' ? 't0' : 't1';
      readout = it ? { x: X(app.view, w, it[at]), text: `${LP.loopLabel(it, A.fmOf(app))} · ${at === 't0' ? 'in' : 'out'} ${fmtMs(it[at])}` } : null;
    } else if (d.tile) d.tile(e);
  }
  function loopUp(e, el) {
    const d = loopDrag;
    loopDrag = null; readout = null;
    if (d.tile && d.cont && Math.abs(localX(e, el) - d.x0) < CLICK_PX) { clearDraft('loops'); A.continueShifted(app, d.id); return; }   // paw-j3to: the offer
    if (d.tile) { d.tile(e); clearDraft('loops'); A.setTiledEnd(app, d.id, d.end); return; }
    if (d.sug) { if (Math.abs(localX(e, el) - d.x0) < CLICK_PX) A.acceptSuggestion(app, d.sug); return; }
    if (d.click) { showLoopMatch(app, d.click); return; }
    const r = d.d.end(e);
    if (r === 'click') showLoopMatch(app, d.id);
    else if (r === 'edit') { const l = A.getLoop(app, d.id); if (l && d.looping) app.player.setLoop(l); }
  }
  function loopCancel() { loopDrag?.d?.cancel(); if (loopDrag?.tile) clearDraft('loops'); loopDrag = null; readout = null; }
  /** Right-click on a loop: its menu (every entry a command naming the loop, as the Loops row had) + the same-frame steps. */
  function loopMenu(e, h) {
    const t = h.t ?? xToMs(app.view, e.currentTarget.clientWidth, localX(e, e.currentTarget));
    if (h.kind === 'loopSug') { showContextMenu(e, [{ id: 'add', label: `Add detected loop (${h.s.frames ? h.s.frames + ' f' : Math.round(h.s.period) + ' ms'})`, icon: 'add', run: () => A.acceptSuggestion(app, h.s) }]); return; }
    const l = h.l, id = l.id, m = loopMeta.get(id), tiled = LP.isTiled(l);
    tl.loop = id;
    const target = LP.tileTarget(l, { range: app.doc.range, scenes: list, loops: app.doc.loops, dur: durOf(app) });
    const kf = (c) => app.commands.keysFor?.(c)?.[0];
    const cmd = (c, label, o = {}) => ({ id: c, label, shortcut: kf(c), run: () => app.commands.run(c, { id }), ...o });
    const ft = frameStartOf(t, gridOf(app.player));
    showContextMenu(e, [
      { section: `Loop · ${loopsInWords(app).get(id)?.short ?? ''}` },
      { label: 'Next same frame', shortcut: kf('loops.nextSame'), run: () => seekSame(app, 1, ft) },
      { label: 'Previous same frame', shortcut: kf('loops.prevSame'), run: () => seekSame(app, -1, ft) },
      { label: 'Show where it plays', run: () => showLoopMatch(app, id) },
      { separator: true },
      cmd('loops.tile', target ? `Tile to ${target.why} end (${fmtMs(target.end)})` : 'Tile…', { icon: 'layers', disabled: m.points < 2 }),
      cmd('loops.retile', m.stale ? 'Re-tile (cycle changed)' : 'Re-tile', { icon: 'refresh', disabled: !tiled }),
      cmd('loops.removeTiles', 'Remove tiles', { disabled: !tiled }),
      { separator: true },
      cmd('loops.snap', 'Snap the loop to frames', { icon: 'magnet', disabled: m.info.exact }),
      cmd('loops.useDetected', 'Use detected period', { disabled: !A.detectedFor(app, l) }),
      { label: 'Average the passes', type: 'checkbox', checked: !!l.avg, run: () => A.setLoopAvg(app, id, !l.avg) },
      cmd('loops.playback', 'Loop playback', { icon: 'loop', type: 'checkbox', checked: A.isLooping(app, l), shortcut: kf('loop.playToggle') }),
      { label: 'Options…', shortcut: kf('loops.open'), run: () => { loopPop.id = id; } },
      { separator: true },
      cmd('loops.remove', 'Delete loop', { icon: 'delete', shortcut: kf('loops.delete') }),
    ]);
  }
  let anchorEl = $state(), actAnchor = $state();
  const popLoop = $derived(A.getLoop(app, loopPop.id));

  function paint(ctx, w, h) {
    const H = h;
    const T = theme(), v = app.view, sc = list, sh = split(H), y1 = sh + 1;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    if (!sc.length) {
      drawHint(ctx, h, app.mode === 'scenes' ? 'No shots: detect them in the Actions panel' : 'No shots: detect them in the Scenes tab');
      return;
    }
    // paw-tog0: no zoom-wide switch any more (one narrow shot anywhere used to hide every grip and number): each boundary keeps
    // its grip while it has room (lod.js shownGrips; the selected, hovered and near one always), each shot its number while
    // it fits before the next drawn grip (layoutLabels)
    const job = tr?.busyRange, L = layersOf(w, H), tints = [], labEnd = [], links = linksOf(app), labs = [];
    const grips = gripsShown(w), cutX = (k) => X(v, w, sc[k].start_ms);
    // stop[k]: x of the first drawn grip or cutaway at or after boundary k (a label runs up to it), from the right edge in
    const stop = new Float64Array(sc.length + 1).fill(Infinity);
    for (let k = sc.length - 1; k >= 1; k--) { const xk = cutX(k); stop[k] = xk > w ? Infinity : grips.has(k) || L.shots[k]?.cut ? xk : stop[k + 1]; }
    let lf = '';   // the label font last set (setting ctx.font is a parse: once per change, not per shot)
    const setFont = (f) => { if (f !== lf) ctx.font = lf = f; };
    chains = [];
    // ---- the Shots strip ----
    ctx.fillStyle = T.raised; ctx.fillRect(0, y1, w, h - y1);
    const cov = coverOf(sc, actList), shade = blockShade(sc);   // paw-p2p0: the shade alternates at cuts, not across a camera move
    {
      for (let i = 0; i < sc.length; i++) {
        const kid = regionKind(cov[i]), K = kid ? kindOf(kid) : null;
        tints[i] = K;
        const s = sc[i], x0 = X(v, w, s.start_ms), x1 = X(v, w, s.end_ms), cut = L.shots[i].cut;
        if (x1 < 0 || x0 > w) continue;
        const a = Math.max(0, x0), b = Math.min(w, x1), blank = isBlank(s), sel = sceneSelected(i), wide = b - a >= TICK_MIN;
        if (cut) {   // under a cutaway (off-screen ones too) the scene runs on: its block's colour (the card goes on top, after the Scenes strip)
          ctx.fillStyle = T.raised; ctx.fillRect(a, y1, b - a, h - y1);
          ctx.fillStyle = K ? rgba(K.color, 0.3) : T.card; ctx.fillRect(a, y1, b - a, h - y1);
        } else if (blank) { ctx.fillStyle = T.mediaBg; ctx.fillRect(a, y1, b - a, h - y1); }
        else { ctx.fillStyle = shade[i] ? T.card : T.raised; ctx.fillRect(a, y1, b - a, h - y1); if (K) { ctx.fillStyle = rgba(K.color, 0.14); ctx.fillRect(a, y1, b - a, h - y1); } }
        if (isInternal(s) && b - a > 8 && !cut) { ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = T.txVal; ctx.lineWidth = 1; ctx.strokeRect(a + 2.5, y1 + 2.5, b - a - 5, h - y1 - 5); ctx.restore(); }   // internal view: a dotted inset (never solid: that is the active shot)
        if (sel && !cut) { ctx.fillStyle = T.reality; ctx.globalAlpha = 0.3; ctx.fillRect(a, y1, b - a, h - y1); ctx.globalAlpha = 1; }
        // tracked state: a 2 px line at the bottom
        const ts = wide ? trackState(i) : '';
        if (ts) {
          ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = ts === 'baked' ? T.reality : ts === 'live' ? T.txVal : ts === 'generated' ? T.txMut : T.ok;
          if (ts === 'live' || ts === 'bridged') ctx.setLineDash([4, 3]); else if (ts === 'generated') ctx.setLineDash([1, 3]);
          ctx.beginPath(); ctx.moveTo(a + 1, h - 1); ctx.lineTo(b - 1, h - 1); ctx.stroke(); ctx.restore();
          // paw-40ps: a live shot's baked run pieces (an edit / Bake of one piece): solid over their part of the line
          if (ts === 'live') for (const p of tr?.bakeState?.(i).pieces || []) if (p.state === 'baked') {
            const pa = Math.max(a + 1, X(v, w, p.t0)), pb = Math.min(b - 1, X(v, w, p.t1));
            if (pb > pa) { ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = T.reality; ctx.beginPath(); ctx.moveTo(pa, h - 1); ctx.lineTo(pb, h - 1); ctx.stroke(); ctx.restore(); }
          }
        }
        if (sel && i === tl.scene && !cut) { ctx.strokeStyle = T.reality; ctx.lineWidth = 2; ctx.strokeRect(a + 1, y1 + 1, Math.max(0, b - a - 2), h - y1 - 2); }   // the active shot
        const edge = s.transition, gw = Math.min(10, (x1 - x0) / 4);
        if (edge && !blank && gw >= 4) {   // soft edges: a ramp = fade, a cross = dissolve
          ctx.strokeStyle = T.txMut; ctx.lineWidth = 1.2; ctx.beginPath();
          const ya = h - 2, yb = y1 + 2;
          if (edge.in === 'fade') { ctx.moveTo(x0 + 1, ya); ctx.lineTo(x0 + gw, yb); }
          if (edge.in === 'dissolve') { ctx.moveTo(x0 + 1, ya); ctx.lineTo(x0 + gw, yb); ctx.moveTo(x0 + 1, yb); ctx.lineTo(x0 + gw, ya); }
          if (edge.out === 'fade') { ctx.moveTo(x1 - gw, yb); ctx.lineTo(x1 - 1, ya); }
          if (edge.out === 'dissolve') { ctx.moveTo(x1 - gw, yb); ctx.lineTo(x1 - 1, ya); ctx.moveTo(x1 - gw, ya); ctx.lineTo(x1 - 1, yb); }
          ctx.stroke();
        }
        if (cut || a > w - CAP_W) continue;   // a cutaway's words are on its card
        // the shot's number, its camera glyph, the chain, a "?" for re-found groups: as many as fit before the next drawn grip
        // (its room may run over a narrow shot whose grip is thinned out), else none (paw-tog0)
        const room = Math.min(w - CAP_W, stop[i + 1] - CUT_REACH);
        const x = Math.max(x0, 0) + 4 + (edge?.in === 'fade' || edge?.in === 'dissolve' ? gw : 0);
        const ly = loopIn(i) ? bandOf(y1, h).b : y1;   // paw-llaa: under the loops' band when the shot has a loop
        const fs = Math.max(8, Math.min(10, h - ly - 5)), lab = shotLabel(sc, i);
        const cam = sceneCamera(s), mv = boundaryKind(sc, i) === 'move', g = cam && cam !== 'static' && TAG[cam]?.icon ? cam : mv ? 'pan' : null, gs = Math.min(mv ? 12 : 10, h - ly - 3);
        setFont(font(fs, true));
        const parts = [textW(ctx, lab) + 5, ...(g ? [gs + 3] : []), ...(links.has(i) ? [14] : []), ...(unconfirmed(i) ? [10] : [])];
        labs.push({ i, x, room, parts, ly, fs, g, gs, col: blank ? T.series('grey') : sel ? T.txHi : T.txVal, force: sel || hot?.shot === i });
      }
      // the labels, thinned where they would overlap (the selected / hovered shot's first)
      const shown = layoutLabels(labs);
      labs.forEach((q, n) => {
        if (!shown[n]) return;
        const i = q.i, ym = (q.ly + h) / 2 + 0.5;
        let x = q.x, k = 1;
        setFont(font(q.fs, true)); ctx.fillStyle = q.col;
        ctx.fillText(shotLabel(sc, i), x, ym); x += q.parts[0];
        // the camera glyph; after a camera move (paw-p2p0) always (pan's arrows when it has no camera tag) and a size larger
        if (q.g && k < shown[n]) { camGlyph(ctx, q.g, x, q.ly, h, q.col, q.gs); x += q.parts[k++]; }
        if (links.has(i) && k < shown[n]) { const e = links.get(i), cj = new Set((e.crops || []).map((c) => c.j)); chainGlyph(ctx, x, ym, chainColor(i, T), !!e.crops?.length && e.crops.every((c) => c.via === 'loops') && e.others.every((j) => cj.has(j))); chains.push({ x0: x, x1: x + 11, y0: ym - 4, y1: ym + 4, i }); x += q.parts[k++]; }   // paw-llaa: the same loop in another shot
        if (k < shown[n]) { ctx.fillStyle = T.warn; setFont(font(q.fs, true, 600)); ctx.fillText('?', x, ym); x += 8; }
        labEnd[i] = x;
      });
    }
    paintLoops(ctx, w, H, T, y1);
    paintLoopWords(ctx, w, H, y1, labEnd);
    // ---- the Actions strip (paw-2lp7.5) ----
    paintActs(ctx, w, H, T);
    // ---- boundaries: cut = a solid line + notch; camera move = no line, no notch (paw-p2p0: its grip is the cut's, hollow,
    // paintGrips; its shot keeps the shade). paw-2lp7.5: no scene boundaries any more ----
    for (let i = 1; i < sc.length; i++) {
      const x = X(v, w, sc[i].start_ms);
      if (x < -2 || x > w + 2 || boundaryKind(sc, i) === 'move') continue;
      ctx.fillStyle = T.txMut; ctx.fillRect(x, y1, 1, h - y1);
      if (grips.has(i)) { ctx.beginPath(); ctx.moveTo(x - 3.5, y1); ctx.lineTo(x + 4.5, y1); ctx.lineTo(x + 0.5, y1 + 5); ctx.closePath(); ctx.fill(); }   // the cut's notch (with its grip)
    }
    paintFades(ctx, app, v, w, [y1, h], T);
    paintMidEdges(ctx, w, h, T, y1);
    paintLayer(ctx, w, L, T, tints, sc);
    paintHot(ctx, w, h, L, T, sh, y1);
    paintMatch(ctx, w, h, T, y1);
    paintGrips(ctx, w, h, T, sh, grips);
    drawOffers(ctx, app, w, T);
    h = H;
    drawRange(ctx, v, w, h, app.doc.range);
    if (box) { const a = X(v, w, Math.min(box.t0, box.t1)), b = X(v, w, Math.max(box.t0, box.t1)); ctx.fillStyle = T.reality; ctx.globalAlpha = 0.15; ctx.fillRect(a, 0, b - a, h); ctx.globalAlpha = 0.8; ctx.strokeStyle = T.reality; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, 0.5, Math.max(0, b - a - 1), h - 1); ctx.globalAlpha = 1; }
    if (job) {
      const k0 = tintOf(sc[sceneIndexAt(sc, job.t0)]);
      drawProgress(ctx, v, w, { ...job, frac: tr.progressFrac, text: tr.progressLabel }, k0 ? kindOf(k0).color : T.reality, 0, h);
    }
    // the strip names on a plate at the right edge (the "?" legend sits beside them)
    ctx.font = font(8, false, 600);
    const cw = ctx.measureText('ACTIONS').width + 8;
    ctx.fillStyle = T.bg; ctx.globalAlpha = 0.8; ctx.fillRect(w - 22 - cw, 0, cw + 22, h); ctx.globalAlpha = 1;
    ctx.textAlign = 'right'; ctx.fillStyle = T.txMut;
    ctx.fillText('ACTIONS', w - 22, lay(H).main.y0 + (lay(H).main.y1 - lay(H).main.y0) / 2); if (H - y1 >= 9) ctx.fillText('SHOTS', w - 22, (y1 + H) / 2 + 0.5);
    ctx.textAlign = 'left';
    // the grip being taken (selected, hovered, near) is drawn over the names' plate too: what a press takes is seen (paw-tog0)
    const live = new Set([selectedCut(app), hot?.kind === 'cut' ? hot.i : -1, near.startsWith('shots:') ? +near.slice(6) : -1].filter((i) => grips.has(i) && cutX(i) > w - CAP_W - 8));
    if (live.size) paintGrips(ctx, w, h, T, sh, live);
    paintSeeds(ctx, w, h, T);
    if (drag && drag.moved && drag.i >= 1 && drag.i < sc.length) { ctx.fillStyle = T.warn; ctx.fillRect(X(v, w, (drag.preview ?? sc[drag.i]).start_ms) - 1, 0, 2, h); }
  }

  // ---- paw-46du: the seed frames (painted parts, the runs' seeds; commands-scenes.js seedsOf): a small tab pointing up near the
  // foot of the Shots strip, in --intent (the playhead is --highlight: a mark under it stays seen), its base SEED_UP px over the
  // bottom edge (the row splitter's hit band takes the last 4 px), away from the ruler's cut ticks and bookmarks; over a cut it
  // sits on the lower end of the grip's pill (drawn over it); drawn over the strip names' plate too. Only those in view are visited (seedFrom: binary search), one per 2 px.
  // Hover: what and when; click: that exact frame; right-click: previous / next, Groups on that frame ----
  const SEED_W = 5, SEED_H = 7, SEED_UP = 5, SEED_HIT = 14;
  function paintSeeds(ctx, w, h, T) {
    const v = app.view, S = seedsOf(app);
    if (!S.length) return;
    ctx.save(); ctx.fillStyle = T.intent; ctx.strokeStyle = T.bg; ctx.lineWidth = 1;
    let last = -Infinity;
    for (let k = seedFrom(S, xToMs(v, w, -SEED_W - 1)); k < S.length; k++) {
      const x = X(v, w, S[k].t);
      if (x > w + SEED_W + 1) break;
      const lit = hot?.kind === 'seed' && hot.m.t === S[k].t;
      if (x - last < 2 && !lit) continue;
      last = x;
      const hw = lit ? SEED_W + 1 : SEED_W, hh = lit ? SEED_H + 2 : SEED_H;
      const yb = h - SEED_UP;
      ctx.beginPath(); ctx.moveTo(x - hw, yb); ctx.lineTo(x, yb - hh); ctx.lineTo(x + hw, yb); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  /** The seed frame whose tab is under (x, y) in a w x H row (the strip's foot above the splitter's band, SEED_W + 2 px either
   *  side), or null. */
  function seedAt(x, y, w, H) {
    if (y < H - SEED_HIT || y >= H - SEED_UP + 1) return null;
    const S = seedsOf(app), v = app.view, r = SEED_W + 2;
    let best = null, bd = r + 0.01;
    for (let k = seedFrom(S, xToMs(v, w, x - r)); k < S.length; k++) {
      const d = X(v, w, S[k].t) - x;
      if (d > r) break;
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = S[k]; }
    }
    return best;
  }
  function seedTip(m) {
    const g = gridOf(app.player), n = frameLen(g) ? frameAt(m.t, g) : Math.round(m.t / (app.player.frameMs || 1000 / 30));
    const parts = m.painted.map((p) => partLabel(p) || 'a part'), kp = key('timeline.key.prevSeed'), kn = key('timeline.key.nextSeed');
    const what = [parts.length ? `painted here: ${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ` and ${parts.length - 4} more` : ''}` : '',
      m.runs.length ? `run${m.runs.length > 1 ? 's' : ''} #${m.runs.join(', #')} seeded here` : ''].filter(Boolean).join(' · ');
    return `Seed frame · ${fmtMs(m.t)} (frame ${n}) · ${what}\nclick: go to this frame${kp || kn ? ` · ${kp} / ${kn}: previous / next seed frame (round the video)` : ''} · right-click: more`;
  }
  function seedMenu(e, m) {
    const kf = (c) => app.commands.keysFor?.(c)?.[0], go = (t) => app.player.seek(t, { exact: true }), S = seedsOf(app), fm = Math.max(1, (app.player.frameMs || 1000 / 30) / 2);
    const G = 'tracking.groups', canPaint = !peekGroups?.(app)?.on && app.commands.enabled(G);
    showContextMenu(e, [
      { section: `Seed frame · ${fmtMs(m.t)}` },
      { label: 'Go to this frame', run: () => go(m.t) },
      { label: 'Previous seed frame', shortcut: kf('timeline.key.prevSeed'), disabled: S.length < 2, run: () => go(seedStep(S, m.t, -1, fm)) },
      { label: 'Next seed frame', shortcut: kf('timeline.key.nextSeed'), disabled: S.length < 2, run: () => go(seedStep(S, m.t, 1, fm)) },
      ...(canPaint ? [{ separator: true }, { label: `${app.commands.get(G)?.title || 'Groups'} on this frame`, shortcut: kf(G), run: () => { go(m.t); app.commands.run(G); } }] : []),
    ], { source: e.currentTarget });
  }

  // ---- paw-2lp7.5: the Actions strip ----
  /** The regions in their lanes (actions-strip.js), the hovered / selected one outlined. */
  function paintActs(ctx, w, H, T) {
    const Ly = lay(H), rects = regionRects(actList, (t) => X(app.view, w, t), Ly, w);
    ctx.save();
    ctx.fillStyle = T.raised; ctx.globalAlpha = 0.55; ctx.fillRect(0, Ly.pos.y0, w, Ly.pos.y1 - Ly.pos.y0);   // the positioning lane
    ctx.globalAlpha = 0.22; for (const k of Ly.layers) ctx.fillRect(0, k.y0, w, k.y1 - k.y0);   // the secondary bands
    ctx.globalAlpha = 1;
    for (const q of rects) paintRegion(ctx, q, w, T);
    ctx.restore();
  }
  const MIX_WORD = { mix: 'mix', layer: 'layer', ignore: 'ignore' };
  const POS_WORDS = 'positioning · eased, out of range';
  function paintRegion(ctx, q, w, T) {
    const GREY = T.txMut, r = q.r, a = Math.max(-4, q.x0 + 1), b = Math.min(w + 4, q.x1 - 1), bw = b - a, y0 = q.y0, hh = q.y1 - q.y0;
    if (bw < 1 || hh < 2) return;
    const kid = regionKind(r), K = kid ? kindOf(kid) : null, col = K?.color ?? GREY, sel = tl.act === r.id, lit = (hot?.r?.id === r.id && !drag && !actDrag);
    const untagged = r.kind === 'act' && !r.tags.length, rad = Math.min(3, bw / 2, hh / 2), path = () => round(ctx, a + 0.5, y0 + 0.5, bw - 1, hh - 1, rad);
    path();
    if (r.kind === 'positioning') {   // hatched
      ctx.save(); ctx.clip(); ctx.fillStyle = rgba(GREY, 0.25); ctx.fillRect(a, y0, bw, hh);
      ctx.strokeStyle = T.txVal; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.beginPath();
      for (let xx = a - hh; xx < b; xx += 4) { ctx.moveTo(xx, y0 + hh); ctx.lineTo(xx + hh, y0); }
      ctx.stroke(); ctx.restore();
    } else if (r.auto) { ctx.fillStyle = rgba(K ? col : GREY, 0.07); ctx.fill(); }   // a proposal: hollow
    else if (untagged) { ctx.fillStyle = T.card; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; }
    else if (r.kind === 'rest') {   // a breather: a soft dotted fill (not idle's flat grey)
      ctx.save(); ctx.clip(); ctx.fillStyle = rgba(GREY, 0.12); ctx.fillRect(a, y0, bw, hh); ctx.fillStyle = rgba(GREY, 0.75);
      for (let yy = y0 + 2, n = 0; yy < y0 + hh - 1; yy += 3, n++) for (let xx = a + 2 + (n % 2) * 2; xx < b; xx += 4) ctx.fillRect(xx, yy, 1, 1);
      ctx.restore();
    } else if (r.kind !== 'act') { ctx.fillStyle = rgba(GREY, 0.32); ctx.fill(); }
    else { ctx.fillStyle = rgba(col, r.mix === 'ignore' ? 0.1 : 0.3); ctx.fill(); }
    path(); ctx.lineWidth = r.auto ? 1.3 : 1;
    if (r.auto || untagged) ctx.setLineDash([3, 2]); else if (r.mix === 'ignore') ctx.setLineDash([1, 2]);
    ctx.strokeStyle = r.auto ? (K ? col : T.reality) : untagged ? T.line4 : r.kind === 'act' ? rgba(col, 0.9) : rgba(GREY, 0.85);
    ctx.stroke(); ctx.setLineDash([]);
    if (sel || lit) { round(ctx, a + 1, y0 + 1, bw - 2, hh - 2, rad); ctx.strokeStyle = sel ? T.reality : T.txHi; ctx.lineWidth = sel ? 2 : 1; ctx.globalAlpha = sel ? 1 : 0.6; ctx.stroke(); ctx.globalAlpha = 1; }
    if (r.kind === 'positioning') {   // paw-2lp7.1: what it does, in a few words on a backing (the tooltip says it in full)
      const x0 = Math.max(a, 0) + 3, room = Math.min(b, w - CAP_W) - 3 - x0;
      if (room < 24 || hh < 8) return;
      ctx.save(); ctx.font = font(8, false, 600); ctx.textBaseline = 'middle';
      const txt = fitText(ctx, POS_WORDS, room - 4);
      if (txt) { ctx.fillStyle = T.card; ctx.globalAlpha = 0.85; ctx.fillRect(x0, y0 + 1, ctx.measureText(txt).width + 4, hh - 2); ctx.globalAlpha = 1; ctx.fillStyle = sel ? T.txHi : T.txVal; ctx.fillText(txt, x0 + 2, y0 + hh / 2 + 0.5); }
      ctx.restore();
      return;
    }
    if (bw < 14 || hh < 7 || a > w - CAP_W) return;
    const chip = mixChip(q, w), x0 = Math.max(a, 0) + 5, right = Math.min(b, w - CAP_W, chip ? chip.x0 : Infinity) - 3, fs = Math.max(8, Math.min(r.layer ? 9 : 11, hh - 6));
    ctx.save(); ctx.beginPath(); ctx.rect(a, y0, Math.max(0, right - a), hh); ctx.clip();
    ctx.font = font(fs, false, r.layer ? 500 : 600); ctx.textBaseline = 'middle';
    ctx.fillStyle = r.auto ? (K ? col : T.reality) : untagged ? T.txMut : sel ? T.txHi : r.kind === 'act' ? T.tx : T.txVal;
    const txt = fitText(ctx, regionWords(r) + (r.auto ? '?' : ''), right - x0);   // paw-tog0: a few letters and an ellipsis before it goes
    if (txt) ctx.fillText(txt, x0, y0 + hh / 2 + 0.5);
    ctx.restore();
    if (chip) {   // the mix chip: mix / layer / ignore
      const on = hot?.kind === 'actMix' && hot.r.id === r.id;
      round(ctx, chip.x0 + 0.5, chip.y0 + 0.5, chip.x1 - chip.x0 - 1, chip.y1 - chip.y0 - 1, 2);
      ctx.fillStyle = T.card; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = on ? T.txHi : T.line4; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = font(8, false, 600); ctx.fillStyle = r.mix === 'ignore' ? T.txMut : on ? T.txHi : T.txVal; ctx.textAlign = 'center';
      ctx.fillText(MIX_WORD[r.mix ?? 'mix'], (chip.x0 + chip.x1) / 2, (chip.y0 + chip.y1) / 2 + 0.5); ctx.textAlign = 'left';
    }
  }
  /** Where the main-line action changes inside a shot: a notch at the top of the shot and a dotted line through it. */
  function paintMidEdges(ctx, w, H, T, y1) {
    ctx.save(); ctx.fillStyle = T.warn;
    for (const m of midEdges) {
      const x = X(app.view, w, m.t);
      if (x < -4 || x > w + 4) continue;
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(x - 3.5, y1); ctx.lineTo(x + 3.5, y1); ctx.lineTo(x, y1 + 4.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.75; for (let y = y1 + 6; y < H - 2; y += 3) ctx.fillRect(x - 0.5, y, 1, 1.5);
    }
    ctx.restore();
  }
  const midEdgeAt = (x, w) => midEdges.find((m) => Math.abs(X(app.view, w, m.t) - x) <= 4) ?? null;
  const yOf = (e, el) => e.clientY - el.getBoundingClientRect().top;

  // a drag in the Actions strip: create (an empty lane), resize (an edge), move / change layer (the body)
  let actDrag = null;
  function actDown(e, el, hit) {
    const w = el.clientWidth, x = localX(e, el), r = hit.r ?? null;
    tl.cut = null; tl.loop = null;
    if (tl.match) clearMatch();
    if (hit.kind === 'actMix') {   // mix -> layer -> ignore
      const m = MIXES[(MIXES.indexOf(r.mix ?? 'mix') + 1) % MIXES.length];
      if (commitActs(app, `Mix: ${m}`, setRegionMix(app.doc.acts, r.id, m))) app.toast(`${regionWords(r)}: ${m}${m === 'layer' ? ' (mixes for now)' : m === 'ignore' ? ' (marked only, the main line drives the motion)' : ''}`, 'quiet');
      tl.act = r.id;
      return;
    }
    el.setPointerCapture?.(e.pointerId);
    const sc = snapContext(app, w), ph = playheadFrameStart(app.player), base = app.doc.acts || [];
    const alt = hit.kind === 'actBody' && e.altKey && r.kind !== 'positioning';   // Alt+drag on a region: a new one on the layer above it
    const cap = layerCap(base, hit.kind === 'actBody' && !alt ? r.id : null);   // paw-2lp7.9: one layer above those in use, fixed for the drag
    actDrag = { kind: alt ? 'actEmpty' : hit.kind, r, side: hit.side, x0: x, y0: yOf(e, el), w, t0: xToMs(app.view, w, x), base, moved: false, result: null, cap,
      layer: Math.min(cap, alt ? r.layer + 1 : hit.layer ?? r?.layer ?? 0), positioning: alt ? false : hit.kind === 'actEmpty' ? !!hit.positioning : r?.kind === 'positioning',
      targets: regionTargets(base, r?.id, sc.targets.map((q) => (q.label === 'playhead' ? { ...q, t: ph } : q))), tol: sc.tol, grid: sc.frameMs };
    hot = null;
  }
  function actMove(e, el) {
    const d = actDrag, x = localX(e, el), y = yOf(e, el);
    if (!d.moved && Math.abs(x - d.x0) < CLICK_PX && Math.abs(y - d.y0) < 5) return;
    d.moved = true;
    const t = xToMs(app.view, d.w, x), snap = (q) => snapAt(q, d.targets, d.tol, d.grid, e.shiftKey), fr = Math.max(1, Math.round(app.player.frameMs || 1));
    let res = null, at = null, hit = null;
    if (d.kind === 'actEmpty') {
      const a = snap(d.t0), b = snap(t), t0 = Math.min(a.t, b.t), t1 = Math.max(a.t, b.t);
      d.made = { t0, t1, layer: d.positioning ? 0 : d.layer };
      if (t1 - t0 >= fr) res = addRegion(d.base, { kind: d.positioning ? 'positioning' : 'act', t0, t1, layer: d.made.layer, tags: d.positioning ? [] : mruOf(app)[0] ?? [] });
      at = b.t; hit = b.hit;
    } else if (d.kind === 'actEdge') {
      const s = snap(t), r = d.r, t0 = d.side === 't0' ? s.t : r.t0, t1 = d.side === 't1' ? s.t : r.t1;
      if (t1 - t0 >= fr) res = resizeRegion(d.base, r.id, t0, t1);
      at = s.t; hit = s.hit;
    } else {
      const dt = t - d.t0, r = d.r, s0 = snap(r.t0 + dt), s1 = snap(r.t1 + dt);
      const use1 = !!s1.hit && (!s0.hit || Math.abs(s1.t - (r.t1 + dt)) < Math.abs(s0.t - (r.t0 + dt))), ddt = use1 ? s1.t - r.t1 : s0.t - r.t0;
      const lane = laneAt(lay(el.clientHeight), y);   // the layout as painted now (the row grows with the draft)
      d.toLayer = r.kind === 'positioning' || !lane || lane.positioning ? r.layer : Math.min(lane.layer, d.cap);
      res = moveToLayer(d.base, r.id, d.toLayer, ddt);
      at = r.t0 + ddt; hit = (use1 ? s1 : s0).hit;
    }
    d.result = res;
    if (res) setDraft('acts', res); else clearDraft('acts');
    tr?.actsDrag?.();   // paw-24b8: a positioning range's ease and the runs follow live
    tl.snap = hit ? { t: hit.t, label: hit.label } : null;
    if (at != null && Number.isFinite(at)) app.player.dragTo(Math.max(0, at), { snap: true });   // the video shows the frame under the dragged edge (paused: decoded, paw-o60v.8)
  }
  function actUp() {
    const d = actDrag;
    actDrag = null; clearDraft('acts'); tr?.actsDrag?.(true); tl.snap = null; app.player.scrubEnd?.();
    if (!d.moved) {
      // paw-iphl: a click on an empty stretch of the Actions / positioning lane, and in the Track tab (where the shot is what
      // you work on) a click anywhere on the band, selects the shot under it, as a click on the Shots strip does (the guide's
      // "click the shot"); a drag there still draws / moves a region
      // paw-qoo5: there, an action over part of one shot is selected itself (T then tracks just it)
      if (d.kind === 'actEmpty' || (app.mode === 'track' && !partOfShot(d.r, list))) { selectAct(app, null); const i = sceneIndexAt(list, d.t0); if (i >= 0) { tl.cut = null; applySel(app, selShot(i), 'click'); } return; }
      if (d.r.auto && d.kind === 'actBody') { acceptAct(app, d.r.id); tl.act = d.r.id; return; }   // one click accepts a proposal
      return selectAct(app, d.r);
    }
    if (!d.result || d.result === d.base) return;
    const label = d.kind === 'actEmpty' ? (d.positioning ? 'New positioning range' : 'New action region') : d.kind === 'actEdge' ? 'Resize action region'
      : d.toLayer !== d.r.layer ? (d.toLayer === 0 ? 'Action to the main line' : `Action to layer ${d.toLayer}`) : 'Move action region';
    commitActs(app, label, d.result);
    const now = app.doc.acts || [], m = d.made, made = d.kind === 'actEmpty' ? now.find((x) => x.t0 === m.t0 && x.t1 === m.t1 && x.layer === m.layer && !d.base.some((y) => y.id === x.id)) : now.find((x) => x.id === d.r.id);
    if (made) selectAct(app, made);
    if (d.kind === 'actEmpty' && made?.tags.length) noteMru(app, made.tags);
    app.usage?.note?.('acts:drag', { kind: d.kind, layer: d.toLayer ?? d.layer });
  }
  /** Right-click in the Actions strip: a region's menu (a proposal: dismissed), or an empty lane's. */
  function actMenu(e, hit, t) {
    const kf = (c) => app.commands.keysFor?.(c)?.[0];
    if (hit.kind === 'actEmpty' || !hit.r) {
      const s = list[sceneIndexAt(list, t)];
      if (!s || hit.kind !== 'actEmpty') return;
      const layer = hit.positioning ? 0 : hit.layer, mk = (kind, tags) => commitActs(app, kind === 'positioning' ? 'New positioning range' : 'New action region', addRegion(app.doc.acts || [], { kind, t0: s.start_ms, t1: s.end_ms, layer, tags }));
      showContextMenu(e, [{ section: hit.positioning ? 'Positioning' : layer ? `Layer ${layer}` : 'Main line' },
        hit.positioning ? { label: 'Positioning over this shot', run: () => mk('positioning', []) } : { label: 'Action over this shot', shortcut: kf('timeline.acts.new'), run: () => mk('act', mruOf(app)[0] ?? []) },
        ...(hit.positioning || layer ? [] : ['intro', 'idle', 'rest', 'outro'].map((k) => ({ label: `${k[0].toUpperCase()}${k.slice(1)} over this shot`, run: () => mk(k, []) })))]);
      return;
    }
    const r = hit.r;
    if (r.auto) return removeAct(app, r.id);   // a proposal: right-click dismisses it
    selectAct(app, r);
    const tin = playheadFrameStart(app.player), canSplit = tin > r.t0 && tin < r.t1, canMerge = !!mergeRegion(app.doc.acts, r.id, 0);
    const toLayer = (n, label) => ({ label, run: () => commitActs(app, n ? `Action to layer ${n}` : 'Action to the main line', moveToLayer(app.doc.acts, r.id, n)) });
    showContextMenu(e, [
      { section: regionWords(r) },
      { label: 'Tag…', shortcut: kf('timeline.acts.enter'), run: () => { tl.actPop = r.id; } },
      ...(canSplit ? [{ label: 'Split at the playhead', shortcut: kf('timeline.acts.split'), run: () => actCmds.split(app, r) }] : []),
      ...(canMerge ? [{ label: 'Merge with the same action', shortcut: kf('timeline.acts.mergeKey'), run: () => actCmds.merge(app, 0, r) }] : []),
      { label: 'Select its shots', run: () => actCmds.selectShots(app) },
      ...(r.kind === 'positioning' ? [] : [{ separator: true }, ...(r.layer ? [toLayer(0, 'To the main line')] : []), ...(r.layer < layerCap(app.doc.acts, r.id) ? [toLayer(r.layer + 1, 'To a layer above')] : []),
        ...(r.layer && r.kind === 'act' ? MIXES.map((m) => ({ label: `Mix: ${m}`, type: 'radio', checked: (r.mix ?? 'mix') === m, run: () => commitActs(app, `Mix: ${m}`, setRegionMix(app.doc.acts, r.id, m)) })) : [])]),
      { separator: true },
      { label: 'Delete', icon: 'delete', shortcut: kf('timeline.acts.delete'), run: () => removeAct(app, r.id) },
    ]);
  }
  /** The words for a region under the pointer (its tooltip), with what a click, a drag and the keys do. */
  function actTip(h) {
    const k = (id) => key(id) || '';
    if (h.kind === 'actMix') return `Mix of this secondary action: ${h.r.mix ?? 'mix'} · click: mix → layer → ignore (mix: its motion mixed into the main line's; layer: its own lane, coming (it mixes for now); ignore: marked only, the motion stays the main line's)`;
    if (h.kind === 'actEmpty') {
      if (h.positioning) return 'Positioning lane · drag: a positioning range (characters moving between poses, inside a shot; it may lie over an action): still tracked, kept out of the range of motion, the script eases through it · right-click: over this shot';
      const m = mruOf(app)[0];
      return `${h.layer ? `Layer ${h.layer}` : 'Main line'} · drag: a new action region${m ? ` (the last used: ${regionWords({ kind: 'act', tags: m })})` : ''}, across cuts as you like · ${k('timeline.acts.new')}: a region over the selected shots, 1–9: the recent actions · right-click: over this shot`;
    }
    const r = h.r, where = r.kind === 'positioning' ? 'positioning lane' : r.layer ? `layer ${r.layer} (secondary, ${r.mix ?? 'mix'})` : 'main line', n = shotsUnder(app, r).length;
    if (h.kind === 'actEdge') return `${h.side === 't0' ? 'Start' : 'End'} of ${regionWords(r)} · drag: move it on frames (snaps to cuts, other actions, the playhead; Shift: frames only) · ${k(h.side === 't0' ? 'timeline.acts.startHere' : 'timeline.acts.endHere')} with it selected: to the playhead`;
    if (r.auto) return `Proposed: ${actLabel(r)} · click or ${k('timeline.acts.enter')}: accept · right-click or ${k('timeline.acts.delete')}: dismiss · the Actions panel: accept all`;
    if (r.kind === 'positioning') return `Positioning · ${n} shot${n === 1 ? '' : 's'}\nStill tracked; kept out of the range of motion (range, level, fusion and depth calibrate on the rest of the shot). The script here: one slow move from the level before to the first stroke after it (a ghost; right-click: accept it), unless you have points in it\nclick: select · drag: move · edges: resize · right-click: more · ${k('timeline.acts.delete')} delete`;
    return `${actLabel(r)} · ${where} · ${n} shot${n === 1 ? '' : 's'}${r.kind === 'act' && !r.tags.length ? ' · untagged' : ''}\nclick: select · drag: move (up / down: another layer, what is there swaps with it; Alt+drag: a new action on the layer above) · double-click / ${k('timeline.acts.enter')}: tag it · right-click: more`
      + `\nwith it selected: ${k('timeline.acts.split')} split at the playhead · ${k('timeline.acts.mergeKey')} merge with the same action · ${k('timeline.acts.startHere')} ${k('timeline.acts.endHere')} start / end at the playhead · ${k('timeline.acts.extend')} extend · 1–9 a recent action · ${k('timeline.acts.delete')} delete${app.mode === 'track' && partOfShot(r, list) && k('track.gridFrame') ? ` · ${k('track.gridFrame')} track just it` : ''}`;
  }
  /** The main-line action at time t (its middle rule), for the cutaway words. */
  const baseAt = (t) => actsAt(app.doc.acts, t).find((r) => r.layer === 0 && r.kind !== 'positioning' && !r.auto) ?? null;

  // paw-2lp7.4: the card's two words: its mark, then what it does (MARK_WORDS in full on hover)
  const CARD_WORD = { offscreen: 'off-screen', carried: 'cutaway', intermission: 'cutaway' };
  const CARD_DOES = { offscreen: 'bridged', carried: 'action continues', intermission: 'intermission' };
  /** The cutaway layer (paw-ef73.2): each cutaway as a raised card over its scene (a shadow under it, the scene's
   *  colour, its number and what it does) and each proposed off-screen shot as a dashed card ("off-screen?"). */
  function paintLayer(ctx, w, L, T, tints, sc) {
    const card = (r, x0, x1) => { const a = Math.max(-3, x0 + 1), b = Math.min(w + 3, x1 - 1); round(ctx, a + 0.5, r.y0 + 0.5, Math.max(1, b - a - 1), r.y1 - r.y0 - 1, Math.min(3, (b - a) / 2)); return [a, b]; };
    for (const r of L.shots) {
      if (!r.cut || r.x1 < 0 || r.x0 > w) continue;
      const i = r.i, K = tints[i], sel = sceneSelected(i);
      ctx.save(); ctx.shadowColor = theme().mediaScrim; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
      const [a, b] = card(r, r.x0, r.x1);
      ctx.fillStyle = T.card; ctx.fill(); ctx.restore();
      if (K) { ctx.fillStyle = rgba(K.color, 0.2); ctx.fill(); }
      if (sel) { ctx.fillStyle = T.reality; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; }
      // the edge: the action's colour = bridged (off-screen, a cutaway under an action), grey dashed = an intermission; thicker = timing from the shot
      const tm = sc[i].fill === 'timing' && r.cut !== 'intermission';
      if (r.cut === 'intermission') ctx.setLineDash([3, 2]);
      ctx.strokeStyle = r.cut === 'intermission' ? T.txMut : K ? rgba(K.color, 0.95) : T.txMut; ctx.lineWidth = tm ? 1.6 : 1; ctx.stroke(); ctx.setLineDash([]);
      if (sel && i === tl.scene) { card(r, r.x0 + 1, r.x1 - 1); ctx.strokeStyle = T.reality; ctx.lineWidth = 2; ctx.stroke(); }   // the active shot
      if (b - a < 16 || a > w - CAP_W) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(a, r.y0, Math.min(b, w - CAP_W) - a, r.y1 - r.y0); ctx.clip();
      const fs = Math.max(8, Math.min(10, r.y1 - r.y0 - 5)), y = (r.y0 + r.y1) / 2 + 0.5, lab = shotLabel(sc, i);
      let x = Math.max(a, 0) + 4;
      ctx.font = font(fs, true); ctx.fillStyle = sel ? T.txHi : T.tx;
      if (b - x >= ctx.measureText(lab).width + 2) { ctx.fillText(lab, x, y); x += ctx.measureText(lab).width + 5; }
      const word = CARD_WORD[r.cut], cont = tm ? `${CARD_DOES[r.cut]} · timing` : CARD_DOES[r.cut];
      ctx.font = font(fs, false, 500); ctx.fillStyle = T.txVal;
      if (b - x >= ctx.measureText(word).width + 4) { ctx.fillText(word, x, y); x += ctx.measureText(word).width + 6; }
      ctx.fillStyle = T.txMut;
      if (b - x >= ctx.measureText(cont).width + 4) ctx.fillText(cont, x, y);
      ctx.restore();
    }
    for (const { k } of proposed) {   // a proposed cutaway: a dashed card (round a card already raised: its own scene still), click its raised part to take it
      const r = L.shots[k];
      if (!r || r.x1 < 0 || r.x0 > w) continue;
      const g = r.cut ? { y0: L.top - 1.5, y1: L.bottom + 1.5 } : { y0: L.top, y1: L.bottom }, [a, b] = card(g, r.x0 - (r.cut ? 1.5 : 0), r.x1 + (r.cut ? 1.5 : 0));
      if (!r.cut) { ctx.fillStyle = T.reality; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.setLineDash([3, 2]); ctx.strokeStyle = T.reality; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
      if (!r.cut && a < w - CAP_W) { ctx.font = font(8, false, 600); const t = fitText(ctx, 'off-screen?', Math.min(b, w - CAP_W) - Math.max(a, 0) - 8); if (t) { ctx.fillStyle = T.reality; ctx.fillText(t, Math.max(a, 0) + 4, L.top + 5.5); } }
    }
  }
  /** The hovered body (a faint lift and outline: the shot, or the scene block), the cut grip under the pointer (its line
   *  bright) and the selected cut (its line in the accent), and the buttons on the hovered / selected shot. */
  function paintHot(ctx, w, h, L, T, sh, y1) {
    const v = app.view;
    if (hot?.kind === 'body' && hot.shot >= 0 && !drag) {
      {
        const r = L.shots[hot.shot];
        if (r) { ctx.fillStyle = T.txHi; ctx.globalAlpha = 0.06; ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); ctx.globalAlpha = 0.5; ctx.strokeStyle = T.txHi; ctx.lineWidth = 1; ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, Math.max(0, r.x1 - r.x0 - 1), r.y1 - r.y0 - 1); ctx.globalAlpha = 1; }
      }
    }
    const line = (i, col, lw, top) => { if (!(i > 0 && i < list.length)) return; ctx.fillStyle = col; ctx.fillRect(X(v, w, list[i].start_ms) - lw / 2, top, lw, h - top); };
    line(selectedCut(app), T.reality, 2, y1);
    if (hot?.kind === 'cut') line(hot.i, T.txHi, 3, hot.strip === 'scenes' ? 0 : y1);
    for (const b of buttonsOf(L, h)) {
      const lit = hot?.kind === 'button' && hot.b.id === b.id && hot.shot === b.shot;
      round(ctx, b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0 - 1, b.y1 - b.y0 - 1, 3);
      ctx.fillStyle = T.card; ctx.globalAlpha = 0.94; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = b.on ? T.reality : lit ? T.txHi : T.line4; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = font(8, false, 600); ctx.fillStyle = b.on || lit ? T.txHi : T.tx; ctx.textAlign = 'center';
      ctx.fillText(b.label, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 + 0.5); ctx.textAlign = 'left';
    }
  }
  /** Every cut's grip (paw-ef73.18): a pill on its line in the Shots strip's grip strip (paw-ef73.28: the whole strip when
   *  no fade handle is near; scene boundaries also in the Scenes strip, in the gap): light with a dark rim, bigger as the
   *  pointer comes near, bright under it, the accent when selected. */
  function paintGrips(ctx, w, h, T, sh, shown) {
    const v = app.view, sel = selectedCut(app);
    const cuts = [];
    for (const i of shown) cuts.push({ i, x: X(v, w, list[i].start_ms) });
    const G = shotGrips({ sh, H: h, w, view: v, dur: durOf(app), fades: shownTransitions(app), cuts });
    for (const { i, x } of cuts) {
      const on = hot?.kind === 'cut' && hot.i === i && hot.strip === 'shots', p = pillOf(x, G.get(i), on || near === `shots:${i}`);
      // paw-p2p0: filled = cut, hollow = camera move (the same pill, the same hit area)
      drawGrip(ctx, p, { hollow: boundaryKind(list, i) === 'move', col: i === sel ? T.reality : on ? T.txHi : undefined });
    }
  }
  /** paw-tog0: the boundaries in view whose grip is drawn (lod.js shownGrips: thinned only where grips would touch; the
   *  selected, hovered and near one always: the one a press takes is the one drawn). -> Set(i) */
  function gripsShown(w) {
    const v = app.view, sel = selectedCut(app), hi = hot?.kind === 'cut' ? hot.i : -1, ni = near.startsWith('shots:') ? +near.slice(6) : -1, cuts = [];
    for (let i = 1; i < list.length; i++) {
      const x = X(v, w, list[i].start_ms);
      if (x < -8) continue;
      if (x > w + 8) break;
      cuts.push({ i, x, move: boundaryKind(list, i) === 'move', force: i === sel || i === hi || i === ni });
    }
    return shownGrips(cuts);
  }
  const stripOf = (e, el) => (e.offsetY < split(el.clientHeight) ? 'scenes' : 'shots');
  /** The shot the buttons sit on: the hovered one (its body or its buttons), else the active selected one. */
  const buttonShot = () => (hot?.kind === 'body' && hot.strip === 'shots' ? hot.shot : hot?.kind === 'button' ? hot.shot : tl.shots.includes(tl.scene) ? tl.scene : -1);
  /** The buttons on that shot (scenes-hit.js shotButtons: a plain shot "cutaway", a card its two choices). */
  function buttonsOf(L, H) {
    const k = buttonShot(), r = L.shots[k];
    if (!r || drag || fade) return [];
    return shotButtons(r, shotsGrip(split(H) + 1, H), { timing: list[k]?.fill === 'timing', extend: !!r.cut && !!carryAcross(app.doc.acts, list, k) }).map((b) => ({ ...b, shot: k }));
  }
  /** What the pointer at x is on (scenes-hit.js rowHit), with the shot under it for a body. */
  function hitOf(e, el, x) {
    const w = el.clientWidth, H = el.clientHeight, sh = split(H), L = layersOf(w, H), v = app.view;
    const cuts = list.slice(1).map((s, k) => ({ i: k + 1, x: X(v, w, s.start_ms) }));
    const q = { px: x, py: e.offsetY, sh, H, w, view: v, dur: durOf(app), fades: shownTransitions(app), cuts, sceneCuts: [] };   // paw-2lp7.5: no scene grips
    const n = rowNear(q);
    near = n ? `${n.strip}:${n.i}` : '';
    const py = yOf(e, el);
    if (py < sh + 1) {   // the Actions strip: an offer badge, a shot button, a raised cutaway / proposal, else the regions
      const o = offerAt(app, x, py, w);
      if (o) return { kind: 'offer', o, strip: 'acts' };
      const bt = buttonsOf(L, H).find((b) => x >= b.x0 && x < b.x1 && py >= b.y0 && py < b.y1);
      if (bt) return { kind: 'button', b: bt, shot: bt.shot };
      const card = cutawayAt(L, x, py);
      if (card >= 0) return { kind: 'body', strip: 'shots', card, shot: card };
      const p = proposalAt(L, x, py, sh + 1);
      if (p) return { kind: 'proposal', p, strip: 'acts' };
      const Ly = lay(H), a = actHit(regionRects(actList, (t) => X(v, w, t), Ly, w), Ly, x, py, w);
      return a ? { ...a, strip: 'acts' } : { kind: 'actEmpty', layer: 0, strip: 'acts' };
    }
    const sd = seedAt(x, py, w, H);   // paw-46du: a seed frame's tab (drawn over the grips and buttons: it answers first)
    if (sd) return { kind: 'seed', m: sd, strip: 'shots', shot: sceneIndexAt(list, sd.t) };
    const r = rowHit({ ...q, buttons: buttonsOf(L, H), offerAt: (px, py) => offerAt(app, px, py, w), proposalAt: (px, py) => proposalAt(L, px, py, sh + 1), cardAt: (px, py) => cutawayAt(L, px, py) });
    if (r.kind === 'body') r.shot = r.card >= 0 ? r.card : sceneIndexAt(list, xToMs(v, w, x));
    if (r.kind === 'body' && r.strip === 'shots' && r.card < 0) {
      const c = chainAt(x, e.offsetY);
      if (c) return { kind: 'chain', i: c.i, strip: 'shots', shot: c.i };
      const lh = loopHit(x, e.offsetY, w, H, sh + 1);
      if (lh) return { ...lh, strip: 'shots', shot: r.shot };
    }
    return r;
  }
  const CURSOR = { seed: 'pointer', handle: 'ew-resize', cut: 'col-resize', offer: 'pointer', button: 'pointer', proposal: 'pointer', body: 'default', actEdge: 'ew-resize', actBody: 'grab', actEmpty: 'crosshair', actMix: 'pointer' };
  const key = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');
  /** The hint line's words for what the pointer is over (paw-ef73.18): what a click and a drag do, with the keys. */
  function hintOf(h) {
    const scenesTab = app.mode === 'scenes', k = (id, words) => (scenesTab ? ` · ${key(id)} ${words}` : '');
    if (h.kind === 'offer') return h.o.text;
    if (h.kind === 'seed') return seedTip(h.m).replace(/\n/g, ' · ');
    if (h.kind === 'handle') return 'Fade handle · drag: adjust the fade, on frames (onto its other end: remove it) · click: select it, Alt+← / → nudge it a frame · right-click the shot: add / remove fades';
    if (h.kind === 'proposal') return 'Proposed off-screen · click: take it (one action across, this shot off-screen in it, bridged) · drag: select a range · right-click: more';
    if (h.kind === 'button') return BUTTON_TIP[h.b.id]?.(h) ?? '';
    if (h.kind === 'cut') {
      const what = boundaryWord(list, h.i);
      return `${what[0].toUpperCase()}${what.slice(1)} · ${shotLabel(list, h.i - 1)} | ${shotLabel(list, h.i)} · drag: move it on frames (Shift: no snapping; the action edges on it move with it) · click: select it`
        + (scenesTab ? `, then ${key('timeline.key.nudgeEarlier')} ${key('timeline.key.nudgeLater')} move it a frame, ${key('timeline.scene.delete')} merges across it` : '') + ' · double-click: merge across it · right-click: change it';
    }
    if (h.kind?.startsWith('act')) return actTip(h).replace(/\n/g, ' · ');
    return `Shot ${shotLabel(list, h.shot)} · click: select (Shift: extend, Ctrl: add / remove, Alt: the shots under its action) · drag: select a range (${key('timeline.select.box')}: box, ${key('timeline.select.circle')}: brush)`
      + k('timeline.key.cut', 'cut at the playhead') + (scenesTab ? ` · ${key('timeline.key.mergePrev')} / ${key('timeline.key.mergeNext')} merge left / right` : '') + k('timeline.shot.cutaway', isCutaway(list[h.shot]) ? 'back into the scene' : 'cutaway');
  }
  const sec = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
  /** Words for the boundary before shot i (tooltip and menus). */
  function boundaryText(i) {
    const s = list[i], kind = boundaryKind(list, i), w = boundaryWord(list, i);
    if (kind === 'move') return `${w[0].toUpperCase()}${w.slice(1)}, at ${sec(s.start_ms)}: the same take goes on, tracked through, no reseed`;
    return `Cut at ${sec(s.start_ms)}: a hard cut between shots ${shotLabel(list, i - 1)} and ${shotLabel(list, i)}, reseeded (the position may have changed)`;
  }
  const hoverText = (t, x, e) => {
    const el = e?.currentTarget ?? e?.target, w = el?.clientWidth ?? 0, hit = el ? hitOf(e, el, x) : null, strip = hit?.strip ?? 'shots';
    if (hit?.kind === 'seed') return seedTip(hit.m);
    const ft = el && hit.kind !== 'cut' ? fadeTip(app, list, w, x, e.offsetY, stripOf(e, el) === 'shots' ? band(el) : null) : null;
    if (ft) return ft;
    if (hit?.kind === 'proposal') hit.prop = hit.p;
    const crop = hit?.prop && tr?.shotLinks?.inserts?.find((x) => x.c === list[hit.prop.c]?.start_ms)?.crop;   // paw-3uyu: c re-frames a
    if (hit?.prop) return `Proposed off-screen: shots ${shotLabel(list, hit.prop.a)}–${shotLabel(list, hit.prop.c)} look like one act${crop ? ` (shot ${shotLabel(list, hit.prop.c)} is the same footage as shot ${shotLabel(list, hit.prop.a)}, crop ×${crop.toFixed(1)})` : ''} with ${hit.prop.b1 > hit.prop.b0 ? 'these shots' : 'this shot'} cut in: the action goes on unseen there · click: one action across, ${hit.prop.b1 > hit.prop.b0 ? 'these shots' : 'this shot'} off-screen in it (bridged)`;
    if (hit?.kind === 'offer') return hit.o.text;
    if (hit?.kind === 'cut') return boundaryText(hit.i);
    if (hit?.kind === 'chain') return chainText(hit.i);
    if (hit?.kind?.startsWith('loop')) return loopTip(hit);
    if (hit?.kind === 'button') return hintOf(hit);
    if (hit?.kind?.startsWith('act')) return actTip(hit);   // paw-2lp7.5
    const i = sceneIndexAt(list, t), s = list[i];
    if (!s) return null;
    const me = el && strip === 'shots' ? midEdgeAt(x, w) : null;
    // paw-qoo5: both ways, with the keys as bound now
    if (me) { const mb = baseAt((list[me.i].start_ms + list[me.i].end_ms) / 2), tk = key('track.gridFrame');
      return `The action changes at ${sec(me.t)} inside shot ${shotLabel(list, me.i)} (tracked as one shot${mb ? `, as ${regionWords(mb)}: the action at its middle` : ''}) · select an action and ${tk ? `press ${tk}` : 'Track'} to track just it, or cut here (${key('timeline.key.cut')})`; }
    const own = [...sceneTags(s).filter((t) => TAG[t].cat === 'view' && t !== 'offscreen').map((t) => (t === 'internal' ? 'internal view' : tagLabel(t))), ...(s.kind === 'still' ? ['still picture'] : []), ...transitionText(s)];
    const cam = sceneCamera(s), u = unconfirmed(i), cm = cutawayMode(list, i);
    const ba = baseAt((s.start_ms + s.end_ms) / 2);
    const cutText = !cm ? '' : ` · ${MARK_WORDS[cm]}${cm === 'carried' && ba ? ` (${regionWords(ba)})` : ''}${cm !== 'intermission' && s.fill === 'timing' ? ' · timing from this shot (tracked for its turn times, the depth from the shots around)' : ''}${fillText(i)}`;
    return `Shot ${shotLabel(list, i)} · ${sec(s.start_ms)}–${sec(s.end_ms)} · camera: ${cam ? tagLabel(cam) : 'not detected'}${own.length ? ' · ' + own.join(' · ') : ''} · ${STATE_WORD[trackState(i)]}` + cutText
      + (u ? ` · ${u} group${u > 1 ? 's' : ''} found again after the cut, not accepted yet (Groups tool: Accept re-found)` : '') + (cm ? '' : contText(i));
  };
  /** The fill line of the hover text for shot i ('' = none). */
  function fillText(i) {
    const f = tr?.fills?.find((x) => x.lo <= i && x.hi >= i);
    return f?.need ? ` · ${fillHint(f)}` : f?.script.length ? ' (plays live; Bake keeps it)' : '';
  }
  /** The cutaway line of the hover text for shot i ('' = none). */
  function contText(i) {
    const c = conts.find((x) => i >= x.b0 && i <= x.b1);
    if (!c || c.internal.includes(i)) return c ? ' · part of the act, tracked (not bridged)' : '';
    const bm = tr?.bridges?.find((b) => b.t0 === view[c.b0].start_ms)?.mode;
    return ` · a cutaway: the act goes on behind it${bm === 'hold' ? ' (held at the level before)' : bm ? ' (bridged with carried strokes)' : ''}`;
  }

  function down(e) {
    if (e.button !== 0 || !list.length) return;
    const el = e.currentTarget, w = el.clientWidth, x = localX(e, el), strip = stripOf(e, el), hit = hitOf(e, el, x);
    if (hit.kind === 'offer') return takeOffer(app, hit.o);
    if (hit.kind === 'button') return pressButton(hit);
    if (hit.kind === 'chain') return followChain(hit.i);
    if (hit.kind === 'seed') { app.player.seek(hit.m.t, { exact: true }); app.usage?.note?.('timeline:seedMark'); return; }   // paw-46du: that exact frame
    if (hit.kind.startsWith('loop')) { loopDown(e, el, hit); return; }
    if (hit.kind.startsWith('act')) { actDown(e, el, hit); return; }   // paw-2lp7.5
    tl.act = null;
    tl.loop = null;   // a press on anything else: the loop selection and the highlight go
    if (tl.match) clearMatch();
    fade = fadeGesture(app, list, w, x, e.offsetY, strip === 'shots' ? band(el) : null);
    if (fade) { el.setPointerCapture(e.pointerId); return; }
    const i = hit.kind === 'cut' ? hit.i : -1;   // a cut moves only from its grip (paw-ef73.18)
    el.setPointerCapture(e.pointerId);
    drag = { i, strip: hit.kind === 'cut' ? hit.strip : hit.kind === 'proposal' ? 'scenes' : hit.strip, x0: x, w, H: el.clientHeight, moved: false, base: list, t0: xToMs(app.view, w, x), result: null, sc: snapContext(app, w),
      mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'sub' : 'replace', sel0: selOf(), prop: hit.kind === 'proposal' ? hit.p : null };
    hot = null;
    if (i > 0) { const own = list[i].start_ms; drag.sc.targets = drag.sc.targets.filter((q) => !(q.label === 'cut' && Math.round(q.t) === own)); }
  }
  function snapT(t, sc, snap) {   // a cut lands on a frame, always (Shift: no targets) -- paw-ef73.14
    if (!snap) return { t: frameStartOf(t, sc.frameMs), hit: null };
    let best = null;
    for (const q of sc.targets) if (Math.abs(q.t - t) <= sc.tol && (!best || Math.abs(q.t - t) < Math.abs(best.t - t))) best = q;
    if (best) return { t: Math.round(best.t), hit: best };
    return { t: frameStartOf(t, sc.frameMs), hit: null };
  }
  /** The selection a range drag over [d.t0, t1) gives (scenes-hit.js boxSelect: from the Scenes strip, whole scenes). */
  const boxSel = (d, t1) => boxSelect(list, d.t0, t1, d.mode, d.sel0, d.strip);
  /** A button on a shot: the cutaway button (the selection when the shot is in it, else that shot), a card's choice. */
  function pressButton(hit) {
    const shots = tl.shots.includes(hit.shot) ? [...tl.shots] : [hit.shot];
    const id = hit.b.id, kind = list[hit.shot]?.tags?.includes('offscreen') ? 'offscreen' : 'cutaway';
    if (id === 'cutaway' || id === 'offscreen') structure.cutaway(app, shots, true, id);
    else if (id === 'convert') structure.cutaway(app, shots, true, kind === 'offscreen' ? 'cutaway' : 'offscreen');
    else if (id === 'timing') structure.timing(app, shots);
    else if (id === 'extend') carryOver(hit.shot);
  }
  /** Hover: what is under the pointer highlights, the cursor says what a drag does, the hint line says it in words. */
  function hover(e, el, x) {
    const h = hitOf(e, el, x);
    fadeCursor(app, list, el.clientWidth, x, e.offsetY, stripOf(e, el) === 'shots' ? band(el) : null);   // the fade under the pointer lights its grips
    hot = h; hotLoop = h.l?.id ?? null;
    cursor = h.kind === 'loopCycle' ? (h.part === 'body' ? 'grab' : 'ew-resize') : h.kind === 'chain' ? 'pointer' : LOOP_CURSOR[h.kind] ?? CURSOR[h.kind] ?? 'default';
    tl.hint = { lane: 'scenes', text: h.kind === 'chain' ? chainText(h.i) : h.kind.startsWith('loop') ? loopHint(h) : hintOf(h) };
  }
  function move(e) {
    const el = e.currentTarget, x = localX(e, el);
    if (loopDrag) return loopMove(e, el);
    if (actDrag) return actMove(e, el);
    if (fade) return fade.move(x);
    if (!drag) return hover(e, el, x);
    if (!drag.moved && Math.abs(x - drag.x0) < CLICK_PX) return;   // nothing moves on a press that travels under 3 px
    drag.moved = true;
    const t = xToMs(app.view, drag.w, x);
    if (drag.i < 1) { box = { t0: drag.t0, t1: t }; setSel(boxSel(drag, t)); return; }   // a box select, live
    const s = snapT(t, drag.sc, !e.shiftKey);
    const r = moveCut(drag.base, drag.i, s.t, Math.max(1, Math.round(app.player.frameMs || 1)));
    drag.result = r; drag.preview = null;
    tl.snap = s.hit ? { t: s.hit.t, label: s.hit.label } : null;
    if (r) setDraft('scenes', r);
  }
  function up(e) {
    if (loopDrag) { loopUp(e, e.currentTarget); return; }
    if (actDrag) { actUp(); return; }
    if (fade) { fade.end(); fade = null; return; }
    const d = drag; drag = null;
    if (!d) return;
    clearDraft('scenes'); tl.snap = null;
    if (d.prop && !d.moved) { acceptProposal(d.prop); return; }
    if (box) { const b = box; box = null; applySel(app, boxSel(d, b.t1), d.strip === 'scenes' ? 'box-scenes' : 'box', { seek: false }); return; }
    if (d.i > 0 && !d.moved) { tl.cut = list[d.i].start_ms; return; }   // a click on a grip selects the cut
    if (d.moved) {
      if (d.result && d.result !== d.base) {
        app.transact('Move cut', () => setScenes(app, d.result, { cuts: true }));   // paw-2lp7.5: the action edges on it move with it
        tl.cut = (d.preview ?? d.result[d.i])?.start_ms ?? null;   // the moved cut stays selected (, . nudge it)
        app.usage?.note?.('scenes:moveBoundary', { strip: d.strip, kind: boundaryKind(d.base, d.i) });
      }
      return;
    }
    const i = sceneIndexAt(list, d.t0);
    if (i < 0) return;
    tl.cut = null;
    // the Shots strip: click = the shot; Shift = the run from the active one; Ctrl = in / out; Alt = the shots under its action
    if (e?.altKey) return selectUnder(i);
    if (e?.shiftKey) return applySel(app, selExtend(list, selOf(), i), 'shift', { seek: false });
    if (e?.ctrlKey || e?.metaKey) return applySel(app, selToggle(list, selOf(), i), 'ctrl', { seek: false });
    applySel(app, selShot(i), 'click');
  }
  /** paw-2lp7.5: the shots under the main-line action over shot i (Alt+click, double-click a shot), else that shot. */
  function selectUnder(i) {
    const r = baseAt((list[i].start_ms + list[i].end_ms) / 2), sh = r ? shotsUnder(app, r) : [i];
    applySel(app, { active: i, shots: sh.length ? sh : [i] }, 'region');
  }
  /** paw-2lp7.4: the action next to marked shot i drawn across it (regions.js carryAcross), one undo step. */
  function carryOver(i) {
    const r = carryAcross(app.doc.acts, list, i);
    if (!r) return;
    noteUsage(app, 'scenes:carryAcross');
    app.transact('Carry the action across', () => { app.doc.acts = r; });
  }
  /** The card buttons' hover words (paw-2lp7.4). */
  const BUTTON_TIP = {
    cutaway: (h) => `Click: shot ${shotLabel(list, h.shot)} a cutaway (${key('timeline.shot.cutaway')}): something that is not the action; not tracked, carried only under an action region`,
    offscreen: (h) => `Click: shot ${shotLabel(list, h.shot)} off-screen (${key('timeline.shot.offscreen')}): the action goes on unseen; not tracked, bridged from the shots around it`,
    convert: (h) => (list[h.shot]?.tags?.includes('offscreen') ? 'Click: make it a cutaway (something that is not the action: carried only under an action region)' : 'Click: make it off-screen (the action goes on unseen: always bridged)'),
    timing: (h) => (list[h.shot]?.fill === 'timing' ? 'Timing from this shot is on: tracked for its turn times, the depth from the shots around. Click: carried from the shots around again' : 'Click: the bridge takes its turn times from this shot\'s own tracked motion (a penis flapping keeps the beat), the depth from the shots around'),
    extend: () => 'Click: draw the action next to it across this shot (one action region over it): the action continues here, bridged. One undo step',
  };
  /** paw-ef73.11: the Scenes row's right-click is scenes-menu.js (one short menu for what was clicked); this finds what
   *  that is and hands it the actions. */
  const keyOf = (id) => app.commands.keysFor?.(id)?.[0] || undefined;
  const openMenu = (e, m, act) => showContextMenu(e, scenesRowMenu({ tab: app.mode, keys: keyOf, ...m }, act), { source: e.currentTarget });
  /** Right-click on a boundary: what it is and how to change it. */
  function boundaryMenu(e, b) {
    const kind = boundaryKind(list, b), commit = (label, r, usage) => { if (!r) return; app.transact(label, () => setScenes(app, r, { cuts: true })); app.usage?.note?.('scenes:boundary', { to: usage }); };
    const k2 = kind === 'move' ? 'move' : 'cut';   // paw-2lp7.5: a scene boundary is a cut like any other
    openMenu(e, { target: k2, title: k2 === 'move' ? 'Camera move' : 'Cut', can: { merge: true } }, {
      take: () => (kind === 'scene' ? structure.take(app, b, true) : commit(kind === 'move' ? 'Boundary: cut' : 'Boundary: camera move', setTake(list, b, kind !== 'move'), kind === 'move' ? 'cut' : 'move')),
      merge: () => structure.removeCut(app, b),
    });
  }
  function menu(e) {
    e.preventDefault();
    const el = e.currentTarget, w = el.clientWidth, x = localX(e, el), hit = hitOf(e, el, x), strip = hit.strip ?? stripOf(e, el), t = xToMs(app.view, w, x);
    if (hit.kind === 'offer') return dropOffer(app, hit.o);
    if (hit.kind === 'cut') return boundaryMenu(e, hit.i);
    if (hit.kind === 'seed') return seedMenu(e, hit.m);
    if (hit.kind.startsWith('loop')) return loopMenu(e, hit);
    if (hit.kind.startsWith('act')) return actMenu(e, hit, t);   // paw-2lp7.5
    const i = sceneIndexAt(list, t);
    if (i < 0) return;
    const s = list[i], fr = Math.max(1, Math.round(app.player.frameMs || 1)), at = frameStartOf(t, gridOf(app.player)), [slo, shi] = sceneRange(list, i);   // structure at the click: its frame's start
    const commit = (label, r) => r && app.transact(label, () => setScenes(app, r));
    // a right-click on a selected shot keeps the selection (its edits act on it); elsewhere it selects that shot (the Scenes strip: its
    // scene). A shot of a scene selected whole is that shot again (its menu, not the scene's).
    // On the Scenes strip the selection is kept only when it holds the whole scene.
    const wholeSel = Array.from({ length: shi - slo + 1 }, (_, k) => slo + k).every((k) => tl.shots.includes(k));
    const keep = sceneSelected(i) && (strip === 'scenes' ? wholeSel : !(wholeSel && shi > slo && tl.shots.length === shi - slo + 1));
    if (!keep) applySel(app, strip === 'scenes' ? selScene(list, i) : selShot(i), 'menu', { seek: false });
    const shots = [...tl.shots], multi = shots.length > 1, lo = sceneRange(list, shots[0])[0], hi = sceneRange(list, shots[shots.length - 1])[1];
    const nScenes = sceneNo(list, hi) - sceneNo(list, lo) + 1;
    const prop = conts.find((x) => view[x.c].continues === 'auto' && i >= x.a && i <= x.c);
    const fx0 = multi ? { in: true, out: true } : fadesOfShot(app, list, i);   // (a selection of shots: no fade items)
    const allCut = shots.every((k) => isCutaway(list[k])), kinds = shots.map((k) => (list[k]?.tags?.includes('offscreen') ? 'offscreen' : list[k]?.tags?.includes('cutaway') ? 'cutaway' : ''));
    // what was clicked: one whole scene (its block, or all its shots selected), several shots, one cutaway, one shot
    const target = multi ? 'multi' : allCut ? 'cutaway' : 'shot';   // paw-2lp7.5: no scene target (the Actions strip has its own menu)
    const bake = shots.some((k) => tr?.bakeState?.(k).state === 'live');   // paw-x7w7: a live shot (its run, fill, bridge or hold plays): Bake makes it permanent
    const n = sceneNo(list, i) + 1, many = shi > slo, sl = shotLabel(list, i);
    const title = target === 'multi' ? selText(list, shots) : `${target === 'cutaway' ? 'Cutaway' : 'Shot'} ${sl}`;
    openMenu(e, {
      target, title, n: shots.length, scenes: nScenes, accept: bake ? { label: 'Bake', tip: 'Make the live points here permanent' } : null,
      cutaway: { kind: kinds.every((m) => m === kinds[0]) ? kinds[0] : '', timing: allCut && shots.every((k) => list[k].fill === 'timing'), extend: !multi && allCut && !!carryAcross(app.doc.acts, list, i) },
      // an event kind: the scene controls' toggle over the scenes just selected (paw-8b4h); Reshape / Climax over their hull
      fx: modItems(app.mode, (k) => (FX_KINDS[k].point ? spurtAtPlayhead(app, at) : FX_KINDS[k].event ? app.commands.run(`timeline.mod.toggle.${k}`) : addModifier(app, k, { t0: list[lo].start_ms, t1: list[hi].end_ms }))),
      can: {
        select: !!baseAt((s.start_ms + s.end_ms) / 2), zoom: true, cut: !!splitShot(list, at, fr),
        shotNext: i < list.length - 1, shotPrev: i > 0,
        describe: app.commands.enabled('track.describeScene'), described: !!s.describe, cutaway: true,
        join: multi, mergeShots: multi, oneScene: nScenes >= 3,
        proposal: !!prop,
        fadeIn: !fx0.in, fadeOut: !fx0.out, removeIn: !!fx0.in, removeOut: !!fx0.out,
      },
    }, {
      select: () => selectUnder(i),
      zoom: () => { const a = list[lo].start_ms, z = list[hi].end_ms, pad = (z - a) * 0.03; app.setView({ start: a - pad, span: z - a + 2 * pad }); },
      cut: () => structure.splitShot(app, at),
      shotNext: () => structure.mergeShot(app, i, 1), shotPrev: () => structure.mergeShot(app, i, -1),
      describe: () => app.commands.run('track.describeScene', { index: i }),
      cutaway: () => structure.cutaway(app, shots, undefined, 'cutaway'), offscreen: () => structure.cutaway(app, shots, undefined, 'offscreen'),
      timing: () => structure.timing(app, shots), extend: () => carryOver(i),
      join: () => actCmds.overShots(app, mruOf(app)[0] ?? [], 'Action region'), mergeShots: () => structure.mergeSelected(app, shots),
      oneScene: () => { noteUsage(app, 'timeline:markAction'); commit('One scene with cutaways', oneScene(lo, hi, true)); applySel(app, selScene(scenesOf(app), lo), 'merge', { seek: false }); },
      proposal: () => acceptProposal(prop), accept: () => tr.bake({ shots }),
      fadeIn: () => addFade(app, list, i, 'in'), fadeOut: () => addFade(app, list, i, 'out'),
      removeIn: () => removeFade(app, fx0.in), removeOut: () => removeFade(app, fx0.out),
    });
  }
  function cancel() { loopCancel(); fade?.cancel(); fade = null; drag = null; actDrag = null; box = null; clearDraft('scenes'); clearDraft('acts'); tr?.actsDrag?.(true); tl.snap = null; }
  /** Shots a..z as one scene; off: the inner shots that are not internal / blank become off-screen cutaways. -> list | null */
  function oneScene(a, z, off) {
    let r = off ? markAction(list, a, z, IN) : list;
    if (r && off) r = r.map((q, k) => { if (k !== z) return q; const { continues: _, ...y } = q; return y; });   // eslint-disable-line no-unused-vars
    return r && mergeScenesIn(r, list[a].start_ms, list[z].end_ms);
  }
  /** Take a proposed cutaway (a continuation {a, c}): shots a..c one scene, the shots between cutaways over it. */
  function acceptProposal(p) {
    const r = oneScene(p.a, p.c, true);
    if (!r) return;
    noteUsage(app, 'timeline:acceptProposal');
    app.transact('One scene with cutaways', () => setScenes(app, r));
    applySel(app, selScene(scenesOf(app), p.a), 'merge', { seek: false });
  }
  /** Double-click a boundary: merge across it (a cut or camera move: the two shots; a scene boundary: the two scenes);
   *  anywhere else: the whole scene. */
  function dbl(e) {
    const el = e.currentTarget, x = localX(e, el), hit = hitOf(e, el, x), i = hit.kind === 'cut' ? hit.i : -1;
    if (hit.kind === 'button' || hit.kind === 'offer' || hit.kind === 'handle' || hit.kind === 'chain' || hit.kind === 'seed') return;
    if (hit.l) { tl.loop = hit.l.id; loopPop.id = hit.l.id; return; }   // a loop: its options
    if (hit.r && !hit.r.auto) { tl.act = hit.r.id; tl.actPop = hit.r.id; return; }   // paw-2lp7.5: a region: its tag chips in place
    if (hit.kind?.startsWith('act')) return;
    if (i < 1) { const k = sceneIndexAt(list, xToMs(app.view, el.clientWidth, x)); if (k >= 0) selectUnder(k); return; }
    structure.removeCut(app, i);
  }
</script>

<CanvasLane {app} lane="scenes" label="Actions and shots" tag={null} {paint} {cursor} {hoverText} {select} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} onpointerleave={() => { if (drag || loopDrag || actDrag) return; hot = null; hotLoop = null; near = ''; fadeCursor(app, list, 1, -1e9, 0, null); }} ondblclick={dbl} oncontextmenu={menu}>
  {#snippet children({ w, h })}
    {@const a = popLoop ? Math.max(0, Math.min(w - 2, X(app.view, w, popLoop.t0))) : 0}
    <div class="anchor" tabindex="-1" bind:this={anchorEl} style:left="{a}px" style:top="{split(h) + 1}px" style:width="{popLoop ? Math.max(2, Math.min(w, X(app.view, w, popLoop.t1)) - a) : 0}px" style:height="{Math.max(1, h - split(h) - 1)}px"></div>
    {#if anchorEl}<LoopPopover {app} anchor={anchorEl} />{/if}
    {@const pa = tl.actPop ? actList.find((q) => q.id === tl.actPop) ?? null : null}
    {@const pb = pa ? laneOf(lay(h), pa) : null}
    {@const px0 = pa ? Math.max(0, Math.min(w - 2, X(app.view, w, pa.t0))) : 0}
    <div class="anchor" tabindex="-1" bind:this={actAnchor} style:left="{px0}px" style:top="{pb?.y0 ?? 0}px" style:width="{pa ? Math.max(2, Math.min(w, X(app.view, w, pa.t1)) - px0) : 0}px" style:height="{pb ? Math.max(1, pb.y1 - pb.y0) : 0}px"></div>
    {#if actAnchor}<Popover open={!!pa} anchor={actAnchor} placement="bottom-start" label="Action tags" onclose={() => { tl.actPop = null; }}>{#if pa}<RegionChips {app} id={pa.id} />{/if}</Popover>{/if}
    {#if readout}<div class="readout" class:flip={readout.x > w - 200} style:left="{Math.min(w - 4, readout.x + 8)}px">{readout.text}</div>{/if}
    {#if list.length}
      <button bind:this={qEl} class="legend-q" type="button" aria-label="What the Actions and Shots row shows" aria-haspopup="dialog" aria-expanded={legend} onpointerdown={(e) => e.stopPropagation()} onclick={() => { legend = !legend; if (legend) app.usage?.note?.('scenes:legend'); }}>?</button>
      <Popover bind:open={legend} anchor={qEl} placement="bottom-end" label="Actions and shots legend" title="Actions and shots">
        <div class="legend">
          <p><b>Actions</b> (upper strip): what is happening, not bound to cuts. The <b>main line</b> holds the primary action ("anal penetration"); a secondary one (a handjob over it) is a thin band above, with its mix chip (mix / layer / ignore). Grey blocks: <b>intro</b>, <b>idle</b>, <b>outro</b>, <b>after</b>; dotted: <b>rest</b> (a breather). Hatched, right over the shots: <b>positioning</b>. Dashed and hollow: a <b>proposal</b> (click: accept; right-click: dismiss). Faint dashed: an untagged region. A gap has no action.</p>
          <p>Drag on empty space: a new action (across cuts as you like); drag its edge: resize; its body: move, up or down: another layer (what is there swaps with it); Alt+drag on an action: a new one above it. Double-click or Enter: its tags. With shots selected, N puts the last-used action over them and 1–9 a recent one (the Actions panel lists them).</p>
          <p><b>Shot</b> (lower strip): numbered 1, 2, 3 through the video. A small orange notch on a shot: the action changes inside it (tracked as one shot; select an action and Track to track just it, or cut there to track the parts apart).</p>
          <p class="row"><svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d="M8.5 0H15.5L12 4Z" class="line" /><rect x="11.5" y="0" width="1" height="14" class="line" /></svg><span><b>Cut</b>: a hard cut between shots (notched). The tracker reseeds; the position may have changed.</span></p>
          <p class="row"><svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true">{#each [0, 3, 6, 9, 12] as y (y)}<rect x="11.5" {y} width="1" height="1" class="line" />{/each}</svg><span><b>Camera move</b>: same take (dotted, no notch). Tracked through, not a cut.</span></p>
          <p><b>Off-screen</b> and <b>cutaway</b>: raised cards, never tracked. <b>Off-screen</b> ({key('timeline.shot.offscreen')}): the action goes on unseen (a face, a reaction): <b>bridged</b> from the shots around it. <b>Cutaway</b> ({key('timeline.shot.cutaway')}): a shot of something that is not the action: under an action region it says <b>action continues</b> and is bridged exactly like off-screen; with none over it, it is an <b>intermission</b> (grey dashed edge: nothing carried). Draw an action across a cutaway to carry it; <b>carry ↔</b> on the card does that in one click. <b>timing</b> on the card: the bridge takes its turn times from the shot's own tracked motion. A <b>dashed card</b> is a proposed off-screen shot: click its top to take it.</p>
          <p>Shot fills: <b>inset outline</b> = internal view, <b>black</b> = blank. Bottom line: <b>solid</b> = baked (permanent), <b>dashed</b> = live (it plays its run), <b>green</b> = filled / bridged, <b>dotted grey</b> = generated, none = not tracked yet. <b class="warn">?</b> = groups found again after a cut, not accepted yet.</p>
          <p><b class="seed">▲</b> at the foot of a shot: a <b>seed frame</b>, where parts were painted (Groups) or a run was seeded, there as soon as you paint. Click: go to that frame; {key('timeline.key.prevSeed') || 'Go to previous seed frame'} / {key('timeline.key.nextSeed') || 'next'}: previous / next seed frame, round the video; right-click: more.</p>
          <p><b>Modifiers</b> (the row below): orgasm, knotting, throbbing, idle, insertion and pull-out, free on the timeline (no split needed). Drag on that row to mark one, drag its ends or middle to change it; Shift+O / Shift+K mark orgasm / knotting in at the playhead, the same key again marks it out. Its curve is shaped in Refine. <b>Spurts</b> (U) are the markers inside an orgasm. <b>Idle</b>: nothing happening there: held (over a whole shot, the shot is idle).</p>
          <p>Click a shot (Shift / Ctrl add, Alt: the shots under its action); drag across shots to select a range. A cut moves only from its <b>grip</b> (the pill on its line): drag it, or click it and press , / . to move it a frame; the action edges on it move with it. Double-click a grip to merge the two shots (the actions stay), right-click it to change its kind.</p>
        </div>
      </Popover>
    {/if}
  {/snippet}
</CanvasLane>

<style>
  .anchor { position: absolute; pointer-events: none; outline: none; }
  .readout { position: absolute; top: 2px; pointer-events: none; padding: 1px 6px; background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius);
    font: var(--fs-1) var(--mono); color: var(--tx-hi); white-space: nowrap; box-shadow: var(--shadow-1); line-height: 18px; height: 20px; box-sizing: border-box; z-index: 2; }
  .readout.flip { translate: calc(-100% - 16px) 0; }
  .legend-q { position: absolute; right: 3px; top: 2px; z-index: 3; width: 15px; height: 15px; padding: 0; border-radius: 50%; font: 600 var(--fs-1)/13px var(--font); color: var(--tx-mut);
    background: var(--bg-raised); border: var(--bw) solid var(--line-2); cursor: pointer; }
  .legend-q:hover, .legend-q[aria-expanded='true'] { color: var(--tx-hi); border-color: var(--line-4); }
  .legend { display: grid; gap: var(--space-2); max-width: 26rem; font-size: var(--fs-1); color: var(--tx-val); line-height: var(--lh); }
  .legend p { margin: 0; }
  .legend .row { display: flex; gap: var(--space-3); align-items: center; }
  .legend svg { flex: none; }
  .legend .line { fill: var(--line-4); }
  .legend b { color: var(--tx-hi); font-weight: 500; }
  .legend .warn { color: var(--warn); }
  .legend .seed { color: var(--intent); }
</style>
