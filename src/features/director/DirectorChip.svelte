<!-- DirectorChip: status-bar item while the director runs or waits: "Director · verify · 2 to answer",
     "Director · waiting for agent (12 s)". Click shows the panel. Mounted at boot (status.js), which also creates the
     director: its 'director' project block and draft's director steps exist from the start. -->
<script>
  import { directorFor } from './director.svelte.js';
  import { StatusItem } from '../../ui/kit/index.js';

  let { app } = $props();
  const D = directorFor(app);
  const st = $derived(D.status);
  let now = $state(Date.now());
  $effect(() => { if (!D.agentWaiting.length) return; const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });
  const wait = $derived(D.agentWaiting.length ? Math.round((now - Math.min(...D.agentWaiting.map((w) => w.since))) / 1000) : 0);
</script>

{#if D.running || st.waitingUser || st.waitingAgent}
  <StatusItem icon="wand" tone={st.waitingUser ? 'warn' : 'accent'} tip="Director: show the panel" data-command="director.show" onclick={() => app.commands.run('director.show')}>
    Director{st.step ? ' · ' + st.step : ''}{st.waitingAgent ? ` · waiting for agent (${Math.max(0, wait)} s)` : ''}{st.waitingUser ? ` · ${st.waitingUser} to answer` : ''}
  </StatusItem>
{/if}
