<!--
  AssistPanel: the queue, docked (right, Track and Review tabs). States at a glance; Enter / double-click on a row
  answers it in the overlay; Start (F6) answers the open ones in order.
-->
<script>
  import { assistFor } from './assist.svelte.js';
  import { cmd } from '../../app/cmd.js';
  import { Button, Badge, VirtualList, EmptyState, Kbd, tooltip } from '../../ui/kit/index.js';

  let { app } = $props();
  const A = $derived(assistFor(app));
  const KIND = { direction: 'Direction', track: 'Track', activity: 'Activity', depth: 'Depth', fallback: 'Fallback' };
  const TONE = { open: 'accent', undone: 'accent', suggested: 'info', flipped: 'warn', kept: 'ok', earlier: 'neutral', skipped: 'neutral', split: 'warn', no: 'bad', retrack: 'warn' };
  const p = $derived(A.progress);
  const key = $derived(app.commands.keysFor('assist.open')?.[0] || 'F6');
  const noDirection = $derived(A.questions.length > 0 && !A.questions.some((q) => q.kind === 'direction'));
  let sel = $state(-1);
  $effect(() => { if (A.open) sel = A.cur; });

  function result(q) {
    const s = A.stateOf(q), a = q.answer;
    if (s === 'open') return q.suggest ? 'suggested' : q.answer && !A.live(q) ? 'undone' : 'open';
    if (s === 'skipped' || s === 'split') return s;
    if (q.memory) return 'earlier';
    if (q.kind === 'direction') return a?.flipped ? 'flipped' : 'kept';
    return a?.choice || 'done';
  }
</script>

<div class="ap">
  <div class="head">
    <span class="n k-num"><b>{p.open}</b> open · {p.done} done · est. <b>+{p.gain.toFixed(2)}</b></span>
    <span class="sp"></span>
    {#if A.stale}<span {@attach tooltip('The script changed since these questions: Regenerate')}><Badge tone="warn">out of date</Badge></span>{/if}
    <Button size="sm" variant={A.stale ? 'default' : 'ghost'} icon="refresh" {...cmd(app, 'assist.regenerate', undefined, { tip: 'Rebuild the questions from the document' })}>Regenerate</Button>
    <Button size="sm" variant="primary" disabled={!p.open} shortcut={key} tip="Answer the open questions" onclick={() => A.show()}>Start</Button>
  </div>
  {#if !A.questions.length}
    <EmptyState icon="help" title="Nothing to ask"
      description="Questions appear for a script with strokes: which way is in, per scene. After a tracking run also whether the track follows the right thing and whether quiet spans continue." />
  {:else}
    {#if noDirection}<p class="note">No strokes on this axis yet: track a shot (it plays live), then Regenerate to check direction and track.</p>{/if}
    <VirtualList class="list" items={A.questions} bind:selected={sel} label="Assist questions" onactivate={(q) => A.show(q.id)}>
      {#snippet row(q)}
        {@const r = result(q)}
        <span class="rw" {@attach tooltip(q.prompt)}>
          <span class="k k-{q.kind}">{KIND[q.kind]}</span>
          <span class="t k-num">{q.label}</span>
          <span class="v k-num">+{q.value.toFixed(3)}</span>
          <Badge tone={TONE[r] || 'ok'}>{r}</Badge>
        </span>
      {/snippet}
    </VirtualList>
    <p class="foot"><Kbd keys="Enter" /> answer the selected row · <Kbd keys={key} /> answer all</p>
  {/if}
</div>

<style>
  .ap { display: flex; flex-direction: column; min-height: 0; height: 100%; font-size: var(--fs-2); }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: var(--bw) solid var(--line-1); }
  .n { white-space: nowrap; color: var(--tx-mut); }   /* narrow: the summary keeps one line, the buttons go under it */ .n b { color: var(--tx-hi); font-weight: 500; }
  .sp { flex: 1; }
  .ap :global(.list) { flex: 1; min-height: 0; }
  .rw { display: grid; grid-template-columns: 64px max-content minmax(0, 1fr) max-content; gap: var(--space-2) var(--space-3); align-items: center; width: 100%; padding: 0 var(--space-4); cursor: default; }
  .rw :global(.k-badge) { justify-self: end; }
  .k { font-size: var(--fs-1); letter-spacing: var(--caps-track); text-transform: uppercase; color: var(--accent-ink); }
  .k-track, .k-fallback { color: var(--intent); } .k-activity { color: var(--ok-ink); } .k-depth { color: var(--tx-mut); }
  .t { font-size: var(--fs-1); color: var(--tx-val); }
  .v { font-size: var(--fs-1); color: var(--tx-mut); overflow: hidden; text-overflow: clip; white-space: nowrap; text-align: right; }   /* narrow: the value gives way first */
  .note { margin: 0; padding: var(--space-3) var(--space-4); color: var(--tx-mut); border-bottom: var(--bw) solid var(--line-1); }
  .foot { margin: 0; padding: var(--space-3) var(--space-4); color: var(--tx-mut); border-top: var(--bw) solid var(--line-1); }
</style>
