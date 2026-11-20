<script>
  import Select from '../Select.svelte';
  import ComboBox from '../ComboBox.svelte';
  import Menu from '../Menu.svelte';
  import MenuBar from '../MenuBar.svelte';
  import ContextMenu from '../ContextMenu.svelte';
  import { contextMenu } from '../contextmenu.js';
  import { shortcutText } from '../keys.js';
  import Button from '../Button.svelte';
  import TextField from '../TextField.svelte';
  import Checkbox from '../Checkbox.svelte';

  const sizes = ['sm', 'md', 'lg'];
  let log = $state('—');
  const note = (what) => (v) => (log = `${what}: ${v && typeof v === 'object' ? v.label ?? v.id : v}`);

  // ---- Select ----
  let snap = $state('frame');
  let interp = $state('cubic');
  let device = $state();
  let axis = $state('stroke');
  let chapter = $state(42);
  let longPick = $state('a');
  const snapOpts = [
    { value: 'off', label: 'No snapping' },
    { value: 'frame', label: 'Video frames', hint: '30 fps' },
    { value: 'beat', label: 'Beats', hint: '120 bpm' },
    { value: 'grid', label: 'Time grid', hint: '50 ms' },
    { value: 'points', label: 'Other axes’ points', disabled: true },
  ];
  const interpOpts = [
    { value: 'linear', label: 'Linear', icon: 'stroke' },
    { value: 'cubic', label: 'Cubic', icon: 'wave' },
    { value: 'step', label: 'Step', icon: 'grid' },
    { value: 'bezier', label: 'Bezier (custom handles)', icon: 'pen', disabled: true },
  ];
  const deviceOpts = [
    { label: 'Wi-Fi', options: [{ value: 'handy', label: 'The Handy' }, { value: 'keon', label: 'Keon (via Intiface)' }] },
    { label: 'Serial', options: [{ value: 'osr2', label: 'OSR2', hint: 'COM3' }, { value: 'sr6', label: 'SR6', hint: 'COM4' }] },
    { label: 'Other', options: [{ value: 'sim', label: 'Simulator' }] },
  ];
  const axisOpts = ['stroke', 'surge', 'sway', 'twist', 'roll', 'pitch'].map((v) => ({ value: v, label: v }));
  const pad = (n) => String(n).padStart(2, '0');
  const chapters = Array.from({ length: 300 }, (_, i) => ({
    value: i + 1, label: `Chapter ${i + 1}`, hint: `${pad(Math.floor((i * 37) / 60))}:${pad((i * 37) % 60)}`, disabled: i % 41 === 7,
  }));
  const longOpts = [
    { value: 'a', label: 'Export every axis as a separate funscript beside the video file' },
    { value: 'b', label: 'Bundle all axes into one multi-axis .funscript (OSR / MFP format)' },
  ];

  // ---- ComboBox ----
  const commands = [
    ['file.open', 'Open project…', 'Ctrl+O'], ['file.save', 'Save', 'Ctrl+S'], ['file.saveAs', 'Save as…', 'Ctrl+Shift+S'],
    ['file.export', 'Export funscript…', 'Ctrl+E'], ['edit.undo', 'Undo', 'Ctrl+Z'], ['edit.redo', 'Redo', 'Ctrl+Shift+Z'],
    ['edit.selectAll', 'Select all points', 'Ctrl+A'], ['edit.invertSel', 'Invert selection', 'Ctrl+I'],
    ['script.smooth', 'Smooth selection…', 'Alt+S'], ['script.simplify', 'Simplify selection…', 'Alt+Shift+S'],
    ['script.invert', 'Invert positions', 'Ctrl+Alt+I'], ['script.offset', 'Offset in time…', ''],
    ['script.normalize', 'Normalize range…', ''], ['view.heatmap', 'Toggle heatmap', 'H'],
    ['view.zoomFit', 'Zoom to fit', 'Ctrl+0'], ['view.zoomIn', 'Zoom in', 'Ctrl+='], ['track.addAxis', 'Add axis…', ''],
    ['track.lock', 'Lock track', 'Ctrl+L'], ['help.palette', 'Command palette', 'Ctrl+Shift+P'],
    ['help.keys', 'Keyboard shortcuts', 'Ctrl+K Ctrl+S'], ['transport.play', 'Play / pause', 'Space'],
    ['transport.nextChapter', 'Next chapter', 'Ctrl+ArrowRight'], ['transport.prevChapter', 'Previous chapter', 'Ctrl+ArrowLeft'],
  ].map(([value, label, k]) => ({ value, label, hint: k ? shortcutText(k) : undefined }));
  let command = $state();
  let axisName = $state('twist');

  // ---- Menu ----
  let menuOpen = $state(false), menuAnchor = $state();
  let pinned = $state(false), pinOpen = $state(false), pinAnchor = $state();
  let edgeOpen = $state(false), edgeAnchor = $state();
  let heat = $state(true), wave = $state(false), chaptersOn = $state(true);
  let interpMode = $state('cubic');
  const pointItems = () => [
    { section: 'Point' },
    { id: 'cut', label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X' },
    { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C' },
    { id: 'paste', label: 'Paste at playhead', icon: 'paste', shortcut: 'Ctrl+Shift+V' },
    { id: 'dup', label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', disabled: true },
    { id: 'del', label: 'Delete', icon: 'delete', shortcut: 'Del' },
    { separator: true },
    { label: 'Transform', icon: 'wand', items: [
      { id: 'smooth', label: 'Smooth…', icon: 'smooth', shortcut: 'Alt+S' },
      { id: 'simplify', label: 'Simplify…', icon: 'simplify', shortcut: 'Alt+Shift+S' },
      { id: 'flip', label: 'Invert positions', icon: 'flip', shortcut: 'Ctrl+Alt+I' },
      { separator: true },
      { label: 'Generate', icon: 'wave', items: [
        { id: 'sine', label: 'Sine' },
        { id: 'saw', label: 'Sawtooth' },
        { label: 'Bounce', items: [
          { id: 'soft', label: 'Soft' }, { id: 'hard', label: 'Hard' }, { id: 'random', label: 'Random amplitude', shortcut: 'Ctrl+Shift+Alt+R' },
        ] },
        { id: 'fromAudio', label: 'From audio beats', disabled: true },
      ] },
    ] },
    { section: 'Interpolation' },
    ...['linear', 'cubic', 'step'].map((v) => ({ id: 'interp-' + v, label: v[0].toUpperCase() + v.slice(1), type: 'radio', checked: interpMode === v, run: () => (interpMode = v) })),
    { section: 'Show' },
    { id: 'heat', label: 'Heatmap', type: 'checkbox', checked: heat, shortcut: 'H', run: () => (heat = !heat) },
    { id: 'wave', label: 'Audio waveform', type: 'checkbox', checked: wave, shortcut: 'W', run: () => (wave = !wave) },
    { id: 'chap', label: 'Chapter names on the timeline above every lane', type: 'checkbox', checked: chaptersOn, run: () => (chaptersOn = !chaptersOn) },
    { separator: true },
    { id: 'props', label: 'Point properties…', icon: 'settings', shortcut: 'Alt+Enter' },
  ];
  const edgeItems = [
    { id: 'export', label: 'Export funscript…', icon: 'export', shortcut: 'Ctrl+E' },
    { label: 'Export as', icon: 'download', items: [{ id: 'csv', label: 'CSV' }, { id: 'json', label: 'Raw JSON' }, { id: 'png', label: 'Heatmap PNG' }] },
    { separator: true },
    { id: 'reveal', label: 'Reveal in folder', icon: 'folder-open' },
  ];

  // ---- context menu ----
  const laneItems = (e) => {
    const r = e.currentTarget?.getBoundingClientRect?.();
    const t = r && e.clientX ? (((e.clientX - r.left) / r.width) * 60).toFixed(2) : 'playhead';
    return [
      { section: `At ${t}${t === 'playhead' ? '' : ' s'}` },
      { id: 'add', label: 'Add point here', icon: 'add', shortcut: 'A' },
      { id: 'marker', label: 'Add chapter marker', icon: 'marker', shortcut: 'M' },
      { separator: true },
      { id: 'pasteHere', label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V' },
      { id: 'selectAllCtx', label: 'Select all on this axis', shortcut: 'Ctrl+A' },
      { label: 'Snap', icon: 'magnet', items: snapOpts.map((o) => ({ id: 'snap-' + o.value, label: o.label, type: 'radio', checked: snap === o.value, disabled: o.disabled, run: () => (snap = o.value) })) },
    ];
  };

  // ---- MenuBar ----
  let theme = $state('dark');
  const menus = $derived([
    { label: 'File', items: [
      { id: 'new', label: 'New project', icon: 'file', shortcut: 'Ctrl+N' },
      { id: 'open', label: 'Open…', icon: 'folder-open', shortcut: 'Ctrl+O' },
      { label: 'Open recent', items: [
        { id: 'r1', label: 'beach-walk.funscript' }, { id: 'r2', label: 'interview_take3.pawproj' },
        { id: 'r3', label: 'a-very-long-project-name-from-the-archive-2024-final-final.pawproj' },
        { separator: true }, { id: 'clearRecent', label: 'Clear recent' },
      ] },
      { separator: true },
      { id: 'save', label: 'Save', icon: 'save', shortcut: 'Ctrl+S' },
      { id: 'saveAs', label: 'Save as…', shortcut: 'Ctrl+Shift+S' },
      { label: 'Import', icon: 'import', items: [{ id: 'impFs', label: 'Funscript…' }, { id: 'impCsv', label: 'CSV…' }, { id: 'impVideo', label: 'Video…', shortcut: 'Ctrl+Shift+O' }] },
      { label: 'Export', icon: 'export', items: [{ id: 'expFs', label: 'Funscript…', shortcut: 'Ctrl+E' }, { id: 'expBundle', label: 'Multi-axis bundle…' }, { id: 'expHeat', label: 'Heatmap image…' }] },
      { separator: true },
      { id: 'close', label: 'Close project', shortcut: 'Ctrl+W' },
      { id: 'quit', label: 'Quit', shortcut: 'Ctrl+Q' },
    ] },
    { label: 'Edit', items: [
      { id: 'undo', label: 'Undo add point', icon: 'undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Shift+Z', disabled: true },
      { separator: true },
      { id: 'cutE', label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X' },
      { id: 'copyE', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C' },
      { id: 'pasteE', label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V' },
      { id: 'delE', label: 'Delete', icon: 'delete', shortcut: 'Del' },
      { separator: true },
      { id: 'selAll', label: 'Select all', icon: 'select', shortcut: 'Ctrl+A' },
      { label: 'Select', items: [{ id: 'selRange', label: 'In range', shortcut: 'Ctrl+Shift+A' }, { id: 'selPeaks', label: 'Peaks' }, { id: 'selValleys', label: 'Valleys' }, { separator: true }, { id: 'selInv', label: 'Invert selection', shortcut: 'Ctrl+I' }] },
      { separator: true },
      { id: 'prefs', label: 'Preferences…', icon: 'settings', shortcut: 'Ctrl+,' },
    ] },
    { label: 'View', items: [
      { id: 'zin', label: 'Zoom in', icon: 'zoom-in', shortcut: 'Ctrl+=' },
      { id: 'zout', label: 'Zoom out', icon: 'zoom-out', shortcut: 'Ctrl+-' },
      { id: 'zfit', label: 'Zoom to fit', icon: 'zoom-fit', shortcut: 'Ctrl+0' },
      { separator: true },
      { section: 'Timeline' },
      { id: 'vheat', label: 'Heatmap', type: 'checkbox', checked: heat, shortcut: 'H', run: () => (heat = !heat) },
      { id: 'vwave', label: 'Waveform', type: 'checkbox', checked: wave, shortcut: 'W', run: () => (wave = !wave) },
      { id: 'vchap', label: 'Chapters', type: 'checkbox', checked: chaptersOn, run: () => (chaptersOn = !chaptersOn) },
      { separator: true },
      { label: 'Theme', icon: 'contrast', items: [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast']].map(([v, l]) => ({ id: 'theme-' + v, label: l, type: 'radio', checked: theme === v, run: () => (theme = v) })) },
      { label: 'Panels', icon: 'layers', items: [{ id: 'pInspector', label: 'Inspector', type: 'checkbox', checked: true, shortcut: 'Ctrl+Alt+1' }, { id: 'pHistory', label: 'History', type: 'checkbox', checked: false, shortcut: 'Ctrl+Alt+2' }, { id: 'pMarkers', label: 'Markers', type: 'checkbox', checked: true, shortcut: 'Ctrl+Alt+3' }] },
      { id: 'full', label: 'Full screen', icon: 'maximize', shortcut: 'F11' },
    ] },
    { label: 'Script', items: [
      { id: 'addPt', label: 'Add point at playhead', icon: 'add', shortcut: 'A' },
      { id: 'smoothS', label: 'Smooth…', icon: 'smooth', shortcut: 'Alt+S' },
      { id: 'simplifyS', label: 'Simplify…', icon: 'simplify', shortcut: 'Alt+Shift+S' },
      { id: 'invertS', label: 'Invert', icon: 'flip', shortcut: 'Ctrl+Alt+I' },
      { id: 'offsetS', label: 'Offset in time…', icon: 'clock' },
      { separator: true },
      { label: 'Range', icon: 'ruler', items: [{ id: 'rin', label: 'Set in point', shortcut: 'I' }, { id: 'rout', label: 'Set out point', shortcut: 'O' }, { id: 'rclear', label: 'Clear range', shortcut: 'Alt+X' }] },
      { label: 'Generators', icon: 'wave', items: [
        { id: 'gSine', label: 'Sine' }, { id: 'gSaw', label: 'Sawtooth' },
        { label: 'Bounce', items: [{ id: 'gSoft', label: 'Soft' }, { id: 'gHard', label: 'Hard' }] },
      ] },
    ] },
    { label: 'Track', items: [
      { label: 'Add axis', icon: 'add', items: ['Roll', 'Pitch', 'Twist', 'Surge', 'Sway'].map((a) => ({ id: 'axis-' + a, label: a })) },
      { id: 'renameT', label: 'Rename axis…', icon: 'pen', shortcut: 'F2' },
      { id: 'lockT', label: 'Lock track', icon: 'lock', type: 'checkbox', checked: false, shortcut: 'Ctrl+L' },
      { id: 'muteT', label: 'Mute device output', icon: 'mute', type: 'checkbox', checked: true },
      { separator: true },
      { id: 'removeT', label: 'Remove track', icon: 'delete', shortcut: 'Ctrl+Shift+Del' },
    ] },
    { label: 'Help', items: [
      { id: 'palette', label: 'Command palette', icon: 'command', shortcut: 'Ctrl+Shift+P' },
      { id: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: 'Ctrl+K Ctrl+S' },
      { id: 'docs', label: 'Documentation', icon: 'external' },
      { separator: true },
      { id: 'about', label: 'About Pawscript', icon: 'info' },
    ] },
  ]);

  // Pinned: re-opens whenever it closes, so a screenshot can catch it (and its submenus) at rest.
  function pinClosed() {
    if (pinned) setTimeout(() => (pinOpen = pinned));
  }
</script>

<div class="demo">
  <MenuBar {menus} onselect={note('menubar')} data-test="menubar" class="bar" />

  <p class="k-hint">Last event: <span class="k-num" data-test="log">{log}</span></p>

  <section>
    <h3 class="k-caps">Select: row alignment with TextField and Button (sm / md / lg)</h3>
    {#each sizes as s}
      <div class="row" data-test="align-{s}">
        <TextField size={s} value="Chapter 1" label="Name" />
        <Select size={s} options={snapOpts} bind:value={snap} label="Snap" onchange={note('snap')} />
        <Select size={s} options={snapOpts} placeholder="Placeholder" label="Empty" />
        <Button size={s}>Apply</Button>
      </div>
    {/each}
  </section>

  <section>
    <h3 class="k-caps">Select: states</h3>
    <div class="row">
      <Select options={interpOpts} bind:value={interp} label="Interpolation" data-test="sel-icons" onchange={note('interp')} />
      <Select options={deviceOpts} bind:value={device} placeholder="Choose a device…" label="Device" data-test="sel-groups" onchange={note('device')} />
      <Select options={axisOpts} bind:value={axis} label="Axis" invalid />
      <Select options={axisOpts} value="roll" label="Disabled" disabled />
      <Select options={chapters} bind:value={chapter} label="Chapter" data-test="sel-300" onchange={note('chapter')} />
    </div>
    <div class="narrow"><Select full options={longOpts} bind:value={longPick} label="Export mode" data-test="sel-long" /></div>
  </section>

  <section>
    <h3 class="k-caps">ComboBox</h3>
    <div class="row">
      <ComboBox options={commands} bind:value={command} placeholder="Run a command…" label="Command" data-test="combo" onchange={note('command')} />
      <ComboBox options={axisOpts} bind:value={axisName} allowCustom label="Axis name" data-test="combo-custom" onchange={note('axis')} />
      <ComboBox options={axisOpts} value="roll" label="Disabled" disabled />
    </div>
    <div class="row">
      {#each sizes as s}<ComboBox size={s} options={axisOpts} placeholder="Size {s}" label="Size {s}" />{/each}
    </div>
  </section>

  <section>
    <h3 class="k-caps">Menu</h3>
    <div class="row">
      <Button iconRight="chevron-down" aria-haspopup="menu" aria-expanded={menuOpen} data-test="menu-btn"
        onclick={(e) => { menuAnchor = e.currentTarget; menuOpen = !menuOpen; }}>Point actions</Button>
      <Menu bind:open={menuOpen} anchor={menuAnchor} items={pointItems()} onselect={note('menu')} label="Point actions" data-test="menu" />

      <span bind:this={pinAnchor} class="pin-anchor"><Checkbox bind:checked={pinned} onchange={(c) => (pinOpen = c)} label="Pin open (for screenshots)" data-test="pin" /></span>
      {#if pinAnchor}<Menu bind:open={pinOpen} anchor={pinAnchor} items={pointItems()} onselect={note('pinned')} onclose={pinClosed} placement="bottom-start" label="Pinned menu" />{/if}
    </div>
  </section>

  <section>
    <h3 class="k-caps">Context menu</h3>
    <div class="row top">
      <ContextMenu items={laneItems} onselect={note('context')} class="target" tabindex="0" data-test="ctx" aria-label="Lane: right-click or Shift+F10">
        <span class="k-hint">Lane: right-click, or focus and press Shift+F10</span>
      </ContextMenu>
      <button type="button" class="chip k-ring" data-test="ctx-attach" {@attach contextMenu([{ id: 'rename', label: 'Rename…', icon: 'pen', shortcut: 'F2' }, { id: 'remove', label: 'Remove', icon: 'delete', shortcut: 'Del' }], { onselect: note('chip') })}>
        Attachment on a button
      </button>
    </div>
  </section>

  <Button class="edge" iconRight="chevron-up" aria-haspopup="menu" aria-expanded={edgeOpen} data-test="edge-btn"
    onclick={(e) => { edgeAnchor = e.currentTarget; edgeOpen = !edgeOpen; }}>Edge</Button>
  <Menu bind:open={edgeOpen} anchor={edgeAnchor} items={edgeItems} onselect={note('edge')} label="Export" data-test="edge-menu" />
</div>

<style>
  .demo { display: flex; flex-direction: column; gap: var(--space-7); padding: var(--space-6); padding-bottom: calc(var(--space-8) * 3); }
  section { display: flex; flex-direction: column; gap: var(--space-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap); }
  .row.top { align-items: flex-start; gap: var(--space-7); }
  .narrow { width: calc(var(--space-8) * 7); padding: var(--space-2); border: 1px dashed var(--line-2); }
  .demo :global(.bar) { margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-6)) 0; padding: 0 var(--space-4); background: var(--bg-raised); border-bottom: 1px solid var(--line-1); }
  .pin-anchor { display: inline-flex; margin-left: var(--space-7); }
  .demo :global(.target) {
    display: grid; place-items: center; width: calc(var(--space-8) * 14); height: calc(var(--space-8) * 4);
    background: var(--bg-sunken); border: 1px dashed var(--line-3); border-radius: var(--radius); outline: none;
  }
  .demo :global(.target:focus-visible) { border: 1px solid var(--focus); }
  .chip { height: var(--ctl-h); padding: 0 var(--pad-x); font: inherit; color: var(--tx); background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); }
  .demo :global(.edge) { position: fixed; right: var(--space-4); bottom: var(--space-4); }
</style>
