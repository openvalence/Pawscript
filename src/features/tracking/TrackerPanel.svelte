<script>
  // The tracker panel (left dock, Track tab), paw-r73w in order of use: the running job / errors, the runs (ghosts) with Bake / Flip / export (paw-x7w7: a run plays live; Bake makes it permanent); folded below and remembered (folds.js): Track options (direction,
  // scenes, grid points, trails) and the Tracker for Track ROI (its params, ROI, groups, parts-first, the next run's axis).
  // paw-p8o2: the shot's Adjust (Fusion on top) lives only in the band under the stroke lane (its ▾), beside the curve it changes.
  // Track / Track ROI / Cancel / the range live on the shot chips, the Tracker row, the status bar and their keys (T, Ctrl+T,
  // Esc, I / O). Scenes (detect / describe / loop, their options) are the Scenes panel (ScenesPanel.svelte); span labels
  // derive from the scene tags at Track time (acts.js tagSpans). All state is trackingFor(app).
  import Icon from '../../ui/kit/Icon.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Select from '../../ui/kit/Select.svelte';
  import ParamForm from '../../ui/kit/ParamForm.svelte';
  import Prop from '../../app/Prop.svelte';
  import { CHANNEL_FIT, CHANNEL_FIT_SCHEMA, decisionsOf, candidateRows, decisionLines, inputLine, modelLines, primaryHow, sceneGroups, relParse, relLabel } from '../../lib/runs-channel.js';
  import Section from '../../ui/kit/Section.svelte';
  import Badge from '../../ui/kit/Badge.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import { AXIS_MODES, axisInfo, axisParams } from './axis.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cmd } from '../../app/cmd.js';
  import { trackerSchemaOf } from './tracker-schema.js';
  import { fmtDuration } from '../../lib/time-format.js';
  import { overlayIndex, runsForScene, sceneAt } from '../../lib/runs.js';
  import { sceneCamera } from '../timeline/acts.js';
  import { ctlLog } from '../../app/ctl-log.js';
  import { foldOpen, setFold } from './folds.js';
  import { trackingFor } from './tracking.svelte.js';
  import { groupsFor } from './groups.svelte.js';
  import { trackGroups, whoName, partLabel } from './groups.js';
  import { partList } from '../../lib/content.js';
  import { heldText, heldScenes } from '../../lib/held.js';
  import { PARTS_FIRST, PARTS_FIRST_TIP, pointTotal, vramGb } from './parts-first.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);   // app never changes for a mounted panel / lane / overlay
  tr.ensureListed();

  const f = (x, d = 2) => (x == null || !Number.isFinite(+x) ? '–' : (+x).toFixed(d));
  const key = (id) => app.commands.keysFor(id)?.[0] || '';
  /** The camera tag (acts.js) of the document scene under run scene i's middle, for the why panel. */
  const camAt = (run, i) => { const s = run.scenes?.[i]; return s ? sceneCamera(tr.scenes[sceneAt(tr.scenes, (s.start_ms + s.end_ms) / 2)]) : null; };
  const t = $derived(tr.tracker);
  const range = $derived(app.doc.range);
  const pct = $derived(tr.progress.total ? Math.round((tr.progress.done / tr.progress.total) * 100) : 0);
  const working = $derived(['track', 'scenes', 'describe', 'loop', 'camera'].includes(tr.busy));
  // svelte-ignore state_referenced_locally
  const GT = groupsFor(app);
  const pinsGroups = $derived(!!t?.params?.some((p) => p.key === 'sem_groups'));
  const nGroups = $derived(pinsGroups ? trackGroups(tr.scenes, tr.span.t0, tr.span.t1).length : 0);
  // v4.14 parts-first: the points a run seeds (grid + groups x group_points) and the tracker's VRAM cap for them
  const hasGP = $derived(!!t?.params?.some((p) => p.key === 'group_points'));
  const isPF = $derived(Object.entries(PARTS_FIRST).every(([k, v]) => tr.params[k] === v));
  const budget = $derived.by(() => {
    if (!hasGP) return null;
    const p = tr.params, k = nGroups || (p.sem_groups ? 3 : 0), gp = +p.group_points || 0, n = pointTotal(p, k), gb = vramGb(t.id, p, n);
    const pts = gp && k ? `${p.box_points} + ${k}×${gp} = ${n} pts` : `${n} pts${k ? ', groups share them' : ''}`;
    // v4.55 auto: 256, or 512 for a small painted part (the sidecar decides per scene and says so in Run details)
    const big = p.model === 'auto' && nGroups ? vramGb(t.id, { ...p, model: '512' }, n) : null;
    return { text: `${pts}${gb ? ` · ≈ ${gb.toFixed(1)} GB` : ''}${big ? ` (512: ${big.toFixed(1)})` : ''}`,
      tip: `Seeded points: the grid${gp ? ' plus points per group' : ''}\n${nGroups ? `${nGroups} painted group${nGroups === 1 ? '' : 's'} in range` : p.sem_groups ? 'Up to 3 tagger groups (penis, balls, hips)' : 'No groups'}` +
        (gb ? `\nVRAM cap ≈ ${gb.toFixed(1)} GB (+1.8 GB while the tagger runs)` : '') +
        (big ? `\n512 input for small parts: ≈ ${big.toFixed(1)} GB` : '') };
  });
  // the Groups button is a plain toggle: the command's guard (selected points, focused timeline row) only protects its key (Tab)
  const GROUPS_TIP = $derived(`Paint the groups the tracker pins (${partList(['penis', 'balls', 'hips', 'tail'])}, ...) on the scene’s seed frame with a soft brush, or start from Suggest; Track sends their outlines instead of the tagger’s`);   // paw-43vn: the part examples follow furry items (lib/content.js)
  // the tracker's params (tracker-schema.js: shared with the Track button's settings popover, paw-unuy)
  const trackerSchema = $derived(trackerSchemaOf(t, tr.hasAxis(t)));
  const AXIS_SHORT = { auto: 'auto', vertical: 'vert', horizontal: 'horiz', custom: 'arrow' };
  const AXIS_TIPS = { auto: 'Principal axis of the motion (right timing, arbitrary direction)', vertical: 'Up = out', horizontal: 'Right = out', custom: 'The drawn arrow: toward its IN end = deeper' };
  const AXIS_OPTIONS = AXIS_MODES.map((m) => ({ value: m, label: AXIS_SHORT[m], tip: AXIS_TIPS[m] }));
  const AXIS_TIP = 'Click 2–4 points on the moving part, then draw the stroke axis once: press at the OUT end, release at the IN end (or two clicks). Moving toward the IN end = deeper (lower pos).';
  const axisDefault = $derived(t?.params?.find((p) => p.key === 'axis')?.default);
  const axisText = $derived.by(() => {
    const i = axisInfo(tr.axis, tr.aspect);
    const sent = t ? axisParams(t.params, tr.axisMode, tr.axis, tr.params, tr.aspect) : {};
    const what = !tr.axisMode ? `tracker default (${axisDefault})` : sent.axis === 'custom' ? 'custom arrow' + (sent.primary ? ', primary proj' : '')
      : sent.axis ? sent.axis + (sent.pipe_invert !== undefined ? (sent.pipe_invert ? ', inverted' : ', not inverted') : '') + (tr.axisMode === 'custom' ? ' (nearest)' : '') : 'no arrow: tracker default';
    return (i ? `${i.angle}° · ${i.length.toFixed(2)} h · ` : '') + what;
  });
  // elapsed time of the running job (a hung describe must be visible)
  let now = $state(Date.now());
  $effect(() => { if (!tr.startedAt) return; now = Date.now(); const iv = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(iv); });
  const elapsed = $derived(tr.startedAt ? Math.max(0, Math.round((now - tr.startedAt) / 1000)) : 0);
  const mmss = (s) => fmtDuration(s * 1000);
  // '43 % · 1:20 left', or before the first frame the sidecar's latest stderr line / stage (lib/progress.js progressText)
  const jobState = $derived(tr.progressLabel);
  // paw-rnv1: the run's characters drawn on twos / threes (lib/held.js), per run scene, in plain words
  const heldTip = (run, held) => 'Characters drawn on twos / threes, found from the painted parts\' own tracks (the whole-picture check misses them when the background or an effect changes every frame): ' + held.map((s) => (run.scenes?.length > 1 ? `scene ${s.k + 1}: ` : '') + heldText(s.chars, (w) => (w.startsWith('sem_') ? partLabel(w.slice(4)) : whoName(w)))).join(' · ') + '. Retimed by default (one sample per drawing); Adjust › Drawings switches it per shot';
  const CAM_TIP = 'The run moves together with the whole picture (a whole-frame optical-flow reference): it most likely follows the camera (pan, zoom, shake), not the moving part. Re-track with points on the moving part and a stroke axis, or a tighter box.';
  const camText = (cm) => !cm ? 'not checked' : cm.pending ? 'checking…' : cm.error ? 'check failed: ' + cm.error : cm.skipped ? 'skipped: ' + cm.skipped
    : `${cm.flag ? 'follows it' : 'independent'} · r ${f(cm.score)} · ${Math.round(cm.together * 100)} % together`;
  const trackerOptions = $derived(tr.trackerChoices);
  const SCENES_TIP = 'How Track splits the range into scenes (the tracker re-seeds from the ROI at each): the document’s scene cuts (merge scenes in the timeline to keep them whole), the sidecar’s cut detector, or the whole range as one scene';
  const DIR_TIP = 'Track from the seed frame (where the box / groups were drawn, else the playhead): both ways (the take around it), forward only, or backward only. One way from a shot\'s first (last) half second goes on past its cut into the take before (after) it, to the next hard cut, an I / O range, or where the points are lost';
  const DIR_OPTIONS = [
    { value: 'both', label: 'both', tip: 'Both ways from the seed frame: its take (as before)' },
    { value: 'forward', label: 'fwd ▶', tip: 'Forward from the seed frame to the end of its take' },
    { value: 'backward', label: '◀ back', tip: 'Backward to the start of its take (point trackers)' },
  ];
  const SCENES_OPTIONS = [
    { value: 'document', label: 'document', tip: 'Split at the timeline’s cuts in the range' },
    { value: 'detect', label: 'detect', tip: 'The tracker finds cuts while tracking' },
    { value: 'one', label: 'one', tip: 'The whole range is one scene: no cuts' },
  ];
  // no trackers because listing failed: one inline message (with Retry) under the Tracker heading, not a second raw copy below
  const listError = $derived(!tr.trackers.length && tr.busy !== 'list' && tr.error ? tr.error : '');
  const busyText = { track: 'Tracking', scenes: 'Detecting scenes', describe: 'Describing', loop: 'Looking for a loop', camera: 'Checking camera motion' };
  // grid points and the run overlay are settings (tracking.gridPoints / tracking.trails): their Prop, the same widget as in the
  // Track menu and Settings (paw-m3b6)
  const TRAILS_TIP = 'Point runs: motion trails colored by motion group (groups; gray = static) or by direction (hue = direction), brightness = speed; tracker view = what the tracker sees: per moving group an outline + its center\'s path, a HUD of the run\'s numbers (its sliders button sets what is drawn); dots = no trails';
  // paw-9qm: no motion-group (g1..g4) legend here any more: the Tracker row's source picker lists them last
  // runs: only those overlapping the current scene (timeline selection, else the playhead's), unless "all runs";
  // the selected one always stays
  let allRuns = $state(false);
  const curScene = $derived(tr.currentScene);
  const curLink = $derived(curScene >= 0 ? tr.sceneLink(curScene) : null);
  const shownGhosts = $derived.by(() => {
    const s = tr.scenes[curScene];
    const runs = tr.ghosts.filter((g) => g.source?.kind !== 'axes');   // paw-2pcf: a run's secondary axes are on their lanes, not runs
    if (allRuns || !s) return runs;
    const near = new Set(runsForScene(runs, s).map((g) => g.id));
    return runs.filter((g) => near.has(g.id) || g.id === tr.selectedId);
  });
  // paw-ef73.33: a derived run's words (lib/link-fill.js): where it comes from and how it follows
  const fillTip = (r) => `${r.name} · ${r.derived.what}: not tracked; the same loop footage laid over this shot by phase (the same picture, the same value), at its source's depth. ${tr.isLiveFill(r) ? 'It follows its source (re-track, flips, Adjust) until baked or detached' : 'Detached: an independent copy'}${r.derived.why ? ` · ${r.derived.why}` : ''}`;
</script>

<div class="tk k-scroll" {@attach ctlLog(app, 'panel')}>
  <!-- paw-r73w: the running job and what went wrong on top, then the runs, the setup folded
       below. Track / Track ROI / Cancel / the range are the shot chips', the Tracker row's, the status bar's and their keys -->
  {#if working || (tr.error && !listError) || tr.notice || listError || tr.gpuNote}
    <section class="status">
      {#if tr.gpuNote}<p class="k-hint notice gpu" data-testid="gpu-note"><Icon name="info" size={13} /><span>{tr.gpuNote}</span></p>{/if}
      {#if working}
        <div class="bar" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style:width={pct + '%'}></i></div>
        <p class="k-hint num">{busyText[tr.busy]} · {jobState}{tr.progress.total ? ` · ${tr.progress.done}/${tr.progress.total}` : ''} · {mmss(elapsed)}</p>
      {/if}
      {#if listError}
        <div class="err-line" role="alert">
          <Icon name="error" size={14} />
          <span class="grow" {@attach tooltip(listError)}>{listError.includes('not found') || listError.includes('no sidecar') ? 'The tracker sidecar is not available. Install uv (docs.astral.sh/uv) or set PAWTRACK_CMD, then retry.' : 'Could not list the trackers.'}
            <details class="raw"><summary>details</summary><code>{listError}</code></details></span>
          <Button size="sm" icon="refresh" {...cmd(app, 'track.listTrackers')}>Retry</Button>
        </div>
      {/if}
      {#if tr.error && !listError}<p class="err-line" role="alert" {@attach tooltip(tr.error)}><Icon name="error" size={14} /><span class="grow ell2">{tr.error}</span></p>{/if}
      {#if tr.notice}<p class="k-hint notice">{tr.notice}</p>{/if}
    </section>
  {/if}

  <!-- ============ runs / ghosts ============ -->
  <section>
    <header><h3 class="k-caps">Runs</h3>
      <span class="k-hint">{#if tr.scenes[curScene] && !allRuns}scene {curScene + 1} · {/if}into <b class="axis">{app.doc.activeAxis}</b></span>
      {#if tr.scenes.length && tr.ghosts.length}<Button size="sm" variant="ghost" pressed={allRuns} onclick={() => (allRuns = !allRuns)} tip="Show every run, not only this scene's">all runs ({tr.ghosts.length})</Button>{/if}
    </header>
    {#each shownGhosts as g (g.id)}
      {@const run = tr.run(g.id)}
      {@const sel = g.id === tr.selectedId}
      {@const sc = tr.scores[g.id]}
      {@const isRef = g.source?.kind === 'reference'}
      {@const notes = (run?.notes || []).filter((n) => n.code !== 'primary' && n.code !== 'primary_used' && n.code !== 'model_size')}
      {@const held = run && !run.restored ? heldScenes(run, tr.aspect).filter((s) => Object.keys(s.chars).length) : []}
      <div class="ghost" class:sel>
        <div class="ghead">
          <button class="eye" data-ctl="run eye" style:--c={g.color} class:off={!g.visible} onclick={() => tr.toggleVisible(g.id)} aria-pressed={g.visible} aria-label="Show {g.name}" {@attach tooltip(g.visible ? 'Hide' : 'Show')}></button>
          <button class="gname" data-ctl="run" class:derived={!!run?.derived} onclick={() => tr.select(sel ? '' : g.id)} aria-expanded={sel} {@attach tooltip(run?.derived ? fillTip(run) : '')}>
            <span class="nm">{run ? tr.titleOf(run) : g.name}</span>
            <span class="meta num">
              {#if run}{run.name}{#if run.derived} · {run.derived.what}{tr.isLiveFill(run) ? '' : ' · detached'}{/if}{#each [...new Set(decisionsOf(run.notes).filter(Boolean).map((d) => d.chosen).filter(Boolean))] as c} · {c}{/each} · {/if}{g.script?.length || 0} pts{#if isRef} · reference{/if}{#if run?.tag === 'camera'} · camera reference{/if}{#if run?.flips.length} · {run.flips.length} flipped{/if}{#if curLink?.runId === g.id} · scene {curScene + 1}: {curLink.channel}{/if}
            </span>
          </button>
          {#if !isRef && tr.reference}
            <span class="f1 num" class:busy={sc?.busy} {@attach tooltip("F1 against the reference")}>{sc?.overall ? f(sc.overall.f1) : sc?.busy ? '…' : ''}</span>
          {/if}
          {#if run?.derived && tr.isLiveFill(run)}
            <IconButton icon="unlink" size="sm" label="Detach: an independent copy that no longer follows its source (one undo step)" onclick={() => tr.detachFill(g.id)} />
          {/if}
          {#if run?.derived || g.source?.derived}
            <IconButton icon="close" size="sm" label="Dismiss: the shot stays empty and is not refilled (one undo step; Fill from its linked shot brings it back)" onclick={() => tr.dismissFill(g.id)} />
          {:else if !g.pinned}
            <IconButton icon="close" size="sm" data-ctl="run remove" label="Remove {g.name}" onclick={() => tr.remove(g.id)} />
          {:else}<span class="pin" role="img" aria-label="Pinned" {@attach tooltip("Pinned")}><Icon name="pin" size={12} /></span>{/if}
        </div>
        {#if run?.cameraMotion?.flag || run?.lowMotion?.low || notes.length || held.length}
          <div class="chips">
            {#if run.cameraMotion?.flag}<Badge tone="warn" {@attach tooltip(CAM_TIP)}>tracks the camera: {f(run.cameraMotion.score)}</Badge>{/if}
            {#if run.lowMotion?.low}<Badge tone="warn" {@attach tooltip(`Moved only ${run.lowMotion.px.toFixed(1)} px (p5–p95, ${run.lowMotion.source}): mostly noise`)}>almost no motion: {run.lowMotion.px.toFixed(1)} px</Badge>{/if}
            {#if held.length}<Badge data-testid="held-badge" {@attach tooltip(heldTip(run, held))}>twos / threes: {held.length === 1 ? (run.scenes?.length > 1 ? 'scene ' + (held[0].k + 1) : 'found') : held.length + ' scenes'}</Badge>{/if}
            {#if notes.length}<Badge {@attach tooltip(notes.map((n) => (n.scene_index != null ? `scene ${n.scene_index + 1}: ` : '') + n.message).join(' · '))}>{notes.length === 1 ? 'tracker note' : notes.length + ' tracker notes'}</Badge>{/if}
          </div>
        {/if}
        {#if sel}
          <div class="gbody">
            <div class="row wrap">
              {#if run}
                <Button size="sm" {...cmd(app, 'tracking.bakeRun', undefined, { tip: 'Make the live points permanent' })}>Bake</Button>
              {/if}
              {#if run}
                <Button size="sm" icon="flip" {...cmd(app, 'track.flipRun', undefined, { tip: `Mirror every scene${key('track.flipAtPlayhead') ? ` (${key('track.flipAtPlayhead')} flips one)` : ''}` })}>Flip</Button>
              {/if}
              {#if !isRef}
                <Button size="sm" icon="export" {...cmd(app, 'track.export', undefined, { tip: tr.exportBlock(g) || (tr.origExists ? 'Write <name>.pawscript.funscript, the original stays' : 'Writes <name>.funscript next to the video') })}>Export</Button>
              {/if}
            </div>
            {#if !isRef && tr.origExists}
              <Button size="sm" variant="danger" onclick={() => tr.exportOverwrite(g.id)} disabled={!!tr.exportBlock(g) || tr.locked}>Overwrite the original .funscript (keeps a .bak)…</Button>
            {/if}
            <!-- paw-r73w: what the sidecar decided, the score, the camera check and the lane channel: folded -->
            <Section title="Run details" level={4} data-fold="run" open={foldOpen(app, 'run')} onchange={(v) => setFold(app, 'run', v)}>
              <div class="fold">
            {#if run}
              {@const decs = decisionsOf(run.notes)}
              {#each decs as d, i (i)}
                {#if d}
                  <div class="prim">
                    <p class="pline">{decs.length > 1 ? `Scene ${i + 1} · ` : ''}Primary: {#if d.chosen}<b>{d.chosen}</b>{d.rule ? ' — ' + d.rule : ''}{:else}{d.message}{/if}</p>
                    {#if primaryHow(d.chosen)}<p class="k-hint">How: {primaryHow(d.chosen)}</p>{/if}
                    {#if relParse(run.sceneChannels?.[i])}{@const rc = run.sceneChannels[i]}{@const ax = run.channels[rc]?.axes?.[i]}<p class="k-hint">lane: {relLabel(sceneGroups(run, i), rc)} (relative, frontend{ax ? ` · axis ${ax.kind} ${ax.deg}°` : ''})</p>{/if}
                    {#if d.candidates}
                      <Section title="Why" open={false} level={4} count={Object.keys(d.candidates).length}>
                        {#each candidateRows(d, sceneGroups(run, i)) as c (c.id)}
                          <div class="cand num" class:on={c.chosen}><span class="cid">{c.id}{#if c.label}<span class="glabel"> · {c.label}</span>{/if}{#if c.chosen} <Badge tone="accent">picked</Badge>{/if}</span><span>{c.text}</span></div>
                        {/each}
                        {#each decisionLines(d, camAt(run, i)) as l}<p class="k-hint num">{l}</p>{/each}
                      </Section>
                    {/if}
                  </div>
                {/if}
              {/each}
              {@const ml = modelLines(run.notes)}
              {#each ml as l, i (i)}{#if l}<p class="k-hint num" data-testid="model-size">{ml.length > 1 ? `Scene ${i + 1} · ` : ''}{l}</p>{/if}{/each}
              {#each run.scenes || [] as s, i (i)}{#if inputLine(s.input)}<p class="k-hint num">{run.scenes.length > 1 ? `Scene ${i + 1} · ` : ''}{inputLine(s.input)}</p>{/if}{/each}
            {/if}
            {#if !isRef && tr.reference}
              <div class="score num">
                {#if !sc}<Button size="sm" variant="ghost" onclick={() => tr.scoreGhost(g.id)}>Score against the reference</Button>
                {:else if sc.busy}scoring…
                {:else if sc.error}<span class="bad">{sc.error}</span>
                {:else}
                  {@const o = sc.overall}
                  <span {@attach tooltip('F1 with the best sign per range, fixed: as given')}>F1 <b>{f(o.f1)}</b> fixed {f(o.f1_fixed_sign)}</span>
                  <span>P {f(o.precision)} R {f(o.recall)}</span>
                  <span {@attach tooltip("median timing error of matched turns")}>dt {f(o.dt_median_ms, 0)} ms · {f(o.dt_median_frames, 1)} f</span>
                  <span {@attach tooltip("> 0 = candidate late")}>lag {f(o.lag_ms, 0)} ms</span>
                  <span>r {f(o.r_pos)} · amp ×{f(o.amp_ratio)}</span>
                  {#if sc.scenes.length > 1}
                    <details class="sub per"><summary>per scene ({sc.scenes.length})</summary>
                      {#each sc.scenes as s, k}
                        <div class="psc"><span>#{k + 1}</span><span>F1 {f(s.f1)}</span><span>fixed {f(s.f1_fixed_sign)}</span><span>{s.sign > 0 ? '+' : '−'}</span><span>{f(s.dt_median_ms, 0)} ms</span></div>
                      {/each}
                    </details>
                  {/if}
                  <Button size="sm" variant="ghost" onclick={() => tr.scoreGhost(g.id)}>Rescore</Button>
                {/if}
              </div>
            {/if}
            {#if run && run.tag !== 'camera'}
              <div class="row cam">
                <span class="k-hint num" class:warn={run.cameraMotion?.flag} {@attach tooltip(CAM_TIP)}>Camera: {camText(run.cameraMotion)}</span>
                <Button size="sm" variant="ghost" icon="refresh" {...cmd(app, 'tracking.checkCamera', undefined, { tip: 'Compare this run with the whole-frame motion' })}>Check camera motion</Button>
              </div>
            {/if}
            {#if run && Object.keys(run.channels).length}
              {@const chNow = tr.channelFor(run)}
              <Select size="sm" full label="Lane channel of {g.name}" value={chNow} onchange={(v) => tr.pickChannel(run.id, v, 'panel')}
                options={[{ value: 'primary', label: 'lane: primary signal' }, ...Object.entries(run.channels).map(([k, c]) => ({ value: k, label: `lane: ${k}${Number.isFinite(c?.min) && Number.isFinite(c?.max) ? ` [${+c.min.toFixed(3)} … ${+c.max.toFixed(3)}]` : ''}` }))]} />
              {#if chNow !== 'primary'}
                <ParamForm schema={CHANNEL_FIT_SCHEMA} values={{ ...CHANNEL_FIT, ...tr.channelFit }} onchange={(v) => tr.setChannelFit(v)} />
              {/if}
            {/if}
              </div>
            </Section>
          </div>
        {/if}
      </div>
    {:else}
      <p class="k-hint">{tr.ghosts.length ? `No run overlaps scene ${curScene + 1}: “all runs” lists the other ${tr.ghosts.length}.` : 'Each finished track plays in the script at once (live); Bake makes it permanent when you want it fixed.'}</p>
    {/each}
  </section>

  <!-- ============ setup (folded; each fold remembers open / closed: folds.js) ============ -->
  <Section title="Track options" data-fold="track" open={foldOpen(app, 'track')} onchange={(v) => setFold(app, 'track', v)}>
    <div class="fold">
      <div class="row"><span class="k-caps lbl" {@attach tooltip(DIR_TIP)}>Direction</span>
        <SegmentedControl size="sm" full label="Track direction" options={DIR_OPTIONS} value={tr.direction} onchange={(v) => tr.setDirection(v)} /></div>
      <div class="row"><span class="k-caps lbl" {@attach tooltip(SCENES_TIP)}>Scenes</span>
        <Prop {app} key="tracking.scenes" full label="Scenes" options={SCENES_OPTIONS} value={tr.scenesMode} /></div>
      <div class="row"><span class="k-caps lbl" {@attach tooltip('Points of Track (T): the grid over the whole frame')}>Grid points</span>
        <Prop {app} key="tracking.gridPoints" full /></div>
      <div class="row"><span class="k-caps lbl" {@attach tooltip(TRAILS_TIP)}>Trails</span>
        <Prop {app} key="tracking.trails" full /></div>
    </div>
  </Section>
  <Section title="Tracker (Track ROI)" data-fold="tracker" open={foldOpen(app, 'tracker')} onchange={(v) => setFold(app, 'tracker', v)}>
    <div class="fold">
      {#if tr.trackers.length}
        <div class="row">
          <Select options={trackerOptions} value={tr.trackerId} onchange={(v) => tr.selectTracker(v)} disabled={!!tr.busy} label="Tracker" size="sm" full />
          {#if tr.listed}<IconButton icon="refresh" size="sm" label="Reload the tracker list" {...cmd(app, 'track.listTrackers', undefined, { tip: 'Reload the tracker list' })} />{/if}
        </div>
        {#if t}
          {#key t.id}<ParamForm schema={trackerSchema} groupsOpen={false} values={tr.paramsBy[t.id]} onchange={(v) => Object.assign(tr.paramsBy[t.id], v)} />{/key}
          {#if pinsGroups}
            <div class="roi" class:ok={nGroups}>
              <Icon name="brush" size={13} />
              <span class="grow" {@attach tooltip(GROUPS_TIP)}>{nGroups ? `${nGroups} drawn group${nGroups === 1 ? '' : 's'} in range` : 'Groups: the tagger’s'}</span>
              <Button size="sm" variant={GT.on ? 'primary' : 'default'} pressed={GT.on} onclick={() => GT.toggle()} disabled={!app.doc.media} tip={GROUPS_TIP} shortcut={key('tracking.groups')}>Groups</Button>
            </div>
          {/if}
          {#if budget}
            <div class="row budget" data-testid="parts-budget">
              <span class="k-hint num grow" {@attach tooltip(budget.tip)}>{budget.text}</span>
              <Button size="sm" variant={isPF ? 'primary' : 'default'} pressed={isPF} onclick={() => Object.assign(tr.paramsBy[t.id], PARTS_FIRST)} disabled={!!tr.busy} tip={PARTS_FIRST_TIP}>Parts-first</Button>
            </div>
          {/if}
          {#if tr.hasAxis(t)}
            <div class="axisrow" class:ok={tr.axis}>
              <div class="row">
                <span class="k-caps lbl grow" {@attach tooltip(AXIS_TIP)}>Stroke axis (next run)</span>
                <Button size="sm" variant={tr.axisOn ? 'primary' : 'default'} pressed={tr.axisOn} onclick={() => tr.toggleAxisTool()} disabled={!tr.axisEditable && !tr.axisOn} tip={AXIS_TIP} shortcut={key('tracking.axisDraw')}>Draw</Button>
                <Button size="sm" variant="ghost" {...cmd(app, 'tracking.axisClear', undefined, { tip: 'Remove the stroke axis' })}>Clear</Button>
              </div>
              <span class="ell k-hint num" {@attach tooltip(axisText)}>{axisText}</span>
              <SegmentedControl size="sm" full label="Stroke axis (next run)" options={AXIS_OPTIONS} value={tr.axisMode} onchange={(v) => tr.setAxisMode(v)} />
            </div>
          {/if}
          {#if !tr.canTrack && tr.trackBlock && tr.listed && !working}<p class="k-hint">{tr.trackBlock}</p>{/if}
        {/if}
      {:else if !listError}
        <p class="k-hint">{tr.busy === 'list' ? 'Asking the sidecar for trackers…' : 'No trackers loaded.'}
          {#if tr.busy !== 'list'}<Button size="sm" variant="ghost" {...cmd(app, 'track.listTrackers')}>Retry</Button>{/if}</p>
      {/if}
    </div>
  </Section>
</div>

<style>
  .tk { height: 100%; overflow-y: auto; display: flex; flex-direction: column; font-size: var(--fs-2); }
  section { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-5) var(--space-5); border-bottom: 1px solid var(--line-1); }
  header { display: flex; align-items: center; gap: var(--space-3); min-height: 18px; }
  header h3 { flex: 1; }
  .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .row { display: flex; gap: var(--space-3); align-items: center; }
  .wrap { flex-wrap: wrap; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }

  details.sub { display: grid; gap: var(--space-3); }
  details.sub > summary { cursor: pointer; color: var(--tx-mut); list-style: none; display: flex; gap: var(--space-2); align-items: center; }
  details.sub > summary::before { content: ''; width: 0; height: 0; border-left: 4px solid currentColor; border-top: 3px solid transparent; border-bottom: 3px solid transparent; transition: transform var(--t-quick); }
  details.sub[open] > summary::before { transform: rotate(90deg); }
  details.sub > summary:hover { color: var(--tx); }

  .roi { display: flex; align-items: center; gap: var(--space-3); color: var(--warn-ink); padding: var(--space-2) var(--space-3); border: 1px dashed rgba(var(--warn-rgb), .45); border-radius: var(--radius); }
  .roi.ok { color: var(--tx-val); border: 1px solid var(--line-1); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 0 var(--space-3) var(--space-2); }
  .cam { flex-wrap: wrap; justify-content: space-between; }
  .axisrow { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px dashed var(--line-2); border-radius: var(--radius); }
  .axisrow.ok { border-style: solid; border-color: var(--line-1); }
  .lbl { cursor: help; }
  .cam .warn { color: var(--warn-ink); }

  .fold { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }   /* a fold's rows (paw-r73w) */
  .status { gap: var(--space-2); padding-block: var(--space-3); }
  .bar { height: 2px; background: var(--line-2); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--reality); box-shadow: var(--glow-reality); transition: width var(--t-quick) linear; }
  .err-line { display: flex; gap: var(--space-3); align-items: flex-start; color: var(--bad-ink); font-size: var(--fs-2); line-height: var(--lh); }
  .err-line :global(.k-icon) { flex: none; margin-top: 2px; }
  .ell2 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .raw summary { cursor: pointer; color: var(--tx-mut); font-size: var(--fs-1); }
  .raw code { display: block; font: var(--fs-1) / 1.4 var(--mono); color: var(--tx-mut); white-space: pre-wrap; word-break: break-word; }
  .notice { color: var(--tx-val); }
  .gpu { display: flex; gap: var(--space-3); align-items: flex-start; }
  .gpu :global(.k-icon) { flex: none; margin-top: 2px; }
  .axis { color: var(--accent-ink); font-weight: 500; }

  /* runs */
  .ghost { border: 1px solid var(--line-1); border-radius: var(--radius); background: var(--bg); }
  .ghost.sel { border-color: var(--sel-line); background: var(--bg-card); }
  .ghead { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3); }
  .eye { width: 12px; height: 12px; border: 2px solid var(--c); background: var(--c); border-radius: 50%; flex: none; }
  .eye.off { background: transparent; opacity: .6; }
  .gname { flex: 1; min-width: 0; display: grid; text-align: left; line-height: 1.3; }
  .gname:hover .nm { color: var(--tx-hi); }
  .gname.derived .nm { font-style: italic; }   /* paw-ef73.33: a derived run (looped from another shot) */
  .nm { color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-3); }
  .ghost.sel .nm { color: var(--tx-hi); }
  .meta { color: var(--tx-mut); font-size: var(--fs-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .f1 { color: var(--tx-val); font-size: var(--fs-2); min-width: 2.2em; text-align: right; }
  .f1.busy { color: var(--tx-ghost); }
  .pin { width: 20px; display: grid; place-items: center; color: var(--tx-ghost); }
  .prim { display: grid; gap: var(--space-1); }
  .pline { margin: 0; font-size: var(--fs-1); color: var(--tx-val); }
  .pline b { color: var(--tx-hi); font-weight: 500; }
  .prim p.k-hint { margin: 0; }
  .cand { display: grid; grid-template-columns: minmax(64px, auto) 1fr; gap: var(--space-2); font-size: var(--fs-1); color: var(--tx-mut); }
  .cand.on { color: var(--tx-hi); }
  .cand .cid { white-space: nowrap; }
  .gbody { display: grid; gap: var(--space-3); padding: var(--space-2) var(--space-3) var(--space-3); border-top: 1px solid var(--line-1); }
  .score { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); font-size: var(--fs-1); color: var(--tx-val); }
  .score b { color: var(--tx-hi); font-weight: 500; }
  .score .bad { color: var(--bad-ink); }
  .per { flex-basis: 100%; }
  .psc { display: grid; grid-template-columns: 2.2em 1fr 1fr 1em 4em; gap: var(--space-3); }
</style>
