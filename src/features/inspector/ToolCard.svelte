<script>
  // One transform tool, expanded: the kit ParamForm, live ghost preview with before/after stats, Apply buttons.
  import { onDestroy } from 'svelte';
  import './inspector.css';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import ToggleButton from '../../ui/kit/ToggleButton.svelte';
  import Switch from '../../ui/kit/Switch.svelte';
  import Kbd from '../../ui/kit/Kbd.svelte';
  import { inspector as insp } from './state.svelte.js';
  import { computeScope, setPreview } from './actions.js';
  import { previewStats, defaultsFor, kitSchema, FOLLOW } from './logic.js';

  let { app, op } = $props();
  const values = $derived(insp.paramsFor(op));
  const following = $derived(!!op.playhead && !insp.isExplicit(op, op.playhead));
  // the playhead param's default is the playhead itself: no "changed" dot while following, and reset = follow again
  const playMs = $derived(Math.round(app.player?.timeMs ?? 0));
  const schema = $derived(kitSchema(op, { follow: !!op.playhead, playheadMs: playMs }));
  const formValues = $derived(op.playhead ? { ...values, [FOLLOW]: following } : values);

  let selects = $state(-1), stats = $state(null), why = $state(''), err = $state(''), ms = $state(0), scopeLabel = $state('');
  let timer = 0, lastMs = 0;

  function compute() {
    timer = 0;
    if (!insp.previewOn) { setPreview(app, []); stats = null; return; }
    const t = performance.now();
    const { sc, results, error } = computeScope(app, op, values, insp.scope);
    ms = Math.round(performance.now() - t); lastMs = ms;
    scopeLabel = sc.label; why = sc.empty ? sc.why : ''; err = error ?? '';
    if (!results.length) { setPreview(app, []); stats = null; return; }
    if (op.selection) { setPreview(app, []); selects = results[0].ats.length; stats = null; return; }
    selects = -1;
    const per = results.map((r) => ({ ...r, st: previewStats(r.before, r.script) }));
    stats = per.reduce((a, r) => ({
      before: { count: a.before.count + r.st.before.count, maxSpeed: Math.max(a.before.maxSpeed, r.st.before.maxSpeed) },
      after: { count: a.after.count + r.st.after.count, maxSpeed: Math.max(a.after.maxSpeed, r.st.after.maxSpeed) },
      diff: { added: a.diff.added + r.st.diff.added, removed: a.diff.removed + r.st.diff.removed, moved: a.diff.moved + r.st.diff.moved },
      unchanged: a.unchanged && r.st.unchanged,
    }), { before: { count: 0, maxSpeed: 0 }, after: { count: 0, maxSpeed: 0 }, diff: { added: 0, removed: 0, moved: 0 }, unchanged: true });
    setPreview(app, per.filter((r) => !r.st.unchanged).map((r) => ({ axis: r.axis, script: r.script })));
  }

  // Throttled (not debounced) so the ghost follows a scrub; the gap adapts to how slow the op is on this script.
  $effect(() => {
    void [values, insp.scope, insp.previewOn];
    const d = app.doc; void [d.axes, d.activeAxis, d.selection, d.range];
    // slow op on a huge script (> 100 ms): trailing debounce so the UI is free while the value is still moving
    if (lastMs > 100) { clearTimeout(timer); timer = setTimeout(compute, 250); } else if (!timer) timer = setTimeout(compute, Math.max(16, lastMs * 2));
  });
  onDestroy(() => { clearTimeout(timer); setPreview(app, []); });

  // ParamForm reports the whole object; only the edited key becomes an explicit (remembered) value.
  function change(next, key) {
    for (const k of key ? [key] : Object.keys(next)) {
      if (k === FOLLOW) { if (next[k]) insp.unsetParam(op, op.playhead); else insp.setParam(op, op.playhead, values[op.playhead]); }
      else if (k === op.playhead && next[k] === playMs && next[k] !== values[k]) insp.unsetParam(op, k);
      else if (k in values && next[k] !== values[k]) insp.setParam(op, k, next[k]);
    }
  }
  function apply(keep) {
    clearTimeout(timer); timer = 0;
    const res = insp.run(op, values);
    if (res.ok && (res.changed || op.selection) && !keep) insp.openId = '';
    else compute();
  }
  const blocked = $derived(!!why || !!err || (!op.selection && (stats?.unchanged ?? false)));
  const fav = $derived(insp.favs.includes(op.id));
  const changedParams = $derived(Object.entries(defaultsFor(op)).some(([k, v]) => values[k] !== v && !(following && k === op.playhead)));
  // The card's own width. Narrow (the right dock goes down to 200 px; ParamForm's side-by-side rows need
  // 260): the form stacks its labels over the controls and Quick action becomes an icon.
  let cw = $state(300);
  const narrow = $derived(cw < 260);
  const addQuick = () => { insp.addQuick(op, values); app.toast?.(`"${op.title}" added to quick actions`, 'info'); };
  const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
  function key(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.target.closest?.('button')) { apply(e.shiftKey); e.stopPropagation(); e.preventDefault(); }
  }
</script>

<!-- Ctrl+Enter inside the card applies it (the card's own keys, not an app shortcut) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="tool" role="group" aria-label={op.title} onkeydown={key} bind:clientWidth={cw} data-testid="tool-{op.id}">
  {#if schema.length}
    <ParamForm {schema} values={formValues} compact={!narrow} collapsible={false} onchange={change} oncommit={() => insp.commitParams()} />
  {:else}
    <p class="pi-note pad">No parameters: applies as is.</p>
  {/if}

  <div class="pv" class:off={!insp.previewOn} aria-live="polite">
    <div class="pvh">
      <Switch size="sm" checked={insp.previewOn} onchange={(v) => insp.setPreviewOn(v)} label="Live preview" />
      {#if insp.previewOn && !why && !err && (stats || selects >= 0)}<span class="k-hint k-num">{scopeLabel} · {ms} ms</span>{/if}
    </div>
    {#if err}<p class="msg pi-bad">{err}</p>
    {:else if why}<p class="msg pi-warn">{why}</p>
    {:else if selects >= 0 && insp.previewOn}
      <p class="msg">Will select <b class="k-num">{selects}</b> point{selects === 1 ? '' : 's'}</p>
    {:else if stats && insp.previewOn}
      <dl class="pi-stats">
        <dt>Points</dt><dd class="k-num wrap"><span class="nw">{stats.before.count} → {stats.after.count}</span> <span class="k-hint nw">{stats.unchanged ? 'no change' : sgn(stats.after.count - stats.before.count)}</span></dd>
        <dt>Max speed</dt><dd class="k-num" class:pi-bad={stats.after.maxSpeed > stats.before.maxSpeed} class:pi-ok={stats.after.maxSpeed < stats.before.maxSpeed}>{stats.before.maxSpeed} → {stats.after.maxSpeed}</dd>
        <dt>Edits</dt><dd class="k-num">+{stats.diff.added} −{stats.diff.removed} ~{stats.diff.moved}</dd>
      </dl>
    {/if}
  </div>

  <div class="pi-row pad acts">
    <Button class="grow" variant="primary" icon="check" disabled={blocked} tip="Apply and close" shortcut="Ctrl+Enter" onclick={() => apply(false)} data-testid="apply">Apply</Button>
    <Button class="grow" disabled={blocked} tip="Apply and keep the tool open" shortcut="Ctrl+Shift+Enter" onclick={() => apply(true)}>Apply, keep open</Button>
  </div>
  <div class="pi-row pad">
    <Button size="sm" variant="ghost" icon="refresh" disabled={!changedParams} onclick={() => insp.reset(op)}>Reset</Button>
    <ToggleButton size="sm" icon="pin" pressed={fav} tip={fav ? 'Unpin from the top of the list' : 'Pin to the top of the list'} onchange={() => insp.toggleFav(op.id)}>{fav ? 'Pinned' : 'Pin'}</ToggleButton>
    <span class="grow"></span>
    {#if narrow}<IconButton size="sm" icon="bolt" label="Add as a quick action" tip="Add these settings as a quick action" onclick={addQuick} />
    {:else}<Button size="sm" variant="ghost" icon="bolt" tip="Add these settings as a quick action" onclick={addQuick}>Quick action</Button>{/if}
  </div>
  <p class="pi-note pad"><Kbd keys="Ctrl+Enter" /> applies from any field.</p>
</div>

<style>
  .tool {
    display: flex; flex-direction: column; gap: var(--space-4);
    margin: var(--space-1) 0 var(--space-4); padding: var(--space-4) 0;
    background: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius);
  }
  .tool > :global(*) { margin-top: 0; }
  .pad { padding: 0 var(--space-4); }
  .pv {
    display: flex; flex-direction: column; gap: var(--space-3);
    margin: 0 var(--space-4); padding: var(--space-3) var(--space-4);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-1); border-radius: var(--radius);
    min-height: calc(var(--ctl-h-sm) + var(--space-3) * 2 + var(--row-h) * 3);
  }
  .pv.off { min-height: 0; }
  .pvh { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--gap); min-height: var(--ctl-h-sm); }
  .msg { margin: 0; font-size: var(--fs-2); }
  /* narrow: "no change" drops under the counts rather than past the edge */
  .pi-stats dd.wrap { white-space: normal; }
  .nw { white-space: nowrap; }
  @container (width < 270px) {
    .acts { flex-direction: column; align-items: stretch; }
    .pi-row.acts > :global(.grow) { flex: none; }
  }
  .msg b { font-weight: 500; color: var(--tx-hi); }
</style>
