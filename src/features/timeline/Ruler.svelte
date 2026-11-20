<script>
  // The ruler: adaptive ticks + labels, scene cuts, range band (lower part), loop indicator, and the loops
  // (paw-llaa, owner: "each loop gets a tint, so the entire section with the orange frames is tinted, and there's only the
  // orange"): each loop's span tinted in its colour (loop-marks.js: one colour per footage, the same footage shares it) and
  // one tick per pass at its PREFERRED frame (not its start or end: the frame to paint on, to seed, to show). Drag a tick
  // left / right inside its cycle to pick another frame (all its ticks move together, the video shows the frame, one undo
  // step); click it: go there and highlight where the loop's pictures play; right-click: step through the same frame
  // (Alt+. / Alt+,). Repeated pictures outside the loops are carets (in a loop's colour when they are its pictures): click one
  // to highlight every place they play (Esc or a click elsewhere clears it). With the Groups tool open on a take without
  // groups, its best frame to paint (paw-8mf4) is a marker over the strip: click it to go there.
  // Fades and dissolves (paw-ef73.3, transitions.js) sit in the band: a ramp over each, its full-black frames solid; hover
  // one for its length, its clean frames and where the cut sits in it.
  // Press+drag in the top part scrubs; Shift+drag or a drag in the band makes/edits the range; double-click fits.
  // paw-ef73.18: zoomed in until a frame is at least 6 px wide, each frame is a cell (ticks.js frameCells: alternating
  // shade, a tick at each frame start through the band, its number at a stride that fits); the grey frame cursor's block
  // and number (frame-cursor.js) mark the playhead's cell. Shift+Z zooms to ~12 px frames and back.
  import CanvasLane from './CanvasLane.svelte';
  import { theme, font, X, drawProgress } from './draw.js';
  import { thin } from './lod.js';
  import { boundaryTimes, boundaryWord } from './shots.js';
  import { trackingOf } from './deps.js';
  import { layoutTicks, frameCells } from './ticks.js';
  import { hitRuler, dragRange, markAt, BAND_Y } from './ruler.js';
  import { tl, cutsOf, durOf, edgesToFrames, scenesOf } from './state.svelte.js';
  import { snapContext, localX, CLICK_PX } from './interact.js';
  import { xToMs, gridOf, frameLen, frameStartOf } from '../../lib/lane.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { showContextMenu } from '../../ui/kit/index.js';
  import { REPEAT_Y, REPEAT_HIT } from './repeats.js';
  import { repeatsOf, loadRepeats, repeatsShown } from './repeats.svelte.js';
  import { repeatGroupsMenu, bestPaintMark } from './deps.js';
  import { markAutoLoops } from './repeat-offers.svelte.js';
  import { loopLooks, setLoopPick, caretsOf, showMatch, showLoopMatch, clearMatch, seekSame, setCropLinks } from './loop-look.svelte.js';
  import { pickFromTime, pickTicks, pickTime } from './loop-marks.js';
  import { loopsInWords } from './loop-actions.js';
  import { untrack } from 'svelte';
  import { drawTransitions, transitionAt, transitionText, transitionOfCut, MIN_W } from './transitions.js';
  import { shownTransitions, transitionsShown, bindTransitions } from './transitions.svelte.js';

  let { app } = $props();
  let cursor = $state('default'), width = 1, hot = $state(null), slide = $state.raw(null);   // hot: the loop id under the pointer; slide: {id, pick} while a tick is dragged

  $effect.pre(() => bindTransitions(app));
  // one pass for both: the repeated frames and the fades / dissolves (paw-ef73.3)
  $effect(() => { if (repeatsShown(app) || transitionsShown(app)) loadRepeats(app); });
  $effect(() => { if (repeatsOf(app) && app.doc.media) untrack(() => markAutoLoops(app)); });
  $effect(() => setCropLinks(app, trackingOf(app)?.shotLinks?.links ?? null));   // paw-hvbf: crop-linked shots chain and share loop colours, when they arrive   // paw-ef73.4: the loops the repeats show, marked once per opened document
  $effect(() => { if (app.player.clock?.kind === 'table' && app.doc.media?.path) untrack(() => edgesToFrames(app)); });   // paw-kxz4: stored edges onto the real frames
  const shown = () => repeatsShown(app);
  const light = () => (tl.themeTick, document.documentElement.dataset.theme === 'light');
  const frameMsOf = () => frameLen(gridOf(app.player)) || 1000 / 30;
  /** The loops' looks; a tick slide in progress shows its loop at the frame under the pointer. */
  const looks = () => (shown() ? loopLooks(app, light()) : new Map());
  const ticksOf = (o) => (slide?.id === o.l.id ? pickTicks(o.l, o.g, slide.pick, gridOf(app.player)) : o.ticks);
  /** A pass's width on screen (under 3 px the loop is a tint only). */
  const passPx = (o) => (o.g.P / app.view.span) * width;
  // the readout of the last "same frame" step: shown for 3 s
  let seekNote = $state.raw(null);
  $effect(() => { const s = tl.seek; if (!s) return; seekNote = s; const id = setTimeout(() => { if (seekNote === s) seekNote = null; }, 3000); return () => clearTimeout(id); });
  const famColor = (fam) => { if (!(fam >= 0)) return null; for (const o of looks().values()) if (o.group === fam) return o.color; return null; };

  function paint(ctx, w, h) {
    width = w;
    const T = theme(), view = app.view;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
    const LK = [...looks().values()];
    for (const o of LK) {   // paw-llaa: each loop's span, tinted in its colour (under the labels)
      const a = Math.max(0, X(view, w, o.l.t0)), b = Math.min(w, X(view, w, o.g.end));
      if (b <= a) continue;
      ctx.fillStyle = o.color; ctx.globalAlpha = hot === o.l.id || tl.loop === o.l.id ? 0.3 : 0.2; ctx.fillRect(a, 0, Math.max(1, b - a), BAND_Y);
      ctx.globalAlpha = 0.7; ctx.fillRect(a, BAND_Y - 1, Math.max(1, b - a), 1); ctx.globalAlpha = 1;
    }
    const M = tl.match;
    if (M) {   // where the highlighted pictures play: a band down the whole ruler
      ctx.fillStyle = M.color || T.txHi;
      for (const sp of M.spans || []) { const a = Math.max(0, X(view, w, sp.t0)), b = Math.min(w, X(view, w, sp.t1)); if (b < 0 || a > w) continue; ctx.globalAlpha = 0.22; ctx.fillRect(a, 0, Math.max(2, b - a), h); ctx.globalAlpha = 1; ctx.fillRect(a, h - 3, Math.max(2, b - a), 2); }
    }
    ctx.fillStyle = T.line1; ctx.fillRect(0, h - 1, w, 1);
    const L = layoutTicks(view, w, { mode: tl.timeMode, frameMs: gridOf(app.player), dur: app.durationMs }), FC = frameCells(view, w, gridOf(app.player), undefined, app.durationMs);
    if (FC) {   // frame cells: every other one faintly shaded, a tick at each frame start through the band, the numbers at the stride
      ctx.fillStyle = T.txMut; ctx.globalAlpha = 0.13;
      for (const c of FC.cells) if (c.n % 2) ctx.fillRect(c.x0, 0, c.x1 - c.x0, h - 1);
      ctx.globalAlpha = 0.45;
      for (const c of FC.cells) ctx.fillRect(c.x0 - 0.5, BAND_Y, 1, h - BAND_Y - 1);
      ctx.globalAlpha = 1; ctx.font = font(9, false, 600); ctx.textBaseline = 'alphabetic';
      for (const c of FC.cells) if (c.n % FC.stride === 0) ctx.fillText(String(c.n), c.x0 + 5, h - 3);   // where the frame cursor's number sits (CanvasLane .fnum)
    }
    ctx.fillStyle = T.line2;
    if (!FC) for (const x of L.frames) ctx.fillRect(x, BAND_Y - 3, 1, 3);
    for (const x of L.minor) ctx.fillRect(x, BAND_Y - 6, 1, 6);
    ctx.fillStyle = T.line4;
    for (const m of L.major) ctx.fillRect(m.x, 0, 1, BAND_Y);
    ctx.fillStyle = T.txMut; ctx.font = font(11, true); ctx.textBaseline = 'alphabetic';
    for (const m of L.major) ctx.fillText(m.label, m.x + 5, 14);   // 14 (was 12): the repeat strip sits above the labels

    // range band (lower part) with edge handles
    const r = app.doc.range;
    if (r) {
      const x0 = X(view, w, r.t0), x1 = X(view, w, r.t1);
      if (x1 >= 0 && x0 <= w) {
        // the theme's --reality (as the lanes' range edges), tinted with alpha so any token format works
        ctx.fillStyle = T.reality; ctx.globalAlpha = 0.22;
        ctx.fillRect(Math.max(0, x0), BAND_Y, Math.min(w, x1) - Math.max(0, x0), h - BAND_Y - 1);
        ctx.globalAlpha = 0.9;
        if (x0 >= 0) ctx.fillRect(x0, BAND_Y, 2, h - BAND_Y - 1);
        if (x1 <= w) ctx.fillRect(x1 - 1, BAND_Y, 2, h - BAND_Y - 1);
        ctx.globalAlpha = 1;
      }
    }
    // a running tracker job: a thin sweep along the band (with its words when there is no scenes row content to carry them)
    const tr = trackingOf(app), job = tr?.busyRange;
    if (job) drawProgress(ctx, view, w, { ...job, frac: tr.progressFrac, text: app.doc.scenes?.length ? '' : tr.progressLabel }, T.reality, BAND_Y, h - BAND_Y - 1);
    // loop playback: a bar along the band's top edge with a loop glyph
    const lp = app.player.loop;
    if (lp) {
      const x0 = X(view, w, lp.t0), x1 = X(view, w, lp.t1), a = Math.max(0, x0), b = Math.min(w, x1);
      if (b > a) {
        ctx.fillStyle = T.ok; ctx.fillRect(a, BAND_Y, b - a, 2);
        if (x0 >= 0 && b - a > 18) {
          ctx.strokeStyle = T.ok; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x0 + 9, BAND_Y + 8, 3.2, 0.5, Math.PI * 2 - 1.2); ctx.stroke();
          ctx.fillStyle = T.ok; ctx.beginPath(); ctx.moveTo(x0 + 10.5, BAND_Y + 3.6); ctx.lineTo(x0 + 13, BAND_Y + 6); ctx.lineTo(x0 + 9, BAND_Y + 6.4); ctx.fill();
        }
      }
    }
    // fades and dissolves (paw-ef73.3): the darkness ramp over each, its full-black frames solid; under the cut triangles
    drawTransitions(ctx, view, w, shownTransitions(app), { y0: BAND_Y + 1, h: h - BAND_Y - 3, dur: durOf(app), ink: T.intent, black: T.mediaBg });   // its own hue: never read as a cut triangle
    // cuts: triangles on the bottom edge; paw-p2p0: a camera move (one take) the same triangle hollow, in the muted ink
    // paw-tog0: where triangles would run into each other (a long video zoomed out), cuts keep theirs before camera moves (lod.js thin)
    const B = boundaryTimes(scenesOf(app)), tri = [];
    for (const [ts, move] of [[B.cuts, false], [B.moves, true]]) for (const t of ts) { const x = X(view, w, t); if (x >= -4 && x <= w + 4) tri.push({ x, move, x0: x - 3.5, x1: x + 4.5, pri: move ? 0 : 1 }); }
    const keepTri = thin(tri, 1);
    ctx.fillStyle = T.txVal; ctx.strokeStyle = T.txMut; ctx.lineWidth = 1;
    tri.forEach(({ x, move }, k) => {
      if (!keepTri[k]) return;
      if (!move) { ctx.beginPath(); ctx.moveTo(x - 3.5, h); ctx.lineTo(x + 4.5, h); ctx.lineTo(x + 0.5, h - 5); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(x - 3, h - 0.5); ctx.lineTo(x + 4, h - 0.5); ctx.lineTo(x + 0.5, h - 4.5); ctx.closePath(); ctx.stroke(); }
    });
    // carets: repeated pictures outside the loops, one per run (a loop's colour when they are its pictures), one per 5 px
    if (shown()) {
      let lastX = -9;
      for (const c of caretsOf(app)) {
        const x = X(view, w, c.t) + 0.5;
        if (x < -4) continue;
        if (x > w + 4) break;
        if (x - lastX < 5) continue;
        lastX = x;
        ctx.fillStyle = famColor(c.fam) || T.txVal; ctx.beginPath(); ctx.moveTo(x - 3.5, REPEAT_Y + 6); ctx.lineTo(x, REPEAT_Y); ctx.lineTo(x + 3.5, REPEAT_Y + 6); ctx.fill();
      }
    }
    // each loop's preferred frame, once per pass, in its colour (a 4 px tick above the labels; the hovered / selected loop's
    // stand tall); zoomed out until a pass is under 3 px: the tint alone
    const fw = Math.max(2, (frameMsOf() / view.span) * w);
    for (const o of LK) {
      if (passPx(o) < 3 && slide?.id !== o.l.id) continue;
      const tall = slide?.id === o.l.id || hot === o.l.id || tl.loop === o.l.id;
      ctx.fillStyle = o.color;
      for (const tk of ticksOf(o)) { const x = X(view, w, tk.t); if (x < -fw || x > w) continue; ctx.fillRect(x, REPEAT_Y, Math.min(fw, Math.max(2, passPx(o) - 1)), tall ? BAND_Y - REPEAT_Y - 1 : 4); }
    }
    // the best frame to paint in the Groups tool's take: a marker down to the strip (a plate under it reads on any tick)
    const bp = best();
    if (bp) {
      const x = X(view, w, bp.t) + 0.5;
      if (x > -6 && x < w + 6) {
        ctx.fillStyle = T.bg; ctx.fillRect(x - 5, 0, 10, REPEAT_Y + 6);
        ctx.fillStyle = T.txHi; ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, REPEAT_Y + 5); ctx.fill();
        ctx.fillRect(x - 0.5, REPEAT_Y + 4, 1, BAND_Y - REPEAT_Y - 4);
      }
    }
  }
  const best = () => (bestPaintMark && repeatsShown(app) ? bestPaintMark(app) : null);
  /** The best-frame marker under the pointer (top strip, 6 px either side), or null. */
  const bestUnder = (e, c) => { const bp = best(); return bp && yOf(e, c) < REPEAT_HIT + 2 && Math.abs(localX(e, c) - X(app.view, width, bp.t)) <= 6 ? bp : null; };

  const tApp = (e, c) => xToMs(app.view, width, localX(e, c));
  const yOf = (e, c) => e.clientY - c.getBoundingClientRect().top;
  const ruled = (e, c) => hitRuler({ view: app.view, w: width, x: localX(e, c), y: yOf(e, c), range: app.doc.range, shift: e.shiftKey });
  const CURS = { scrub: 'ew-resize', new: 'crosshair', t0: 'col-resize', t1: 'col-resize', move: 'grab' };

  let drag = null;
  // paw-ef73.14: a scrub is smooth (the playhead rests where the pointer is, the video shows the frame containing it); Shift: on frames
  // paw-o60v.8: paused, a drag shows decoded frames (player.dragTo -> scrub) and the <video> seeks once, on release (scrubEnd)
  const scrubTo = (t, e) => { const c = Math.max(0, Math.min(app.durationMs, t)); app.player.scrubPxMs = app.view.span / width; app.player.scrubTime = c; if (e?.shiftKey) { app.player.scrubTime = null; app.player.dragTo(app.player.snap(c), { snap: true }); } else app.player.dragTo(c); };

  /** The preferred-frame tick under the pointer (top strip, 3 px slack) -> {o (the loop's look), k (its pass), t}, or null. */
  function tickUnder(e, c) {
    if (!shown() || yOf(e, c) >= REPEAT_HIT + 3) return null;
    const x = localX(e, c), fw = Math.max(2, (frameMsOf() / app.view.span) * width);
    let best = null, bd = Infinity;
    for (const o of looks().values()) {
      if (passPx(o) < 3) continue;
      for (const tk of ticksOf(o)) { const xa = X(app.view, width, tk.t), d = x < xa ? xa - x : x > xa + fw ? x - xa - fw : 0; if (d <= 3 && d < bd) { bd = d; best = { o, k: tk.k, t: tk.t }; } }
    }
    return best;
  }
  /** The caret under the pointer -> the run {t, t1, ids, fam}, or null. */
  function caretUnder(e, c) {
    if (!shown() || yOf(e, c) >= REPEAT_HIT + 3) return null;
    const x = localX(e, c);
    let best = null, bd = 5;
    for (const r of caretsOf(app)) { const d = Math.abs(X(app.view, width, r.t) - x); if (d < bd) { bd = d; best = r; } }
    return best;
  }
  /** The loop whose tinted span is under the pointer (upper part), or null. */
  const loopUnder = (e, c) => { if (yOf(e, c) >= BAND_Y) return null; const t = tApp(e, c); for (const o of looks().values()) if (t >= o.l.t0 && t < o.g.end) return o; return null; };
  const key = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');

  function down(e) {
    if (e.button !== 0) return;
    const c = e.currentTarget, bp = bestUnder(e, c);
    if (bp) { app.player.seek(bp.t); return; }   // the best frame to paint: go there
    const tk = tickUnder(e, c);
    if (tk) {   // a loop's tick: a click goes there (and shows where the loop plays); a drag picks the preferred frame
      c.setPointerCapture(e.pointerId);
      drag = { kind: 'slide', x0: localX(e, c), tk, time0: app.player.timeMs, moved: false };
      return;
    }
    const cr = caretUnder(e, c);
    if (cr) { app.player.seek(cr.t); showMatch(app, { ids: cr.ids, color: famColor(cr.fam), text: 'caret' }); return; }
    if (tl.match) clearMatch();   // a click elsewhere: the highlight goes
    const kind = ruled(e, c), t = tApp(e, c);
    c.setPointerCapture(e.pointerId);
    drag = { kind, x0: localX(e, c), t0: t, range0: app.doc.range, time0: app.player.timeMs, moved: false };
    if (kind === 'scrub') scrubTo(t, e);
  }
  /** A tick slid to pointer x: the frame of its pass under the pointer, inside the cycle (all the loop's ticks follow); the
   *  video shows that frame. */
  function slideTo(x) {
    const { o, k } = drag.tk, grid = gridOf(app.player), pick = pickFromTime(o.l, o.g, k, xToMs(app.view, width, x), grid), t = pickTime(o.l, o.g, k, pick, grid);
    slide = { id: o.l.id, pick };
    if (app.player.timeMs !== t) app.player.seek(t);
  }
  function move(e) {
    const c = e.currentTarget;
    if (!drag) {
      if (bestUnder(e, c)) { hot = null; cursor = 'pointer'; return; }
      const tk = tickUnder(e, c), cr = tk ? null : caretUnder(e, c), lo = tk?.o ?? loopUnder(e, c), k = ruled(e, c);
      hot = lo?.l.id ?? null; cursor = tk ? 'ew-resize' : cr ? 'pointer' : CURS[k];
      const same = `right-click: step through the same frame (${key('loops.nextSame')} / ${key('loops.prevSame')})`;
      tl.hint = { lane: 'ruler', text: tk ? `Preferred frame of the loop · drag: pick another frame of its cycle (every pass follows) · click: go there and show where it plays · ${same}`
        : cr ? 'Caret: these pictures play elsewhere too · click: show every place they play (Esc clears)'
        : `Time ruler · ${k === 'scrub' ? 'drag: scrub (Shift: on frames)' : 'drag: make / change the range'} · click: go there · double-click: fit · ${key('timeline.zoom.frames')}: zoom to frames (each frame a numbered cell) and back${lo ? ` · ${same}` : ''}` };
      return;
    }
    const x = localX(e, c), t = xToMs(app.view, width, x);
    if (drag.kind === 'slide') { if (drag.moved || Math.abs(x - drag.x0) >= CLICK_PX) { drag.moved = true; slideTo(x); } return; }
    if (drag.kind === 'scrub') { scrubTo(t, e); return; }
    if (!drag.moved && Math.abs(x - drag.x0) < CLICK_PX) return;
    drag.moved = true;
    const sc = e.altKey ? { targets: [], tol: 0, frameMs: gridOf(app.player) } : snapContext(app, width);
    const r = dragRange(drag.kind, drag.range0, drag.t0, t, sc, durOf(app));
    app.doc.range = r.range.t1 - r.range.t0 >= (app.player.frameMs || 1) ? r.range : null;
    tl.snap = r.snap ? { t: r.snap.t, label: r.snap.label } : null;
  }
  function up() {
    if (!drag) return;
    if (drag.kind === 'slide') {   // a slide: the picked frame, one undo step; a click: go there, show where the loop plays
      const { o, t } = drag.tk;
      if (drag.moved && slide) setLoopPick(app, o.l.id, slide.pick);
      else { app.player.seek(t); showLoopMatch(app, o.l.id); }
      drag = null; slide = null;
      return;
    }
    if (!drag.moved && drag.kind !== 'scrub') scrubTo(drag.t0);   // plain click in the band: just seek
    drag = null; tl.snap = null; app.player.scrubEnd?.(); app.player.scrubTime = null; app.player.settle?.();
  }
  // pointercancel / Esc: back to the state before the press (range and playhead; a slide keeps the preferred frame it had)
  function cancel() {
    if (!drag) return;
    if (drag.kind === 'slide') { app.player.seek(drag.time0); drag = null; slide = null; return; }
    app.doc.range = drag.range0;
    if (drag.kind === 'scrub') app.player.seek(drag.time0);
    drag = null; tl.snap = null; app.player.scrubTime = null;
  }

  // right-click a tick, a caret or a loop's span: step through the same frame (every place its picture plays, across
  // shots), show where it plays, and the Groups actions for its picture (copy the groups to its repeats, use a twin's groups)
  function menu(e) {
    const c = e.currentTarget, tk = tickUnder(e, c), cr = tk ? null : caretUnder(e, c), lo = tk || cr ? null : loopUnder(e, c);
    if (!tk && !cr && !lo) return;
    e.preventDefault();
    const t = tk ? tk.t : cr ? cr.t : frameStartOf(tApp(e, c), gridOf(app.player));
    const items = repeatGroupsMenu ? repeatGroupsMenu(app, t) : [];
    const id = (tk?.o ?? lo)?.l.id;
    showContextMenu(e, [
      { label: 'Go to this frame', run: () => app.player.seek(t) },
      { label: 'Next same frame', shortcut: app.commands.keysFor?.('loops.nextSame')?.[0], run: () => seekSame(app, 1, t) },
      { label: 'Previous same frame', shortcut: app.commands.keysFor?.('loops.prevSame')?.[0], run: () => seekSame(app, -1, t) },
      { label: 'Show where it plays', run: () => (cr ? showMatch(app, { ids: cr.ids, color: famColor(cr.fam), text: 'caret' }) : showLoopMatch(app, id)) },
      ...(items.length ? [{ separator: true }, ...items] : []),
    ], { source: c });
  }

  const hoverText = (t, _x, e) => {
    const bp = e && bestUnder(e, e.currentTarget);
    if (bp) return `Best frame to paint in this take: repeats ${bp.repeats}×${bp.covers ? `, fills ${bp.covers} other take${bp.covers === 1 ? '' : 's'}` : ''}${bp.loop ? ' · your loop frame' : ''} · click: go there`;
    const tk = e && tickUnder(e, e.currentTarget);
    if (tk) { const o = tk.o, p = slide?.id === o.l.id ? slide.pick : o.pick; return `Loop ${loopsInWords(app).get(o.l.id)?.short ?? ''} · preferred frame ${p + 1} of ${o.g.frames}, pass ${tk.k + 1} of ${o.g.n} · drag: pick another frame · right-click: step through the same frame`; }
    const cr = e && caretUnder(e, e.currentTarget);
    if (cr) { const n = cr.ids.length; return `${n} picture${n === 1 ? '' : 's'} that also play${n === 1 ? 's' : ''} elsewhere${cr.fam >= 0 && famColor(cr.fam) ? ' (the loop of this color)' : ''} · click: show every place`; }
    const lo = e && loopUnder(e, e.currentTarget);
    if (lo) return loopsInWords(app).get(lo.l.id)?.long ?? null;
    const fx = e && yOf(e, e.currentTarget) >= BAND_Y ? fadeUnder(t) : null;
    const L = scenesOf(app), cuts = L.slice(1).map((s, k) => ({ t: s.start_ms, text: boundaryWord(L, k + 1) }));   // paw-p2p0: cut vs camera move
    return fx ? fadeText(fx) : markAt(t, (6 * app.view.span) / width, cuts);
  };
  /** The fade / dissolve under time t in the band (a thin one keeps MIN_W px to aim at). */
  const fadeUnder = (t) => transitionAt(shownTransitions(app), t, (MIN_W / 2) * (app.view.span / width), durOf(app));
  const fadeText = (x) => {
    const fm = app.player.frameMs || 1000 / 30, dur = durOf(app);
    return transitionText(x, { frameMs: fm, dur, cut: cutsOf(app).find((c) => transitionOfCut([x], c, fm, dur)) ?? null });
  };
</script>

<CanvasLane {app} lane="ruler" {paint} {cursor} {hoverText} onpointerdown={down} onpointermove={move} onpointerup={up}
  onpointercancel={cancel} oncontextmenu={menu} ondblclick={() => app.setView({ start: 0, span: Math.max(1, app.durationMs) })}>
  {#snippet children({ w })}
    {#if seekNote}
      {@const x = X(app.view, w, seekNote.t)}
      {#if x >= 0 && x <= w}<div class="seek" class:flip={x > w - 260} style:left="{x + 8}px">{seekNote.text}</div>{/if}
    {/if}
  {/snippet}
</CanvasLane>

<style>
  /* paw-llaa: where the last "same frame" step landed ("3 of 29 in shot 21.1 · +12 in 1 other shot"), for a few seconds */
  .seek { position: absolute; top: 1px; pointer-events: none; padding: 0 6px; background: var(--bg-card); border: 1px solid var(--line-3); border-radius: var(--radius);
    font: var(--fs-1) var(--mono); color: var(--tx-hi); white-space: nowrap; box-shadow: var(--shadow-1); line-height: 16px; z-index: 2; }
  .seek.flip { translate: calc(-100% - 16px) 0; }
</style>
