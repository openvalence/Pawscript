<script>
  // The frame: top bar; the body as Blender areas (Areas.svelte: by default [left | video | right] over the timeline,
  // the bottom dock under both; drag to rearrange, split, join); status bar. Modes pick the panels.
  // Feature modals (palette, help, ...) are mounted once on top; the dialog and toast hosts last.
  // Works with the real app (App.svelte) and with dev/mock-app.js (dev/shell.html).
  import TopBar from './TopBar.svelte';
  import StatusBar from './StatusBar.svelte';
  import Areas from './Areas.svelte';
  import ProjectPage from './ProjectPage.svelte';
  import DialogHost from './DialogHost.svelte';
  import ToastHost from '../ui/kit/ToastHost.svelte';
  import EmptyState from '../ui/kit/EmptyState.svelte';
  import Button from '../ui/kit/Button.svelte';
  import { modals } from './plugins.js';

  let { app: root, dropping = false } = $props();
  // the tabs (tabs.svelte.js, paw-shgb): one app per document, only the shown one's editor mounted (keyed: a switch mounts
  // the other app's areas; a hidden one keeps its state in its app). The editor stays mounted while the home tab shows the
  // project page over it, hidden and inert (no paint, no pointer, no focus; tabs.show paused the player, the command scope
  // keeps its keys off)
  const tabs = $derived(root.tabs);
  const app = $derived(tabs.current);
  const empty = $derived(!tabs.list.length);
  const home = $derived(tabs.home);
  // a question asked by an app that is not shown yet (a document opening in its new tab: "Found X.funscript") or by a hidden
  // one shows too: the shown app's first, else any app's
  const asking = $derived(app.dialog ? app : tabs.apps.find((a) => a.dialog) || app);
</script>

{#snippet crashed(error, reset)}
  <EmptyState class="crash" title="Something in the interface broke." description="Your document is still in memory{app.project ? ' and is autosaved' : ''}. Reload the interface to carry on; save as soon as you can.">
    <pre data-testid="crash-error">{error?.stack || error?.message || error}</pre>
    {#snippet actions()}
      <Button variant="primary" onclick={reset}>Reload interface</Button>
      {#if app.commands.get('file.save')}<Button data-command="file.save" onclick={() => app.commands.run('file.save')}>Save now</Button>{/if}
      {#if app.commands.get('help.bugReport')}<Button data-command="help.bugReport" onclick={() => app.commands.run('help.bugReport')}>Copy bug report</Button>{/if}
    {/snippet}
  </EmptyState>
{/snippet}

{#key app}
<div class="shell" class:dropping>
  <TopBar {app} />
  <svelte:boundary failed={crashed} onerror={(e) => { console.error('[shell]', e); app.usage?.note('app:error', { text: String('shell: ' + (e?.message || e)).slice(0, 300) }); app.project?.flushAutosave?.(); }}>
    {#if !empty && app.tabs.list.some((t) => t.app === app && !t.parked)}
      <main class="body" class:hidden={home} inert={home} aria-hidden={home ? 'true' : undefined} data-testid="editor" data-tab={app.tabId}><Areas {app} /></main>
    {/if}
    {#if home}
      <main class="body"><ProjectPage {app} {dropping} /></main>
    {/if}
  </svelte:boundary>
  <StatusBar {app} />
</div>

{#each modals as m (m.id)}
  <svelte:boundary onerror={(e) => console.error('[modal ' + m.id + ']', e)}><m.component {app} /></svelte:boundary>
{/each}
{/key}
<DialogHost app={asking} />
<ToastHost />

<style>
  .shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100vh; background: var(--bg); }
  .shell.dropping::after { content: 'Drop to open'; position: fixed; inset: 6px; display: grid; place-items: center; border: 2px dashed var(--reality); background: var(--scrim); color: var(--reality); font-size: var(--fs-5); pointer-events: none; z-index: 50; }
  /* both in the one grid cell: the home page lies over the hidden editor, which keeps its size (nothing re-lays out) */
  .body { grid-area: 2 / 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .body.hidden { visibility: hidden; }
  :global(.crash) pre { max-width: 900px; margin: 0; max-height: 40vh; overflow: auto; font: var(--fs-1) var(--mono); color: var(--bad-ink); white-space: pre-wrap; user-select: text; cursor: text; }
</style>
