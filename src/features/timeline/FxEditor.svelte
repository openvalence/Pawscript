<script>
  // FxEditor {app, id}: the modifier's curve popover (Refine) -- a direct-manipulation curve (kit CurveEditor; fx-edit.js
  // curveModel): Reshape = one stroke between two turns, Orgasm = its band and tremor plus its markers' spurt shape (a marker:
  // that shape at its velocity, paw-d1g7), Knotting = one knot cycle with
  // its levels, or (mode One knot) the one knot in, (Unknot) the knot coming out, (Push / pull) the one slow move, Throbbing = its
  // beats; Idle has no curve (a hold). A drag (or a held key) is ONE undo step: app.begin on the first preview, the lane ghost
  // follows through applyFx (debounced writes of doc.fx inside the open group), commit on release. Numeric twins on
  // request. Reshape: "Fit" reads the profile off the tracked motion (commands-fx fitShape); One knot: the push / pop timing (fitKnot);
  // Unknot: the pull / pop timing (fitUnknot); Push / pull: the one slow move (fitInsert). A linked modifier (fx-edit linkFx) edits every member: the header says "linked ×n · unlink".
  // paw-r9nh: under it, every span kind's strength over its span (fx-edit envModel; lib/fx strength): drag "build" right /
  // "fade" left, the levels, and "follow strokes" (the strength follows the stroke travel); Flat / Build / Fade / Swell are
  // starting shapes. Same preview / commit as the curve: one undo step per drag.
  import { onDestroy, untrack } from 'svelte';
  import { CurveEditor, IconButton, ToggleButton, Button, SegmentedControl, Icon } from '../../ui/kit/index.js';
  import { fmtMs } from '../../lib/video.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { FX_KINDS, fxParams, fxSchema, isPointFx, ENV, ENV_PRESETS, MARKER_KEYS, orgasmOf } from '../../lib/fx.js';
  import { KIND } from './kinds.js';
  import { setFxParams, curveModel, curveTwins, linkMembers, envModel, markerModel, orgasmSpurtModel, CW, CH } from './fx-edit.js';
  import { fitShape, fitKnot, fitUnknot, fitInsert, fitThrob, knotModeOf, commitFx, UNBAKED } from './commands-fx.js';
  import { machineKnots } from './deps.js';
  import { finalScript, docOf } from '../../lib/finish.js';

  let { app, id } = $props();
  const fx = $derived((app.doc.fx || []).find((e) => e.id === id) ?? null);
  let draft = $state.raw({}), group = null, timer = null;
  const own = $derived(fx ? { ...fxParams(fx), ...draft } : null);
  const p = $derived(fx?.kind === 'knotting' ? { ...own, mode: own.mode ?? knotModeOf(app, fx) } : own);   // auto resolved for the curve
  const single = $derived(fx?.kind === 'knotting' && p.mode === 'single');
  const unknot = $derived(fx?.kind === 'knotting' && p.mode === 'unknot');
  const push = $derived(fx?.kind === 'knotting' && p.mode === 'none');
  const linked = $derived(fx?.link ? linkMembers(app.doc.fx || [], id).length : 0);
  const point = $derived(fx?.kind === 'throbbing' && p.period >= fx.t1 - fx.t0);   // a single throb (one beat long): its one beat, no period / envelope
  // paw-d1g7: a spurt inside an orgasm is its marker: the orgasm's spurt shape, only its velocity of its own
  const owner = $derived(fx?.kind === 'spurt' ? orgasmOf(app.doc.fx || [], fx) : null);
  const model = $derived(!fx ? { lines: [], handles: [] } : owner ? markerModel(fxParams(owner), p.vel) : curveModel(fx.kind, p, point));
  const twin = (s) => ({ key: s.key, label: s.label, value: p[s.key] ?? s.default, min: s.min, max: s.max, step: s.step, unit: s.unit });
  const twins = $derived(!fx ? [] : owner ? fxSchema('spurt').filter((s) => s.key === 'vel').map(twin) : curveTwins(fx.kind, p, model.handles, point));
  // an orgasm: its markers' spurt shape (amount, rise, fall; count and decay under #)
  const spurts = $derived(fx?.kind === 'orgasm' ? orgasmSpurtModel(p) : null);
  const spurtTwins = $derived(fx?.kind === 'orgasm' ? fxSchema('orgasm').filter((s) => MARKER_KEYS.includes(s.key)).map(twin) : []);
  let showInputs = $state(app.settings?.get?.('timeline.fxInputs', false) === true);
  $effect(() => { const v = showInputs; untrack(() => app.settings?.set?.('timeline.fxInputs', v)); });

  const flush = () => { clearTimeout(timer); timer = null; if (group && fx) app.doc.fx = setFxParams(app.doc.fx, id, draft); };
  function preview(key, v) {
    if (!fx) return;
    if (!group) { group = app.begin(`Modifier: ${FX_KINDS[fx.kind]?.label ?? fx.kind}`); if (fx.baked) app.toast(UNBAKED); }   // setFxParams un-bakes it
    draft = { ...draft, [key]: v };
    timer ??= setTimeout(flush, 60);
  }
  function commit() { if (!group) return; flush(); const g = group; group = null; draft = {}; g.commit(); }
  function cancel() { clearTimeout(timer); timer = null; const g = group; group = null; draft = {}; g?.cancel(); }
  onDestroy(commit);

  const KNOT_MODES = [{ value: 'cycles', label: 'Cycles', tip: 'A knot cycle on every tracked stroke' }, { value: 'single', label: 'One knot', tip: 'One knot in: catch, press, pop, settle, pull-out' },
    { value: 'unknot', label: 'Unknot', tip: 'The knot coming out: a slow pull with tugs, then the pop' }, { value: 'none', label: 'Push', tip: 'One slow push or pull, no pop' }];
  const setMode = (m) => commitFx(app, 'Knotting: ' + KNOT_MODES.find((o) => o.value === m).label.toLowerCase(), setFxParams(app.doc.fx, id, { mode: m }));
  const THROB_DIRS = [{ value: 'dip', label: 'Dip', tip: 'Each beat dips deeper from the trace and comes back' }, { value: 'swell', label: 'Swell', tip: 'Each beat swells shallower from the trace and comes back' }];
  const setDir = (d) => commitFx(app, 'Throbbing: ' + d, setFxParams(app.doc.fx, id, { dir: d }));
  // paw-r9nh: the strength envelope (one per modifier): presets are starting shapes, the handles do the rest
  const env = $derived(own ? envModel(own) : { lines: [], handles: [] });
  const envTwins = $derived(own ? ENV.map((s) => ({ key: s.key, label: s.label, value: own[s.key], min: s.min, max: s.max, step: s.step, unit: s.unit })) : []);
  const ENV_OPTS = [{ value: 'flat', label: 'Flat', tip: 'The modifier in full over its whole span' }, { value: 'build', label: 'Build', tip: 'Builds up from nothing toward the end' },
    { value: 'fade', label: 'Fade', tip: 'Full at the start, decays to nothing (after the shot)' }, { value: 'swell', label: 'Swell', tip: 'Builds to the middle and fades again' }];
  const preset = $derived(own ? Object.keys(ENV_PRESETS).find((k) => Object.entries(ENV_PRESETS[k]).every(([q, v]) => own[q] === v)) ?? null : null);
  const setPreset = (k) => commitFx(app, `Strength: ${k}`, setFxParams(app.doc.fx, id, ENV_PRESETS[k]));
  // the Machine panel's simulation (machine/lane-events.svelte.js), when it is open: does this knot go in, and a fit of
  // the One knot timing so that the simulated knot goes in when the effect pops (one undo step)
  const mk = $derived(fx?.kind === 'knotting' && machineKnots ? machineKnots.verdict(app, fx.t0, fx.t1) : null);
  const mkText = $derived(machineKnots ? machineKnots.text(mk) : '');
  const mkReady = $derived(!!machineKnots?.ready(app));
  function fitMachine() {
    // (the doc's fields the final reads: a spread of app.doc would lose its accessors)
    const d = app.doc, env = app.finishEnv?.() ?? {}, scriptFor = (q) => finalScript({ ...docOf(app), fx: setFxParams(d.fx, id, q) }, 'stroke', env);
    const r = machineKnots.fit(app, scriptFor, fx.t0, fx.t1, p);
    if (!r) return app.toast('Open the Machine panel first, the fit uses its toy', 'quiet');
    if (r.fail) return app.toast(`The Machine's knot would not go in even with the longest push: ${machineKnots.text({ ok: false, need: r.need }) || 'not with this toy'}`, 'quiet');
    commitFx(app, 'Knotting: fit the timing to the Machine', setFxParams(app.doc.fx, id, r.params));
    const off = Math.round(r.off), when = Math.abs(off) <= 60 ? 'at the pop' : `${Math.abs(off)} ms ${off > 0 ? 'after' : 'before'} the pop (as close as this toy gets)`;
    app.toast(`Fitted to the Machine: the knot goes in ${when}, push ${Math.round(r.params.push * 100)} % of the span, press ${Math.round(r.params.pressTakes * 100)} %, knot depth ${r.params.press}, tie at ${r.params.knotOut}`, 'quiet');
  }
  function fit() {
    if (fx.kind === 'throbbing') {
      const k = fitThrob(app, fx.t0, fx.t1);
      if (!k) return app.toast('No pulses under this modifier to time the beat: drag the period', 'quiet');
      return commitFx(app, `Throbbing: fit the beat (${k.period} ms)`, setFxParams(app.doc.fx, id, k));
    }
    if (push) {
      const k = fitInsert(app, fx.t0, fx.t1);
      if (!k) return app.toast('No tracked push or pull under this modifier: drag the handles', 'quiet');
      return commitFx(app, 'Knotting: fit the push from motion', setFxParams(app.doc.fx, id, k));
    }
    if (unknot) {
      const k = fitUnknot(app, fx.t0, fx.t1);
      if (!k) return app.toast('The tracked motion under this modifier does not show the pull: drag the handles', 'quiet');
      return commitFx(app, 'Knotting: fit the pull from motion', setFxParams(app.doc.fx, id, k));
    }
    if (single) {
      const k = fitKnot(app, fx.t0, fx.t1);
      if (!k) return app.toast('The tracked motion under this modifier does not show the push: drag the handles', 'quiet');
      return commitFx(app, 'Knotting: fit the push from motion', setFxParams(app.doc.fx, id, k));
    }
    const f = fx && fitShape(app, fx.t0, fx.t1);
    if (!f) return app.toast('No tracked samples under this modifier: track the scene first', 'quiet');
    commitFx(app, 'Reshape: fit from motion', setFxParams(app.doc.fx, id, f));
  }
</script>

{#if fx}
  <div class="fxe">
    <div class="head">
      <i class="dot" style:background={KIND[fx.kind]?.color ?? FX_KINDS[fx.kind]?.color}></i><b>{FX_KINDS[fx.kind]?.label ?? fx.kind}</b>{#if owner}<span class="dim">in the orgasm</span>{/if}
      <span class="k-num dim">{fx.t1 === fx.t0 ? fmtMs(fx.t0) : `${fmtMs(fx.t0)} – ${fmtMs(fx.t1)}`}</span>
      {#if linked > 1}<span class="dim" {@attach tooltip('Linked: edits go to all of them, spans stay their own')}>linked ×{linked} ·</span>
        <Button size="sm" variant="ghost" onclick={() => app.commands.run('timeline.fx.unlink', { id })} tip="Unlink: each keeps the params it has now">unlink</Button>{/if}
      <span class="grow"></span>
      {#if fx.kind === 'shape'}<Button size="sm" variant="ghost" icon="wand" onclick={fit} tip="Fit the stroke profile to the tracked motion">Fit</Button>{/if}
      {#if fx.kind === 'throbbing' && !point}<Button size="sm" variant="ghost" icon="wand" onclick={fit} tip="Fit the beat period to the tracked pulses">Fit</Button>{/if}
      {#if push}<Button size="sm" variant="ghost" icon="wand" onclick={fit} tip="Fit the timing to the tracked motion, levels stay">Fit</Button>{/if}
      {#if single || unknot}<Button size="sm" variant="ghost" icon="wand" onclick={fit} tip="Fit the {unknot ? 'pull' : 'push'} and pop timing to the tracked motion">Fit</Button>{/if}
      {#if single}<Button size="sm" variant="ghost" onclick={fitMachine} disabled={!mkReady} tip={mkReady ? 'Fit the push so the Machine\'s knot goes in at the pop' : 'Open the Machine panel to fit from it'}>Machine</Button>{/if}
      <ToggleButton size="sm" icon="hash" bind:pressed={showInputs} label={showInputs ? 'Hide numbers' : 'Show numbers'} />
      <ToggleButton size="sm" icon={fx.muted ? 'eye-off' : 'eye'} pressed={!!fx.muted} label={fx.muted ? 'Muted: unmute' : 'Mute (the layer is off, nothing is lost)'} onclick={() => app.commands.run('timeline.fx.mute', { id })} />
      <IconButton size="sm" icon="delete" variant="ghost" label="Delete modifier" onclick={() => app.commands.run('timeline.fx.remove', { id })} />
    </div>
    {#if fx.kind === 'knotting'}<SegmentedControl size="sm" label="Knot mode" options={KNOT_MODES} value={p.mode} onchange={setMode} />{/if}
    {#if mkText}<div class="warn" role="status"><Icon name="warning" size={14} /> Machine: {mkText}</div>{/if}
    {#if fx.kind === 'throbbing'}<SegmentedControl size="sm" label="Throb direction" options={THROB_DIRS} value={p.dir} onchange={setDir} />{/if}
    {#if fx.kind === 'idle'}<p class="dim">Idle: held at the level it starts at, no curve. Drag its ends on the Modifiers row.</p>{:else}<CurveEditor W={CW} H={CH} height={160} lines={model.lines} handles={model.handles} {twins} bind:showInputs
      label="{FX_KINDS[fx.kind]?.label} curve" onpreview={preview} oncommit={commit} oncancel={cancel} />{/if}
    {#if spurts}
      <div class="head"><b class="sub">Its spurts (U places one)</b></div>
      <CurveEditor W={CW} H={CH} height={110} lines={spurts.lines} handles={spurts.handles} twins={spurtTwins} bind:showInputs
        label="Orgasm spurts" onpreview={preview} oncommit={commit} oncancel={cancel} />
    {/if}
    {#if owner}<p class="dim">Its shape is the orgasm's spurts; the pill sets its velocity</p>{/if}
    {#if !isPointFx(fx)}
      <div class="head"><b class="sub">Strength over the span</b><span class="grow"></span>
        <SegmentedControl size="sm" label="Strength preset" options={ENV_OPTS} value={preset} onchange={setPreset} /></div>
      <CurveEditor W={CW} H={CH} height={110} lines={env.lines} handles={env.handles} twins={envTwins} bind:showInputs
        label="{FX_KINDS[fx.kind]?.label} strength" onpreview={preview} oncommit={commit} oncancel={cancel} />
    {/if}
  </div>
{/if}

<style>
  .fxe { display: flex; flex-direction: column; gap: var(--space-2); padding: 0 var(--space-3); width: 360px; max-width: calc(100vw - 32px); }
  .head { display: flex; align-items: center; gap: var(--space-2); }
  .dot { width: 8px; height: 8px; border-radius: var(--radius); flex: none; }
  .dim { color: var(--tx-mut); font-size: var(--fs-1); }
  .grow { flex: 1; }
  .sub { font-size: var(--fs-1); font-weight: 600; color: var(--tx-mut); }
  .warn { display: flex; align-items: center; gap: var(--space-1); color: var(--warn-ink, var(--warn)); font-size: var(--fs-1); }
</style>
