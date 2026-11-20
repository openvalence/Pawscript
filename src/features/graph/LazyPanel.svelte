<!--
  LazyPanel: the Graph panel's entry (panel.js). The editor UI (GraphPanel and everything it imports) is a
  separate chunk loaded when the tab first opens, so it is not parsed at startup. The engine and the controller
  stay in the startup chunk (commands need them).
-->
<script>
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import Spinner from '../../ui/kit/Spinner.svelte';

  let { app } = $props();
  const load = import('./GraphPanel.svelte');
</script>

{#await load}
  <div class="glazy"><Spinner label="Loading the graph editor" /></div>
{:then m}
  <m.default {app} />
{:catch e}
  <EmptyState icon="warning" title="Graph editor unavailable" description={String(e?.message || e)} />
{/await}

<style>
  .glazy { display: grid; place-items: center; width: 100%; height: 100%; }
</style>
