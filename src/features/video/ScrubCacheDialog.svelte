<!-- ScrubCacheDialog: File › Scrub cache… (modal.js). Usage, Build now (current video, when not cached: the command
     video.buildScrubCache, also in the palette and the File menu) and Clear cache: jobs. Its two settings (video.scrubCache,
     media.cacheGb) are Settings › Video & cache; here they are their Props (app/Prop.svelte, paw-m3b6), not a form of its own. -->
<script>
  import { Dialog, Button, Field } from '../../ui/kit/index.js';
  import Prop from '../../app/Prop.svelte';

  let { app } = $props();
  const P = $derived(app.player), GiB = 2 ** 30;
  let info = $state(null), busy = $state(false);

  const src = $derived(P.media?.path || '');   // paw-mh1a: the file playing (a proxy has its own scrub cache)
  const sc = $derived(P.scrubCache?.src === src ? P.scrubCache : null);
  $effect(() => {   // on open, and when a build ends
    if (!P.cacheDialog || sc?.state === 'building') return;
    Promise.resolve(app.backend?.mediaCacheInfo?.()).then((i) => (info = i ?? null), () => (info = null));
  });
  const n = (b) => (b / GiB).toFixed(b < 10 * GiB ? 2 : 1);
  const status = $derived(!src ? 'No video open.'
    : sc?.state === 'building' ? `Building for this video… ${Math.round((sc.fraction || 0) * 100)} %`
    : sc?.state === 'ready' ? (sc.h ? `This video has a scrub cache, made at ${sc.h} lines: the full size would pass the limit.` : 'This video has a scrub cache.')
    : sc?.state === 'too_large' ? 'This video’s scrub cache would be larger than the limit, even made smaller.'
    : sc?.state === 'failed' ? 'Building failed: ' + sc.message
    : 'This video has no scrub cache.');

  // (the Prop wrote media.cacheGb and applySetting set the limit; this reads the usage it left)
  async function limitSet(gb) { info = (await P.setCacheLimit(gb)) ?? info; }
  async function clear() {
    busy = true;
    try { info = await app.backend.mediaCacheClear(); P.scrubCacheCleared(); }
    catch (e) { app.toast('Could not clear the cache: ' + (e?.message || e), 'error'); }
    finally { busy = false; }
  }
</script>

<Dialog bind:open={P.cacheDialog} title="Scrub cache" size="sm">
  <p class="lead">An all-intra copy of the video (every frame a keyframe) in the media cache: hover scrub jumps
    anywhere by decoding one frame. About 10–20× smaller than raw frames; built in the background.</p>
  <Prop {app} key="video.scrubCache" size="md" caption="Build a scrub cache for every opened video" />
  <div class="gb"><Field label="Maximum storage (GB)" hint="The whole media cache; least recently used entries go first.">
    {#snippet children({ id, describedby })}
      <Prop {app} key="media.cacheGb" {id} aria-describedby={describedby} size="md" oncommit={limitSet} />
    {/snippet}
  </Field></div>
  <p class="line k-num">{info ? `Using ${n(info.bytes)} GB of ${n(info.limit)} GB · ${info.entries} entries` : 'Cache usage unknown.'}</p>
  <p class="line">{status}</p>
  {#snippet footer({ close })}
    {#if src && sc?.state !== 'ready' && sc?.state !== 'building'}
      <Button data-command="video.buildScrubCache" onclick={() => app.commands.run('video.buildScrubCache')}>Build now</Button>
    {/if}
    <Button variant="danger" loading={busy} disabled={busy} onclick={clear}>Clear cache</Button>
    <Button variant="primary" onclick={() => close('done')}>Done</Button>
  {/snippet}
</Dialog>

<style>
  .lead { margin: 0 0 var(--space-4); color: var(--tx-mut); font-size: var(--fs-2); line-height: var(--lh); }
  .gb { margin-top: var(--space-4); }
  .line { margin: var(--space-3) 0 0; font-size: var(--fs-2); }
</style>
