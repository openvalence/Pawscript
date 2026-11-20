<!-- UpdatesGroup (paw-cdot): Settings > Updates under its "Check for updates at start" row: the version, Check, what is
     new, Download and install, Restart. -->
<script>
  import { Button, ProgressBar } from '../../ui/kit/index.js';
  import { upd, words, check, install, restart } from './store.svelte.js';

  let { app } = $props();
  const f = $derived(upd.found);
</script>

<div class="ug" data-testid="updates-group">
  <div class="line">
    <span class="k-hint">{words() || 'Not checked in this session'}</span>
    <Button size="sm" icon="refresh" loading={upd.phase === 'checking'} disabled={upd.phase !== 'idle'} onclick={() => check(app)} tip="Asks GitHub; nothing is sent but the request">Check for updates</Button>
  </div>
  {#if f?.version}
    {#if f.notes}<pre class="notes" data-testid="update-notes">{f.notes}</pre>{/if}
    <p class="k-hint">{f.portable ? 'Replaces Pawscript.exe and code.zip in this folder; settings, projects and models stay. A new runtime, if this version needs one, is downloaded at its first start.' : 'Runs the new installer when you restart.'}</p>
    {#if upd.phase === 'downloading'}
      <ProgressBar value={upd.total ? upd.done / upd.total : null} label="Downloading the update" showValue={!!upd.total} />
    {:else if upd.phase === 'ready'}
      <Button size="sm" variant="primary" icon="refresh" onclick={() => restart(app)}>Restart to finish</Button>
    {:else}
      <Button size="sm" variant="primary" icon="download" onclick={() => install(app)}>Download and install</Button>
    {/if}
  {/if}
  {#if upd.error}<p class="err">{upd.error}</p>{/if}
</div>

<style>
  .ug { display: grid; gap: var(--space-2); padding: var(--space-2) var(--space-2) var(--space-3) var(--space-4); justify-items: start; }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .notes { max-height: 200px; overflow: auto; white-space: pre-wrap; font-size: var(--fs-1); margin: 0; padding: var(--space-2); border: 1px solid var(--line-1); width: 100%; box-sizing: border-box; }
  .err { color: var(--bad-ink); font-size: var(--fs-1); margin: 0; overflow-wrap: anywhere; }
  p { margin: 0; font-size: var(--fs-1); }
</style>
