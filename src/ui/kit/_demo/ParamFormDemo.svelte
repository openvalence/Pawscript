<script>
  import ParamForm from '../ParamForm.svelte';

  const stroke = [
    { key: 'bpm', label: 'Tempo', type: 'float', default: 120, min: 20, max: 300, step: 0.5, unit: 'bpm', group: 'Timing' },
    { key: 'speed', label: 'Speed', type: 'float', default: 1, min: 0.25, max: 4, step: 0.05, unit: '×', group: 'Timing', hint: 'Multiplies the tempo without moving beats.' },
    { key: 'count', label: 'Stroke count', type: 'int', default: 16, min: 1, max: 999, group: 'Timing' },
    { key: 'duty', label: 'Duty cycle', type: 'float', default: 50, min: 5, max: 95, step: 1, unit: '%', control: 'slider', group: 'Timing', hint: 'Share of each stroke spent going up.' },
    { key: 'wave', label: 'Wave', type: 'choice', default: 'sine', choices: [{ value: 'sine', label: 'Sine' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' }, { value: 'bounce', label: 'Bounce' }], group: 'Shape' },
    { key: 'invert', label: 'Invert', type: 'bool', default: false, group: 'Shape' },
    { key: 'depth', label: 'Depth', type: 'int', default: 100, min: 0, max: 100, unit: '%', control: 'slider', group: 'Shape' },
    { key: 'minPos', label: 'Minimum position', type: 'int', default: 0, min: 0, max: 100, group: 'Output' },
    { key: 'maxPos', label: 'Maximum position', type: 'int', default: 100, min: 0, max: 100, group: 'Output' },
    { key: 'smoothing', label: 'Smoothing', type: 'int', default: 0, min: 0, max: 500, step: 5, unit: 'ms', group: 'Output', hint: 'Low-pass window applied after generation.' },
  ];

  const tracker = [
    { key: 'roiPad', label: 'ROI padding', type: 'int', default: 8, min: 0, max: 64, unit: 'px', hint: 'Grows the region of interest on every side.' },
    { key: 'confidence', label: 'Confidence threshold', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01, control: 'slider' },
    { key: 'model', label: 'Model', type: 'choice', default: 'yolov8n', choices: [
      { value: 'yolov8n', label: 'YOLOv8 nano' }, { value: 'yolov8s', label: 'YOLOv8 small' }, { value: 'yolov8m', label: 'YOLOv8 medium' },
      { value: 'rtdetr', label: 'RT-DETR large' }, { value: 'cotracker', label: 'CoTracker 3' },
    ] },
    { key: 'mode', label: 'Track', type: 'choice', default: 'box', choices: [{ value: 'box', label: 'Box' }, { value: 'point', label: 'Point' }] },
    { key: 'gpu', label: 'Use GPU', type: 'bool', default: true },
    { key: 'maxLost', label: 'Max lost frames', type: 'int', default: 12, min: 0, max: 240, unit: 'fr', group: 'Advanced' },
    { key: 'filter', label: 'Filter', type: 'choice', default: 'low', choices: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'high', label: 'High' }], group: 'Advanced', hint: 'Kalman smoothing of the tracked box.' },
  ];

  const exporter = [
    { key: 'format', label: 'Format', type: 'choice', default: 'funscript', choices: [{ value: 'funscript', label: 'Funscript' }, { value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }], group: 'File' },
    { key: 'axis', label: 'Axis', type: 'choice', default: 'L0', choices: ['L0', 'R0', 'R1'], group: 'File' },
    { key: 'range', label: 'Range', type: 'choice', default: 'all', choices: [{ value: 'all', label: 'Whole script' }, { value: 'sel', label: 'Selection' }, { value: 'loop', label: 'Loop region' }], group: 'File' },
    { key: 'metadata', label: 'Include metadata', type: 'bool', default: true, group: 'File' },
    { key: 'offset', label: 'Time offset', type: 'int', default: 0, min: -5000, max: 5000, step: 10, unit: 'ms', group: 'Timing', hint: 'Shifts every action; negative is earlier.' },
    // A long label written short + hint: "Tolerance" in the row, the full sense in the hint (tooltip, description, stacked text).
    { key: 'simplify', label: 'Tolerance', type: 'float', default: 0, min: 0, max: 10, step: 0.1, unit: '%', control: 'slider', group: 'Timing', hint: 'Simplify tolerance in % of the position range: points closer than this to the line are dropped.' },
    { key: 'round', label: 'Round positions to integers', type: 'bool', default: true, group: 'Timing' },
  ];

  const cases = $state([
    { title: 'Stroke generator', schema: stroke, values: {}, log: [], changes: 0, commits: 0 },
    // An existing preset with a key this schema does not know: it survives normalisation.
    { title: 'Tracker settings', schema: tracker, values: { model: 'rtdetr', confidence: 0.62, legacyKey: 'kept' }, log: [], changes: 0, commits: 0, sections: true },
    { title: 'Export', schema: exporter, values: {}, log: [], changes: 0, commits: 0 },
  ]);

  function record(c, kind, values, key) {
    c[kind === 'change' ? 'changes' : 'commits'] += 1;
    c.log = [{ kind, key: key ?? '(group)', value: key == null ? '' : JSON.stringify(values[key]) }, ...c.log].slice(0, 10);
  }
</script>

<div class="demo">
  {#each cases as c, i}
    <section class="case" data-case={i} data-changes={c.changes} data-commits={c.commits}>
      <h3 class="k-caps">{c.title}</h3>
      <div class="cols">
        <div class="panel" data-w="260">
          <div class="head k-caps">compact · 260</div>
          <div class="body">
            <ParamForm schema={c.schema} bind:values={c.values}
              onchange={(v, k) => record(c, 'change', v, k)} oncommit={(v, k) => record(c, 'commit', v, k)} />
          </div>
        </div>
        <div class="panel" data-w="220">
          <div class="head k-caps">compact · 220 (stacks)</div>
          <div class="body">
            <ParamForm schema={c.schema} bind:values={c.values} />
          </div>
        </div>
        <div class="panel" data-w="380">
          <div class="head k-caps">compact · 380</div>
          <div class="body">
            <ParamForm schema={c.schema} bind:values={c.values} />
          </div>
        </div>
        <div class="panel" data-w="380">
          <div class="head k-caps">stacked · {c.sections ? 'sections' : 'collapsible off'}</div>
          <div class="body">
            <ParamForm schema={c.schema} bind:values={c.values} compact={false} collapsible={!!c.sections} />
          </div>
        </div>
        <div class="out">
          <pre class="json k-num">{JSON.stringify(c.values, null, 2)}</pre>
          <div class="counts k-caps">change {c.changes} · commit {c.commits}</div>
          <ol class="log">
            {#each c.log as e}
              <li><span class="kind" data-kind={e.kind}>{e.kind}</span> {e.key} <span class="k-num">{e.value}</span></li>
            {/each}
          </ol>
        </div>
      </div>
    </section>
  {/each}
</div>

<style>
  .demo { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-8); }
  .case { display: flex; flex-direction: column; gap: var(--space-4); }
  .cols { display: flex; align-items: flex-start; gap: var(--space-6); }
  .panel { flex: none; background: var(--bg); border: var(--bw) solid var(--line-1); }
  .panel[data-w='220'] { width: 220px; }
  .panel[data-w='260'] { width: 260px; }
  .panel[data-w='380'] { width: 380px; }
  .head { padding: var(--space-3) var(--space-5); background: var(--bg-raised); border-bottom: var(--bw) solid var(--line-1); }
  .body { padding: var(--space-3) 0 0; }
  .out { flex: 1 1 0; min-width: 220px; display: flex; flex-direction: column; gap: var(--space-4); }
  .json { margin: 0; padding: var(--space-4); font-size: var(--fs-2); color: var(--tx-mut); background: var(--bg-sunken); border: var(--bw) solid var(--line-1); }
  .log { margin: 0; padding: 0; list-style: none; font-size: var(--fs-2); color: var(--tx-mut); }
  .kind { display: inline-block; min-width: 4.5em; color: var(--tx); }
  .kind[data-kind='commit'] { color: var(--accent-ink); }
</style>
