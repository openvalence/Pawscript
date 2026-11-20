<!--
  Simulator: the machine preview beside the video. <Simulator {app} /> as a column next to the video stage (VideoPane
  lays them out in a row, so the stage and the picture in it shrink to make room; nothing is drawn over the video).
  Side app.player.ui.simSide, width ui.simWidth (kit Splitter on the inner edge), folded to the bare rail with
  ui.simFold; all kept in video.ui. Draws the active axis (simdraw.js, paw-gwmd): the rail docked at the edge beside the
  video, its head a meteor (Phosphor's comet: glow and tail = where and how fast, a flash of light on each reversal), and
  the script's next ui.simLead ms flowing in from the far edge toward it (wheel over it to change how far), plus small
  indicators for the other axes that have actions.
  Machine preview (app.devicePreview.on, the device profile has kinematics): the carriage follows the planner's motion
  (the whole-script plan, at the profile's stroke length), the commanded script position is a hollow marker, and the
  mini timeline shows the planner's band and its misses with the main timeline's painters (lanes/render.js). Readouts:
  position, speed in mm/s against the profile's limit, the commanded position, and "can't follow" while the machine
  cannot reach the point it is heading to. The speed readout's colour = the review heat settings (the lanes' line ramp).
  One draw per frame on screen (app.player.shownMs, paw-o60v.8.1: playing, each presented frame; paused or scrubbing, the
  frame shown, never the pointer's time ahead of it), and whenever the document, the machine motion or the settings change.
-->
<script>
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Popover from '../../ui/kit/Popover.svelte';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Switch from '../../ui/kit/Switch.svelte';
  import Field from '../../ui/kit/Field.svelte';
  import Splitter from '../../ui/kit/Splitter.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cssVar } from '../../ui/kit/color.js';
  import { onThemeChange, SERIES } from '../../ui/kit/tokens.js';
  import { getProfile, effectiveMaxSpeed, limitsMode } from '../../lib/analyze/profiles.js';
  import { followOf } from '../../lib/follow.svelte.js';
  import { followAt } from '../../lib/follow.js';
  import { finalOf } from '../../lib/finish.js';
  import { SIM_MIN_W, SIM_MAX_W, clampSimWidth, makeSimState, drawGraph, drawAxes, axesGrid, axisKind, readColors,
    rampColor, rampOf, simDebug, clampLead, makeGlow } from './simdraw.js';

  // Optional links to the review (heat settings) and lanes (line ramp, axis colours, the machine painters) features,
  // guarded like the lanes do: the simulator works without them.
  const mods = import.meta.glob(['../review/state.svelte.js', '../lanes/render.js'], { eager: true });
  const pick = (k) => Object.values(mods).find((m) => typeof m[k] === 'function')?.[k];
  const heatmapSettings = pick('heatmapSettings'), bucketColors = pick('bucketColors'), axisSeries = pick('axisSeries');
  const laneMachine = pick('drawMachine'), laneMisses = pick('drawMisses'), laneTheme = pick('readTheme');
  const SERIES_KEYS = SERIES.map((s) => s.key);
  const FOLD_W = 40;

  let { app } = $props();

  const ui = $derived(app.player.ui);
  const axisId = $derived(app.doc.activeAxis);
  // the commanded script: the axis' final (baked + live runs, autorange + effects: lib/finish.js over lib/script-of.js), what
  // the plan follows; in the Track tab while a track runs, its live trace in it (lib/follow.svelte.js)
  const fol = $derived(followOf(app, axisId));
  const cmd = $derived(fol.script);
  const empty = $derived(!(cmd?.length));
  const seriesOf = (id, i) => axisSeries?.(id) || SERIES_KEYS[i % 8];

  // ---- speed colours and the device limit (one source: the review heat settings and the device profile) ----
  const profile = $derived((app.settings.values, app.review?.profile ?? app.devicePreview?.profile
    ?? getProfile(app.settings.get('review.profile', 'generic'), app.settings.get('review.profiles', []))));
  const limit = $derived({ max: effectiveMaxSpeed(profile), mode: limitsMode(profile) });
  const hmax = $derived((app.settings.values, +app.settings.get('review.heatmapMax', 0) || 0));
  const heat = $derived((app.settings.values, (() => {
    try { if (heatmapSettings) return heatmapSettings(app); } catch { /* fall through */ }
    return { scale: app.settings.get('review.heatmapScale', 'heat'), max: hmax || limit.max };
  })()));
  const ramp = $derived(bucketColors ? bucketColors(heat.scale) : rampOf(heat.scale));
  // speeds in mm/s at the profile's stroke when it has kinematics (the plan's stroke), else in units/s
  const mm = $derived(profile?.kinematics?.strokeMm || 0);
  const limShown = $derived(Math.round(mm ? profile.kinematics.vMax : limit.max));
  const unit = $derived(mm ? 'mm/s' : 'u/s');

  // ---- machine preview (app.devicePreview = {on, ghost: {samples, misses, clamps, axis}, engine}) ----
  const dp = $derived(app.devicePreview);
  const ghost = $derived(dp?.on && dp.ghost?.samples?.pos?.length && (dp.ghost.axis == null || dp.ghost.axis === axisId) ? dp.ghost : null);
  const engine = $derived(ghost ? (ghost.samples.engine || dp.engine) === 'kinetic' ? 'Kinetic2' : 'S-curve' : '');
  const machineTip = $derived(ghost ? `The carriage follows the ${engine} planner at the ${profile.name || 'device'} profile's ${mm} mm stroke `
    + '(the Machine panel plans at its own stroke window). The hollow marker is where the script commands it, the bar between them '
    + 'the shortfall; in the graph the band is the machine and warn ticks mark the points it misses, as on the timeline.' : '');

  let C = $state(null), T = null;
  const others = $derived(Object.keys(app.doc.axes).map((id) => [id, finalOf(app, id)])   // every other axis as it plays (live where it has a lane)
    .filter(([id, s]) => id !== axisId && s?.length)
    .map(([id, script], i) => ({ id, label: id.toUpperCase(), kind: axisKind(id), script, color: C?.series[seriesOf(id, i)] })));

  let root = $state(), graphCv = $state(), axesCv = $state(), posEl = $state(), spdEl = $state(), rawEl = $state(), dirEl = $state();
  let gw = $state(0), gh = $state(0), ph = $state(0), dragW = $state(null), themeTick = $state(0), settingsOpen = $state(false);
  const fold = $derived(!!ui.simFold);
  const width = $derived(fold ? FOLD_W : dragW ?? clampSimWidth(ui.simWidth));
  const grid = $derived(axesGrid(others.length, gw));   // gw: the panel's inner width as laid out
  // the indicators give way on short stages: the graph keeps at least ~110 px
  const showAxes = $derived(!fold && others.length > 0 && ph - 90 - (ghost ? 22 : 0) - grid.height >= 110);
  const side = $derived(ui.simSide === 'left' ? 'left' : 'right');

  const S = makeSimState();
  let dpr = 1, raf = 0;
  // last written readout values (null = write next frame); attribute values start dynamic so the compiler keeps
  // the CSS that matches their later values
  let lastP = null, lastSp = null, lastRaw = null, lastCol = null, lastDir = null, lastOver = null, lastMiss = null;
  const dir0 = 'hold', over0 = undefined, miss0 = undefined;

  // ---- sizing: canvases follow their boxes at devicePixelRatio ----
  const observe = (fn) => (node) => {
    const ro = new ResizeObserver(([e]) => fn(e.contentRect));
    ro.observe(node);
    return () => ro.disconnect();
  };
  const sized = observe((r) => { gw = r.width; gh = r.height; });
  const sizedRoot = observe((r) => { ph = r.height; });
  $effect(() => {
    const cv = graphCv, ac = axesCv;
    themeTick; gw; gh; grid.height;
    if (!cv) return;
    dpr = window.devicePixelRatio || 1;
    const fit = (c, w, h) => { const W = Math.round(w * dpr), H = Math.round(h * dpr); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } };
    fit(cv, gw, gh);
    if (ac) fit(ac, gw, grid.height);
    S.fadeX = NaN;
    lastP = lastSp = lastRaw = lastCol = lastDir = lastOver = lastMiss = lastAt = null;   // fresh readout elements after a remount
  });
  $effect(() => {   // theme tokens for the canvases, from the panel's own subtree (the lanes' painters: theirs)
    themeTick;
    if (root) C = readColors((n) => cssVar(n, root), SERIES_KEYS);
    T = laneTheme?.() || null;
    S.lanes = laneMachine && laneMisses && T ? { drawMachine: laneMachine, drawMisses: laneMisses, T } : null;
  });
  $effect(() => onThemeChange(() => themeTick++));

  // ---- drawing ----
  function frame() {
    raf = 0;
    const pl = app.player;
    if (!graphCv || !C || !ui.sim) return;
    const t0 = performance.now();
    S.script = cmd || [];
    S.t = pl.shownMs;   // paw-o60v.8.1: the frame on screen (over the picture: never ahead of it or between frames)
    const at = followAt(fol.spans, S.t), g = at?.kind === 'live' ? null : ghost;   // the planner leaves the live trace out
    S.plan = g ? g.samples : null; S.misses = g ? g.misses : null; S.clamps = g ? g.clamps : null;
    S.lead = fold ? 0 : clampLead(ui.simLead); S.side = side; S.dpr = dpr;
    S.unapplied = !!at; S.quiet = pl.scrubbing; S.frameMs = pl.frameMs;   // the warn ink while following the track in progress; no reversal light while scrubbing
    if (S.glowC !== C || S.glowDpr !== dpr) { S.glowC = C; S.glowDpr = dpr; S.glow = makeGlow(C.accent, dpr); S.glowWarn = makeGlow(C.warn, dpr); }
    S.ramp = ramp; S.max = heat.max > 0 ? heat.max : 400; S.limit = limit.max > 0 ? limit.max : Infinity; S.mode = limit.mode;
    S.w = gw; S.h = gh;
    const ctx = graphCv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const out = drawGraph(ctx, S, C);
    if (axesCv) {
      const a = axesCv.getContext('2d');
      a.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawAxes(a, others, S.t, gw, grid.height, C);
    }
    readouts(out);
    unapplied(at);
    const d = performance.now() - t0;
    simDebug.frames++; simDebug.drawMs = d; simDebug.drawSum += d; if (d > simDebug.drawMax) simDebug.drawMax = d;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  /** Text readouts, written straight to the DOM and only when the shown value changes. */
  function readouts(out) {
    const ok = Number.isFinite(out.pos);
    const p = ok ? Math.round(out.pos * 10) : NaN, sp = ok ? Math.round(mm ? (out.speed * mm) / 100 : out.speed) : NaN;
    if (posEl && !Object.is(p, lastP)) { lastP = p; posEl.textContent = ok ? (p / 10).toFixed(1) : '—'; }
    if (spdEl && !Object.is(sp, lastSp)) { lastSp = sp; spdEl.textContent = ok ? String(sp) : '—'; }
    if (rawEl) {
      const r = Number.isFinite(out.raw) ? Math.round(out.raw * 10) : NaN;
      if (!Object.is(r, lastRaw)) { lastRaw = r; rawEl.textContent = Number.isFinite(r) ? (r / 10).toFixed(1) : '—'; }
    }
    const col = ok && out.speed > 0 ? rampColor(S.ramp, S.max, out.speed) : '';
    if (col !== lastCol) { lastCol = col; root.style.setProperty('--sim-speed', col || 'var(--line-4)'); }
    const over = ok && out.over ? (S.mode === 'planner' ? 'planner' : 'hard') : '';
    if (over !== lastOver) { lastOver = over; if (over) root.dataset.over = over; else delete root.dataset.over; }
    const miss = !!(ok && out.miss);
    if (miss !== lastMiss) { lastMiss = miss; if (miss) root.dataset.miss = ''; else delete root.dataset.miss; }
    const dir = ok ? out.dir : 0;
    if (dirEl && dir !== lastDir) { lastDir = dir; dirEl.dataset.dir = dir > 0 ? 'out' : dir < 0 ? 'in' : 'hold'; }
  }

  /** The "tracking" flag: shown while the preview follows the live trace of a track in progress (dataset, so playback never
   *  re-renders). */
  let lastAt = null, unapTip = $state('');
  function unapplied(at) {
    if (at === lastAt) return;
    lastAt = at;
    if (at) root.dataset.unapplied = at.kind; else delete root.dataset.unapplied;
    unapTip = at ? 'Following the live trace of the track in progress (not the script yet)' : '';
  }

  // Redraw triggers: one draw per frame on screen (app.player.shownMs: playing, each presented frame; paused, a seek once it
  // shows, every decoded frame of a scrub), the document, the motion or the settings.
  $effect(() => {
    if (!ui.sim || !graphCv || !C) return;
    cmd; fol; axisId; others; axesCv; ghost; ramp; heat.max; limit.max; mm; ui.simLead; side; fold; gw; gh; width; grid.height; rawEl; spdEl;
    app.player.shownMs;
    kick();
  });
  $effect(() => () => { cancelAnimationFrame(raf); raf = 0; });

  // ---- settings, resize, fold, hide ----
  const setUi = (patch) => app.player.setUi(patch);
  const hideKey = $derived(app.commands?.keysFor?.('video.sim')?.[0] || '');
  const leaving = () => { settingsOpen = false; if (root?.contains(document.activeElement)) document.activeElement.blur(); };
  function hide() { leaving(); setUi({ sim: false }); }   // the panel unmounts: leave nothing behind (focus, a tooltip, the popover)
  function setFold(on) { leaving(); setUi({ simFold: on }); }
  /** Wheel over the graph: how far ahead the incoming script reaches (0.4 .. 6 s across the panel). */
  const wheelSpan = (node) => {
    const f = (e) => {
      e.preventDefault();
      if (fold) return;
      const a = clampLead(ui.simLead), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY, T2 = clampLead(a * Math.pow(1.0015, dy));
      if (T2 !== a) setUi({ simLead: T2 });
    };
    node.addEventListener('wheel', f, { passive: false });
    return () => node.removeEventListener('wheel', f);
  };
  const spanS = $derived((clampLead(ui.simLead) / 1000).toFixed(1).replace(/\.0$/, ''));
  const SIDES = [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }];
</script>

{#if ui.sim}
  <div class="vsim" class:fold data-side={side} style:width="{width}px" bind:this={root} role="group" aria-label="Machine preview"
    data-over={over0} data-miss={miss0} data-unapplied={miss0} {@attach sizedRoot}>
    <div class="head">
      {#if fold}
        <IconButton icon={side === 'right' ? 'chevron-left' : 'chevron-right'} label="Expand the machine preview" size="sm" onclick={() => setFold(false)} />
      {:else}
        <span class="sw" style:background="var(--series-{seriesOf(axisId, 0)})" aria-hidden="true"></span>
        <span class="axis">{axisId}</span>
        <span class="grow"></span>
        <Popover bind:open={settingsOpen} title="Machine preview" placement={side === 'right' ? 'bottom-end' : 'bottom-start'} class="sim-pop">
          {#snippet trigger({ props })}<IconButton {...props} icon="tune" label="Machine preview settings" size="sm" />{/snippet}
          <div class="form">
            {#if dp}
              <Switch size="sm" label="Follow the device planner" checked={!!dp.on} disabled={!dp.available && !dp.on} onchange={(on) => dp.toggle?.(on)} />
              <p class="k-hint">{dp.available === false ? `The ${profile.name || 'device'} profile has no kinematics: the rail shows the script.` : `The carriage moves as the planner would move the machine, at the ${profile.name || 'device'} profile's ${mm} mm stroke.`}</p>
            {/if}
            <Field inline label="Side">{#snippet children(f)}<SegmentedControl id={f?.id} size="sm" full label="Side" options={SIDES} value={side} onchange={(v) => setUi({ simSide: v })} />{/snippet}</Field>
            <p class="k-hint">Wheel over the graph: how far ahead the script shows (now {spanS} s). Drag the inner edge: width. The speed readout's colour follows the review heatmap scale; the limit is the {profile.name || 'device'} profile's ({limShown} {unit}).</p>
          </div>
        </Popover>
        <IconButton icon={side === 'right' ? 'chevron-right' : 'chevron-left'} label="Fold to the rail" size="sm" onclick={() => setFold(true)} />
        <IconButton icon="close" label="Hide the machine preview" shortcut={hideKey} size="sm" onclick={hide} />
      {/if}
    </div>
    {#if ghost && !fold}
      <div class="mrow" {@attach tooltip(machineTip)}>
        <span class="mk">machine</span><span class="eng">{engine} · {mm} mm</span>
      </div>
    {/if}
    <div class="graph" {@attach sized} {@attach wheelSpan}>
      <canvas bind:this={graphCv} aria-hidden="true"></canvas>
      {#if empty && !fold}<div class="empty"><span>No actions on {axisId}</span></div>{/if}
      {#if !fold}<span class="unap" {@attach tooltip(unapTip)}>tracking</span>{/if}
      {#if ghost && !fold}<span class="miss" {@attach tooltip('Target trimmed over 2 units, or held at the stroke end')}>can't follow</span>{/if}
    </div>
    {#if !fold}
      <!-- two lines that fit the narrowest column: the speed against the limit, then the position and the command -->
      <div class="ro">
        <div class="spd" {@attach tooltip(`Speed of the ${ghost ? 'machine' : 'script'} now, against the ${profile.name || 'device'} profile's limit (${limShown} ${unit})`)}>
          <span class="v k-num" bind:this={spdEl}>—</span><span class="u">{unit}</span><span class="lim k-num">/ {limShown}</span>
        </div>
        <div class="sub k-num">
          <span class="grp"><span class="k">pos</span><span class="pv" bind:this={posEl}>—</span><span class="dir" bind:this={dirEl} data-dir={dir0} aria-hidden="true"></span></span>
          {#if ghost}<span class="grp cmd" {@attach tooltip('Commanded position now (hollow marker on the rail)')}><span class="k">cmd</span><span class="pv raw" bind:this={rawEl}>—</span></span>{/if}
        </div>
      </div>
      {#if showAxes}
        <canvas class="axes" bind:this={axesCv} style:height="{grid.height}px" aria-hidden="true"></canvas>
      {/if}
      <Splitter class="sim-edge" orientation="vertical" label="Machine preview width" value={width} min={SIM_MIN_W} max={SIM_MAX_W}
        reverse={side === 'right'} onresize={(v) => (dragW = v)} oncommit={(v) => { dragW = null; if (v !== ui.simWidth) setUi({ simWidth: v }); }}
        onreset={() => setUi({ simWidth: 168 })} />
    {/if}
  </div>
{/if}

<style>
  /* a column beside the stage (VideoPane's row), never over the picture */
  .vsim {
    --sim-speed: var(--line-4);
    position: relative; flex: none; max-width: 50%; align-self: stretch;
    display: flex; flex-direction: column; min-height: 0; box-sizing: border-box;
    background: var(--bg); color: var(--tx); font-family: var(--font); user-select: none; -webkit-user-select: none;
  }
  .vsim[data-side='right'] { border-left: var(--bw) solid var(--line-1); }
  .vsim[data-side='left'] { order: -1; border-right: var(--bw) solid var(--line-1); }

  .head { flex: none; display: flex; align-items: center; gap: var(--space-1); min-height: calc(var(--ctl-h-sm) + var(--space-2)); padding: 0 var(--space-1) 0 var(--space-3); }
  .fold .head { justify-content: center; padding: 0; }
  .head .sw { margin-right: var(--space-1); }
  .sw { flex: none; width: 6px; height: 6px; border-radius: var(--radius); }
  .axis { font-size: var(--fs-1); font-weight: 500; text-transform: uppercase; letter-spacing: var(--caps-track); color: var(--tx-val);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .grow { flex: 1; }
  /* direction: a small chevron, up = toward out, down = deeper */
  .dir { display: inline-block; vertical-align: middle; margin-left: 2px; width: 0; height: 0; border: 4px solid transparent; }
  .dir[data-dir='out'] { border-bottom: 5px solid var(--sim-speed); border-top-width: 0; }
  .dir[data-dir='in'] { border-top: 5px solid var(--sim-speed); border-bottom-width: 0; }
  .dir[data-dir='hold'] { width: 6px; height: 2px; border: 0; background: var(--line-4); }

  .mrow { flex: none; display: flex; align-items: center; gap: var(--space-2); height: 20px; padding: 0 var(--space-3); font-size: var(--fs-1); white-space: nowrap; overflow: hidden; }
  .mk { color: var(--series-yellow); text-transform: uppercase; letter-spacing: var(--caps-track); font-weight: 500; }
  .eng { color: var(--tx-mut); overflow: hidden; text-overflow: ellipsis; min-width: 0; }

  .graph { position: relative; flex: 1; min-height: 48px; }
  .graph canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 0 var(--space-4); pointer-events: none; }
  .empty span { padding: var(--space-2) var(--space-4); text-align: center; font-size: var(--fs-2); color: var(--tx-mut);
    background: var(--bg-card); border: var(--bw) solid var(--line-2); border-radius: var(--radius); }
  /* the machine cannot follow: a small flag in the graph's top right (absolute: never moves the layout) */
  .miss { display: none; position: absolute; top: 0; right: var(--space-2); padding: 0 var(--space-2); line-height: 14px; font-size: var(--fs-1);
    color: var(--warn-ink); background: color-mix(in srgb, var(--bg) 85%, transparent); border: var(--bw) solid color-mix(in srgb, var(--warn) 45%, transparent); border-radius: var(--radius); white-space: nowrap; }
  .vsim[data-miss] .miss { display: block; }
  /* following the live trace of a track in progress: a flag in the graph's top right (the tip label is over the
     rail, at a third of the width), under "can't follow" when both show; the position bar's ink */
  .unap { display: none; position: absolute; top: 0; right: var(--space-2); padding: 0 var(--space-2); line-height: 14px; font-size: var(--fs-1);
    color: var(--warn-ink); background: color-mix(in srgb, var(--bg) 85%, transparent); border: var(--bw) solid color-mix(in srgb, var(--warn) 45%, transparent); border-radius: var(--radius); white-space: nowrap; }
  .vsim[data-unapplied] .unap { display: block; }
  .vsim[data-miss] .unap { top: 16px; }

  .ro { flex: none; display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) var(--space-3) var(--space-3); border-top: var(--bw) solid var(--line-1); }
  .spd { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; white-space: nowrap; overflow: hidden; padding-left: var(--space-3); border-left: 2px solid var(--sim-speed); }
  .spd .v { font-size: var(--fs-4); line-height: 1.2; color: var(--tx-hi); }
  .u { font-size: var(--fs-1); color: var(--tx-mut); }
  .lim { font-size: var(--fs-1); color: var(--tx-ghost); overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  /* one line, so playback never changes its height (the graph above would jump); a narrow column drops cmd (the hollow
     marker on the rail still shows it) */
  .ro { container-type: inline-size; }
  .sub { display: flex; align-items: center; gap: var(--space-3); min-width: 0; white-space: nowrap; overflow: hidden; padding-left: calc(var(--space-3) + 2px); font-size: var(--fs-2); }
  .grp { display: inline-flex; align-items: center; gap: var(--space-1); }
  @container (max-width: 150px) { .sub .cmd { display: none; } }
  .sub .k { font-family: var(--font); font-size: var(--fs-1); letter-spacing: var(--caps-track); color: var(--tx-mut); }
  .sub .cmd { margin-left: auto; }
  .pv { color: var(--tx-hi); }
  .pv.raw { color: var(--tx-val); }
  /* past the device limit (the script, no machine preview): the speed in the bad ink; a planner reshapes it (info) */
  .vsim[data-over] .spd .v { color: var(--bad-ink); }
  .vsim[data-over='planner'] .spd .v { color: var(--info-ink); }

  .axes { flex: none; display: block; width: 100%; border-top: var(--bw) solid var(--line-1); }

  .vsim :global(.sim-edge) { position: absolute; top: 0; bottom: 0; background: transparent; }
  .vsim[data-side='right'] :global(.sim-edge) { left: -3px; }
  .vsim[data-side='left'] :global(.sim-edge) { right: -3px; }

  .form { display: flex; flex-direction: column; gap: var(--space-4); width: 248px; --field-label-w: 64px; }
  .form p { margin: 0; }
</style>
