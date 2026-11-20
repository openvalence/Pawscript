<!-- CommitDialog (paw-up1r stage 2, the owner's "ctrl S brings up a commit dialog, showing changes since last commit and an
     optional message"): the changes grouped by section (app/history-diff.js), the note field (focused; Enter commits, Esc
     cancels: nothing is lost, the project is written as it changes), Commit / Cancel. All changes in one shot or one scene:
     the commit is for that section ("Commit: Shot 14"). State on app.project (commitDraft), so per document. -->
<script>
  import { Dialog, Button, TextField } from '../../ui/kit/index.js';
  import { scopeLabel } from '../../app/history-diff.js';
  import { bareName } from '../../app/project-history.js';

  let { app } = $props();
  const P = $derived(app.project);
  const dr = $derived(P?.commitDraft);
  let note = $state('');
  $effect(() => { if (!dr) note = ''; });
  const since = $derived(dr?.since ? `since “${bareName(dr.since.note || dr.since.label)}” · ${new Date(dr.since.at).toLocaleString()}` : 'since the project started');
  const title = $derived(dr && !dr.loading && dr.scope?.kind !== 'project' && dr.scope ? `Commit: ${scopeLabel(dr.scope)}` : 'Commit');
  const can = $derived(!!dr && !dr.loading && !(dr.empty && dr.since));
  const go = () => { if (can) P.commit({ note, diff: dr }); };
</script>

<!-- opened once the changes are listed (a few ms; the dialog's first focus then lands in the note field) -->
{#if dr && !dr.loading}
  <Dialog open={true} {title} size="md" class="commit-dialog" onclose={() => P.cancelCommit()} data-testid="commit-dialog">
    <p class="k-hint since">{dr.empty ? 'Nothing changed' : 'Changes'} {since}</p>
    {#if !dr.empty}
      <ul class="groups" data-testid="commit-changes">
        {#each dr.groups as g, i (i)}
          <li><span class="sec">{scopeLabel(g.scope)}</span> <span class="lines">{g.lines.join(', ')}</span></li>
        {/each}
      </ul>
    {/if}
    {#if can}
      <TextField bind:value={note} placeholder="Note (optional)" full data-autofocus="" onenter={go} data-testid="commit-note" />
    {/if}
    {#snippet footer()}
      <Button onclick={() => P.cancelCommit()}>{can ? 'Cancel' : 'Close'}</Button>
      {#if can}<Button variant="primary" onclick={go} data-testid="commit-ok">Commit</Button>{/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .since { margin-bottom: var(--space-4); }
  .groups { list-style: none; margin: 0 0 var(--space-5); padding: 0; display: grid; gap: var(--space-2); max-height: 40vh; overflow: auto; }
  .groups li { line-height: 1.45; color: var(--tx); overflow-wrap: anywhere; }
  .sec { color: var(--tx-hi); font-weight: 600; }
  .sec::after { content: ':'; }
</style>
