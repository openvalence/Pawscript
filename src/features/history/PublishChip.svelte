<!-- The status bar's published state (paw-up1r stage 2): "v3 published · 14 edits since", quiet, a state not a nag. A click
     opens the project history. -->
<script>
  import StatusItem from '../../ui/kit/StatusItem.svelte';
  import { publishState } from './publish-state.js';
  let { app } = $props();
  const s = $derived(app.tabs?.home ? null : publishState(app));
  const k = $derived(app.commands.keysFor('file.publish')[0] || '');
  const tip = $derived(!s ? '' : s.version
    ? `The funscripts beside the video are v${s.version}${s.adopted ? ' (written by Save before Publish existed)' : ''}${s.edits ? `; the project has ${s.edits} edit${s.edits === 1 ? '' : 's'} since, players and devices reading the folder do not see them until you publish` : '; the project has nothing newer'}. Publish${k ? ` (${k})` : ''} writes them; click for the history`
    : `Nothing published yet: players and devices reading the folder see no script from this project. Publish${k ? ` (${k})` : ''} writes it`);
</script>

{#if s}
  <StatusItem icon="upload" tone="neutral" {tip} data-testid="status-published" data-version={s.version} data-edits={s.edits}
    data-command="file.history" onclick={() => app.commands.run('file.history')}><span class="k-num">{s.text}</span></StatusItem>
{/if}
