<script module>
  // the camera-removal modes, shared with the Shot popover's mirror of them (SceneQuickBar, paw-t8z)
  export const CAM_OPTIONS = [
    { value: 'auto', label: 'auto', tip: 'As tracked, the camera tag picks the signal' },
    { value: 'off', label: 'off', tip: 'No camera removal, signals in image positions' },
    { value: 'move', label: 'move', tip: 'Camera re-estimated from the stored points: translation' },
    { value: 'zoom', label: 'zoom', tip: 'Camera from the stored points: move and zoom' },
    { value: 'full', label: 'rot', tip: 'Camera from the stored points: move, zoom, rotation' },
  ];
  /** The modes with the re-estimating ones off (their tip: why) while the run has no stored points (ptsBlock). */
  export const camOptionsFor = (ptsBlock) => CAM_OPTIONS.map((o) => (['move', 'zoom', 'full'].includes(o.value) && ptsBlock ? { ...o, disabled: true, tip: ptsBlock } : o));
</script>

<script>
  // Adjust after tracking (paw-a3n): the current shot's camera handling and stroke axis, recomputed live from the run's
  // stored points (lib/rederive.js; no sidecar, no re-track). Sliders preview while dragged (the lane's ghost follows,
  // the signal without camera removal shows dashed beside it, the stabilised preview follows the camera settings) and
  // write one undo step on release; the settings live on the shot (app.doc.scenes[i].derive). paw-x7w7: a live shot's points follow
  // them at once; a baked shot's never change (Unbake gives it back to the run).
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';
  import Slider from '../../ui/kit/Slider.svelte';
  import Section from '../../ui/kit/Section.svelte';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import { paramSchema, isShapePipe } from '../../lib/protocol.js';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { CAM_DEFAULT } from '../../lib/rederive.js';
  import { axisInfo } from './axis.js';
  import { shotLabel } from '../timeline/shots.js';
  import { trackingFor } from './tracking.svelte.js';
  import { STROKES, COMPRESS, compressCurve } from '../../lib/strokes.js';
  import { CurveEditor } from '../../ui/kit/index.js';
  import FusionPanel from './FusionPanel.svelte';
  import { foldOpen, setFold } from './folds.js';
  import { directionText, shaftOf, SHARE_MIN } from '../../lib/shaft.js';
  import { sceneAt } from '../../lib/runs.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);

  const i = $derived(tr.currentScene);
  const run = $derived(i >= 0 ? tr.deriveRun(i) : null);
  const block = $derived(i < 0 ? '' : tr.deriveBlockFor(i));
  const ptsBlock = $derived(i < 0 || block ? block : tr.deriveBlockFor(i, true));
  const d = $derived(i >= 0 ? tr.shotDerive(i) : null);
  // paw-hiq5: the camera removal that applies: the shot's Adjust choice, else its camera tag's default (turntable / rides the stroke: off), else auto
  const cs = $derived(i >= 0 ? tr.camState(i, null, run?.id) : { cam: { ...CAM_DEFAULT }, from: 'tracked', tag: null });
  const cam = $derived(cs.cam);
  const axis = $derived(i >= 0 ? tr.shotAxis(i) : null);
  const signal = $derived(run ? tr.sceneSignal(run, i) : '');
  const bk = $derived(run ? tr.bakeState(i) : null);   // paw-x7w7: live / baked
  // paw-e3i / paw-iasp: the shot's signal is 'fused': the fusion panel (FusionPanel.svelte)
  const fz = $derived(i >= 0 && run ? tr.fuseInfo(i) : null);
  // paw-e3i part 2: Smart stroke (fused parts + new strokes) and the shot's Strokes settings (lib/strokes.js)
  const smart = $derived(!!d?.smart);
  const stOn = $derived(smart || !!d?.strokes);
  // paw-azd: the shaft (how much is inside, SAM): the direction it says and the depth it gives (range 'shaft')
  const sk = $derived(run && tr.scenes[i] ? sceneAt(run.scenes || [], (tr.scenes[i].start_ms + tr.scenes[i].end_ms) / 2) : -1);
  const shaft = $derived(run && sk >= 0 ? shaftOf(run, sk) : null);
  const sdir = $derived(shaft ? tr.shaftDirection(run, i) : null);
  // paw-6t7d: what the shot's depth really used (runs-channel.js depthUsed): a shaft whose depth does not follow the signal is not used
  // (paw-s80k: |r|; r < 0 = read the way the scene plays)
  const dUsed = $derived(run?.depthUsed?.find((x) => x.i === sk) ?? null);
  const shaftOff = $derived(!!dUsed && dUsed.used !== 'shaft' && (dUsed.want === 'shaft' || (dUsed.want === 'auto' && dUsed.share >= SHARE_MIN)));
  const S = $derived({ ...STROKES, ...(d?.strokes || {}), range: d?.strokes?.range ?? (dUsed ? dUsed.used : shaft && shaft.share >= SHARE_MIN ? 'shaft' : STROKES.range) });
  const nPts = $derived.by(() => { const g = run && tr.ghost(run.id), s = tr.scenes[i]; return g && s ? (g.script || []).filter((p) => p.at >= s.start_ms && p.at < s.end_ms).length : 0; });
  const SMART_TIP = 'One click A/B: this shot takes the fused signal of every tracked part (Fused from) through the new strokes step; the points it had before stay drawn over it, grey, in the script lane until you switch back. Without painted groups it takes the shot\'s own signal through the new strokes.';
  const RANGE_OPTIONS = [
    { value: 'scene', label: 'scene', tip: 'Depth from the shot\'s own range, shallow stays shallow' },
    { value: 'follow', label: 'follow', tip: 'Depth follows a slow 8 s envelope' },
    { value: 'local', label: 'each', tip: 'Every stroke full size (3 s window), detail is lost' },
    { value: 'compress', label: 'compress', tip: 'Squeeze strokes over 1.5× the median (long handheld runs)' },
  ];
  // paw-woz5: the compressor's curve (x = a stroke's size in medians, y = what it becomes; dashed: unchanged) with its two
  // handles: the amount (on the curve) and how long a centre move must last to count as depth (the track under it)
  const CW = 300, CH = 110, CX = 4, PX = 12, PY = 8, TY = CH - 10, XM = 5;
  const cx = (x) => PX + (x / XM) * (CW - 2 * PX), cy = (v) => PY + (1 - v / XM) * (TY - 22 - PY), vOf = (y) => XM * (1 - (y - PY) / (TY - 22 - PY));
  const cms = (v) => PX + (Math.log(v / 1000) / Math.log(120)) * (CW - 2 * PX), msOf = (x) => 1000 * Math.exp(((x - PX) / (CW - 2 * PX)) * Math.log(120));
  const comp = $derived.by(() => {
    const a = S.amount ?? COMPRESS.amount, c = S.centreMs ?? COMPRESS.centreMs, T = COMPRESS.threshold;
    const curve = Array.from({ length: 51 }, (_, k) => [cx((k * XM) / 50), cy(compressCurve((k * XM) / 50, a))]);
    return {
      lines: [{ pts: [[cx(0), cy(0)], [cx(XM), cy(XM)]], kind: 'guide' }, { pts: [[cx(1), cy(0)], [cx(1), cy(XM)]], kind: 'ghost' },
        { pts: [[cx(T), cy(0)], [cx(T), cy(XM)]], kind: 'ghost' }, { pts: curve }, { pts: [[PX, TY], [CW - PX, TY]], kind: 'ghost' }],
      handles: [
        { key: 'amount', label: `Amount: how hard strokes over ${T}x the run's median stroke are squeezed (top = not at all; a bigger stroke always stays bigger). One undo step per drag`, shape: 'hpill', axis: 'y',
          x: cx(CX), y: cy(compressCurve(CX, a)), value: a, min: 0, max: 0.9, step: 0.05, text: a > 0 ? `${(1 / (1 - a)).toFixed(1)} : 1 over ${T}x median` : 'no squeeze',
          toValue: (_, y) => Math.min(0.9, Math.max(0, 1 - Math.log(Math.max(T, vOf(y)) / T) / Math.log(CX / T))) },
        { key: 'centreMs', label: 'Level: a move of the stroke centre shorter than this is drift (taken out, it does not eat the range); a longer one is a change of depth (kept, squeezed like a big stroke). One undo step per drag', shape: 'vpill', axis: 'x',
          x: cms(c), y: TY, value: c, min: 1000, max: 120000, step: 500, text: `level: moves over ${c >= 10000 ? Math.round(c / 1000) : (c / 1000).toFixed(1)} s`, toValue: (x) => Math.min(120000, Math.max(1000, msOf(x))) },
      ],
    };
  });
  let compLast = null;
  const compPreview = (k, v) => { compLast = [k, v]; strokeSet(k, v, false); };
  const compCommit = () => { if (compLast) strokeSet(compLast[0], compLast[1], true); compLast = null; };
  const compCancel = () => { compLast = null; tr.derivePreview = null; };
  const SHAFT_OPTION = { value: 'shaft', label: 'shaft', tip: 'Depth from how much of the shaft is inside' };
  const rangeOptions = $derived(shaft ? [...RANGE_OPTIONS, shaftOff ? { value: 'shaft', label: 'shaft · off', tip: `Not used: the shaft does not follow this shot (r ${dUsed.r})` } : dUsed?.used === 'shaft' && dUsed.r < 0 ? { ...SHAFT_OPTION, tip: `${SHAFT_OPTION.tip}\nRead against the shaft (r ${dUsed.r}), a flip mirrors it` } : SHAFT_OPTION] : RANGE_OPTIONS);
  const strokeSet = (key, v, commit) => put({ strokes: { [key]: v } }, 'Strokes: ' + key, commit);
  const scope = $derived(tr.deriveScope);
  const camOptions = $derived(camOptionsFor(ptsBlock));
  // paw-r73w: the camera removal is folded (the Tracker row's "vs camera" menu is the main place for it); its header says what is
  // set whenever it is not the default, so a non-default mode is never out of sight
  const camTitle = $derived.by(() => {
    const set = [cs.from !== 'tracked' || cam.mode !== CAM_DEFAULT.mode ? (CAM_OPTIONS.find((o) => o.value === cam.mode)?.label || cam.mode) + (cs.from === 'tag' ? ` (${cs.tag.label} default)` : '') : '',
      cam.mode !== 'off' && cam.strength !== CAM_DEFAULT.strength ? cam.strength + ' %' : '', cam.mode !== 'off' && cam.smoothMs !== CAM_DEFAULT.smoothMs ? '~' + cam.smoothMs + ' ms' : ''].filter(Boolean);
    return set.length ? 'Camera removal: ' + set.join(' · ') : 'Camera removal';
  });
  const SRC_OPTIONS = [
    { value: 'background', label: 'static points', tip: 'Camera from the points outside every group' },
    { value: 'all', label: 'all points', tip: 'Camera from every visible point' },
  ];
  const AXIS_OPTIONS = [
    { value: '', label: 'tracked', tip: 'The axis the run was tracked with' },
    { value: 'auto', label: 'auto', tip: 'Principal axis of the motion, per scene' },
    { value: 'vertical', label: 'vert', tip: 'Up = out' },
    { value: 'horizontal', label: 'horiz', tip: 'Right = out' },
    { value: 'custom', label: 'arrow', tip: 'An arrow on the video, its IN end is deeper' },
  ];
  const SCOPE_OPTIONS = [
    { value: 'shot', label: 'shot', tip: 'Changes reach this shot of the run shown only' },
    { value: 'scene', label: 'scene', tip: 'Changes reach every shot of this scene, this run only' },
  ];
  const put = (patch, label, commit = true) => tr.setDerive(i, patch, { commit, scope: tr.deriveScope, label });
  function camSlide(key, v, commit) {
    tr.camPeek = !commit;
    put({ cam: { mode: cam.mode, [key]: v } }, key === 'strength' ? 'Camera removal strength' : 'Camera path smoothing', commit);
  }
  function axisMode(v) {
    if (v === 'custom') { tr.toggleAxisTool(true, i); return; }
    put({ axis: v ? { mode: v } : null }, 'Stroke axis (after tracking)');
  }
  const axisText = $derived.by(() => {
    if (!axis) return '';
    const inf = axis.mode === 'custom' ? axisInfo(axis, tr.aspect) : null;
    return `${d?.axis ? '' : 'tracked: '}${axis.mode}${inf ? ` ${inf.angle}°` : ''}`;
  });
  const flipKey = $derived(app.commands.keysFor?.('track.flipAtPlayhead')?.[0] || 'F');
  // paw-t8z: the tracker's script-shaping pipe_* (moved here from the tracker form): still the panel tracker's params,
  // sent with its next Track (this run keeps the points it was shaped with)
  const PIPE_NOTE = '↻ Needs a re-track: the sidecar shapes a run\'s points with these at the next Track; this run keeps its own. Live shaping of this shot is the controls above.';
  const pipeSchema = $derived(tr.tracker ? paramSchema(tr.tracker.params.filter((p) => isShapePipe(p.key))).map((p) => ({ ...p, label: p.label + ' ↻' })) : []);   // the section's note says what ↻ means
  // paw-rnv1: characters drawn on twos / threes while the picture changes every frame (lib/held.js): found from the painted
  // parts' own tracks, per character; the switch is on the shot (derive.held)
  const hd = $derived(i >= 0 ? tr.heldAt(i) : null);
  const HELD_TIP = 'Characters drawn on twos / threes (a drawing held 2 or 3 frames) while the background, the camera or an effect changes every frame: found from each character\'s painted parts (they stand still, then jump), never from the whole picture. Retimed, every signal made from the parts (fused, pairs, six-axis) gets one sample per drawing at the frame it appears, straight in between, instead of a staircase. The run keeps its tracks as tracked';
  const BAKE_TIP = 'This shot plays the run live: every control here changes its points at once. Bake makes them permanent (one undo step; never needed to play or save)';
  const UNBAKE_TIP = 'This shot is baked: these controls no longer move its points. Unbake drops them so the run plays here live again (one undo step)';
</script>

{#if i >= 0 && run}
  <!-- paw-r73w: in order of use: Fusion (pad, weights), depth, the stroke axis, Smart stroke, Drawings; the camera removal (its
       header names a non-default setting) and the strokes' thresholds folded (remembered: folds.js) -->
  <div class="dv" data-testid="derive-strip" data-surface="panel.adjust">
    <div class="row head">
      <span class="k-caps grow" {@attach tooltip(`Camera and stroke axis of this shot for ${tr.titleOf(run)}, no re-track`)}>Adjust · shot {shotLabel(tr.scenes, i)} · {tr.titleOf(run)}</span>
      <SegmentedControl size="sm" label="Reach" options={SCOPE_OPTIONS} value={scope} onchange={(v) => (tr.deriveScope = v)} />
      <Button size="sm" variant="ghost" disabled={!d || Object.keys(d).every((k) => k === 'smart' || k === 'match') || !!block} onclick={() => put(null, 'Adjust after tracking: reset to auto')} tip="Back to how the run was tracked (camera auto, its own axis)">Reset</Button>
    </div>
    {#if fz}<FusionPanel {app} {i} {fz} />{/if}<!-- paw-iasp: fusion needs the stored centres only, not the point tracks a re-derive needs -->
    {#if block}
      <p class="k-hint warn" data-testid="derive-block">↻ Re-track needed: {block}</p>
    {:else}
      <!-- paw-hmdd: the depth choices on their own line, full width (they were cut to "s… fo… e… sha…" beside the label) -->
      <div class="ctl" data-testid="strokes-depth"><div class="row"><span class="lbl k-caps grow" {@attach tooltip('How the shot\'s signal becomes points')}>Depth</span>
          <Button size="sm" variant="ghost" disabled={!d?.strokes} onclick={() => put({ strokes: null }, 'Strokes: reset')} tip="Back to the default strokes">Reset</Button></div>
        <SegmentedControl size="sm" full label="Depth range" options={rangeOptions} value={S.range} onchange={(v) => strokeSet('range', v, true)} />
        {#if S.range === 'compress'}<CurveEditor W={CW} H={CH} height={110} lines={comp.lines} handles={comp.handles} label="Depth compressor curve" onpreview={compPreview} oncommit={compCommit} oncancel={compCancel} />{/if}
      </div>
      <div class="ctl"><span class="lbl k-caps" {@attach tooltip('Stroke axis of this shot, after tracking')}>Stroke axis (this shot)</span>
        <SegmentedControl size="sm" full label="Stroke axis (this shot)" options={AXIS_OPTIONS} value={tr.axisOn && tr.axisTarget === i ? 'custom' : d?.axis?.mode || ''} onchange={axisMode} /></div>
      <div class="row"><span class="k-hint grow">{axisText} · signal {signal}</span>
        <Button size="sm" variant={tr.axisOn && tr.axisTarget === i ? 'primary' : 'default'} pressed={tr.axisOn && tr.axisTarget === i} disabled={!tr.axisEditable}
          onclick={() => tr.toggleAxisTool(!(tr.axisOn && tr.axisTarget === i), i)} tip="Draw the arrow on the video, from OUT to IN">On video</Button></div>
      <Button size="sm" full variant={smart ? 'primary' : 'default'} pressed={smart} onclick={() => tr.setSmart(i, !smart)} tip={SMART_TIP}>{smart ? 'Smart stroke: on' : 'Smart stroke: fused + strokes'}</Button>
      <p class="k-hint" class:warn={sdir?.confident && !sdir.agrees} data-testid="shaft-direction">{d?.cam ? 'Camera handled as set: proj = proj_cam here. ' : ''}Direction: {sdir ? directionText(sdir, flipKey) + (sdir.confident && !sdir.agrees ? '' : ` · ${flipKey} flips the scene`) : `${flipKey} flips the scene`}.</p>
      {#if bk?.state === 'live'}
        <Button size="sm" full {...cmd(app, 'tracking.bake', { shots: [i] }, { tip: BAKE_TIP })}>Bake this shot</Button>
      {/if}
      {#if bk?.canUnbake}<!-- paw-40ps: a shot whose run pieces are part baked, part live offers both -->

        <Button size="sm" full {...cmd(app, 'tracking.unbake', { shots: [i] }, { tip: UNBAKE_TIP })}>Baked · Unbake</Button>
      {/if}
    {/if}
    {#if hd && (hd.text || hd.own)}
      <div class="row" data-testid="held-row"><span class="lbl k-caps" {@attach tooltip(HELD_TIP)}>Drawings</span>
        <Button size="sm" grow variant={hd.on ? 'primary' : 'default'} pressed={hd.on} onclick={() => tr.setHeld(i, !hd.on)} data-testid="held-chip"
          tip={`${hd.text || 'No twos / threes found in this shot'}. ${hd.on ? 'Retimed: one sample per drawing, where it first appears, straight between them. Click: the parts as tracked (staircase)' : 'Off: the parts as tracked (a staircase on twos / threes). Click: retime them'} (this shot, one undo step)`}>{hd.on ? 'twos / threes: retimed' : 'twos / threes: as tracked'}</Button></div>
    {/if}
    {#if !block}
      <Section title={camTitle} level={4} data-fold="camera" open={foldOpen(app, 'camera')} onchange={(v) => setFold(app, 'camera', v)}>
        <div class="fold">
          <div class="ctl"><span class="lbl k-caps" {@attach tooltip('How camera motion is taken out of this shot')}>Camera</span>
            <SegmentedControl size="sm" full label="Camera removal" options={camOptions} value={cam.mode} onchange={(v) => put({ cam: { mode: v } }, 'Camera mode')} /></div>
          {#if cs.tag || cs.from === 'adjust'}
            <div class="row"><span class="k-hint grow" data-testid="cam-default-note">{cs.from === 'tag' ? `Camera removal ${cs.tag.cam.mode} by default (${cs.tag.label} shot): pick a mode to turn it on` : cs.tag ? `Chosen here: it beats the ${cs.tag.label} default (${cs.tag.cam.mode})` : 'Chosen here (the default is auto)'}</span>
              <Button size="sm" variant="ghost" disabled={cs.from !== 'adjust'} onclick={() => put({ cam: null }, 'Camera removal: back to default')} tip={cs.from !== 'adjust' ? 'Already the default: nothing was chosen for this shot' : `Back to the default (${cs.tag ? cs.tag.cam.mode + ', ' + cs.tag.label : 'auto'})`}>Default</Button></div>
          {/if}
          <div class="row"><span class="lbl k-caps" {@attach tooltip('How much camera motion is taken out' + (cam.mode === 'off' ? ' (camera mode is off)' : ''))}>Strength</span>
            <Slider size="sm" full label="Camera removal strength" min={0} max={100} step={5} value={cam.strength} disabled={cam.mode === 'off'} showValue format={(v) => v + ' %'}
              onchange={(v) => camSlide('strength', v, false)} oncommit={(v) => camSlide('strength', v, true)} /></div>
          <div class="row"><span class="lbl k-caps" {@attach tooltip('Smooth the camera path before removing it' + (cam.mode === 'off' ? ' (camera mode is off)' : ''))}>Smooth</span>
            <Slider size="sm" full label="Camera path smoothing" min={0} max={2000} step={50} value={cam.smoothMs} disabled={cam.mode === 'off'} showValue format={(v) => v + ' ms'}
              onchange={(v) => camSlide('smoothMs', v, false)} oncommit={(v) => camSlide('smoothMs', v, true)} /></div>
          {#if ['move', 'zoom', 'full'].includes(cam.mode)}
            <div class="ctl"><span class="lbl k-caps">Camera from</span>
              <SegmentedControl size="sm" full label="Camera from" options={SRC_OPTIONS} value={cam.source} onchange={(v) => put({ cam: { source: v } }, 'Camera points')} /></div>
          {/if}
        </div>
      </Section>
      <Section title="Strokes{stOn ? '' : ' (classic)'} · {nPts} pts" level={4} data-fold="strokes" open={foldOpen(app, 'strokes')} onchange={(v) => setFold(app, 'strokes', v)}>
        <div class="fold" data-testid="strokes">
          <div class="row"><span class="lbl k-caps" {@attach tooltip('Smallest turn, share of the local stroke size')}>Min stroke</span>
            <Slider size="sm" full label="Min stroke" min={0} max={30} step={1} value={Math.round(S.minStroke * 100)} showValue format={(v) => v + ' %'} onchange={(v) => strokeSet('minStroke', v / 100, false)} oncommit={(v) => strokeSet('minStroke', v / 100, true)} /></div>
          <div class="row"><span class="lbl k-caps" {@attach tooltip('Shorter strokes merge with their smaller neighbor')}>Min length</span>
            <Slider size="sm" full label="Min stroke length" min={0} max={400} step={10} value={S.minMs} showValue format={(v) => v + ' ms'} onchange={(v) => strokeSet('minMs', v, false)} oncommit={(v) => strokeSet('minMs', v, true)} /></div>
          <div class="row"><span class="lbl k-caps" {@attach tooltip('Faster steps are shortened in depth (pos/s, 0: no limit)')}>Max speed</span>
            <Slider size="sm" full label="Max speed" min={0} max={1000} step={25} value={S.maxSpeed} showValue format={(v) => (v ? v + '/s' : 'off')} onchange={(v) => strokeSet('maxSpeed', v, false)} oncommit={(v) => strokeSet('maxSpeed', v, true)} /></div>
          {#if pipeSchema.length}
            <Section title="Advanced (next Track ↻)" open={false} level={4} count={pipeSchema.length} data-testid="pipe-advanced">
              <p class="k-hint">{PIPE_NOTE}</p>
              {#key tr.trackerId}<ParamForm schema={pipeSchema} values={tr.paramsBy[tr.trackerId]} onchange={(v) => Object.assign(tr.paramsBy[tr.trackerId], v)} />{/key}
            </Section>
          {/if}
        </div>
      </Section>
    {/if}
  </div>
{/if}

<style>
  .dv { display: grid; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--line-1); border-radius: var(--radius); background: var(--bg-sunken); }
  .row { display: flex; gap: var(--space-3); align-items: center; min-width: 0; }
  .grow { flex: 1; min-width: 0; }
  .k-hint.grow { overflow-wrap: anywhere; }   /* "signal rel:sem_c1_head:sem_c2_hips" has no break of its own */
  .lbl { min-width: 5.5em; flex: none; white-space: nowrap; color: var(--tx-mut); cursor: help; }   /* caps labels ("STRENGTH") are wider than 5.5em */
  .ctl { display: grid; gap: 2px; min-width: 0; }
  .ctl .lbl { min-width: 0; white-space: normal; }
  .ctl .row .lbl { flex: 1; }   /* Depth: its Reset at the right */
  .head { flex-wrap: wrap; row-gap: var(--space-1); }   /* paw-r73w: the title on its own line(s), never cut; Reach and Reset under it */
  .head .k-caps { cursor: help; flex-basis: 100%; overflow-wrap: anywhere; }
  .head > :global(:last-child) { margin-left: auto; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  p { margin: 0; }
  .warn { color: var(--warn-ink); }
  .fold { display: grid; gap: var(--space-2); min-width: 0; }
</style>
