<script>
  // The real app's root: the shell plus the Tauri-only wiring (file drops, launch paths and single-instance
  // hand-off, close guard, the last document reopened at startup). The app object itself is built in main.js.
  import { onMount } from 'svelte';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import Shell from './app/Shell.svelte';
  import ClosingPanel from './app/ClosingPanel.svelte';
  import { closeApp } from './app/writing.svelte.js';
  import { dropOnModels } from './features/models/drop.js';

  let { app } = $props();
  let dropping = $state(false);

  onMount(() => {
    const offs = [];
    const keep = (p) => p.then((f) => offs.push(f)).catch((e) => console.warn('[app]', e));
    if (!window.__TAURI_INTERNALS__) return;   // a plain browser (main.js swapped in the in-memory backend): no native events
    keep(getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      dropping = t === 'enter' || t === 'over';
      if (t === 'drop' && e.payload.paths?.length && !dropOnModels(app.tabs.current, e.payload)) app.tabs.open(e.payload.paths);
    }));
    // through the tabs: the open document dropped / launched again only switches to it (paw-shgb)
    keep(app.backend.onOpenPaths((paths) => paths?.length && app.tabs.open(paths)));

    // close guard: armed while the app runs; a held-back close writes every tab (no question, paw-up1r) and the usage log
    // (its app:close line, paw-mn92), then closes for real; a write still under way shows the Writing panel (paw-ee14:
    // Cancel stays in the app). The shell closes anyway if the page goes quiet (paw-a82t), and on a second close at once.
    keep(app.backend.onCloseRequested(() => closeApp(app)));

    (async () => {
      const paths = await app.backend.launchPaths().catch(() => []);
      // paw-bztd + paw-shgb: straight back where the owner was, every tab that was open; launched with a file: that too
      await app.tabs.restore();
      if (paths?.length) await app.tabs.open(paths);
    })();
    app.project.startAutosave();
    app.project.refreshRecent?.();
    return () => offs.forEach((f) => f());
  });

  $effect(() => { app.backend.closeGuard(true).catch?.(() => {}); });
</script>

<Shell {app} {dropping} />
<ClosingPanel {app} />
