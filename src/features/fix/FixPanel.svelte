<!--
  FixPanel: "Fix section". The span a fix works on (I/O range or selected points), where it came from (plan segment
  and the run it follows, else the run that tracked it), the problems inside it, and the five fixes with their keys.
  Every button runs the same command as its key.
-->
<script>
  import { fixUI, info, currentRecipe } from './fix.svelte.js';
  import { recipeChoices } from './logic.js';
  import { fmtTime } from '../inspector/logic.js';
  import { Button, Badge, Select, Kbd, EmptyState } from '../../ui/kit/index.js';

  let { app } = $props();
  const I = $derived(info(app));
  const choices = recipeChoices();
  const ROWS = [
    ['fix.retrack', 'Re-track', 'the tracker followed the wrong thing: draw a new region / axis, track only this span'],
    ['fix.regenerate', 'Regenerate', 'the pattern is wrong: make the span again from the recipe below'],
    ['fix.flip', 'Flip', 'in and out are swapped here (pos 0 = deepest)'],
    ['fix.scale', 'Scale depth', 'strokes too shallow or too deep (about the out end)'],
    ['fix.retime', 'Retime', 'late or early: shift / stretch inside, the seams stay put'],
  ];
  const TONE = { error: 'bad', warn: 'warn', info: 'neutral' };
  let picker = $state();
  $effect(() => { fixUI.shown = true; return () => { fixUI.shown = false; }; });
  $effect(() => { if (fixUI.focusPicker) picker?.querySelector('button')?.focus(); });
  $effect(() => { if (!fixUI.recipe && I) fixUI.recipe = currentRecipe(app); });
</script>

<div class="fx">
  {#if !I}
    <EmptyState icon="wand" title="Nothing to fix yet" description="Set a range with I / O, or select the points of the goofed section; then pick a fix below or press its key." />
  {:else}
    <div class="head k-num">
      <b>{fmtTime(I.r.t0)} – {fmtTime(I.r.t1)}</b> · {((I.r.t1 - I.r.t0) / 1000).toFixed(1)} s · {I.n} points
      {#if fixUI.busy}<Badge tone="info">tracking…</Badge>{/if}
    </div>
    {#if I.sources.length}<p class="src">From: {I.sources.join(' · ')}</p>{/if}
    {#if I.problems.length}
      <ul class="pr">
        {#each I.problems.slice(0, 5) as p (p.id)}<li><Badge tone={TONE[p.severity] || 'neutral'}>{p.severity}</Badge> <span class="k-num">{fmtTime(p.t0)}</span> {p.message}</li>{/each}
        {#if I.problems.length > 5}<li class="more">+{I.problems.length - 5} more</li>{/if}
      </ul>
    {:else}<p class="src">No problems found in this span.</p>{/if}
  {/if}
  <div class="rows">
    {#each ROWS as [id, label, why] (id)}
      {@const keys = app.commands.keysFor(id)?.[0] || ''}
      <div class="row">
        <Button size="sm" disabled={!I || (id === 'fix.retrack' && !app.doc.media)} data-command={id} onclick={() => app.commands.run(id)}>{label}</Button>
        {#if keys}<Kbd {keys} />{/if}
        <span class="why">{why}</span>
      </div>
      {#if id === 'fix.regenerate'}
        <div class="pick" bind:this={picker}><Select size="sm" full options={choices} bind:value={fixUI.recipe} label="Recipe for regenerate" /></div>
      {/if}
    {/each}
  </div>
  {#if fixUI.pending}<p class="src">Re-track waiting: paint the part with Groups (<Kbd keys={app.commands.keysFor('tracking.groups')?.[0] || 'Tab'} />), then press <Kbd keys={app.commands.keysFor('fix.retrack')?.[0] || ''} /> again.</p>{/if}
</div>

<style>
  .fx { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-4); font-size: var(--fs-2); min-height: 100%; box-sizing: border-box; }   /* the area body scrolls it (one thin bar) */
  .head { color: var(--tx-mut); display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
  .head b { color: var(--tx-hi); font-weight: 500; }
  .src { margin: 0; color: var(--tx-mut); font-size: var(--fs-1); }
  .pr { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--fs-1); color: var(--tx-val); }
  .more { color: var(--tx-mut); }
  .rows { display: flex; flex-direction: column; gap: var(--space-2); border-top: var(--bw) solid var(--line-1); padding-top: var(--space-3); }
  .row { display: grid; grid-template-columns: 92px auto; gap: var(--space-1) var(--space-3); align-items: center; justify-content: start; }
  .row :global(.k-btn) { justify-self: stretch; }
  .why { grid-column: 1 / -1; color: var(--tx-mut); font-size: var(--fs-1); }
  .pick { margin-bottom: var(--space-2); }
</style>
