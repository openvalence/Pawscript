<script>
  // RangePolicy {app}: the Autorange policy as curves (kit CurveEditor; range-edit.js policyModel / knobsModel). The
  // curve: one band per act family over a run (penetration / oral / foreplay in their colours; the picked family's
  // start band, full band and build-up as handles), the orgasm band at the right, the knot reserve, the tie level,
  // the depth offset and, for a machine, the floor. The strip under it: band width, ease between runs, the dead-gap
  // tease's reach and pace. Stroker | Machine above. A drag is ONE undo step: app.begin on the first preview, the
  // policy is written into the project (doc.finish.policy) as it moves, so the live pass and the final follow.
  import { onDestroy } from 'svelte';
  import { CurveEditor, SegmentedControl } from '../../ui/kit/index.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { tl } from './state.svelte.js';
  import { kindOf } from './kinds.js';
  import { policyModel, knobsModel, policyWith, FAMILIES, CW, CH, KW, KH } from './range-edit.js';
  import { policyOf, setPolicy, writePolicy, profileOf } from './commands-range.js';
  import { POLICY } from '../../lib/autorange.js';

  let { app } = $props();
  let group = null, timer = null, fam = $state('penetration');
  const P = $derived(tl.rangePolicy ?? policyOf(app));
  const fixed = $derived(profileOf(app)?.device);   // a profile that says what it is wins over the toggle
  const model = $derived(policyModel({ ...P, device: fixed ?? P.device }, fam));
  const knobs = $derived(knobsModel(P));

  function preview(key, v) {
    group ??= app.begin('Autorange policy');
    tl.rangePolicy = policyWith(P, key, v);
    timer ??= setTimeout(flush, 60);
  }
  function flush() { clearTimeout(timer); timer = null; if (group && tl.rangePolicy) writePolicy(app, tl.rangePolicy); }
  function commit() { if (!group) return; flush(); setPolicy(app, tl.rangePolicy); const g = group; group = null; tl.rangePolicy = null; g.commit(); }
  function cancel() { clearTimeout(timer); timer = null; const g = group; group = null; tl.rangePolicy = null; g?.cancel(); }
  onDestroy(commit);

  const DEVICES = [
    { value: 'stroker', label: 'Stroker', tip: 'Stroker: the full 0 to 100, generous bands' },
    { value: 'machine', label: 'Machine', tip: 'Machine: never below the floor, tighter bands' },
  ];
  const FAMS = FAMILIES.map((f) => ({ value: f, label: kindOf(f).label, tip: `Edit the ${kindOf(f).label.toLowerCase()} ladder: its start band, full band and build-up` }));
  function setDevice(d) { app.transact(`Autorange: ${d}`, () => setPolicy(app, { device: d })); }
  // back to the defaults: one undo step (the pass follows)
  function defaults() {
    const { device, floor } = P;
    app.transact('Autorange policy: defaults', () => setPolicy(app, { ...POLICY, device, floor }));
  }
</script>

<div class="rp">
  <div class="head">
    <b>Autorange policy</b><span class="grow"></span>
    <SegmentedControl size="sm" label="Device" options={DEVICES} value={fixed ?? P.device} onchange={setDevice} disabled={!!fixed} />
  </div>
  <div class="head">
    <SegmentedControl size="sm" label="Ladder" options={FAMS} value={fam} onchange={(f) => (fam = f)} />
    <span class="grow"></span>
    <button class="lnk" onclick={defaults} {@attach tooltip('Every handle back to its default, device and floor kept')}>defaults</button>
  </div>
  <CurveEditor W={CW} H={CH} height={170} lines={model.lines} handles={model.handles} label="Autorange policy curve" onpreview={preview} oncommit={commit} oncancel={cancel} />
  <CurveEditor W={KW} H={KH} height={154} lines={knobs.lines} handles={knobs.handles} label="Autorange strength, kept depth, band width, ease and tease" onpreview={preview} oncommit={commit} oncancel={cancel} />
  <p class="note">x = through an act run (orgasm at the right end), y = depth (top = out). Solid: the picked family's band; faint: the others. Dot: the depth offset.</p>
</div>

<style>
  .rp { display: flex; flex-direction: column; gap: var(--space-2); padding: 0 var(--space-3); width: 380px; max-width: calc(100vw - 32px); }
  .head { display: flex; align-items: center; gap: var(--space-2); }
  .grow { flex: 1; }
  .lnk { padding: 0 var(--space-2); font-size: var(--fs-1); color: var(--tx-mut); border-radius: var(--radius); }
  .lnk:hover { color: var(--tx-hi); background: var(--bg-hover); }
  .note { margin: 0; font-size: var(--fs-1); color: var(--tx-mut); }
</style>
