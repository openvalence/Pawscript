<!-- EntriesPanel: the open project's history (paw-up1r stage 2), newest first: commits, publishes and the automatic
     checkpoints (after a track, before a discard, on close, before clean, before going back), each with its time, kind,
     note, section and what changed since the entry before it (app/history-diff.js, stored in .pawhistory/index.json).
     Per entry: go back (one undo step, the present checkpointed first), go back in its section only (a shot / scene
     commit), compare (its script as a ghost over the current one), note (rename / annotate inline), delete. -->
<script>
  import { IconButton, Button, Select, TextField, EmptyState, Badge } from '../../ui/kit/index.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { scopeLabel, changesText, summaryText } from '../../app/history-diff.js';
  import { kindOf } from '../../app/project-history.js';
  import { publishState } from './publish-state.js';

  let { app } = $props();
  const P = $derived(app.project);
  const list = $derived(P?.checkpoints || []);
  const pub = $derived(publishState(app));
  const runIds = $derived(new Set((app.doc.ghosts || []).filter((g) => g.source?.kind === 'tracker' || g.source?.kind === 'modrun').map((g) => g.id)));
  const keys = (id) => app.commands.keysFor(id)[0] || '';
  let filter = $state('all'), editing = $state(''), draft = $state(''), noteEl = $state();
  $effect(() => { if (editing && noteEl) noteEl.focus(); });
  const scopes = $derived([...new Map(list.filter((c) => c.scope).map((c) => [scopeLabel(c.scope), c.scope])).keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  const options = $derived([{ value: 'all', label: 'Everything' }, { value: 'commits', label: 'Commits and publishes' }, ...scopes.map((s) => ({ value: 's:' + s, label: s }))]);
  const shown = $derived(list.filter((c) => filter === 'all' || (filter === 'commits' ? kindOf(c) !== 'auto' : c.scope && 's:' + scopeLabel(c.scope) === filter)));
  const WORD = { auto: 'Auto', commit: 'Commit', publish: 'Published' };
  const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const gone = (c) => (c.sum?.runs || []).filter((id) => !runIds.has(id)).length;
  function edit(c) { editing = c.id; draft = c.note || ''; }
  async function save(c) { const n = draft; editing = ''; if (n !== (c.note || '')) await P.annotateCheckpoint(c.id, n); }
  const go = (c, section = false) => P.restoreCheckpoint(c.id, { section });
</script>

<div class="eh" data-testid="history-entries">
  <div class="bar">
    <span class="state k-num" data-testid="history-published">{pub?.text || ''}</span>
    <Button size="sm" data-command="file.save" onclick={() => app.commands.run('file.save')} shortcut={keys('file.save')} disabled={!P?.hasDoc}>Commit…</Button>
    <Button size="sm" variant="primary" icon="upload" data-command="file.publish" onclick={() => app.commands.run('file.publish')} shortcut={keys('file.publish')} disabled={!app.commands.enabled('file.publish')}>Publish</Button>
  </div>
  {#if list.length}
    <div class="bar"><Select size="sm" {options} bind:value={filter} label="Show" full /></div>
    <ol class="rows">
      {#each shown as c (c.id)}
        {@const k = kindOf(c)}
        {@const n = gone(c)}
        <li class="row" data-kind={k} data-testid="history-entry" data-id={c.id}>
          <div class="top">
            <Badge tone={k === 'publish' ? 'accent' : k === 'commit' ? 'ok' : 'neutral'}>{k === 'publish' && c.version ? `v${c.version}` : WORD[k]}</Badge>
            {#if c.scope}<span class="scope">{scopeLabel(c.scope)}</span>{/if}
            <span class="when k-num">{when(c.at)}</span>
          </div>
          {#if editing === c.id}
            <TextField size="sm" bind:value={draft} bind:inputEl={noteEl} placeholder="Note" full onenter={() => save(c)} onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = ''; } }} onblur={() => save(c)} data-testid="history-note" />
          {:else}
            <button type="button" class="name" onclick={() => edit(c)} {@attach tooltip('Click to write a note')}>{c.note || c.label}{#if c.note && c.label !== 'Commit'}<span class="k-hint"> · {c.label}</span>{/if}</button>
          {/if}
          {#if c.changes?.length || c.sum}<p class="sum k-hint">{c.changes?.length ? changesText(c.changes) : 'No change'}{c.sum ? ` · ${summaryText(c.sum)}` : ''}</p>{/if}
          {#if n}<p class="sum warn" {@attach tooltip('Going back restores their points, not their frames')}>{n} of its runs {n === 1 ? 'is' : 'are'} no longer in the project</p>{/if}
          <div class="acts">
            <IconButton icon="undo" size="sm" label="Go back to this" tip="Go back to this, the present is kept as a checkpoint" onclick={() => go(c)} data-testid="history-restore" />
            {#if c.scope}<IconButton icon="target" size="sm" label="Go back in {scopeLabel(c.scope)} only" tip="Go back to this in {scopeLabel(c.scope)} only: nothing outside it changes" onclick={() => go(c, true)} data-testid="history-restore-section" />{/if}
            <IconButton icon="ghost" size="sm" label="Compare" tip={P.comparing === c.id ? 'Hide the comparison' : 'Show its script as a ghost over the current one'} aria-pressed={P.comparing === c.id} onclick={() => P.compareCheckpoint(c.id)} data-testid="history-compare" />
            <IconButton icon="pen" size="sm" label="Note" tip="Rename / annotate" onclick={() => edit(c)} />
            <IconButton icon="trash" size="sm" label="Delete" tip={k === 'publish' ? `Delete this entry, v${c.version} stays published` : 'Delete this entry'} onclick={() => P.deleteCheckpoint(c.id)} data-testid="history-delete" />
          </div>
        </li>
      {/each}
    </ol>
  {:else}
    <EmptyState icon="history" title="No history yet" description="Commit (Ctrl+S) names a point to come back to; checkpoints are also taken after a track, before a run is discarded and on close." />
  {/if}
</div>

<style>
  .eh { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line-1); }
  .state { flex: 1; min-width: 0; color: var(--tx-val); font-size: var(--fs-2); line-height: 1.3; }
  .rows { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; min-height: 0; }
  .row { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--line-1); display: grid; gap: var(--space-2); }
  .row[data-kind='auto'] .name { color: var(--tx); }
  .top { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-1); }
  .scope { color: var(--tx-val); }
  .when { margin-left: auto; color: var(--tx-mut); }
  .name { text-align: left; color: var(--tx-hi); font-size: var(--fs-2); overflow-wrap: anywhere; }
  .name:hover { text-decoration: underline; }
  .sum { margin: 0; font-size: var(--fs-1); overflow-wrap: anywhere; }
  .warn { color: var(--warn-ink, var(--tx-mut)); }
  .acts { display: flex; gap: var(--space-1); }
</style>
