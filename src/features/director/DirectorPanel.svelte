<!-- DirectorPanel (right dock): brain preset and thresholds, the agent mailbox, progress and budget, the questions
     waiting for you, the decision trace grouped by scene, and the footer counts with Export trace. Kit only. -->
<script>
  import { directorFor } from './director.svelte.js';
  import { cmd } from '../../app/cmd.js';
  import { groups, footer, ORDER } from './panel-logic.js';
  import DecisionRow from './DecisionRow.svelte';
  import AskCard from './AskCard.svelte';
  import { Button, IconButton, Select, Switch, NumberField, TextField, EmptyState, ProgressBar } from '../../ui/kit/index.js';

  let { app } = $props();
  const D = directorFor(app);
  const PRESETS = [{ value: 'rules', label: 'Rules only' }, { value: 'rules+vlm', label: 'Rules + local VLM' }, { value: 'rules+vlm+agent', label: 'Rules + VLM + agent' }, { value: 'ask', label: 'Ask me everything' }];
  const recs = $derived(D.list);
  const gs = $derived(groups(recs));
  const st = $derived(D.status);
  const p = $derived(D.draft.sidecar);
  let tau = $state(false), now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });
  const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const tauOf = (k) => D.settings.override?.[k]?.tau ?? D.L.POLICY?.[k]?.tau ?? 0.8;
  const setTau = (k, v) => D.setSettings({ override: { [k]: { ...(D.settings.override?.[k] || {}), tau: Math.max(0, Math.min(1, +v)) } } });
  const oldest = $derived(D.agentWaiting.length ? Math.round((now - Math.min(...D.agentWaiting.map((w) => w.since))) / 1000) : 0);
  const B = $derived(D.budget);
</script>

<div class="dp">
  <div class="head">
    <Select size="sm" label="Brains" options={PRESETS} value={D.settings.preset} disabled={D.running} onchange={(v) => D.setSettings({ preset: v })} />
    <Switch size="sm" checked={D.settings.askUser} disabled={D.running} onchange={(on) => D.setSettings({ askUser: on })}>Ask me</Switch>
    <span class="sp"></span>
    {#if D.running}
      <Button size="sm" variant="danger" icon="stop" {...cmd(app, 'director.cancel', undefined, { tip: 'Stop the director' })}>Cancel</Button>
    {:else}
      <Button size="sm" variant="primary" icon="play" {...cmd(app, 'director.run', undefined, { tip: app.doc.media ? 'Run the director (draft in director mode)' : 'Open a video first' })}>Run</Button>
    {/if}
  </div>

  {#if D.running}
    <div class="prog" role="status">
      <span class="k-num">{[st.detail, st.label].filter(Boolean).join(' · ')} · {clock(now - D.startedAt)}</span>
      <ProgressBar value={p?.total > 0 ? p.done / p.total : null} aria-label="Director progress" />
    </div>
  {/if}
  {#if B}<div class="bud k-num">Budget: tracks {B.used.tracks}/{B.tracks} · GPU {Math.round(B.used.gpuS)}/{B.gpuS} s · images {B.used.images}/{B.images}</div>{/if}

  <details class="more" bind:open={tau}>
    <summary>Thresholds and agent</summary>
    <table class="tau">
      <thead><tr><th>decision</th><th>chain</th><th>tau</th></tr></thead>
      <tbody>
        {#each ORDER as k (k)}
          <tr><td>{k}</td><td class="k-num">{D.chainFor(k).join(' → ') || '–'}</td>
            <td><NumberField size="sm" value={tauOf(k)} min={0} max={1} step={0.05} decimals={2} label={'tau ' + k} disabled={D.running} oncommit={(v) => setTau(k, v)} onchange={(v) => setTau(k, v)} /></td></tr>
        {/each}
      </tbody>
    </table>
    <div class="agent">
      <TextField size="sm" full label="Agent mailbox folder" placeholder="Mailbox folder (empty: CDP only)" value={D.settings.agentRoot || ''} onchange={(v) => D.setSettings({ agentRoot: v || null })} />
      <IconButton size="sm" icon="copy" label="Copy the session folder" disabled={!D.mailbox.root()} onclick={() => navigator.clipboard?.writeText(D.mailbox.root() || '')} />
      <Switch size="sm" checked={D.settings.cdp} onchange={(on) => D.setSettings({ cdp: on })}>CDP</Switch>
    </div>
    <p class="note">
      {#if D.agentWaiting.length}Waiting for the agent: {D.agentWaiting.length} request{D.agentWaiting.length > 1 ? 's' : ''} ({oldest} s).{:else}No request waiting for the agent.{/if}
      {#if D.agentLast} Last answer {Math.round((now - D.agentLast.at) / 1000)} s ago ({D.agentLast.id}).{/if}
      {#if D.mailboxError}<span class="err"> Mailbox: {D.mailboxError}</span>{/if}
      {#if D.settings.agentRoot} Frames of this video are written there for the agent; a remote agent sees them.{/if}
    </p>
  </details>

  <div class="body">
    {#if D.queue.length}
      <div class="sec">Waiting for you · {D.queue.length}</div>
      {#each D.queue as req (req.id)}<AskCard {D} {req} />{/each}
    {/if}
    {#if !recs.length}
      <EmptyState icon="wand" title="No decisions yet" description="Run the director: it surveys the camera, writes the story, chooses what to track and compares trackers, judges direction, generates and checks the script. Every decision lands here with its confidence and reasons." />
    {:else}
      {#each gs as g (g.key)}
        <div class="sec">{g.label}</div>
        {#each g.rows as rec (rec.id)}<DecisionRow {D} {rec} />{/each}
      {/each}
    {/if}
  </div>

  <div class="foot">
    <span class="k-num">{footer(recs)}</span>
    <span class="sp"></span>
    <Button size="sm" variant="ghost" icon="export" disabled={!recs.length} onclick={() => app.commands.run('director.exportTrace', { to: 'file' })}>Export trace</Button>
  </div>
</div>

<style>
  .dp { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: var(--fs-2); }
  .head, .foot { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: var(--bw) solid var(--line-1); }
  .foot { border-bottom: 0; border-top: var(--bw) solid var(--line-1); color: var(--tx-mut); font-size: var(--fs-1); }
  .sp { flex: 1; }
  .prog { display: grid; gap: var(--space-1); padding: var(--space-2) var(--space-4); color: var(--tx); font-size: var(--fs-1); border-bottom: var(--bw) solid var(--line-1); }
  .bud { padding: var(--space-2) var(--space-4); color: var(--tx-mut); font-size: var(--fs-1); border-bottom: var(--bw) solid var(--line-1); }
  .more { padding: var(--space-2) var(--space-4); border-bottom: var(--bw) solid var(--line-1); }
  .more summary { cursor: pointer; color: var(--tx-mut); font-size: var(--fs-1); }
  .tau { width: 100%; border-collapse: collapse; margin: var(--space-2) 0; font-size: var(--fs-1); }
  .tau th { text-align: left; color: var(--tx-mut); font-weight: 400; }
  .tau td { padding: 1px var(--space-2) 1px 0; color: var(--tx); }
  .agent { display: flex; gap: var(--space-2); align-items: center; }
  .note { margin: var(--space-2) 0 0; color: var(--tx-mut); font-size: var(--fs-1); line-height: var(--lh); }
  .err { color: var(--bad-ink); }
  .body { flex: 1; min-height: 0; overflow: auto; }
  .sec { position: sticky; top: 0; z-index: 1; padding: var(--space-2) var(--space-4); background: var(--bg-raised); color: var(--tx-mut); font-size: var(--fs-1); letter-spacing: var(--caps-track); text-transform: uppercase; border-bottom: var(--bw) solid var(--line-1); }
</style>
