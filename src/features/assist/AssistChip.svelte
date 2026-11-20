<!-- AssistChip: "N questions" in the status bar while open questions exist; click (or F6) opens the overlay. -->
<script>
  import { assistFor } from './assist.svelte.js';
  import { StatusItem } from '../../ui/kit/index.js';

  let { app } = $props();
  const A = $derived(assistFor(app));
  const n = $derived(A.openCount);
</script>

{#if n}
  <StatusItem icon="help" tone="accent" tip="Answer them ({app.commands.keysFor('assist.open')?.[0] || 'F6'})" onclick={() => A.show()}>{n} question{n === 1 ? '' : 's'}</StatusItem>
{/if}
