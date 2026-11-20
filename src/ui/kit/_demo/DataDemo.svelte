<script>
  import SplitPane from '../SplitPane.svelte';
  import ScrollArea from '../ScrollArea.svelte';
  import VirtualList from '../VirtualList.svelte';
  import Tree from '../Tree.svelte';
  import DataTable from '../DataTable.svelte';
  import Icon from '../Icon.svelte';
  import PanelHeader from '../PanelHeader.svelte';
  import IconButton from '../IconButton.svelte';

  // ---- persisted layout -----------------------------------------------------------------------------
  const load = (k, d) => { const v = localStorage.getItem('kit.data.' + k); return v == null ? d : JSON.parse(v); };
  const save = (k, v) => localStorage.setItem('kit.data.' + k, JSON.stringify(v));
  let side = $state(load('side', 240));
  let sideCollapsed = $state(load('sideCollapsed', false));
  let bottom = $state(load('bottom', 220));
  let resized = $state('');

  // ---- deterministic fake data ----------------------------------------------------------------------
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pad = (n, w) => String(n).padStart(w, '0');
  const clock = (ms) => `${pad(Math.floor(ms / 60000), 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(Math.floor(ms % 1000), 3)}`;

  const N = 100_000;
  const acts = new Array(N);
  for (let i = 0, t = 0; i < N; i++) { t += 80 + Math.floor(rnd() * 240); acts[i] = { at: t, pos: Math.round(rnd() * 100) }; }
  let action = $state(-1);
  let list;

  const AXES = [
    { id: 'L0', label: 'Stroke' }, { id: 'L1', label: 'Surge' }, { id: 'L2', label: 'Sway' },
    { id: 'R0', label: 'Twist' }, { id: 'R1', label: 'Roll' }, { id: 'R2', label: 'Pitch' },
  ];
  const nodes = [{
    id: 'project', label: 'Scene 04 — night drive', icon: 'folder-open', children: [
      { id: 'axes', label: 'Axes', icon: 'layers', children: AXES.map((a) => ({ id: 'ax-' + a.id, label: `${a.label} (${a.id})`, icon: 'wave' })) },
      { id: 'chapters', label: 'Chapters', icon: 'chapters', children: ['Intro', 'Warm-up', 'Build', 'Peak', 'Cool-down', 'Outro'].map((c, i) => ({
        id: 'ch-' + i, label: c, icon: 'flag',
        children: i === 3 ? [{ id: 'ch-3a', label: 'Peak A', icon: 'flag' }, { id: 'ch-3b', label: 'Peak B', icon: 'flag' }] : undefined,
      })) },
      { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', children: ['Beat drop', 'Camera cut', 'Sync check', 'Loop seam'].map((b, i) => ({ id: 'bm-' + i, label: b, icon: 'bookmark' })) },
      { id: 'media', label: 'night-drive.mp4', icon: 'film' },
    ],
  }];
  let expanded = $state(new Set(['project', 'axes', 'chapters']));
  let node = $state('ax-L0');
  let activated = $state('');

  const SEV = ['error', 'warn', 'info'];
  const MSG = [
    'Speed exceeds 500 units/s', 'Action out of range (pos 104)', 'Gap longer than 10 s', 'Duplicate action at same time',
    'Stroke shorter than one frame', 'Axis has no actions in chapter', 'Interpolation overshoots 0–100', 'Bookmark outside the video',
  ];
  const problems = Array.from({ length: 2000 }, (_, i) => {
    const s = rnd(), sev = s < 0.15 ? 'error' : s < 0.55 ? 'warn' : 'info';
    return { id: i + 1, sev, at: Math.floor(rnd() * 1_800_000), axis: AXES[Math.floor(rnd() * 6)].id, msg: MSG[Math.floor(rnd() * MSG.length)] };
  });
  let probSort = $state({ key: 'at', dir: 'asc' });
  let probSel = $state(new Set());
  const rank = { error: 0, warn: 1, info: 2 };

  const runs = [
    { id: 'r1', name: 'CSRT · full video', frames: 54_210, score: 0.912, ms: 182_400 },
    { id: 'r2', name: 'KCF · chapter Peak', frames: 6_480, score: 0.774, ms: 9_850 },
    { id: 'r3', name: 'Optical flow · intro', frames: 1_802, score: 0.851, ms: 4_120 },
    { id: 'r4', name: 'CSRT · re-run after ROI fix', frames: 54_210, score: 0.937, ms: 176_930 },
    { id: 'r5', name: 'MediaPipe pose', frames: 12_066, score: 0.689, ms: 48_002 },
  ];
  let runSort = $state(null);
  let runSel = $state(new Set(['r4']));
  const dur = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(Math.floor(ms % 1000 / 10), 2)}`;
</script>

{#snippet sevCell(r)}
  <span class="sev" data-sev={r.sev}><Icon name={r.sev === 'warn' ? 'warning' : r.sev} size={14} label={r.sev} /></span>
{/snippet}

<div class="demo">
  <section>
    <h3 class="k-caps">Split panes · tree · virtual list · table</h3>
    <div class="frame">
      <SplitPane
        direction="horizontal" bind:size={side} bind:collapsed={sideCollapsed} defaultSize={240} min={160} max={420}
        minOther={320} collapsible label="Resize project panel" id="split-side"
        onresize={(px) => { save('side', px); save('sideCollapsed', sideCollapsed); resized = `side ${sideCollapsed ? 'collapsed' : px}`; }}
      >
        {#snippet first()}
          <div class="panel">
            <PanelHeader title="Project" />
            <ScrollArea style="--shade-surface: var(--bg)">
              <Tree {nodes} bind:expanded bind:selected={node} label="Project" id="tree"
                    onactivate={(n) => (activated = n.label)} />
            </ScrollArea>
          </div>
        {/snippet}
        {#snippet second()}
          <SplitPane
            direction="vertical" primary="second" bind:size={bottom} defaultSize={220} min={96} minOther={120}
            label="Resize problems panel" id="split-bottom"
            onresize={(px) => { save('bottom', px); resized = `bottom ${px}`; }}
          >
            {#snippet first()}
              <div class="panel">
                <PanelHeader title="Actions">
                  {#snippet actions()}
                    <span class="k-hint k-num">{action >= 0 ? `${(action + 1).toLocaleString('en')} / ` : ''}{N.toLocaleString('en')}</span>
                    <IconButton icon="panel-left" label={sideCollapsed ? 'Show project panel' : 'Hide project panel'} size="sm"
                                pressed={!sideCollapsed} onclick={() => { sideCollapsed = !sideCollapsed; save('sideCollapsed', sideCollapsed); }} />
                  {/snippet}
                </PanelHeader>
                <VirtualList items={acts} bind:selected={action} bind:this={list} label="Actions" id="actions"
                             onactivate={(a, i) => (activated = `action ${i + 1} at ${clock(a.at)}`)}>
                  {#snippet row(a, i)}
                    <span class="k-num idx">{i + 1}</span>
                    <span class="k-num t">{clock(a.at)}</span>
                    <span class="pos"><span class="k-hint">pos</span> <span class="k-num">{a.pos}</span></span>
                    <span class="bar" style:--p={a.pos / 100}></span>
                  {/snippet}
                </VirtualList>
              </div>
            {/snippet}
            {#snippet second()}
              <div class="panel">
                <PanelHeader title="Problems">
                  {#snippet actions()}<span class="k-hint k-num">{probSel.size ? `${probSel.size} selected · ` : ''}2,000</span>{/snippet}
                </PanelHeader>
                <DataTable
                  id="problems" label="Problems" rows={problems} bind:sort={probSort} bind:selected={probSel}
                  onactivate={(r) => (activated = `problem ${r.id}: ${r.msg}`)}
                  columns={[
                    { key: 'sev', label: 'Severity', width: 96, align: 'center', sortable: true, compare: (a, b) => rank[a.sev] - rank[b.sev], cell: sevCell },
                    { key: 'at', label: 'Time', width: 104, numeric: true, sortable: true, format: clock },
                    { key: 'axis', label: 'Axis', width: 64, sortable: true },
                    { key: 'msg', label: 'Message', width: 'minmax(200px, 1fr)', sortable: true },
                  ]}
                />
              </div>
            {/snippet}
          </SplitPane>
        {/snippet}
      </SplitPane>
    </div>
    <p class="k-hint readout">
      <span>last resize: <b id="resized">{resized || '—'}</b></span>
      <span>activated: <b id="activated">{activated || '—'}</b></span>
      <button type="button" class="link" onclick={() => { action = 50_000; list.scrollToIndex(50_000); }}>scrollToIndex(50 000)</button>
    </p>
  </section>

  <div class="cols">
    <section>
      <h3 class="k-caps">Scroll area</h3>
      <ScrollArea class="box" style="height: 200px">
        <div class="prose">
          {#each Array.from({ length: 14 }, (_, i) => i) as i}
            <p><b>{pad(i + 1, 2)}</b> The playhead follows the video clock; every action is a point in time and a
              position from 0 to 100. Lanes draw them as a polyline, the heatmap colours speed between them.</p>
          {/each}
        </div>
      </ScrollArea>
      <ScrollArea class="box" orientation="horizontal">
        <div class="strip">
          {#each Array.from({ length: 40 }, (_, i) => i) as i}<span class="k-num chip">{clock(i * 45_000)}</span>{/each}
        </div>
      </ScrollArea>
    </section>

    <section>
      <h3 class="k-caps">Tracker runs</h3>
      <DataTable
        class="box" id="runs" label="Tracker runs" rows={runs} bind:sort={runSort} bind:selected={runSel}
        style="height: calc(var(--row-h) * {runs.length + 1} + 2px)"
        columns={[
          { key: 'name', label: 'Name', width: 'minmax(160px, 1fr)', sortable: true },
          { key: 'frames', label: 'Frames', width: 88, numeric: true, sortable: true, format: (v) => v.toLocaleString('en') },
          { key: 'score', label: 'Score', width: 80, numeric: true, sortable: true, format: (v) => v.toFixed(3) },
          { key: 'ms', label: 'Duration', width: 96, numeric: true, sortable: true, format: dur },
        ]}
      />
      {#snippet emptyRuns()}No runs yet{/snippet}
      <DataTable class="box" label="Empty" rows={[]} style="height: 96px" empty={emptyRuns}
                 columns={[{ key: 'name', label: 'Name' }, { key: 'frames', label: 'Frames', width: 88, numeric: true }]} />
    </section>
  </div>
</div>

<style>
  .demo { display: flex; flex-direction: column; gap: var(--space-7); padding: var(--space-6); min-height: 100vh; background: var(--bg); color: var(--tx); }
  section { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: var(--space-7); }
  .frame { height: 560px; border: var(--bw) solid var(--line-2); border-radius: var(--radius); overflow: hidden; background: var(--bg); }
  .panel { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; }
  :global(.box) { border: var(--bw) solid var(--line-2); border-radius: var(--radius); }

  .idx { width: 7ch; text-align: right; color: var(--tx-mut); font-size: var(--fs-2); }
  .t { width: 10ch; color: var(--tx-val); }
  .pos { display: flex; gap: var(--space-2); align-items: baseline; width: 7ch; }
  .pos .k-num { color: var(--tx-val); width: 3ch; text-align: right; }
  .bar { flex: 0 1 120px; height: 4px; background: linear-gradient(90deg, var(--line-ctl) calc(var(--p) * 100%), var(--line-1) 0); }
  .demo :global([aria-selected='true'] > .bar) { background: linear-gradient(90deg, var(--reality) calc(var(--p) * 100%), var(--line-2) 0); }

  .sev { display: grid; place-items: center; }
  .sev[data-sev='error'] { color: var(--bad-ink); }
  .sev[data-sev='warn'] { color: var(--warn-ink); }
  .sev[data-sev='info'] { color: var(--info-ink); }

  .readout { display: flex; gap: var(--space-6); flex-wrap: wrap; align-items: center; }
  .readout b { font-weight: 500; color: var(--tx); }
  .link { border: 0; padding: 0; background: none; color: var(--accent-ink); cursor: pointer; font: inherit; }
  .link:focus-visible { outline: var(--ring-w) solid var(--focus); outline-offset: var(--ring-offset); }

  .prose { display: grid; gap: var(--space-4); padding: var(--space-5) var(--space-6); max-width: 64ch; }
  .prose b { font-weight: 500; color: var(--tx-mut); margin-right: var(--space-3); font-family: var(--mono); }
  .strip { display: flex; gap: var(--space-3); padding: var(--space-5); width: max-content; }
  .chip { padding: var(--space-1) var(--space-3); border: var(--bw) solid var(--line-2); border-radius: var(--radius); color: var(--tx-val); font-size: var(--fs-2); }
</style>
