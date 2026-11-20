<script>
  import { tooltip } from '../ui/kit/tooltip.js';
  // The status bar: playhead (time, frame), fps, active axis, selection, range, zoom, problems (review
  // feature's window event), background tasks with progress, sidecar state, autosave. paw-idb5: the bottom edge of the window;
  // the centred button folds the bottom tray in and out (Ctrl+J), the (i) in the corner opens F1's shortcuts, and in the Scenes
  // tab what a click and a drag do on the thing under the pointer shows here (it was the hint line under the timeline).
  import StatusBar from '../ui/kit/StatusBar.svelte';
  import Icon from '../ui/kit/Icon.svelte';
  import { tl } from '../features/timeline/state.svelte.js';
  import StatusItem from '../ui/kit/StatusItem.svelte';
  import ProgressBar from '../ui/kit/ProgressBar.svelte';
  import IconButton from '../ui/kit/IconButton.svelte';
  import { fmtSpan, fmtDuration } from '../lib/time-format.js';
  import { statuses } from './plugins.js';
  import HealthSlot from './HealthSlot.svelte';
  import { readProvenance, originLabel, originText } from '../lib/provenance.js';
  import { scriptOf } from '../lib/script-of.js';   // paw-x7w7: baked + live

  let { app } = $props();
  const p = $derived(app.player);
  const fps = $derived(app.doc.media?.fps || (p.frameMs ? 1000 / p.frameMs : 0));
  const selN = $derived(app.doc.selection.axis === app.doc.activeAxis ? app.doc.selection.ats.size : 0);
  const n = $derived(scriptOf(app, app.doc.activeAxis).length);
  let problems = $state(null);
  $effect(() => {
    const on = (e) => (problems = e.detail?.counts || null);
    window.addEventListener('pawscript:review', on);
    return () => window.removeEventListener('pawscript:review', on);
  });
  // a Blender-style modal transform (lib/xform.js: G / S / Shift+D) or select mode (lib/selmodal.js: B / C) says what it is doing
  // and which keys it takes
  let xform = $state(null), xfIcon = $state('move'), xfTip = $state('');
  $effect(() => {
    const on = (e) => { xform = e.detail?.hint || null; xfIcon = e.detail?.icon || 'move'; xfTip = e.detail?.tip || 'Transform: Enter confirms, Esc cancels'; };
    window.addEventListener('pawscript:xform', on);
    return () => window.removeEventListener('pawscript:xform', on);
  });
  const task = $derived(app.tasks.at(-1));
  // the Projects page shows no document's facts (paw-hdxk): the tray toggle already hides there
  const hasDoc = $derived(!app.tabs?.home && (!!app.doc.media || Object.keys(app.doc.axes).length > 0));
  // the rows set tl.hint = {lane, text} on hover (ScenesLane, FilmstripLane, Ruler); shown while the pointer is still on that row
  const hint = $derived(app.mode === 'scenes' && !app.tabs?.home && tl.hint && tl.hover?.lane === tl.hint.lane ? tl.hint.text : null);
  const trayOn = $derived(hasDoc && !!app.layout && app.panelsIn('bottom').length > 0);
  const trayOpen = $derived(!!app.layout?.trayOpen);
  const trayTip = $derived(trayOn ? `${trayOpen ? 'Hide' : 'Show'} the bottom tray (${app.panelsIn('bottom').map((x) => x.title).join(', ')})` : '');
  // paw-xn04: where the active axis's file came from (written by Pawscript / changed outside since / another tool / unknown)
  const file = $derived(app.doc.files?.[app.doc.activeAxis]);
  const origin = $derived.by(() => {
    if (!file?.raw) return null;
    const info = readProvenance(file.raw), proj = app.project?.path ? app.project.path.split(/[\\/]/).pop() : null;
    return { label: originLabel(info), text: `${file.path.split(/[\\/]/).pop()}: ${originText(info, { project: proj })}`, kind: info.kind };
  });
</script>

<StatusBar class="sb">
  {#if xform}<StatusItem icon={xfIcon} tone="accent" tip={xfTip}><span class="k-num xform">{xform}</span></StatusItem>{/if}
  {#if hint && !xform}<StatusItem icon="pointer" tip="What a click and a drag do here" data-testid="status-hint">{hint}</StatusItem>{/if}
  {#if hasDoc && !xform && !hint}
    {#if app.doc.media}
      <StatusItem icon="film" tone={app.doc.media.isVfr ? 'warn' : 'neutral'} tip={app.doc.media.isVfr ? 'Variable frame rate, steps use real frame times' : 'Video'}><span class="k-num">{app.doc.media.width && app.doc.media.height ? `${app.doc.media.width}×${app.doc.media.height} · ` : ''}{fps ? +fps.toFixed(3) + ' fps ' : ''}{app.doc.media.isVfr ? 'VFR' : 'CFR'}</span></StatusItem>
    {/if}
    <StatusItem icon="stroke" tip="Active axis (Alt+↑/↓ switches)" data-command={app.commands.get('lanes.nextLane') ? 'lanes.nextLane' : 'axis.next'} onclick={() => app.commands.run(app.commands.get('lanes.nextLane') ? 'lanes.nextLane' : 'axis.next')}>{app.doc.activeAxis} <span class="k-num">· {n.toLocaleString()} points</span></StatusItem>
    {#if origin}<StatusItem icon="file" tone={origin.kind === 'changed' ? 'warn' : 'neutral'} tip={origin.text} data-testid="status-origin">{origin.label}</StatusItem>{/if}
    {#if selN}<StatusItem icon="select" tone="accent" tip="Selected points"><span class="k-num">{selN.toLocaleString()} selected</span></StatusItem>{/if}
    {#if app.doc.range}<StatusItem icon="ruler" tip="Range (I/O), click to zoom to it" data-command="view.fitRange" onclick={() => app.commands.run('view.fitRange')}><span class="k-num">{fmtSpan(app.doc.range.t0, app.doc.range.t1)} ({fmtDuration(app.doc.range.t1 - app.doc.range.t0)})</span></StatusItem>{/if}
    {#if p.loop}<StatusItem icon="loop" tone="accent" tip="Loop playback on (Shift+L)" data-command="loop.playToggle" onclick={() => app.commands.run('loop.playToggle')}><span class="k-num">loop {fmtDuration(p.loop.t1 - p.loop.t0)}</span></StatusItem>{/if}
    <StatusItem icon="zoom-fit" tip="Visible span (= / - zoom, Ctrl+0 fits)" data-command="view.fit" onclick={() => app.commands.run('view.fit')}><span class="k-num">{fmtDuration(app.view.span)}</span></StatusItem>
    {#if !app.follow}<StatusItem icon="unlock" tip="Follow playhead is off (Shift+F)" data-command="view.follow" onclick={() => app.commands.run('view.follow')}>no follow</StatusItem>{/if}
  {/if}
  {#snippet middle()}
    {#if trayOn}
      <button type="button" class="tray" data-testid="tray-toggle" aria-pressed={trayOpen} data-command="layout.toggleBottom" onclick={() => app.commands.run('layout.toggleBottom')}
        {@attach tooltip({ text: trayTip, shortcut: app.commands.keysFor('layout.toggleBottom')[0], placement: 'top' })}><Icon name={trayOpen ? 'chevron-down' : 'chevron-up'} size={12} />{trayOpen ? 'Hide' : 'Show'}</button>
    {/if}
  {/snippet}
  {#snippet end()}
  <!-- paw-wfd2.3: degradations (a write that fails, the tracker, the frames, models, the GPU) in one slot -->
  <HealthSlot {app} />
  {#each statuses as s (s.id)}<svelte:boundary onerror={(e) => console.error('[status ' + s.id + ']', e)}><s.component {app} /></svelte:boundary>{/each}
  {#if task}
    <div class="task" {@attach tooltip(app.tasks.map((t) => t.label).join('\n'))}>
      <span>{task.label}{app.tasks.length > 1 ? ` (+${app.tasks.length - 1})` : ''}</span>
      <ProgressBar value={task.total ? task.done / task.total : null} aria-label={task.label} />
      {#if task.cancel}<IconButton icon="close" size="sm" class="x" label="Cancel {task.label}" onclick={() => task.cancel()} />{/if}
    </div>
  {/if}
  {#if (problems?.error || 0) + (problems?.warn || 0)}<StatusItem icon="warning" tone={problems.error ? 'bad' : 'warn'} tip="Problems: {problems.error || 0} errors, {problems.warn || 0} warnings (review)" onclick={() => app.showPanel('review.problems')}><span class="k-num">{(problems.error || 0) + (problems.warn || 0)}</span></StatusItem>{/if}
  {#if problems?.planner}<StatusItem icon="info" tip="Moves the device planner reshapes" onclick={() => app.showPanel('review.problems')}><span class="k-num">{problems.planner} planner</span></StatusItem>{/if}
  {#if app.sidecar === 'busy'}<StatusItem icon="dot" tone="accent" tip="Tracker">tracker busy</StatusItem>{/if}
  <StatusItem icon="info" tip="Shortcuts for what you're doing ({app.commands.keysFor('palette.help')[0] || 'F1'})" aria-label="Keyboard shortcuts" data-testid="status-help" data-command="palette.help" onclick={() => app.commands.run('palette.help')} />
  {/snippet}
</StatusBar>

<style>
  .task { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-2); color: var(--tx-val); }
  .task :global(.k-progress-bar) { width: 90px; }
  .tray { display: inline-flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-5); color: var(--tx-mut); font-size: var(--fs-1); text-transform: uppercase; letter-spacing: .06em; border-left: 1px solid var(--line-1); border-right: 1px solid var(--line-1); }
  .tray:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .tray[aria-pressed='true'] { color: var(--tx-val); }
</style>
