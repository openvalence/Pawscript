<!--
  GraphPanel: the "Graph" workspace panel (bottom dock; Maximise covers the workspace, Esc restores).
  Toolbar: graph tabs (new / rename / duplicate / delete / import / export), add node, presets, live previews,
  A/B pins, problems counter, evaluation status, undo/redo, inspector, maximise, and the primary Bake button.
  Body: the canvas (GraphEditor) and the inspector column. Focus inside the panel scopes the graph's keys
  (ui.focused, read by commands.js `when`).
-->
<script>
  import { onDestroy, untrack } from 'svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import Spinner from '../../ui/kit/Spinner.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import GraphEditor from './GraphEditor.svelte';
  import NodeInspector from './NodeInspector.svelte';
  import PresetGallery from './PresetGallery.svelte';
  import { graphUI } from './ui.svelte.js';
  import { ctlOf } from './deps.js';
  import { titleOf } from './editor/cards.js';
  import { fmtNum } from './editor/plot.js';
  import { compare } from '../../lib/analyze/compare.js';

  let { app } = $props();
  // one app per panel instance: the controller and UI state are bound once
  const theApp = untrack(() => app);
  const ui = graphUI(theApp);
  const [ctl, ctlErr] = (() => { try { return [ctlOf(theApp), '']; } catch (e) { return [null, String(e?.message || e)]; } })();

  let root = $state();
  let gallery = $state(false);
  let renaming = $state(null);
  const g = $derived(ctl?.graph ?? null);
  const graphs = $derived(ctl?.graphs ?? []);

  // ---- focus scope -------------------------------------------------------------------------------------------
  function focusin() { ui.focused = true; }
  function focusout(e) { if (!root?.contains(e.relatedTarget)) ui.focused = false; }
  onDestroy(() => { ui.focused = false; ui.maximised = false; });

  // ---- status ------------------------------------------------------------------------------------------------
  const res = $derived(ctl?.result ?? null);
  const counts = $derived.by(() => {
    let cached = 0, ran = 0;
    for (const s of res?.status?.values?.() || []) { if (s === 'cached') cached++; else if (s === 'ok') ran++; }
    return { cached, ran };
  });
  const errs = $derived((ctl?.diags || []).filter((d) => d.severity === 'error').length);
  const warns = $derived((ctl?.diags || []).filter((d) => d.severity === 'warn').length);
  const nodeTitle = (id) => { const n = g?.nodes.find((x) => x.id === id); return n ? titleOf(n, ctl.registry.get(n.type)) : id; };
  const outAxes = $derived((g?.nodes || []).filter((n) => n.type === 'out.axis' && !n.muted).map((n) => n.params?.axis || 'stroke'));
  const bakeLabel = $derived(outAxes.length ? `Bake → ${[...new Set(outAxes)].join(', ')}` : 'Bake');
  let baking = $state(false);
  async function bake() {
    if (!ctl || baking) return;
    baking = true;
    try { const r = await ctl.bake({}); if (r?.message) ui.say(r.message); } finally { baking = false; }
  }

  // ---- A/B ---------------------------------------------------------------------------------------------------
  const pinA = $derived(ctl?.pins?.A ?? null), pinB = $derived(ctl?.pins?.B ?? null);
  const ab = $derived.by(() => {
    if (!pinA || !pinB || !app.view) return null;
    const a = ctl.valueOf(pinA.node, pinA.port), b = ctl.valueOf(pinB.node, pinB.port);
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return { text: 'A/B compare needs two script outputs' };
    try {
      const v = app.view, r = compare(b, a, { t0: v.start, t1: v.start + v.span });
      return { text: `f1 ${r.f1.toFixed(2)} · lag ${Math.round(r.lag_ms)} ms · strokes ${r.n_ref}/${r.n_cand}`, f1: r.f1 };
    } catch (e) { return { text: String(e.message || e) }; }
  });

  // ---- graph tabs ----------------------------------------------------------------------------------------------
  function newGraph() { const id = ctl.newGraph({ name: `Graph ${graphs.length + 1}` }); if (id) ctl.openGraph(id); }
  async function importFile() {
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = '.pawgraph,.json,application/json';
    pick.onchange = async () => {
      const f = pick.files?.[0];
      if (!f) return;
      try { const r = ctl.importGraph(await f.text()); if (r?.id) ctl.openGraph(r.id); ui.say(r?.diags?.length ? `imported with ${r.diags.length} notes` : 'imported'); }
      catch (e) { app.toast?.(String(e.message || e), 'error'); }
    };
    pick.click();
  }
  async function exportGraph(id) {
    const text = ctl.exportGraph(id), name = (graphs.find((x) => x.id === id)?.name || 'graph').replace(/[\\/:*?"<>|]+/g, '_') + '.pawgraph';
    if (app.backend?.isTauri && app.backend.saveDialog) {
      const p = await app.backend.saveDialog({ defaultPath: name, filters: [{ name: 'Pawscript graph', extensions: ['pawgraph'] }] });
      if (p) { await app.backend.writeText(p, text); app.toast?.(`Exported ${name}`, 'ok'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function tabMenu(e, gr) {
    showContextMenu(e, [
      { label: 'Rename', icon: 'pen', shortcut: 'F2', run: () => (renaming = gr.id) },
      { label: 'Duplicate', icon: 'duplicate', run: () => { const id = ctl.duplicateGraph(gr.id); if (id) ctl.openGraph(id); } },
      { label: 'Export .pawgraph…', icon: 'export', run: () => exportGraph(gr.id) },
      { label: 'Copy as text', icon: 'copy', run: () => navigator.clipboard?.writeText(ctl.exportGraph(gr.id)) },
      { separator: true },
      { label: 'Delete graph…', icon: 'delete', run: () => ctl.deleteGraph(gr.id) },
    ], { source: root });
  }
  function commitRename(id, v) { renaming = null; if (v.trim()) ctl.renameGraph(id, v.trim()); }
  const autofocus = (el) => { el.focus(); el.select(); };
  function graphMenu(e) {
    showContextMenu(e.currentTarget, [
      { label: 'New graph', icon: 'add', run: newGraph },
      { label: 'Import .pawgraph…', icon: 'import', run: importFile },
      ...(g ? [{ label: 'Export this graph…', icon: 'export', run: () => exportGraph(g.id) }] : []),
      { separator: true },
      { label: 'Presets…', icon: 'layers', run: () => (gallery = true) },
    ], { source: root });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="gpanel" class:max={ui.maximised} bind:this={root} onfocusin={focusin} onfocusout={focusout}
     onpointerdown={() => (ui.focused = true)} data-graph-panel>
  {#if !ctl}
    <EmptyState icon="warning" title="Graph engine unavailable" description={ctlErr || 'The graph controller (features/graph/integration.js) is not loaded.'} />
  {:else}
    <div class="gbar" role="toolbar" aria-label="Graph">
      <div class="gtabs" role="tablist" aria-label="Graphs">
        {#each graphs as gr (gr.id)}
          {#if renaming === gr.id}
            <input class="gtab-in" value={gr.name} {@attach autofocus} aria-label="Graph name"
                   onkeydown={(e) => { if (e.key === 'Enter') commitRename(gr.id, e.currentTarget.value); if (e.key === 'Escape') { e.stopPropagation(); renaming = null; } }}
                   onblur={(e) => commitRename(gr.id, e.currentTarget.value)} />
          {:else}
            <button type="button" class="gtab" role="tab" aria-selected={gr.id === ctl.activeId} data-off={gr.enabled === false ? '' : null}
                    onclick={() => ctl.openGraph(gr.id)} ondblclick={() => (renaming = gr.id)} oncontextmenu={(e) => tabMenu(e, gr)}
                    {@attach tooltip(gr.enabled === false ? `${gr.name} (disabled)` : gr.name)}>{gr.name}</button>
          {/if}
        {/each}
        <button type="button" class="gtab gtab-add" onclick={newGraph} aria-label="New graph" {@attach tooltip('New graph')}><Icon name="plus" size={12} /></button>
        <button type="button" class="gtab gtab-add" onclick={graphMenu} aria-label="Graph menu" {@attach tooltip('Import, export, presets')}><Icon name="more" size={12} /></button>
      </div>
      {#if g}
        <span class="k-sep"></span>
        <Button size="sm" variant="ghost" icon="add" onclick={() => ui.editor?.openPalette({})} tip="Add node" shortcut="Shift+A">Add</Button>
        <Button size="sm" variant="ghost" icon="layers" onclick={() => (gallery = true)} tip="Presets and saved selections">Presets</Button>
        <Button size="sm" variant="ghost" icon={ctl.live ? 'eye' : 'eye-off'} pressed={ctl.live} onclick={() => ctl.setLive(!ctl.live)} tip="Publish outputs as ghosts in the lanes">Live</Button>
        {#if pinA || pinB}
          <span class="gab" {@attach tooltip(ab?.text || 'Pin two outputs to compare them')}>
            <span class="gab-k" data-k="A">A</span><span class="gab-n">{pinA ? nodeTitle(pinA.node) : '—'}</span>
            <button type="button" class="gbtn2" onclick={() => ctl.swapPins()} aria-label="Swap A and B" {@attach tooltip('Swap A and B', 'X')}><Icon name="flip-h" size={12} /></button>
            <span class="gab-k" data-k="B">B</span><span class="gab-n">{pinB ? nodeTitle(pinB.node) : '—'}</span>
            {#if ab?.f1 != null}<span class="gab-s k-num">{ab.text}</span>{/if}
          </span>
        {/if}
        <span class="gsp"></span>
        <span class="gstatus k-num" aria-live="polite">
          {#if ctl.busy}<Spinner size={12} label="Evaluating" />{/if}
          {#if res}{fmtNum(res.ms)} ms · {counts.ran} ran · {counts.cached} cached{/if}
          {#if ctl.slow}<span class="gslow" {@attach tooltip('Live preview runs on release while the graph is slow')}>· slow: {nodeTitle(ctl.slow.node)} {fmtNum(ctl.slow.ms)} ms</span>{/if}
        </span>
        {#if errs || warns}
          <button type="button" class="gprob" data-e={errs ? '' : null} onclick={() => app.commands?.run?.('graph.nextProblem')} {@attach tooltip('Next problem', 'F8')}>
            {#if errs}<Icon name="error" size={12} />{errs} error{errs > 1 ? 's' : ''}{/if}{#if errs && warns}&nbsp;·&nbsp;{/if}{#if warns}<Icon name="warning" size={12} />{warns} warn{/if}
          </button>
        {/if}
        <span class="k-sep"></span>
        <button type="button" class="gbtn2" onclick={() => ctl.undo()} disabled={!ctl.canUndo} aria-label="Undo" {@attach tooltip('Undo graph edit', 'Ctrl+Z')}><Icon name="undo" size={14} /></button>
        <button type="button" class="gbtn2" onclick={() => ctl.redo()} disabled={!ctl.canRedo} aria-label="Redo" {@attach tooltip('Redo', 'Ctrl+Y')}><Icon name="redo" size={14} /></button>
        <button type="button" class="gbtn2" aria-pressed={ui.inspector} onclick={() => ui.setInspector(!ui.inspector)} aria-label="Inspector" {@attach tooltip('Inspector', 'Ctrl+I')}><Icon name="panel-right" size={14} /></button>
        <button type="button" class="gbtn2" aria-pressed={ui.maximised} onclick={() => (ui.maximised = !ui.maximised)} aria-label="Maximize" {@attach tooltip(ui.maximised ? 'Restore (Esc)' : 'Maximize', 'Ctrl+Shift+M')}><Icon name={ui.maximised ? 'exit-fullscreen' : 'fullscreen'} size={14} /></button>
        <Button size="sm" variant="primary" icon="download" loading={baking} disabled={!outAxes.length} onclick={bake}
                tip={errs ? `${errs} error${errs > 1 ? 's' : ''}: only the healthy outputs bake` : 'Write every output to its axis as one undoable edit'} shortcut="Ctrl+Enter">{bakeLabel}</Button>
      {/if}
    </div>
    <div class="gbodyp">
      {#if g}
        <GraphEditor {app} {ctl} {ui} />
        {#if ui.inspector}<div class="ginsp"><NodeInspector {app} {ctl} {ui} /></div>{/if}
      {:else}
        <div class="gfill"><EmptyState class="gempty" icon="layers" title="No graph yet" description="A graph turns sources (tracker runs, axes, the plan) through processing nodes into axis scripts, non-destructively. Nothing touches your script until you Bake.">
          {#snippet actions()}
            <Button variant="primary" icon="add" onclick={newGraph}>New graph</Button>
            <Button icon="layers" onclick={() => (gallery = true)}>From a preset…</Button>
            <Button variant="ghost" icon="import" onclick={importFile}>Import…</Button>
          {/snippet}
        </EmptyState></div>
      {/if}
    </div>
    <p class="k-sr" role="status" aria-live="polite">{ui.said}</p>
    <PresetGallery {app} bind:open={gallery}
                   onplace={(p) => { if (!g) { const id = ctl.newGraph({ name: p.name, preset: p.user ? null : p.id }); if (id) ctl.openGraph(id); if (p.user) setTimeout(() => ui.editor?.placePreset(p)); } else ui.editor?.placePreset(p); }}
                   onnew={(p) => { const id = ctl.newGraph({ name: p.name, preset: p.id }); if (id) ctl.openGraph(id); }} />
  {/if}
</div>

<style>
  .gpanel { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; background: var(--bg); color: var(--tx); font-family: var(--font); }
  .gpanel.max { position: fixed; inset: 0; z-index: var(--z-overlay, 50); box-shadow: var(--shadow-3); }
  .gbar { flex: none; display: flex; align-items: center; gap: 4px; min-height: 32px; padding: 2px 6px; background: var(--bg-raised); border-bottom: 1px solid var(--line-1); overflow-x: auto; scrollbar-width: none; }
  .gtabs { display: flex; align-items: stretch; gap: 1px; min-width: 0; }
  .gtab { max-width: 160px; height: 24px; padding: 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: inherit; font-size: var(--fs-2);
    color: var(--tx-mut); background: none; border: 1px solid transparent; border-bottom: 2px solid transparent; border-radius: var(--radius) var(--radius) 0 0; cursor: pointer; }
  .gtab:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .gtab[aria-selected='true'] { color: var(--tx-hi); border-bottom-color: var(--reality); background: var(--bg); }
  .gtab[data-off] { font-style: italic; opacity: .7; }
  .gtab:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: -2px; }
  .gtab-add { display: grid; place-items: center; width: 24px; padding: 0; }
  .gtab-in { width: 140px; height: 22px; padding: 0 6px; font: inherit; font-size: var(--fs-2); color: var(--tx-hi); background: var(--bg-sunken); border: 1px solid var(--focus); border-radius: var(--radius); outline: none; }
  .gsp { flex: 1 1 auto; min-width: 8px; }
  .gstatus { display: inline-flex; align-items: center; gap: 5px; color: var(--tx-mut); font-size: var(--fs-1); white-space: nowrap; }
  .gslow { color: var(--warn-ink); }
  .gprob { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px; font: inherit; font-size: var(--fs-1); white-space: nowrap; color: var(--warn-ink);
    background: none; border: 1px solid color-mix(in srgb, var(--warn-ink) 50%, transparent); border-radius: var(--radius); cursor: pointer; }
  .gprob[data-e] { color: var(--bad-ink); border-color: color-mix(in srgb, var(--bad-ink) 50%, transparent); }
  .gbtn2 { display: grid; place-items: center; width: 26px; height: 24px; padding: 0; color: var(--tx-mut); background: none; border: 1px solid transparent; border-radius: var(--radius); cursor: pointer; flex: none; }
  .gbtn2:hover:not(:disabled) { color: var(--tx-hi); border-color: var(--line-3); }
  .gbtn2[aria-pressed='true'] { color: var(--reality); }
  .gbtn2:disabled { opacity: .45; cursor: not-allowed; }
  .gab { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 2px; border: 1px solid var(--line-2); border-radius: var(--radius); font-size: var(--fs-1); white-space: nowrap; }
  .gab-k { display: grid; place-items: center; width: 16px; height: 16px; font-weight: 700; color: var(--bg); border-radius: var(--radius); }
  .gab-k[data-k='A'] { background: var(--series-sky); }
  .gab-k[data-k='B'] { background: var(--series-orange); }
  .gab-n { max-width: 90px; overflow: hidden; text-overflow: ellipsis; color: var(--tx); }
  .gab-s { color: var(--tx-mut); margin-left: 4px; }
  .gbodyp { flex: 1 1 auto; min-height: 0; display: flex; }
  .gbodyp > :global(.gview) { flex: 1 1 auto; }
  /* the empty state scrolls instead of clipping in a short dock (auto margins centre it only while it fits);
     below 260 px it drops the icon and tightens so the actions stay on screen at the default dock height */
  .gfill { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; display: flex; container-type: size; }
  .gfill > :global(.gempty) { height: auto; margin: auto; }
  @container (max-height: 260px) {
    .gfill > :global(.gempty) { gap: var(--space-2); padding: var(--space-3) var(--space-6); }
    .gfill > :global(.gempty .k-empty-state-icon) { display: none; }
    .gfill > :global(.gempty .kit-empty-state-actions) { margin-top: 0; }
  }
  .ginsp { flex: 0 0 280px; width: 280px; min-height: 0; }
</style>
