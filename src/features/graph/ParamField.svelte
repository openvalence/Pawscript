<!--
  ParamField: the control for ONE node param, from its schema (kit params.js dialect plus the graph's `editor`
  hint, lib/graph README §3). Standard types use kit controls (NumberField scrub, Switch, Select /
  SegmentedControl via paramform.js controlOf); `editor` picks a custom widget: axis / ghost / run / channel
  pickers (ctl.sources.list), kinds (chips), kindTable (rows per plan kind), expr (live parse errors with the
  column), script / spans (JSON with validation), shape, color. `compact` is the node-card form.
  onchange(value, commit): commit=false while scrubbing (one gesture), true when the edit is done.
-->
<script>
  import { tooltip } from '../../ui/kit/tooltip.js';
  import NumberField from '../../ui/kit/NumberField.svelte';
  import Switch from '../../ui/kit/Switch.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import ColorSwatch from '../../ui/kit/ColorSwatch.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import { choiceList, stepOf } from '../../ui/kit/params.js';
  import { controlOf } from '../../ui/kit/paramform.js';
  import { KINDS, kindOf } from '../timeline/kinds.js';
  import { SHAPE_NAMES } from '../../lib/gen/shapes.js';
  import { checkExpr } from '../../lib/graph/nodes/expr.js';

  let { p, value, values = {}, sources = null, compact = false, label = '', onchange } = $props();

  const size = $derived(compact ? 'sm' : 'md');
  const ed = $derived(p.editor || '');
  const num = $derived(['number', 'float', 'int'].includes(p.type));
  const list = (kind, ref) => { try { return sources?.list?.(kind, ref) || []; } catch { return []; } };
  /** Picker options from the document, keeping a stored value that is not there any more. */
  function pick(kind, ref) {
    const opts = list(kind, ref).map((o) => ({ value: o.id, label: o.name || o.id, hint: o.detail }));
    if (value && !opts.some((o) => o.value === value)) opts.unshift({ value, label: `${value} (missing)` });
    return opts;
  }
  const AXIS_IDS = ['stroke', 'roll', 'pitch', 'twist', 'surge', 'sway', 'vib', 'valve', 'suck', 'lube'];
  const axisOpts = $derived.by(() => {
    const have = list('axis').map((o) => o.id);
    const ids = [...new Set([...have, ...AXIS_IDS, ...(value ? [value] : [])])];
    return ids.map((id) => ({ value: id, label: id, hint: have.includes(id) ? '' : 'new' }));
  });
  const kindIds = $derived([...new Set([...KINDS.map((k) => k.id), ...list('kind').map((k) => k.id)])]);

  // ---- expr ----
  let exprText = $state(null);
  const exprErr = $derived(ed === 'expr' ? checkExpr(exprText ?? String(value ?? '')) : '');
  // ---- json (script / spans / list / json) ----
  let jsonText = $state(null), jsonErr = $state('');
  const jsonShown = $derived(jsonText ?? JSON.stringify(value ?? null, null, value && typeof value === 'object' && JSON.stringify(value).length > 60 ? 1 : 0));
  function commitJson(text) {
    let v;
    try { v = JSON.parse(text); } catch (e) { jsonErr = e.message.replace(/^JSON\.parse: /, ''); return; }
    if (ed === 'script' && !(Array.isArray(v) && v.every((a) => Number.isFinite(a?.at) && Number.isFinite(a?.pos)))) { jsonErr = 'expected [{"at": ms, "pos": 0..100}, …]'; return; }
    if (ed === 'spans' && !(Array.isArray(v) && v.every((s) => Number.isFinite(s?.t0) && Number.isFinite(s?.t1)))) { jsonErr = 'expected [{"t0": ms, "t1": ms, "kind"?: …}, …]'; return; }
    jsonErr = ''; jsonText = null;
    onchange?.(v, true);
  }
  const isPair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number');
  // ---- kindTable ----
  const table = $derived(value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  const pairTable = $derived(Object.values(table).some(isPair) || (p.default && Object.values(p.default).some(isPair)));
  function setRow(kind, v, commit) { onchange?.({ ...table, [kind]: v }, commit); }
  function dropRow(kind) { const t = { ...table }; delete t[kind]; onchange?.(t, true); }
  function addRow(kind) { setRow(kind, pairTable ? (isPair(values.default) ? [...values.default] : [10, 90]) : (typeof values.default === 'number' ? values.default : 0), true); }
  // ---- kinds ----
  const kinds = $derived(Array.isArray(value) ? value : []);
  function toggleKind(k) { onchange?.(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k], true); }
</script>

{#if ed === 'axis'}
  <Select {size} options={axisOpts} {value} label={label || p.label} full onchange={(v) => onchange?.(v, true)} />
{:else if ed === 'ghost' || ed === 'run'}
  {@const opts = pick(ed)}
  <!-- nothing resolves '' to a source (the node errors "pick a …"), so empty is a placeholder, never an option -->
  <Select {size} options={opts} {value} label={label || p.label} full invalid={!value} placeholder={opts.length ? 'Pick one…' : `No ${ed}s in this document`}
          onchange={(v) => onchange?.(v, true)} />
{:else if ed === 'channel'}
  {@const opts = pick('channel', values.run)}
  {#if opts.length}
    <Select {size} options={opts} {value} label={label || p.label} full onchange={(v) => onchange?.(v, true)} />
  {:else}
    <input class="gtext" class:sm={compact} value={value ?? ''} aria-label={label || p.label} onchange={(e) => onchange?.(e.currentTarget.value, true)} />
  {/if}
{:else if ed === 'shape'}
  <Select {size} options={SHAPE_NAMES.map((s) => ({ value: s, label: s }))} {value} label={label || p.label} full onchange={(v) => onchange?.(v, true)} />
{:else if ed === 'color'}
  <ColorSwatch {value} label={label || p.label} showName={!compact} size={size} onchange={(v) => onchange?.(v, true)} />
{:else if ed === 'expr'}
  <div class="gexpr">
    <input class="gtext k-num" class:sm={compact} class:bad={!!exprErr} value={exprText ?? value ?? ''} spellcheck="false" aria-label={label || p.label}
           aria-invalid={!!exprErr} oninput={(e) => (exprText = e.currentTarget.value)}
           onchange={(e) => { if (!checkExpr(e.currentTarget.value)) { onchange?.(e.currentTarget.value, true); exprText = null; } }} />
    {#if exprErr && !compact}<span class="gerr" role="alert">{exprErr}</span>{/if}
  </div>
{:else if ed === 'kinds'}
  {#if compact}
    <span class="gkinds-sum" {@attach tooltip(kinds.join(', ') || 'all kinds')}>{kinds.length ? kinds.map((k) => kindOf(k).label).join(', ') : 'all'}</span>
  {:else}
    <div class="gkinds" role="group" aria-label={label || p.label}>
      {#each kindIds as k (k)}
        {@const kd = kindOf(k)}
        <button type="button" class="gkind" aria-pressed={kinds.includes(k)} style:--kc={kd.color} onclick={() => toggleKind(k)}>{kd.label}</button>
      {/each}
    </div>
  {/if}
{:else if ed === 'kindTable'}
  {#if compact}
    <span class="gkinds-sum">{Object.keys(table).length} kinds</span>
  {:else}
    <div class="gktab">
      {#each kindIds as k (k)}
        {@const kd = kindOf(k)}
        {@const v = table[k]}
        <div class="gkrow" data-on={v != null ? '' : null} data-pair={isPair(v) ? '' : null}>
          <span class="gkname" style:--kc={kd.color}><i></i>{kd.label}</span>
          {#if v == null}
            <button type="button" class="gadd" onclick={() => addRow(k)} aria-label={`Set a value for ${kd.label}`}><Icon name="plus" size={12} /></button>
          {:else if isPair(v)}
            <NumberField size="sm" value={v[0]} min={0} max={100} step={1} label={`${kd.label} deep end`} onchange={(x) => setRow(k, [x, v[1]], false)} oncommit={(x) => setRow(k, [x, v[1]], true)} />
            <NumberField size="sm" value={v[1]} min={0} max={100} step={1} label={`${kd.label} out end`} onchange={(x) => setRow(k, [v[0], x], false)} oncommit={(x) => setRow(k, [v[0], x], true)} />
            <button type="button" class="gadd" onclick={() => dropRow(k)} aria-label={`Remove ${kd.label}`}><Icon name="x" size={12} /></button>
          {:else}
            <NumberField size="sm" value={+v || 0} step={0.01} label={`${kd.label} value`} onchange={(x) => setRow(k, x, false)} oncommit={(x) => setRow(k, x, true)} />
            <button type="button" class="gadd" onclick={() => dropRow(k)} aria-label={`Remove ${kd.label}`}><Icon name="x" size={12} /></button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{:else if num}
  <NumberField {size} {value} min={p.min ?? -Infinity} max={p.max ?? Infinity} step={stepOf(p)} unit={p.unit || ''} label={label || p.label} full={!compact}
               class={compact ? 'gnum' : ''} onchange={(v) => onchange?.(v, false)} oncommit={(v) => onchange?.(v, true)} />
{:else if p.type === 'bool'}
  <Switch size={size} checked={!!value} aria-label={label || p.label} onchange={(v) => onchange?.(v, true)} />
{:else if p.type === 'choice'}
  {#if controlOf(p) === 'segmented' && !compact}
    <SegmentedControl {size} options={choiceList(p)} {value} label={label || p.label} full onchange={(v) => onchange?.(v, true)} />
  {:else}
    <Select {size} options={choiceList(p)} {value} label={label || p.label} full={!compact} class={compact ? 'gsel' : ''} onchange={(v) => onchange?.(v, true)} />
  {/if}
{:else if isPair(value)}
  <div class="gpair">
    <NumberField {size} value={value[0]} step={stepOf(p)} label={`${label || p.label} low`} onchange={(x) => onchange?.([x, value[1]], false)} oncommit={(x) => onchange?.([x, value[1]], true)} />
    <NumberField {size} value={value[1]} step={stepOf(p)} label={`${label || p.label} high`} onchange={(x) => onchange?.([value[0], x], false)} oncommit={(x) => onchange?.([value[0], x], true)} />
  </div>
{:else if p.type === 'text' || typeof value === 'string'}
  <input class="gtext" class:sm={compact} value={value ?? ''} aria-label={label || p.label} onchange={(e) => onchange?.(e.currentTarget.value, true)} />
{:else if !compact}
  <div class="gjson">
    <textarea class="gtext k-num" rows={Math.min(8, Math.max(2, jsonShown.split('\n').length))} spellcheck="false" aria-label={label || p.label}
              aria-invalid={!!jsonErr} value={jsonShown} oninput={(e) => (jsonText = e.currentTarget.value)} onchange={(e) => commitJson(e.currentTarget.value)}></textarea>
    {#if jsonErr}<span class="gerr" role="alert">{jsonErr}</span>{/if}
  </div>
{:else}
  <span class="gkinds-sum">…</span>
{/if}

<style>
  .gtext { box-sizing: border-box; width: 100%; height: var(--ctl-h); padding: 0 var(--pad-x); font: inherit; font-size: var(--fs-ui); color: var(--tx-val);
    background: var(--bg-sunken); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius); box-shadow: var(--recess); outline: none; }
  .gtext.sm { height: var(--ctl-h-sm); font-size: var(--fs-1); }
  textarea.gtext { height: auto; padding: 4px var(--pad-x); resize: vertical; line-height: 1.4; font-size: var(--fs-1); }
  .gtext:hover { border-color: var(--line-ctl-hover); }
  .gtext:focus { border-color: var(--focus); box-shadow: var(--recess), 0 0 0 1px var(--focus); color: var(--tx-hi); }
  .gtext.bad, .gtext[aria-invalid='true'] { border-color: var(--bad-ink); }
  .gexpr, .gjson { display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; }
  .gerr { color: var(--bad-ink); font-size: var(--fs-1); }
  .gpair { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 100%; }
  .gkinds { display: flex; flex-wrap: wrap; gap: 3px; }
  .gkind { padding: 1px 6px; font: inherit; font-size: var(--fs-1); color: var(--tx-mut); background: none; border: 1px solid var(--line-2); border-radius: var(--radius); cursor: pointer; }
  .gkind:hover { border-color: var(--line-4); color: var(--tx); }
  .gkind[aria-pressed='true'] { color: var(--tx-hi); border-color: var(--kc); background: color-mix(in srgb, var(--kc) 18%, transparent); }
  .gkinds-sum { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-val); font-size: var(--fs-1); }
  .gktab { display: flex; flex-direction: column; gap: 2px; width: 100%; }
  .gkrow { display: grid; grid-template-columns: 1fr 64px 64px 20px; align-items: center; gap: 4px; min-height: 24px; }
  .gkrow[data-on]:not([data-pair]) { grid-template-columns: 1fr 132px 20px; }
  .gkrow:not([data-on]) { grid-template-columns: 1fr 20px; opacity: .6; }
  .gkrow:not([data-on]):hover { opacity: 1; }
  .gkname { display: flex; align-items: center; gap: 5px; font-size: var(--fs-1); color: var(--tx); min-width: 0; overflow: hidden; white-space: nowrap; }
  .gkname i { width: 8px; height: 8px; border-radius: var(--radius); background: var(--kc); flex: none; }
  .gadd { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: var(--radius); background: none; color: var(--tx-mut); cursor: pointer; }
  .gadd:hover { color: var(--tx-hi); border-color: var(--line-3); }
</style>
