<script module>
  import { createPreview } from './deps.js';
  // One preview (hidden <video>) per media URL; the last one is kept, a change disposes the old.
  let cur = { url: null, pv: null };
  export function previewFor(url, frameMs) {
    if (!createPreview || !url) return null;
    if (cur.url !== url) { cur.pv?.dispose?.(); cur = { url, pv: createPreview({ url, frameMs }) }; }
    return cur.pv;
  }
</script>

<script>
  // Hover readout for any timeline strip: thumbnail of the hovered frame, time, frame, and the lane's own
  // line (tl.hover.text). While a drag is in progress only the snap label shows.
  import { tl } from './state.svelte.js';
  import { fmtMs } from '../../lib/video.js';
  import { frameAt } from './draw.js';
  import { gridOf } from '../../lib/lane.js';
  import { placeTip, thumbSize } from './wave-logic.js';

  let { app } = $props();
  const hv = $derived(tl.hover);
  const fm = $derived(app.player.frameMs || 1000 / 30);
  // the frame that contains the pointer's time (draw.js frameAt: the player clock's rule); while the pointer scrubs (scrubTime set)
  // the frame the picture shows -- held by the hysteresis while moving (frame-hold.js), the player's once it rests -- so the number,
  // the thumbnail, the grey cursor and the video name one frame (paw-bf4o)
  const p = $derived(app.player);
  const frame = $derived(hv ? Math.max(0, p.scrubTime == null ? frameAt(hv.t, gridOf(p)) : p.heldFrame >= 0 ? p.heldFrame : p.frame) : 0);
  const dragging = $derived(Object.keys(tl.draft).length > 0);
  const media = $derived(app.doc.media);
  // The player's own getFrame (shares its hidden <video> and the backend thumbnail strip) when it has a source;
  // else a local preview (browser harness).
  const own = $derived(!app.player.url && media?.path ? previewFor(app.backend.mediaUrl(media.path), fm) : null);
  const pv = $derived(app.player.url && app.player.getFrame ? { getFrame: (ms, h, o) => app.player.getFrame(ms, h, o) } : own);
  const size = $derived(thumbSize(media));
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  let cv = $state(), bw = $state(0), bh = $state(0), ready = $state(false), ver = 0;
  // Hovered frame -> thumbnail. getFrame supersedes a waiting request itself; the canvas keeps the last good image.
  const want = $derived(hv && pv && !dragging ? Math.max(0, Math.min(frame, Math.floor((app.durationMs || media?.durationMs || 1e9) / fm))) : -1);
  $effect(() => {
    if (want < 0 || !cv) return;
    // paw-bf4o: asked at the frame's middle (preview.js floors ms / frameMs, and (n * frameMs) / frameMs floors to n - 1 for some n);
    // a backend strip tile (instant, but only every so often) only where frames are under a pixel or so: a tile a frame away showed
    // the next frame's picture beside "f697"
    const me = ++ver, H = Math.round(size.h * dpr), tol = app.view.span / 1200;
    pv.getFrame((want + 0.5) * fm, H, { tolMs: tol > 2 * fm ? tol : 0 }).then((bmp) => {
      if (!bmp || me !== ver || !cv) return;
      cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0);
      ready = true;
    });
  });

  const pos = $derived(hv ? placeTip(hv.x, hv.y, bw, bh, window.innerWidth, window.innerHeight) : { left: 0, top: 0 });
</script>

{#if hv && dragging && !tl.inspector}
  {#if tl.snap?.label || hv.text}
    <div class="k-tip tip" style:left="{hv.x + 14}px" style:top="{hv.y + 16}px" role="tooltip">
      {#if tl.snap?.label}<div class="snapt">{tl.snap.label}</div>{/if}
      {#if hv.text}<div class="txt">{hv.text}</div>{/if}
    </div>
  {/if}
{:else if hv && !dragging && !tl.inspector}
  <div class="k-tip tip" style:left="{pos.left}px" style:top="{pos.top}px" style:visibility={bw ? 'visible' : 'hidden'} role="tooltip" bind:clientWidth={bw} bind:clientHeight={bh}>
    {#if pv}<canvas bind:this={cv} class="th" class:ready style:width="{size.w}px" style:height="{size.h}px"></canvas>{/if}
    <div class="row"><span class="num">{fmtMs(hv.t)}</span><span class="f num">f{frame}</span></div>
    {#if hv.text}<div class="txt">{hv.text}</div>{/if}
  </div>
{/if}

<style>
  /* surface, border, shadow and type come from the kit's .k-tip (theme.css); this only stacks the content */
  .tip { z-index: var(--z-tooltip, 1200); flex-direction: column; align-items: stretch; gap: var(--space-1, 2px); }
  .snapt { color: var(--warn); white-space: nowrap; }
  .th { display: block; background: var(--bg-sunken); border-radius: var(--radius); opacity: 0; box-sizing: content-box; }
  .th.ready { opacity: 1; }
  .row { display: flex; gap: var(--space-4, 8px); justify-content: space-between; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--tx-hi); }
  .f { color: var(--tx-mut); }
  .txt { color: var(--tx-val); white-space: pre-line; }
</style>
