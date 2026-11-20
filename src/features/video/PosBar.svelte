<!--
  PosBar: the position bar over the video (paw-rtby; geometry in posbar.js). A plug-in overlay (overlay.js), so it is
  there in every tab; on / off = app.player.ui.posBar (the playback bar's ruler button, commands video.posBar /
  video.posBarReset). It shows where the machine is: the machine preview's value (lib/follow.svelte.js: the script with its
  live runs, paw-x7w7, or in the Track tab the live trace of a track in progress, after the device planner when the preview
  follows it), a marker on a track from the deep end (0) to the out end (100) with a faint fill from the deep end; "tracking"
  beside it (marker and fill in the warn ink) while it follows a track in progress.
  Drawn on its own canvas over the stage (fixed inside the stage's containment) through the overlay layer's env.map,
  captured by a drawer that paints nothing, so it stays glued under zoom / pan / rotation / flips. One draw per frame on
  screen (app.player.shownMs: playing, each presented frame, paw-osat; paused, a seek once shown and every decoded frame of a
  scrub, paw-o60v.8.1: never the pointer's time ahead of the picture) and per data change.
  Pointer: one rotated hit strip over the bar; drag the body = move, drag an end = scale and turn (Shift fine, Esc
  cancels, the release saves to settings 'video.posbar:<path>'). Over the bar the bar wins against the passive click
  tools (the Track tab's pick tool 'tracking.roi', the pair pick before its first click: its strip sits over their canvas, overlay.js
  order); display only while a tool where every pixel matters owns the pointer (the Groups brush, the stroke axis, a
  pair pick half done, any other tool). A gesture already in progress has the pointer captured, so it never lands here.
  paw-4c48.8, ON THE SHAFT (the magnet button beside the ruler, command video.posBarShaft; settings
  'video.posbar.shaft:<path>', posbar.js lookOf): where the shot's run reads a shaft (lib/shaft.js railContext: confident on
  RAIL_MIN of it), the bar lies along it every frame (railAt, time-interpolated): pos 0 at the hilt (the base, or the owner's
  "hilted" mark), pos 100 at the tip (the full length, or the "fully out" mark), so the marker shows where the partner's
  entry should be, and a hollow diamond shows where the shaft MEASURES its entry (the reading behind "in N %"): on top of
  each other = the script agrees with the picture. A held / unsure frame keeps the last good placement, drawn faint; a shot
  without a shaft keeps the hand-placed bar (the button's tooltip says why). It never takes the pointer over the video: only
  its small handles (both ends: trim; the chips beside the tip end: move along / across, width, opacity, colour, labels,
  flip this shot) take it, and only while the bar is hovered and no tool owns the pointer; nothing takes focus.
-->
<script>
  import { untrack } from 'svelte';
  import { cssVar, hexToRgb } from '../../ui/kit/color.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import { followOf } from '../../lib/follow.svelte.js';
  import { followAt } from '../../lib/follow.js';
  import { railAt } from '../../lib/shaft.js';
  import { peekTracking } from '../tracking/tracking.svelte.js';
  import { barOf, barKey, barHit, barDrag, machinePos, END_PX, MIN_PX, lookOf, lookKey, shaftBar, posOn, onTrimmed, lookDrag, holdRail, LOOK_COLORS, WIDTH, OPACITY } from './posbar.js';

  let { app } = $props();
  const p = $derived(app.player);
  const on = $derived(!!p.ui.posBar);
  const key = $derived(barKey(app.doc.media?.path));
  const stored = $derived((app.settings.values, barOf(key ? app.settings.get(key, null) : null)));
  const lkey = $derived(lookKey(app.doc.media?.path));
  let draft = $state(null), hover = $state(''), themeTick = $state(0), lookDraft = $state(null), near = $state(false), chipHover = $state(false);
  const look = $derived(lookDraft || (app.settings.values, lookOf(lkey ? app.settings.get(lkey, null) : null)));
  const shaftOn = $derived(on && look.on);
  const bar = $derived(draft || stored);
  const axis = $derived(app.doc.activeAxis);
  const fol = $derived(on ? followOf(app, axis) : null);
  const dp = $derived(app.devicePreview);
  const plan = $derived(dp?.on && dp.ghost?.samples?.pos?.length && (dp.ghost.axis == null || dp.ghost.axis === axis) ? dp.ghost.samples : null);
  // the tools the bar steps aside for: all but the passive click tools (the Track tab's picks; pair pick until its first click)
  const passive = $derived.by(() => {
    const id = p.overlays.activeTool?.id;
    if (!id || id === 'tracking.roi') return false;
    return id === 'tracking.pair' ? !!peekTracking(app)?.pairPick?.first : true;
  });

  let cv = $state(), hit = $state(), env = null, geo = null, raf = 0, C = null, lastStyle = '', lastPos = '', lastSrc = '', lastM = '', lastMode = '';
  let held = null;   // the last good shaft bar {b, shot}: kept through a held / unsure stretch
  let ui = $state(null);   // shaft mode: the ends and the chips' place (stage px), for the handles
  const out = { pos: NaN, speed: 0, dir: 0 };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  const aspect = () => { const m = app.doc.media; return m?.width && m?.height ? m.width / m.height : 16 / 9; };

  // the overlay layer's mapping, refreshed on every repaint of the shared canvas (view, size, time, data)
  $effect(() => {
    if (!on) return;
    const layer = p.overlays;
    const off = untrack(() => layer.add({ id: 'video.posbar', order: 1000, draw: (_, e) => { env = { map: e.map, unmap: e.unmap, w: e.w, h: e.h, dpr: e.dpr }; kick(); } }));
    return () => { off(); env = geo = null; lastStyle = lastPos = lastSrc = lastM = lastMode = ''; held = null; };
  });
  $effect(() => onThemeChange(() => themeTick++));
  $effect(() => {
    themeTick;
    if (!cv) return;
    const v = (n, f) => cssVar(n, cv) || f;
    // paw-p8o2: over the raw picture, so white and black inks: the media tokens (the same in every theme), with alpha
    const ink = (n) => { try { return hexToRgb(v(n, '')).join(','); } catch { return null; } };
    C = { mark: v('--accent'), unap: v('--warn-ink'), axis: v('--series-orange'), font: v('--font', 'sans-serif'), on: ink('--on-media') ?? '255,255,255', dark: ink('--media-bg') ?? '0,0,0' };
    kick();
  });
  // one draw per change: playing, per presented frame (timeMs, set in the video frame callback: this frame's draw is the one the picture goes out with)
  $effect(() => {
    if (!on || !cv) return;
    bar; fol; plan; passive; look; near; chipHover;
    p.shownMs;   // paw-o60v.8.1: the frame on screen, in every state (playing: per presented frame, paw-osat)
    kick();
  });
  $effect(() => () => { cancelAnimationFrame(raf); raf = 0; });

  /** Shaft mode at t: {b (the bar), meas (measured entry pos), faint, shot, RL (untrimmed rail, square units), w (frame heights)}
   *  | {why} (the hand-placed bar shows). */
  function shaftAt(t) {
    const R = peekTracking(app)?.railFor?.(t);
    if (!R?.ctx?.G) { held = null; return { why: R?.ctx?.why || R?.why || 'no shaft read in this shot' }; }
    const A = aspect(), r = railAt(R.ctx, t, A), flipped = look.flips.includes(R.shot);
    const s = r ? shaftBar(r, look, flipped, A) : null, H = holdRail(held, s, !r || r.held, R.shot);
    if (H.prev !== held && H.prev) H.prev.RL = Math.hypot((r.O[0] - r.D[0]) * A, r.O[1] - r.D[1]);
    held = H.prev;
    if (!H.bar) return { why: 'no shaft read here yet' };
    return { b: H.bar, meas: H.faint ? NaN : posOn(H.bar, H.bar.entry, A), faint: H.faint || r.low, shot: R.shot, RL: held.RL, w: H.bar.w, flipped };
  }

  function frame() {
    raf = 0;
    const pl = app.player;
    if (!on || !cv || !env || !C || !fol) return;
    const t = pl.shownMs;
    const { w, h, dpr, map } = env, W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const at = followAt(fol.spans, t);
    machinePos(out, fol.script, at?.kind === 'live' ? null : plan, t);   // the planner leaves the live trace out
    const sh = shaftOn ? shaftAt(t) : null, b = sh?.b || bar;
    const D = map(b.x0, b.y0), O = map(b.x1, b.y1);
    geo = { D, O, shaft: !!sh?.b, RL: sh?.RL, shot: sh?.shot };
    let style = null;
    if (sh?.b) {
      const q = map(b.x0, b.y0 + (sh.w || 0)), auto = Math.max(4, Math.min(WIDTH[1], 0.6 * Math.hypot(q[0] - D[0], q[1] - D[1])));
      const M = Number.isFinite(sh.meas) ? (() => { const f = Math.max(0, Math.min(100, sh.meas)) / 100; return [D[0] + (O[0] - D[0]) * f, D[1] + (O[1] - D[1]) * f]; })() : null;
      style = { width: look.width || auto, alpha: look.opacity * (sh.faint ? 0.45 : 1), faint: sh.faint, color: look.color === 'white' ? `rgba(${C.on}, 1)` : look.color === 'warn' ? C.unap : C.axis, labels: look.labels, M };
    }
    const onBar = sh?.b && Number.isFinite(out.pos) ? onTrimmed(out.pos, look) : out.pos;   // paw-4c48.10: through the same trim as the diamond
    paint(ctx, D, O, onBar, at, style);
    place(D, O, !!sh?.b);
    // the handles' place: written only while they show (or to show them), so playing does not re-lay out anything else
    if (sh?.b && !passive) { if (!ui || near || chipHover || sdrag) { const L = Math.hypot(O[0] - D[0], O[1] - D[1]) || 1; ui = { D, O, shot: sh.shot, chip: [O[0] + ((O[0] - D[0]) / L) * 30, O[1] + ((O[1] - D[1]) / L) * 30] }; } } else if (ui) ui = null;
    const ps = Number.isFinite(out.pos) ? out.pos.toFixed(1) : '', src = at ? at.kind : 'script', ms = sh?.b && Number.isFinite(sh.meas) ? sh.meas.toFixed(1) : '', mode = sh?.b ? (sh.faint ? 'shaft-faint' : 'shaft') : shaftOn ? 'hand:' + sh.why : 'hand';
    if (ps !== lastPos) { lastPos = ps; cv.dataset.pos = ps; }   // what is painted, for checks
    const ob = sh?.b && Number.isFinite(onBar) ? onBar.toFixed(1) : '';
    if (ob !== (cv.dataset.onbar || '')) cv.dataset.onbar = ob;   // the marker along the drawn (trimmed) bar, as meas is
    if (src !== lastSrc) { lastSrc = src; cv.dataset.src = src; }
    if (ms !== lastM) { lastM = ms; cv.dataset.meas = ms; }
    if (mode !== lastMode) { lastMode = mode; cv.dataset.mode = mode; }
    if (sh?.b) { const e = [b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(4)).join(','); if (e !== cv.dataset.bar) { cv.dataset.bar = e; cv.dataset.px = [...D, ...O].map((v) => v.toFixed(1)).join(','); } } else if (cv.dataset.bar) { delete cv.dataset.bar; delete cv.dataset.px; }   // the shaft bar's ends (normalised; stage px), for checks
  }

  function paint(ctx, D, O, pos, at, st) {
    const vx = O[0] - D[0], vy = O[1] - D[1], L = Math.hypot(vx, vy) || 1, ux = vx / L, uy = vy / L;
    const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    const tw = st ? st.width : 10;
    ctx.lineCap = 'round';
    ctx.globalAlpha = st ? st.alpha : 1;
    ctx.lineWidth = tw + 2; ctx.strokeStyle = `rgba(${C.on}, .55)`; line(D, O);   // halo: readable on any picture
    ctx.lineWidth = tw; ctx.strokeStyle = st ? st.color : `rgba(${C.dark}, .72)`;
    if (st) ctx.globalAlpha = st.alpha * 0.55;
    line(D, O);
    ctx.globalAlpha = st?.faint ? 0.5 : 1;
    const col = at ? C.unap : st ? `rgba(${C.dark}, .9)` : C.mark;   // following a track in progress: the marker, its fill and a label in the warn ink
    if (Number.isFinite(pos)) {
      const f = Math.max(0, Math.min(100, pos)) / 100, M = [D[0] + vx * f, D[1] + vy * f];
      if (!st) { ctx.globalAlpha = 0.4; ctx.lineWidth = 6; ctx.strokeStyle = col; line(D, M); ctx.globalAlpha = 1; }
      // the marker: a bar across the track
      const r = Math.max(11, tw * 0.75), nx = -uy * r, ny = ux * r;
      ctx.lineWidth = 6; ctx.strokeStyle = st ? `rgba(${C.on}, .9)` : `rgba(${C.dark}, .8)`; line([M[0] - nx, M[1] - ny], [M[0] + nx, M[1] + ny]);
      ctx.lineWidth = 4; ctx.strokeStyle = col; line([M[0] - nx, M[1] - ny], [M[0] + nx, M[1] + ny]);
    }
    // paw-4c48.8: the measured entry (where the shaft reads it enters), a hollow diamond on the track
    if (st?.M) {
      const r = Math.max(7, tw * 0.5) + 2, [mx, my] = st.M, dia = () => { ctx.beginPath(); ctx.moveTo(mx + ux * r, my + uy * r); ctx.lineTo(mx - uy * r, my + ux * r); ctx.lineTo(mx - ux * r, my - uy * r); ctx.lineTo(mx + uy * r, my - ux * r); ctx.closePath(); ctx.stroke(); };
      ctx.lineWidth = 5; ctx.strokeStyle = `rgba(${C.dark}, .8)`; dia();
      ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(${C.on}, 1)`; dia();
    }
    ctx.globalAlpha = 1;
    if (st && !st.labels) return;
    // ends labelled by position, outside the bar along its direction
    ctx.font = `600 11px ${C.font}`; ctx.textBaseline = 'middle';
    const label = (P, sx, sy, s, c = `rgba(${C.on}, .95)`) => {
      ctx.textAlign = sx < -0.3 ? 'right' : sx > 0.3 ? 'left' : 'center';
      const x = P[0] + sx * 16, y = P[1] + sy * 16;
      ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${C.dark}, .75)`; ctx.strokeText(s, x, y); ctx.fillStyle = c; ctx.fillText(s, x, y);
    };
    label(D, -ux, -uy, '0'); label(O, ux, uy, '100');
    if (at) { const P = [O[0] + ux * 16, O[1] + uy * 16]; label(P, ux, uy, 'tracking', C.unap); }
  }

  /** The hit strip: a rotated box over the bar and its ends (stage px), written only when it moves. On the shaft: none (it
   *  never takes the pointer over the video; its handles do). */
  function place(D, O, shaft) {
    if (!hit) return;
    const L = Math.hypot(O[0] - D[0], O[1] - D[1]), a = Math.atan2(O[1] - D[1], O[0] - D[0]);
    const s = shaft ? 'display:none' : `left:${((D[0] + O[0]) / 2).toFixed(1)}px;top:${((D[1] + O[1]) / 2).toFixed(1)}px;width:${(L + 2 * END_PX).toFixed(1)}px;height:${2 * END_PX}px;transform:translate(-50%,-50%) rotate(${a.toFixed(4)}rad)`;
    if (s !== lastStyle) { lastStyle = s; hit.style.cssText = s; }
  }

  // ---- pointer (the hand-placed bar) ----
  let drag = null;   // {k, x, y, b0, n0, id}
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) {
    if (passive || e.button !== 0 || !geo || !env || geo.shaft) return;
    const [x, y] = local(e), k = barHit(geo.D, geo.O, x, y);
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    hit.setPointerCapture(e.pointerId);
    drag = { k, x, y, b0: { ...bar }, n0: env.unmap(x, y), id: e.pointerId };
    draft = { ...bar }; hover = 'drag';
    window.addEventListener('keydown', esc, true);
  }
  function move(e) {
    if (!geo || !env) return;
    const [x, y] = local(e);
    if (!drag) { hover = passive ? '' : barHit(geo.D, geo.O, x, y) || ''; return; }
    const f = e.shiftKey ? 0.25 : 1, n = env.unmap(drag.x + (x - drag.x) * f, drag.y + (y - drag.y) * f);
    const nb = barDrag(drag.b0, drag.k, n[0] - drag.n0[0], n[1] - drag.n0[1]), a = env.map(nb.x0, nb.y0), b = env.map(nb.x1, nb.y1);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= MIN_PX) draft = nb;
  }
  function end(save) {
    if (!drag) return;
    try { hit?.releasePointerCapture(drag.id); } catch { /* already released */ }
    window.removeEventListener('keydown', esc, true);
    const d = draft, b0 = drag.b0;
    drag = null; draft = null; hover = '';
    if (save && d && key && (d.x0 !== b0.x0 || d.y0 !== b0.y0 || d.x1 !== b0.x1 || d.y1 !== b0.y1)) app.settings.set(key, d);
  }
  function esc(e) { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); if (drag) end(false); if (sdrag) sEnd(false); }
  $effect(() => () => window.removeEventListener('keydown', esc, true));
  const tip = 'Position bar: where the machine is (0 deepest, 100 out). Drag to move it · drag an end to scale and turn it · Shift fine · Esc cancels';

  // ---- paw-4c48.8: on the shaft. Hover: a passive window listener (nothing captured) shows the handles near the bar ----
  $effect(() => {
    if (!shaftOn) { near = false; return; }
    const mv = (e) => {
      if (sdrag || !geo?.shaft || !cv) return;
      const [x, y] = local(e), k = barHit(geo.D, geo.O, x, y, 26);
      const n = !!k || (ui && Math.hypot(x - ui.chip[0], y - ui.chip[1]) < 70);
      if (n !== near) near = n;
    };
    window.addEventListener('pointermove', mv, { passive: true });
    return () => window.removeEventListener('pointermove', mv);
  });
  const saveLook = (lk) => { if (lkey) app.settings.set(lkey, { ...lookOf(app.settings.get(lkey, null)), ...lk }); };
  let sdrag = null;   // {kind, x, y, l0, D, O, RL, v0, id, el}
  function sDown(e, kind) {
    if (passive || e.button !== 0 || !geo?.shaft || !env) return;
    e.preventDefault(); e.stopPropagation();   // no focus, no gesture underneath
    e.currentTarget.setPointerCapture(e.pointerId);
    const A = aspect(), sq = (P) => { const n = env.unmap(P[0], P[1]); return [n[0] * A, n[1]]; };
    sdrag = { kind, x: e.clientX, y: e.clientY, l0: { ...look }, D: sq(geo.D), O: sq(geo.O), RL: geo.RL, n0: env.unmap(...local(e)), id: e.pointerId, el: e.currentTarget };
    lookDraft = { ...look };
    window.addEventListener('keydown', esc, true);
  }
  function sMove(e) {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    const f = e.shiftKey ? 0.25 : 1, A = aspect();
    if (sdrag.kind === 'width') lookDraft = { ...sdrag.l0, width: Math.round(Math.max(WIDTH[0], Math.min(WIDTH[1], (sdrag.l0.width || 12) + (e.clientX - sdrag.x) * 0.25 * f))) };
    else if (sdrag.kind === 'opacity') lookDraft = { ...sdrag.l0, opacity: Math.round(100 * Math.max(OPACITY[0], Math.min(OPACITY[1], sdrag.l0.opacity + ((e.clientX - sdrag.x) / 150) * f))) / 100 };
    else {
      const n = env.unmap(...local(e)), dx = (n[0] - sdrag.n0[0]) * A * f, dy = (n[1] - sdrag.n0[1]) * f;
      lookDraft = lookDrag(sdrag.l0, sdrag.kind, dx, dy, sdrag.D, sdrag.O, sdrag.RL);
    }
  }
  function sEnd(save) {
    if (!sdrag) return;
    try { sdrag.el?.releasePointerCapture(sdrag.id); } catch { /* already released */ }
    window.removeEventListener('keydown', esc, true);
    const d = lookDraft, l0 = sdrag.l0;
    sdrag = null; lookDraft = null;
    if (save && d && JSON.stringify(d) !== JSON.stringify(l0)) saveLook(d);
  }
  const noFocus = (e) => { e.preventDefault(); e.stopPropagation(); };
  const flipShot = () => { const s = ui?.shot; if (s == null) return; const f = look.flips.includes(s) ? look.flips.filter((x) => x !== s) : [...look.flips, s]; saveLook({ flips: f }); };
  const showUi = $derived(shaftOn && !!ui && !passive && (near || chipHover || !!sdrag));
  const SW = { axis: 'var(--series-orange)', white: 'var(--on-media)', warn: 'var(--warn-ink)' };
</script>

{#if on}
  <canvas class="pbar" bind:this={cv} aria-hidden="true"></canvas>
  <div class="phit" class:passive bind:this={hit} data-grab={hover || undefined} role="presentation" data-testid="posbar-hit"
    onpointerdown={down} onpointermove={move} onpointerup={() => end(true)} onpointercancel={() => end(false)}
    onpointerleave={() => { if (!drag) hover = ''; }} {@attach tooltip(passive ? '' : tip)}></div>
  {#if showUi}
    {#each [['deep', ui.D, 'Pos 0 end: drag to trim or extend it (Shift fine, Esc cancels)'], ['out', ui.O, 'Pos 100 end: drag to trim or extend it (Shift fine, Esc cancels)']] as [k, P, t] (k)}
      <div class="sh-end" style:left="{P[0]}px" style:top="{P[1]}px" data-testid="posbar-shaft-{k}" role="presentation" {@attach tooltip(t)}
        onpointerdown={(e) => sDown(e, k)} onpointermove={sMove} onpointerup={() => sEnd(true)} onpointercancel={() => sEnd(false)}></div>
    {/each}
    <div class="sh-chips" style:left="{ui.chip[0]}px" style:top="{ui.chip[1]}px" role="toolbar" aria-label="Position bar on the shaft" tabindex="-1" data-testid="posbar-shaft-chips"
      onpointerenter={() => (chipHover = true)} onpointerleave={() => (chipHover = false)}>
      <button type="button" tabindex="-1" class="chip" {@attach tooltip('Drag to move beside the shaft (double-click: back on it)')} aria-label="Move"
        onpointerdown={(e) => sDown(e, 'body')} onpointermove={sMove} onpointerup={() => sEnd(true)} onpointercancel={() => sEnd(false)} ondblclick={() => saveLook({ along: 0, across: 0 })}><Icon name="move" size={12} /></button>
      <button type="button" tabindex="-1" class="chip" {@attach tooltip(`Width ${look.width || 'automatic'}: drag left / right (double-click: automatic)`)} aria-label="Width"
        onpointerdown={(e) => sDown(e, 'width')} onpointermove={sMove} onpointerup={() => sEnd(true)} onpointercancel={() => sEnd(false)} ondblclick={() => saveLook({ width: 0 })}>W</button>
      <button type="button" tabindex="-1" class="chip" {@attach tooltip(`Opacity ${Math.round(100 * look.opacity)} %: drag left / right`)} aria-label="Opacity"
        onpointerdown={(e) => sDown(e, 'opacity')} onpointermove={sMove} onpointerup={() => sEnd(true)} onpointercancel={() => sEnd(false)}><Icon name="contrast" size={12} /></button>
      {#each LOOK_COLORS as c (c)}
        <button type="button" tabindex="-1" class="sw" class:on={look.color === c} style:--c={SW[c]} aria-label="Color {c}" {@attach tooltip(c === 'axis' ? 'Stroke axis color' : c === 'white' ? 'White' : 'Warm')}
          onpointerdown={noFocus} onclick={() => saveLook({ color: c })}></button>
      {/each}
      <button type="button" tabindex="-1" class="chip" class:on={look.labels} aria-label="End labels" {@attach tooltip(look.labels ? 'Hide the 0 / 100 labels and the "tracking" tag' : 'Show the 0 / 100 labels and the "tracking" tag')}
        onpointerdown={noFocus} onclick={() => saveLook({ labels: !look.labels })}><Icon name="hash" size={12} /></button>
      <button type="button" tabindex="-1" class="chip" class:on={ui?.shot != null && look.flips.includes(ui.shot)} aria-label="Flip this shot" data-testid="posbar-shaft-flip"
        {@attach tooltip('Flip this shot: 0 at the tip, 100 at the hilt')} onpointerdown={noFocus} onclick={flipShot}><Icon name="flip" size={12} /></button>
    </div>
  {/if}
{/if}

<style>
  /* fixed inside the stage's containment (contain: strict): the stage's own box, whatever the picture rect */
  .pbar { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .phit { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: auto; touch-action: none; }
  .phit.passive { pointer-events: none; }
  .phit[data-grab='body'] { cursor: move; }
  .phit[data-grab='deep'], .phit[data-grab='out'] { cursor: crosshair; }
  .phit[data-grab='drag'] { cursor: grabbing; }
  /* paw-4c48.8: on the shaft, only these small handles take the pointer (and only while shown) */
  .sh-end { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--on-media) 90%, transparent); background: color-mix(in srgb, var(--media-bg) 55%, transparent); cursor: crosshair; touch-action: none; pointer-events: auto; }
  .sh-chips { position: fixed; transform: translate(-50%, -50%); display: flex; gap: 2px; padding: 2px; border-radius: var(--radius); background: var(--glass); backdrop-filter: var(--glass-blur); outline: none; pointer-events: auto; }
  .chip { all: unset; box-sizing: border-box; min-width: 20px; height: 20px; padding: 0 4px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius); color: var(--tx); font: 600 var(--fs-1) var(--font); cursor: ew-resize; touch-action: none; }
  .chip:hover { background: var(--bg-hover); color: var(--tx-hi); }
  .chip.on { background: var(--sel-bg); color: var(--accent-ink); }
  .sw { all: unset; width: 14px; height: 14px; margin: 3px 1px; border-radius: 50%; background: var(--c); border: 2px solid transparent; cursor: pointer; }
  .sw.on { border-color: var(--tx-hi); }
</style>
