<script>
  // The Scenes tab's filmstrip (paw-ef73.7): the row under the Scenes / Shots strips that takes the leftover height there.
  // Each shot shows its first frame at the left and its last at the right (filmstrip.js: halves of a narrow shot), so a cut
  // reads by eye: one shot's last frame beside the next one's first, the same size, each with its frame number in the corner
  // by the cut; its number as the Shot chip says it (2.1) and its camera; a cutaway is a card raised above the strip with its
  // own pictures. Short on height it is the compact labelled strip, no pictures.
  // It is a place to work on shots, not a scrub pad: only the ruler scrubs on a drag; hovering scrubs when lanes.hoverScrub
  // is on (a preview, the selection untouched). paw-ef73.18: a click selects, a drag on a shot selects a range (a band), a
  // cut moves only from its grip (its whole line, paw-ef73.28; the pill in the middle grows near: scenes-hit.js filmGrip); a click on a grip selects
  // the cut (, . nudge it, Delete merges across it). The hovered shot / grip lights, the hint line says it.
  // Frames (paw-3fal): the exact frame by index (player.still: the scrub cache's own decoder, else the hidden <video> at the
  // frame's middle) at the tile's device-pixel height, one decode at a time, only for the tiles on screen, cached here per
  // (frame, height). While one decodes (a cut dragged) a cached neighbour within 2 frames stands in, its own number shown.
  // The strip thumbnails are never used here: their nearest tile can sit on the other side of the cut.
  // paw-rw84: between the two edge tiles of a long shot, fillers (filmstrip.js fills): whole pictures through the shot, each
  // the exact frame at its centre, dimmer and unnumbered, a gap of the lane's background away from the edge tiles; decoded
  // after every edge tile on screen, slower while the video plays.
  import { untrack } from 'svelte';
  import CanvasLane from './CanvasLane.svelte';
  import { X, theme, font, ellipsize, drawHint, drawGrip } from './draw.js';
  import { tl, scenesOf, sceneSelected, setSel, selOf, setScenes, setDraft, clearDraft } from './state.svelte.js';
  import { filmGrip, gripAt, pillOf, NEAR_PX } from './scenes-hit.js';
  import { shownGrips, grippable } from './lod.js';
  import { fmtKeys } from '../../app/keymap.js';
  import { selShot, selExtend, selToggle, selScene, selBox } from './shots.js';
  import { moveCut } from './scenes.js';
  import { applySel, selectedCut } from './commands-scenes.js';
  import { localX, CLICK_PX } from './interact.js';
  import { shotLabel, cutawayMode, sameTake, blockShade, boundaryWord } from './shots.js';
  import { sceneCamera, TAG } from './acts.js';
  import { xToMs, frameStartOf, frameAt, gridOf } from '../../lib/lane.js';
  import { fmtMs } from '../../lib/video.js';
  import { filmCells, shotFrames, stillQueue, FILL_PLAY_MS } from './filmstrip.js';
  const FILL_ALPHA = 0.8;   // paw-rw84: a filler is the shot's inside, the edge tiles are the exact frames at the cuts

  let { app } = $props();
  let box = $state.raw(null), hot = $state.raw(null), near = $state(-1), cursor = $state('default');   // hot: {kind: 'cut', i} | {kind: 'body', shot} under the pointer
  const list = $derived(scenesOf(app));
  const select = { box: (t0, _y0, t1, _y1, mode) => applySel(app, selBox(list, t0, t1, mode, selOf()), 'box', { seek: false }) };   // B / C (lib/selmodal.js)
  const aspect = $derived((app.doc.media?.width || 16) / (app.doc.media?.height || 9));
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // ---- frames: wanted on screen, loaded one after another (filmstrip.js stillQueue: edge tiles first, then the fillers;
  // a pan / zoom drops the stale asks), capped. paw-rw84: the fillers have their own cache (LRU), so they never push an
  // edge tile out; while one decodes, the closest cached frame of the same shot stands in ----
  const MAX = 400, MAX_FILL = 300, frames = new Map(), fills = new Map();   // fills: key -> {n, H, b}
  const still = (n, H) => { const p = app.player; return p.still ? p.still(n, H) : p.getFrame?.((n + 0.5) * (p.frameMs || 1000 / 30), H); };
  let tick = $state(0), retry = 0, asked = '';
  const media = () => app.doc.media?.path || '';
  let forPath = '';
  const drop = (m, k) => { const v = m.get(k); m.delete(k); (v?.b ?? v)?.close?.(); };
  const queue = stillQueue({
    decode: (r) => { asked = media(); return still(r.n, r.H); },
    done: (r, b) => {
      if (asked !== media()) { b?.close?.(); return false; }
      if (!b) return true;
      if (r.fill) { fills.set(r.key, { n: r.n, H: r.H, b }); if (fills.size > MAX_FILL) drop(fills, fills.keys().next().value); }
      else { frames.set(r.key, b); if (frames.size > MAX) drop(frames, frames.keys().next().value); }
      tick++;
    },
    idle: (missed) => { if (missed) { clearTimeout(retry); retry = setTimeout(() => tick++, 600); } },   // superseded by the hover tip: again later
    gapMs: () => (app.player.playing ? FILL_PLAY_MS : 0),
  });
  function want(reqs) {
    if (forPath !== media()) { for (const k of [...frames.keys()]) drop(frames, k); for (const k of [...fills.keys()]) drop(fills, k); forPath = media(); }
    queue.want(reqs.filter((r) => !(r.fill ? fills.has(r.key) || frames.has(r.key) : frames.has(r.key))));
  }
  /** A filler's picture: its exact frame (LRU touch), else the closest cached frame inside its shot as a stand-in, else null. */
  function fillBmp(f, H, key) {
    const hit = fills.get(key);
    if (hit) { fills.delete(key); fills.set(key, hit); return hit.b; }
    if (frames.has(key)) return frames.get(key);
    let best = null, d = Infinity;
    for (const v of fills.values()) if (v.H === H && v.n >= f.lo && v.n <= f.hi && Math.abs(v.n - f.n) < d) { d = Math.abs(v.n - f.n); best = v.b; }
    return best;
  }
  $effect(() => () => clearTimeout(retry));

  function paint(ctx, w, h) {
    tick;
    const T = theme(), v = app.view, sc = list;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    if (!sc.length) { drawHint(ctx, h, 'Detect scenes in the Actions panel: each shot shows its first and last frame here'); return; }
    const p = app.player, cells = filmCells(sc, (t) => X(v, w, t), { w, h, aspect, cut: (i) => !!cutawayMode(sc, i), frameAt: (t) => frameAt(t, gridOf(p)), last: p.last ?? Infinity });
    const reqs = [], freqs = [], shade = blockShade(sc);   // paw-p2p0: one take = one shade across its camera moves
    let tiles = 0, nfill = 0;
    for (const c of cells) {
      const s = sc[c.i], sel = sceneSelected(c.i);
      const a = Math.max(c.x0, -2), b = Math.min(c.x1, w + 2);
      if (c.card) {   // a cutaway: a raised card with a shadow
        ctx.save(); ctx.shadowColor = T.mediaScrim; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        ctx.fillStyle = T.card; ctx.fillRect(a + 1, c.y0, b - a - 2, c.y1 - c.y0); ctx.restore();
        ctx.strokeStyle = T.txHi; ctx.lineWidth = 1; ctx.strokeRect(a + 1.5, c.y0 + 0.5, b - a - 3, c.y1 - c.y0 - 1);
      } else { ctx.fillStyle = shade[c.i] ? T.card : T.raised; ctx.fillRect(a, c.y0, b - a, c.y1 - c.y0); }
      for (const f of c.frames) {   // first / last frame: the exact one, else a cached neighbour while it decodes
        const H = Math.round(f.h * dpr), key = `${f.n}:${H}`;
        let bmp = frames.get(key), shown = f.n;
        if (!bmp) {
          reqs.push({ key, n: f.n, H });
          for (const d of [1, -1, 2, -2]) if ((bmp = frames.get(`${f.n + d}:${H}`))) { shown = f.n + d; break; }
        }
        tiles++;
        if (bmp) { const sw = bmp.width * f.crop; ctx.drawImage(bmp, (bmp.width - sw) / 2, 0, sw, bmp.height, f.x, f.y, f.w, f.h); }
        else { ctx.fillStyle = T.line2; ctx.fillRect(f.x, f.y, f.w, f.h); }
        // its frame number, small, in the bottom corner by the cut
        ctx.font = font(9, true, 600);
        const num = String(shown), nw = ctx.measureText(num).width + 4;
        if (f.w >= nw + 4 && f.h >= 24) {
          const nx = f.side === 'first' ? f.x : f.x + f.w - nw, ny = f.y + f.h - 11;
          ctx.fillStyle = T.mediaScrim; ctx.fillRect(nx, ny, nw, 11);
          ctx.fillStyle = T.onMedia; ctx.fillText(num, nx + 2, ny + 6);
        }
      }
      // paw-rw84: the fillers through the shot, behind a gap of the lane's background at each edge tile, a little dimmer, no number
      if (c.fills.length) {
        ctx.fillStyle = T.bg;
        for (const g of c.gaps) ctx.fillRect(g.x, c.y0, g.w, c.y1 - c.y0);
        ctx.globalAlpha = FILL_ALPHA;
        for (const f of c.fills) {
          const H = Math.round(f.h * dpr), key = `${f.n}:${H}`, bmp = fillBmp(f, H, key);
          if (!fills.has(key) && !frames.has(key)) freqs.push({ key, n: f.n, H, fill: true });
          if (bmp) ctx.drawImage(bmp, f.x, f.y, f.w, f.h);
          else { ctx.fillStyle = T.line2; ctx.fillRect(f.x, f.y, f.w, f.h); }
        }
        ctx.globalAlpha = 1;
      }
      if (sel) { ctx.strokeStyle = T.reality; ctx.lineWidth = 2; ctx.strokeRect(a + 1, c.y0 + 1, Math.max(0, b - a - 2), c.y1 - c.y0 - 2); }
      // the shot's number and camera, on a backing so they read over a picture
      if (b - a >= 18) {
        const cam = sceneCamera(s), lab = [shotLabel(sc, c.i), cam && cam !== 'static' ? TAG[cam]?.label : '', c.card ? 'cutaway' : ''].filter(Boolean).join(' · ');
        ctx.font = font(c.fs, true, 600);
        const txt = ellipsize(ctx, lab, b - a - 8);
        if (txt) {
          const tw = ctx.measureText(txt).width, ly = c.y0 + c.fs / 2 + 3;
          ctx.fillStyle = T.mediaScrim; ctx.fillRect(Math.max(a, 0) + 2, ly - c.fs / 2 - 2, tw + 6, c.fs + 4);
          ctx.fillStyle = sel ? T.txHi : T.onMedia; ctx.fillText(txt, Math.max(a, 0) + 5, ly);
        }
      }
    }
    // the hovered shot: a faint lift and outline
    const hc = hot?.kind === 'body' && !drag ? cells.find((c) => c.i === hot.shot) : null;
    if (hc) { ctx.fillStyle = T.txHi; ctx.globalAlpha = 0.07; ctx.fillRect(hc.x0, hc.y0, hc.x1 - hc.x0, hc.y1 - hc.y0); ctx.globalAlpha = 0.5; ctx.strokeStyle = T.txHi; ctx.lineWidth = 1; ctx.strokeRect(hc.x0 + 0.5, hc.y0 + 0.5, Math.max(0, hc.x1 - hc.x0 - 1), hc.y1 - hc.y0 - 1); ctx.globalAlpha = 1; }
    // boundaries: a scene's start strong, a cut thin; the selected cut in the accent, the one under the pointer bright; each with
    // its grip. paw-p2p0: a camera move is no full line (unless selected / under the pointer): short muted ticks at the top
    // and bottom, its grip the same pill hollow (filled = cut, hollow = move; the same hit area)
    const sel = selectedCut(app), g = filmGrip(h), shown = gripsShown(w, sel);
    for (let i = 1; i < sc.length; i++) {
      const x = X(v, w, sc[i].start_ms);
      if (x < -8 || x > w + 8) continue;
      const on = hot?.kind === 'cut' && hot.i === i, lw = on ? 3 : i === sel || sc[i].join !== true ? 2 : 1, mv = sameTake(sc[i]);
      ctx.fillStyle = i === sel ? T.reality : on ? T.txHi : sc[i].join === true ? T.txMut : T.tx;
      if (!mv || on || i === sel) ctx.fillRect(x - lw / 2, 0, lw, h);   // centred on the cut's time
      else { ctx.fillRect(x - 0.5, 0, 1, 5); ctx.fillRect(x - 0.5, h - 5, 1, 5); }
      if (shown.has(i)) drawGrip(ctx, pillOf(x, g, on || near === i), { hollow: mv, col: i === sel ? T.reality : on ? T.txHi : undefined });
    }
    if (box) {   // a range drag: the band
      const a = X(v, w, Math.min(box.t0, box.t1)), b = X(v, w, Math.max(box.t0, box.t1));
      ctx.fillStyle = T.reality; ctx.globalAlpha = 0.15; ctx.fillRect(a, 0, b - a, h); ctx.globalAlpha = 0.8; ctx.strokeStyle = T.reality; ctx.lineWidth = 1; ctx.strokeRect(a + 0.5, 0.5, Math.max(0, b - a - 1), h - 1); ctx.globalAlpha = 1;
    }
    for (const c of cells) nfill += c.fills.length;
    untrack(() => want([...reqs, ...freqs]));
    // dev instrumentation (dev/filmstrip-cut-check.mjs, dev/gridfilm-check.mjs): idle = every edge tile exact; fillIdle = the fillers too
    globalThis.__pawFilmLog?.({ tiles, missing: reqs.length, idle: !reqs.length, fills: nfill, fillMissing: freqs.length, fillIdle: !reqs.length && !freqs.length,
      geom: { h, edges: cells.flatMap((c) => c.frames.map((f) => [c.i, f.x, f.w, f.n, f.side])), fills: cells.flatMap((c) => c.fills.map((f) => [c.i, f.x, f.w, f.n])), gaps: cells.flatMap((c) => c.gaps.map((g) => [c.i, g.x, g.w])) } });
  }

  // ---- gestures: this row is for working on shots, never a scrub pad (the ruler scrubs). A click selects the shot (the
  // Shots strip's: Shift run / Ctrl toggle / Alt scene, landing on the first clean frame); a drag from a cut's grip moves the
  // cut (on frames), any other drag selects a range of shots. Hover scrubs (lanes.hoverScrub, off by default), selection untouched.
  let drag = null;
  /** paw-tog0 (was: every shot of the video at least 6 px wide, else no grip at all): the cuts in view whose grip is drawn
   *  (lod.js shownGrips: thinned only where grips would touch; the selected, hovered and near one always, so the grip a
   *  press takes is drawn). -> Set(i) */
  function gripsShown(w, sel) {
    const v = app.view, hi = hot?.kind === 'cut' ? hot.i : -1, cuts = [];
    for (let i = 1; i < list.length; i++) {
      const x = X(v, w, list[i].start_ms);
      if (x < -8) continue;
      if (x > w + 8) break;
      cuts.push({ i, x, move: sameTake(list[i]), force: i === sel || i === hi || i === near });
    }
    return shownGrips(cuts);
  }
  /** The cut whose grip is under (x, y), else -1 (scenes-hit.js gripAt). */
  const gripUnder = (x, y, w, h, reach) => { const sel = selectedCut(app); return gripAt(grippable(list.slice(1).map((s, k) => ({ i: k + 1, x: X(app.view, w, s.start_ms), force: k + 1 === sel }))), x, y, filmGrip(h), reach); };
  const shotAt = (t) => list.findIndex((s) => t >= s.start_ms && t < s.end_ms);
  const key = (id) => fmtKeys(app.commands.keysFor?.(id)?.[0] || '');
  function down(e) {
    if (e.button !== 0 || !list.length) return;
    const el = e.currentTarget, w = el.clientWidth, x = localX(e, el);
    el.setPointerCapture(e.pointerId);
    drag = { i: gripUnder(x, e.offsetY, w, el.clientHeight), x0: x, w, moved: false, base: list, t0: xToMs(app.view, w, x), result: null, mode: e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'sub' : 'replace', sel0: selOf() };
  }
  /** Hover: the grip / shot under the pointer lights, the cursor and the hint line say what a click and a drag do. */
  function hover(e, el, x) {
    const i = gripUnder(x, e.offsetY, el.clientWidth, el.clientHeight), k = shotAt(xToMs(app.view, el.clientWidth, x));
    hot = i > 0 ? { kind: 'cut', i } : k >= 0 ? { kind: 'body', shot: k } : null;
    near = gripUnder(x, e.offsetY, el.clientWidth, el.clientHeight, NEAR_PX);   // the pill grows on approach
    cursor = i > 0 ? 'col-resize' : 'default';
    const scn = app.mode === 'scenes';
    const bw = i > 0 ? boundaryWord(list, i) : '';
    tl.hint = { lane: 'filmstrip', text: i > 0 ? `${bw[0].toUpperCase()}${bw.slice(1)} · ${shotLabel(list, i - 1)} | ${shotLabel(list, i)} · drag: move it on frames · click: select it${scn ? `, then ${key('timeline.key.nudgeEarlier')} ${key('timeline.key.nudgeLater')} move it a frame, ${key('timeline.scene.delete')} merges across it` : ''}`
      : k >= 0 ? `Shot ${shotLabel(list, k)} · click: select (Shift: extend, Ctrl: add / remove, Alt: its scene) · drag: select a range · drag a cut's line: move the cut${scn ? ` · ${key('timeline.key.cut')} cut at the playhead · ${key('timeline.key.mergePrev')} / ${key('timeline.key.mergeNext')} merge left / right` : ''}` : '' };
  }
  function move(e) {
    const el = e.currentTarget, x = localX(e, el);
    if (!drag) {
      hover(e, el, x);
      // hoverHold: the Groups tool is open, the picture stays on the frame it paints (paw-iwb7)
      if (app.settings.get('lanes.hoverScrub', false) === true && !e.buttons && !app.player.playing && !app.player.hoverHold && e.pointerType !== 'touch') hoverTo(e);
      return;
    }
    if (!drag.moved && Math.abs(x - drag.x0) < CLICK_PX) return;   // nothing moves on a press that travels under 3 px
    drag.moved = true;
    const t = xToMs(app.view, drag.w, x);
    if (drag.i < 1) { box = { t0: drag.t0, t1: t }; setSel(selBox(list, drag.t0, t, drag.mode, drag.sel0)); return; }
    drag.result = moveCut(drag.base, drag.i, frameStartOf(t, gridOf(app.player)), Math.max(1, Math.round(app.player.frameMs || 1)));
    if (drag.result) setDraft('scenes', drag.result);
  }
  function up(e) {
    const d = drag; drag = null;
    if (!d) return;
    clearDraft('scenes');
    if (box) { const b = box; box = null; applySel(app, selBox(list, d.t0, b.t1, d.mode, d.sel0), 'box', { seek: false }); return; }
    if (d.i > 0 && !d.moved) { tl.cut = list[d.i].start_ms; return; }   // a click on a grip selects the cut
    if (d.moved) { if (d.result && d.result !== d.base) { app.transact('Move cut', () => setScenes(app, d.result)); tl.cut = d.result[d.i].start_ms; } return; }
    const i = shotAt(d.t0);
    if (i < 0) return;
    tl.cut = null;
    if (e?.altKey) return applySel(app, selScene(list, i), 'scene');
    if (e?.shiftKey) return applySel(app, selExtend(list, selOf(), i), 'shift', { seek: false });
    if (e?.ctrlKey || e?.metaKey) return applySel(app, selToggle(list, selOf(), i), 'ctrl', { seek: false });
    applySel(app, selShot(i), 'click');
  }
  function cancel() { drag = null; box = null; clearDraft('scenes'); }
  // hover scrub: the frame under the pointer, smooth
  function hoverTo(e) {
    const c = e.currentTarget, r = c.getBoundingClientRect(), t = Math.max(0, Math.min(app.durationMs, xToMs(app.view, r.width, e.clientX - r.left)));
    if (!Number.isFinite(t)) return;
    const p = app.player, at = e.shiftKey ? p.snap(t) : t;
    p.scrubTime = t; p.scrubPxMs = app.view.span / r.width;
    p.scrub ? p.scrub(at) : p.seek(at, { exact: !e.shiftKey });
  }
  function hoverText(t, x, e) {
    const el = e?.currentTarget ?? e?.target, g = el ? gripUnder(x, e.offsetY, el.clientWidth, el.clientHeight) : -1;
    if (g > 0) { const bw = boundaryWord(list, g); return `${bw[0].toUpperCase()}${bw.slice(1)} · shots ${shotLabel(list, g - 1)} | ${shotLabel(list, g)}`; }   // paw-p2p0
    const i = list.findIndex((s) => t >= s.start_ms && t < s.end_ms);
    if (i < 0) return 'click: select a shot';
    const s = list[i], c = app.player.clock, [nF, nL] = c ? shotFrames(list, i, (t) => c.frameAt(t), app.player.last ?? Infinity) : [];
    return `Shot ${shotLabel(list, i)} · ${fmtMs(s.start_ms)}–${fmtMs(s.end_ms)}${cutawayMode(list, i) ? ` · ${cutawayMode(list, i) === 'offscreen' ? 'off-screen' : 'cutaway'}` : ''}\n${c ? `first frame ${nF} left, last frame ${nL} right` : 'first frame left, last frame right'}`;
  }
</script>

<CanvasLane {app} lane="filmstrip" label="Shots, first and last frames" tag="Shots" {paint} {cursor} {hoverText} {select}
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} onpointerleave={() => { if (!drag) { hot = null; near = -1; } app.player.scrubTime = null; app.player.scrubEnd?.(); }} />
