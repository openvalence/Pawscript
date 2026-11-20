<script>
  // paw-ee14: the app was closed while the project was being written (writing.svelte.js closeApp): what is being written,
  // a bar for a large write, Cancel = stay in the app (the write goes on). The window closes by itself when it is done.
  import Button from '../ui/kit/Button.svelte';
  import ProgressBar from '../ui/kit/ProgressBar.svelte';
  import { writing, cancelClose } from './writing.svelte.js';

  let { app } = $props();
  const MB = 2 ** 20;
  const big = $derived(writing.jobs.find((j) => j.total >= 4 * MB));
</script>

{#if writing.shown}
  <!-- paw-pj8l: modal for the keys too: a key on its Cancel presses Cancel and never reaches the app's key map -->
  <div class="closing" role="alertdialog" aria-modal="true" aria-labelledby="closing-title" data-testid="closing-panel"
       tabindex="-1" onkeydown={(e) => e.stopPropagation()}>
    <div class="card">
      <h2 id="closing-title">Writing your project…</h2>
      {#each writing.jobs as j (j.id)}<p class="what">{j.what}</p>{/each}
      {#if big}
        <ProgressBar value={big.done / big.total} label={`${Math.round(big.done / MB)} of ${Math.round(big.total / MB)} MB`} />
      {:else if !writing.jobs.length}
        <ProgressBar value={null} label="Finishing" />
      {/if}
      <p class="safe">Closing now is safe: the last complete version is kept</p>
      {#if writing.cancelable}
        <div class="row"><Button onclick={() => cancelClose(app)} data-testid="closing-cancel">Cancel</Button></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .closing { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: var(--scrim); }
  .card { width: min(420px, calc(100vw - 32px)); display: grid; gap: var(--space-4); padding: var(--space-6); background: var(--bg-2, var(--bg)); border: var(--bw) solid var(--line-2); border-radius: var(--radius-lg, var(--radius)); box-shadow: var(--shadow-2); }
  h2 { margin: 0; font-size: var(--fs-4); color: var(--tx-hi); }
  .what { margin: 0; font: var(--fs-2) var(--mono); color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .safe { margin: 0; font-size: var(--fs-2); color: var(--tx-mut); }
  .row { display: flex; justify-content: flex-end; }
</style>
