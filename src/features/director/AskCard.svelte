<!-- AskCard: a decision waiting for the user (Director panel, top). The question in plain words, its frames (a blind
     A/B pair for direction / verify, no positions shown), the provisional answer pre-selected, the choices, "Let the
     agent decide" and "Can't tell". Answering re-runs the draft from the decision's step. -->
<script>
  import { cardChoices, summary, badgeOf } from './panel-logic.js';
  import { cmd } from '../../app/cmd.js';
  import { Button, Badge } from '../../ui/kit/index.js';

  let { D, req } = $props();
  const rec = $derived(D.records[req.id]);
  const c = $derived(cardChoices(req, rec?.value));
  const frames = $derived(c.pair || (req.frames || []).slice(0, 4).map((f) => ({ t: f.t, label: (f.t / 1000).toFixed(1) + ' s' })));
  const agent = $derived(D.chainFor(req.kind).includes('agent') && !!D.brains.agent);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let err = $state('');
  function pick(ch) { err = D.answer(req.id, ch.value) || ''; }
  function thumb(ms) {
    return (canvas) => {
      D.tick;
      const g = canvas.getContext('2d'), b = D.thumb(ms);
      if (!g) return;
      if (b) g.drawImage(b, 0, 0, canvas.width, canvas.height);
      else { g.fillStyle = 'rgba(128,128,128,.15)'; g.fillRect(0, 0, canvas.width, canvas.height); }
    };
  }
</script>

<div class="card" role="group" aria-label={'Question: ' + req.id} data-id={req.id}>
  <div class="q">{req.question}</div>
  {#if frames.length}
    <div class="fr">
      {#each frames as f (f.label + f.t)}
        <button type="button" class="f" onclick={() => D.app.player.seek(f.t)} aria-label={'Frame ' + f.label}>
          <canvas width="128" height="72" {@attach thumb(f.t)}></canvas><span class="lb">{f.label}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if rec}
    <div class="prov">Provisional: <b>{summary(req.kind, rec.value)}</b> · {(+rec.conf || 0).toFixed(2)} · <Badge tone="info">{badgeOf(rec.brain)}</Badge></div>
  {/if}
  <div class="ch">
    {#each c.choices as ch (ch.id)}
      <Button size="sm" variant={rec && same(ch.value, rec.value) ? 'primary' : 'default'} onclick={() => pick(ch)}>{ch.label}</Button>
    {/each}
  </div>
  <div class="ch">
    {#if agent}<Button size="sm" variant="ghost" icon="wand" {...cmd(D.app, 'director.redecide', { id: req.id, brain: 'agent' }, { tip: 'Let the agent decide this one' })}>Let the agent decide</Button>{/if}
    <Button size="sm" variant="ghost" onclick={() => D.abstain(req.id)}>Can't tell</Button>
  </div>
  {#if err}<p class="err" role="alert">{err}</p>{/if}
</div>

<style>
  .card { margin: var(--space-3) var(--space-4); padding: var(--space-4); border: var(--bw) solid var(--warn-ink); background: var(--bg-sunken); display: grid; gap: var(--space-3); }
  .q { color: var(--tx-hi); font-size: var(--fs-2); line-height: var(--lh); }
  .fr { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .f { position: relative; padding: 0; border: var(--bw) solid var(--line-2); background: none; cursor: pointer; line-height: 0; }
  .f canvas { width: 128px; height: 72px; }
  .lb { position: absolute; left: 2px; top: 2px; padding: 0 var(--space-1); background: var(--media-scrim); color: var(--on-media); font-size: var(--fs-1); line-height: 1.4; }
  .prov { color: var(--tx-mut); font-size: var(--fs-1); display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  .prov b { color: var(--tx); font-weight: 500; }
  .ch { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .err { margin: 0; color: var(--bad-ink); font-size: var(--fs-1); }
</style>
