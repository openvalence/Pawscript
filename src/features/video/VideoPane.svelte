<!--
  VideoPane: the video stage + transport. <VideoPane {app} /> (the shell mounts it in the main area).
  The <video> is sized to its intrinsic pixels and placed by one matrix (view.js); the overlay canvas draws the
  registered overlays (app.player.overlays) through the same matrix, so they stay glued under zoom, pan,
  rotation and flips. Wheel zooms around the cursor, drag pans (when zoomed, or with the middle button),
  double-click toggles fit / 100 %. An active pointer tool (overlays.tool) gets the left button first.
  Plug-in overlay components (src/features/*/overlay.js) are hosted in a box that follows the picture rect, so
  their fitRect maths keeps working when zoomed or panned (not under rotation/flip: use app.player.overlays).
-->
<script>
  import { untrack } from 'svelte';
  import Transport from './Transport.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Hud from './Hud.svelte';
  import Simulator from './Simulator.svelte';
  import NextStep from '../onboard/NextStep.svelte';
  import { Player } from './player.svelte.js';
  import { viewMatrix, toNorm, fromNorm, zoomAround, panView, apply, rotatedSize, stabilised } from './view.js';

  let { app } = $props();

  // the real player; until the shell constructs it as app.player, adopt it here
  // svelte-ignore state_referenced_locally
  if (!app.player?.overlays) {
    console.warn('[video] app.player is not features/video Player; replacing it (ask the shell to construct it)');
    const old = app.player;
    app.player = new Player(app);
    if (old?.durationMs) app.player.setDuration(old.durationMs);
  }
  const p = $derived(app.player);

  const pluginMods = import.meta.glob('../*/overlay.js', { eager: true });
  const plugins = Object.values(pluginMods).flatMap((m) => [m.default].flat()).filter((x) => x?.component).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const shownPlugins = $derived(plugins.filter((o) => !o.modes || o.modes.includes(app.mode)));

  let stage = $state(), video = $state(), canvas = $state(), scrubCv = $state();
  // paw-shgb: let go of it on unmount (a tab hidden or closed): the player outlives the pane, a kept canvas held the whole old editor
  $effect(() => { const c = scrubCv, pl = p; pl.scrubCanvas = c; return () => { if (pl.scrubCanvas === c) pl.scrubCanvas = null; }; });
  let cw = $state(0), ch = $state(0), dpr = $state(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  $effect(() => {
    const f = () => (dpr = window.devicePixelRatio || 1);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  });

  // ---- element + source ----
  $effect(() => { const el = video, pl = p; if (!el) return; untrack(() => pl.attach(el)); return () => untrack(() => pl.detach()); });
  $effect(() => { const m = app.doc.media, pl = p; untrack(() => { if (m || pl.url) pl.load(m); }); });

  const vw = $derived(p.vw || app.doc.media?.width || 0), vh = $derived(p.vh || app.doc.media?.height || 0);
  // the stabilised preview's camera at the playhead (player.stab: {x, y (frame units), s?, th?})
  const st = $derived(p.stab ? p.stab(p.timeMs) : null);
  // paw-8ehz: a fitted picture keeps out of the stage's tool columns (player.inset, the Groups tool); a zoomed view is the user's
  const ins = $derived(p.inset && (p.view.mode === 'fit' || p.view.mode === 'fill') ? p.inset : null);
  const fitM = $derived.by(() => { if (!ins) return viewMatrix(p.view, cw, ch, vw, vh, dpr); const m = viewMatrix(p.view, Math.max(1, cw - ins.l - ins.r), Math.max(1, ch - ins.t - ins.b), vw, vh, dpr); return { ...m, e: m.e + ins.l, f: m.f + ins.t }; });
  const M = $derived(stabilised(fitM, st, vw, vh));   // + zoom / rotation when the shot removes them (paw-a3n)
  const crisp = $derived(M.s * dpr >= 0.999);
  const videoStyle = $derived(`width:${vw}px;height:${vh}px;transform:matrix(${M.a},${M.b},${M.c},${M.d},${M.e},${M.f})`);
  const bg = $derived(p.ui.letterbox === 'checker' ? 'repeating-conic-gradient(var(--media-check-a) 0 25%, var(--media-check-b) 0 50%) 0 0/16px 16px' : p.ui.letterbox || 'var(--media-bg)');

  // the picture's bounding box on stage (for plug-in overlays that compute fitRect of their own box)
  const pic = $derived.by(() => {
    const [rw, rh] = rotatedSize(p.view, vw, vh), [x0, y0] = apply(M, 0, 0), [x1, y1] = apply(M, vw, vh);
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: rw * M.s, h: rh * M.s };
  });

  // ---- overlay painting (drawers' reactive reads are tracked by this effect) ----
  const env = { app: null, w: 0, h: 0, dpr: 1, vw: 0, vh: 0, scale: 1, timeMs: 0, frame: 0, playing: false, map: null, unmap: null };
  $effect(() => {
    if (!canvas) return;
    const d = dpr, w = cw, h = ch, m = M, W = vw, H = vh, drawers = p.overlays.drawers;
    p.overlays.version; p.timeMs; p.view;
    const bw = Math.round(w * d), bh = Math.round(h * d);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!W || !H) return;
    Object.assign(env, { app, w, h, dpr: d, vw: W, vh: H, scale: m.s, timeMs: p.timeMs, frame: p.frame, playing: p.playing,
      map: (nx, ny) => fromNorm(m, W, H, nx, ny), unmap: (x, y) => toNorm(m, W, H, x, y) });
    for (const dr of drawers) { try { ctx.save(); dr.draw(ctx, env); } catch (e) { console.error('[video overlay]', dr.id, e); } finally { ctx.restore(); } }
  });

  // ---- pointer: tools, pan, zoom ----
  const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pt = (e) => {
    const [x, y] = local(e), [rx, ry] = toNorm(M, vw, vh, x, y);
    return { x, y, rx, ry, nx: Math.min(1, Math.max(0, rx)), ny: Math.min(1, Math.max(0, ry)) };
  };
  let drag = null;   // {kind:'tool'|'pan', x, y}
  function down(e) {
    if (e.target !== canvas) return;
    const tool = p.overlays.activeTool;
    if (e.button === 0 && tool?.down?.(pt(e), e)) { drag = { kind: 'tool' }; canvas.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    const zoomed = p.view.mode !== 'fit';
    if (e.button === 1 || (e.button === 0 && zoomed)) {
      const [x, y] = local(e);
      drag = { kind: 'pan', x, y }; canvas.setPointerCapture(e.pointerId); e.preventDefault();
    }
  }
  function move(e) {
    if (!drag) return;
    if (drag.kind === 'tool') { p.overlays.activeTool?.move?.(pt(e), e); return; }
    const [x, y] = local(e);
    p.view = panView(p.view, cw, ch, vw, vh, x - drag.x, y - drag.y, dpr);
    drag.x = x; drag.y = y;
  }
  function up(e) {
    if (drag?.kind === 'tool') p.overlays.activeTool?.up?.(pt(e), e);
    drag = null;
  }
  function context(e) {
    const tool = p.overlays.activeTool;
    if (tool?.context) { e.preventDefault(); tool.context(pt(e), e); }
  }
  function wheel(e) {
    if (!vw) return;
    e.preventDefault();
    const [x, y] = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    p.view = zoomAround(p.view, cw, ch, vw, vh, x, y, Math.pow(1.0018, -dy), dpr);
  }
  function dbl(e) {
    if (e.target !== canvas || p.overlays.activeTool) return;
    p.view = p.view.mode === 'fit' ? { ...p.view, mode: '1:1', panX: 0, panY: 0 } : { ...p.view, mode: 'fit', panX: 0, panY: 0 };
  }
  $effect(() => {   // non-passive wheel so the page never scrolls
    const s = stage;
    if (!s) return;
    s.addEventListener('wheel', wheel, { passive: false });
    return () => s.removeEventListener('wheel', wheel);
  });
  const hint = $derived(p.overlays.activeTool?.hint?.() || '');
  const toolFrame = $derived(p.overlays.activeTool?.frame || '');
  const cursor = $derived(drag?.kind === 'pan' ? 'grabbing' : p.overlays.activeTool ? p.overlays.activeTool.cursor || 'crosshair' : p.view.mode !== 'fit' ? 'grab' : 'default');
</script>

<div class="vp">
  <!-- the stage and the machine preview side by side: the picture fits what the preview leaves, never under it -->
  <div class="row">
  <div class="stage" bind:this={stage} bind:clientWidth={cw} bind:clientHeight={ch} style:background={bg} data-testid="video-stage">
    <!-- svelte-ignore a11y_media_has_caption -->
    <!-- Local files play through the asset protocol (convertFileSrc), a plain webview <video>. -->
    <video bind:this={video} class:crisp class:hidden={!vw || !p.url} style={videoStyle} preload="auto" playsinline disablepictureinpicture></video>
    <!-- hover scrub: decoded frames drawn here, same box and matrix as the <video> (player.scrub); playing, each frame the <video> presents, drawn with the overlays (paw-osat: player #paintFrame) -->
    <canvas bind:this={scrubCv} class="scrub" class:crisp class:hidden={!p.scrubbing && !p.framed} style={videoStyle}></canvas>
    <canvas bind:this={canvas} class="ov" style:cursor
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} oncontextmenu={context} ondblclick={dbl}></canvas>
    {#if vw && p.url}
      {#each shownPlugins as o (o.id)}
        <div class="plug" style="left:{pic.x}px;top:{pic.y}px;width:{pic.w}px;height:{pic.h}px"><o.component {app} /></div>
      {/each}
      <!-- paw-kxwz: the first-run hint, at the top of the stage in the Scenes and Track tabs (onboard/NextStep.svelte; off unless the profile is new) -->
      {#if app.mode === 'scenes' || app.mode === 'track'}<NextStep {app} />{/if}
    {/if}
    {#if !app.doc.media}
      <div class="empty">
        <p>No video</p>
        <!-- paw-kxwz: the next step with its key -->
        <p class="next" data-testid="video-empty-next">Open a video ({app.commands?.keysFor?.('file.open')?.[0] || 'Ctrl+O'}) to track it, or place points by hand: 0–9 at the playhead.</p>
        {#if app.project?.openDialog}<Button variant="primary" onclick={() => app.project.openDialog()}>Open video…</Button>{/if}
      </div>
    {/if}
    {#if hint}<span class="tip">{hint}</span>{/if}
    {#if toolFrame}<div class="toolframe" style:--frame={toolFrame} data-testid="tool-frame"></div>{/if}
    <Hud {app} />
  </div>
  <Simulator {app} />
  </div>
  <Transport {app} />
</div>

<style>
  .vp { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; background: var(--bg-sunken); }
  .row { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; }
  .stage { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; contain: strict; }
  /* an active tool's frame (overlays `frame`): inside the stage, never moves the picture; two pulses when it appears, then steady */
  .toolframe { position: absolute; inset: 0; pointer-events: none; border: var(--bw) solid var(--frame); border-width: 2px; }
  /* the pulses fade a thicker ring in and out over the steady border (opacity only; the duration is a token, so reduced motion ends them at once) */
  .toolframe::after { content: ''; position: absolute; inset: -2px; box-shadow: inset 0 0 0 5px var(--frame); opacity: 0; animation: toolframe calc(var(--t-slow) * 1.4) var(--ease-out) 2 alternate; }
  @keyframes toolframe { to { opacity: 1; } }
  video, .scrub { position: absolute; left: 0; top: 0; transform-origin: 0 0; max-width: none; pointer-events: none; }
  video.crisp, .scrub.crisp { image-rendering: pixelated; }
  video.hidden, .scrub.hidden { visibility: hidden; }
  .ov { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
  .plug { position: absolute; pointer-events: none; }
  .empty { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: var(--space-5); color: var(--tx-mut); pointer-events: none; }
  .empty :global(button) { pointer-events: auto; }
  .empty .next { max-width: 44ch; text-align: center; font-size: var(--fs-2); }
  .tip { position: absolute; left: var(--space-5); bottom: var(--space-5); pointer-events: none; font-size: var(--fs-2); color: var(--tx); background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-radius: var(--radius); padding: var(--space-1) var(--space-4); }
</style>
