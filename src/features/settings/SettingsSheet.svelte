<!-- SettingsSheet: the Settings panel in a dialog, only while the Projects page shows with no document open (Ctrl+, there);
     once a document is open the panel lives in its dock. -->
<script>
  import { Dialog } from '../../ui/kit/index.js';
  import SettingsPanel from './SettingsPanel.svelte';
  import { sheet } from './sheet.svelte.js';

  let { app } = $props();
  $effect(() => { if (sheet.open && !(app.tabs?.home && !app.tabs.hidden)) sheet.open = false; });   // a document opened: its dock has the panel
</script>

{#if sheet.open}
  <Dialog open={true} title="Settings" size="md" class="settings-sheet" onclose={() => (sheet.open = false)} data-testid="settings-sheet">
    <div class="body"><SettingsPanel {app} /></div>
  </Dialog>
{/if}

<style>
  .body { height: min(70vh, 720px); margin: calc(-1 * var(--space-4)); }
</style>
