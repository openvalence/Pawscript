<script>
  // The Modifiers row's cumshot controls, inline in its suggestion row (FxLane .sug, after the balls block; cum.svelte.js):
  // on a shot an Orgasm modifier meets (or one that holds proposals) "detect cumshots" runs the tagger over the scene (off with its
  // reason when it cannot: cumWhy); its proposals show as ghost diamonds (strong solid, weak hollow; FxLane drawCum),
  // then "place spurts" puts a spurt on each shown one (one undo step), "all / strong only" hides the weak ones, × drops them.
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cumUi, cumScene, cumPending, cumWhy, cumUses, detectCum, placeCum, clearCum } from './cum.svelte.js';
  import { CUM_STRONG } from '../../lib/cum.js';

  let { app } = $props();
  const c = $derived(cumScene(app));
  const has = $derived(!!c?.scene.cum?.length);
  const todo = $derived(c && has ? cumPending(app, c.i) : []);
  const strong = $derived(todo.filter((p) => p.score >= CUM_STRONG).length);
  const why = $derived(c ? cumWhy(app, { index: c.i }) : null);
  const detect = () => (why?.enabled ? detectCum(app, { index: c.i }) : app.toast(`Detect cumshots: ${why?.reason}`, 'info'));
  const uses = $derived(c ? cumUses(app, { index: c.i }) : null);
  const TIP = 'Run the tagger over this scene and propose one spurt per cumshot (the spurt tags and cum heat rising, new white fluid near the penis, balls pulses when a tracker run has them, the contractions of the pulse groups painted with Groups: an anus, by default). Nothing is placed until you press place spurts';
  const tip = $derived(uses?.text ? `${TIP}.\nThis scene: ${uses.text}${uses.plan.samS ? ' (the orgasm span and a second either side)' : ''}` : `${TIP}.\nThis scene: no pulse group (paint the anus with Groups to add its contractions)`);
</script>

{#if c}
  <span class="cum" role="group" aria-label="Proposed cumshots">
    {#if cumUi.busy}
      <span>detecting cumshots…</span>
    {:else if !has}
      <button class:off={!why.enabled} aria-disabled={!why.enabled} {@attach tooltip(why.enabled ? tip : `Detect cumshots is off: ${why.reason}`)} onclick={detect}>detect cumshots</button>
      {#if !why.enabled}<span class="hint">{why.short}</span>{:else if uses?.text}<span class="hint" data-testid="cum-uses">{uses.text}</span>{/if}
    {:else}
      <span>{todo.length ? `${todo.length} cumshot${todo.length === 1 ? '' : 's'} to place · ${strong} strong` : 'cumshots placed'}</span>
      <button class:on={cumUi.hideWeak} aria-pressed={cumUi.hideWeak} {@attach tooltip(`Hide proposals scoring under ${CUM_STRONG}`)} onclick={() => (cumUi.hideWeak = !cumUi.hideWeak)}>{cumUi.hideWeak ? 'strong only' : 'all'}</button>
      <button class="go" disabled={!todo.length} {@attach tooltip('Place a spurt on each shown diamond')} onclick={() => placeCum(app, c.i)}>place spurts</button>
      <button class:off={!why.enabled} aria-disabled={!why.enabled} {@attach tooltip(why.enabled ? `Detect again, replacing this scene's proposals${uses?.text ? ': ' + uses.text : ''}` : `Detect again is off: ${why.reason}`)} onclick={detect}>↻</button>
      <button aria-label="Drop the proposals" {@attach tooltip('Drop the proposals (placed spurts stay)')} onclick={() => clearCum(app, c.i)}>×</button>
    {/if}
  </span>
{/if}

<style>
  /* inline in FxLane's .sug row: the same look (its styles are scoped there) */
  .cum { display: flex; gap: 2px; margin-left: 4px; }
  .cum span { padding: 0 4px; background: var(--bg); border-radius: var(--radius); }
  .cum span.hint { background: none; padding: 0 2px; }
  .cum button { padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: inherit; }
  .cum button:hover:not(:disabled):not(.off) { background: var(--line-3); color: var(--tx-hi); }
  .cum button:disabled, .cum button.off { opacity: .45; cursor: default; }
  .cum button.on { color: var(--tx-hi); background: var(--line-3); }
  .cum button.go { color: var(--highlight); background: rgba(var(--highlight-rgb), .18); }
  .cum button:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
</style>
