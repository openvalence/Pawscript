<script>
  import { tooltip } from '../tooltip.js';
  // EditorMock.svelte -- a realistic Pawscript editor built only from kit components, to judge the system as
  // a whole (outline §7). Not app code: no store, no commands; state is local and fake (mockdata.js).
  // Screenshot it full page: dev/kit.html#mock/full at 1280x800 and 1920x1080.
  import Button from '../Button.svelte';
  import Checkbox from '../Checkbox.svelte';
  import ColorSwatch from '../ColorSwatch.svelte';
  import Field from '../Field.svelte';
  import IconButton from '../IconButton.svelte';
  import MenuBar from '../MenuBar.svelte';
  import NumberField from '../NumberField.svelte';
  import PanelHeader from '../PanelHeader.svelte';
  import ParamForm from '../ParamForm.svelte';
  import Section from '../Section.svelte';
  import SegmentedControl from '../SegmentedControl.svelte';
  import Select from '../Select.svelte';
  import Slider from '../Slider.svelte';
  import SplitPane from '../SplitPane.svelte';
  import StatusBar from '../StatusBar.svelte';
  import StatusItem from '../StatusItem.svelte';
  import Switch from '../Switch.svelte';
  import Tabs from '../Tabs.svelte';
  import TextField from '../TextField.svelte';
  import ToggleButton from '../ToggleButton.svelte';
  import Toolbar from '../Toolbar.svelte';
  import MockCanvas from './MockCanvas.svelte';
  import { DURATION, makeScript, ghostOf, makeSlow, speedBins, CHAPTERS } from './mockdata.js';

  const script = makeScript(7);
  const ghosts = [
    { color: 'sky', script: ghostOf(script, 3, 60, 14) },
    { color: 'orange', script: ghostOf(script, 5, -90, 22), dash: [4, 3] },
  ];
  const roll = makeSlow();
  const bins = speedBins(script);

  let mode = $state('script');
  let tab = $state('edit');
  let tool = $state('pointer');
  let snap = $state('frame');
  let grid = $state(100);
  let speed = $state('1');
  let loop = $state(true);
  let playing = $state(false);
  let playhead = $state(42_317);
  let view = $state({ start: 39_200, span: 6_500 });
  let follow = $state(true);
  const selection = { t0: 40_150, t1: 41_650, p0: 0, p1: 100 };
  let pointAt = $state(40_512);
  let pointPos = $state(85);
  let chapterName = $state('Build');
  let chapterColor = $state('sky');
  let menuLog = $state('');

  const schema = [
    { key: 'pattern', label: 'Pattern', type: 'choice', default: 'sine', choices: [{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'bounce', label: 'Bounce' }], control: 'segmented', group: 'Shape' },
    { key: 'bpm', label: 'Tempo', type: 'float', default: 96, min: 20, max: 300, step: 0.5, unit: 'bpm', group: 'Shape' },
    { key: 'lo', label: 'Bottom', type: 'int', default: 10, min: 0, max: 100, unit: '%', group: 'Shape' },
    { key: 'hi', label: 'Top', type: 'int', default: 90, min: 0, max: 100, unit: '%', group: 'Shape' },
    { key: 'ease', label: 'Ease', type: 'float', default: 0.35, min: 0, max: 1, control: 'slider', group: 'Feel', hint: '0 = linear, 1 = full sine ease' },
    { key: 'jitter', label: 'Humanize', type: 'float', default: 0.1, min: 0, max: 1, control: 'slider', group: 'Feel' },
    { key: 'snapBeats', label: 'Snap to beats', type: 'bool', default: true, group: 'Feel' },
    { key: 'fill', label: 'Fill', type: 'choice', default: 'range', choices: [{ value: 'range', label: 'Selected range' }, { value: 'chapter', label: 'Current chapter' }, { value: 'loop', label: 'Loop region' }], group: 'Range' },
  ];
  let gen = $state({ pattern: 'sine', bpm: 96, lo: 10, hi: 90, ease: 0.35, jitter: 0.1, snapBeats: true, fill: 'range' });

  const menus = [
    { label: 'File', items: [
      { id: 'new', label: 'New project', icon: 'file', shortcut: 'Ctrl+N' },
      { id: 'open', label: 'Open…', icon: 'folder-open', shortcut: 'Ctrl+O' },
      { label: 'Open recent', items: [{ id: 'r1', label: 'fox_loop_v3.pawproj' }, { id: 'r2', label: 'otter-intro.mp4' }, { separator: true }, { id: 'rc', label: 'Clear recent' }] },
      { separator: true },
      { id: 'save', label: 'Save', icon: 'save', shortcut: 'Ctrl+S' },
      { id: 'saveas', label: 'Save as…', shortcut: 'Ctrl+Shift+S' },
      { label: 'Export', icon: 'export', items: [{ id: 'xf', label: 'Funscript (all axes)' }, { id: 'xs', label: 'Stroke only' }, { id: 'xc', label: 'CSV', disabled: true }] },
      { separator: true },
      { id: 'quit', label: 'Quit', shortcut: 'Ctrl+Q' },
    ] },
    { label: 'Edit', items: [
      { id: 'undo', label: 'Undo move 3 points', icon: 'undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', disabled: true },
      { separator: true },
      { id: 'cut', label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X' },
      { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C' },
      { id: 'paste', label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V' },
      { id: 'del', label: 'Delete', icon: 'delete', shortcut: 'Delete' },
      { separator: true },
      { id: 'all', label: 'Select all', shortcut: 'Ctrl+A' },
    ] },
    { label: 'View', items: [
      { section: 'Timeline' },
      { id: 'heat', label: 'Heatmap strip', type: 'checkbox', checked: true },
      { id: 'ghost', label: 'Ghost lanes', type: 'checkbox', checked: true },
      { id: 'wave', label: 'Audio waveform', type: 'checkbox', checked: false },
      { separator: true },
      { section: 'Zoom' },
      { id: 'zin', label: 'Zoom in', icon: 'zoom-in', shortcut: 'Ctrl+=' },
      { id: 'zout', label: 'Zoom out', icon: 'zoom-out', shortcut: 'Ctrl+-' },
      { id: 'zfit', label: 'Zoom to fit', icon: 'zoom-fit', shortcut: 'Ctrl+0' },
    ] },
    { label: 'Script', items: [
      { id: 'rep', label: 'Repeat last stroke', icon: 'duplicate', shortcut: 'Q' },
      { id: 'gen', label: 'Generate…', icon: 'wand' },
      { separator: true },
      { id: 'smooth', label: 'Smooth', icon: 'smooth' },
      { id: 'simp', label: 'Simplify', icon: 'simplify' },
      { id: 'flip', label: 'Invert', icon: 'flip' },
    ] },
    { label: 'Track', items: [
      { id: 'roi', label: 'Draw ROI', icon: 'roi' },
      { id: 'trk', label: 'Track current range', icon: 'target', shortcut: 'T' },
      { id: 'acc', label: 'Accept ghost', icon: 'check', disabled: true },
    ] },
    { label: 'Help', items: [
      { id: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?' },
      { id: 'about', label: 'About Pawscript', icon: 'info' },
    ] },
  ];

  const modes = [{ value: 'script', label: 'Script' }, { value: 'review', label: 'Review' }, { value: 'track', label: 'Track' }];
  const tools = [{ value: 'pointer', label: 'Pointer', icon: 'pointer', tip: 'Pointer (V)' }, { value: 'pen', label: 'Pen', icon: 'pen', tip: 'Pen (P)' }, { value: 'select', label: 'Box select', icon: 'select', tip: 'Box select (B)' }];
  const snaps = [{ value: 'frame', label: 'Frames' }, { value: '10', label: '10 ms' }, { value: 'beat', label: 'Beats' }, { value: 'off', label: 'Off' }];
  const speeds = ['0.25', '0.5', '0.75', '1', '1.5', '2'].map((v) => ({ value: v, label: v + '×' }));
  const tabs = [{ id: 'edit', label: 'Edit' }, { id: 'chapter', label: 'Chapter' }, { id: 'device', label: 'Device', badge: '1' }];

  const clock = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;

  // fake playback: the playhead walks at `speed`, the lanes follow
  $effect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const tick = (now) => {
      playhead = Math.min(DURATION, playhead + (now - last) * Number(speed));
      last = now;
      if (follow && playhead > view.start + view.span * 0.9) view = { ...view, start: playhead - view.span * 0.1 };
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
  const step = (d) => { playing = false; playhead = Math.max(0, playhead + d * (1000 / 60)); };

</script>

<div class="mock" data-testid="mock">
  <header class="top">
    <span class="logo" aria-hidden="true"></span>
    <MenuBar {menus} onselect={(it) => (menuLog = it.label)} />
    <span class="k-sep"></span>
    <SegmentedControl label="Mode" options={modes} value={mode} onchange={(v) => (mode = v)} size="sm" data-testid="mock-mode" />
    <span class="grow title"><span class="file">fox_loop_v3</span><span class="k-hint">.pawproj</span><span class="dirty" {@attach tooltip("Unsaved changes")}>●</span></span>
    <StatusItem icon="device" tone="ok" tip="Handy connected, 48 ms latency">Handy</StatusItem>
    <IconButton icon="settings" label="Settings" size="sm" />
  </header>

  <div class="main">
      <SplitPane direction="vertical" primary="second" defaultSize={Math.max(300, Math.round(innerHeight * 0.42))} min={220} minOther={160} label="Resize timeline">
        {#snippet first()}
          <SplitPane direction="horizontal" primary="second" defaultSize={320} min={260} minOther={320} collapsible label="Resize inspector">
            {#snippet first()}
              <section class="well" aria-label="Video">
                <div class="frame">
                  <div class="scene"></div>
                  <span class="tc k-num">{clock(playhead)} · f {Math.floor(playhead / (1000 / 60))}</span>
                  {#if mode === 'track'}
                    <div class="roi" style="left: 38%; top: 26%; width: 22%; height: 38%;">
                      <span class="roi-tag">ROI 1 · hips</span>
                      <i class="hd" style="left:-4px;top:-4px"></i><i class="hd" style="right:-4px;top:-4px"></i>
                      <i class="hd" style="left:-4px;bottom:-4px"></i><i class="hd" style="right:-4px;bottom:-4px"></i>
                    </div>
                    <div class="roi ghost" style="left: 18%; top: 48%; width: 14%; height: 22%;"><span class="roi-tag">ROI 2</span></div>
                  {/if}
                </div>
              </section>
            {/snippet}
            {#snippet second()}
              <aside class="inspector">
                <PanelHeader title="Inspector" icon="settings">
                  {#snippet actions()}<IconButton icon="more" label="Inspector options" size="sm" />{/snippet}
                </PanelHeader>
                <Tabs {tabs} value={tab} onchange={(v) => (tab = v)} label="Inspector" size="sm" class="insp-tabs">
                {#snippet children(tab)}
                <div class="insp-body k-scroll">
                  {#if tab === 'edit'}
                    <Section title="Selected point" count={3}>
                      <div class="pt-row">
                        <Field label="Time">
                          {#snippet children(f)}<NumberField id={f?.id} unit="ms" value={pointAt} min={0} max={DURATION} step={1} onchange={(v) => (pointAt = v)} data-testid="mock-time" />{/snippet}
                        </Field>
                        <Field label="Position">
                          {#snippet children(f)}<NumberField id={f?.id} unit="%" value={pointPos} min={0} max={100} onchange={(v) => (pointPos = v)} />{/snippet}
                        </Field>
                      </div>
                      <div class="btn-row">
                        <IconButton icon="arrow-left" label="Nudge earlier" shortcut="Alt+Left" variant="default" size="sm" />
                        <IconButton icon="arrow-right" label="Nudge later" shortcut="Alt+Right" variant="default" size="sm" />
                        <IconButton icon="arrow-up" label="Nudge up" shortcut="Alt+Up" variant="default" size="sm" />
                        <IconButton icon="arrow-down" label="Nudge down" shortcut="Alt+Down" variant="default" size="sm" />
                        <span class="grow"></span>
                        <Button icon="delete" variant="danger" size="sm">Delete</Button>
                      </div>
                    </Section>
                    <Section title="Stroke generator">
                      {#snippet actions()}<IconButton icon="refresh" label="Reset to defaults" size="sm" />{/snippet}
                      <ParamForm {schema} values={gen} compact onchange={(v) => (gen = v)} />
                      <div class="btn-row end">
                        <Button icon="eye">Preview</Button>
                        <Button variant="primary" icon="wand">Generate</Button>
                      </div>
                    </Section>
                    {#if mode === 'review'}
                      <Section title="Problems" count={3}>
                        <ul class="problems">
                          <li><span class="warn">▲</span> Speed 612 /s over device limit <span class="k-num k-hint">01:12.480</span></li>
                          <li><span class="warn">▲</span> Points 18 ms apart <span class="k-num k-hint">01:47.002</span></li>
                          <li><span class="info">●</span> Gap of 6.2 s <span class="k-num k-hint">02:31.900</span></li>
                        </ul>
                      </Section>
                    {/if}
                  {:else if tab === 'chapter'}
                    <Section title="Chapter">
                      <div class="form">
                        <TextField label="Name" value={chapterName} oninput={(v) => (chapterName = v)} />
                        <ColorSwatch label="Colour" value={chapterColor} onchange={(v) => (chapterColor = v)} />
                        <Switch label="Loop this chapter" checked={loop} onchange={(v) => (loop = v)} />
                      </div>
                    </Section>
                  {:else}
                    <Section title="Device">
                      <div class="form">
                        <Select label="Device" options={[{ value: 'handy', label: 'The Handy (Wi-Fi)' }, { value: 'osr', label: 'OSR2 (serial)' }]} value="handy" />
                        <Slider label="Latency offset" min={-200} max={200} value={48} showValue />
                        <Checkbox label="Live preview while scrubbing" checked />
                      </div>
                    </Section>
                  {/if}
                </div>
                {/snippet}
                </Tabs>
              </aside>
            {/snippet}
          </SplitPane>
        {/snippet}
        {#snippet second()}
          <section class="timeline" aria-label="Timeline">
            <div class="overview"><MockCanvas kind="overview" {bins} chapters={CHAPTERS} duration={DURATION} {view} {playhead} /></div>
            <div class="lane-tools">
              <Toolbar label="Lane tools">
                <SegmentedControl label="Tool" options={tools} value={tool} onchange={(v) => (tool = v)} />
                <span class="k-sep"></span>
                <NumberField label="Grid" unit="ms" value={grid} min={1} max={1000} onchange={(v) => (grid = v)} />
                <Select label="Snap" options={snaps} value={snap} onchange={(v) => (snap = v)} />
                <TextField label="Find" icon="search" placeholder="Find chapter or bookmark" />
                <Button icon="add" tip="Add point at playhead" shortcut="5">Add point</Button>
                <span class="grow"></span>
                <IconButton icon="zoom-out" label="Zoom out" shortcut="Ctrl+-" />
                <IconButton icon="zoom-in" label="Zoom in" shortcut="Ctrl+=" />
                <IconButton icon="zoom-fit" label="Zoom to fit" shortcut="Ctrl+0" />
              </Toolbar>
            </div>
            <div class="lanes">
              <div class="lane-row ruler"><div class="lane-head"></div><MockCanvas kind="ruler" {view} {playhead} /></div>
              <div class="lane-row stroke" data-active>
                <div class="lane-head">
                  <span class="lane-name">stroke</span>
                  <span class="k-hint k-num">1 284</span>
                  <span class="grow"></span>
                  <IconButton icon="eye" label="Hide lane" size="sm" />
                  <IconButton icon="unlock" label="Lock lane" size="sm" />
                  <div class="legend">
                    <span><i style="background: var(--series-sky)"></i>tracker run 2</span>
                    <span><i class="dash" style="color: var(--series-orange)"></i>reference</span>
                  </div>
                </div>
                <MockCanvas kind="lane" {script} {ghosts} {view} {playhead} {selection} data-testid="mock-lane" />
              </div>
              <div class="lane-row roll">
                <div class="lane-head"><span class="lane-name">roll</span><span class="grow"></span><IconButton icon="eye" label="Hide lane" size="sm" /><IconButton icon="lock" label="Unlock lane" size="sm" pressed /></div>
                <MockCanvas kind="lane" script={roll} {view} {playhead} />
              </div>
              <div class="lane-row twist">
                <div class="lane-head"><IconButton icon="chevron-right" label="Expand twist" size="sm" /><span class="lane-name">twist</span><span class="k-hint">collapsed · empty</span></div>
                <div class="collapsed"></div>
              </div>
            </div>
            <div class="transport">
              <Toolbar label="Transport">
                <IconButton icon="skip-back" label="Previous point" shortcut="," />
                <IconButton icon="step-back" label="Frame back" shortcut="Left" onclick={() => step(-1)} />
                <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} shortcut="Space" variant="primary" onclick={() => (playing = !playing)} data-testid="mock-play" />
                <IconButton icon="step-forward" label="Frame forward" shortcut="Right" onclick={() => step(1)} />
                <IconButton icon="skip-forward" label="Next point" shortcut="." />
                <span class="k-sep"></span>
                <ToggleButton icon="loop" label="Loop" tip="Loop region" shortcut="L" pressed={loop} onchange={(v) => (loop = v)} />
                <Select label="Speed" options={speeds} value={speed} onchange={(v) => (speed = v)} size="sm" />
                <span class="k-sep"></span>
                <span class="readout"><span class="k-num now">{clock(playhead)}</span><span class="slash">/</span><span class="k-num dur">{clock(DURATION)}</span></span>
                <span class="grow"></span>
                <ToggleButton icon="target" label="Follow playhead" pressed={follow} onchange={(v) => (follow = v)} />
                <IconButton icon="volume" label="Mute" shortcut="Ctrl+M" />
              </Toolbar>
            </div>
          </section>
        {/snippet}
      </SplitPane>
  </div>

  <StatusBar>
    <StatusItem icon="check" tone="ok">Saved 12 s ago</StatusItem>
    <StatusItem icon="film">1920×1080 · 60 fps CFR</StatusItem>
    <StatusItem icon="stroke">stroke · 1 284 points</StatusItem>
    <StatusItem icon="select">3 selected</StatusItem>
    {#snippet end()}
      {#if menuLog}<StatusItem icon="info">{menuLog}</StatusItem>{/if}
      <StatusItem icon="warning" tone="warn" tip="2 problems in this script" onclick={() => (mode = 'review')}>2 problems</StatusItem>
      <StatusItem icon="device" tone="ok">Handy · 48 ms</StatusItem>
    {/snippet}
  </StatusBar>
</div>

<style>
  .mock { display: flex; flex-direction: column; flex: 1; min-height: 0; height: 100%; background: var(--bg); color: var(--tx); overflow: hidden; }
  .grow { flex: 1; min-width: 0; }
  .top {
    flex: none; display: flex; align-items: center; gap: var(--space-4); height: calc(var(--ctl-h) + var(--space-4));
    padding: 0 var(--space-4); background: var(--bg-raised); border-bottom: var(--bw) solid var(--line-1);
  }
  .logo { width: 14px; height: 14px; border: 2px solid var(--highlight); border-radius: var(--radius); transform: rotate(45deg); flex: none; margin: 0 var(--space-2); }
  .title { display: flex; justify-content: center; align-items: baseline; gap: 0; white-space: nowrap; overflow: hidden; }
  .file { color: var(--tx-hi); }
  .dirty { color: var(--intent); font-size: var(--fs-1); margin-left: var(--space-3); }
  .main { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  .well { height: 100%; display: grid; place-items: center; background: var(--bg-sunken); padding: var(--space-5); min-width: 0; min-height: 0; overflow: hidden; }
  .frame { position: relative; aspect-ratio: 16 / 9; height: 100%; max-width: 100%; max-height: 100%; outline: var(--bw) solid var(--line-1); }
  .scene {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 30% 45% at 48% 46%, color-mix(in oklab, var(--series-orange) 55%, transparent), transparent 70%),
      radial-gradient(ellipse 40% 30% at 25% 70%, color-mix(in oklab, var(--series-violet) 40%, transparent), transparent 70%),
      radial-gradient(circle at 80% 20%, color-mix(in oklab, var(--series-sky) 30%, transparent), transparent 45%),
      repeating-linear-gradient(90deg, transparent 0 39px, color-mix(in oklab, var(--tx-faint) 50%, transparent) 39px 40px),
      linear-gradient(170deg, var(--line-3), var(--bg-active) 60%, var(--line-1));
  }
  .tc { position: absolute; left: var(--space-3); top: var(--space-3); padding: 0 var(--space-2); font-size: var(--fs-1); color: var(--tx-hi); background: var(--scrim); }
  .roi { position: absolute; border: var(--bw) solid var(--reality); box-shadow: 0 0 0 1px rgba(var(--shade-rgb), .5); }
  .roi.ghost { border-style: dashed; border-color: var(--intent); }
  .roi-tag { position: absolute; left: -1px; bottom: 100%; padding: 0 var(--space-2); font-size: var(--fs-1); line-height: 16px; white-space: nowrap; background: var(--reality); color: var(--on-accent); }
  .roi.ghost .roi-tag { background: var(--intent); }
  .hd { position: absolute; width: 7px; height: 7px; background: var(--bg-sunken); border: var(--bw) solid var(--reality); }

  .inspector { height: 100%; display: flex; flex-direction: column; min-width: 0; background: var(--bg); border-left: var(--bw) solid var(--line-1); }
  .inspector > :global(.insp-tabs) { flex: 1; min-height: 0; }
  .insp-body { height: 100%; min-height: 0; overflow: auto; }
  .pt-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
  .btn-row { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); }
  .btn-row.end { justify-content: flex-end; gap: var(--gap); }
  .form { display: grid; gap: var(--space-4); }
  .problems { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .problems li { display: flex; gap: var(--space-3); align-items: baseline; }
  .problems .k-hint { margin-left: auto; }
  .warn { color: var(--warn-ink); font-size: var(--fs-1); }
  .info { color: var(--info-ink); font-size: var(--fs-1); }

  .timeline { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--bg); border-top: var(--bw) solid var(--line-1); }
  .overview { flex: none; height: 30px; display: flex; border-bottom: var(--bw) solid var(--line-1); }
  .lane-tools, .transport { flex: none; display: flex; align-items: center; padding: var(--space-2) var(--space-3); background: var(--bg-raised); }
  .lane-tools { border-bottom: var(--bw) solid var(--line-1); }
  .lane-tools > :global(*), .transport > :global(*) { flex: 1; min-width: 0; }
  .transport { border-top: var(--bw) solid var(--line-1); }
  .readout { white-space: nowrap; padding: 0 var(--space-3); }
  .now { color: var(--tx-hi); font-size: var(--fs-4); }
  .dur { color: var(--tx-mut); }
  .slash { color: var(--tx-mut); margin: 0 var(--space-3); }

  .lanes { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .lane-row { display: flex; min-height: 0; border-bottom: var(--bw) solid var(--line-1); }
  .lane-row.ruler { flex: none; height: 20px; }
  .lane-row.stroke { flex: 1 1 120px; min-height: 96px; }
  .lane-row.roll { flex: 0 0 64px; }
  .lane-row.twist { flex: 0 0 var(--row-h); }
  .lane-head {
    flex: none; width: 168px; display: flex; flex-wrap: wrap; align-content: flex-start; align-items: center; gap: var(--space-1) var(--space-3);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4); background: var(--bg-raised); border-right: var(--bw) solid var(--line-1); position: relative;
  }
  .ruler .lane-head { padding: 0; }
  .lane-row[data-active] .lane-head::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--focus); }
  .lane-name { color: var(--tx-hi); }
  .twist .lane-head { padding-left: var(--space-1); align-content: center; gap: var(--space-3); }
  .collapsed { flex: 1; background: var(--bg-sunken); }
  .legend { flex-basis: 100%; display: grid; gap: 0; margin-top: var(--space-2); font-size: var(--fs-1); color: var(--tx-mut); }
  .legend span { display: flex; align-items: center; gap: var(--space-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend i { width: 12px; height: 2px; flex: none; }
  .legend i.dash { background: repeating-linear-gradient(90deg, currentColor 0 4px, transparent 4px 7px); }
</style>
