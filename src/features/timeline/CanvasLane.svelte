<script module>
  import { tl, bindApp } from './state.svelte.js';
  // tl.focus mirrors real keyboard focus: the lane whose element holds DOM focus, else null. A press on a lane
  // focuses it; a press or Tab anywhere else moves focus away and clears it. Commands that reuse a core key
  // (Delete, digits, Ctrl+D, Shift+M, Enter...) require tl.focus === their lane, so the point editor's keys win
  // everywhere else. The focused lane shows a ring and its name, so the user can see where keys will go.
  if (typeof MutationObserver === 'function') new MutationObserver(() => tl.themeTick++).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density'] });
  // Space held (observed, never handled: the keymap owns Space = play / pause): Space+drag pans, as on the axis lanes
  let spaceHeld = false;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) spaceHeld = true; }, true);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceHeld = false; }, true);
    window.addEventListener('blur', () => (spaceHeld = false));
  }
</script>

<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  // The base of every timeline strip: a full-size canvas painted by `paint(ctx, w, h)` inside an $effect
  // (whatever state paint reads is tracked; Svelte batches to one paint per tick), plus cheap DOM overlays
  // that never repaint the canvas: playhead, snap guide, hover tooltip. Wheel zooms/pans like the lanes.
  // Pointer handlers get the raw event; e.currentTarget is the canvas (use interact.js localX).
  import { xToMs, panBy, headMs, gridOf } from '../../lib/lane.js';
  import { frameCursorOf } from './frame-cursor.js';
  import { fitCanvas, X } from './draw.js';
  import { wheelView, localX, beginDrag } from './interact.js';
  import { edgeFollow } from '../../lib/edge-scroll.js';
  import { selTarget } from '../../lib/selmodal.js';
  import HoverTip from './HoverTip.svelte';
  import OutOfRange from './OutOfRange.svelte';

  // tag: the row's always-visible name, top-right (the shell's row title only shows on hover). Lanes pass null
  // while their empty-state hint is showing, since the hint names the row itself.
  // follow: a drag on this row (one the row holds the pointer for) pans the view near / past its edges (lib/edge-scroll.js);
  // off on the Overview, which maps the whole video.
  // select: {box(t0, y0, t1, y1, mode)}: the row's own box hit (times in ms, y in px), for B / C (lib/selmodal.js: C on a row
  // of intervals selects what the circle touches, the box of it)
  let { app, lane, paint, label = lane, tag = null, cursor = 'default', wheel = true, playhead = true, oob = true, hoverText = null, follow = true, select = null,
    onpointerdown, onpointermove, onpointerup, onpointercancel, onpointerleave, ondblclick, oncontextmenu, children } = $props();

  $effect.pre(() => bindApp(app));
  let canvas = $state(), root = $state(), w = $state(0), h = $state(0);
  $effect(() => { tl.themeTick; const ctx = fitCanvas(canvas, w, h); if (ctx) paint(ctx, w, h); });

  // the playhead: smooth while playing (one rAF tick per frame of the display), with the pointer while scrubbing
  let tick = $state(0);
  $effect(() => { if (!playhead || !app.player.playing) return; let id = 0; const f = () => { tick++; id = requestAnimationFrame(f); }; id = requestAnimationFrame(f); return () => cancelAnimationFrame(id); });
  const head = $derived(playhead && w ? (tick, app.player.timeMs, app.player.scrubTime, X(app.view, w, headMs(app.player))) : -1);
  // paw-ef73.22: the grey frame cursor: the frame that contains the playhead, snapped to its start (setting timeline.frameCursor)
  const fcur = $derived(w ? (tick, app.player.timeMs, app.player.scrubTime, frameCursorOf(app.settings?.get?.('timeline.frameCursor', 'full'), lane === 'ruler', app.view, w, app.player.heldFrame >= 0 ? app.player.clock.timeOf(app.player.heldFrame) : headMs(app.player), gridOf(app.player))) : null);
  const snapX = $derived(tl.snap && w ? X(app.view, w, tl.snap.t) : -1);

  let release = null, dead = false;   // dead: this gesture was cancelled (Esc): ignore its moves and release
  // paw-ef73.7: the view gestures every row shares, whatever is under the pointer (the axis lanes' own, LaneView):
  // middle-drag or Space+drag pans; the wheel zooms / pans (wheelView). The row's handlers never see a pan.
  let pan = null;   // {x0, view0}
  function down(e) {
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();   // no middle-click autoscroll
      canvas.setPointerCapture?.(e.pointerId);
      pan = { x0: e.clientX, view0: app.view };
      return;
    }
    root?.focus({ preventScroll: true }); tl.focus = lane;
    dead = false;
    release?.();
    endEdge(false);
    if (e.button === 0) {
      release = beginDrag(() => { dead = true; release = null; endEdge(true); onpointercancel?.(e); });   // Esc: the view back too
      if (follow && onpointermove) edge = edgeFollow({ app, el: canvas, step: refire, x0: e.clientX });
    }
    onpointerdown?.(e);
  }
  // paw-cp8k: the view pans under a held drag; the row's move handler runs again at the last pointer position each frame (a
  // pointer event of its own on the canvas, so e.currentTarget and the modifier keys are what the row always gets)
  let edge = null, lastE = null;
  const endEdge = (restore) => { edge?.stop(restore); edge = null; lastE = null; };
  function refire() {
    const e = lastE;
    if (!e || !canvas) return;
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      buttons: e.buttons, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey }));
  }
  function move(e) {
    if (pan) { app.setView(panBy(pan.view0, e.clientX - pan.x0, w, app.durationMs)); return; }
    const x = localX(e, canvas), t = xToMs(app.view, w, x);
    tl.hover = { t, x: e.clientX, y: e.clientY, lane, text: hoverText?.(t, x, e) ?? null };
    if (!(dead && e.buttons)) onpointermove?.(e);
    if (edge && e.isTrusted && !dead && canvas.hasPointerCapture?.(e.pointerId)) { lastE = e; edge.move(e.clientX); }   // only a drag the row took the pointer for
  }
  function up(e) { if (pan) { pan = null; return; } endEdge(false); const d = dead; dead = false; release?.(); release = null; if (!d) onpointerup?.(e); }
  function pcancel(e) { if (pan) { pan = null; return; } endEdge(!dead); const d = dead; dead = false; release?.(); release = null; if (!d) onpointercancel?.(e); }
  function leave(e) { if (tl.hover?.lane === lane) tl.hover = null; onpointerleave?.(e); }
  $effect(() => () => endEdge(false));   // the row unmounted mid-drag: no pan loop left behind
  $effect(() => (select && canvas ? selTarget({ el: canvas, box: (x0, y0, x1, y1, mode) => select.box(xToMs(app.view, w, x0), y0, xToMs(app.view, w, x1), y1, mode) }) : undefined));

  $effect(() => {
    const c = canvas;
    if (!c || !wheel) return;
    const fn = (e) => { e.preventDefault(); wheelView(app, e, w, localX(e, c)); };
    c.addEventListener('wheel', fn, { passive: false });
    return () => c.removeEventListener('wheel', fn);
  });
</script>

<!-- a canvas editing surface: it must take keyboard focus so lane-scoped keys know where they go -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="tl-lane" class:focused={tl.focus === lane} data-tl-lane={lane} bind:this={root} bind:clientWidth={w} bind:clientHeight={h} tabindex="0" role="application" aria-roledescription="timeline lane" aria-label={label}
  onfocusin={() => (tl.focus = lane)} onfocusout={(e) => { if (!root?.contains(e.relatedTarget) && tl.focus === lane) tl.focus = null; }}>
  <canvas bind:this={canvas} style:cursor onpointerdown={down} onpointermove={move} onpointerup={up}
    onpointercancel={pcancel} onpointerleave={leave} onauxclick={(e) => e.button === 1 && e.preventDefault()} ondblclick={(e) => ondblclick?.(e)} oncontextmenu={(e) => oncontextmenu?.(e)}></canvas>
  {#if oob}<OutOfRange {app} />{/if}   <!-- paw-g56v: outside 0..end hatched (not on the Overview: it maps the whole video) -->
  {#if tag}<span class="rtag k-caps" aria-hidden="true">{tag}</span>{/if}
  {#if snapX >= 0 && snapX <= w}<div class="snap" style:transform="translateX({snapX - 0.5}px)" {@attach tooltip(tl.snap.label)}></div>{/if}
  {#if fcur}<div class="fcur" class:ruler={lane === 'ruler'} data-frame-cursor data-x={fcur.x} style:transform="translateX({fcur.x}px)" aria-hidden="true">{#if fcur.block}<span class="fblk" style:width="{fcur.w}px"></span><span class="fnum">{fcur.n}</span>{/if}</div>{/if}
  {#if head >= 0 && head <= w}<div class="head" style:transform="translateX({head - 0.5}px)"></div>{/if}
  {@render children?.({ w, h })}
  {#if tl.hover?.lane === lane}<HoverTip {app} />{/if}
  {#if tl.focus === lane}<div class="ftag" aria-hidden="true">{label} · keys</div>{/if}
</div>

<style>
  .tl-lane { position: absolute; inset: 0; overflow: hidden; outline: none; background: var(--bg-sunken); }
  .tl-lane.focused { box-shadow: inset 0 0 0 1px var(--focus); }
  .ftag { position: absolute; right: 0; bottom: 0; z-index: 2; pointer-events: none; padding: 0 5px; font: 500 var(--fs-1)/13px var(--font); letter-spacing: .08em;
    text-transform: uppercase; color: var(--on-accent); background: var(--focus); border-top-left-radius: var(--radius); }
  /* top-right: lane text is left-aligned in its blocks, so the right edge is the free corner; the shell's hover
     "hide" chip (same title) covers it on hover. Under the playhead / snap guide (earlier in the DOM, no z-index);
     a soft lane-coloured backing keeps it legible. 9px like .ftag. */
  .rtag { position: absolute; right: 0; top: 0; pointer-events: none; padding: 0 var(--space-2); font-size: var(--fs-1); line-height: 12px;
    color: var(--tx-mut); background: color-mix(in srgb, var(--bg-sunken) 72%, transparent); border-bottom-left-radius: var(--radius); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; display: block; }
  .fcur { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; pointer-events: none; background: color-mix(in srgb, var(--tx-mut) 38%, transparent); }
  .fcur.ruler { background: color-mix(in srgb, var(--tx-mut) 80%, transparent); }
  .fblk { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--tx-mut) 16%, transparent); }
  .fnum { position: absolute; left: 3px; bottom: 1px; font: 600 var(--fs-1)/11px var(--font); color: var(--tx-mut); padding: 0 2px; background: color-mix(in srgb, var(--bg-sunken) 75%, transparent); }
  .head, .snap { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; pointer-events: none; }
  .head { background: var(--highlight); }
  .snap { background: repeating-linear-gradient(to bottom, var(--warn) 0 3px, transparent 3px 6px); }
</style>
