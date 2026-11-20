<!--
  StrokerView: the Machine panel's Stroker mode (paw-un2p; stroker.js has the model). In the Machine's 3D stage
  (stroker3d.js, paw-ttky): the penis fixed, its base against the body, the sleeve sliding over it as the script drives
  it (pos 0 = deepest = the sleeve down at the base; past the hilt and past the tip allowed), cut in half along the axis
  on the camera's side so the contact shows, its inner wall lagging the hand through the soft wall (the Machine's
  jiggle), the penis colored by stimulation along its length (one hue, brighter = more). On the model (screen-space
  handles, any angle): drag the tip (length), the side (girth), the corona (glans length); drag the two markers on the
  rail under it for where the sleeve's entrance is at pos 0 and at pos 100 (cross them to invert; below the hilt reads
  "past hilt"). The Machine's camera: drag empty space orbits, Shift+drag or middle-drag pans, wheel zooms toward the
  pointer, double-click frames; the view presets, and "Cutaway" (the flat side drawing). Upright by default (paw-iaai:
  the penis up, the sleeve travelling up and down, the rail beside it; stroker.orientation 'up' | 'side'), a camera
  remembered per orientation (stroker.camUp / stroker.cam, the pivot as a fraction of the length: no size in it).
  Style (stroker.style): 'clean' (flat, the heat painted on) or 'realistic' (skin in stroker.skinTone, a glossy sleeve
  in stroker.sleeveTint, the heat an overlay: stroker.heatOverlay; the penis and scrotum the CC0 mesh, penismesh.js, whose
  own profile the contact then uses). The grip (stroker.grip): the hand's squeeze.
  Every handle, bar and slider updates the view, the heat and the bars while it is dragged; the whole-script totals
  recompute at once in slices and show as updating meanwhile.
  Under it: glans stimulation over time for the visible range and the totals (view, shot / selection, whole script),
  computed off the frame path and cached per script and setup. The sleeve's channel is edited by dragging (kit
  CurveEditor); the zone weights by dragging three bars.
  Settings (all local; stroker.body and what is drawn from it, stroker.rig and stroker.cam, are personal: never logged or
  saved in a project, app.svelte.js UNLOGGED): stroker.body / stroker.sleeve / stroker.sleeves ({id: the owner's edits}) /
  stroker.imported (sleeves from a picture) / stroker.rig ({down, up}: the entrance at pos 0 and pos 100 as fractions of
  the length; null = the sleeve's own window, rigFor) / stroker.weights / stroker.units (cm | in) / stroker.cam (the 3D
  camera, its pan as fractions of the length) / stroker.cut2d (the flat cutaway instead of 3D) / stroker.case (draw a
  product's case round the clear sleeve).
  The pad (stroker.body.padMm: how far the pubic pad compresses, 0 to 4 cm) is the handle on the mound.
-->
<script>
  import { untrack } from 'svelte';
  import { Select, Button, IconButton, Section, Slider, SegmentedControl, Menu, CurveEditor, ColorSwatch } from '../../ui/kit/index.js';
  import Prop from '../../app/Prop.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cssVar, hexToRgb } from '../../ui/kit/color.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { followOf } from '../../lib/follow.svelte.js';
  import { planScript } from '../../lib/analyze/kinematics.js';
  import { DisplayClock, timeSource } from './clock.js';
  import ToyImport from './ToyImport.svelte';
  import { SLEEVES, BODY_LIMITS, WEIGHTS_DEFAULT, ZONES, DISPLAY, ZONE_LABEL, REF, EMIN, exposedMm, validBody, penisProfile, sleeveFor, sleeveFromToy, validSleeve, channelAt,
    geometry, solverOf, stateAt, rigOf, rigToStore, integrate, totals, totalsText, overrun, applyGrip } from './stroker.js';
  import { loadPenisMesh } from './penismesh.js';
  import { StrokerScene, Sway, handles3d, hitHandle, dragMm, strokerCam, camOf, camToStore, orientView, fitView, PRESETS_BY } from './stroker3d.js';
  const BARS = DISPLAY.map((i) => ZONES[i]);   // the zones in anatomical order: glans, corona, shaft, base
  import { viewOf, orbit, pan, zoomAt, blend } from './camera.js';
  // the frame's state on window for dev/stroker-check.mjs: dev and test builds only (paw-garg: it holds the size)
  const DEBUG = typeof import.meta.env === 'object' && !!(import.meta.env.DEV || import.meta.env.VITE_TEST_ID);
  import { project, keepScene } from './gl3d.js';

  let { app, modeSwitch } = $props();
  const S = (k, v) => app.settings.set(k, v);
  const get = (k, d) => (app.settings.values, app.settings.get(k, d));

  // (gripDraft / toneDraft: a Prop's value while it is dragged; the Prop, app/Prop.svelte, writes the setting on release)
  let bodyDraft = $state(null), rigDraft = $state(null), sleeveDraft = $state(null), weightsDraft = $state(null), gripDraft = $state(null), toneDraft = $state(null);
  const body = $derived(validBody(bodyDraft || get('stroker.body', null)));
  const edits = $derived(get('stroker.sleeves', {}) || {});
  const imported = $derived((get('stroker.imported', []) || []).map(validSleeve).filter(Boolean));
  const sleeveId = $derived(get('stroker.sleeve', 'closed-long'));
  const sleeve = $derived(sleeveDraft || sleeveFor(sleeveId, edits, imported));
  const weights = $derived({ ...WEIGHTS_DEFAULT, ...(weightsDraft || get('stroker.weights', {}) || {}) });
  const grip = $derived(gripDraft ?? Math.max(0, Math.min(1, +get('stroker.grip', 0) || 0)));
  const held = $derived(applyGrip(sleeve, grip));   // the sleeve as the hand squeezes it (a caseless one narrows)
  // the realistic style's penis: the CC0 mesh (penismesh.js, paw-45rb), loaded on first use; its own contact profile
  let penisMesh = $state.raw(null);
  const geo = $derived(geometry(body, held, weights, style === 'realistic' ? penisMesh : null));
  const sv = $derived(solverOf(held));
  const rig = $derived(rigDraft || rigOf(get('stroker.rig', null), body, sleeve));
  const units = $derived(get('stroker.units', 'cm') === 'in' ? 'in' : 'cm');
  const fmt = (mm) => (units === 'in' ? `${(mm / 25.4).toFixed(1)} in` : `${(mm / 10).toFixed(1)} cm`);
  /** A marker's place: "4.0 cm", "1.0 cm past hilt", "16.0 cm, off the tip". */
  const fmtAt = (mm) => (mm < 0 ? `${fmt(-mm)} past hilt` : mm > body.lengthMm ? `${fmt(mm)}, off the tip` : fmt(mm));
  const pen = $derived(penisProfile(body));

  // what the device does with the script: the device planner's motion at this travel when a kinematic profile is set
  // (as the Machine plays it), else the script itself; read through the shared accessor (lib/follow.svelte.js)
  const plannedMemo = new WeakMap();
  function drivenOf(script) {
    const p = app.devicePreview?.planned?.(script, Math.max(10, Math.round(Math.abs(rig.upMm - rig.downMm))));
    if (!p) return script;
    let s = plannedMemo.get(p); if (!s) plannedMemo.set(p, (s = planScript(p, 0.05, { from: 0 })));
    return s;
  }

  // ---- the whole script, off the frame path: started at once (also while a handle is dragged), in 5 ms slices between
  // frames, kept per script and setup; the totals show as updating until it lands ----
  let res = $state.raw(null), stale = $state(false), memo = { sc: null, key: '', res: null };
  $effect(() => {
    const sc = drivenOf(followOf(app).script), r = rig, g = geo, key = JSON.stringify([g.body, g.sleeve, g.w, r, !!g.mesh]);
    if (memo.sc === sc && memo.key === key) { res = memo.res; stale = false; return; }
    untrack(() => { stale = true; });
    let it = null, timer = setTimeout(function run() {
      it ??= integrate(sc, r, g, { slice: 5000 });
      const t0 = performance.now();
      let x;
      do x = it.next(); while (!x.done && performance.now() - t0 < 5);
      if (x.done) { memo = { sc, key, res: x.value }; res = x.value; stale = false; } else timer = setTimeout(run, 0);
    }, 0);
    return () => clearTimeout(timer);
  });
  const tView = $derived(totals(res, app.view.start, app.view.start + app.view.span));
  const tAll = $derived(totals(res));
  let tPart = $state.raw(null);   // the selection's (2+ points selected) or the playhead's shot (throttled in frame)

  // ---- canvas, colours, loop ----
  let glc = $state(), scene = null, glFailed = $state(false), sceneTick = $state(0);
  const cut2d = $derived(glFailed || get('stroker.cut2d', false) === true);
  const caseOn = $derived(get('stroker.case', true) !== false);   // a product's hard case drawn round the sleeve
  const orient = $derived(get('stroker.orientation', 'up') === 'side' ? 'side' : 'up');
  const style = $derived(get('stroker.style', 'clean') === 'realistic' ? 'realistic' : 'clean');
  const heatOn = $derived(style === 'clean' || get('stroker.heatOverlay', false) === true);
  const scrotumOn = $derived(get('stroker.scrotum', true) !== false);   // (drawn in the realistic style)
  $effect(() => { if (style === 'realistic' && !penisMesh) loadPenisMesh().then((m) => { penisMesh = m; }, (e) => console.warn('[stroker] the realistic mesh is unavailable, the drawn one:', e?.message || e)); });
  // skin tones (light to deep) and sleeve tints, rgb 0..1; a custom tone between the swatches by a slider
  const TONES = [[0.96, 0.8, 0.69], [0.9, 0.7, 0.56], [0.78, 0.57, 0.43], [0.62, 0.43, 0.31], [0.45, 0.3, 0.21], [0.3, 0.2, 0.14]];
  const toneAt = (t) => { const f = Math.max(0, Math.min(1, t)) * (TONES.length - 1), i = Math.min(TONES.length - 2, Math.floor(f)), u = f - i; return TONES[i].map((x, k) => x + (TONES[i + 1][k] - x) * u); };
  const TINTS = { clear: [0.86, 0.9, 0.96], frosted: [0.96, 0.96, 0.98], pink: [0.98, 0.7, 0.76], blue: [0.6, 0.76, 0.98], smoke: [0.42, 0.42, 0.48] };
  const css = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
  const TONE_SW = TONES.map((c, i) => ({ key: `t${i}`, label: `Skin tone ${i + 1}`, color: css(c), t: i / (TONES.length - 1) }));
  const TINT_SW = Object.entries(TINTS).map(([k, c]) => ({ key: k, label: { clear: 'Clear', frosted: 'Frosted', pink: 'Pink', blue: 'Blue', smoke: 'Smoke' }[k], color: css(c) }));
  const toneT = $derived(toneDraft ?? (Number.isFinite(+get('stroker.skinTone', 0.3)) ? +get('stroker.skinTone', 0.3) : 0.3));
  const tint = $derived(TINTS[get('stroker.sleeveTint', 'clear')] ? get('stroker.sleeveTint', 'clear') : 'clear');
  // the 3D camera (camera.js, as the Machine's), remembered per orientation (stroker.camUp / stroker.cam, the pan as
  // fractions of the length: camToStore); framed on the penis
  const camKey = $derived(orient === 'up' ? 'stroker.camUp' : 'stroker.cam');
  let cam = $state(null), camFor = '', anim = null, camTimer = 0, lastView = null, fitKey = '', fitBase = 1000;
  $effect(() => {
    const k = camKey, L = body.lengthMm, o = orient;
    if (camFor === k && cam) return;
    untrack(() => { cam = camOf(get(k, null), L, o); camFor = k; anim = null; fitKey = ''; });
  });
  const saveCam = () => { clearTimeout(camTimer); const k = camKey, L = body.lengthMm; camTimer = setTimeout(() => { if (cam) S(k, camToStore(cam, L)); }, 300); };
  function camNow() {
    if (!anim) return cam;
    const t = (performance.now() - anim.t0) / anim.ms;
    if (t >= 1) { cam = anim.to; anim = null; saveCam(); return cam; }
    return blend(anim.from, anim.to, t);
  }
  const goTo = (to, ms = 280) => { if (get('stroker.cut2d', false)) S('stroker.cut2d', false); anim = { from: camNow() || to, to, t0: performance.now(), ms }; kick(); };
  const LABEL = { up: { front: 'Front', quarter: '3/4', side: 'Side', top: 'Top-down' }, side: { side: 'Side', quarter: '3/4', top: 'Top', tip: 'Tip-on' } };
  const VIEWS = $derived([...Object.keys(PRESETS_BY[orient]).map((k) => ({ value: k, label: LABEL[orient][k] })), { value: 'cut2d', label: 'Cutaway', tip: 'Flat side cutaway' }]);
  const viewName = $derived(cut2d ? 'cut2d' : cam ? (VIEWS.find((o) => o.value !== 'cut2d' && (() => { const p = strokerCam(o.value, body.lengthMm, orient); return Math.abs(p.az - (((cam.az % 360) + 540) % 360 - 180)) < 1 && Math.abs(p.el - cam.el) < 1 && Math.abs(cam.zoom - 1) < 0.02; })())?.value || '') : '');
  function setView(v) { if (v === 'cut2d') { S('stroker.cut2d', true); return; } goTo(strokerCam(v, body.lengthMm, orient)); }
  // as the Machine's (gl3d.js keepScene): retried while the GPU comes up, rebuilt when a lost context is restored; only
  // then the flat cutaway
  $effect(() => {
    if (!glc) return;
    const stop = keepScene(glc, (c) => new StrokerScene(c), (s, e) => {
      scene = s;
      if (s) untrack(() => { sceneTick++; kick(); });
      else { console.warn('[stroker] 3D view unavailable, the flat cutaway:', e?.message || e); glFailed = true; }
    });
    return () => { stop(); scene = null; };
  });
  const sway = new Sway();
  let lastFrameT = 0, lastRender = 0, info3 = { outer: 30 }, hs = [];

  let root = $state(), stage = $state(), cv = $state(), strip = $state(), cw = $state(0), ch = $state(0), sw = $state(0), C = $state(null), themeTick = $state(0), importing = $state(false);
  let ro = $state.raw({ zone: [0, 0, 0], e: 0 }), lastRo = 0, raf = 0, dpr = 1, visible = true, hover = $state(null), drag = null, view = $state({ zoom: 1, px: 0, py: 0 });
  const dclock = new DisplayClock();
  $effect(() => onThemeChange(() => themeTick++));
  $effect(() => { themeTick; if (root) { const v = (n) => cssVar(n, root); C = { body: v('--line-3'), bg: v('--bg-sunken'), tx: v('--tx'), mut: v('--tx-mut'), faint: v('--tx-faint'), line2: v('--line-2'), line3: v('--line-3'), line4: v('--line-4'), heat: v('--series-orange'), sleeve: v('--series-violet'), accent: v('--accent'), raised: v('--bg-raised'), font: v('--font') || 'sans-serif', mono: v('--mono') || 'monospace' }; } });
  const sized = (node) => { const o = new ResizeObserver(([e]) => { cw = e.contentRect.width; ch = e.contentRect.height; }); o.observe(node); return () => o.disconnect(); };
  const stripSized = (node) => { const o = new ResizeObserver(([e]) => { sw = e.contentRect.width; }); o.observe(node); return () => o.disconnect(); };
  const onScreen = (node) => { const o = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }); o.observe(node); return () => o.disconnect(); };
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  $effect(() => {
    C; geo; rig; sv; cw; ch; sw; view; hover; res; cam; cut2d; caseOn; orient; style; heatOn; scrotumOn; toneT; tint; sceneTick; app.view; app.doc.activeAxis; app.devicePreview?.rev; followOf(app).script;
    if (!app.player.playing) app.player.shownMs; else app.player.playing;
    kick();
  });
  $effect(() => () => { cancelAnimationFrame(raf); raf = 0; clearTimeout(camTimer); });

  const rgb = (s) => { try { return hexToRgb(s); } catch { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128]; } };
  const mix = (a, b, f) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`;
  function fit(c, w, h) { const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr)); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } }

  /** World (z mm from the base, r mm off the axis) -> px: fitted to the body wall, the penis and most of the sleeve's
   *  travel, then the owner's zoom (about a point) and pan. */
  function layoutNow() {
    const [cw, ch] = flatDims();   // (upright: the lying frame's width is the canvas's height)
    const L = body.lengthMm, hiE = Math.max(rig.downMm, rig.upMm), lo = -22, hi = Math.max(L + 30, Math.min(hiE + sleeve.lengthMm, L + 90));
    // across: the sleeve's wall over the widest of the penis, plus the rail and its labels under it (~30 px)
    const R = pen.R * 1.1, rc = Math.min(...sleeve.profile.map((p) => p[1])), outer = Math.max(R, rc) + WALL + Math.max(0, R - rc) * 0.8 + 4;
    const k = Math.min((cw - 24) / (hi - lo), (ch - 52) / (2 * outer + 14)) * view.zoom, cx0 = cw / 2, cy0 = (ch - 34) / 2 + 6, zc = (lo + hi) / 2;
    return { k, X: (z) => cx0 + (z - zc) * k + view.px, cy: cy0 + view.py, cx0, cy0, outer };
  }
  let lay = null, handlesPx = [];
  /** The flat drawing upright: drawn in its lying frame (width = the canvas's height) turned a quarter, the tip up. */
  const flatUp = () => orient === 'up';
  const flatDims = () => (flatUp() ? [ch, cw] : [cw, ch]);
  /** Lying-frame px -> screen px, and a drag direction likewise. */
  const toScreen = (x, y) => (flatUp() ? [y, ch - x] : [x, y]);
  const dirScreen = (a) => (flatUp() ? [a[1], -a[0]] : a);
  const fromScreen = (x, y) => (flatUp() ? [ch - y, x] : [x, y]);
  const WALL = 13, STRIP_MS = 10000;

  function frame() {
    raf = 0;
    if (!C || !cv || cw < 40 || ch < 40 || !visible) return;
    const pl = app.player, tNow = performance.now(), src = timeSource(pl);
    const t = dclock.at(src.t, tNow, { playing: src.direct, frameMs: pl.frameMs || 1000 / 30 });
    const sc = drivenOf(followOf(app).script);
    const s = sc.length ? stateAt(sc, t, rig, geo, sv) : { e: rig.downMm, drive: rig.downMm, v: 0, heat: new Float32Array(geo.rp.length), zone: ZONES.map(() => 0), skin: 0, ...overrun(geo, rig.downMm) };
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const wob = sway.step(s.v, tNow - lastFrameT, pl.playing); lastFrameT = tNow;
    if (!cut2d && scene && !scene.lost && glc && cam) draw3d(s, wob); else draw(s);
    if (strip && sw > 40) drawStrip(t);
    if (!pl.playing || tNow - lastRo > 120) {
      lastRo = tNow; ro = { zone: s.zone, e: s.e };
      const ats = app.doc.selection?.ats, shot = (app.doc.scenes || []).find((x) => x.start_ms <= t && t < x.end_ms);
      if (ats?.size >= 2) { const a = [...ats]; tPart = { label: 'Selection', t: totals(res, Math.min(...a), Math.max(...a)) }; }
      else tPart = shot ? { label: 'Shot', t: totals(res, shot.start_ms, shot.end_ms) } : null;
    }
    if (DEBUG) globalThis.__strokerView = { soft: held.soft, grip, orient, style, mesh: !!geo.mesh, stale, t, e: s.e, drive: s.drive, v: s.v, zone: s.zone, endMm: s.endMm, pastMm: s.pastMm, padMm: s.padMm, skin: s.skin, exposed: exposedMm(geo, s.e), out: s.out, body: { ...body }, sleeve: sleeve.id, rig: { ...rig }, mode3d: !cut2d, cam: cam && { az: cam.az, el: cam.el }, handles: hs.map((q) => [q.key, q.x, q.y, q.a[0], q.a[1]]), all: tAll, view: tView, cost: performance.now() - tNow, frames: (globalThis.__strokerView?.frames || 0) + 1 };
    if ((pl.playing || dclock.moving(tNow) || anim) && visible) raf = requestAnimationFrame(frame);
  }

  function draw(s) {
    fit(cv, cw, ch);
    const g = cv.getContext('2d'), L = body.lengthMm, gl = body.glansMm, cPad = s.padMm || 0, n = Math.min(geo.rp.length, L + 1 + Math.floor(cPad));
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const upr = flatUp(), [cwL, chL] = flatDims();   // (the lying frame's width and height)
    if (upr) g.transform(0, -1, 1, 0, 0, cv.height / dpr);   // (the lying frame turned a quarter: its +x up the screen)
    // text stays upright on the turned drawing: drawn at its point turned back, outlined instead of on a plate
    const T = (txt, x, y) => {
      if (!upr) { g.fillText(txt, x, y); return; }
      g.save(); g.translate(x, y); g.rotate(Math.PI / 2); g.lineWidth = 3; g.strokeStyle = C.bg; g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0); g.restore();
    };
    lay = drag && drag.which !== 'pan' ? drag.lay : layoutNow();   // (a handle drag keeps the framing it started with)
    const { k, X, cy } = lay, rpOf = (z) => geo.rp[Math.max(0, Math.min(n - 1, Math.round(L - z)))];
    // the body wall at the base
    g.fillStyle = C.line3; g.globalAlpha = 0.55; g.fillRect(X(-22 - cPad), cy - (lay.outer + 6) * k, 22 * k, 2 * (lay.outer + 6) * k); g.globalAlpha = 1;   // (dented in by the pad's press)
    // the penis: heat per station, one hue (the body's neutral -> the heat colour)
    const base = rgb(C.line4), hot = rgb(C.heat), norm = 30 / REF;
    for (let s0 = 0; s0 < n - 1; s0++) {
      const hv = Math.min(1, (s.heat[s0] * norm) / 1.1), z = L - s0, r = geo.rp[s0];
      g.fillStyle = mix(base, hot, Math.sqrt(hv));
      g.fillRect(X(z - 1), cy - r * k, Math.max(1, k + 0.5), 2 * r * k);
    }
    g.strokeStyle = C.mut; g.lineWidth = 1.2; g.beginPath();
    for (let s0 = n - 1; s0 >= 0; s0--) g.lineTo(X(L - s0), cy - geo.rp[s0] * k);
    for (let s0 = 0; s0 < n; s0++) g.lineTo(X(L - s0), cy + geo.rp[s0] * k);
    g.stroke();
    g.setLineDash([2, 3]); g.strokeStyle = C.faint; g.beginPath(); g.moveTo(X(L - gl), cy - rpOf(L - gl) * k); g.lineTo(X(L - gl), cy + rpOf(L - gl) * k); g.stroke(); g.setLineDash([]);
    // the sleeve (cutaway: its two walls), its inner wall at e, stretched where the penis is wider than the channel and
    // bulging out by most of it; a closed end capped
    const e = s.seat ?? s.e, Ls = sleeve.lengthMm, sl = rgb(C.sleeve), wall = Ls < 40 ? 9 : WALL;
    g.fillStyle = mix(sl, [150, 148, 168], 0.3); g.globalAlpha = 0.82;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      const pts = [];
      for (let x = 0; x <= Ls; x += Math.max(1, Ls / 120)) {
        const z = e + x, rc = channelAt(sleeve, x), rpz = z >= 0 && z <= L ? rpOf(z) : 0, ri = Math.max(rc, rpz), ro = rc + wall + (ri - rc) * 0.8;
        pts.push([X(z), ri, ro]);   // (seated: never deeper than the pressed pad)
      }
      pts.forEach(([x, ri], i) => (i ? g.lineTo(x, cy + sgn * ri * k) : g.moveTo(x, cy + sgn * ri * k)));
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], cy + sgn * pts[i][2] * k);
      g.closePath(); g.fill();
    }
    if (!sleeve.open) { const rc = channelAt(sleeve, Ls), ro = rc + wall; g.fillRect(X(Math.max(e + Ls, L + 1)), cy - ro * k, Math.max(2, wall * 0.6 * k), 2 * ro * k); }   // (the closed end pushed out by the tip)
    g.globalAlpha = 1;
    // the hand (the drive): two grips on the shell at the driven position; the inner wall lags it
    { const gw = Math.min(Ls, 40) * k, gx = X(s.drive + Ls / 2) - gw / 2, gr = (lay.outer + 2) * k;
      g.strokeStyle = C.mut; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); if (g.roundRect) g.roundRect(gx, cy - gr, gw, 2 * gr, 6); else g.rect(gx, cy - gr, gw, 2 * gr); g.stroke(); g.setLineDash([]); }
    // the rail: where the entrance is at pos 0 and pos 100, and now
    const yR = Math.min(chL - 30, cy + lay.outer * k + 6);
    g.strokeStyle = C.line3; g.lineWidth = 1; g.beginPath(); g.moveTo(X(Math.min(0, rig.downMm, rig.upMm)), yR + 0.5); g.lineTo(X(Math.max(L, rig.upMm, rig.downMm) + 10), yR + 0.5); g.stroke();
    g.strokeStyle = C.accent; g.lineWidth = 3; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(X(rig.downMm), yR + 0.5); g.lineTo(X(rig.upMm), yR + 0.5); g.stroke(); g.globalAlpha = 1; g.lineWidth = 1;
    g.fillStyle = C.tx; g.beginPath(); g.arc(X(e), yR + 0.5, 3, 0, Math.PI * 2); g.fill();
    const tri = (x, on) => { g.beginPath(); g.moveTo(x, yR - 1); g.lineTo(x - 6, yR + 9); g.lineTo(x + 6, yR + 9); g.closePath(); g.fillStyle = on ? C.accent : C.raised; g.strokeStyle = C.accent; g.fill(); g.stroke(); };
    tri(X(rig.downMm), hover === 'down'); tri(X(rig.upMm), hover === 'up');
    g.font = `10px ${C.mono}`; g.fillStyle = C.mut; g.textBaseline = 'top';
    const lab = (x, txt, al) => { const w = g.measureText(txt).width, x0 = Math.max(4, Math.min(cwL - 4 - w, al === 'left' ? x : al === 'right' ? x - w : x - w / 2)); g.textAlign = 'left'; T(txt, x0, yR + 11); };   // (kept on the canvas)
    const dn = X(rig.downMm), up = X(rig.upMm);
    if (Math.abs(up - dn) > 70) { lab(dn, `pos 0 · ${fmtAt(rig.downMm)}`, dn < up ? 'right' : 'left'); lab(up, `pos 100 · ${fmtAt(rig.upMm)}`, dn < up ? 'left' : 'right'); }
    else lab((dn + up) / 2, `pos 0 · ${fmtAt(rig.downMm)}, pos 100 · ${fmtAt(rig.upMm)}`, 'center');
    // size handles with live numbers: tip (length), top edge (girth), corona (glans)
    const zg = L * 0.42, hTip = [X(L) + 6, cy], hGirth = [X(zg), cy - rpOf(zg) * k], hGlans = [X(L - gl), cy + rpOf(L - gl) * k];
    handlesPx = [['tip', ...hTip], ['girth', ...hGirth], ['glans', ...hGlans], ['down', X(rig.downMm), yR + 4], ['up', X(rig.upMm), yR + 4]];
    const A = { tip: [k, 0], girth: [0, -k], glans: [-k, 0], down: [k, 0], up: [k, 0] };
    if (!(drag && drag.h)) hs = handlesPx.map(([key, x, y]) => { const [sx, sy] = toScreen(x, y); return { key, x: sx, y: sy, a: dirScreen(A[key]) }; });
    const pill = ([x, y], vert, on) => { g.beginPath(); if (g.roundRect) g.roundRect(vert ? x - 4 : x - 9, vert ? y - 9 : y - 4, vert ? 8 : 18, vert ? 18 : 8, 4); else g.rect(vert ? x - 4 : x - 9, vert ? y - 9 : y - 4, vert ? 8 : 18, vert ? 18 : 8); g.fillStyle = on ? C.accent : C.raised; g.strokeStyle = C.accent; g.lineWidth = 2; g.fill(); g.stroke(); g.lineWidth = 1; };
    pill(hTip, true, hover === 'tip'); pill(hGirth, false, hover === 'girth'); pill(hGlans, true, hover === 'glans');
    // the numbers on small plates (legible over the sleeve)
    g.font = `10px ${C.mono}`; g.textBaseline = 'middle';
    const plate = (txt, x, y, al) => { const w = g.measureText(txt).width + 6, x0 = upr ? x : al === 'left' ? x : x - w / 2; if (!upr) { g.globalAlpha = 0.85; g.fillStyle = C.bg; g.fillRect(x0, y - 7, w, 14); g.globalAlpha = 1; } g.fillStyle = C.tx; g.textAlign = 'left'; T(txt, x0 + 3, y + 0.5); };
    plate(fmt(L), hTip[0] + 8, hTip[1] - 14, 'left');
    plate(`girth ${fmt(body.girthMm)}`, hGirth[0], hGirth[1] - 14, 'center');
    plate(`glans ${fmt(gl)}`, hGlans[0], hGlans[1] + 15, 'center');
  }

  const rgb01 = (c) => rgb(c).map((x) => x / 255);
  const mix01 = (a, b, f) => a.map((x, i) => x + (b[i] - x) * f);
  /** One 3D frame: the scene, then the handles and their numbers on the overlay. */
  function draw3d(s, wob) {
    const c = camNow(), L = body.lengthMm, span = Math.max(L + 60, Math.max(rig.downMm, rig.upMm) + sleeve.lengthMm * 0.6 + 30), hw = info3.outer + 30;
    // the points that must fit (the model's frame, about the pivot in the middle of the penis)
    const pts = [[0, -span / 2, 0], [0, span / 2, 0], [hw, 0, 0], [-hw, 0, 0], [0, 0, hw * 0.7], [0, 0, -hw * 0.7]];
    const fk = JSON.stringify([c.az, c.el, span, hw, cw, ch, orient]);
    if (fk !== fitKey) { fitKey = fk; fitBase = fitView({ ...c, shift: 0 }, pts, cw, ch, orient); }
    const v0 = viewOf(c, fitBase, cw, ch), v = orientView(v0, orient);
    lastView = v0;   // (pan and zoom work on the world's camera)
    const tx = rgb01(C.tx), real = style === 'realistic';
    const skinC = real ? toneAt(toneT) : mix01(rgb01(C.line4), tx, 0.42);
    const glansC = real ? mix01(skinC.map((x) => x * 0.9), [0.72, 0.36, 0.38], 0.3) : mix01(skinC, [0.62, 0.42, 0.45], 0.28);
    const sleeveC = real ? TINTS[tint] : mix01(rgb01(C.sleeve), [0.75, 0.78, 0.86], 0.45);
    const tNow = performance.now(), dtMs = tNow - (lastRender || tNow); lastRender = tNow;
    info3 = scene.render({ w: cw, h: ch, dpr, view: v, floorVp: v0.vp, floorEye: v0.eye, floorZ: -(26 + (info3.c || 0)), orient, geo, s, wob, sleeve: held, showCase: caseOn, style, heat: heatOn, scrotum: scrotumOn, dtMs, playing: app.player.playing,
      colors: { bg: rgb01(C.bg), grid: rgb01(C.line4), body: real ? skinC.map((x) => x * 0.88) : mix01(rgb01(C.line4), tx, 0.34), skin: skinC, glans: glansC, heat: rgb01(C.heat), sleeve: sleeveC,
        thick: sleeveC.map((x) => x * (real ? 0.62 : 0.85)), tint: mix01(sleeveC, [1, 1, 1], 0.55), edge: mix01(tx, rgb01(C.accent), 0.35), warm: [1, 0.42, 0.32], shadow: [0, 0, 0] } });
    hs = drag && drag.h ? hs : handles3d({ L, glansMm: body.glansMm, R: pen.R, rig, outer: info3.outer, c: info3.c }, v, cw, ch);
    overlay3d(s, v);
  }
  function overlay3d(s, v) {
    fit(cv, cw, ch);
    const g = cv.getContext('2d'), L = body.lengthMm;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = (p) => project(v.vp, p, cw, ch), dn = hs.find((q) => q.key === 'down'), upH = hs.find((q) => q.key === 'up');
    // the rail under the model: the body (hilt) to past the tip, the window between the markers, the entrance now
    if (dn) {
      const off = dn.at, at = (y) => P([off[0], y, off[2]]), a = at(Math.min(EMIN, rig.downMm, rig.upMm)), b = at(Math.max(L, rig.downMm, rig.upMm) + 10), h0 = at(0);
      if (a[2] > 0 && b[2] > 0) {
        g.strokeStyle = C.line3; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.strokeStyle = C.mut; g.beginPath(); g.moveTo(h0[0], h0[1] - 5); g.lineTo(h0[0], h0[1] + 5); g.stroke();
        if (upH) { g.strokeStyle = C.accent; g.lineWidth = 3; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(dn.x, dn.y); g.lineTo(upH.x, upH.y); g.stroke(); g.globalAlpha = 1; g.lineWidth = 1; }
        const now = at(s.e); g.fillStyle = C.tx; g.beginPath(); g.arc(now[0], now[1], 3, 0, Math.PI * 2); g.fill();
      }
    }
    // the handles: a dot each (filled while hovered or dragged), the number on a plate beside it
    g.font = `10px ${C.mono}`; g.textBaseline = 'middle';
    // a plate beside its point, clear of every handle and of the plates already placed (the first side that is free)
    const taken = hs.map((q) => [q.x - 8, q.y - 8, 16, 16]);
    const hit = (r) => taken.some((t) => r[0] < t[0] + t[2] && t[0] < r[0] + r[2] && r[1] < t[1] + t[3] && t[1] < r[1] + r[3]);
    const plate = (txt, x, y) => {
      const w = g.measureText(txt).width + 6;
      let r = null;
      for (const [dx, dy] of [[10, -20], [10, 6], [-10 - w, -20], [-10 - w, 6], [-w / 2, -30], [-w / 2, 16], [10, -36], [10, 22], [-10 - w, -36], [-10 - w, 22]]) {
        const c = [Math.max(4, Math.min(cw - w - 4, x + dx)), Math.max(2, Math.min(ch - 16, y + dy)), w, 14];
        if (!hit(c)) { r = c; break; }
        r ??= c;
      }
      taken.push(r);
      g.globalAlpha = 0.85; g.fillStyle = C.bg; g.fillRect(r[0], r[1], w, 14); g.globalAlpha = 1; g.fillStyle = C.tx; g.textAlign = 'left'; g.fillText(txt, r[0] + 3, r[1] + 7.5);
    };
    const TEXT = { tip: fmt(L), girth: `girth ${fmt(body.girthMm)}`, glans: `glans ${fmt(body.glansMm)}`, down: `pos 0 · ${fmtAt(rig.downMm)}`, up: `pos 100 · ${fmtAt(rig.upMm)}`, pad: `pad ${fmt(body.padMm)}` };
    for (const q of hs) {
      const on = hover === q.key || drag?.h?.key === q.key;
      g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.fillStyle = on ? C.accent : C.raised; g.strokeStyle = C.accent; g.lineWidth = 2; g.fill(); g.stroke(); g.lineWidth = 1;
      plate(TEXT[q.key], q.x, q.y);
    }
    // what the sleeve is doing past its limits, top right under the view buttons
    const notes = [s.endMm > 0.5 ? `end pressed in ${fmt(s.endMm)}` : s.out ? 'tip out of the open end' : '', s.padMm > 0.5 ? `pad pressed ${fmt(s.padMm)}` : '', s.pastMm - s.padMm > 0.5 ? `${fmt(s.pastMm - s.padMm)} against bone` : ''].filter(Boolean);
    notes.forEach((t, i) => { const w = g.measureText(t).width + 6, x0 = cw - w - 8, y0 = 40 + i * 16; g.globalAlpha = 0.85; g.fillStyle = C.bg; g.fillRect(x0, y0, w, 14); g.globalAlpha = 1; g.fillStyle = C.heat; g.textAlign = 'left'; g.fillText(t, x0 + 3, y0 + 7.5); });
  }

  function drawStrip(t) {
    const H = 48, g = strip.getContext('2d');
    fit(strip, sw, H); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, strip.width, strip.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = STRIP_MS, a = t - span / 2, xOf = (tt) => ((tt - a) / span) * sw;   // the stretch around the playhead
    g.font = `10px ${C.font}`; g.textBaseline = 'top'; g.textAlign = 'left';
    if (!res?.z[0].length) { g.fillStyle = C.faint; g.fillText(followOf(app).script.length ? 'working out the stimulation…' : 'no script on this axis', 6, 4); return; }
    const gv = new Float32Array(Math.ceil(sw)), tv = new Float32Array(Math.ceil(sw));
    let top = 0.5;
    for (let x = 0; x < gv.length; x++) {
      const i0 = Math.floor((a + (x / sw) * span - res.t0) / res.bucket), i1 = Math.max(i0, Math.floor((a + ((x + 1) / sw) * span - res.t0) / res.bucket) - 1);
      for (let i = Math.max(0, i0); i <= Math.min(res.z[0].length - 1, i1); i++) { gv[x] = Math.max(gv[x], res.z[0][i] + (res.z[3]?.[i] || 0)); tv[x] = Math.max(tv[x], res.z.reduce((a, zz) => a + zz[i], 0)); }
      top = Math.max(top, tv[x]);
    }
    const y = (v) => H - 2 - (v / top) * (H - 14);
    g.fillStyle = C.heat; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(0, H - 2);
    for (let x = 0; x < gv.length; x++) g.lineTo(x, y(gv[x]));
    g.lineTo(gv.length, H - 2); g.closePath(); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = C.mut; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x < tv.length; x++) (x ? g.lineTo(x + 0.5, y(tv[x])) : g.moveTo(0.5, y(tv[x])));
    g.stroke();
    const px = xOf(t); g.strokeStyle = C.accent; g.beginPath(); g.moveTo(Math.round(px) + 0.5, 0); g.lineTo(Math.round(px) + 0.5, H); g.stroke();
    g.fillStyle = C.heat; g.fillText('glans + corona', 4, 2); g.fillStyle = C.mut; g.fillText('all zones', 86, 2);
  }

  // ---- pointer: the handles on the model; else pan / zoom / frame ----
  const at = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // a handle drags along its own screen direction (hs: {key, x, y, a: px per mm}, the 3D projection or the flat
  // drawing's), frozen at the grab so the picture moving under it does not feed back
  function down(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const [x, y] = at(e), h = e.button === 0 ? hitHandle(hs, x, y) : null;
    e.preventDefault(); cv.setPointerCapture(e.pointerId); anim = null;
    const which = h ? 'handle' : cut2d ? 'pan' : e.shiftKey || e.button === 1 ? 'pan3' : 'orbit';
    drag = { which, h, x, y, lx: x, ly: y, body: { ...body }, rig: { ...rig }, view: { ...view }, k: lay?.k || 1, lay };
  }
  function move(e) {
    const [x, y] = at(e);
    if (!drag) { const h = hitHandle(hs, x, y)?.key ?? null; if (h !== hover) hover = h; return; }
    const b = drag.body, r0 = drag.rig, lim = BODY_LIMITS;
    const cl = (v, [a, z]) => Math.round(Math.min(z, Math.max(a, v)));
    if (drag.which === 'handle') {
      const mm = dragMm(drag.h.a, x - drag.x, y - drag.y), key = drag.h.key;
      if (key === 'tip') bodyDraft = { ...b, lengthMm: cl(b.lengthMm + mm, lim.lengthMm) };
      else if (key === 'girth') bodyDraft = { ...b, girthMm: cl(b.girthMm + 2 * Math.PI * mm, lim.girthMm) };
      else if (key === 'pad') bodyDraft = { ...b, padMm: cl(b.padMm + mm, lim.padMm) };
      else if (key === 'glans') bodyDraft = { ...b, glansMm: cl(b.glansMm + mm, [lim.glansMm[0], Math.min(lim.glansMm[1], 0.45 * b.lengthMm)]) };
      else if (key === 'down') rigDraft = { ...r0, downMm: cl(r0.downMm + mm, [EMIN, b.lengthMm + 60]) };
      else if (key === 'up') rigDraft = { ...r0, upMm: cl(r0.upMm + mm, [EMIN, b.lengthMm + 60]) };
      return;
    }
    const dx = x - drag.lx, dy = y - drag.ly;
    drag.lx = x; drag.ly = y;
    if (drag.which === 'orbit' && cam) cam = orbit(cam, dx, dy);
    else if (drag.which === 'pan3' && cam && lastView) cam = pan(cam, lastView, dx, dy, cw, ch);
    else if (drag.which === 'pan') { const [ax, ay] = fromScreen(drag.x, drag.y), [bx, by] = fromScreen(x, y); view = { ...drag.view, px: drag.view.px + (bx - ax), py: drag.view.py + (by - ay) }; }
  }
  function up() {
    if (!drag) return;
    const was = drag.which;
    drag = null;
    if (bodyDraft) { S('stroker.body', validBody(bodyDraft)); bodyDraft = null; }
    if (rigDraft) { S('stroker.rig', rigToStore(rigDraft, body)); rigDraft = null; }
    if (was === 'orbit' || was === 'pan3') saveCam();
    kick();
  }
  const wheel = (node) => {
    const f = (e) => {
      e.preventDefault();
      if (!cut2d) {   // the Machine's zoom toward the pointer
        if (!cam || !lastView) return;
        const [x, y] = at(e); anim = null;
        cam = zoomAt(cam, lastView, Math.exp(-e.deltaY * 0.0015), (x / cw) * 2 - 1, 1 - (y / ch) * 2); saveCam(); return;
      }
      const [x, y] = fromScreen(...at(e)), z = Math.max(0.5, Math.min(6, view.zoom * Math.exp(-e.deltaY * 0.0015))), f0 = z / view.zoom;
      if (!lay) return;
      // about the pointer: the world point under it stays put
      view = { zoom: z, px: x - lay.cx0 - (x - lay.cx0 - view.px) * f0, py: y - lay.cy0 - (y - lay.cy0 - view.py) * f0 };
    };
    node.addEventListener('wheel', f, { passive: false });
    return () => node.removeEventListener('wheel', f);
  };
  const frameAll = () => { if (cut2d) view = { zoom: 1, px: 0, py: 0 }; else if (cam) goTo({ ...cam, zoom: 1, pan: strokerCam('quarter', body.lengthMm, orient).pan, shift: 0 }); };

  // ---- sleeve: pick, import, edit by dragging the channel (kit CurveEditor) ----
  const sleeveOptions = $derived([...SLEEVES, ...imported].map((s) => ({ value: s.id, label: s.name })));
  /** Picking a sleeve sets its own stroke window (rigFor: stroker.rig cleared); drag the markers to change it. */
  function pickSleeve(v) { S('stroker.sleeve', v); S('stroker.rig', null); }
  function saveImported(t) {
    const s = sleeveFromToy({ ...t, id: 'u-' + Date.now().toString(36), name: t.name });
    if (s) { S('stroker.imported', [...(get('stroker.imported', []) || []), s]); S('stroker.sleeve', s.id); }
    importing = false;
  }
  const SW = 300, SH = 120, RMAX = 30;
  /** The channel resampled to five stations (a preset already is; an imported one becomes editable that way). */
  const stations = (sl) => [0, 0.25, 0.5, 0.75, 1].map((f) => [f * sl.lengthMm, channelAt(sl, f * sl.lengthMm)]);
  const sleeveModel = $derived.by(() => {
    const sl = sleeve, Lmax = Math.max(sl.lengthMm * 1.25, body.lengthMm + 20), xOf = (mm) => 16 + (mm / Lmax) * (SW - 32), yOf = (r) => SH - 12 - (r / RMAX) * (SH - 24);
    const st = stations(sl), chan = [];
    for (let x = 0; x <= sl.lengthMm; x += sl.lengthMm / 60) chan.push([xOf(x), yOf(channelAt(sl, x))]);
    const penis = pen.profile.filter((_, i) => i % 3 === 0).map(([s, r]) => [xOf(s), yOf(r)]);   // tip at the entrance: how it meets the channel going in
    return {
      lines: [{ pts: [[xOf(0), yOf(0)], [xOf(Lmax), yOf(0)]], kind: 'guide' }, { pts: penis, kind: 'ghost' }, { pts: chan }, ...(sl.open ? [] : [{ pts: [[xOf(sl.lengthMm), yOf(0)], [xOf(sl.lengthMm), yOf(st[4][1])]] }])],
      handles: [
        ...st.map(([x, r], i) => ({ key: 'r' + i, label: `Channel radius ${i === 0 ? 'at the entrance (its tightness)' : i === 4 ? 'at the far end' : `at ${i * 25} % along`}`, x: xOf(x), y: yOf(r), axis: 'y', shape: 'hpill', text: i === 0 || i === 2 ? `${fmt(2 * r)} wide` : '', value: +r.toFixed(1), min: 2, max: RMAX, step: 0.5, toValue: (_, y) => ((SH - 12 - y) / (SH - 24)) * RMAX })),
        { key: 'len', label: 'Sleeve length', x: xOf(sl.lengthMm), y: yOf(0), axis: 'x', shape: 'vpill', text: fmt(sl.lengthMm), value: Math.round(sl.lengthMm), min: 15, max: 300, step: 1, toValue: (x) => ((x - 16) / (SW - 32)) * Lmax },
      ],
    };
  });
  function sleevePreview(key, v) {
    const sl = sleeve, st = stations(sl);
    if (key === 'len') sleeveDraft = { ...sl, lengthMm: v, profile: st.map(([x, r]) => [(x / sl.lengthMm) * v, r]) };
    else { const i = +key.slice(1); st[i] = [st[i][0], v]; sleeveDraft = { ...sl, profile: st }; }
  }
  function saveSleeve(patch = {}) {
    const sl = { ...(sleeveDraft || sleeve), ...patch };
    S('stroker.sleeves', { ...edits, [sl.id]: { lengthMm: sl.lengthMm, profile: sl.profile, soft: sl.soft, open: sl.open, ...(sl.caseMm ? { caseMm: Math.max(sl.caseMm, sl.lengthMm) } : {}) } });
    sleeveDraft = null;
  }
  function resetSleeve() { const e2 = { ...edits }; delete e2[sleeve.id]; S('stroker.sleeves', e2); sleeveDraft = null; }

  // ---- sensitivity: three bars ----
  const BW = 300, BH = 84, WMAX = 2;
  const barsModel = $derived.by(() => {
    const yOf = (w) => BH - 10 - (w / WMAX) * (BH - 24), xs = [45, 115, 185, 255], w = BARS.map((z) => weights[z]);
    return {
      lines: xs.flatMap((x, i) => [{ pts: [[x, yOf(0)], [x, yOf(WMAX)]], kind: 'guide' }, { pts: [[x - 6, yOf(0)], [x - 6, yOf(w[i])], [x + 6, yOf(w[i])], [x + 6, yOf(0)]], color: i < 2 ? 'var(--series-orange)' : 'var(--tx-mut)' }]),
      handles: BARS.map((z, i) => ({ key: z, label: `Sensitivity weight: ${ZONE_LABEL[z]}`, x: xs[i], y: yOf(w[i]), axis: 'y', shape: 'hpill', text: `${ZONE_LABEL[z]} ×${w[i].toFixed(2)}`, value: +w[i].toFixed(2), min: 0, max: WMAX, step: 0.05, toValue: (_, y) => ((BH - 10 - y) / (BH - 24)) * WMAX })),
    };
  });

  const pct = (x) => `${Math.round(x * 100)} %`;
  const HONEST = 'An estimate from shape and motion, not of sensation';
  const totalsTip = `Per zone: contact pressure (the channel stretched over the penis, by the sleeve's softness) x the sleeve's sliding speed, summed along the zone, x its sensitivity weight; shares of the total over the range. Glans-time: the share of strokes in which the glans was stroked at all. ${HONEST}`;
  const moreItems = $derived([
    { label: 'Import a sleeve from a picture…', icon: 'import', run: () => (importing = true) },
    { separator: true },
    { label: 'Knot near the base', type: 'checkbox', checked: body.knot, run: () => S('stroker.body', { ...body, knot: !body.knot }) },
    { label: 'Case', type: 'checkbox', checked: caseOn, disabled: !sleeve.caseMm, run: () => S('stroker.case', !caseOn) },
    { label: 'Scrotum', type: 'checkbox', checked: scrotumOn, disabled: style !== 'realistic', run: () => S('stroker.scrotum', !scrotumOn) },
    { label: 'Orientation', items: [{ label: 'Upright', type: 'radio', checked: orient === 'up', run: () => S('stroker.orientation', 'up') }, { label: 'Lying', type: 'radio', checked: orient === 'side', run: () => S('stroker.orientation', 'side') }] },
    { label: 'Units', items: [{ label: 'cm', type: 'radio', checked: units === 'cm', run: () => S('stroker.units', 'cm') }, { label: 'in', type: 'radio', checked: units === 'in', run: () => S('stroker.units', 'in') }] },
    { separator: true },
    { label: 'Reset my size', icon: 'refresh', run: () => S('stroker.body', null) },
    { label: 'Reset the stroke window', icon: 'refresh', run: () => S('stroker.rig', null) },
  ]);
  let more = $state(false), moreAnchor = $state(null), barW = $state(0);
</script>

<div class="sk kit-root" bind:this={root}>
  <div class="bar" bind:clientWidth={barW}>
    {@render modeSwitch?.(barW > 0 && barW < 360)}
    <span class="tp" {@attach tooltip(`${sleeve.name}: ${fmt(sleeve.lengthMm)} long, ${sleeve.open ? 'open' : 'closed'} end${sleeve.tip ? `. ${sleeve.tip}` : ''}`)}>
      <Select size="sm" label="Sleeve" options={sleeveOptions} value={sleeve.id} onchange={pickSleeve} />
    </span>
    <span class="grow"></span>
    <IconButton size="sm" icon="more" label="Import a sleeve, knot, units, resets" aria-haspopup="menu" onclick={(e) => { moreAnchor = e.currentTarget; more = !more; }} />
    <Menu bind:open={more} anchor={moreAnchor} placement="bottom-end" items={moreItems} label="Stroker" />
  </div>
  <div class="stage" bind:this={stage} {@attach sized} {@attach onScreen}>
    {#if !glFailed}<canvas class="gl" class:off={cut2d} bind:this={glc} aria-hidden="true"></canvas>{/if}
    <canvas bind:this={cv} data-hover={hover || undefined} {@attach wheel} aria-label="Stroker view: {sleeve.name} on a {fmt(body.lengthMm)} penis"
      onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} ondblclick={frameAll} onpointerleave={() => { if (!drag) hover = null; }}
      {@attach tooltip('Drag the tip, side or corona to size it\nDrag the markers below: pos 0 and pos 100\nDrag empty space to orbit, Shift to pan\nBrighter: more stimulation')}></canvas>
    {#if !glFailed}<div class="views"><SegmentedControl size="sm" label="View" options={VIEWS} value={viewName} onchange={setView} /></div>{/if}
    {#if importing}<ToyImport {app} onsave={saveImported} oncancel={() => (importing = false)} />{/if}
  </div>
  <Section title="Stimulation" class="ros" open={get('stroker.readouts', true) !== false} onchange={(o) => S('stroker.readouts', o)}>
    <div class="evs" {@attach stripSized} {@attach tooltip(`Glans (filled), all zones (line), 10 s around the playhead\n${HONEST}`)}><canvas bind:this={strip} style:height="48px" aria-label="Glans stimulation over the 10 s around the playhead"></canvas></div>
    <div class="ro">
      <div class="row" {@attach tooltip(`Now, per zone: pressure × slide speed × weight\n100: the glans in a snug sleeve at 150 mm/s\n${HONEST}`)}>
        <span class="k">now</span>
        <span class="dmap">
          {#each DISPLAY as i (i)}
            <span class="db"><span class="dl">{ZONE_LABEL[ZONES[i]]}</span><span class="dt"><span class="df" class:gl={i === 0 || i === 3} style:width="{Math.round(Math.min(1, ro.zone[i] / 1.5) * 100)}%"></span></span><span class="dv k-num">{Math.round(ro.zone[i] * 100)}</span></span>
          {/each}
        </span>
      </div>
      <div class="line" class:stale {@attach tooltip(totalsTip)}><span class="k">view</span> {res ? totalsText(tView) : '…'}</div>
      <div class="line" class:stale {@attach tooltip(totalsTip)}><span class="k">{tPart?.label?.toLowerCase() || 'shot'}</span> {res && tPart ? totalsText(tPart.t) : '–'}</div>
      <div class="line" class:stale {@attach tooltip(totalsTip)}><span class="k">script</span> {res ? totalsText(tAll) : '…'}</div>
    </div>
  </Section>
  <Section title="Sleeve" open={false}>
    <div class="ed">
      <CurveEditor W={SW} H={SH} height={130} lines={sleeveModel.lines} handles={sleeveModel.handles} label="Sleeve channel: radius along its length (entrance at the left); the dotted line is your penis, tip first"
        onpreview={sleevePreview} oncommit={() => saveSleeve()} oncancel={() => (sleeveDraft = null)} />
      <div class="tune">
        <span class="tl" {@attach tooltip('Sleeve wall softness: softer presses less, drags more')}>Softness</span>
        <Slider size="sm" full label="Softness" min={0} max={1} step={0.05} value={sleeve.soft} showValue format={(v) => (v < 0.3 ? 'firm' : v < 0.7 ? 'medium' : 'soft')}
          onchange={(v) => (sleeveDraft = { ...(sleeveDraft || sleeve), soft: v })} oncommit={(v) => saveSleeve({ soft: v })} />
        <span class="tl" {@attach tooltip(sleeve.caseMm ? 'The hand squeezes the case: the channel keeps its size' : 'How hard the hand squeezes: narrows the channel')}>Grip</span>
        <Prop {app} key="stroker.grip" slider full label="Grip" value={grip} format={(v) => (v < 0.05 ? 'neutral' : v < 0.5 ? 'light' : 'firm')}
          onpreview={(v) => (gripDraft = v)} oncommit={() => (gripDraft = null)} />
        <span class="tl" {@attach tooltip('A closed end stops the tip; an open end lets it pass through')}>Far end</span>
        <SegmentedControl size="sm" full label="Far end" options={[{ value: 'closed', label: 'Closed' }, { value: 'open', label: 'Open' }]} value={sleeve.open ? 'open' : 'closed'} onchange={(v) => saveSleeve({ open: v === 'open' })} />
      </div>
      <div class="acts"><Button size="sm" icon="refresh" onclick={resetSleeve} disabled={!edits[sleeve.id]} tip="This sleeve back to its preset (or as imported)">Reset sleeve</Button></div>
    </div>
  </Section>
  <Section title="Look" open={false}>
    <div class="ed">
      <div class="tune">
        <span class="tl" {@attach tooltip('Clean: flat, the heat painted on\nRealistic: skin, a glossy sleeve')}>Style</span>
        <Prop {app} key="stroker.style" full label="Style" value={style} />
        <span class="tl" {@attach tooltip('Paint the stimulation on the skin in the realistic style')}>Heat</span>
        <Prop {app} key="stroker.heatOverlay" label="Heat overlay" disabled={style === 'clean'} value={heatOn} />
        <span class="tl">Skin</span>
        <ColorSwatch inline size="sm" columns={TONES.length} label="Skin tone" palette={TONE_SW} value={TONE_SW.find((s) => Math.abs(toneT - s.t) < 0.01)?.key} onchange={(k) => S('stroker.skinTone', TONE_SW.find((s) => s.key === k).t)} />
        <span class="tl" {@attach tooltip('A tone between the swatches')}>Tone</span>
        <Prop {app} key="stroker.skinTone" slider full label="Skin tone" value={toneT} onpreview={(v) => (toneDraft = v)} oncommit={() => (toneDraft = null)} />
        <span class="tl">Sleeve</span>
        <ColorSwatch inline size="sm" columns={TINT_SW.length} label="Sleeve tint" palette={TINT_SW} value={tint} onchange={(k) => S('stroker.sleeveTint', k)} />
      </div>
    </div>
  </Section>
  <Section title="Sensitivity" open={false}>
    <div class="ed">
      <CurveEditor W={BW} H={BH} height={96} lines={barsModel.lines} handles={barsModel.handles} label="Zone sensitivity weights: drag each bar"
        onpreview={(key, v) => (weightsDraft = { ...weights, [key]: v })} oncommit={() => { if (weightsDraft) S('stroker.weights', weightsDraft); weightsDraft = null; }} oncancel={() => (weightsDraft = null)} />
      <p class="k-hint">How much each zone counts: glans highest by default. The zones: the glans to the corona, then the shaft split in half (upper, and lower to the base). {HONEST}</p>
    </div>
  </Section>
</div>

<style>
  .sk { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .bar { flex: none; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); flex-wrap: nowrap; min-width: 0; overflow: hidden; }
  .bar > :global(*) { flex: none; }
  .bar > .tp { flex: 0 1 auto; min-width: 48px; display: flex; }
  .bar > .tp > :global(*) { min-width: 0; max-width: 100%; }
  .grow { flex: 1; }
  .stage { flex: 1; min-height: 160px; position: relative; }
  .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
  .stage canvas.gl { pointer-events: none; }
  .stage canvas.gl.off { visibility: hidden; }
  .views { position: absolute; top: var(--space-2); left: var(--space-2); right: var(--space-2); display: flex; pointer-events: none; min-width: 0; }
  .views > :global(*) { pointer-events: auto; min-width: 0; }
  .stage canvas[data-hover='tip'], .stage canvas[data-hover='glans'], .stage canvas[data-hover='down'], .stage canvas[data-hover='up'] { cursor: ew-resize; }
  .stage canvas[data-hover='girth'] { cursor: ns-resize; }
  :global(.sk .ros) { flex: none; border-top: var(--bw) solid var(--line-1); }
  .evs canvas { display: block; width: 100%; }
  .ro { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3) var(--space-3); font-size: var(--fs-2); font-variant-numeric: tabular-nums; }
  .row { display: flex; align-items: center; gap: var(--space-3); }
  .k { color: var(--tx-mut); font-size: var(--fs-1); text-transform: uppercase; letter-spacing: var(--caps-track); display: inline-block; min-width: 5ch; }
  .dmap { flex: 1; min-width: 40px; display: flex; gap: var(--space-2); }
  .db { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); }
  .dl { font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; }
  .dv { font-size: var(--fs-1); color: var(--tx-val); min-width: 3ch; text-align: right; }
  .dt { flex: 1 0 10px; height: 6px; border-radius: var(--radius-pill); background: var(--line-2); position: relative; overflow: hidden; }
  .df { position: absolute; left: 0; top: 0; bottom: 0; background: var(--tx-mut); border-radius: var(--radius-pill); }
  .df.gl { background: var(--series-orange); }
  .line { color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; line-height: 1.35; }
  .line.stale { opacity: 0.55; }   /* the whole-script totals while they recompute (a drag in progress) */
  .ed { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) var(--space-3) var(--space-3); }
  .tune { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); align-items: center; }
  .tl { font-size: var(--fs-2); color: var(--tx-mut); white-space: nowrap; }
  .acts { display: flex; }
  .k-hint { margin: 0; }
</style>
