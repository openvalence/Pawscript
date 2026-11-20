<script>
  // Consistency.svelte -- cross-family rows: the same size of every control side by side on a guide band of
  // the exact token height, each control's measured height printed under it (red when it is off). Rows for
  // disabled, invalid and truncation. QA reads data-h / data-want on .cell (test/kit-e2e and screenshots).
  import Kit from './Kit.svelte';
  import { cssVar } from '../color.js';

  const sizes = [
    { size: 'sm', token: '--ctl-h-sm' },
    { size: 'md', token: '--ctl-h' },
    { size: 'lg', token: '--ctl-h-lg' },
  ];
  const snapOpts = [{ value: 'frame', label: 'Frames' }, { value: '10', label: '10 ms' }, { value: 'off', label: 'Off' }];
  const modeOpts = [{ value: 'script', label: 'Script' }, { value: 'review', label: 'Review' }, { value: 'track', label: 'Track' }];
  const toolOpts = [{ value: 'pointer', label: 'Pointer', icon: 'pointer' }, { value: 'pen', label: 'Pen', icon: 'pen' }, { value: 'select', label: 'Select', icon: 'select' }];
  const long = 'A very long label that has to ellipsize instead of wrapping the control';
  const longOpts = [{ value: 'a', label: long }, { value: 'b', label: 'Short' }];

  // Controls that must sit exactly at the row height (Checkbox / Switch only align, they are smaller).
  const exact = new Set(['Button', 'Primary', 'IconButton', 'ToggleButton', 'TextField', 'NumberField', 'Select', 'ComboBox', 'SegmentedControl', 'ColorSwatch']);

  /** Attachment: keep data-h (measured px of the control) and data-want (token px) on a .cell. */
  function measure(node) {
    const run = () => {
      const c = node.firstElementChild;
      if (!c) return;
      const h = Math.round(c.getBoundingClientRect().height * 10) / 10;
      const want = parseFloat(cssVar(node.dataset.token, node));
      node.dataset.h = h; node.dataset.want = want;
      const out = node.querySelector(':scope > .h');
      if (out) {
        out.textContent = h + 'px';
        out.classList.toggle('off', exact.has(node.dataset.c) && Math.abs(h - want) > 0.5);
      }
    };
    const ro = new ResizeObserver(run);
    ro.observe(node);
    if (node.firstElementChild) ro.observe(node.firstElementChild);
    const mo = new MutationObserver(() => { if (node.firstElementChild) ro.observe(node.firstElementChild); run(); });
    mo.observe(node, { childList: true });
    const hm = new MutationObserver(run);
    hm.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density', 'data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); hm.disconnect(); };
  }

  let text = $state('Chapter 3');
  let num = $state(120);
  let snap = $state('frame');
  let mode = $state('script');
  let tool = $state('pointer');
  let combo = $state('stroke');
  let check = $state(true);
  let sw = $state(true);
  let color = $state('sky');
  let toggled = $state(true);
</script>

{#snippet row(size, token, extra = {})}
  {@const c = (name) => ({ 'data-c': name, 'data-token': token, 'data-testid': `cons-${size}-${name}${extra.disabled ? '-dis' : ''}${extra.invalid ? '-inv' : ''}` })}
  <div class="row" style:--band={`var(${token})`}>
    <span class="cell" {...c('Button')} {@attach measure}><Kit is="Button" {size} {...extra} icon="add">Add point</Kit><span class="h"></span></span>
    <span class="cell" {...c('Primary')} {@attach measure}><Kit is="Button" {size} {...extra} variant="primary">Generate</Kit><span class="h"></span></span>
    <span class="cell" {...c('IconButton')} {@attach measure}><Kit is="IconButton" {size} {...extra} variant="default" icon="magnet" label="Snap" /><span class="h"></span></span>
    <span class="cell" {...c('ToggleButton')} {@attach measure}><Kit is="ToggleButton" {size} {...extra} variant="default" icon="loop" pressed={toggled} onchange={(v) => (toggled = v)}>Loop</Kit><span class="h"></span></span>
    <span class="cell" {...c('TextField')} {@attach measure}><Kit is="TextField" {size} {...extra} label="Chapter" value={text} oninput={(v) => (text = v)} /><span class="h"></span></span>
    <span class="cell" {...c('NumberField')} {@attach measure}><Kit is="NumberField" {size} {...extra} label="Grid" unit="ms" value={num} min={1} max={1000} onchange={(v) => (num = v)} /><span class="h"></span></span>
    <span class="cell" {...c('Select')} {@attach measure}><Kit is="Select" {size} {...extra} label="Snap" options={snapOpts} value={snap} onchange={(v) => (snap = v)} /><span class="h"></span></span>
    <span class="cell" {...c('ComboBox')} {@attach measure}><Kit is="ComboBox" {size} {...extra} label="Axis" options={[{ value: 'stroke', label: 'stroke' }, { value: 'roll', label: 'roll' }, { value: 'twist', label: 'twist' }]} value={combo} onchange={(v) => (combo = v)} /><span class="h"></span></span>
    <span class="cell" {...c('SegmentedControl')} {@attach measure}><Kit is="SegmentedControl" {size} {...extra} label="Mode" options={modeOpts} value={mode} onchange={(v) => (mode = v)} /><span class="h"></span></span>
    <span class="cell" {...c('ColorSwatch')} {@attach measure}><Kit is="ColorSwatch" {size} {...extra} label="Colour" value={color} onchange={(v) => (color = v)} /><span class="h"></span></span>
    <span class="cell" {...c('Checkbox')} {@attach measure}><Kit is="Checkbox" {size} {...extra} label="Snap" checked={check} onchange={(v) => (check = v)} /><span class="h"></span></span>
    <span class="cell" {...c('Switch')} {@attach measure}><Kit is="Switch" {size} {...extra} label="Device" checked={sw} onchange={(v) => (sw = v)} /><span class="h"></span></span>
  </div>
{/snippet}

<div class="page">
  <section>
    <h2 class="k-caps">Mixed rows per size (guide band = token height; red number = off)</h2>
    {#each sizes as s}
      <p class="k-hint lbl">{s.size} · <code>{s.token}</code></p>
      {@render row(s.size, s.token)}
    {/each}
  </section>

  <section>
    <h2 class="k-caps">Disabled (md)</h2>
    {@render row('md', '--ctl-h', { disabled: true })}
    <h2 class="k-caps">Invalid (md)</h2>
    {@render row('md', '--ctl-h', { invalid: true })}
  </section>

  <section>
    <h2 class="k-caps">Icon-only segmented, toolbar composition</h2>
    <div class="row" style:--band="var(--ctl-h)" data-testid="cons-toolbar">
      <Kit is="Toolbar" label="Lane tools">
        <Kit is="SegmentedControl" label="Tool" options={toolOpts} value={tool} onchange={(v) => (tool = v)} />
        <span class="k-sep"></span>
        <Kit is="IconButton" icon="undo" label="Undo" shortcut="Ctrl+Z" />
        <Kit is="IconButton" icon="redo" label="Redo" shortcut="Ctrl+Y" />
        <span class="k-sep"></span>
        <Kit is="NumberField" label="Grid" unit="ms" value={num} onchange={(v) => (num = v)} />
        <Kit is="Select" label="Snap" options={snapOpts} value={snap} onchange={(v) => (snap = v)} />
        <Kit is="TextField" label="Find" icon="search" placeholder="Find chapter" />
        <Kit is="Button" icon="add">Add point</Kit>
      </Kit>
    </div>
  </section>

  <section>
    <h2 class="k-caps">Truncation (each box 140 px wide)</h2>
    <div class="trunc" data-testid="cons-trunc">
      <span class="box"><Kit is="Button" full>{long}</Kit></span>
      <span class="box"><Kit is="Select" full options={longOpts} value="a" label="Long" /></span>
      <span class="box"><Kit is="TextField" value={long} label="Long" /></span>
      <span class="box"><Kit is="SegmentedControl" full options={[{ value: 'a', label: 'Overview strip' }, { value: 'b', label: 'Heatmap' }]} value="a" label="Long" /></span>
      <span class="box"><Kit is="Chip" icon="flag">{long}</Kit></span>
      <span class="box"><Kit is="Badge" tone="warn">{long}</Kit></span>
    </div>
  </section>

  <section>
    <h2 class="k-caps">Labelled fields (Field inline, stacked)</h2>
    <div class="fields">
      <Kit is="Field" label="Chapter name" hint="Shown on the overview strip">
        {#snippet children(f)}<Kit is="TextField" id={f?.id} aria-describedby={f?.describedby} value={text} oninput={(v) => (text = v)} />{/snippet}
      </Kit>
      <Kit is="Field" label="Grid" inline>
        {#snippet children(f)}<Kit is="NumberField" id={f?.id} unit="ms" value={num} onchange={(v) => (num = v)} />{/snippet}
      </Kit>
      <Kit is="Field" label="Snap" inline error="Pick a snap mode">
        {#snippet children(f)}<Kit is="Select" id={f?.id} invalid options={snapOpts} value={snap} onchange={(v) => (snap = v)} />{/snippet}
      </Kit>
    </div>
  </section>
</div>

<style>
  .page { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); }
  h2 { margin-bottom: var(--space-4); }
  .lbl { margin: var(--space-4) 0 var(--space-2); }
  code { font-family: var(--mono); font-size: var(--fs-1); }
  .row {
    display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap); padding: var(--space-2) 0;
    /* the guide band: two hairlines at the token height, behind every control */
    background:
      linear-gradient(rgba(var(--highlight-rgb), .35), rgba(var(--highlight-rgb), .35)) 0 var(--space-2) / 100% 1px no-repeat,
      linear-gradient(rgba(var(--highlight-rgb), .35), rgba(var(--highlight-rgb), .35)) 0 calc(var(--space-2) + var(--band) - 1px) / 100% 1px no-repeat;
  }
  .cell { display: inline-flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
  .h { font: var(--fs-1) / 1 var(--mono); color: var(--tx-mut); }
  .h:global(.off) { color: var(--bad-ink); font-weight: 600; }
  .trunc { display: flex; flex-wrap: wrap; gap: var(--gap); }
  .box { width: 140px; display: flex; min-width: 0; outline: 1px dashed var(--line-2); }
  .fields { display: grid; gap: var(--space-4); max-width: 360px; }
</style>
