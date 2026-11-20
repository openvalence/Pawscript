<script>
  // The quick start page of F1's overlay (paw-kxwz): docs/guide/quick-start.md as the guide has it, keys as key caps.
  import Keys from '../palette/Keys.svelte';
  import { quickStart } from './quickstart.js';

  // a backticked key (the guide's notation, checked against the registry by test/guide-keys.test.mjs) shows as caps
  const KEY = /^((Ctrl|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|Space|Esc|Enter|Delete|[[\],.])$/;
</script>

{#snippet text(parts)}{#each parts as p, i (i)}{#if p.code != null}{#if KEY.test(p.code)}<Keys keys={p.code === 'Esc' ? 'Escape' : p.code} />{:else}<code>{p.code}</code>{/if}{:else if p.b != null}<b>{p.b}</b>{:else}{p.t}{/if}{/each}{/snippet}

<article class="qs" data-testid="quick-start">
  {#each quickStart as b, i (i)}
    {#if b.type === 'h1'}<h3 class="k-caps">{@render text(b.text)}</h3>
    {:else if b.type === 'h2' || b.type === 'h3'}<h4>{@render text(b.text)}</h4>
    {:else if b.type === 'ul' || b.type === 'ol'}
      <svelte:element this={b.type}>{#each b.items as it, j (j)}<li>{@render text(it)}</li>{/each}</svelte:element>
    {:else}<p class:mistake={b.text[0]?.t?.startsWith('Mistake:')}>{@render text(b.text)}</p>{/if}
  {/each}
</article>

<style>
  .qs { max-width: 76ch; margin: 0 auto; color: var(--tx); font-size: var(--fs-2); line-height: 1.55; }
  h3 { margin: 0 0 var(--space-4); color: var(--tx-val); }
  h4 { margin: var(--space-6) 0 var(--space-2); color: var(--tx-hi); font-size: var(--fs-3); font-weight: 500; }
  p, ul, ol { margin: 0 0 var(--space-3); }
  ul, ol { padding-left: 1.4em; }
  li { margin-bottom: 2px; }
  p.mistake { color: var(--tx-mut); border-left: 2px solid var(--warn); padding-left: var(--space-4); }
  code { font: var(--fs-1) var(--mono); padding: 0 3px; border-radius: var(--radius); background: var(--bg-sunken); }
  b { color: var(--tx-hi); font-weight: 500; }
</style>
