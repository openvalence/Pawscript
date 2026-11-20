<!-- DraftDialog: the "Draft script" overlay (modal.js). The eight steps with status, one-line result and time,
     Run / Redo / Skip per step, Run all, Cancel, and the summary with the hand-off buttons. Kit only, tokens only. -->
<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { draftFor } from './draft.svelte.js';
  import { fmtMs } from './logic.js';
  import { Dialog, Button, Icon, Spinner, ProgressBar, Switch, Chip, SegmentedControl } from '../../ui/kit/index.js';

  let { app } = $props();
  const D = draftFor(app);

  const ICON = { idle: 'dot', done: 'check', skipped: 'skip-forward', failed: 'error' };
  const WORD = { idle: 'Not run', running: 'Running', done: 'Done', skipped: 'Skipped', failed: 'Failed' };
  const anyRun = $derived(D.view.some((s) => s.status !== 'idle'));
  const hasFacts = $derived(Object.keys(D.facts).length > 0);

  // director mode: Run all is director.run (its run sets up the session, budget and cancel)
  const runAll = () => (D.mode === 'director' && app.commands.get?.('director.run') ? app.commands.run('director.run') : D.runAll());
  function frac(s) {
    // per-scene steps: k of N scenes plus the current scene's sidecar progress; else the sidecar job's own
    const p = D.sidecar, inner = p?.total > 0 ? Math.min(1, p.done / p.total) : null;
    if (s.progress?.total > 0) return (s.progress.done + (inner ?? 0)) / s.progress.total;
    return inner;
  }
  function line(s) {
    if (s.status === 'running') {
      const p = D.sidecar, pct = p?.total > 0 ? Math.round((p.done / p.total) * 100) + '%' : '';
      return [s.progress?.label, pct].filter(Boolean).join(' · ') || 'Running…';
    }
    return (s.note || (s.status === 'idle' ? '—' : '')) + (s.undone ? ' · undone' : s.stale ? ' · out of date: an earlier step changed' : '');
  }
</script>

<Dialog bind:open={D.show} title="Draft script" size="lg" class="draft-dialog">
  <p class="lead">Scenes, tags, loops, a first plan, a base track without a region, then generate: each step is one undo
    entry and can be re-run on its own. You finish with the questions and the review.</p>
  {#if D.ext}
    <div class="mode"><SegmentedControl size="sm" label="Pipeline" value={D.mode} disabled={D.busy} onchange={(m) => D.setMode(m)}
      options={[{ value: 'rules', label: 'Rules' }, { value: 'director', label: 'Director' }]} /></div>
  {/if}
  {#if D.replaces && !anyRun}<p class="warn"><Icon name="warning" size={14} /> {D.replaces}</p>{/if}

  <ol class="steps" aria-label="Steps">
    {#each D.list as st, i (st.id)}
      {@const s = D.view[i]}
      <li class="step" data-status={s.status} data-stale={s.stale || undefined} aria-current={s.status === 'running' ? 'step' : undefined}>
        <span class="ic" aria-hidden="true">
          {#if s.status === 'running'}<Spinner size={14} />{:else}<Icon name={s.stale ? 'warning' : ICON[s.status]} size={14} />{/if}
        </span>
        <span class="num k-num">{i + 1}</span>
        <div class="main">
          <div class="title">
            <span class="name">{st.title}</span>
            <span class="k-sr">: {WORD[s.status]}{s.stale ? ', out of date' : ''}</span>
            {#if st.id === 'describe'}
              <Switch size="sm" checked={D.describeOn} disabled={D.busy} onchange={(on) => D.setDescribe(on)} aria-label="Describe scenes" />
            {:else if st.id === 'plan'}
              {#if D.timeline}
                <Chip icon="file" removable onremove={() => D.clearTimeline()} disabled={D.busy} label={'Director: ' + D.timeline.name} />
              {:else}
                <Button size="sm" variant="ghost" icon="import" disabled={D.busy} tip="Use a director timeline JSON instead of the rule table" onclick={() => D.pickTimeline()}>Timeline…</Button>
              {/if}
            {/if}
          </div>
          <div class="note" {@attach tooltip(line(s))}>{line(s)}</div>
          {#if s.status === 'running'}<ProgressBar value={frac(s)} aria-label={st.title + ' progress'} />{/if}
        </div>
        <span class="ms k-num">{s.status === 'running' ? '' : fmtMs(s.ms)}</span>
        <span class="acts">
          <Button size="sm" disabled={D.busy} onclick={() => D.run(i)} aria-label={(s.status === 'idle' ? 'Run ' : 'Redo ') + st.title}>{s.status === 'idle' ? 'Run' : 'Redo'}</Button>
          <Button size="sm" variant="ghost" disabled={D.busy || (s.status === 'skipped' && s.user)} onclick={() => D.skip(i)} aria-label={'Skip ' + st.title}>Skip</Button>
        </span>
      </li>
    {/each}
  </ol>

  {#if hasFacts && !D.busy}
    <div class="summary" role="status">
      <Icon name={D.complete ? 'success' : 'info'} size={16} />
      <span>{D.summary}</span>
    </div>
  {/if}

  {#snippet footer({ close })}
    {#if D.busy}
      <Button variant="danger" icon="stop" onclick={() => D.cancel()}>Cancel</Button>
      <Button onclick={() => close('hide')} tip="The steps go on; the status bar shows them">Hide</Button>
    {:else if D.complete}
      <Button variant="ghost" icon="refresh" onclick={runAll}>Run all again</Button>
      <Button onclick={() => D.openReview()}>Open Review</Button>
      <Button onclick={() => close('done')}>Done</Button>
      <Button variant="primary" icon="help" disabled={!D.facts.assist?.questions} onclick={() => D.startAssist()}>Start assist</Button>
    {:else}
      <Button onclick={() => close('close')}>Close</Button>
      <Button variant="primary" icon="play" disabled={!app.doc.media} tip={app.doc.media ? '' : 'Open a video first'} onclick={runAll}>{anyRun ? 'Run the rest' : 'Run all'}</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .lead { margin: 0 0 var(--space-4); color: var(--tx-mut); font-size: var(--fs-2); line-height: var(--lh); }
  .mode { margin: 0 0 var(--space-4); }
  .warn { display: flex; gap: var(--space-3); align-items: flex-start; margin: 0 0 var(--space-4); color: var(--warn-ink); font-size: var(--fs-2); }
  .steps { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-1); }
  .step {
    display: grid; grid-template-columns: 16px 16px minmax(0, 1fr) 64px auto; gap: var(--space-4); align-items: center;
    padding: var(--space-3) var(--space-2); border-bottom: 1px solid var(--line-1); min-height: calc(var(--row-h) * 2);
  }
  .step[data-status='running'] { background: rgba(var(--reality-rgb), .06); }
  .ic { display: grid; place-items: center; color: var(--tx-mut); }
  .step[data-status='done'] .ic { color: var(--ok-ink); }
  .step[data-status='failed'] .ic { color: var(--bad-ink); }
  .step[data-stale] .ic { color: var(--warn-ink); }
  .step[data-status='running'] .ic { color: var(--accent-ink); }
  .num { color: var(--tx-mut); font-size: var(--fs-1); text-align: right; }
  .main { min-width: 0; display: grid; gap: var(--space-1); }
  .title { display: flex; align-items: center; gap: var(--space-4); min-height: var(--ctl-h-sm); }
  .name { color: var(--tx-hi); font-size: var(--fs-3); white-space: nowrap; }
  .note { color: var(--tx-mut); font-size: var(--fs-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .step[data-status='failed'] .note { color: var(--bad-ink); }
  .step[data-status='done'] .note { color: var(--tx); }
  .ms { color: var(--tx-mut); font-size: var(--fs-1); text-align: right; }
  .acts { display: flex; gap: var(--space-2); }
  .summary { display: flex; gap: var(--space-3); align-items: center; margin-top: var(--space-5); padding: var(--space-4); border: 1px solid var(--line-2); background: var(--bg-sunken); color: var(--tx-hi); font-size: var(--fs-3); }
  .summary :global(svg) { color: var(--ok-ink); flex: none; }
</style>
