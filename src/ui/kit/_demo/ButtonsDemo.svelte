<script>
  import Button from '../Button.svelte';
  import IconButton from '../IconButton.svelte';
  import ToggleButton from '../ToggleButton.svelte';
  import SegmentedControl from '../SegmentedControl.svelte';
  import Badge from '../Badge.svelte';
  import Chip from '../Chip.svelte';
  import Kbd from '../Kbd.svelte';
  import Spinner from '../Spinner.svelte';
  import ProgressBar from '../ProgressBar.svelte';
  import Skeleton from '../Skeleton.svelte';

  const SIZES = ['sm', 'md', 'lg'];
  const VARIANTS = ['default', 'primary', 'danger', 'ghost'];
  const TONES = ['neutral', 'accent', 'ok', 'warn', 'bad', 'info'];
  const WORDS = { default: 'Add point', primary: 'Export funscript', danger: 'Delete points', ghost: 'Snap to frames' };
  const ICONS = { default: 'add', primary: 'export', danger: 'delete', ghost: 'magnet' };

  let saving = $state(false);
  let clicks = $state(0);
  let snap = $state(true);
  let loop = $state(false);
  let metro = $state(false);
  let axis = $state('L0');
  let tool = $state('pen');
  let view = $state('wave');
  let chips = $state({ stroke: true, surge: false, twist: false, roll: true });
  let tags = $state(['beat', 'chorus', 'needs review', 'a very long tag that will not fit']);
  let progress = $state(0.42);
  let chapter = $state(true);

  const AXES = [
    { value: 'L0', label: 'Stroke' }, { value: 'L1', label: 'Surge' }, { value: 'L2', label: 'Sway', disabled: true },
    { value: 'R0', label: 'Twist' }, { value: 'R1', label: 'Roll' },
  ];
  const TOOLS = [
    { value: 'pointer', label: 'Select', icon: 'pointer', tip: 'Select (V)' }, { value: 'pen', label: 'Draw', icon: 'pen' },
    { value: 'split', label: 'Split', icon: 'split' }, { value: 'smooth', label: 'Smooth', icon: 'smooth' },
  ];
  const VIEWS = [{ value: 'wave', label: 'Waveform', icon: 'wave' }, { value: 'heat', label: 'Heatmap', icon: 'heatmap' }, { value: 'none', label: 'Off' }];

  function save() { saving = true; setTimeout(() => (saving = false), 1500); }
</script>

<div class="demo kit-root">
  <section>
    <h3 class="k-caps">Button · variants × sizes</h3>
    {#each SIZES as size}
      <div class="row">
        <span class="k-hint tag">{size}</span>
        {#each VARIANTS as variant}
          <Button {variant} {size} onclick={() => clicks++}>{WORDS[variant]}</Button>
        {/each}
        {#each VARIANTS as variant}
          <Button {variant} {size} icon={ICONS[variant]}>{WORDS[variant]}</Button>
        {/each}
      </div>
    {/each}
    <div class="row">
      <span class="k-hint tag">more</span>
      <Button iconRight="chevron-down">Speed 1×</Button>
      <Button icon="play" tip="Play" shortcut="Space">Play</Button>
      <Button disabled icon="save">Save project</Button>
      <Button variant="primary" disabled>Export funscript</Button>
      <Button variant="danger" disabled>Delete points</Button>
      <Button variant="ghost" disabled icon="undo">Undo</Button>
      <span class="k-hint">clicked {clicks}×</span>
    </div>
    <div class="row">
      <span class="k-hint tag">loading</span>
      <Button loading>Add point</Button>
      <Button variant="primary" icon="export" loading>Export funscript</Button>
      <Button variant="primary" loading={saving} icon="save" onclick={save}>Save (click me)</Button>
      <Button variant="primary" loading={saving} onclick={save}>Render preview</Button>
      <Button variant="ghost" loading size="sm">Analysing</Button>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Shared heights · one row per size</h3>
    {#each SIZES as size}
      <div class="row">
        <span class="k-hint tag">{size}</span>
        <Button {size} icon="add">Add point</Button>
        <IconButton {size} icon="undo" label="Undo" shortcut="Ctrl+Z" variant="default" />
        <IconButton {size} icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" />
        <ToggleButton {size} icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
        <ToggleButton {size} variant="default" icon="loop" bind:pressed={loop}>Loop</ToggleButton>
        <SegmentedControl {size} label="Stroke axis" options={AXES.slice(0, 3)} bind:value={axis} />
        <SegmentedControl {size} label="Tool" options={TOOLS} iconOnly bind:value={tool} />
        <Chip icon="filter" selected={true}>Chip</Chip>
        <Badge tone="accent">Live</Badge>
      </div>
    {/each}
  </section>

  <section>
    <h3 class="k-caps">IconButton</h3>
    {#each VARIANTS as variant}
      <div class="row">
        <span class="k-hint tag">{variant}</span>
        {#each SIZES as size}
          <IconButton {variant} {size} icon="play" label="Play" shortcut="Space" />
        {/each}
        <IconButton {variant} icon="skip-back" label="Previous point" shortcut="," />
        <IconButton {variant} icon="skip-forward" label="Next point" shortcut="." />
        <IconButton {variant} icon="settings" label="Settings" disabled />
        <IconButton {variant} icon="eye" label="Show heatmap" pressed={true} />
        <IconButton {variant} icon="eye-off" label="Hide heatmap" pressed={false} />
        <IconButton {variant} icon="refresh" label="Re-analyse" loading />
      </div>
    {/each}
  </section>

  <section>
    <h3 class="k-caps">ToggleButton</h3>
    <div class="row">
      <span class="k-hint tag">ghost</span>
      <ToggleButton icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
      <ToggleButton icon="loop" label="Loop" bind:pressed={loop} />
      <ToggleButton icon="volume" label="Metronome" bind:pressed={metro} />
      <ToggleButton icon="magnet" bind:pressed={snap}>Snap to frames</ToggleButton>
      <ToggleButton icon="lock" label="Lock lane" pressed={true} disabled />
      <ToggleButton icon="lock" label="Lock lane" disabled />
    </div>
    <div class="row">
      <span class="k-hint tag">default</span>
      <ToggleButton variant="default" icon="magnet" label="Snap to frames" bind:pressed={snap} />
      <ToggleButton variant="default" icon="loop" bind:pressed={loop}>Loop</ToggleButton>
      <ToggleButton variant="default" bind:pressed={metro}>Metronome</ToggleButton>
      <ToggleButton variant="default" size="sm" bind:pressed={metro}>Metronome</ToggleButton>
      <ToggleButton variant="default" size="lg" icon="loop" bind:pressed={loop}>Loop</ToggleButton>
      <ToggleButton variant="default" pressed={true} disabled>Pressed, disabled</ToggleButton>
      <span class="k-hint">snap {snap ? 'on' : 'off'} · loop {loop ? 'on' : 'off'}</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">SegmentedControl</h3>
    {#each SIZES as size}
      <div class="row">
        <span class="k-hint tag">{size}</span>
        <SegmentedControl {size} label="Stroke axis" options={AXES} bind:value={axis} />
        <SegmentedControl {size} label="Overlay" options={VIEWS} bind:value={view} />
        <SegmentedControl {size} label="Tool" options={TOOLS} iconOnly bind:value={tool} />
      </div>
    {/each}
    <div class="row">
      <span class="k-hint tag">disabled</span>
      <SegmentedControl label="Stroke axis" options={AXES} value="L1" disabled />
      <SegmentedControl label="No selection" options={AXES.slice(0, 3)} value={null} />
      <span class="k-hint">axis {axis} · tool {tool} · overlay {view}</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Truncation · 180px box</h3>
    <div class="narrow">
      <Button full icon="export" variant="primary">Export funscript with all chapters and bookmarks</Button>
      <Button full>Interpolate between selected points</Button>
      <SegmentedControl full label="Fill mode" options={[{ value: 'a', label: 'Linear interpolation' }, { value: 'b', label: 'Cubic spline' }, { value: 'c', label: 'Hold' }]} value="b" />
      <Chip removable label="tag">Generated from motion tracking</Chip>
      <Chip color="vermilion" selected={true}>A really long overlay name</Chip>
      <Badge tone="warn">Unsaved changes in 3 lanes</Badge>
      <ProgressBar value={0.66} label="Exporting Section 4 of the long chapter" showValue />
    </div>
  </section>

  <section>
    <h3 class="k-caps">Badge</h3>
    {#each ['soft', 'solid', 'outline'] as variant}
      <div class="row">
        <span class="k-hint tag">{variant}</span>
        {#each TONES as tone}<Badge {tone} {variant}>{tone}</Badge>{/each}
        <Badge tone="accent" {variant} num>12</Badge>
        <Badge tone="bad" {variant} num>3</Badge>
        <Badge {variant} num>1 204</Badge>
      </div>
    {/each}
    <div class="row">
      <span class="k-hint tag">in text</span>
      <span>Stroke lane <Badge tone="ok">Saved</Badge> · Twist lane <Badge tone="warn">Modified</Badge> · <Badge tone="accent" num>48</Badge> points selected</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Chip</h3>
    <div class="row">
      <span class="k-hint tag">filter</span>
      <Chip color="sky" bind:selected={chips.stroke}>Stroke</Chip>
      <Chip color="orange" bind:selected={chips.surge}>Surge</Chip>
      <Chip color="green" bind:selected={chips.twist}>Twist</Chip>
      <Chip color="violet" bind:selected={chips.roll}>Roll</Chip>
      <Chip icon="filter" selected={false}>Peaks only</Chip>
      <Chip icon="bookmark" selected={true} disabled>Bookmarked</Chip>
      <Chip selected={false} disabled>Disabled</Chip>
    </div>
    <div class="row">
      <span class="k-hint tag">tags</span>
      {#each tags as t (t)}
        <Chip removable label={t} onremove={() => (tags = tags.filter((x) => x !== t))}>{t}</Chip>
      {/each}
      {#if chapter}<Chip removable color="pink" label="chapter" onclick={() => clicks++} onremove={() => (chapter = false)}>Chapter 2</Chip>{/if}
      <Chip>static tag</Chip>
      <Chip removable disabled label="locked">locked</Chip>
      <Button size="sm" variant="ghost" icon="refresh" onclick={() => { tags = ['beat', 'chorus', 'needs review', 'a very long tag that will not fit']; chapter = true; }}>Reset tags</Button>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Kbd</h3>
    <div class="row">
      <Kbd keys="Space" /> <Kbd keys="Ctrl+Z" /> <Kbd keys="Ctrl+Shift+Z" /> <Kbd keys="Shift+ArrowLeft" />
      <Kbd keys="Ctrl+K Ctrl+S" /> <Kbd keys="Delete" /> <Kbd keys="Ctrl+Shift+Z" platform="mac" /> <Kbd keys="Alt+Enter" platform="mac" />
    </div>
    <div class="row">
      <span>Add point <Kbd keys="A" /> · Play <Kbd keys="Space" /> · Export funscript <Kbd keys="Ctrl+E" /></span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Spinner</h3>
    <div class="row">
      <Spinner size={12} /> <Spinner /> <Spinner size={24} /> <Spinner size={32} />
      <span class="accent"><Spinner /></span>
      <span class="k-hint row-in"><Spinner size={12} label="" /> Analysing video…</span>
    </div>
  </section>

  <section>
    <h3 class="k-caps">ProgressBar</h3>
    <div class="col">
      <ProgressBar value={progress} label="Exporting funscript" showValue />
      <div class="row"><Button size="sm" onclick={() => (progress = Math.max(0, progress - 0.1))}>−10%</Button><Button size="sm" onclick={() => (progress = Math.min(1, progress + 0.1))}>+10%</Button></div>
      <ProgressBar value={0} label="Queued" showValue />
      <ProgressBar value={1} tone="ok" label="Tracking complete" showValue />
      <ProgressBar value={0.8} tone="warn" label="Disk cache" showValue />
      <ProgressBar value={0.3} tone="bad" label="Upload failed at" showValue />
      <ProgressBar value={null} label="Analysing video" />
      <ProgressBar value={0.55} label="Bare track" />
      <ProgressBar value={null} label="Indeterminate, no head" aria-label="Loading" class="nohead" />
    </div>
  </section>

  <section>
    <h3 class="k-caps">Skeleton</h3>
    <div class="row top">
      <Skeleton width={160} height={90} />
      <div class="col narrowish"><Skeleton lines={3} /></div>
      <div class="col narrowish"><Skeleton width={120} /><Skeleton lines={2} width="80%" /></div>
    </div>
  </section>
</div>

<style>
  .demo { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); min-height: 100vh; }
  section { display: flex; flex-direction: column; gap: var(--space-4); }
  .row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap); }
  .row.top { align-items: flex-start; }
  .row-in { display: inline-flex; align-items: center; gap: var(--space-3); }
  .tag { width: 4.5em; flex: none; }
  .col { display: flex; flex-direction: column; gap: var(--space-5); max-width: 360px; }
  .narrowish { width: 200px; }
  .narrow { width: 180px; display: flex; flex-direction: column; align-items: flex-start; gap: var(--gap); padding: var(--space-4); border: var(--bw) dashed var(--line-2); }
  .accent { color: var(--accent-ink); display: inline-flex; }
</style>
