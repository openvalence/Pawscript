<script>
  // The Plan panel: generate (scope + Generate), the kinds palette (click / drag onto the plan lane), the
  // inspector for the selection, the segment list with states and compile issues, import / export.
  // Chrome is the kit's; the only local pieces are the kind glyphs (kinds.js paths) and the paste box.
  import {
    Icon, Button, IconButton, ToggleButton, SegmentedControl, Chip, Kbd, Section, VirtualList, tooltip,
  } from '../../ui/kit/index.js';
  import { tl, listOf } from './state.svelte.js';
  import { KINDS, kindOf } from './kinds.js';
  import { setKind, segState, recipeLabel } from './plan.js';
  import { clickSelect, liveSel } from './plan-edit.js';
  import { stateCounts, issuesById } from './generate-logic.js';
  import { generate, editPlan, onCompile, ensurePreview, previewOn, togglePreview, importPlan, importFile, exportPlan } from './generate.js';
  import PlanInspector from './PlanInspector.svelte';
  import { fmtClock } from './ticks.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  ensurePreview(app);

  const plan = $derived(listOf(app, 'plan'));
  const sorted = $derived([...plan].sort((a, b) => a.t0 - b.t0));
  const sel = $derived(liveSel(plan, tl.segs));
  const selSet = $derived(new Set(sel));
  const focusId = $derived(sel[0] ?? null);
  const counts = $derived(stateCounts(plan));
  const needed = $derived(counts.new + counts.stale);
  const preview = $derived(previewOn(app));
  const keyOf = (cmd) => app.commands.keysFor(cmd)?.[0] || '';

  let compile = $state.raw({ issues: [], ms: 0, from: '' });
  $effect(() => onCompile((l) => { compile = { ...l }; }));
  const byId = $derived(issuesById(compile.issues));

  // ---- generate: one button, the scope beside it ----
  let scope = $state('needed');
  const targets = $derived(scope === 'needed' ? needed : scope === 'selected' ? sel.filter((id) => !plan.find((s) => s.id === id)?.locked).length : plan.length - counts.locked);
  const SCOPE_TIP = {
    needed: 'New and stale segments (Generate: ' + (keyOf('timeline.plan.generate') || '–') + ')',
    selected: 'The selected segments',
    all: 'Every unlocked segment (' + (keyOf('timeline.plan.generateAll') || '–') + ')',
  };
  const scopes = $derived([
    { value: 'needed', label: 'Needed', tip: SCOPE_TIP.needed },
    { value: 'selected', label: 'Selected', tip: SCOPE_TIP.selected, disabled: !sel.length },
    { value: 'all', label: 'All', tip: SCOPE_TIP.all },
  ]);
  $effect(() => { if (scope === 'selected' && !sel.length) scope = 'needed'; });

  // ---- kinds palette ----
  // With a selection a chip sets its kind (a click target); without one it arms the kind for drawing (a toggle:
  // clicking the armed chip disarms, so the kit Chip's own toggle and tl.armedKind agree).
  function chipClick(kind) {
    if (sel.length) editPlan(app, 'Segment kind', (p) => setKind(p, sel, kind));
    else tl.armedKind = tl.armedKind === kind ? 'main' : kind;
  }
  function dragKind(e, kind) {
    e.dataTransfer.setData('application/x-pawscript-kind', kind);
    e.dataTransfer.effectAllowed = 'copy';
  }
  const short = (k) => (k.id === 'idle' ? 'Idle' : k.id === 'offscreen' ? 'Off-screen' : k.id === 'afterglow' ? 'Afterglow' : k.label.split(/[/(]/)[0].trim());

  // ---- segment list: VirtualList's single cursor = the last clicked row; the multi-selection is tl.segs ----
  let cursor = $state(-1);
  let anchor = null;
  $effect(() => {
    const cur = sorted[cursor]?.id;
    if (focusId && !selSet.has(cur)) cursor = sorted.findIndex((s) => s.id === focusId);
    else if (!focusId && cursor >= 0) cursor = -1;
  });
  function rowSelect(s, i, e) {
    const mode = e?.shiftKey ? 'extend' : e?.ctrlKey || e?.metaKey ? 'toggle' : 'replace';
    const r = clickSelect(plan, sel, anchor ?? s.id, s.id, mode);
    tl.segs = r.sel; anchor = r.anchor; cursor = i;
    if (mode === 'replace') app.player.seek(s.t0);
  }
  const STATE_TIP = { new: 'New: never generated', fresh: 'Fresh: generated', stale: 'Stale: edited since generated', locked: 'Locked: Generate skips it' };
  const LIST_ROWS = 11;

  // ---- import / export ----
  let mode = $state('replace');
  let pasting = $state(false);
  let pasted = $state('');
  let warnings = $state.raw([]);
  let importError = $state('');
  async function run(fn) {
    importError = '';
    try { const r = await fn(); if (r) { warnings = r.warnings; pasting = false; pasted = ''; } }
    catch (e) { importError = String(e?.message || e); }
  }
  const exp = (what, to) => exportPlan(app, what, to).catch((e) => app.toast(`Export failed: ${e?.message || e}`, 'error'));

  // the inspect command: bring the inspector into view
  let inspEl = $state(null);
  $effect(() => {
    const on = () => { inspEl?.scrollIntoView({ block: 'nearest' }); inspEl?.querySelector('[aria-checked="true"], button, input')?.focus(); };
    window.addEventListener('pawscript:plan-inspect', on);
    return () => window.removeEventListener('pawscript:plan-inspect', on);
  });
</script>

<div class="pp">
  <div class="bar">
    <SegmentedControl size="sm" full label="Generate scope" bind:value={scope} options={scopes} />
    <Button variant="primary" icon="wand" size="sm" disabled={!targets} shortcut={scope === 'all' ? keyOf('timeline.plan.generateAll') : keyOf('timeline.plan.generate')}
      tip={targets ? `Generate ${targets} segment${targets === 1 ? '' : 's'} into the active axis` : scope === 'needed' ? 'Every segment is up to date' : 'Nothing to generate'}
      onclick={() => generate(app, scope)}>Generate{targets ? ` ${targets}` : ''}</Button>
  </div>
  <div class="counts k-num" aria-live="polite">
    {#if plan.length}
      <span>{plan.length} segment{plan.length === 1 ? '' : 's'}</span>
      {#if counts.new}<span class="c-new">{counts.new} new</span>{/if}
      {#if counts.stale}<span class="c-stale">{counts.stale} stale</span>{/if}
      {#if counts.locked}<span>{counts.locked} locked</span>{/if}
      {#if counts.fresh}<span class="c-fresh">{counts.fresh} fresh</span>{/if}
    {:else}
      <span>No plan yet: draw segments in the plan lane, or import a timeline.</span>
    {/if}
    <span class="grow"></span>
    {#if compile.from}<span class="ms" {@attach tooltip(`Last ${compile.from} compile`)}>{compile.ms.toFixed(0)} ms</span>{/if}
    <ToggleButton size="sm" icon={preview ? 'eye' : 'eye-off'} pressed={preview} label="Plan preview" shortcut={keyOf('timeline.plan.preview')}
      tip={preview ? 'Preview each segment\'s motion on its block' : 'Preview off'}
      onclick={() => togglePreview(app)} />
  </div>

  <Section title="Kinds">
    <div class="palette">
      {#each KINDS as k (k.id)}
        <Chip class="kchip" style="--kc: {k.css}" draggable="true" ondragstart={(e) => dragKind(e, k.id)}
          selected={sel.length ? undefined : tl.armedKind === k.id} onclick={() => chipClick(k.id)} label={k.label}
          {@attach tooltip(sel.length ? `Set the selection to ${k.label}` : `${k.label}: drag onto the Plan row, or click to draw`, k.key ?? undefined)}>
          <span class="kc">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={k.icon} stroke-dasharray={k.dash ? '3 2.5' : undefined} /></svg>
            <span class="kl">{short(k)}</span>
            {#if k.key}<Kbd keys={k.key} />{/if}
          </span>
        </Chip>
      {/each}
    </div>
  </Section>

  <div class="insp" bind:this={inspEl}>
    {#if focusId}
      <PlanInspector {app} id={focusId} />
    {:else}
      <p class="hint">Select a segment in the plan lane or the list below to edit it.</p>
    {/if}
  </div>

  <Section title="Segments" count={plan.length || ''}>
    {#if byId.get('')?.length}
      <ul class="issues">{#each byId.get('') as i, n (n)}<li class={i.level}>{i.msg}</li>{/each}</ul>
    {/if}
    <div class="list" style:--n={Math.min(Math.max(sorted.length, 1), LIST_ROWS)}>
      <VirtualList items={sorted} selected={cursor} label="Plan segments" onselect={rowSelect} onactivate={(s) => app.player.seek(s.t0)}>
        {#snippet row(s)}
          {@const k = kindOf(s.kind)}
          {@const st = segState(s)}
          {@const iss = byId.get(s.id)}
          <span class="seg" class:on={selSet.has(s.id)} style:--kc={k.css}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d={k.icon} stroke-dasharray={k.dash ? '3 2.5' : undefined} /></svg>
            <span class="sn">{s.name || k.label}<span class="sr">{recipeLabel(s.recipe)}</span></span>
            <span class="st k-num">{fmtClock(s.t0)}</span>
            {#if iss}
              <span class="iss" class:error={iss.some((i) => i.level === 'error')} {@attach tooltip(iss.map((i) => i.msg).join('\n'))}>
                <Icon name={iss.some((i) => i.level === 'error') ? 'error' : 'warning'} size={14} />
              </span>
            {:else}<span></span>{/if}
            <span class="dot d-{st}" {@attach tooltip(STATE_TIP[st])}>{#if st === 'locked'}<Icon name="lock" size={12} />{/if}</span>
          </span>
        {/snippet}
      </VirtualList>
    </div>
  </Section>

  <Section title="Import / export" open={false}>
    <div class="io">
      <div class="io-row">
        <span class="lbl">Import</span>
        <SegmentedControl size="sm" label="Import mode" bind:value={mode} options={[{ value: 'replace', label: 'Replace' }, { value: 'merge', label: 'Into gaps' }]} />
      </div>
      <div class="io-row btns">
        <Button size="sm" icon="folder" onclick={() => run(() => importFile(app, mode))}>File…</Button>
        <Button size="sm" icon="paste" pressed={pasting} onclick={() => { pasting = !pasting; importError = ''; }}>Paste…</Button>
      </div>
      {#if pasting}
        <!-- the kit has no multi-line field; this one takes the field look from the tokens -->
        <textarea class="paste k-num" bind:value={pasted} rows="5" spellcheck="false" aria-label="Timeline JSON"
          placeholder={'[{"start_ms":0,"end_ms":8000,"kind":"idle"}, …]'}></textarea>
        <div class="io-row btns">
          <Button size="sm" variant="primary" disabled={!pasted.trim()} onclick={() => run(() => importPlan(app, pasted, mode))}>Import</Button>
          <Button size="sm" variant="ghost" onclick={() => { pasting = false; pasted = ''; importError = ''; }}>Cancel</Button>
        </div>
      {/if}
      {#if importError}<p class="err">{importError}</p>{/if}
      {#if warnings.length}
        <ul class="issues">{#each warnings as w, n (n)}<li class="warn">{w}</li>{/each}</ul>
      {/if}
      <div class="io-row">
        <span class="lbl" {@attach tooltip('The Director\'s segment list')}>Director JSON</span>
        <span class="btns">
          <Button size="sm" icon="export" disabled={!plan.length} onclick={() => exp('director', 'file')}>File…</Button>
          <IconButton size="sm" icon="copy" disabled={!plan.length} label="Copy director JSON" onclick={() => exp('director', 'clipboard')} />
        </span>
      </div>
      <div class="io-row">
        <span class="lbl" {@attach tooltip('Spans with a state: active, idle, carry, climax, orgasm')}>Tracking spans</span>
        <span class="btns">
          <Button size="sm" icon="export" disabled={!plan.length} onclick={() => exp('spans', 'file')}>File…</Button>
          <IconButton size="sm" icon="copy" disabled={!plan.length} label="Copy spans" onclick={() => exp('spans', 'clipboard')} />
        </span>
      </div>
    </div>
  </Section>
</div>

<style>
  /* flush in the dock like the kit's Sections: own rows take the Section body inset (--space-4) */
  .pp { display: flex; flex-direction: column; min-width: 0; }
  .bar { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: var(--space-2); margin: var(--space-3) var(--space-4) var(--space-1); }
  /* the scope takes the row; when its labels would not fit beside Generate (comfortable density) it wraps */
  .bar > :global(.k-segmented-control) { flex: 1 1 calc(var(--ctl-h) * 7.5); min-width: 0; }
  .insp { border-top: var(--bw) solid var(--line-1); border-bottom: var(--bw) solid var(--line-1); padding-top: var(--space-3); }
  .insp > .hint { margin: 0 var(--space-4) var(--space-3); }
  .grow { flex: 1; }
  .counts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); font-size: var(--fs-1); color: var(--tx-mut); min-height: var(--ctl-h-sm); margin: 0 var(--space-4) var(--space-2); }
  .c-new { color: var(--info-ink); }
  .c-stale { color: var(--warn-ink); }
  .c-fresh { color: var(--ok-ink); }
  .ms { color: var(--tx-mut); }
  .hint { font-size: var(--fs-2); color: var(--tx-mut); margin: 0; }
  .lbl { font-size: var(--fs-ui); font-weight: 500; letter-spacing: .02em; color: var(--tx-mut); text-transform: var(--label-case); white-space: nowrap; }

  /* kind glyphs: the kinds.js paths, stroke only, in the kind's series token */
  svg { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--kc); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

  /* palette: kit Chips stretched to a grid cell, glyph + name + digit key */
  .palette { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--ctl-h) * 5), 1fr)); gap: var(--space-1); }
  .palette :global(.kchip) { min-width: 0; cursor: grab; }
  .palette :global(.kchip:active) { cursor: grabbing; }
  .palette :global(.kchip .main) { width: 100%; justify-content: flex-start; }
  .palette :global(.kchip .k-chip-label) { flex: 1; min-width: 0; }
  .kc { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  /* compact chips are shorter than a key cap: the digit then lives in the tooltip only */
  :global([data-density='compact']) .kc :global(.k-kbd) { display: none; }
  .kl { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }

  /* segment list */
  .list { height: calc(var(--row-h) * var(--n)); margin: 0 calc(-1 * var(--space-2)); }
  .list :global(.k-virtual-list) { height: 100%; }
  .seg {
    flex: 1; min-width: 0; height: 100%; display: grid; grid-template-columns: 14px minmax(0, 1fr) auto 14px 12px;
    align-items: center; gap: var(--space-2); padding: 0 var(--space-2); border-left: 2px solid transparent; font-size: var(--fs-ui);
  }
  .seg.on { background: var(--sel-bg); border-left-color: var(--kc); color: var(--tx-hi); }
  .sn { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .sr { color: var(--tx-mut); margin-left: var(--space-3); font-size: var(--fs-1); }
  .st { font-size: var(--fs-1); color: var(--tx-val); }
  .iss { display: grid; place-items: center; color: var(--warn-ink); }
  .iss.error { color: var(--bad-ink); }
  .dot { width: 12px; height: 12px; display: grid; place-items: center; color: var(--tx-mut); }
  .dot::before { content: ''; width: var(--space-3); height: var(--space-3); border-radius: 50%; }
  .d-new::before { background: var(--info); }
  .d-fresh::before { background: var(--ok); opacity: .55; }
  .d-stale::before { background: var(--warn); }
  .d-locked::before { display: none; }

  .issues { list-style: none; margin: 0 0 var(--space-2); padding: 0; display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--fs-1); }
  .issues li { color: var(--warn-ink); }
  .issues li.error { color: var(--bad-ink); }

  /* import / export */
  .io { display: flex; flex-direction: column; gap: var(--space-2); }
  .io-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .btns { display: flex; gap: var(--space-1); justify-content: flex-end; }
  .io-row.btns { justify-content: flex-start; }
  .paste {
    width: 100%; box-sizing: border-box; resize: vertical; min-height: calc(var(--ctl-h) * 3); padding: var(--space-2);
    background: var(--bg-sunken); color: var(--tx-val); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius);
    box-shadow: var(--recess); font-size: var(--fs-1);
  }
  .paste:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); color: var(--tx-hi); }
  .err { margin: 0; font-size: var(--fs-1); color: var(--bad-ink); }
</style>
