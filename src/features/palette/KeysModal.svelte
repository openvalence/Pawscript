<script>
  // The keybinding editor (Ctrl+Alt+K, F1's Edit shortcuts): KeysPanel in an overlay (paw-idb5: no Shortcuts tab at the bottom any more).
  import { ui, hide, modal, fence } from './state.svelte.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Icon from '../../ui/kit/Icon.svelte';
  import KeysPanel from './KeysPanel.svelte';
  import './palette.css';

  let { app } = $props();
</script>

{#if ui.open === 'keys'}
  <dialog class="pp-dialog" {@attach modal} aria-labelledby="pk-title" onkeydown={(e) => fence(app, e)}
          oncancel={(e) => { e.preventDefault(); hide(); }}
          onpointerdown={(e) => e.target === e.currentTarget && hide()}>
    <div class="pp-box keys">
      <header>
        <h2 id="pk-title" class="k-caps">Edit keyboard shortcuts</h2>
        <span class="grow"></span>
        <button class="pp-btn ghost sq" aria-label="Close" {@attach tooltip('Close', 'Escape')} onclick={hide}><Icon name="close" size={14} /></button>
      </header>
      <div class="body"><KeysPanel {app} /></div>
    </div>
  </dialog>
{/if}

<style>
  .keys { width: min(1120px, calc(100vw - 48px)); height: min(760px, calc(100vh - 48px)); margin: auto; }
  header { display: flex; align-items: center; gap: var(--space-5); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--line-1); flex: none; }
  h2 { color: var(--tx-val); font-size: var(--fs-2); }
  .grow { flex: 1; }
  .sq { width: var(--ctl-h-sm); padding: 0; }
  .body { flex: 1; min-height: 0; position: relative; overflow: auto; }
</style>
