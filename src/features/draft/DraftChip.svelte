<!-- DraftChip: status-bar item while "Draft script" runs: step k/8, its name and the sidecar's progress; click shows the steps. -->
<script>
  import { draftFor } from './draft.svelte.js';
  import { StatusItem } from '../../ui/kit/index.js';

  let { app } = $props();
  const D = draftFor(app);   // app is fixed; this also registers the 'draft' project block at boot (status.js)
  const pct = $derived.by(() => { const p = D.sidecar; return p?.total > 0 ? ' · ' + Math.round((p.done / p.total) * 100) + '%' : ''; });
</script>

{#if D.busy}
  <StatusItem icon="wand" tone="accent" tip="Draft script: show the steps" onclick={() => (D.show = true)}>
    <span class="k-num">Draft {D.running >= 0 ? D.running + 1 : '…'}/{D.list.length}</span>{D.current ? ' · ' + D.current.title : ''}{pct}
  </StatusItem>
{/if}
