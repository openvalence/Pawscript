<script>
  import Checkbox from '../Checkbox.svelte';
  import Switch from '../Switch.svelte';
  import RadioGroup from '../RadioGroup.svelte';
  import TextField from '../TextField.svelte';
  import NumberField from '../NumberField.svelte';
  import Slider from '../Slider.svelte';
  import RangeSlider from '../RangeSlider.svelte';
  import Field from '../Field.svelte';
  import ColorSwatch from '../ColorSwatch.svelte';
  import Button from '../Button.svelte';

  const sizes = ['sm', 'md', 'lg'];
  let log = $state('—');
  // The last event is shown; every event is also kept on window.__fieldEvents for the scripted checks.
  const note = (what) => (v) => {
    log = `${what} ${Array.isArray(v) ? v.join(' – ') : v}`;
    (window.__fieldEvents ??= []).push(log);
  };

  let speed = $state(1);
  let offset = $state(-40);
  let pos = $state(50);
  let smoothing = $state(0.35);
  let range = $state([20, 80]);
  let snap = $state(true);
  let invert = $state(false);
  let lanes = $state(false);
  let lanesMixed = $state(true);
  let loopOn = $state(true);
  let interp = $state('cubic');
  let align = $state('frame');
  let chapter = $state('orange');
  let lane = $state('sky');
  let search = $state('');
  let title = $state('Chapter 3 — slow build');
  let speedText = $state('fast');

  const interpOpts = [
    { value: 'linear', label: 'Linear' },
    { value: 'cubic', label: 'Cubic', hint: 'default' },
    { value: 'step', label: 'Step (hold until the next action)' },
    { value: 'bezier', label: 'Bezier', disabled: true },
  ];
  const alignOpts = [
    { value: 'frame', label: 'Frames' },
    { value: 'beat', label: 'Beats' },
    { value: 'none', label: 'Free' },
  ];
</script>

<div class="demo">
  <p class="k-hint">Last event: <span class="k-num" data-test="log">{log}</span></p>

  <section>
    <h3 class="k-caps">Row alignment (sm / md / lg)</h3>
    {#each sizes as s}
      <div class="row" data-test="align-{s}">
        <TextField size={s} value="Chapter 1" label="Name" />
        <NumberField size={s} value={120} min={0} max={9999} unit="ms" label="Offset" />
        <ColorSwatch size={s} value="green" label="Chapter colour" />
        <ColorSwatch size={s} value="green" label="Chapter colour" showName />
        <Button size={s}>Apply</Button>
        <Slider size={s} value={40} label="Smoothing" />
        <Checkbox size={s} checked label="Snap" />
        <Switch size={s} checked label="Loop" />
      </div>
    {/each}
  </section>

  <section>
    <h3 class="k-caps">TextField</h3>
    <div class="row">
      <TextField bind:value={title} label="Chapter title" data-test="text" onchange={note('title change')} onenter={note('title enter')} />
      <TextField bind:value={search} placeholder="Search actions" icon="search" clearable label="Search" data-test="search" oninput={note('search input')} />
      <TextField bind:value={speedText} invalid label="Speed preset" />
      <TextField value="Read-only: 1 248 actions" readonly label="Count" />
      <TextField value="Disabled" disabled label="Disabled" />
    </div>
    <div class="row">
      {#each sizes as s}<TextField size={s} placeholder="Size {s}" icon="search" clearable value={s === 'lg' ? 'Clearable' : ''} />{/each}
    </div>
    <div class="narrow"><TextField full value="A very long chapter title that will not fit in a narrow inspector column" label="Long" /></div>
  </section>

  <section>
    <h3 class="k-caps">NumberField</h3>
    <div class="row">
      <NumberField bind:value={speed} min={0.05} max={4} step={0.05} unit="×" label="Speed" data-test="speed" onchange={note('speed change')} oncommit={note('speed commit')} />
      <NumberField bind:value={offset} min={-5000} max={5000} unit="ms" label="Offset" data-test="offset" onchange={note('offset change')} oncommit={note('offset commit')} />
      <NumberField bind:value={pos} min={0} max={100} unit="%" label="Position" data-test="pos" oncommit={note('pos commit')} />
      <NumberField value={24} label="Frame rate" decimals={3} unit="fps" />
      <NumberField value={1.5} unit="s" invalid label="Gap" />
      <NumberField value={300} unit="ms" readonly label="Duration" />
      <NumberField value={60} unit="%" disabled label="Disabled" />
    </div>
    <div class="row">
      {#each sizes as s}<NumberField size={s} value={-12.5} min={-100} max={100} step={0.5} unit="ms" />{/each}
      <NumberField value={7} scrub={false} label="No scrub" />
    </div>
    <div class="narrow"><NumberField full value={123456} unit="samples" label="Long" /></div>
  </section>

  <section>
    <h3 class="k-caps">Slider</h3>
    <div class="col">
      <Slider bind:value={smoothing} min={0} max={1} step={0.01} label="Smoothing" showValue data-test="smoothing" onchange={note('smoothing change')} oncommit={note('smoothing commit')} />
      <Slider value={3} min={0} max={8} step={1} ticks label="Simplify" showValue />
      <Slider value={25} min={0} max={100} ticks={5} label="Strength" showValue format={(v) => v + '%'} />
      <Slider value={60} label="Disabled" disabled showValue />
      {#each sizes as s}<Slider size={s} value={50} label="Size {s}" showValue />{/each}
    </div>
    <div class="narrow"><Slider full value={70} label="Narrow" showValue /></div>
  </section>

  <section>
    <h3 class="k-caps">RangeSlider</h3>
    <div class="col">
      <RangeSlider bind:value={range} min={0} max={100} minGap={5} label="Range" showValue ticks={11} data-test="range" onchange={note('range change')} oncommit={note('range commit')} />
      <RangeSlider value={[50, 50]} min={0} max={100} label="Stacked" showValue data-test="stacked" />
      <RangeSlider value={[10, 90]} label="Disabled" disabled showValue />
    </div>
  </section>

  <section>
    <h3 class="k-caps">Checkbox</h3>
    <div class="row">
      <Checkbox bind:checked={snap} label="Snap to frames" data-test="snap" onchange={note('snap')} />
      <Checkbox bind:checked={invert} label="Invert" />
      <Checkbox bind:checked={lanes} bind:indeterminate={lanesMixed} label="All lanes" />
      <Checkbox checked invalid label="Accept licence" />
      <Checkbox checked disabled label="Disabled on" />
      <Checkbox disabled label="Disabled off" />
    </div>
    <div class="row">{#each sizes as s}<Checkbox size={s} checked label="Size {s}" />{/each}</div>
    <div class="narrow"><Checkbox checked label="Keep the original actions on a hidden lane after generating" /></div>
  </section>

  <section>
    <h3 class="k-caps">Switch</h3>
    <div class="row">
      <Switch bind:checked={loopOn} label="Loop playback" data-test="loop" onchange={note('loop')} />
      <Switch label="Show heatmap" />
      <Switch checked disabled label="Disabled on" />
      <Switch disabled label="Disabled off" />
    </div>
    <div class="row">{#each sizes as s}<Switch size={s} checked label="Size {s}" />{/each}</div>
    <div class="narrow"><Switch checked label="Follow the playhead while scrubbing the timeline" /></div>
  </section>

  <section>
    <h3 class="k-caps">RadioGroup</h3>
    <div class="row top">
      <div class="narrow"><RadioGroup options={interpOpts} bind:value={interp} label="Interpolation" data-test="interp" onchange={note('interp')} /></div>
      <RadioGroup options={alignOpts} bind:value={align} label="Snap to" orientation="horizontal" />
      <RadioGroup options={alignOpts} value="beat" label="Disabled" orientation="horizontal" disabled />
      <RadioGroup options={alignOpts} value="frame" label="Small" size="sm" />
    </div>
  </section>

  <section>
    <h3 class="k-caps">Field</h3>
    <div class="row top">
      <div class="stack">
        <Field label="Chapter title" hint="Shown on the timeline ruler">
          {#snippet children({ id, describedby })}<TextField {id} aria-describedby={describedby} bind:value={title} full />{/snippet}
        </Field>
        <Field label="Offset" error="Must be within ±5000 ms" required>
          {#snippet children({ id, describedby })}<NumberField {id} aria-describedby={describedby} value={6200} unit="ms" invalid />{/snippet}
        </Field>
      </div>
      <div class="stack inspector" data-test="inspector">
        <Field inline label="Speed">
          {#snippet children({ id })}<NumberField {id} bind:value={speed} min={0.05} max={4} step={0.05} unit="×" full />{/snippet}
        </Field>
        <Field inline label="Offset" hint="Positive delays every action">
          {#snippet children({ id, describedby })}<NumberField {id} aria-describedby={describedby} bind:value={offset} unit="ms" full />{/snippet}
        </Field>
        <Field inline label="Smoothing">
          {#snippet children({ id, labelledby })}<Slider {id} aria-labelledby={labelledby} bind:value={smoothing} min={0} max={1} step={0.01} showValue full />{/snippet}
        </Field>
        <Field inline label="Range">
          {#snippet children({ id, labelledby })}<RangeSlider {id} aria-labelledby={labelledby} bind:value={range} minGap={5} full />{/snippet}
        </Field>
        <Field inline label="Snap to frames">
          {#snippet children({ id })}<Switch {id} bind:checked={snap} />{/snippet}
        </Field>
        <Field inline label="Chapter colour">
          {#snippet children({ id })}<ColorSwatch {id} bind:value={chapter} showName label="Chapter colour" />{/snippet}
        </Field>
        <Field inline label="Interpolation of generated strokes">
          {#snippet children({ id, labelledby })}<RadioGroup {id} aria-labelledby={labelledby} options={alignOpts} bind:value={align} orientation="horizontal" />{/snippet}
        </Field>
      </div>
    </div>
  </section>

  <section>
    <h3 class="k-caps">ColorSwatch</h3>
    <div class="row top">
      <ColorSwatch bind:value={chapter} label="Chapter colour" data-test="swatch" onchange={note('colour')} />
      <ColorSwatch bind:value={chapter} label="Chapter colour" showName />
      <ColorSwatch value={undefined} label="Unset colour" showName />
      <ColorSwatch value="pink" label="Disabled" disabled showName />
      <ColorSwatch bind:value={lane} label="Lane colour" inline data-test="swatch-inline" onchange={note('lane colour')} />
    </div>
    <div class="narrow"><ColorSwatch value="vermilion" label="Chapter colour" showName palette={[{ key: 'vermilion', label: 'Vermilion for the very long chapter name' }]} /></div>
  </section>
</div>

<style>
  .demo { display: flex; flex-direction: column; gap: var(--space-7); padding: var(--space-6); }
  section { display: flex; flex-direction: column; gap: var(--space-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap); }
  .row.top { align-items: flex-start; gap: var(--space-7); }
  .col { display: flex; flex-direction: column; gap: var(--space-2); }
  .narrow { width: calc(var(--space-8) * 5); padding: var(--space-2); border: 1px dashed var(--line-2); }
  .stack { display: flex; flex-direction: column; gap: var(--space-4); width: calc(var(--space-8) * 9); }
  .inspector { gap: var(--space-2); padding: var(--space-4); border: 1px solid var(--line-1); background: var(--bg-raised); }
</style>
