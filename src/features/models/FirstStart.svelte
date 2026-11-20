<!-- FirstStart (paw-cdot): after the shared build's setup screen and before the app, when the runtime is not there yet (a
     release without runtime.zip) or the needed models are missing on a first start. One list, one Download for everything
     picked; the runtime then unpacks on the setup screen (portable.rs) and the app opens. "Not now" when the app can run
     without it (the runtime is there); Settings > Models downloads later. -->
<script>
  import { Button } from '../../ui/kit/index.js';
  import ModelsList from './ModelsList.svelte';
  import { models, chosenEntry } from './store.svelte.js';
  import { fmtBytes } from './logic.js';
  import { dropOnModels } from './drop.js';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';

  let { app, runtime = false } = $props();
  let listEl = $state();
  const canSkip = $derived(!runtime || !!models.rt?.python);
  // the app (App.svelte) is not up yet: this screen takes the drops itself
  onMount(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => { if (e.payload.type === 'drop') dropOnModels(app, e.payload); });
    return () => off.then((f) => f()).catch(() => {});
  });

  async function done(seen = true) {
    if (seen) app.settings.set('models.setupDone', true);
    try { await app.backend.settingsSet(app.settings.values); } catch { /* the screen comes back once more: harmless */ }
    location.reload();
  }
  async function go() {
    const r = await listEl.downloadPicked();
    // the runtime came: the setup screen unpacks it, then the app opens (this screen again first when a model failed)
    if (r === 'unpack') await done(!models.error);
    else if (r === true) await done();
  }
</script>

<div class="fs" data-testid="first-start">
  <img src={new URL('../../assets/brand/pawscript-app.svg', import.meta.url).href} alt="" width="48" height="48" />
  <h1>{runtime ? `Pawscript needs to download its runtime (${fmtBytes(chosenEntry(app)?.files[0].bytes)}) and the models you pick` : 'Download the tracker models'}</h1>
  <p class="k-hint">
    {runtime ? 'The runtime runs the trackers and reads your videos; it stays next to the app.' : 'The trackers need them; the editor works without.'}
    Only what you tick is downloaded, from the Pawscript models server, and every file is checked before it is kept.
    An interrupted download carries on where it stopped.
  </p>
  <div class="box"><ModelsList {app} pick bind:this={listEl} /></div>
  <div class="go">
    {#if canSkip}<Button disabled={!!models.job} onclick={done}>Not now</Button>{/if}
    <Button variant="primary" icon="download" disabled={!!models.job} onclick={go} data-testid="first-start-download">Download</Button>
  </div>
</div>

<style>
  .fs { min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: 32px 16px; background: var(--bg); color: var(--tx); font: 15px var(--font); }
  h1 { font-size: var(--fs-4, 18px); font-weight: 500; margin: 0; text-align: center; max-width: 640px; }
  p { max-width: 640px; margin: 0; text-align: center; font-size: var(--fs-1); }
  .box { width: min(720px, 100%); border: 1px solid var(--line-1); }
  .go { display: flex; gap: var(--space-2); justify-content: flex-end; width: min(720px, 100%); }
</style>
