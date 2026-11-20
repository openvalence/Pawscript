<!--
  Hud: small on-video readouts in the top corners, plus a centred card when the video can't play. <Hud {app} />
  VideoPane renders it absolutely over the stage (full size). pointer-events: none except the card and the warning
  chips (they carry tooltips). ui.hud hides the chips; the card always shows.
  Chips stack from the corner inward, stable ones at the corner, transient ones on the inner end, so a chip
  appearing never moves the others. Colours are tokens only: chips and the card are the theme's own surfaces.
  Missing file (error.canLocate): "Locate video…" -> p.relink(). paw-xfg6: a missing file the webview still plays from its
  cache (p.missing, no error) gets a bar at the bottom saying so, with the same "Locate video…".
  Proxy: "Make playable proxy" -> p.makeProxy(); while busy a ProgressBar (error.progress 0..1, else the "NN %" in
  the message, else indeterminate) and Cancel -> p.cancelProxy() when error.cancel exists.
-->
<script>
  import { untrack } from 'svelte';
  import { Icon, Button, EmptyState, ProgressBar, tooltip } from '../../ui/kit/index.js';
  import { viewMatrix, zoomPercent } from './view.js';
  import { cmd } from '../../app/cmd.js';
  import { fmtNum, loopInfo, proxyProgress } from './transport.js';

  let { app } = $props();
  const p = $derived(app.player);
  let cw = $state(0), ch = $state(0);

  const v = $derived(p.view);
  const zoom = $derived.by(() => {
    if (v.mode === 'fit') return null;
    const dpr = window.devicePixelRatio || 1;
    if (p.vw && cw) return zoomPercent(viewMatrix(v, cw, ch, p.vw, p.vh, dpr), dpr);
    return v.mode === '1:1' ? 100 : v.mode === 'custom' ? v.zoom * 100 : null;
  });
  const orient = $derived([v.rot ? v.rot + '°' : '', v.flipH ? '⇆' : '', v.flipV ? '⇅' : ''].filter(Boolean).join(' '));
  const loop = $derived(loopInfo(p.loop, p.frameMs));
  const speed = $derived(p.playing && p.shuttle < 0 ? `◂ ${fmtNum(-p.shuttle)}× reverse`
    : p.playing && p.shuttle > 0 ? `${fmtNum(p.shuttle)}× frame by frame`
    : p.rate !== 1 ? `${fmtNum(p.rate)}×${p.rate < 0.1 ? ' frame by frame' : ''}` : '');
  const dropped = $derived(p.playing && !p.shuttle && p.stats.dropped > 0 ? p.stats.dropped : 0);

  // seeking (paused: steps, scrubs, jumps; a shuttle seeks all the time and says so itself): show only after
  // 120 ms, and once shown keep it 300 ms, so quick seeks never flicker
  let seekShow = $state(false), shownAt = 0, seekT = 0;
  $effect(() => {
    const s = p.seeking;
    clearTimeout(seekT);
    if (s) seekT = setTimeout(() => { seekShow = true; shownAt = performance.now(); }, 120);
    else if (untrack(() => seekShow)) seekT = setTimeout(() => (seekShow = false), Math.max(0, 300 - (performance.now() - shownAt)));
    return () => clearTimeout(seekT);
  });

  const err = $derived(p.error);
  const progress = $derived(err?.busy ? proxyProgress(err) : null);
  const TITLES = { missing: 'Video file not found', empty: 'The video file is empty', 4: "This video can't play here", 3: 'The video failed to decode', 2: "The video can't be read", 0: 'No picture to show' };
  const title = $derived(!err ? '' : err.busy ? 'Making a playable proxy' : TITLES[err.code] ?? (err.canProxy ? "This video can't play here" : 'Playback failed'));
  const desc = $derived(!err ? '' : err.busy ? 'An H.264 copy for editing; the original file is not changed.' : err.message);
  // the clicked button unmounts with its panel state: drop focus first so its tooltip can't linger
  const act = (fn) => (e) => { e.currentTarget.blur(); fn(); };
  const blur = (e) => e.currentTarget.blur();
</script>

<div class="hud" bind:clientWidth={cw} bind:clientHeight={ch} aria-live="polite">
  {#if p.ui.hud !== false}
    <div class="corner tl">
      {#if zoom != null || orient}<span class="chip k-num">{zoom != null ? Math.round(zoom) + '%' : ''}{zoom != null && orient ? ' · ' : ''}{orient}</span>{/if}
      {#if loop}<span class="chip k-num accent"><Icon name="loop" size={12} />{loop.text}</span>{/if}
      {#if speed}<span class="chip k-num intent">{speed}</span>{/if}
    </div>
    <div class="corner tr">
      {#if seekShow && !p.playing}<span class="chip k-num quiet"><span class="dot"></span>seeking</span>{/if}
      {#if dropped}<span class="chip k-num warn live" {@attach tooltip('Frames the decoder dropped since the file was opened')}>{dropped} dropped</span>{/if}
      {#if p.hasVideo && p.isVfr}<span class="chip k-num warn live" {@attach tooltip('Variable frame rate: frame steps follow the real frame times')}>VFR</span>{/if}
      {#if p.hasVideo && !p.exact}<span class="chip k-num warn live" {@attach tooltip('Frame numbers are estimated until the frame rate is known')}>~frames</span>{/if}
    </div>
  {/if}

  {#if err}
    <div class="card k-brackets" role="alert">
      <EmptyState class="hud-empty" icon={err.busy ? 'film' : 'warning'} {title} description={desc}>
        {#if err.busy}
          <div class="prog"><ProgressBar value={progress} label="Transcoding" showValue={progress != null} /></div>
        {/if}
        {#snippet actions()}
          {#if err.canProxy}
            <Button variant="primary" icon="film" {...cmd(app, 'video.proxy', undefined, { before: blur })}>Make playable proxy</Button>
          {:else if err.busy && err.cancel}
            <Button onclick={act(() => p.cancelProxy())}>Cancel</Button>
          {/if}
          {#if err.canLocate}
            <Button variant="primary" icon="folder-open" {...cmd(app, 'video.replace', undefined, { tip: 'Locate the video file', before: blur })}>Locate video…</Button>
          {/if}
        {/snippet}
      </EmptyState>
    </div>
  {:else if p.missing}
    <div class="missing" role="alert" data-testid="video-missing">
      <Icon name="warning" size={14} />
      <span class="what">Video file not found at {p.media?.proxyOf || p.media?.path}: playing a cached copy; tracking needs the original</span>
      <Button size="sm" variant="primary" icon="folder-open" {...cmd(app, 'video.replace', undefined, { tip: 'Locate the video file', before: blur })}>Locate video…</Button>
    </div>
  {/if}
</div>

<style>
  .hud { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .corner { position: absolute; top: var(--space-4); display: flex; gap: var(--space-2); max-width: calc(50% - var(--space-4)); }
  .tl { left: var(--space-4); }
  .tr { right: var(--space-4); flex-direction: row-reverse; }
  .chip {
    display: inline-flex; align-items: center; gap: var(--space-2); height: var(--ctl-h-sm); padding: 0 var(--space-3);
    background: var(--glass); border: var(--bw) solid var(--line-2); border-radius: var(--radius);
    box-shadow: var(--shadow-1); color: var(--tx-val); font-size: var(--fs-1); line-height: 1; white-space: nowrap;
    backdrop-filter: var(--glass-blur);
  }
  .accent { color: var(--accent-ink); }
  .intent { color: var(--intent); }
  .warn { color: var(--warn-ink); }
  .quiet { color: var(--tx-mut); }
  .live { pointer-events: auto; cursor: help; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: pulse calc(var(--t-slow) * 3) ease-in-out infinite alternate; }
  @keyframes pulse { from { opacity: .25; } }

  .card {
    position: absolute; left: 50%; top: 50%; translate: -50% -50%; pointer-events: auto;
    width: min(460px, calc(100% - var(--space-7))); max-height: calc(100% - var(--space-6)); overflow: auto;
    background-color: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-3);
  }
  .card :global(.hud-empty) { height: auto; padding: var(--space-7) var(--space-7) var(--space-6); }
  .missing {
    position: absolute; left: var(--space-4); right: var(--space-4); bottom: var(--space-4); pointer-events: auto;
    display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3);
    background-color: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-2);
    color: var(--warn-ink); font-size: var(--fs-1);
  }
  .missing .what { flex: 1; min-width: 0; color: var(--tx-val); overflow-wrap: anywhere; }
  .prog { align-self: stretch; margin-top: var(--space-4); text-align: left; }
</style>
