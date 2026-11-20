<!--
  ParamForm: a form generated from a params.js schema. See docs/paramform.md.
  <ParamForm {schema} bind:values onchange={preview} oncommit={(v, key) => history.push(v)} />
-->
<script>
  import NumberField from './NumberField.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';
  import Field from './Field.svelte';
  import Select from './Select.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import IconButton from './IconButton.svelte';
  import Section from './Section.svelte';
  import { tooltip } from './tooltip.js';
  import { property } from './contextmenu.js';
  import { coerce, normalizeValues, groupsOf, stepOf, isDefault, choiceList } from './params.js';
  import { formatNumber } from './math.js';
  import { controlOf, sameValues, segmentsFit, numberColumnChars } from './paramform.js';

  let {
    schema = [],
    values = $bindable({}),
    compact = true,
    collapsible = true,
    groupsOpen = true,   // false: named groups start collapsed
    onchange,
    oncommit,
    class: cls = '',
    ...rest
  } = $props();

  const uid = $props.id();
  const groups = $derived(groupsOf(schema));
  const byKey = $derived(new Map(schema.map((p) => [p.key, p])));
  const numCh = $derived(numberColumnChars(schema));
  // What the controls show: always complete and valid, even before the write-back below lands.
  const cur = $derived(normalizeValues(schema, values));

  // Normalise the bound object on mount, when the schema changes, and when an outside write leaves it invalid.
  $effect.pre(() => {
    if (!sameValues(cur, values)) values = cur;
  });

  // A gesture's starting value per key: a commit fires only when the gesture really changed something.
  const before = {};

  function change(key, v) {
    const p = byKey.get(key);
    if (!p) return;
    v = coerce(p, v);
    if (Object.is(cur[key], v)) return;
    if (!(key in before)) before[key] = cur[key];
    values = { ...cur, [key]: v };
    onchange?.(values, key);
  }

  function commit(key) {
    if (!(key in before)) return;
    const was = before[key];
    delete before[key];
    if (!Object.is(was, cur[key])) oncommit?.(values, key);
  }

  /** A whole gesture in one step (reset). */
  function set(key, v) {
    change(key, v);
    commit(key);
  }

  function resetGroup(g) {
    const next = { ...cur };
    for (const p of g.params) next[p.key] = coerce(p, p.default);
    if (sameValues(next, cur)) return;
    values = next;
    onchange?.(values, null);
    oncommit?.(values, null);
  }

  const id = (p) => `${uid}-${p.key}`;
  const modified = (p) => !isDefault(p, cur[p.key]);
  const groupModified = (g) => g.params.some(modified);

  function show(p, v) {
    if (p.type === 'bool') return v ? 'on' : 'off';
    if (p.type === 'choice') return choiceList(p).find((c) => c.value === v)?.label ?? String(v);
    return formatNumber(v, { step: stepOf(p) }) + (p.unit ? ' ' + p.unit : '');
  }
  const resetTip = (p) => `Reset to ${show(p, coerce(p, p.default))}`;
  // one reset: the row's reset dot and its right click's Reset to default run this
  const resetOf = (p) => () => set(p.key, coerce(p, p.default));
  // every row is a property (contextmenu.js): right click resets, copies, pastes
  const asProperty = (p) => property(() => ({ value: cur[p.key], default: coerce(p, p.default), set: (v) => set(p.key, v), reset: resetOf(p), format: (v) => show(p, v) }));
  const labelTip = (p) => (p.hint ? `${p.label}\n${p.hint}` : p.label);

  // A label focuses its control without activating it (a Select would open); a switch's label toggles it.
  function labelClick(e, p) {
    if (controlOf(p) === 'switch') return;
    e.preventDefault();
    const el = document.getElementById(id(p));
    (el?.getAttribute('role') === 'radiogroup' ? el.querySelector('[tabindex="0"]') : el)?.focus();
  }
</script>

<!-- ids: { id, labelledby?, describedby? } — the control's id, its label's id (compact rows), its hint's id -->
{#snippet control(p, ids)}
  {@const kind = controlOf(p)}
  {@const a11y = { id: ids.id, 'aria-labelledby': ids.labelledby, 'aria-describedby': ids.describedby }}
  {#if kind === 'number'}
    <NumberField
      {...a11y} full
      bind:value={() => cur[p.key], (x) => change(p.key, x)}
      min={p.min} max={p.max} step={stepOf(p)} unit={p.unit}
      oncommit={() => commit(p.key)}
    />
  {:else if kind === 'slider'}
    <div class="kit-pf-pair">
      <Slider
        aria-labelledby={ids.labelledby} aria-describedby={ids.describedby} label={p.label} full
        bind:value={() => cur[p.key], (x) => change(p.key, x)}
        min={p.min ?? 0} max={p.max ?? 100} step={stepOf(p)}
        oncommit={() => commit(p.key)}
      />
      <NumberField
        {...a11y} full
        bind:value={() => cur[p.key], (x) => change(p.key, x)}
        min={p.min} max={p.max} step={stepOf(p)} unit={p.unit}
        oncommit={() => commit(p.key)}
      />
      <span class="kit-pf-numw k-num" aria-hidden="true"></span>
    </div>
  {:else if kind === 'switch'}
    <Switch {...a11y} bind:checked={() => cur[p.key], (x) => change(p.key, x)} onchange={() => commit(p.key)} />
  {:else if kind === 'segmented'}
    <SegmentedControl
      {...a11y} full label={ids.labelledby ? '' : p.label}
      options={choiceList(p)}
      bind:value={() => cur[p.key], (x) => change(p.key, x)}
      onchange={() => commit(p.key)}
    />
  {:else}
    <Select
      {...a11y} full
      options={choiceList(p)}
      bind:value={() => cur[p.key], (x) => change(p.key, x)}
      onchange={() => commit(p.key)}
    />
  {/if}
{/snippet}

{#snippet reset(p)}
  <span class="kit-pf-reset">
    {#if modified(p)}
      <IconButton icon="refresh" size="sm" label="Reset {p.label}" tip={resetTip(p)} onclick={resetOf(p)} />
    {/if}
  </span>
{/snippet}

{#snippet row(p)}
  {@const kind = controlOf(p)}
  <div class="kit-pf-row" data-key={p.key} data-kind={kind} data-modified={modified(p) || undefined}
    data-wide={(kind === 'segmented' && !segmentsFit(p)) || undefined} {@attach asProperty(p)}>
    {#if compact}
      <!-- the click only redirects a pointer's focus; the keyboard reaches the control itself -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <label class="kit-pf-label" id="{id(p)}-l" for={id(p)} onclick={(e) => labelClick(e, p)} {@attach tooltip(labelTip(p))}>{p.label}</label>
      <div class="kit-pf-ctl">
        {@render control(p, { id: id(p), labelledby: `${id(p)}-l`, describedby: p.hint ? `${id(p)}-h` : undefined })}
      </div>
      {@render reset(p)}
      <!-- visually hidden beside the label (its tooltip shows it); printed under the control once the form stacks -->
      {#if p.hint}<span class="kit-pf-hint" id="{id(p)}-h">{p.hint}</span>{/if}
    {:else}
      <Field label={p.label} hint={p.hint} inline={kind === 'switch'} for={id(p)}>
        {#snippet children(f)}
          <div class="kit-pf-ctl">
            {@render control(p, { id: id(p), labelledby: kind === 'slider' || kind === 'segmented' ? f.labelledby : undefined, describedby: f.describedby })}
            {@render reset(p)}
          </div>
        {/snippet}
      </Field>
    {/if}
  </div>
{/snippet}

{#snippet rows(g)}
  <div class="kit-pf-rows">{#each g.params as p (p.key)}{@render row(p)}{/each}</div>
{/snippet}

{#snippet groupReset(g)}
  {#if groupModified(g)}
    <IconButton icon="refresh" size="sm" label="Reset {g.name}" tip="Reset group" onclick={() => resetGroup(g)} />
  {/if}
{/snippet}

<div class="k-param-form {cls}" class:kit-pf-compact={compact} {...rest} style:--kit-pf-num-ch={numCh || undefined}>
  <div class="kit-pf-body">
    {#each groups as g, gi (g.name)}
      {#if !g.name}
        <div class="k-param-form-loose">{@render rows(g)}</div>
      {:else if collapsible}
        <Section title={g.name} open={groupsOpen}>
          {#snippet actions()}{@render groupReset(g)}{/snippet}
          {@render rows(g)}
        </Section>
      {:else}
        <div class="kit-pf-group" role="group" aria-labelledby="{uid}-g{gi}">
          <div class="kit-pf-ghead">
            <span class="kit-pf-gtitle" id="{uid}-g{gi}">{g.name}</span>
            {@render groupReset(g)}
          </div>
          {@render rows(g)}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  /* The label column: 38% of the FORM's width (cqi on .kit-pf-body resolves against the root), but never so wide
     that the rest drops under 7 control heights, held between 3 and 7 control heights. Computed to px once
     here (registered property) and inherited, so every row in every group shares it whatever wraps them. */
  @property --kit-pf-label-w { syntax: '<length>'; inherits: true; initial-value: 0px; }

  /* Named, so a Section (or anything else) that becomes a container never takes over the query below. */
  .k-param-form { container: kit-pf / inline-size; min-width: 0; }
  .kit-pf-body {
    --kit-pf-label-w: clamp(calc(var(--ctl-h) * 3), min(38cqi, 100cqi - var(--ctl-h) * 7), calc(var(--ctl-h) * 7));
    display: flex; flex-direction: column;
  }
  .kit-pf-rows { display: flex; flex-direction: column; gap: var(--gap); }
  .k-param-form:not(.kit-pf-compact) .kit-pf-rows { gap: var(--space-5); }
  /* The form is mounted flush in a panel: everything outside a Section takes a Section body's inset
     (Section.svelte .inner), so the label column is one column, and every group ends on the same hairline. */
  .k-param-form-loose, .kit-pf-group { padding: 0 var(--space-4); }
  .k-param-form-loose:not(:last-child), .kit-pf-group { padding-bottom: var(--space-5); border-bottom: var(--bw) solid var(--line-1); }

  /* ---- a compact row: label | control | reset ---- */
  .kit-pf-compact .kit-pf-row {
    display: grid;
    grid-template-columns: var(--kit-pf-label-w) minmax(0, 1fr) var(--ctl-h-sm);
    grid-template-areas: 'label ctl reset';
    column-gap: var(--gap);
    align-items: center;
    min-height: var(--ctl-h);
  }
  .kit-pf-compact .kit-pf-label { grid-area: label; }
  .kit-pf-compact .kit-pf-ctl { grid-area: ctl; }
  .kit-pf-compact .kit-pf-reset { grid-area: reset; }
  /* An explicit segmented choice too long for the control column takes the row under its label. */
  .kit-pf-compact .kit-pf-row[data-wide] {
    grid-template-columns: minmax(0, 1fr) var(--ctl-h-sm); grid-template-areas: 'label label' 'ctl reset'; row-gap: var(--space-2);
  }
  /* A switch is small: its label takes everything but the switch and the reset slot (as in stacked forms). */
  .kit-pf-compact .kit-pf-row[data-kind='switch'] { grid-template-columns: minmax(0, 1fr) auto var(--ctl-h-sm); }
  /* Field's label voice (Field.svelte .label), one line. */
  .kit-pf-label {
    min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    font-size: var(--fs-2); font-weight: 500; line-height: var(--lh-tight); letter-spacing: .04em;
    color: var(--tx-mut); text-transform: var(--label-case);
    cursor: default; user-select: none;
  }
  /* Beside the label the hint is for assistive tech only (aria-describedby; the label's tooltip shows it). */
  .kit-pf-hint {
    /* top / left 0 (theme.css .k-sr): never at its static place, where it stretched the panel body past a scrolling form */
    position: absolute; top: 0; left: 0; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
    font-size: var(--fs-2); line-height: var(--lh-tight); color: var(--tx-mut);
  }
  .kit-pf-ctl { min-width: 0; display: flex; align-items: center; gap: var(--gap); }
  .kit-pf-ctl > :global(*:not(.kit-pf-reset)) { flex: 1 1 auto; min-width: 0; }
  .kit-pf-row[data-kind='switch'] .kit-pf-ctl { justify-content: flex-end; }
  .kit-pf-row[data-kind='switch'] .kit-pf-ctl > :global(*:not(.kit-pf-reset)) { flex: none; }
  /* Stacked: Field's body shrink-wraps its children; the control row spans it. A switch row (Field inline)
     gives its label everything but the switch and the reset slot. */
  .k-param-form:not(.kit-pf-compact) .kit-pf-ctl { align-self: stretch; }
  .k-param-form:not(.kit-pf-compact) .kit-pf-row { --field-label-w: calc(100% - var(--ctl-h) * 3); }

  /* Narrow (below 250 px of form): the label column would sit at its 3-control-height floor and squeeze the
     controls, so compact rows stack like compact = false: label above (wrapping, never cut), control and
     reset below, the hint printed under the control. A switch keeps its row, label left. */
  @container kit-pf (width < 250px) {
    .kit-pf-compact .kit-pf-rows { gap: var(--space-4); }
    .kit-pf-compact .kit-pf-row, .kit-pf-compact .kit-pf-row[data-wide] {
      grid-template-columns: minmax(0, 1fr) var(--ctl-h-sm); grid-template-areas: 'label label' 'ctl reset' 'hint hint';
      row-gap: var(--space-2);
    }
    .kit-pf-compact .kit-pf-row[data-kind='switch'] {
      grid-template-columns: minmax(0, 1fr) auto var(--ctl-h-sm); grid-template-areas: 'label ctl reset' 'hint hint hint';
    }
    .kit-pf-compact .kit-pf-label { white-space: normal; overflow-wrap: anywhere; }
    .kit-pf-compact .kit-pf-hint { grid-area: hint; position: static; width: auto; height: auto; margin: 0; overflow: visible; clip-path: none; white-space: normal; }
  }

  /* Slider + number field. The field sits in a column one width for the whole form (numberColumnChars: the
     widest slider value + unit, in the field's own mono ch; the sizer below holds it open), so every slider in
     the form has the same length and every field ends on the control column's right edge. */
  .kit-pf-pair { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--gap); }
  .kit-pf-pair > :global(*) { grid-row: 1; }
  .kit-pf-pair > :global(.k-number-field), .kit-pf-numw { grid-column: 2; }
  .kit-pf-numw {
    height: 0; visibility: hidden; font-size: var(--fs-ui);
    width: calc(var(--kit-pf-num-ch, 0) * 1ch + 1px + 2 * var(--pad-x) + 2 * var(--bw));
  }

  /* ---- reset: a quiet dot that turns into the button under the pointer or keyboard focus ---- */
  .kit-pf-reset {
    position: relative; flex: none;
    display: grid; place-items: center;
    width: var(--ctl-h-sm); height: var(--ctl-h-sm);
  }
  .kit-pf-row[data-modified] .kit-pf-reset::before {
    content: ''; position: absolute; inset: 0; margin: auto;
    width: var(--space-2); height: var(--space-2); border-radius: 50%;
    background: var(--accent-ink);
    pointer-events: none;
    transition: opacity var(--t-quick) var(--ease-out);
  }
  .kit-pf-reset > :global(*) { opacity: 0; color: var(--tx-mut); }
  .kit-pf-row:hover .kit-pf-reset > :global(*), .kit-pf-reset:focus-within > :global(*) { opacity: 1; }
  .kit-pf-row:hover .kit-pf-reset::before, .kit-pf-reset:focus-within::before { opacity: 0; }
  @media (hover: none) {
    .kit-pf-reset > :global(*) { opacity: 1; }
    .kit-pf-row[data-modified] .kit-pf-reset::before { opacity: 0; }
  }

  /* ---- groups without Section (collapsible = false): Section's head and rhythm, no toggle ---- */
  .kit-pf-ghead {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
    height: var(--ctl-h); margin-bottom: var(--space-1);
  }
  .kit-pf-gtitle {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--font-head); font-size: var(--fs-1); font-weight: 500;
    text-transform: uppercase; letter-spacing: var(--caps-track); color: var(--tx-val);
  }
</style>
