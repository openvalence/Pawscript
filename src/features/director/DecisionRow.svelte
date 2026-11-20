<!-- DecisionRow: one decision in the Director panel's trace: thumbnail, value summary, confidence (amber below tau),
     brain and status, the verify mark, rationale, tool calls, and Re-decide / Ask me / Show frames. Click = seek. -->
<script>
  import { summary, badgeOf } from './panel-logic.js';
  import { cmd } from '../../app/cmd.js';
  import { Badge, IconButton, Menu, tooltip } from '../../ui/kit/index.js';

  let { D, rec } = $props();
  const app = D.app;
  const tau = $derived(D.settings.override?.[rec.kind]?.tau ?? D.L.POLICY?.[rec.kind]?.tau ?? 0.8);
  const conf = $derived(Math.max(0, Math.min(1, +rec.conf || 0)));
  const t = $derived(rec.inputs?.frames?.[0]?.t ?? rec.scope?.t0 ?? 0);
  const TONE = { decided: 'ok', replayed: 'ok', user: 'accent', provisional: 'warn', queued: 'warn', fallback: 'bad', abstain: 'neutral' };
  let open = $state(false), anchor = $state();
  const items = $derived([
    ...D.chainFor(rec.kind).filter((b) => b !== 'user').map((b) => ({ label: `Re-decide with ${b}`, run: () => D.redecide(rec.id, { brain: b }) })),
    { label: 'Re-decide (whole chain)', run: () => D.redecide(rec.id) },
  ]);
  const seek = (ms) => { app.player.pause?.(); app.player.seek(ms); };
  const s1 = (ms) => (ms / 1000).toFixed(1);
  function thumb(ms) {
    return (canvas) => {
      D.tick;   // redraw when a frame arrives
      const g = canvas.getContext('2d'), b = D.thumb(ms);
      if (!g) return;
      if (b) g.drawImage(b, 0, 0, canvas.width, canvas.height);
      else { g.fillStyle = 'rgba(128,128,128,.15)'; g.fillRect(0, 0, canvas.width, canvas.height); }
    };
  }
</script>

<div class="row" data-status={rec.status} data-kind={rec.kind} data-id={rec.id}>
  <button type="button" class="th" onclick={() => seek(t)} aria-label={'Seek to ' + s1(t) + ' s'}>
    <canvas width="64" height="36" {@attach thumb(t)}></canvas>
  </button>
  <div class="main">
    <div class="top">
      <button type="button" class="sum" onclick={() => seek(rec.scope?.t0 ?? 0)} {@attach tooltip(rec.question)}>{summary(rec.kind, rec.value)}</button>
      <span class="scope k-num">{rec.scope ? `${s1(rec.scope.t0)}–${s1(rec.scope.t1)}` : ''}</span>
    </div>
    <div class="meta">
      <span class="bar" {@attach tooltip(`${conf.toFixed(2)} (tau ${tau.toFixed(2)})${rec.calibrated ? '' : ' · uncal.'}`)}><span class="fill" class:low={conf < tau} style="width:{conf * 100}%"></span></span>
      <span class="k-num cf">{conf.toFixed(2)}{rec.calibrated ? '' : ' uncal.'}</span>
      <span {@attach tooltip('Brain: ' + rec.brain)}><Badge tone="info">{badgeOf(rec.brain)}</Badge></span>
      <Badge tone={TONE[rec.status] || 'neutral'}>{rec.status}</Badge>
      {#if rec.attempt}<Badge tone="warn">redo {rec.attempt}</Badge>{/if}
      {#if rec.verifiedBy}<span class="ok" {@attach tooltip('Verified by ' + rec.verifiedBy)}>✓</span>{/if}
      <span class="sp"></span>
      <span bind:this={anchor}><IconButton size="sm" icon="refresh" label="Re-decide" disabled={D.running} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)} /></span>
      <Menu bind:open {anchor} {items} />
      {#if rec.kind !== 'depth'}<IconButton size="sm" icon="help" label="Ask me (send this decision to you)" {...cmd(D.app, 'director.redecide', { id: rec.id, brain: 'user' }, { tip: 'Ask me (send this decision to you)' })} disabled={D.running} />{/if}
    </div>
    {#if rec.rationale}<div class="why">{rec.rationale}</div>{/if}
    {#if rec.tools?.length}<div class="tools k-num">{rec.tools.map((x) => `${x.call.tool} ${Math.round(x.ms)} ms`).join(' · ')}</div>{/if}
    {#if rec.supersedes}
      <details class="old"><summary>earlier: {summary(rec.kind, rec.supersedes.value)} ({rec.supersedes.brain})</summary>
        {#if rec.supersedes.rationale}<div class="why">{rec.supersedes.rationale}</div>{/if}
      </details>
    {/if}
  </div>
</div>

<style>
  .row { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: var(--bw) solid var(--line-1); align-items: start; }
  .row[data-status='queued'], .row[data-status='provisional'] { background: rgba(var(--reality-rgb), .04); }
  .th { padding: 0; border: 0; background: none; cursor: pointer; line-height: 0; }
  canvas { width: 64px; height: 36px; border: var(--bw) solid var(--line-1); }
  .main { min-width: 0; display: grid; gap: var(--space-1); }
  .top { display: flex; gap: var(--space-3); align-items: baseline; min-width: 0; }
  .sum { all: unset; cursor: pointer; color: var(--tx-hi); font-size: var(--fs-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .sum:focus-visible { outline: var(--focus-ring, 2px solid var(--accent)); }
  .scope { color: var(--tx-mut); font-size: var(--fs-1); flex: none; }
  .meta { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  .bar { width: 56px; height: 4px; background: var(--line-1); display: inline-block; flex: none; }
  .fill { display: block; height: 100%; background: var(--ok-ink); }
  .fill.low { background: var(--warn-ink); }
  .cf { color: var(--tx-mut); font-size: var(--fs-1); }
  .ok { color: var(--ok-ink); font-size: var(--fs-2); }
  .why { color: var(--tx-mut); font-size: var(--fs-1); line-height: var(--lh); overflow-wrap: anywhere; }
  .tools { color: var(--tx-mut); font-size: var(--fs-1); }
  .old { color: var(--tx-mut); font-size: var(--fs-1); }
  .old summary { cursor: pointer; }
  .sp { flex: 1; }
</style>
