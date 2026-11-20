<script>
  import { onDestroy } from 'svelte';
  import './inspector.css';
  import Section from '../../ui/kit/Section.svelte';
  import Field from '../../ui/kit/Field.svelte';
  import NumberField from '../../ui/kit/NumberField.svelte';
  import TextField from '../../ui/kit/TextField.svelte';
  import Slider from '../../ui/kit/Slider.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import EmptyState from '../../ui/kit/EmptyState.svelte';
  import Kbd from '../../ui/kit/Kbd.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { selectionStats, rangeStats, axisStats, pointInfo, fmtTime, parseTime, msToFrame, frameToMs, batchEdit } from './logic.js';
  import { posAt, nearest } from '../../lib/core/script.js';
  import { applyBatch, applyPoint, select, selectRange, setPreview, gesture } from './actions.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  let { app } = $props();
  const doc = $derived(app.doc);
  const EMPTY = new Set();

  const ax = $derived(doc.activeAxis);
  const script = $derived(scriptOf(app, ax));
  const selAts = $derived(doc.selection?.axis === ax ? doc.selection.ats : EMPTY);
  const range = $derived(doc.range);
  const frameMs = $derived(app.player?.frameMs || 1000 / (doc.media?.fps || 30));
  const limit = $derived(app.settings?.get?.('device.maxSpeed') ?? 0);
  const mode = $derived(selAts.size === 1 ? 'one' : selAts.size > 1 ? 'many' : range ? 'range' : 'none');

  const one = $derived(mode === 'one' ? pointInfo(script, [...selAts][0]) : null);
  const stats = $derived(mode === 'many' ? selectionStats(script, selAts) : mode === 'range' ? rangeStats(script, range.t0, range.t1) : null);
  const axStats = $derived(mode === 'none' ? axisStats(script) : null);
  const inRange = $derived(range ? rangeStats(script, range.t0, range.t1).count : 0);
  const playMs = $derived(Math.round(app.player?.timeMs ?? 0));
  const axes = $derived(Object.keys(doc.axes));
  // paw-xn04: where the axis's file came from (its metadata.pawscript, else the tool / creator it names)
  const file = $derived(doc.files?.[ax]);
  const origin = $derived(file?.raw && app.project?.originOf ? app.project.originOf(file.raw) : '');

  const speedCls = (v) => (v != null && limit && v > limit ? 'pi-bad' : '');
  const sp = (v) => (v == null ? '–' : v);
  const nearestTxt = $derived.by(() => {
    if (!script.length) return '–';
    const i = nearest(script, playMs);
    return i < 0 ? '–' : `${script[i].at - playMs >= 0 ? '+' : '−'}${Math.abs(script[i].at - playMs)} ms`;
  });

  // ---- single point: each scrub / held key / typed value is ONE undo entry ----
  const lo = $derived(one?.prevAt != null ? one.prevAt + 1 : 0);
  const hi = $derived(one?.nextAt != null ? one.nextAt - 1 : Infinity);
  const edit = (() => gesture(app))(); // app is fixed for the panel's life
  const setAt = (v) => edit.step('Move point', (o) => applyPoint(app, one.at, { at: Math.min(hi, Math.max(lo, v)) }, o));
  const setPos = (v) => edit.step('Set point position', (o) => applyPoint(app, one.at, { pos: v }, o));
  // A scrub that ends where it started fires no oncommit: close the gesture at the end of the pointer / key too.
  const endKey = (e) => { if (/^(Arrow|Page)/.test(e.key)) edit.end(); };
  onDestroy(() => edit.end());

  // Unparseable text stays in the field, marked invalid, until it is fixed or Esc reverts it.
  let tcText = $state(''), tcBad = $state(false);
  $effect(() => { tcText = one ? fmtTime(one.at) : ''; tcBad = false; });
  function tcSubmit(text) {
    const v = parseTime(text, { fps: 1000 / frameMs, base: one.at });
    if (!Number.isFinite(v)) { tcBad = true; app.toast?.('Not a time: try 1:23.456, 83.4s or f120', 'warn'); return; }
    tcBad = false;
    applyPoint(app, one.at, { at: Math.min(hi, Math.max(lo, v)) });
    tcText = fmtTime(one.at);
  }
  function tcKey(e) { // Esc reverts typed text here instead of reaching the app's "clear selection"
    if (e.key === 'Escape' && one && tcText !== fmtTime(one.at)) { tcText = fmtTime(one.at); tcBad = false; e.stopPropagation(); }
  }
  // Esc in a field with nothing to revert hands focus back to the panel; the next Esc (from the panel) reaches
  // the app and clears the selection. Fields that revert typed text stop the first Esc themselves.
  let root = $state();
  function escKey(e) { if (e.key === 'Escape' && e.target?.matches?.('input')) { e.stopPropagation(); root?.focus(); } }
  // the dock runs 200-680 px: below 300 px the batch labels stack over their fields
  let pw = $state(330);
  const narrow = $derived(pw < 300);
  const neighbour = (at) => { if (at != null) { select(app, ax, [at]); app.player?.seek?.(at); } };

  // ---- batch ----
  const NEUTRAL = { set: 50, offset: 0, scale: 100, shift: 0, tscale: 100 };
  let draft = $state({ ...NEUTRAL }), touched = $state('');
  const rows = [
    { k: 'set', label: 'Set position', min: 0, max: 100, unit: '%', btn: 'Set' },
    { k: 'offset', label: 'Offset position', min: -100, max: 100, unit: '', btn: 'Apply' },
    { k: 'scale', label: 'Scale position', min: 0, max: 300, unit: '%', btn: 'Apply' },
    { k: 'shift', label: 'Shift time', min: -5000, max: 5000, unit: 'ms', btn: 'Apply' },
    { k: 'tscale', label: 'Scale time', min: 10, max: 400, unit: '%', btn: 'Apply' },
  ];
  const isNeutral = (k) => k !== 'set' && draft[k] === NEUTRAL[k];
  const effAts = $derived(selAts.size ? selAts : range ? new Set(script.filter((a) => a.at >= range.t0 && a.at <= range.t1).map((a) => a.at)) : EMPTY);

  // Ghost preview of the batch field being edited (throttled; gap adapts to cost).
  let timer = 0, lastMs = 0;
  function pv() {
    timer = 0;
    if (!touched || (mode !== 'many' && mode !== 'range') || (touched !== 'set' && isNeutral(touched))) { setPreview(app, []); return; }
    const t = performance.now();
    const r = batchEdit(script, effAts, touched, draft[touched]);
    setPreview(app, [{ axis: ax, script: r.script }]);
    lastMs = performance.now() - t;
  }
  $effect(() => { void [draft, touched, mode, script, effAts]; if (!timer) timer = setTimeout(pv, Math.min(300, Math.max(16, lastMs * 2))); });
  onDestroy(() => { clearTimeout(timer); setPreview(app, []); });
  $effect(() => { if (mode === 'one' || mode === 'none') touched = ''; });

  const canApply = (k) => !!stats?.count && !isNeutral(k);
  // Enter (or Ctrl+Enter, as in a tool card) in a batch field applies that row. The field commits its typed
  // text on the same keydown before it bubbles here.
  function rowKey(e, k) {
    if (e.key !== 'Enter' || e.isComposing || e.target.closest?.('button')) return;
    e.preventDefault(); e.stopPropagation();
    if (canApply(k)) applyRow(k);
  }
  function applyRow(k) {
    clearTimeout(timer); timer = 0;
    applyBatch(app, k, draft[k]);
    draft = { ...draft, [k]: NEUTRAL[k] }; touched = '';
    setPreview(app, []);
  }
  const setAxis = (id) => (app.setActiveAxis ? app.setActiveAxis(id) : (doc.activeAxis = id));
</script>

{#snippet clear()}<IconButton icon="close" size="sm" label="Clear selection" shortcut="Escape" onclick={() => select(app, ax, [])} />{/snippet}
{#snippet speed(v)}<dd class="k-num {speedCls(v)}">{sp(v)}{#if v != null}{' '}<span class="k-hint">pos/s</span>{/if}</dd>{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (the focus target for Esc; keys bubble from the fields) -->
<div class="pi" bind:this={root} bind:clientWidth={pw} tabindex="-1" onkeydown={escKey} role="region" aria-label="Inspector">
  <div class="pi-scroll k-scroll">
    {#if mode === 'one' && one}
      <Section title="Point · {ax}" count="#{one.i + 1}" actions={clear}>
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions (gesture ends bubble up from the fields) -->
        <div class="grid" onpointerup={edit.end} onkeyup={endKey} onfocusout={edit.end} role="group" aria-label="Point">
          <Field label="Time">
            {#snippet children(f)}<NumberField id={f.id} full unit="ms" value={one.at} min={lo} max={hi} step={1} onchange={setAt} oncommit={edit.end} data-testid="pt-time" />{/snippet}
          </Field>
          <Field label="Timecode">
            {#snippet children(f)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="cell" onkeydown={tcKey}><TextField id={f.id} full bind:value={tcText} invalid={tcBad} oninput={() => (tcBad = false)} onchange={tcSubmit} class="k-num" data-testid="pt-tc" /></div>
            {/snippet}
          </Field>
          <Field label="Frame">
            {#snippet children(f)}<NumberField id={f.id} full value={msToFrame(one.at, frameMs)} min={msToFrame(lo, frameMs)} max={Number.isFinite(hi) ? msToFrame(hi, frameMs) : Infinity}
              onchange={(n) => setAt(frameToMs(n, frameMs))} oncommit={edit.end} data-testid="pt-frame" />{/snippet}
          </Field>
          <Field label="Position">
            <!-- one widget: drag the track, or click the number and type (paw-m3b6) -->
            {#snippet children(f)}<Slider id={f.id} full label="Position" value={one.pos} min={0} max={100} ticks={[0, 25, 50, 75, 100]} showValue format={(v) => `${v} %`}
              onchange={setPos} oncommit={edit.end} data-testid="pt-pos" />{/snippet}
          </Field>
        </div>
        <div class="pi-row pnav">
          <IconButton icon="skip-back" variant="default" label="Previous point" disabled={one.prevAt == null} onclick={() => neighbour(one.prevAt)} />
          <IconButton icon="skip-forward" variant="default" label="Next point" disabled={one.nextAt == null} onclick={() => neighbour(one.nextAt)} />
          <Button class="grow" icon="arrow-right" tip="Move the playhead to this point" onclick={() => app.player?.seek?.(one.at)}>Seek</Button>
          <Button class="grow" icon="marker" tip="Move this point to the playhead" disabled={playMs === one.at} onclick={() => applyPoint(app, one.at, { at: playMs })}>To playhead</Button>
        </div>
      </Section>
      <Section title="Speed">
        <dl class="pi-stats">
          <dt>In (from previous)</dt>{@render speed(one.speedIn)}
          <dt>Out (to next)</dt>{@render speed(one.speedOut)}
        </dl>
        {#if limit}<p class="pi-note">Device limit {limit} pos/s</p>{/if}
      </Section>
    {:else if stats}
      <Section title="{mode === 'range' ? 'Range' : 'Selection'} · {ax}" count={stats.count} actions={mode === 'many' ? clear : undefined}>
        <dl class="pi-stats">
          <dt>From</dt><dd class="k-num">{fmtTime(mode === 'range' ? range.t0 : stats.t0)}</dd>
          <dt>To</dt><dd class="k-num">{fmtTime(mode === 'range' ? range.t1 : stats.t1)}</dd>
          <dt>Span</dt><dd class="k-num">{fmtTime(mode === 'range' ? range.t1 - range.t0 : stats.span)}</dd>
          <dt>Strokes/min</dt><dd class="k-num">{stats.spm}</dd>
          <dt>Position range</dt><dd class="k-num">{stats.posMin}–{stats.posMax}</dd>
          <dt>Mean position</dt><dd class="k-num">{stats.posMean}</dd>
          <dt>Peak speed</dt>{@render speed(stats.peakSpeed)}
        </dl>
        <div class="pos-track" aria-hidden="true"><i style="left:{stats.posMin}%; width:{Math.max(1, stats.posMax - stats.posMin)}%"></i><b style="left:{stats.posMean}%"></b></div>
        {#if mode === 'range'}
          <div class="pi-row"><Button variant="primary" full icon="select" disabled={!stats.count} onclick={() => selectRange(app)}>Select {stats.count} points</Button></div>
          <div class="pi-row">
            <Button class="grow" icon="loop-in" onclick={() => app.player?.seek?.(range.t0)}>Go to start</Button>
            <Button class="grow" icon="loop-out" onclick={() => app.player?.seek?.(range.t1)}>Go to end</Button>
          </div>
        {:else if range}
          <div class="pi-row"><Button full icon="select" onclick={() => selectRange(app)}>Select all in range ({inRange})</Button></div>
        {/if}
        {#if mode === 'many' && app.commands?.get?.('playback.preview')}
          <div class="pi-row"><Button full icon="device" disabled={!app.commands.enabled('playback.preview')} shortcut={app.commands.keysFor('playback.preview')[0] || ''}
            tip={app.commands.enabled('playback.preview') ? 'Play these points once on the device' : 'Connect a device first (Device panel)'} data-command="playback.preview" onclick={() => app.commands.run('playback.preview')}>Test on device</Button></div>
        {/if}
      </Section>
      <Section title="Batch edit">
        <div class="batch">
          {#each rows as r (r.k)}
            <Field inline={!narrow} label={r.label}>
              {#snippet children(f)}
                <!-- svelte-ignore a11y_no_static_element_interactions (Enter bubbles up from the field) -->
                <div class="brow" onkeydown={(e) => rowKey(e, r.k)}>
                  <NumberField id={f.id} full value={draft[r.k]} min={r.min} max={r.max} unit={r.unit}
                    onchange={(v) => { draft = { ...draft, [r.k]: v }; touched = r.k; }} data-testid="batch-{r.k}" />
                  <Button disabled={!canApply(r.k)} onclick={() => applyRow(r.k)} data-testid="apply-{r.k}">{r.btn}</Button>
                </div>
              {/snippet}
            </Field>
          {/each}
        </div>
        <p class="pi-note">Drag a field to scrub; the ghost previews the result. <Kbd keys="Enter" /> in a field applies its row. Each {mode === 'range' ? 'apply acts on the points in range and' : 'apply'} is one undo step.</p>
      </Section>
    {:else if axStats}
      <Section title="Axis · {ax}" count={axStats.count}>
        {#if axStats.count}
          <dl class="pi-stats">
            <dt>Length</dt><dd class="k-num">{fmtTime(axStats.duration)}</dd>
            <dt>Strokes/min</dt><dd class="k-num">{axStats.spm}</dd>
            <dt>Position range</dt><dd class="k-num">{axStats.posMin}–{axStats.posMax}</dd>
            <dt>Mean position</dt><dd class="k-num">{axStats.posMean}</dd>
            <dt>Peak speed</dt>{@render speed(axStats.peakSpeed)}
            <dt>Peak at</dt><dd class="k-num">{fmtTime(axStats.peakAt)}</dd>
            {#if origin}<dt>File</dt><dd class="origin" data-testid="script-origin" {@attach tooltip(file.path)}>{origin}</dd>{/if}
          </dl>
        {:else}
          <EmptyState icon="stroke" title="No points yet">
            <p class="pi-note">Press <Kbd keys="0" />–<Kbd keys="9" /> at the playhead to add one.</p>
          </EmptyState>
        {/if}
      </Section>
      <Section title="Playhead">
        <dl class="pi-stats">
          <dt>Time</dt><dd class="k-num">{fmtTime(playMs)}</dd>
          <dt>Frame</dt><dd class="k-num">{msToFrame(playMs, frameMs)}</dd>
          <dt>Position</dt><dd class="k-num">{script.length ? Math.round(posAt(script, playMs)) : '–'}</dd>
          <dt>Nearest point</dt><dd class="k-num">{nearestTxt}</dd>
        </dl>
        <p class="pi-note">Select points in a lane, or set a range (<Kbd keys="I" /> / <Kbd keys="O" />), to inspect and edit them here.</p>
      </Section>
    {/if}
    {#if axes.length > 1}
      <Section title="Axes" count={axes.length}>
        {#if axes.length <= 4}
          <SegmentedControl full label="Active axis" value={ax} onchange={setAxis}
            options={axes.map((id) => ({ value: id, label: id, tip: `${scriptOf(app, id).length} points` }))} />
        {:else}
          <Select full label="Active axis" value={ax} onchange={setAxis}
            options={axes.map((id) => ({ value: id, label: id, hint: `${scriptOf(app, id).length}` }))} />
        {/if}
      </Section>
    {/if}
  </div>
</div>

<style>
  /* minmax(0, …): a 1fr track's automatic minimum would let a field's content widen the panel */
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4) var(--gap); }
  /* Seek / To playhead share the row from their own widths (labels of unequal length), still ending flush */
  .pi-row.pnav > :global(.grow) { flex-basis: auto; }
  /* narrow: one column of fields; "To playhead" wraps under prev / next / Seek instead of ellipsizing */
  @container (width < 270px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .pnav { flex-wrap: wrap; row-gap: var(--space-4); }
    .pi-row.pnav > :global(.grow) { flex-basis: 40%; }
  }
  .origin { overflow-wrap: anywhere; }
  .cell { width: 100%; }
  .batch { display: flex; flex-direction: column; gap: var(--gap); }
  /* the button column fits its label at every density; the min-width keeps Set and Apply one width */
  .brow { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: var(--gap); width: 100%; }
  .brow > :global(.k-button) { min-width: calc(var(--ctl-h) * 2.2); }
  .pos-track { position: relative; height: var(--space-3); margin-top: var(--space-4); background: var(--bg-sunken); border: var(--bw) solid var(--line-1); border-radius: var(--radius); }
  .pos-track i { position: absolute; top: 0; bottom: 0; background: rgba(var(--reality-rgb), .45); }
  .pos-track b { position: absolute; top: calc(var(--space-1) * -1); bottom: calc(var(--space-1) * -1); width: 2px; margin-left: -1px; background: var(--tx-hi); }
</style>
