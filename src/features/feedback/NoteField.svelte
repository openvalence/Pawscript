<script>
  // The feedback note field (paw-dze): one line in the status bar while ` has it open. Enter saves, Esc cancels; every
  // key stays in the field (no app shortcut, Space types a space). A leading ! / ? / + sets the tone (a chip shows it).
  import { feedbackOf } from './feedback.svelte.js';
  import { parseNote } from './feedback.js';

  let { app } = $props();
  const fb = feedbackOf(app);
  let value = $state(''), el = $state(), prev = null;
  const tone = $derived(parseNote(value).tone);

  $effect(() => {
    if (!fb.open || !el) return;
    prev = document.activeElement;
    value = '';
    el.focus();
  });
  function done() {
    value = '';
    const p = prev; prev = null;
    if (p?.isConnected && p !== document.body) p.focus?.({ preventScroll: true });   // back where the owner was
  }
  function key(e) {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); fb.save(value); done(); }
    else if (e.key === 'Escape') { e.preventDefault(); fb.cancel(); done(); }
  }
  // clicked away: an empty field closes, typed text stays until Enter / Esc
  function blur() { if (fb.open && !value.trim()) { fb.cancel(); value = ''; prev = null; } }
</script>

{#if fb.open}
  <div class="note" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
    {#if tone !== 'note'}<span class="tone {tone}">{tone}</span>{/if}
    <input bind:this={el} bind:value onkeydown={key} onkeyup={(e) => e.stopPropagation()} onblur={blur}
      aria-label="Feedback note" placeholder="Feedback note · Enter saves · Esc cancels" spellcheck="false" autocomplete="off" />
  </div>
{/if}

<style>
  .note { display: flex; align-items: center; gap: var(--space-2); width: min(440px, 40vw); }
  input { flex: 1; min-width: 0; height: 20px; padding: 0 var(--space-2); font: inherit; font-size: var(--fs-2); color: var(--tx-hi);
    background: var(--bg-sunken); border: 1px solid var(--accent, var(--reality)); border-radius: var(--radius-1, 3px); outline: none; }
  input::placeholder { color: var(--tx-mut); }
  .tone { font-size: var(--fs-1, 11px); padding: 0 5px; border-radius: var(--radius); color: var(--bg-sunken); background: var(--tx-mut); }
  .tone.bug { background: var(--bad); }
  .tone.confusing { background: var(--warn); }
  .tone.like { background: var(--ok); }
</style>
