<script>
  // The picks on the video (a blobs label, the shaft gauge; paw-x8we: no ROI is drawn here any more, Track
  // ROI takes a painted part, outlined while its pick menu points at it), describe tag boxes the user turned
  // on, and what the tracker saw -- the live frame while tracking, else the stored frame AT the playhead of the run there
  // (selected shots only, unless tracking.blobs.follow = playhead: overlay-pick.js). With features/video this registers a drawer + a pointer tool on app.player.overlays (env.map keeps
  // everything glued to the picture under zoom, pan, rotation and flips) and renders nothing itself; with the
  // shell's fallback pane it draws on its own canvas over fitRect of the picture. The drawing helpers are
  // the video feature's (features/video/roi.js); the blobs view (settings 'tracking.trails' = 'blobs') is
  // blobs.js, plus the tracker dock on the stage's left edge (TrackerDock.svelte: channel toggles with their facts, view
  // toggles, the display options tracking.blobs.*), the Info card beside it (opt-in) and, while the shot uses the fused
  // signal, the fusion contribution view (fusion-view.js).
  import { untrack } from 'svelte';
  import { fitRect } from '../../lib/video.js';
  import { drawRoi, drawFrameOverlay, drawTagBox, drawTrails } from '../video/roi.js';
  import { pathPoly } from '../video/overlays.svelte.js';
  import { trackingFor } from './tracking.svelte.js';
  import { LIVE_COLOR, TAG_COLOR, AXIS_COLOR, GROUP_COLORS, STATIC_COLOR, PAIR_COLOR, INK_COLOR, GRID_COLOR, semColor, semPaint, groupPaint, paint as tok } from './colors.js';
  import { drawAxis, AXIS_MODES, axisInfo, axisParams } from './axis.js';
  import SegmentedControl from '../../ui/kit/SegmentedControl.svelte';
  import Button from '../../ui/kit/Button.svelte';
  import { cmd } from '../../app/cmd.js';
  import { BLOB_SCHEMA, blobOpts, drawBlobsView, frameBodies, bodyAt, partAt, semAt, semOf, semNames, hudRows, pointInfo, sparkSeries, MAX_SEM } from './blobs.js';
  import { hiddenSlots, axisUnit } from './dock.js';
  import { partWeights, weightById, drawFusion, frameParts, partNear, drawPairPick } from './fusion-view.js';
  import { partLabel, takeGroups } from './groups.js';
  import { sceneIndexAt } from '../timeline/scenes.js';
  import { cutsOf } from '../timeline/shots.js';
  import { sceneAt, overlayIndex } from '../../lib/runs.js';
  import TrackerDock from './TrackerDock.svelte';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { showContextMenu } from '../../ui/kit/contextmenu.js';
  import { drawShaft } from './shaft-overlay.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);   // app never changes for a mounted panel / lane / overlay
  let canvas = $state(), cw = $state(0), ch = $state(0), themeTick = $state(0);
  $effect(() => onThemeChange(() => { themeTick++; layer?.invalidate(); }));   // tok() reads the theme at paint time

  // the pick tool owns the pointer in the Track tab (its id stays 'tracking.roi': PosBar / Sr6View treat it as the idle tool)
  const editable = $derived(app.mode === 'track' && !!app.doc.media && tr.busy !== 'track');
  let soloHit = null;   // the press landed on a blobs label: its release solos that thing (again: releases it)
  let gauge = null, gaugeHit = false;   // paw-azd: the shaft gauge's rect (last paint); a press on it opens the marks menu
  const SHAFT_MARKS = [
    { label: 'Fully out here (depth mark)', run: () => tr.markShaft('out') },
    { label: 'Hilted here (depth mark)', run: () => tr.markShaft('hilt') },
    { label: 'Clear the depth marks', run: () => tr.markShaft(null) },
  ];
  // a press on nothing is not taken (false): a zoomed view pans as with no tool
  const tool = { id: 'tracking.roi', cursor: 'default',
    down(p, e) {
      if (!editable || e.button !== 0) return false;
      if (gauge && p.x >= gauge.x && p.x <= gauge.x + gauge.w && p.y >= gauge.y && p.y <= gauge.y + gauge.h) { gaugeHit = true; showContextMenu(e, SHAFT_MARKS); return true; }
      const lb = labelAt(p.x, p.y);
      if (lb) { soloHit = lb; return true; }
      return false;
    },
    move() {},
    up() {
      if (gaugeHit) { gaugeHit = false; return; }
      if (soloHit) { solo = sameThing(solo, soloHit) ? null : soloHit; soloHit = null; layer?.invalidate(); }
    },
    context() {},
  };
  const axisOn = $derived(tr.axisOn && tr.axisEditable);
  // paw-57dw: the next run's stroke axis (sent with Track ROI), beside the axis tool while it is on (was the Tracker panel's row)
  const AXIS_SHORT = { auto: 'auto', vertical: 'vert', horizontal: 'horiz', custom: 'arrow' };
  const AXIS_TIPS = { auto: 'Principal axis of the motion (right timing, arbitrary direction)', vertical: 'Up = out', horizontal: 'Right = out', custom: 'The drawn arrow: toward its IN end = deeper' };
  const AXIS_OPTIONS = AXIS_MODES.map((m) => ({ value: m, label: AXIS_SHORT[m], tip: AXIS_TIPS[m] }));
  const axisBar = $derived(axisOn && tr.hasAxis());
  const axisText = $derived.by(() => {
    if (!axisBar) return '';
    const t = tr.tracker, i = axisInfo(tr.axis, tr.aspect), sent = axisParams(t.params, tr.axisMode, tr.axis, tr.params, tr.aspect);
    const what = !tr.axisMode ? `tracker default (${t.params.find((p) => p.key === 'axis')?.default})` : sent.axis === 'custom' ? 'custom arrow' + (sent.primary ? ', primary proj' : '')
      : sent.axis ? sent.axis + (sent.pipe_invert !== undefined ? (sent.pipe_invert ? ', inverted' : ', not inverted') : '') + (tr.axisMode === 'custom' ? ' (nearest)' : '') : 'no arrow: tracker default';
    return (i ? `${i.angle}° · ${i.length.toFixed(2)} h · ` : '') + what;
  });
  // ---- pick a pair on the video (paw-ufv; the pair model is the store's, paw-9qm: tr.pairPick {first, span} | null,
  // tr.pickPairPart(key) per click -- the second click makes the pair the shot's signal). While picking, the pinned parts
  // of the frame on show are the targets: hover rings the one under the pointer, Esc / right-click cancels. ----
  const pairApi = typeof tr.pickPairPart === 'function';
  const picking = $derived(pairApi && !!tr.pairPick && app.mode === 'track');
  let pairHover = $state(null);   // the part (name) under the pointer while picking
  const partsNow = () => (shown ? frameParts(shown.fr, shown.i, shown.run, shown.F) : []);
  const pairName = (key) => (key || '').replace(/^sem_/, '');
  const pairTool = { id: 'tracking.pair', cursor: 'crosshair',
    hint: () => (tr.pairPick?.first ? `Pair: ${partLabel(pairName(tr.pairPick.first))} moves; now click the part it moves against · Esc cancels` : 'Pair: click the moving part · Esc cancels'),
    down(p, e) {
      if (e.button !== 0) return false;
      const n = shown ? partNear(partsNow(), shown.E, p.x, p.y) : null;
      if (n) tr.pickPairPart('sem_' + n);
      return true;
    },
    move() {}, up() {},
    context() { tr.pairPick = null; },
  };
  function startPick() { if (pairApi) tr.pairPick = tr.pairPick ? null : { first: '', span: null }; }
  $effect(() => {
    if (!picking) return;
    const key = (e) => { if (e.key === 'Escape') { tr.pairPick = null; e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); untrack(() => (pairHover = null)); };
  });
  const cur = () => (picking ? pairTool : axisOn ? tr.axisPointer : tool);   // the fallback canvas's pointer tool

  const rect = () => fitRect(cw, ch, app.doc.media?.width, app.doc.media?.height);
  const env = () => { const f = rect(); return { f, map: (nx, ny) => [f.x + nx * f.w, f.y + ny * f.h], unmap: (x, y) => [(x - f.x) / f.w, (y - f.y) / f.h] }; };
  function pt(e) {
    const r = canvas.getBoundingClientRect(), f = rect();
    const rx = (e.clientX - r.left - f.x) / f.w, ry = (e.clientY - r.top - f.y) / f.h;
    return { nx: Math.min(1, Math.max(0, rx)), ny: Math.min(1, Math.max(0, ry)), rx, ry, x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function down(e) { if (cur().down(pt(e), e)) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); } }
  function move(e) { cur().move(pt(e), e); }
  function up(e) { cur().up(pt(e), e); }
  function context(e) { e.preventDefault(); cur().context(pt(e), e); }

  // ---- what is drawn (both paths): ctx in CSS px, E.map(nx, ny) -> px ----
  // paw-9qim: the take's painted groups at t (the blobs view carries their outlines by the points); one array per take
  // while the scenes are unchanged, so the bodies cache holds
  // paw-o60v.6: keyed on the cuts and that shot's own groups array (takeGroups reads nothing else): a tag, or an edit of
  // another take's groups, keeps it (and the blobs view's per-frame bodies with it)
  let paintMemo = { cuts: null, i: -2, gs: null, v: null };
  function paintAt(t) {
    const sc = app.doc.scenes || [], i = sceneIndexAt(sc, t), cuts = cutsOf(sc), gs = sc[i]?.groups;
    if (paintMemo.cuts !== cuts || paintMemo.i !== i || paintMemo.gs !== gs) paintMemo = { cuts, i, gs, v: i >= 0 ? takeGroups(sc, i).filter((g) => g.poly?.length >= 3 && Number.isFinite(g.t_ms)) : null };
    return paintMemo.v;
  }
  function draw(ctx, E, t) {
    if (!app.doc.media) return;
    for (const [k, on] of Object.entries(tr.shownBoxes)) {   // tag boxes the user turned on, inside their scene
      if (!on) continue;
      const c = k.indexOf(':'), i = +k.slice(0, c), tag = k.slice(c + 1), s = tr.scenes[i];
      const box = tr.sceneInfo[i]?.describe?.tags?.find((x) => x.tag === tag)?.box;
      if (s && box && t >= s.start_ms && t < s.end_ms) drawTagBox(ctx, E, box, tag, tok(TAG_COLOR));
    }
    if (app.mode !== 'track') { shown = null; gauge = null; return; }   // the Scenes tab (paw-ef73.1): only the tag boxes its Scenes panel shows, no runs
    tr.tick; themeTick;   // live frames arrive in place: re-read
    // each run draws only its own roi (an old box run's box; a part run's: the painting's bounds)
    // point runs (ov.pts) draw ~0.4 s motion trails unless settings 'tracking.trails' is 'off' ('groups': coloured by the
    // motion group in pts[i][3] when the run has one, 'direction': hue = direction; 'blobs': the blobs view (blobs.js)
    // for runs with groups); others their dots / boxes / masks
    const mode = app.settings.get('tracking.trails'), n = Math.max(2, Math.min(60, Math.round(400 / (app.player.frameMs || 33))));
    const groups = mode === 'groups' || mode === 'blobs' ? [...GROUP_COLORS, STATIC_COLOR].map(tok) : null;
    shown = null;
    const c = current(t);
    if (tr.live) drawRoi(ctx, E, tr.live.roi, tok(LIVE_COLOR));
    else if (c?.run && c.i >= 0) drawRoi(ctx, E, c.run.roi, tok(c.run.color));
    if (c && c.i >= 0) {
      const { fr, i, tMin, tMax, run } = c, pts = fr.ov[i]?.pts;
      if (mode === 'blobs' && pts?.[0]?.length > 3) {
        const ink = { text: tok(INK_COLOR), axis: tok(AXIS_COLOR), pair: tok(PAIR_COLOR), grid: tok(GRID_COLOR) };
        const sn = semNames(run), fz = opts.fusion && !picking ? fusionAt(run, t) : null, hid = app.settings.get('tracking.dock.hidden', []);
        const F = drawBlobsView(ctx, E, fr, i, { colors: groups, ink, opts: alt ? { ...opts, detail: true } : opts, run, solo, lane: run ? tr.channelFor(run) : 'primary', hi: tr.hoverGroup, hiPart: hover?.p ? hover : null, hiSem: hover?.s || 0, hoverPt: hover?.j ?? null, tMin, tMax, nextMs: run ? 2000 : 0, aspect: aspect(),
          hide: hiddenSlots(hid, sn), weight: fz ? weightById(fz.P, sn, WBUF) : null, paint: paintAt(t) });
        if (fz && F) drawFusion(ctx, E, frameParts(fr, i, run, F), fz.P, { run, info: fz.info, t, u: axisUnit(run, tMin, tMax, aspect()), aspect: aspect(), color: semPaint, ink: ink.axis, text: ink.text, alpha: opts.alpha.other ?? 1, hidden: (n) => hid.includes('sem:' + n), label: !opts.axis });
        shown = { ...c, F, E };
      } else if (mode !== 'off' && pts) drawTrails(ctx, E, fr, i, n, tMin, groups, tr.hoverGroup);
      else drawFrameOverlay(ctx, E, fr.ov[i], tr.live ? tok(LIVE_COLOR) : tok(run.color));
    }
    // paw-azd: how much of the shaft is inside (lib/shaft.js), its gauge clear of the blobs labels; click it: depth marks
    if (picking && shown) drawPairPick(ctx, E, partsNow(), { first: pairName(tr.pairPick?.first), hover: pairHover, color: semPaint, label: partLabel });
    // paw-rxr3: the shaft pass's outline on the frame it was made for (sidecar v4.44), only while that frame is on show
    const so = tr.live && tr.progress.outline, fm = app.player.frameMs || 1000 / 30;
    if (so && Math.abs(t - tr.progress.at) <= 1.5 * fm) drawFrameOverlay(ctx, E, { masks: [so] }, tok(LIVE_COLOR));
    const sh = tr.live ? null : tr.shaftAt(t);
    gauge = sh ? drawShaft(ctx, E, sh, { color: semPaint(sh.name), ink: tok(INK_COLOR), avoid: shown?.F?.labels || [] }) : null;
    // paw-x8we: the part the Track ROI menu points at, as painted on its seed frame
    const ph = tr.partHover && tr.paintedParts().find((x) => x.name === tr.partHover);
    if (ph) {
      ctx.save(); ctx.strokeStyle = ctx.fillStyle = groupPaint(ph.name); ctx.lineWidth = 3;
      ctx.beginPath(); pathPoly(ctx, E, ph.group.poly); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); ctx.restore();
    }
    tr.axisMap = E.map;
    tr.axisTick;
    if (app.mode === 'track') { const st = tr.axisPointer.state(); drawAxis(ctx, E, st.axis, { color: tok(AXIS_COLOR), pend: st.pend, dim: !axisOn && !tr.hasAxis() }); }
  }

  // ---- the frame on show: live (its newest), else a stored run's frame AT t only (tracking.svelte.js overlayFrame:
  // overlay-pick.js; the selected shots limit it unless tracking.blobs.follow is 'playhead'), with its scene bounds ----
  function current(t) {
    // live: the newest frame; while the shaft pass steps through the scene (progress.at), the frame on show
    if (tr.live) { const fr = tr.live.frames; return { fr, i: tr.progress.at != null ? overlayIndex(fr, t) : fr.ov.length - 1, tMin: -Infinity, tMax: Infinity, run: null }; }
    return tr.overlayFrame(t);
  }
  // ---- fusion view: the shot at t uses the fused signal (or Smart stroke, built on it) -> its run scene's fusion record
  // and each part's say now (fusion-view.js), else null ----
  const WBUF = new Float64Array(MAX_SEM + 1);
  function fusionAt(run, t) {
    if (!run?.channels?.fused) return null;
    const k = sceneAt(tr.scenes, t);
    if (k < 0 || !(tr.sceneSignal(run, k) === 'fused' || tr.shotDerive(k, run.id)?.smart)) return null;
    const info = run.channels.fused.info?.[Math.max(0, sceneAt(run.scenes || [], t))];
    return info ? { info, P: partWeights(info, t) } : null;
  }
  const aspect = () => (app.doc.media?.width && app.doc.media?.height ? app.doc.media.width / app.doc.media.height : 16 / 9);

  // ---- blobs view: options, hover, HUD ----
  const blobsOn = $derived(app.settings.get('tracking.trails') === 'blobs');
  const opts = $derived(blobOpts((k, d) => app.settings.get(k, d)));
  const formVals = $derived(Object.fromEntries(BLOB_SCHEMA.map((p) => [p.key, app.settings.get('tracking.blobs.' + p.key, p.default)])));
  function setOpts(v) { for (const p of BLOB_SCHEMA) if (v[p.key] !== formVals[p.key]) app.settings.set('tracking.blobs.' + p.key, v[p.key]); }
  let shown = null;         // the last blobs paint: {fr, i, tMin, tMax, run, F (bodies), E (env)} -- hit tests
  let hover = $state(null); // {g} a group's hull | {g, p} one of its parts' hull | {s} a pinned group's | {j} a drawn point, under the pointer
  let mine = false;         // tr.hoverGroup was set by hovering the video (cleared when we leave)
  let stageEl = null;       // features/video: the stage (env px are relative to it); fallback: the canvas is
  let solo = $state(null);  // a thing shown alone ({g} | {g, p} | {s}): click its label; click it again to release
  let alt = $state(false);  // Alt held: every blobs label in full
  const sameThing = (a, b) => !!a && !!b && a.g === b.g && a.p === b.p && a.s === b.s && a.w === b.w;
  /** The blobs label under (x, y) (env px) of the last paint: its thing, or null (a character's label: no hover). */
  const labelAt = (x, y) => { const l = shown?.F?.labels?.find((b) => !b.key.w && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); return l ? l.key : null; };
  $effect(() => {
    if (!blobsOn) return;
    const key = (e) => { if (e.key === 'Alt' && alt !== (e.type === 'keydown')) { alt = e.type === 'keydown'; layer?.invalidate(); } };
    const off = () => { if (alt) { alt = false; layer?.invalidate(); } };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', off); };
  });
  function setHover(h) {
    if (h?.g === hover?.g && h?.p === hover?.p && h?.s === hover?.s && h?.j === hover?.j) return;
    hover = h;
    if (h?.g) { tr.hoverGroup = h.g; mine = true; } else if (mine) { tr.hoverGroup = 0; mine = false; }
  }
  // a point drawn as its own mark (only those hover): visible ones when Points show (decimated: the kept ones and
  // pinned members), occluded ones when those show, any with a non-zero extra element when those show
  const drawnPt = (p, j, F) => (opts.points && p[2] && (!F.keep || F.keep[j] || semOf(p)))
    || (opts.occluded && !p[2] && (!F.keep || F.keep[j]))
    || (opts.extra && p.length > 6 && p.slice(6).some((e) => e));   // pts[4] is the part (v3.4), pts[5] the pinned group (v4.6): not flags
  $effect(() => {
    if (!blobsOn) return;
    const onMove = (e) => {
      const v = shown, host = layer ? stageEl : canvas;
      if (!v || !host || e.buttons) return setHover(null);
      const r = host.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.target instanceof Element && e.target.closest('.tdock')) return;   // the dock's rows set the hover themselves
      if (picking) { const n = x >= 0 && y >= 0 && x <= r.width && y <= r.height ? partNear(partsNow(), v.E, x, y) : null; if (n !== pairHover) { pairHover = n; layer?.invalidate(); } return; }
      if (x < 0 || y < 0 || x > r.width || y > r.height || (e.target instanceof Element && e.target.closest('.bhud, .k-popover'))) return setHover(null);
      const pts = v.fr.ov[v.i]?.pts || [];
      let j = -1, best = 36;   // within 6 px
      for (let k = 0; k < pts.length; k++) {
        if (!drawnPt(pts[k], k, v.F)) continue;
        const [X, Y] = v.E.map(pts[k][0], pts[k][1]), d = (X - x) ** 2 + (Y - y) ** 2;
        if (d < best) { best = d; j = k; }
      }
      if (j >= 0) return setHover({ j });
      const lb = labelAt(x, y);   // a label: its thing
      if (lb) return setHover(lb.s ? { s: lb.s } : lb.p ? { g: lb.g, p: lb.p } : { g: lb.g });
      const [nx, ny] = v.E.unmap(x, y), s = opts.seeded ? semAt(v.F, nx, ny) : 0;
      if (s) return setHover({ s });
      const pa = partAt(v.F, nx, ny), g = pa ? 0 : bodyAt(v.F, nx, ny);
      setHover(pa || (g ? { g } : null));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); untrack(() => setHover(null)); };
  });
  // the frame on show for the dock (null: nothing to show -- the selection rule of overlay-pick.js hides the previous
  // shot's trackers, and the dock with them)
  const view = $derived.by(() => {
    if (!blobsOn || app.mode !== 'track') return null;
    const c = current(app.player.timeMs);
    tr.tick;
    if (!c || c.i < 0 || !(c.fr.ov[c.i]?.pts?.[0]?.length > 3)) return null;
    return { ...c, aspect: aspect() };
  });
  const hud = $derived.by(() => {
    const c = view;
    if (!c || !opts.hud) return null;
    const t = app.player.timeMs;
    const lane = c.run ? tr.channelFor(c.run) : 'primary';
    const F = frameBodies(c.fr, c.i, { smoothMs: opts.smoothMs, decim: opts.decim, tMin: c.tMin, tMax: c.tMax, run: c.run, paint: paintAt(t), aspect: aspect() });
    const body = hover?.g ? F.G[hover.g - 1] : null, sem = hover?.s ? F.S[hover.s - 1] : null, point = hover?.j != null ? pointInfo(c.fr, c.i, hover.j, c.tMin, c.tMax, aspect()) : null;
    return { t, run: c.run, lane, rows: hudRows({ run: c.run, t, lane, hover, body, sem, point, aspect: aspect() }) };
  });
  // sparkline: the primary (bright), the lane's channel when it is another, the candidate signals dim in their own
  // colours; t - 2 s .. t + 1 s, a dashed line at t. 0..1 channels on a fixed scale, others fitted to the window.
  const SPARK = [['proj', AXIS_COLOR], ['proj_cam', 'var(--series-blue)'], ['dist01', 'var(--series-yellow)'], ['who_pair_proj', PAIR_COLOR]];
  const SW = 232, SH = 48, SN = 116;
  let spark = $state();
  $effect(() => {
    const h = hud, cv = spark;
    themeTick;
    if (!cv || !h?.run) return;
    const d = window.devicePixelRatio || 1;
    if (cv.width !== SW * d) { cv.width = SW * d; cv.height = SH * d; }
    const ctx = cv.getContext('2d'), t0 = h.t - 2000, t1 = h.t + 1000, ch = h.run.channels;
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, SW, SH);
    const line = (s, unit, color, alpha, w) => {
      const v = sparkSeries(s, t0, t1, SN);
      let lo = 0, hi = 1;
      if (!unit) { lo = Infinity; hi = -Infinity; for (const y of v) if (y === y) { lo = Math.min(lo, y); hi = Math.max(hi, y); } if (!(hi > lo)) return; }
      ctx.strokeStyle = tok(color); ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.beginPath();
      let pen = false;
      for (let k = 0; k < SN; k++) {
        if (v[k] !== v[k]) { pen = false; continue; }
        const x = (k / (SN - 1)) * SW, y = 2 + (1 - (v[k] - lo) / (hi - lo)) * (SH - 4);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    };
    const unit = (c) => c.min >= 0 && c.max <= 1;
    for (const [k, c] of SPARK) if (ch[k] && k !== h.lane) line(ch[k], unit(ch[k]), c, 0.35, 1);
    if (h.lane !== 'primary' && ch[h.lane]) line(ch[h.lane], unit(ch[h.lane]), SPARK.find((x) => x[0] === h.lane)?.[1] || INK_COLOR, 0.9, 1.5);
    line(h.run.samples, true, INK_COLOR, 1, 1.75);
    const xn = (2000 / 3000) * SW;
    ctx.globalAlpha = 0.6; ctx.strokeStyle = tok(GRID_COLOR); ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(xn, 0); ctx.lineTo(xn, SH); ctx.stroke(); ctx.setLineDash([]);
  });
  const dockColor = (c) => (c.name ? semColor(c.name) : c.slot < 4 ? GROUP_COLORS[c.slot] : c.slot === 4 ? STATIC_COLOR : INK_COLOR);
  function dockHover(c) {
    if (!c) { setHover(null); layer?.invalidate(); return; }
    const s = c.name ? semNames(view?.run).indexOf(c.name) + 1 : 0;
    setHover(s ? { s } : c.slot < 4 ? { g: c.slot + 1 } : null); layer?.invalidate();
  }
  const rowColor = (c) => (c === 'hi' ? 'var(--tx-hi)' : c?.startsWith('sem-') ? semColor(c.slice(4)) : c?.startsWith('g') ? GROUP_COLORS[+c.slice(1) - 1] : null);
  // features/video: the HUD lives in the stage (its corner stays put under zoom / pan); its wrapper stays put for Svelte.
  // A second copy outside any stage (a harness mounting the overlay twice) stays hidden.
  function portal(node) {
    stageEl = (layer && node.parentElement?.closest('[data-testid="video-stage"]')) || null;
    if (stageEl) stageEl.appendChild(node);
    else if (layer) node.hidden = true;
    return { destroy() { node.remove(); } };
  }

  // ---- features/video: the player's overlay layer ----
  // svelte-ignore state_referenced_locally
  const layer = app.player.overlays || null;
  $effect(() => {
    if (!layer) return;
    // register once (add/addTool read the layer's own state: untracked, or this effect would loop)
    const offs = untrack(() => [layer.add({ id: 'tracking.runs', order: 20, draw: (ctx, env) => draw(ctx, env, env.timeMs) }), layer.addTool(tool), layer.addTool(tr.axisPointer), layer.addTool(pairTool)]);
    return () => untrack(() => offs.forEach((f) => f()));
  });
  $effect(() => {
    if (!layer) return;
    const want = picking ? 'tracking.pair' : axisOn ? 'tracking.axis' : editable ? 'tracking.roi' : null;
    untrack(() => { if (want) layer.tool = want; else if (['tracking.roi', 'tracking.axis', 'tracking.pair'].includes(layer.tool)) layer.tool = null; });
  });

  // ---- fallback pane: own canvas ----
  let raf = 0;
  $effect(() => {
    if (layer) return;
    cw; ch; themeTick; tr.axisTick; picking; pairHover; tr.pairPick?.first; tr.axis; tr.axisOn; app.mode; tr.partHover; tr.tick; tr.live; tr.selectedId; tr.runs; tr.sceneInfo; tr.shownBoxes; app.player.timeMs; app.doc.media; app.doc.ghosts; app.settings.values; hover; tr.hoverGroup; tr.links; solo; alt; tr.progress;
    if (!raf) raf = requestAnimationFrame(paint);
  });
  $effect(() => () => cancelAnimationFrame(raf));
  function paint() {
    raf = 0;
    if (!canvas) return;
    const d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cw * d) || canvas.height !== Math.round(ch * d)) { canvas.width = Math.round(cw * d); canvas.height = Math.round(ch * d); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    draw(ctx, env(), app.player.timeMs);
  }
</script>

{#snippet blobsHud()}
  <div class="bhud-at"><div class="tdock-at" use:portal>
    <TrackerDock {app} {view} schema={BLOB_SCHEMA} values={formVals} onchange={setOpts} onhover={dockHover} colorOf={dockColor} pick={picking ? tr.pairPick : null} onpick={pairApi ? startPick : null} />
    {#if hud}<div class="bhud" data-testid="blobs-hud">
      <div class="head">
        <span class="k-caps">Info</span>
        {#if hud.run}<span class="name">{hud.run.name}</span>{/if}
      </div>
      {#if hud.rows.length}
        <dl class="k-num">
          {#each hud.rows as r, n (n)}
            {#if r.wide}<dd class="wide">{r.v}</dd>{:else}<dt class:sec={r.sec} style:color={rowColor(r.c)}>{r.k}</dt><dd class:sec={r.sec} style:color={rowColor(r.c)}>{r.v}</dd>{/if}
          {/each}
        </dl>
      {/if}
      {#if opts.spark && hud.run}<canvas bind:this={spark} class="spark" style:width="{SW}px" style:height="{SH}px"></canvas>{/if}
    </div>{/if}
  </div></div>
{/snippet}

{#snippet axisModeBar()}
  <div class="axbar" use:portal data-testid="axis-mode">
    <span class="k-hint num">Next run: {axisText}</span>
    <SegmentedControl size="sm" label="Stroke axis (next run)" options={AXIS_OPTIONS} value={tr.axisMode} onchange={(v) => tr.setAxisMode(v)} />
    <Button size="sm" variant="ghost" {...cmd(app, 'tracking.axisClear', undefined, { tip: 'Remove the stroke axis' })}>Clear</Button>
  </div>
{/snippet}

{#if axisBar}{@render axisModeBar()}{/if}
{#if !layer}
  <div class="ov" bind:clientWidth={cw} bind:clientHeight={ch}>
    <canvas bind:this={canvas} class:edit={editable || axisOn || picking} onpointerdown={down} onpointermove={move} onpointerup={up} oncontextmenu={editable || axisOn || picking ? context : undefined}></canvas>
    {#if picking}<span class="tip">{pairTool.hint()}</span>{:else if axisOn}<span class="tip">{tr.axisPointer.hint()}</span>{/if}
    {#if view}{@render blobsHud()}{/if}
  </div>
{:else if view}{@render blobsHud()}{/if}

<style>
  .ov { position: absolute; inset: 0; pointer-events: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  canvas.edit { pointer-events: auto; cursor: crosshair; touch-action: none; }
  .bhud-at { display: contents; }
  /* above the tool hint (VideoPane .tip) at the stage's foot */
  .axbar { position: absolute; left: var(--space-5); bottom: calc(var(--space-5) + 30px); z-index: 2; pointer-events: auto; display: flex; align-items: center; gap: var(--space-3);
    max-width: calc(100% - 2 * var(--space-5)); padding: var(--space-1) var(--space-3); background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-radius: var(--radius); }
  .axbar .k-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  /* the dock on the stage's left edge, clear of the corner chips (top) and the tool hint (bottom); the Info card beside it */
  .tdock-at { position: absolute; left: 0; top: calc(var(--space-4) + 32px); bottom: calc(var(--space-4) + 28px); z-index: 1; pointer-events: none;
    display: flex; align-items: flex-start; gap: var(--space-2); }
  .bhud { align-self: flex-end; min-width: 200px; max-width: 280px; pointer-events: none;
    background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-radius: var(--radius); padding: var(--space-2) var(--space-3); color: var(--tx); font-size: var(--fs-1); }
  .bhud .head { display: flex; align-items: center; gap: var(--space-2); pointer-events: auto; color: var(--tx-mut); }
  .bhud .name { color: var(--tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bhud dl { display: grid; grid-template-columns: auto 1fr; gap: 1px var(--space-3); margin: var(--space-1) 0 0; }
  .bhud dt { color: var(--tx-mut); }
  .bhud dd { margin: 0; text-align: right; color: var(--tx-val, var(--tx)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bhud .wide { grid-column: 1 / -1; text-align: left; white-space: normal; color: var(--tx-mut); font-family: var(--font); }
  .bhud .sec { border-top: 1px solid var(--line-1); padding-top: 2px; margin-top: 2px; }
  .bhud .spark { position: static; display: block; margin-top: var(--space-2); }
  .tip { position: absolute; left: var(--space-4); bottom: var(--space-4); pointer-events: none; font-size: var(--fs-2); color: var(--tx); background: var(--glass); backdrop-filter: var(--glass-blur); border: var(--bw) solid var(--line-2); border-radius: var(--radius); padding: var(--space-1) var(--space-4); }
</style>
