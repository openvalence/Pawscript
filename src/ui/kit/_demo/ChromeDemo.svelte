<script>
  import Tabs from '../Tabs.svelte';
  import Section from '../Section.svelte';
  import PanelHeader from '../PanelHeader.svelte';
  import Toolbar from '../Toolbar.svelte';
  import StatusBar from '../StatusBar.svelte';
  import StatusItem from '../StatusItem.svelte';
  import EmptyState from '../EmptyState.svelte';
  import IconButton from '../IconButton.svelte';
  import ToggleButton from '../ToggleButton.svelte';
  import Button from '../Button.svelte';
  import Switch from '../Switch.svelte';
  import SegmentedControl from '../SegmentedControl.svelte';

  const sideTabs = [
    { id: 'inspector', label: 'Inspector', icon: 'settings' },
    { id: 'problems', label: 'Problems', icon: 'warning', badge: 12, badgeTone: 'warn' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'tracking', label: 'Tracking', icon: 'target', disabled: true },
  ];
  const manyTabs = ['Inspector', 'Problems', 'History', 'Markers', 'Chapters', 'Tracking', 'Heatmap', 'Output', 'Devices']
    .map((l) => ({ id: l.toLowerCase(), label: l }));
  manyTabs[1].badge = 3;
  manyTabs[6].disabled = true;

  const dockTabs = [
    { id: 'inspector', label: 'Inspector', icon: 'settings' },
    { id: 'problems', label: 'Problems', icon: 'warning', badge: 12, badgeTone: 'warn' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'markers', label: 'Markers', icon: 'marker' },
    { id: 'tracking', label: 'Tracking', icon: 'target', disabled: true },
    { id: 'output', label: 'Output', icon: 'log' },
  ];
  let dock = $state('inspector');
  let tab = $state('inspector');
  let many = $state('chapters');
  let small = $state('a');
  let timingOpen = $state(true);
  let outputOpen = $state(false);
  let histCollapsed = $state(false);
  let tool = $state('select');
  let snap = $state(true);
  let ripple = $state(false);
  let toolSeg = $state('pointer');
  let invert = $state(false);
  let clicks = $state(0);

  const toolOpts = [{ value: 'pointer', label: 'Pointer', icon: 'pointer' }, { value: 'pen', label: 'Pen', icon: 'pen' }, { value: 'select', label: 'Select', icon: 'select' }];
</script>

{#snippet rows(items)}
  <dl class="rows">
    {#each items as [k, v]}<dt>{k}</dt><dd class="k-num">{v}</dd>{/each}
  </dl>
{/snippet}

<div class="demo">
  <section>
    <h3 class="k-caps">Tabs</h3>
    <div class="row">
      <div class="panel w420" data-testid="tabs-main">
        <Tabs label="Side panel" tabs={sideTabs} bind:value={tab}>
          {#snippet children(id)}
            <div class="pad">
              {#if id === 'inspector'}<p class="note">Point 128 · 01:23.456 · pos 72</p>
              {:else if id === 'problems'}<p class="note">12 problems: 9 speed, 3 gaps</p>
              {:else}<p class="note">47 edits since open</p>{/if}
            </div>
          {/snippet}
        </Tabs>
      </div>
      <div class="panel w240" data-testid="tabs-many">
        <Tabs label="Many tabs" tabs={manyTabs} bind:value={many}>
          {#snippet children(id)}<div class="pad"><p class="note">Panel: {id}</p></div>{/snippet}
        </Tabs>
      </div>
      <div class="panel w240" data-testid="tabs-sm">
        <Tabs label="Small" size="sm" tabs={[{ id: 'a', label: 'Script' }, { id: 'b', label: 'Review', badge: 'new', badgeTone: 'accent' }, { id: 'c', label: 'Track' }]} bind:value={small} />
      </div>
    </div>
    <p class="note cap">Narrow dock strips (sm): the overflow menu lists every tab; <code>overflow="scroll"</code> keeps only the fades.</p>
    <div class="row">
      <div class="panel w180" data-testid="tabs-narrow">
        <Tabs label="Dock panels" size="sm" tabs={dockTabs} bind:value={dock} />
      </div>
      <div class="panel w240" data-testid="tabs-narrow-md">
        <Tabs label="Dock panels (md)" tabs={dockTabs} bind:value={dock} />
      </div>
      <div class="panel w180" data-testid="tabs-narrow-scroll">
        <Tabs label="Dock panels (scroll)" size="sm" overflow="scroll" tabs={dockTabs} bind:value={dock} />
      </div>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Sections (param accordion)</h3>
    <div class="row">
      <div class="panel w300" data-testid="accordion">
        <PanelHeader title="Generator" icon="wave">
          {#snippet actions()}
            <IconButton size="sm" icon="refresh" label="Reset all" />
            <IconButton size="sm" icon="more" label="More" />
          {/snippet}
        </PanelHeader>
        <Section title="Timing" count={4} bind:open={timingOpen} data-testid="sec-timing">
          {#snippet actions()}<IconButton size="sm" icon="refresh" label="Reset timing" />{/snippet}
          {@render rows([['Start', '00:12.000'], ['End', '01:48.250'], ['Tempo', '96 bpm'], ['Swing', '0.12']])}
          <div class="more"><Button size="sm" icon="add">Add beat</Button></div>
        </Section>
        <Section title="Shape" count={3}>
          {#snippet actions()}
            <IconButton size="sm" icon="refresh" label="Reset shape" />
            <IconButton size="sm" icon="more" label="Shape options" />
          {/snippet}
          {@render rows([['Curve', 'sine'], ['Depth', '0–100'], ['Phase', '0.25']])}
        </Section>
        <Section title="Output" count={2} bind:open={outputOpen} data-testid="sec-output">
          {@render rows([['Points', '1 284'], ['Peak speed', '412 u/s']])}
          <div class="more"><Switch label="Invert" bind:checked={invert} /></div>
        </Section>
        <Section title="A very long section title that has to ellipsize" count={128} open={false}>
          <p class="note">Hidden.</p>
        </Section>
      </div>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Panel headers</h3>
    <div class="row">
      <div class="panel w300 stack">
        <PanelHeader title="Inspector" icon="settings">
          {#snippet actions()}<IconButton size="sm" icon="close" label="Close panel" />{/snippet}
        </PanelHeader>
        <PanelHeader title="Markers" />
        <PanelHeader title="History" icon="history" bind:collapsed={histCollapsed} controls="hist-body" data-testid="ph-collapse">
          {#snippet actions()}<IconButton size="sm" icon="delete" label="Clear history" />{/snippet}
        </PanelHeader>
        <div id="hist-body" class="pad" hidden={histCollapsed}><p class="note">47 edits since open</p></div>
      </div>
      <div class="panel w180 stack">
        <PanelHeader title="Tracking region of interest" icon="roi">
          {#snippet actions()}<IconButton size="sm" icon="more" label="More" />{/snippet}
        </PanelHeader>
        <PanelHeader title="Chapters and bookmarks" collapsed={false} />
      </div>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Toolbar</h3>
    <div class="col">
      <div class="bar" data-testid="toolbar">
        <Toolbar label="Edit tools">
          <ToggleButton icon="pointer" label="Select" shortcut="V" pressed={tool === 'select'} onchange={() => (tool = 'select')} />
          <ToggleButton icon="pen" label="Pen" shortcut="P" pressed={tool === 'pen'} onchange={() => (tool = 'pen')} />
          <span class="k-sep"></span>
          <ToggleButton icon="magnet" label="Snap to frames" shortcut="S" bind:pressed={snap} />
          <ToggleButton icon="link" label="Ripple edits" bind:pressed={ripple} />
          <span class="k-sep"></span>
          <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" />
          <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" disabled />
          <span class="k-sep"></span>
          <div class="zoom" role="group" aria-label="Zoom">
            <IconButton icon="zoom-out" label="Zoom out" shortcut="-" />
            <IconButton icon="zoom-fit" label="Zoom to fit" shortcut="0" />
            <IconButton icon="zoom-in" label="Zoom in" shortcut="=" />
          </div>
        </Toolbar>
      </div>
      <div class="bar">
        <Toolbar label="Lane tools" data-testid="toolbar-seg">
          <SegmentedControl iconOnly size="sm" label="Tool" options={toolOpts} bind:value={toolSeg} />
          <span class="k-sep"></span>
          <IconButton size="sm" icon="cut" label="Cut" />
          <IconButton size="sm" icon="copy" label="Copy" />
          <IconButton size="sm" icon="paste" label="Paste" />
        </Toolbar>
      </div>
      <div class="vbar">
        <Toolbar label="View" orientation="vertical" data-testid="toolbar-v">
          <IconButton icon="zoom-in" label="Zoom in" />
          <IconButton icon="zoom-out" label="Zoom out" />
          <span class="k-sep"></span>
          <IconButton icon="eye" label="Show overlay" />
        </Toolbar>
      </div>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Status bar</h3>
    <div class="col">
      <div class="frame" data-testid="status">
        <StatusBar aria-label="Status">
          <StatusItem icon="clock" tip="Cursor time"><span class="k-num">01:23.456</span></StatusItem>
          <StatusItem icon="film" tip="Frame rate"><span class="k-num">29.97</span> fps</StatusItem>
          <StatusItem icon="warning" tone="warn" tip="Variable frame rate: frame times are approximate">VFR</StatusItem>
          {#snippet end()}
            <StatusItem icon="select" tip="Selection"><span class="k-num">12</span> points</StatusItem>
            <StatusItem icon="dot" tone="ok" tip="Device settings" onclick={() => clicks++} data-testid="status-device">Handy connected</StatusItem>
          {/snippet}
        </StatusBar>
      </div>
      <div class="frame w360">
        <StatusBar aria-label="Status (narrow)">
          <StatusItem icon="clock"><span class="k-num">01:23.456</span></StatusItem>
          <StatusItem icon="error" tone="bad" onclick={() => clicks++}>3 errors in the selected range</StatusItem>
          {#snippet end()}<StatusItem icon="dot" tone="ok">Handy</StatusItem>{/snippet}
        </StatusBar>
      </div>
      <p class="note" data-testid="clicks">device clicks: <span class="k-num">{clicks}</span></p>
    </div>
  </section>

  <section>
    <h3 class="k-caps">Empty states</h3>
    <div class="row">
      <div class="panel w360 tall">
        <EmptyState icon="film" title="No video loaded" description="Open a video or drop one here to start scripting against its frames.">
          {#snippet actions()}
            <Button variant="primary" icon="folder-open">Open video</Button>
            <Button>Recent</Button>
          {/snippet}
        </EmptyState>
      </div>
      <div class="panel w300 tall">
        <EmptyState icon="success" title="No problems found" description="Speed, gaps and range all pass." />
      </div>
    </div>
  </section>
</div>

<style>
  .demo { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-7); }
  h3 { margin-bottom: var(--space-4); }
  .row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-6); }
  .col { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-4); }
  .panel { background: var(--bg); border: 1px solid var(--line-1); min-width: 0; }
  .stack { display: flex; flex-direction: column; }
  .w180 { width: 180px; } .w240 { width: 240px; } .w300 { width: 300px; } .w360 { width: 360px; } .w420 { width: 420px; }
  .tall { height: 240px; }
  .pad { padding: var(--space-4); }
  .note { color: var(--tx-mut); font-size: var(--fs-2); }
  .cap { margin: var(--space-5) 0 var(--space-3); }
  .rows { display: grid; grid-template-columns: 1fr auto; gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--fs-ui); }
  .rows dt { color: var(--tx-mut); }
  .rows dd { margin: 0; color: var(--tx-val); text-align: right; }
  .bar { display: flex; padding: var(--space-1) var(--space-2); background: var(--bg-raised); border: 1px solid var(--line-1); }
  .vbar { display: inline-flex; padding: var(--space-2) var(--space-1); background: var(--bg-raised); border: 1px solid var(--line-1); }
  .more { margin-top: var(--space-4); }
  .zoom { display: flex; gap: var(--space-1); }
  .frame { width: 100%; max-width: 760px; border: 1px solid var(--line-1); border-top: 0; }
  .frame.w360 { width: 360px; } .w420 { width: 420px; }
</style>
