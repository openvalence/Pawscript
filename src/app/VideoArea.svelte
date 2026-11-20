<script>
  import { tooltip } from '../ui/kit/tooltip.js';
  // The main video area. With features/video present its VideoPane does everything (stage, transport, overlay
  // plug-ins). Without it, the shell's stand-in: a plain <video> driving app.player, the overlay plug-ins on top,
  // and a minimal transport. Either way: an unplayable codec offers a playable proxy (transcode_preview).
  import { VideoPane } from './plugins.js';
  import { overlays } from './plugins.js';
  import IconButton from '../ui/kit/IconButton.svelte';
  import Button from '../ui/kit/Button.svelte';
  import EmptyState from '../ui/kit/EmptyState.svelte';
  import { fmtMs } from '../lib/video.js';
  import { fmtKeys } from './keymap.js';

  let { app } = $props();
  let video = $state();
  let failed = $state(''), proxy = $state(null);   // proxy: {path} | {busy, frac} while transcoding
  const media = $derived(app.doc.media);
  const src = $derived(media ? (proxy?.path ? app.backend.mediaUrl(proxy.path) : app.backend.mediaUrl(media.path)) : '');
  const shown = $derived(overlays.filter((o) => !o.modes || o.modes.includes(app.mode)));

  $effect(() => { media?.path; failed = ''; proxy = null; });
  $effect(() => {
    const v = video;
    if (!v || VideoPane) return;
    app.player.attach(v);
    return () => app.player.detach();
  });

  async function makeProxy() {
    if (!app.backend.transcodePreview) return;
    const t = app.task('Making a playable copy');
    const job = app.backend.transcodePreview(media.path, { onProgress: (f) => { t.update(Math.round(f * 100), 100); proxy = { busy: true, frac: f }; } });
    proxy = { busy: true, frac: 0, cancel: job.cancel };
    try { const path = await job.promise; proxy = { path }; failed = ''; app.toast('Playing a proxy copy; timing matches the original', 'ok'); }
    catch (e) { proxy = null; if (e?.code !== 'cancelled') app.toast('Could not make a playable copy: ' + (e?.message || e), 'error'); }
    finally { t.end(); }
  }
  const k = (id) => fmtKeys(app.commands.keysFor(id)[0] || '');
</script>

{#snippet unplayable()}
  <div class="fail">
    <EmptyState title={failed} description={proxy?.busy ? `Converting… ${Math.round((proxy.frac || 0) * 100)}%` : app.backend.transcodePreview ? "An H.264 proxy in the app's cache; every timestamp is kept, so the script stays in sync." : ''}>
      {#snippet actions()}
        {#if proxy?.busy}<Button size="sm" onclick={() => proxy.cancel?.()}>Cancel</Button>
        {:else if app.backend.transcodePreview}<Button variant="primary" onclick={makeProxy}>Make a playable copy</Button>{/if}
      {/snippet}
    </EmptyState>
  </div>
{/snippet}

{#if VideoPane}
  <div class="area"><VideoPane {app} /></div>
{:else}
  <div class="area fallback">
    <div class="stage">
      {#if media}
        {#key src}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={video} {src} preload="auto" onerror={() => (failed = 'The webview cannot play this video (codec or container).')}></video>
        {/key}
        <div class="ovl">
          {#each shown as o (o.id)}
            <svelte:boundary onerror={(e) => { console.error('[overlay ' + o.id + ']', e); app.usage?.note('app:error', { text: String('overlay ' + o.id + ': ' + (e?.message || e)).slice(0, 300) }); }}><o.component {app} /></svelte:boundary>
          {/each}
        </div>
        {#if failed}{@render unplayable()}{/if}
      {:else}
        <div class="none k-hint">No video: script-only editing. Open one with {k('file.open')}.</div>
      {/if}
    </div>
    <div class="transport">
      <IconButton icon="skip-back" label="Go to start" size="sm" shortcut={k('player.start')} data-command="player.start" onclick={() => app.commands.run('player.start')} />
      <IconButton icon="step-back" label="Previous frame" size="sm" shortcut={k('player.stepBack')} data-command="player.stepBack" onclick={() => app.commands.run('player.stepBack')} />
      <IconButton icon={app.player.playing ? 'pause' : 'play'} label={app.player.playing ? 'Pause' : 'Play'} variant="default" shortcut={k('player.toggle')} data-command="player.toggle" onclick={() => app.commands.run('player.toggle')} />
      <IconButton icon="step-forward" label="Next frame" size="sm" shortcut={k('player.stepFwd')} data-command="player.stepFwd" onclick={() => app.commands.run('player.stepFwd')} />
      <IconButton icon="skip-forward" label="Go to end" size="sm" shortcut={k('player.end')} data-command="player.end" onclick={() => app.commands.run('player.end')} />
      <output class="time k-num">{fmtMs(app.player.timeMs)} <span>/ {fmtMs(app.durationMs)}</span></output>
      <span class="grow"></span>
      <IconButton icon="loop" label="Loop playback" size="sm" pressed={!!app.player.loop} shortcut={k('loop.playToggle')} data-command="loop.playToggle" onclick={() => app.commands.run('loop.playToggle')} />
      <button class="rate k-num" data-command="player.rate1" onclick={() => app.commands.run('player.rate1')} {@attach tooltip("Speed ([ / ] to change, \\ resets)")}>{app.player.rate}×</button>
    </div>
  </div>
{/if}

<style>
  .area { position: relative; height: 100%; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg-sunken); }
  .stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: var(--bg-sunken); box-shadow: var(--recess); }
  video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: var(--media-bg); }
  .ovl { position: absolute; inset: 0; pointer-events: none; }
  .ovl > :global(*) { pointer-events: auto; }
  .none { position: absolute; inset: 0; display: grid; place-items: center; }
  .fail { position: absolute; inset: 0; background: color-mix(in srgb, var(--bg-sunken) 85%, transparent); color: var(--tx); }
  .transport { display: flex; align-items: center; gap: var(--space-1); height: 32px; padding: 0 var(--space-3); background: var(--bg-raised); border-top: 1px solid var(--line-1); }
  .time { margin-left: var(--space-4); font-size: var(--fs-2); color: var(--tx-hi); }
  .time span { color: var(--tx-mut); }
  .grow { flex: 1; }
  .rate { min-width: 40px; font-size: var(--fs-2); color: var(--tx-val); }
</style>
