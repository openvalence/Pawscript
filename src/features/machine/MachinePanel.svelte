<!--
  Machine: a 3D view of a thrust machine with the picked toy (its own mesh, at real scale) on the carriage and the
  picked character's body with the hole, played in sync with the playhead on the active axis (pos 0 = deepest).
  The toy is silicone (physics.js): it compresses against the ring and the knot lags the carriage; the strip under
  the view shows strain and every knot event in the visible range (rigid vs real, failed). Orbit by dragging empty
  space (or middle-drag) about the opening, Shift+drag pans, wheel zooms toward the pointer, double-click frames
  toy and opening; drag the toy to roll it (double-click it to reset); drag the out / deep handles along the rail.
  Falls back to the 2D drawing (draw.js) when WebGL or the mesh is missing.
  Playing: one rAF loop on app.player.now() while the view is on screen; paused: one frame per change.
  Settings: machine.mode (machine | stroker: StrokerView.svelte, paw-un2p) / machine.toy / machine.size / machine.char / machine.rig / machine.experience (physics.js EXPERIENCE) / machine.warmup (none | light | full: a warmed start, physics.js warmStart) /
  machine.params (overrides of the experience preset) / machine.layers ({op: {layer: 0..1}, last}: a layered model's layer opacities, 0 off; the view menu's Body layers, layers.js) / machine.bodyFit ({character: {up, fwd, pitch}}: the owner's nudges of an imported model's opening and entry angle) / machine.height (cm) / machine.weight (0..1) / machine.genitals (male | neutral) / machine.bodyGive (the setup, not the person) / machine.units
  (both | mm | in) / machine.firmness ({toy: grade code}) / machine.cam (camera.js) / machine.toys (the owner's own toys) /
  machine.hilt ({toy: fraction of its length}: the owner's hilt) / machine.prostate (track prostate stimulation, a body with one; default on) / machine.laneEvents (the simulated knot events over the stroke lane) / machine.depthSrc (script | video | both: depth from the tracked shaft, video.js; offered when the tracking has a trusted reading).
-->
<script>
  import { untrack } from 'svelte';
  import { Select, Button, IconButton, Badge, Section, Slider, ProgressBar, SegmentedControl, ToggleButton, Menu, Popover } from '../../ui/kit/index.js';
  import { layerOpacities, setOpacity, flipLayer, withOpening } from './layers.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { cssVar, hexToRgb } from '../../ui/kit/color.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { entries, toyFor, meshUrls } from './library.js';
  import { knotOf, maxRadius, radiusAt, withHilt } from './toys.js';
  import { restPath, pointAt, wallRadius, restRadius, pathLength, bendsAt, bodyBends, ANATOMY, SIDE } from './anatomy.js';
  import { WARMUPS, warmStart, scriptDepth, readiness, PARAMS, TUNABLE, CALIBRATION, BODY_GIVE, EXPERIENCE, EXPERIENCE_LEVELS, EI_REF, paramsFor, MachineSim, simKey, setupKey, copyState, depthOf, summary, fmtDuration, knotStats, tubeState, depthSummary, stallText, prostateStats, pathInputs, restOf } from './physics.js';
  import { solvePath, toyBend, toyCentreline, toyPoint, bulgeStations, bodyWall, baseOf, bulgeSample, bindColon, colonStations, wobbledC } from './centreline.js';
  import { createOffload, bulgePeak } from './offload.js';
  import { rearMesh, boneLine } from './body.js';
  import { followOf } from '../../lib/follow.svelte.js';   // the final script (baked + live runs, autorange + effects: lib/finish.js); in the Track tab with a running track's trace
  import { ALL_CHARACTERS, characterOf, adoptOwnModel, meshCharacter } from './characters.js';
  import { bodyShown } from '../../lib/content.js';
  import { bodyAsset, bodyIds } from './bodies.js';
  import { latticeBox, latticeField, latticeBytes, gutSweep, LATTICE } from './lattice.js';
  import { parseBody, bodyFrame, framedMesh, fitProfile, skeletonBone, mergeMeshes, refineWhere, framePoint, frameDir, levelTilt, pitchedBody } from './meshbody.js';
  import { layout, handles, drawFrame, drawStrip, readColors, strainColor } from './draw.js';
  import { parseMesh, latheMesh, straighten, restCentre } from './mesh.js';
  import { toyPolar, openingSleeve } from './ring.js';
  import { MachineScene } from './scene3d.js';
  import { project, keepScene } from './gl3d.js';
  import { posAt } from '../../lib/core/script.js';
  import { planScript } from '../../lib/analyze/kinematics.js';
  import { PRESETS, DEFAULT_CAM, fitDist, viewOf, orbit, pan, zoomAt, blend, validCam, tiltView } from './camera.js';
  import ToyImport from './ToyImport.svelte';
  import ToyPicker from './ToyPicker.svelte';
  import { DisplayClock, timeSource, ScrubGate } from './clock.js';
  import { ALL_CODES, firmnessLabel, migrateFirmness } from './materials.js';
  import StrokeWindow from './StrokeWindow.svelte';
  import StrokerView from './StrokerView.svelte';
  import Prop from '../../app/Prop.svelte';
  import { MACHINES, machineOf, lbfToN, nToLbf, FORCE_RANGE_LBF } from './machines.js';
  import { trackingApi } from '../tracking/api.js';
  import { sampleTimes, videoTrack, videoAt, videoKnot, videoScript, compareDepth, diffText } from './video.js';
  import { publishKnots, laneEventsOn } from './lane-events.svelte.js';

  let { app } = $props();
  const S = { get: (k, d) => app.settings.get(k, d), set: (k, v) => app.settings.set(k, v) };
  // paw-mnd8: a tuning slider's value while it is dragged ({k: setting, v}), read as the setting; written on release
  let draft = $state.raw(null);
  const get = (k, d) => (draft && draft.k === k ? draft.v : (app.settings.values, app.settings.get(k, d)));
  const tune = (k, v) => (draft = { k, v });
  const commit = () => { if (draft) { const { k, v } = draft; draft = null; S.set(k, v); } };
  // a Prop (app/Prop.svelte, paw-m3b6) writes the setting itself on release: while dragged its value is the draft here
  const preview = (k) => (v) => tune(k, v);
  const clearDraft = () => (draft = null);

  // the panel's mode (paw-un2p): the Machine, or the Stroker (StrokerView: the penis fixed, a sleeve driven over it); the
  // Machine's loop, knot events and video depth rest while the Stroker shows
  const mode = $derived(get('machine.mode', 'machine') === 'stroker' ? 'stroker' : 'machine');
  const MODES = [{ value: 'machine', label: 'Machine', icon: 'machine', tip: 'Machine: a thrust machine drives the toy into the body' }, { value: 'stroker', label: 'Stroker', icon: 'hand', tip: 'Stroker: a sleeve driven over your size by the script' }];
  const custom = $derived(get('machine.toys', []));
  const list = $derived(entries(custom));
  const toyKey = $derived(get('machine.toy') ?? list[0]?.key);
  const entry = $derived(list.find((e) => e.key === toyKey) || list[0]);
  const size = $derived(get('machine.size', 'medium'));
  const toyLib = $derived(toyFor(entry.key, size, custom));
  // the owner's hilt for this toy (machine.hilt {key: fraction of the length}, so it holds across sizes; Alt+drag on the
  // stroke window's hilt mark), else the library's (the mesh's own neck: toys.js hiltOf)
  const hiltF = $derived((get('machine.hilt', {}) || {})[entry.key]);
  const toy = $derived(withHilt(toyLib, hiltF));
  function saveHilt(f) { const all = { ...(get('machine.hilt', {}) || {}) }; if (f == null) delete all[entry.key]; else all[entry.key] = +f.toFixed(4); S.set('machine.hilt', all); }
  const sizeValue = $derived(entry.sizes.find((s) => toy.id.endsWith(':' + s.value))?.value);
  // the imported models this checkout has (characters.js: the shipped ones whose asset is here, and the owner's own,
  // kept out of the repo: any other bodies/<id>.json); the owner's own model became their character once (paw-dt9): an
  // install that has used the Machine panel before switches to it on this build's first run; a fresh install (and the
  // mock) keeps the Generic default
  const localChars = bodyIds().filter((id) => !ALL_CHARACTERS.some((c) => c.body?.mesh === id)).map((id) => meshCharacter(bodyAsset(id).info));
  const allBodies = [...ALL_CHARACTERS.filter((c) => !c.body?.mesh || bodyAsset(c.body.mesh)), ...localChars];
  // paw-43vn: furry items off offers no animal body (lib/content.js BODIES_OFF): the Human (and local models) only, the Human the default
  const offered = $derived(((o) => (o.length ? o : allBodies))(allBodies.filter((c) => bodyShown(c.id))));
  if (app.settings.storage) untrack(() => adoptOwnModel(app.settings, localChars[0]?.id));
  const char = $derived(((c) => (offered.includes(c) ? c : offered[0]))(characterOf(get('machine.char', 'generic'), localChars)));
  // an imported model (characters.js MESH_CHARACTERS, meshbody.js): its asset, and the owner's nudges of its landmarks
  const meshId = $derived(char.body?.mesh || null);
  const bodyFit = $derived((get('machine.bodyFit', {}) || {})[char.id] || {});
  // the toy's angle into the body (paw-3562): one setting for every body, machine.bodyFit[character].pitch, deg (+ toward
  // the back), 0 = the body's own default line; the body stays on its floor and the rail tilts
  const pitchDeg = $derived(Math.max(-25, Math.min(25, +bodyFit.pitch || 0)));
  const setFit = (k, v) => S.set('machine.bodyFit', { ...(get('machine.bodyFit', {}) || {}), [char.id]: { ...bodyFit, [k]: Math.round(v * 2) / 2 } });
  const overrides = $derived(get('machine.params', {}));
  // the grades the maker lists for this toy (all for the generic and the owner's own toys); old saved soft / medium /
  // firm read as 3 / 5 / 8
  const firmOptions = $derived(toy.firmness || ALL_CODES);
  const firmness = $derived(((f) => (firmOptions.includes(f) ? f : firmOptions.includes('5') ? '5' : firmOptions[0]))(migrateFirmness(get('machine.firmness', {})[entry.key] || '5')));
  const machine = $derived(machineOf(get('machine.machine', 'capstan')));
  const forceLbf = $derived(get('machine.forceLbf', null) ?? machine.forceLbf ?? 60);
  const experience = $derived(EXPERIENCE[get('machine.experience', 'some')] ? get('machine.experience', 'some') : 'some');
  const bodyGive = $derived(get('machine.bodyGive', PARAMS.bodyGive));
  const units = $derived(get('machine.units', 'both'));
  // the experience preset, the owner's slider moves on top; the body give is the setup's (not the person's)
  // height (cm; the character's default until set) scales the body and the internal path linearly (a simplification:
  // real proportions do not scale uniformly); the toy and the ruler stay in true mm; the opening scales sub-linearly
  const height = $derived(Math.max(HEIGHT[0], Math.min(HEIGHT[1], get('machine.height', null) ?? char.body?.height ?? 175)));
  const weight = $derived(meshId ? 0.25 : get('machine.weight', 0.25));   // (Build: the procedural bodies only)
  const bodyScale = $derived(height / 175);
  const genitals = $derived(get('machine.genitals', 'male') === 'neutral' ? 'neutral' : 'male');
  const bodyProps = $derived({ ...char.body, scale: bodyScale, weight, genitals });
  let bodyBendsNow = $state.raw(null);
  let prostateNow = $state.raw(null);   // a modelled body's prostate (paw-xdcy): {s, gap} for the physics, {c, r} for the glow
  const prostateOn = $derived(get('machine.prostate', true) !== false);   // a modelled body's own bend positions (meshBodyNow), else the hand-set ones
  // a warmed-up start (paw-9yqf; physics.js warmStart): none (cold, the default) / light / full
  const warmup = $derived(WARMUPS.includes(get('machine.warmup', 'none')) ? get('machine.warmup', 'none') : 'none');
  const P = $derived({ ...paramsFor(experience, overrides), firmness, bodyScale, weight, forceLimitN: lbfToN(forceLbf), bodyGive, side: char.body?.side ?? SIDE, toyRoll, ...(warmup !== 'none' ? { warmup } : {}), ...(bodyBendsNow && meshId ? { bends: bodyBendsNow } : {}), ...(prostateNow && prostateOn && meshId ? { prostate: { s: prostateNow.s, gap: prostateNow.gap } } : {}) });
  const knot = $derived(knotOf(toy));
  const themes = $derived(toy.themes || []);
  const themeName = $derived(get('machine.theme', {})[entry.key]);
  const theme = $derived(themes.find((t) => t.name === themeName) || themes[0] || null);
  // until the owner sets one: from 15 mm outside to just past the knot (else 80 % of the usable length)
  const defaultRig = $derived({ offsetMm: -15, strokeMm: Math.round(15 + Math.min(toy.usable_mm || toy.length_mm, knot ? knot.to_mm + 8 : 0.8 * (toy.usable_mm || toy.length_mm))) });
  const savedRig = $derived({ ...defaultRig, ...get('machine.rig', {}) });
  let dragRig = $state(null);
  const rig = $derived(dragRig || savedRig);

  let sim = new MachineSim(), fctx = null;   // (fctx: the context of the state drawn this frame)
  const dclock = new DisplayClock();
  let root = $state(), stage = $state(), cv = $state(), ov = $state(), strip = $state(), cw = $state(0), ch = $state(0), sw = $state(0), C = $state(null), themeTick = $state(0);
  let hover = $state(null), drag = null, importing = $state(false), img = $state(null), imgTick = $state(0);
  let ro = $state({ label: 'No knot', tone: 'neutral', ready: null }), ttr = $state(null), events = $state.raw([]);
  let scene = null, glFailed = $state(false), meshFailed = $state(false), why2D = $state(''), sceneTick = $state(0), meshTick = $state(0), visible = true;
  const use2D = $derived(glFailed || meshFailed);
  // camera: persisted turntable state; an eased move between presets; the cutaway's own close side view
  // the meshes are built side-profile-on; the library's per-toy quarter turn faces the toy's top to the Top view
  // (tools/build-toy-library.mjs facingRoll); a lathed toy is round, the owner's -90 deg
  const roll0 = $derived(((toy.roll ?? -1) * Math.PI) / 2);
  // the owner's facing per toy (drag, Turn, Flip) sticks: saved and used from then on; double-click resets to the default
  const savedRoll = $derived((get('machine.roll', {}) || {})[entry.key]);
  const toyRoll = $derived(Number.isFinite(savedRoll) ? savedRoll : roll0);
  const wrapRoll = (r) => Math.atan2(Math.sin(r), Math.cos(r));
  function saveRoll(r) { const all = { ...(get('machine.roll', {}) || {}) }; if (r == null) delete all[entry.key]; else all[entry.key] = +wrapRoll(r).toFixed(4); S.set('machine.roll', all); }
  let cam = $state(validCam(S.get('machine.cam'))), anim = null, roll = $state(-Math.PI / 2), cut = $state(false), camBeforeCut = null;
  let barW = $state(0);
  let bulgeMm = $state(0), lastBulge = null, liveForce = $state({ F: 0, peak: 0, lag: 0 }), liveDepth = $state({ d: NaN, dc: NaN }), lastPath = null, lastToy = null, lastXb = 0, meshCentre = null, themeKey = '', fitKey = '', fitBase = 1000, raf = 0, dpr = 1, lastRo = 0, lastTtr = -1e9, ttrKey = '', prevD = null, lastView = null, hand = null, viewState = null, toyPolarTab = null;

  $effect(() => { themeTick; if (root) C = { ...readColors((n) => cssVar(n, root)), 'series-orange': cssVar('--series-orange', root) }; });
  $effect(() => { roll = toyRoll; });   // a new toy: its saved facing, else the default
  $effect(() => onThemeChange(() => themeTick++));
  $effect(() => {   // the toy's side-profile picture: the 2D fallback
    const src = toy.img;
    if (!src) { img = null; return; }
    const im = new Image();
    im.onload = () => imgTick++;
    im.src = src;
    img = im;
  });
  const sized = (node) => { const o = new ResizeObserver(([e]) => { cw = e.contentRect.width; ch = e.contentRect.height; }); o.observe(node); return () => o.disconnect(); };
  const stripSized = (node) => { const o = new ResizeObserver(([e]) => { sw = e.contentRect.width; }); o.observe(node); return () => o.disconnect(); };
  const onScreen = (node) => { const o = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }); o.observe(node); return () => o.disconnect(); };

  // ---- the 3D scene and the toy's mesh ----
  // A context that fails to come up is retried a few times (a panel restored at start-up can mount before the GPU
  // process is ready), and a lost context is rebuilt when it is restored (gl3d.js keepScene); only then the flat drawing.
  $effect(() => {
    const c = cv;   // (still the canvas at teardown: the binding is cleared first when the mode switches it away)
    if (!c) return;
    const stop = keepScene(c, (cc) => new MachineScene(cc), (s, e) => {
      scene = s;
      if (s) untrack(() => { sceneTick++; kick(); });
      else { console.warn('[machine] 3D view unavailable, using the 2D drawing:', e?.message || e); glFailed = true; why2D = '3D view unavailable: ' + (e?.message || e); }
    });
    return () => { stop(); scene = null; };
  });
  $effect(() => {
    const t = toyLib, key = entry.key, urls = meshUrls(key);   // (the hilt override does not change the mesh)
    sceneTick;
    untrack(() => { meshFailed = false; });   // a new toy: try 3D again
    if (!scene) return;
    toyPolarTab = null;   // (until this toy's mesh is in: its outline's oval)
    let gone = false;
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          let mesh, nrm = null, tex = null;
          if (urls) {
            const res = await fetch(urls.bin);
            if (!res.ok) throw new Error(`mesh ${res.status}`);
            mesh = parseMesh(await res.arrayBuffer());
            meshCentre = restCentre(mesh); straighten(mesh, meshCentre);   // about its rest centreline: the view bends it
            toyPolarTab = toyPolar(mesh);   // (its section by angle along it, once: the hole hugs it, ring.js)
            const image = (src) => new Promise((ok) => { if (!src) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });
            [nrm, tex] = await Promise.all([image(urls.nrm), image(urls.tex)]);
          } else { mesh = latheMesh(t); meshCentre = null; toyPolarTab = null; }
          if (gone || !scene) return;
          scene.setToy(mesh, nrm, tex);
          themeKey = '';
          untrack(() => meshTick++);   // a lathed toy gets here synchronously, inside the effect
          return;
        } catch (e) {
          if (gone) return;
          if (attempt < 2) { await new Promise((r) => setTimeout(r, 600)); continue; }
          console.warn('[machine] toy mesh failed, using the 2D drawing:', e?.message || e); meshFailed = true; why2D = 'Toy model failed to load: ' + (e?.message || e);
          return;
        }
      }
    })();
    return () => { gone = true; };
  });

  // ---- an imported model's body: the asset once per model; framed (meshbody.js) for its landmarks, the owner's nudges
  // and the height, and its profile fitted, memoised (a nudge or a height step refits it: tens of ms) ----
  let meshAsset = $state.raw(null), meshMemo = null;
  $effect(() => {
    const id = meshId, a = id ? bodyAsset(id) : null;
    if (!a) { meshAsset = null; return; }
    if (untrack(() => meshAsset?.id) === id) return;
    let gone = false;
    (async () => {
      try {
        const get = async (url) => { const res = await fetch(url); if (!res.ok) throw new Error(`body ${res.status}`); return parseBody(await res.arrayBuffer()); };
        // (a layered model: every layer's parts, each under 65536 vertices)
        const layers = a.layers ? await Promise.all(a.layers.map(async (l) => ({ ...l, parts: await Promise.all(l.urls.map(get)) }))) : null;
        const m = a.layers ? null : await get(a.bin);
        const img = a.tex ? await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = a.tex; }) : null;
        if (!gone) { meshAsset = { id, m, layers, info: a.info, img }; kick(); }
      } catch (e) { console.warn('[machine] body model failed:', e?.message || e); }
    })();
    return () => { gone = true; };
  });
  // a layered model's layers (layers.js; machine.layers {op, last}): each layer's opacity, 0 = off; the skin goes
  // see-through by default while an inner layer shows. Set in the "..." menu's Body layers panel
  const layerSet = $derived(get('machine.layers', {}) || {});
  const layerList = $derived(meshAsset?.layers && meshAsset.id === meshId ? withOpening(meshAsset.layers) : []);
  const layerOp = $derived(layerOpacities(layerSet, layerList));
  let layersOpen = $state(false);
  /** The framed model and its profile for now, or null (none, or still loading). */
  function meshBodyNow() {
    if (!meshId) {   // a procedural body only when its rail is pitched (meshbody.js pitchedBody); else the plain path
      if (!pitchDeg) return null;
      const key = JSON.stringify(['proc', bodyProps, pitchDeg]);
      if (meshMemo?.key !== key) meshMemo = { key, ...pitchedBody(bodyProps, pitchDeg, char.body?.side ?? SIDE) };
      return meshMemo;
    }
    const a = meshAsset;
    if (!a || a.id !== meshId) return null;
    const key = JSON.stringify([a.id, bodyFit, height]);
    if (meshMemo?.key !== key) {
      const fr = bodyFrame(a.info.landmarks, bodyFit, (1000 * height) / (a.info.height_cm || char.body.height));
      if (a.layers) {
        // a layered model: every layer framed (the canal cut into the skin's first part, which holds the rear); the
        // simulation takes the torso from the skin, the bone from the skeleton, the resting path and its side from the
        // colon (meshbody.js fitProfile); the head's cut as a plane in the frame for the fade
        const layers = a.layers.map((l) => ({ id: l.id, parts: l.parts.map((m, i) => framedMesh(m, fr, { canal: l.id === 'skin' && i === 0, canalDepth: 42 * bodyScale })) }));
        const skin = layers.find((l) => l.id === 'skin').parts, skel = layers.find((l) => l.id === 'skeleton')?.parts, F = a.info.fade;
        const fit = mergeMeshes(skin), prof = fitProfile(fit, bodyScale, { bone: skel ? skeletonBone(skel) : null, path: a.info.colonPath?.map((p) => framePoint(p, fr)) });
        // its own bend positions (the rectosigmoid junction where its rectum ends; the fixed descending colon): the
        // solver and, through P, the physics use them (paw-kkmv)
        if (prof.rest && a.info.rectosigmoid) prof.bends = bodyBends(prof.rest, framePoint(a.info.rectosigmoid, fr), bodyScale);
        // its colon bound to that resting path, so the solved path carries it (the vertex shader; centreline.js bindColon)
        if (prof.rest) for (const part of layers.find((l) => l.id === 'colon')?.parts || []) { const b = bindColon(part, prof.rest); part.bind = b.bind; part.nor = b.nor; }
        const fade = F ? [[...frameDir(F.normal, fr), F.width * fr.mm], [...framePoint(F.point, fr), F.neck[0] * fr.mm]] : null;
        // the skin drawn finer where the toy can push it out (the belly, the flanks, below; meshbody.js refineWhere)
        const k = bodyScale;
        layers.find((l) => l.id === 'skin').parts = refineWhere(skin, (c) => c[1] > 80 * k && c[1] < 480 * k && c[2] < 30 * k && Math.hypot(c[0], c[2]) > 40 * k, { maxEdge: 4.5 * k });
        // the soft organs' lattice box (lattice.js; paw-dk87)
        const soft = layers.filter((l) => l.id === 'small' || l.id === 'bladder').flatMap((l) => l.parts);
        // its prostate (paw-xdcy): the resting path's nearest arc and the clearance from the path's axis to its near
        // surface, less the rectal wall (4 mm)
        let prostate = null;
        if (a.info.prostate && prof.rest) {
          const c = framePoint(a.info.prostate.point, fr), r = a.info.prostate.r * fr.mm, R = prof.rest;
          let best = Infinity, bs = 0; for (let i = 0; i < R.n; i++) { const dd = Math.hypot(R.P[i * 3] - c[0], R.P[i * 3 + 1] - c[1], R.P[i * 3 + 2] - c[2]); if (dd < best) { best = dd; bs = i * R.step; } }
          prostate = { s: bs, gap: +(best - r - 4).toFixed(2), c: c.map((v) => +v.toFixed(2)), r: +r.toFixed(2) };
        }
        meshMemo = { key, layers, mesh: skin[0], fit, prof, fade, prostate, latBox: soft.length ? latticeBox(soft) : null, tilt: levelTilt(a.info.up || [0, 1, 0], fr) };
      } else {
        const mesh = framedMesh(a.m, fr, { canalDepth: 42 * bodyScale });
        meshMemo = { key, mesh, fit: mesh, prof: fitProfile(mesh, bodyScale), tilt: levelTilt(a.info.up || [0, 1, 0], fr) };
      }
    }
    const b = meshMemo?.prof?.bends || null;
    if (JSON.stringify(b) !== JSON.stringify(bodyBendsNow)) bodyBendsNow = b;   // (into P: the physics' bends)
    const pz = meshMemo?.prostate || null;
    if (JSON.stringify(pz) !== JSON.stringify(prostateNow)) prostateNow = pz;
    return meshMemo;
  }

  // ---- depth from video (paw-8x1, video.js): the tracked shaft's trusted readings over the script, debounced; the
  // mode (machine.depthSrc: script | video | both) only when there are any ----
  const tracking = trackingApi(app);
  let vtrack = $state.raw(null), vTimer = 0;
  $effect(() => {
    if (mode !== 'machine') return;
    const script = followOf(app).script, usable = Math.min(toy.length_mm, toy.usable_mm || toy.length_mm);
    try { tracking.insertedAt(script[0]?.at ?? 0); } catch {}   // reads what the readings depend on (runs, selection, scene links, marks)
    clearTimeout(vTimer);
    vTimer = setTimeout(() => { try { const ts = sampleTimes(script); vtrack = ts.length ? videoTrack(ts, tracking.insertedSeries(ts), usable) : null; } catch (e) { console.warn('[machine] depth from video', e); vtrack = null; } }, 300);
    return () => clearTimeout(vTimer);
  });
  const vMode = $derived(vtrack ? (['video', 'both'].includes(get('machine.depthSrc', 'script')) ? get('machine.depthSrc', 'script') : 'script') : 'script');
  // what the machine really does with the script: the device planner's motion (Kinetic2, else the analytic tracker) at
  // this window's stroke length, from app.devicePreview (whole script, planned in slices, cached; rev bumps when one
  // lands). None without a kinematic device profile: then the script itself.
  const plannedOf = (script) => app.devicePreview?.planned?.(script, rig.strokeMm) ?? null;
  const planned = new WeakMap();
  /** The plan as a Script within 0.05 units of the planner's 1 ms samples (what the physics and the carriage follow). */
  const planScriptOf = (p) => { let s = planned.get(p); if (!s) planned.set(p, (s = planScript(p, 0.05, { from: 0 }))); return s; };
  let drv = null;
  /** What the Machine plays: the planned motion of the final script (the script without a kinematic profile), or in
   *  "video" mode the video put in where it is trusted (cached). */
  function drivenOf(script) {
    if (vMode !== 'video') { const p = plannedOf(script); return p ? planScriptOf(p) : script; }
    if (!drv || drv.script !== script || drv.track !== vtrack || drv.o !== rig.offsetMm || drv.k !== rig.strokeMm) drv = { script, track: vtrack, o: rig.offsetMm, k: rig.strokeMm, out: videoScript(script, vtrack, rig) };
    return drv.out;
  }
  const usableLen = $derived(Math.min(toy.length_mm, toy.usable_mm || toy.length_mm));
  /** Script against video over the visible range (both modes with video). */
  const vsum = $derived(vMode === 'script' ? null : compareDepth(vtrack, followOf(app).script, rig, usableLen, app.view.start, app.view.start + app.view.span));

  // ---- knot events over the whole script (the strip and the range summary), debounced ----
  let evTimer = 0, evGen = 0, evStale = $state(false);
  $effect(() => {
    if (mode !== 'machine') { untrack(() => { if (events.length) events = []; }); return; }
    const script = drivenOf(followOf(app).script), t = toy, r = rig, p = P;
    clearTimeout(evTimer);
    untrack(() => { evStale = true; });
    // (on the worker, offload.js, paw-mnd8: the whole script's steps; the strip dimmed until the answer for these inputs lands)
    evTimer = setTimeout(() => { const g = ++evGen; off.knots(script, t, r, p).then((ev) => { if (ev && g === evGen) { events = ev; evStale = false; } }, (e) => { console.warn('[machine]', e); if (g === evGen) { events = []; evStale = false; } }); }, 250);
    return () => clearTimeout(evTimer);
  });
  const stats = $derived(knotStats(events, app.view.start, app.view.start + app.view.span));
  // the timeline's knot overlay and the Knotting effect's fit / warning (lane-events.svelte.js): the events of the script
  // (not of the video), the setup they came from; withdrawn when the panel closes
  $effect(() => { const ev = events, setup = { toy, rig, P }; untrack(() => publishKnots(app, vMode === 'video' ? null : ev, setup)); });
  $effect(() => () => publishKnots(app, null, null));

  const rgb = (s) => { try { return hexToRgb(s).map((v) => v / 255); } catch { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map((v) => +v / 255) : [0.5, 0.5, 0.5]; } };
  const mixc = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  const HEIGHT = [140, 210];
  const ftIn = (cm) => { const i = Math.round(cm / 2.54); return `${Math.floor(i / 12)} ft ${i % 12} in`; };
  /** "150 mm (5.9 in)" / "150 mm" / "5.9 in" by the units setting. */
  const fmtLen = (mm, u = 'both') => { const i = (mm / 25.4).toFixed(1).replace(/\.0$/, ''), m = `${Math.round(mm)} mm`; return u === 'mm' ? m : u === 'in' ? `${i} in` : `${m} (${i} in)`; };
  let bendMemo = { key: '', v: null }, straightMemo = null;
  /** The toy's rest curvature table for its roll (memoised per toy and roll). */
  const toyBendFor = (t, r) => { const key = `${t.id}|${r.toFixed(3)}`; if (bendMemo.key !== key) bendMemo = { key, v: toyBend(t, r) }; return bendMemo.v; };
  /** The bone line for the skin's gate, in world mm (the body moved by its recoil xb). */
  const boneLineFor = (sc, xb, mb = null) => { const l = mb ? Float32Array.from(mb.prof.boneLine) : boneLine(sc); for (let i = 0; i < l.length; i += 2) l[i] += xb; return l; };
  /** A modelled body's colon carried by the solved path (paw-kkmv): its stations (centreline.js colonStations) against
   *  the same solve without a toy (cached per body and openness), the canal shown at 55 % or the colon layer's opacity. */
  let idleMemo = null;
  const heldMemo = new Map();   // the gut's slow return: solves at the envelopes' depths (a few, by key)
  function idleOf(mb, scale, side) {
    const key = JSON.stringify([mb.key, P.open, side]);
    if (idleMemo?.key !== key) idleMemo = { key, path: solvePath({ scale, open: P.open, side, d: 0, body: mb.prof }) };
    return idleMemo.path;
  }
  function carriedColon(mb, path, d, scale, side, held) {
    return { ...colonStations(mb.prof.rest, path, idleOf(mb, scale, side), d, (u) => radiusAt(toy, u), { held }), alpha: Math.max(0.55, layerOp.colon ?? 0) };
  }
  /** A straight path along the rail (anatomy off). */
  function straightPath() {
    if (straightMemo) return straightMemo;
    const n = 151, P3 = new Float32Array(n * 3), T = new Float32Array(n * 3), U = new Float32Array(n * 3), V = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { P3.set([0, i * 4, 0], i * 3); T.set([0, 1, 0], i * 3); U.set([1, 0, 0], i * 3); V.set([0, 0, 1], i * 3); }
    return (straightMemo = { n, step: 4, P: P3, T, U, V });
  }
  /** What the auto framing must show: the carriage at its out position to the toy tip at its deepest, and the toy width. */
  // (an imported model is a whole character round the rail: the framing takes in its rear and lower belly too)
  const extent = () => ({ lo: Math.min(rig.offsetMm, 0) - toy.length_mm - 40, hi: Math.max(meshId ? 380 * bodyScale : 70, Math.min(rig.offsetMm + rig.strokeMm, toy.usable_mm || toy.length_mm) + 25), halfWidth: Math.max(meshId ? 170 * bodyScale : 0, maxRadius(toy) + 70) });
  /** The camera now (mid-transition if one is running). */
  function camNow() {
    if (!anim) return cam;
    const t = (performance.now() - anim.t0) / anim.ms;
    if (t >= 1) { cam = anim.to; anim = null; saveCam(); return cam; }
    return blend(anim.from, anim.to, t);
  }
  function goTo(to, ms = 280) { anim = { from: camNow(), to: validCam(to), t0: performance.now(), ms }; kick(); }
  let camTimer = 0;
  let camSaved = JSON.stringify(S.get('machine.cam') ?? null);
  const saveCam = () => { clearTimeout(camTimer); camTimer = setTimeout(() => { const c = { az: cam.az, el: cam.el, zoom: cam.zoom, pan: cam.pan, shift: cam.shift }; camSaved = JSON.stringify(c); S.set('machine.cam', c); }, 300); };
  // the setting changed from outside the view (a script, another window, a reset): go there
  $effect(() => { const c = get('machine.cam', null), j = JSON.stringify(c ?? null); untrack(() => { if (j !== camSaved) { camSaved = j; goTo(c || DEFAULT_CAM); } }); });

  // the panel never holds up the video or the timeline (paw-ekys): while the playhead is dragged (clock.js ScrubGate:
  // it moved within the last 140 ms, not playing) a frame is the pose only: the state without its 10 s strain trace, no strip, no bulge
  // scan; when the playhead rests the next frame refines everything. A panel off screen draws nothing.
  const scrubGate = new ScrubGate(140);
  let restTimer = 0, lastTrace = null;
  $effect(() => () => clearTimeout(restTimer));

  // paw-mnd8: new params (a tuning slider dragged, or let go) late in a script would integrate the whole history again in
  // one frame. Instead a second sim lays the new history off the frame (5 ms slices); until it is near the playhead the
  // frame shows the old history carried over its last 4 s under the new params (previewAt: approximate, the readouts
  // dimmed); then it takes over: the same steps, the same numbers as integrating it at once.
  let nextSim = null, catchTimer = 0, catchT = 0, simStale = $state(false);
  const CATCH_MS = 8000;   // a playhead before this integrates in the frame, as before (a few ms)
  $effect(() => () => clearTimeout(catchTimer));
  function catchUp() {
    catchTimer = 0;
    if (!nextSim) return;
    if (nextSim.advance(catchT, 5)) kick(); else catchTimer = setTimeout(catchUp, 0);
  }
  /** The preview state at t while the new history is laid, else null (sim is current, or swapped in now). */
  function previewOf(script, t) {
    const k = simKey(toy, rig, P);
    let pv = null;
    if (k !== sim.key && sim.ctx && sim.script === script && sim.setup === setupKey(toy, rig) && t > CATCH_MS) {
      (nextSim ??= new MachineSim()).configure(script, toy, rig, P);
      catchT = t;
      if (!nextSim.advance(t, 0)) pv = sim.previewAt(t, nextSim.ctx);
      if (pv) { if (!catchTimer) catchTimer = setTimeout(catchUp, 0); }
      else { sim = nextSim; nextSim = null; }   // caught up (or another state shape: integrated here, as before)
    } else nextSim = null;
    if (simStale !== !!pv) simStale = !!pv;
    return pv;
  }

  function frame() {
    raf = 0;
    if (!C || cw < 40 || ch < 60 || !visible || mode !== 'machine') return;
    // one display time for everything (carriage, toy, ring, readouts): the pointer's unsnapped time while scrubbing,
    // the player's clock while playing, else the playhead, interpolated over the update interval only when it moves
    // in frame steps (clock.js)
    const pl = app.player, tNow = performance.now(), src = timeSource(pl);
    const t = dclock.at(src.t, tNow, { playing: src.direct, frameMs: pl.frameMs || 1000 / 30 });
    const script0 = followOf(app).script, script = drivenOf(script0);
    const scrubbing = scrubGate.tick(t, tNow, pl.playing);
    if (scrubbing) { clearTimeout(restTimer); restTimer = setTimeout(kick, scrubGate.ms + 10); }
    const pv = previewOf(script, t);
    if (!pv) sim.configure(script, toy, rig, P);
    fctx = pv ? nextSim.ctx : sim.ctx;
    const { state: s, trace: tr } = pv ? { state: pv } : sim.stateAt(t, scrubbing ? {} : { traceMs: 10000, every: 50 });
    const trace = tr || lastTrace;
    if (tr) lastTrace = tr;
    vNow = vMode !== 'script' ? videoAt(vtrack, t) : NaN;
    // the carriage at the exact display time (the script interpolated, as the lanes draw it), the toy offset from it by
    // the physics
    const L = toy.length_mm, dcNow = script.length ? Math.min(depthOf(rig, posAt(script, t)), fctx.len) : s.dc;
    // (at the force limit the carriage is held where the physics put it; otherwise it moves with the script inside the step)
    const shift = Math.abs(s.dt - s.dc) > 0.5 ? 0 : dcNow - s.dt;
    const dc = s.dc + shift, d = s.d + shift, easing = dclock.moving(tNow);
    const v = prevD == null ? 0 : d - prevD;
    prevD = d;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const lipShift = s.re > 0 ? Math.max(-4, Math.min(4, v * 0.6)) : 0;
    if (!use2D && scene && !scene.lost && cv) {
      const c = camNow(), ex = extent();
      const fk = JSON.stringify([c.az, c.el, c.shift, ex, cw, ch]);
      if (fk !== fitKey) { fitKey = fk; fitBase = fitDist(c, ex, cw, ch); }
      const view0 = viewOf(c, fitBase, cw, ch), mbv = meshId || pitchDeg ? meshBodyNow() : null;
      lastView = view0;   // (pan and zoom work on the floor's camera)
      // the body stays level on its floor and the rail shows its angle against it (paw-3562): the scene drawn turned
      const view = tiltView(view0, mbv?.tilt || 0);
      const ctx = fctx, R = maxRadius(toy), comp = Math.max(0, dc - s.xb - d), scale = P.bodyScale, xb = s.xb;
      // where the toy and the gut lie now (centreline.js): the toy against the tissue, the gut past it on its tethers
      const bend = toyBendFor(toy, roll);
      // (the tissue's state for the solve, shared with the phone: physics.js pathInputs; the sigmoid's straightening and
      // the descending colon's opening included, paw-qin8)
      const pin = pathInputs(s, ctx);
      const mb = mbv;
      const side = mb?.prof.side ?? char.body?.side ?? SIDE;
      const solveAt = (dd) => solvePath({ scale, open: P.open, side, d: dd, ...pin,
        toy: { r: ctx.table, EI: ctx.mech.EI, bend }, tissueEI: EI_REF, floor: P.bendFloor, body: mb?.prof || null });
      const path = P.anatomy ? solveAt(d) : null;
      // the gut's slow return (physics.js TISSUE_RETURN): where the rectum's and the sigmoid's envelopes still hold it
      // (solved again only while they lag the tip, and not while the playhead is dragged)
      // (an envelope moves slowly: its solve is kept per 2 mm of depth and the solve's other inputs, a few at a time)
      const heldAt = (e) => {
        const de = e + shift; if (de <= d + 3) return { path, d };
        const dq = Math.round(de / 2) * 2, key = JSON.stringify([dq, pin.left.map((x) => +x.toFixed(2)), +pin.lateral.toFixed(2), +pin.forward.toFixed(2), +pin.descOpen.toFixed(2), roll.toFixed(2), mb?.key, toy.id, scale, side]);
        let hp = heldMemo.get(key); if (!hp) { hp = solveAt(dq); heldMemo.set(key, hp); if (heldMemo.size > 6) heldMemo.delete(heldMemo.keys().next().value); }
        return { path: hp, d: dq };
      };
      const held = path && mb?.prof?.bends && !scrubbing && !pv ? (() => { const hs = heldAt(s.envS || 0), hr = Math.abs((s.envR || 0) - (s.envS || 0)) < 3 ? hs : heldAt(s.envR || 0); return [hr, hs, mb.prof.bends.rs]; })() : null;
      const rest = P.anatomy ? mb?.prof.rest || restPath(scale, { open: P.open, side }) : null;
      let moved = 0;
      if (path) for (let i = 0; i < path.n; i += 4) moved = Math.max(moved, Math.hypot(path.P[i * 3] - rest.P[i * 3], path.P[i * 3 + 1] - rest.P[i * 3 + 1], path.P[i * 3 + 2] - rest.P[i * 3 + 2]));
      const tc = toyCentreline({ path: path || straightPath(), d, dc, xb, L, bend, base: meshCentre ? baseOf(meshCentre, L, roll) : null });
      lastToy = tc; lastPath = path; lastXb = xb;
      // the hole along the canal for the body's shader (ring.js openingSleeve): per sample the stations' apertures shaped
      // like the toy's own section there (its mesh's, else its outline's oval), plus a little tissue, and the rim's travel
      const Lc = ctx.canal.Lc, { sleeve, sleeveY, rim } = openingSleeve(s, ctx.canal, toy, d, roll, radiusAt, toyPolarTab);
      // the tube's own state (physics.js tubeState): its empty lumen per station (readiness widens it, a residual
      // opening holds it open for a while after a deep toy) and its readiness, tinting the wall along its length
      const ts = tubeState(s, ctx), lumenAt = ts ? (x) => {
        const n = ts.s.length, f = (x - ts.s[0]) / (ts.s[1] - ts.s[0]);
        if (f < 0) return restRadius(x, scale);
        if (f >= n - 1) { const e = Math.min(1, (x - ts.s[n - 1]) / (30 * scale)); return ts.lumen[n - 1] + (restRadius(x, scale) - ts.lumen[n - 1]) * e; }
        const j = Math.floor(f); return ts.lumen[j] + (ts.lumen[j + 1] - ts.lumen[j]) * (f - j);
      } : null;
      const tubeR = (x) => wallRadius(x, d, (u) => radiusAt(toy, u), s.a, scale, lumenAt);
      const readyS = [0, pathLength(scale) / 39], ready = new Float32Array(40);
      if (ts) for (let k = 0; k < 40; k++) {   // the canal by its warm-up, the tube past it by its stations' readiness
        const x = k * readyS[1], f = (x - ts.s[0]) / (ts.s[1] - ts.s[0]), n = ts.s.length;
        ready[k] = f < 0 ? s.w : f >= n - 1 ? ts.ready[n - 1] * Math.max(0, 1 - (f - n + 1) / 6) : ts.ready[Math.floor(f)] + (ts.ready[Math.min(n - 1, Math.floor(f) + 1)] - ts.ready[Math.floor(f)]) * (f - Math.floor(f));
      }
      const bendS = ctx.bends ? ctx.bends.map((b) => b.s) : bendsAt(scale);
      const tubeW = (x) => { let w = 0; for (let i = 0; i < bendS.length; i++) { const kk = (s.bendBlocked === i ? 0.6 : 0) + 2 * s.yb[i]; if (kk > 0.02) w = Math.max(w, Math.min(1, kk) * Math.exp(-(((x - bendS[i]) / 14) ** 2))); } return w; };
      if (mb) scene.setBodyMesh(mb.layers || mb.mesh, mb.key, meshId ? meshAsset.img : null); else if (!meshId) scene.setBody(bodyProps, kick);
      const tk = JSON.stringify([theme?.name, toy.id]);
      if (tk !== themeKey) { themeKey = tk; scene.setTheme(theme, knot ? Math.min(0.95, knot.to_mm / L + 0.02) : 0.84); }
      // a schematic look from the theme: cool neutral body, matte purple toy, strain-coloured lips, a faint grid
      const tx = rgb(C.tx), bgc = rgb(C['bg-sunken']);
      const colors = { bg: bgc, grid: rgb(C['line-4']), rail: rgb(C['line-2']), tick: rgb(C['tx-mut']), carriage: mixc(rgb(C['line-4']), tx, 0.25),
        toy: mixc(rgb(C['series-violet']), [0.6, 0.58, 0.66], 0.3), ghost: tx, edge: mixc(tx, rgb(C.accent), 0.35),
        body: mixc(mixc(rgb(C['line-4']), tx, 0.25), rgb(C.accent), 0.1), tube: mixc(rgb(C['line-4']), tx, 0.85), strokeBand: rgb(C.accent),
        bend: rgb(s.bendBlocked >= 0 && s.yb[s.bendBlocked] > 0.35 ? C.bad : C.warn), ready: rgb(C['series-sky']), pros: rgb(C['series-orange'] || C.warn), lip: rgb(strainColor(C, s.strain)) };
      const ghostC = new Float32Array(120), ghostQ = new Float32Array(160);
      for (let k = 0; k < 40; k++) { ghostC.set([0, dc - (k / 39) * L, 0], k * 3); ghostQ[k * 4 + 3] = 1; }
      const colonSt = path && mb?.prof?.rest ? carriedColon(mb, path, d, scale, side, held) : null;
      // (the drawn state for checks: the colon's stations, the path tube's radius every 5 mm, the ring)
      viewState = { colon: colonSt ? { C: Array.from(colonSt.C), step: colonSt.step, tip: colonSt.tip } : null, tube: path && !colonSt ? Array.from({ length: 61 }, (_, i) => tubeR(i * 5)) : null, pin, tipP: path && path.tip >= 0 ? Array.from(path.P.subarray(path.tip * 3, path.tip * 3 + 3)) : null };
      scene.render({ w: cw, h: ch, dpr, view, L, R, dc, roll, bulge: Math.min(0.25, comp / L), squash: s.r > 0 ? Math.max(0, 1 - s.re / s.r) : 0,
        toyP: [L, d, tc.scale, Math.min(1.25, 1 + 0.5 * Math.max(0, 1 - tc.scale))], toyC: path && d > 0 ? wobbledC(tc, s.wob || 0, L) : tc.C, toyQ: tc.Q, ghostC, ghostQ,
        sleeve, sleeveY, rim, hole: [s.xi, (s.xj - s.xb) * 0.35, 42 * Math.sqrt(scale), Lc], xb, hilt: [s.hiltComp, ctx.hilt.rb, 0, 0], baseSquash: s.hiltF > 0 ? Math.min(0.2, s.hiltF / ctx.hilt.kBase / ctx.hilt.rb) : 0,
        canalR: mb && !mb.mesh.canal ? 1e4 : undefined, cut, ghost: Math.abs(dc - xb - d) > 1.5, xray: cut ? 1 : mb?.layers ? layerOp.skin : 0.55, colors,
        prostate: P.prostate && prostateNow ? { c: [prostateNow.c[0], prostateNow.c[1] + xb, prostateNow.c[2]], r: prostateNow.r, i: s.pros } : null, layers: mb?.layers ? layerOp : null, fade: mb?.fade ? [mb.fade[0], [mb.fade[1][0], mb.fade[1][1] + xb, mb.fade[1][2], mb.fade[1][3]]] : null, flagA: path ? 0.25 * (layerOp.colon ?? 0) : -1, colon: colonSt, railFrom: ex.lo + 10,
        ring: globalThis.__machineRingOff ? null : { rel: restOf(P), scale },   // (the opening's marker, ring.js; the flag: checks only)
        stroke: [depthOf(rig, 100) - L, Math.min(depthOf(rig, 0), toy.usable_mm || L) - L], target: Math.abs(s.dt - s.dc) > 1 ? s.dt - L : null,
        path, junction: P.bends?.rs ?? ANATOMY.rsJunction * scale, tubeR, tubeW, ready, readyS, ghostPath: moved > 4 ? rest : null,
        // the body wall drapes over the toy's own form where it runs deep (centreline.js bulgeAt)
        ...(P.anatomy ? (() => { const wl = bodyWall(scale, weight), wallSt = bulgeStations(tc, toy, wl, scale), wall = [wl, 1.3 * R + wl, 60 * scale, 0.5 * (L * tc.scale) / 39]; lastBulge = { tc, wallSt, wall, xb };
          // the organs it pushes aside sink back with the sigmoid (physics.js TISSUE_RETURN): pushed by the toy where its
          // envelope still holds them
          const hs = held?.[1], th = hs && hs.d > d + 3 ? toyCentreline({ path: hs.path, d: hs.d, dc: dc + hs.d - d, xb, L, bend, base: meshCentre ? baseOf(meshCentre, L, roll) : null }) : null;
          const push = th ? { C: th.C, Q: th.Q, W: bulgeStations(th, toy, wl, scale) } : null;
          // the soft organs' lattice, pushed by the same toy (and kept under the skin where the toy bulges it; not
          // while the playhead is dragged)
          // (and by the sigmoid where its straightening has moved it forward, with or without the toy in it: paw-qin8)
          const gut = mb?.latBox && path && pin.forward > 0.02 && mb.prof.bends ? gutSweep(path, idleOf(mb, scale, side), { from: mb.prof.bends.windows[1][1], to: (path.n - 1) * path.step, r: ANATOMY.sigmoidR * scale + 3, xb }) : null;   // (to the drawn path's top: carried, the descending colon moves too, paw-hito)
          const lattice = mb?.latBox ? { box: mb.latBox, range: LATTICE.range, bytes: latticeBytes(latticeField(mb.latBox, mb.prof, push || tc, push ? push.W : wallSt, { xb, bulge: scrubbing || pv ? null : { roll, wall: wl, from: wall[2], cap: wall[1] }, extra: gut ? [gut] : [] })) } : null;
          return { wallSt, wall, push, lattice, contour: [3 * Math.sqrt(scale), wl - bodyWall(scale, 0)], bone: boneLineFor(scale, xb, mb) }; })() : (lastBulge = null, {})) });
      overlay(view, ex, s, d, dc);
    } else if (cv2) {
      const G = frozen2 || layout(cw, ch, toy, rig), g = cv2.getContext('2d');
      fit(cv2, cw, ch);
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv2.width, cv2.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFrame(g, G, { toy, img, rig, char, state: s, depth: d, lipShift, trace, knot, hover }, C);
    }
    if (strip && sw > 40 && !scrubbing) {
      const g = strip.getContext('2d'), H = 64;
      fit(strip, sw, H);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStrip(g, sw, H, trace, events, app.view, t, C);
    }
    const now = performance.now();
    // (paw-mnd8: a preview frame, a tuning slider dragged, is as light as a playing one: readouts every 120 ms, the bulge
    // scan on the worker, no envelope solves or lattice bulge; the frame after the new history lands refines everything)
    if ((!pl.playing && !scrubbing && !pv) || now - lastRo > 120) {
      lastRo = now; ro = { ...summary(s, fctx), pros: P.prostate ? s.pros : null };
      // the window is toy vs opening: the body may have moved; v: the video's mm inside now, ds: the script's
      liveDepth = { d, dc: dc - s.xb, v: vNow, ds: script0.length ? Math.min(depthOf(rig, posAt(script0, t)), fctx.len) : NaN, mk: s.knot, vk: vMode !== 'script' ? videoKnot(vtrack, t) : null };
      // the bulge's peak (the shader's push, centreline.js bulgeAt, over a cached sample of the belly's skin: a readout,
      // not a render; kept while the playhead is dragged)
      const mbn = meshId || pitchDeg ? meshBodyNow() : null;
      // (playing: on the worker, offload.js, the peak shown when it comes back; paused: here, now. paw-h83k: ~25 ms in one
      // frame every 120 ms dropped frames)
      if (!scrubbing && lastBulge && d > 60 * P.bodyScale && (mbn || (!meshId && !pitchDeg))) {
        const { tc, wallSt, wall, xb: bxb } = lastBulge, m = mbn ? mbn.fit : rearMesh(bodyProps), g = pl.playing || pv ? bulgeGen : ++bulgeGen;
        const job = { mesh: m, ix: bulgeSample(m, P.bodyScale), tc: { C: tc.C, Q: tc.Q }, wallSt, roll, wall, o: { from: wall[2], cap: wall[1], h: wall[3] }, bl: boneLineFor(P.bodyScale, bxb, mbn), bxb };
        if (!pl.playing && !pv) bulgeMm = bulgePeak(job);
        else off.bulge(job).then((bp) => { if (bp != null && g === bulgeGen) bulgeMm = bp; });
      } else if (!scrubbing) { bulgeMm = 0; bulgeGen++; }
      const fv = trace?.forces, n = fv ? fv.length : 0;
      let peak = 0;
      for (let i = Math.max(0, n - 60); i < n; i++) peak = Math.max(peak, fv[i]);
      liveForce = { F: s.F, peak, lag: s.dt - s.dc };
    }
    const key = `${sim.key}|${script.length}|${Math.round(s.t / 500)}`;
    if (knot && key !== ttrKey && !pv) {
      clearTimeout(ttrTimer);
      const st = copyState(s), ctx = fctx;
      // (on the worker, offload.js: a stroking that levels off runs the whole 10 min forward, 100-450 ms of steps, paw-h83k;
      // paused (paw-mnd8: also there, not in one main-thread task after a tuning change), an answer still coming for an
      // earlier ask is dropped)
      ttrTimer = setTimeout(() => {
        ttrKey = key; lastTtr = performance.now();
        const g = app.player.playing ? ttrGen : ++ttrGen;
        off.ready(st, script, st.t, ctx).then((r) => { if (r && g === ttrGen) ttr = r; });
      }, pl.playing ? Math.max(0, 500 - (now - lastTtr)) : 150);
    }
    if (!knot) { ttr = null; ttrGen++; }
    globalThis.__machineView = { t, d, dc, tip: hand?.tip, base: hand?.base, use2D, strokeMm: rig.strokeMm, offsetMm: rig.offsetMm, planned: script !== script0, frames: (globalThis.__machineView?.frames || 0) + 1, xi: s.xi, knot: s.knot, eye: lastView?.eye, ...viewState, ring: scene?.ringInfo || null, bulge: bulgeMm, cost: performance.now() - tNow };
    if ((pl.playing || anim || easing) && visible) raf = requestAnimationFrame(frame);
  }
  /** A canvas's backing store follows its CSS box at dpr, in BOTH directions (a height-only resize left a stale band). */
  function fit(canvas, w, h) {
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }

  /** 2D over the 3D view: rail handles, ruler numbers, the knot's real vs rigid position. Cleared in device pixels
   *  every frame; anything behind the camera or off the canvas is skipped, never clamped to an edge. */
  function overlay(view, ex, s, d, dc) {
    if (!ov) return;
    fit(ov, cw, ch);
    const g = ov.getContext('2d'), L = toy.length_mm, R = maxRadius(toy), zr = -(R + 12);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ov.width, ov.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P2 = (p) => project(view.vp, p, cw, ch);
    const onCanvas = ([x, y, w]) => w > 0 && x >= 34 && x <= cw - 40 && y >= 8 && y <= ch - 8;   // room for the label
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    // handles: the carriage's base at pos 100 (out) and pos 0 (deep); the toy's tip and base where they really are
    const hx = 30, yOut = depthOf(rig, 100) - L, yDeep = Math.min(depthOf(rig, 0), toy.usable_mm || L) - L, tc = lastToy;
    const tipW = tc ? toyPoint(tc, 0, L) : [0, d, 0], baseW = tc ? toyPoint(tc, L, L) : [0, dc - L, 0];
    const rpx = (() => { const a = P2(tipW), b = P2([tipW[0] + R, tipW[1], tipW[2]]); return Math.hypot(b[0] - a[0], b[1] - a[1]); })();
    hand = { out: P2([hx, yOut, zr]), deep: P2([hx, yDeep, zr]), axis: [P2([hx, 0, zr]), P2([hx, 10, zr])], tip: P2(tipW), base: P2(baseW), rpx };
    g.font = `10px ${C.mono || 'monospace'}`; g.fillStyle = C['tx-mut']; g.textBaseline = 'middle'; g.textAlign = 'right';
    const placed = [];
    const free = (q) => !placed.some(([x, y]) => Math.abs(x - q[0]) < 30 && Math.abs(y - q[1]) < 13);   // legible: never two labels on top of each other
    for (let mm = Math.ceil(ex.lo / 50) * 50; mm <= 0; mm += 50) {
      const q = P2([-22, mm, zr]);
      if (!onCanvas(q) || !free(q)) continue;
      g.fillText(`${-mm}`, q[0] - 4, q[1]); placed.push(q);
    }
    g.textAlign = 'left';
    // depth along the internal path: at most four labels (a mid mark or the video's depth, the rectosigmoid junction, the toy's tip, and the
    // flexure's name in the cutaway or "forcing"), each on a small plate beside its point with a leader line, placed
    // where it overlaps neither another label, the ruler, nor the toy
    if (lastPath) {
      const at = (mm) => { const p = pointAt(lastPath, mm); return [p[0], p[1] + lastXb, p[2]]; }, sc = P.bodyScale, J = Math.round(P.bends?.rs ?? ANATOMY.rsJunction * sc);
      const rects = placed.map(([x, y]) => [x - 30, y - 7, 30, 14]);
      const disks = [];
      if (tc) for (let k = 0; k < 40; k++) { const u = (k / 39) * L, p = toyPoint(tc, u, L), a = P2(p), rr = radiusAt(toy, u) + 4, b = P2([p[0] + view.up[0] * rr, p[1] + view.up[1] * rr, p[2] + view.up[2] * rr]); if (a[2] > 0) disks.push([a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1])]); }
      const hits = ([x, y, w, h]) => rects.some(([X, Y, W, H]) => x < X + W && X < x + w && y < Y + H && Y < y + h)
        || disks.some(([cx, cy, r]) => Math.hypot(Math.max(x - cx, 0, cx - (x + w)), Math.max(y - cy, 0, cy - (y + h))) < r);
      const OFFS = [[26, -20], [26, 20], [-26, -20], [-26, 20], [40, 0], [-40, 0], [0, -30], [0, 30], [56, -36], [-56, -36], [56, 36], [-56, 36], [80, 0], [-80, 0], [0, -52], [0, 52], [70, -60], [-70, -60], [70, 60], [-70, 60]];
      // gauge (0..1, optional): a small ring at the plate's left filled that far round (the junction's readiness)
      const plate = (p3, text, color, font = C.font || 'sans-serif', gauge = null) => {
        const a = P2(p3);
        if (!(a[2] > 0)) return;
        g.font = `10px ${font}`;
        const gw = gauge == null ? 0 : 13, w = g.measureText(text).width + 8 + gw, h = 14;
        for (const [dx, dy] of OFFS) {
          const x = dx < 0 ? a[0] + dx - w : dx > 0 ? a[0] + dx : a[0] - w / 2, y = a[1] + dy - h / 2, r = [x, y, w, h];
          if (x < 34 || x + w > cw - 4 || y < 30 || y + h > ch - 4 || hits(r)) continue;
          rects.push(r);
          const ex = Math.max(x, Math.min(x + w, a[0])), ey = Math.max(y, Math.min(y + h, a[1]));
          g.strokeStyle = C['line-3']; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(ex, ey); g.stroke();
          g.fillStyle = C['tx-mut']; g.beginPath(); g.arc(a[0], a[1], 1.8, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 0.82; g.fillStyle = C['bg-sunken']; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, 3); else g.rect(x, y, w, h); g.fill(); g.globalAlpha = 1;
          if (gw) {
            const cx = x + 4 + 4.5, cy = y + h / 2;
            g.lineWidth = 1.6; g.strokeStyle = C['line-3']; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.stroke();
            g.strokeStyle = C['series-sky']; g.beginPath(); g.arc(cx, cy, 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, gauge))); g.stroke(); g.lineWidth = 1;
          }
          g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, x + 4 + gw, y + h / 2 + 0.5);
          return;
        }
      };
      // from the state drawn now (ro is throttled and set after this frame's overlay)
      const dsum = depthSummary(s, fctx), fJ = dsum && dsum.blocked === 1 && dsum.forced, fA = dsum && dsum.blocked === 0 && dsum.forced, jr = readyOf(dsum);
      plate(at(J), fJ ? 'forcing the rectosigmoid junction' : `junction ${pct(jr)} ready · ${fmtLen(J, units)}`, fJ ? C.bad : C['tx-mut'], undefined, fJ ? null : jr);
      if (d > 8) plate(tipW, `tip · ${fmtLen(Math.round(d), units)}`, C['tx-mut'], C.mono || 'monospace');
      const mid = Math.round(100 * sc), vd = vMode === 'both' ? vNow : NaN;
      if (Number.isFinite(vd) && vd > 2) {   // the video's depth: the toy's centreline as far as the video says it is in (it takes the mid mark's place)
        const vc = C['series-orange'] || C.warn;
        g.save(); g.strokeStyle = vc; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath();
        let first = true;
        for (let mm = 0; mm <= vd; mm = Math.min(vd, mm + 4)) { const q = P2(at(mm)); if (q[2] > 0) { if (first) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); first = false; } if (mm >= vd) break; }
        g.stroke(); g.setLineDash([]);
        const e = P2(at(vd)); if (e[2] > 0) { g.beginPath(); g.arc(e[0], e[1], 4, 0, Math.PI * 2); g.stroke(); }
        g.restore();
        plate(at(vd), `video · ${fmtLen(Math.round(vd), units)}`, vc, C.mono || 'monospace');
      } else if (Math.abs(mid - d) > 40 * sc && Math.abs(mid - J) > 30) plate(at(mid), fmtLen(mid, units), C['tx-mut'], C.mono || 'monospace');
      if (fA || cut) plate(at((P.bends?.bends || bendsAt(sc))[0]), fA ? 'forcing' : 'anorectal flexure', fA ? C.bad : C['tx-mut']);
    }
    // knot: where it really is (filled) and where a rigid toy would put it (hollow)
    if (knot && tc) {
      const kp = toyPoint(tc, knot.peak_mm, L), real = P2([kp[0] + R + 6, kp[1], kp[2]]), rigid = P2([R + 6, dc - knot.peak_mm, 0]);
      if (onCanvas(real)) {
        g.strokeStyle = C.accent; g.fillStyle = C.accent;
        g.beginPath(); g.arc(real[0], real[1], 3.5, 0, Math.PI * 2); g.fill();
        if (onCanvas(rigid) && Math.hypot(real[0] - rigid[0], real[1] - rigid[1]) > 4) {
          g.setLineDash([2, 2]); g.beginPath(); g.moveTo(real[0], real[1]); g.lineTo(rigid[0], rigid[1]); g.stroke(); g.setLineDash([]);
          g.beginPath(); g.arc(rigid[0], rigid[1], 3.5, 0, Math.PI * 2); g.stroke();
          g.fillStyle = C['tx-mut']; g.font = `10px ${C.font || 'sans-serif'}`; g.fillText('rigid', rigid[0] + 6, rigid[1]);
        }
        g.fillStyle = C.accent; g.font = `10px ${C.font || 'sans-serif'}`; g.fillText('knot', real[0] + 6, real[1]);
      }
    }
  }

  // (the heavy readouts on a worker while playing, offload.js; a generation drops an answer asked before a reset)
  const off = createOffload();
  let cv2 = $state(), frozen2 = null, ttrTimer = 0, ttrGen = 0, bulgeGen = 0, vNow = NaN;
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  $effect(() => {
    if (!C) return;
    app.doc.axes; app.doc.activeAxis; app.devicePreview?.rev; toy; rig; P; char; hover; meshAsset; bodyFit; layerOp; imgTick; cw; ch; sw; cam; roll; cut; use2D; meshTick; events; app.view; vMode; vtrack;
    if (!app.player.playing) app.player.shownMs; else app.player.playing;   // paused: the frame on screen (paw-o60v.8.1)
    kick();
  });
  $effect(() => () => { cancelAnimationFrame(raf); raf = 0; clearTimeout(camTimer); clearTimeout(ttrTimer); off.close(); });

  // ---- pointer (Blender-like turntable): drag empty space or middle-drag orbits about the pivot (the opening);
  // Shift+drag or Shift+middle pans; wheel zooms toward the pointer; double-click frames toy and opening; dragging
  // the toy rolls it (double-click it: no roll); the out / deep handles drag along the rail ----
  const at = (e) => { const r = (ov || cv2).getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function hit3(x, y) {
    if (!hand) return null;
    const [a, b] = [hand.base, hand.tip], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    return Math.hypot(x - (a[0] + u * dx), y - (a[1] + u * dy)) <= Math.max(10, hand.rpx) ? 'toy' : null;
  }
  function hit2(x, y) {
    const G = layout(cw, ch, toy, rig), H = handles(G, toy, rig);
    if (Math.abs(x - H.x) > 14) return null;
    return Math.abs(y - H.out) <= 9 ? 'out' : Math.abs(y - H.deep) <= 9 ? 'deep' : null;
  }
  const hitAt = (x, y) => (use2D ? hit2(x, y) : hit3(x, y));
  function down(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const [x, y] = at(e), h = e.button === 1 ? null : hitAt(x, y);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    anim = null;
    if (h === 'out' || h === 'deep') {
      if (use2D) frozen2 = layout(cw, ch, toy, rig);
      drag = { which: h, x, y, rig: { ...rig }, axis: hand?.axis };
    } else drag = { which: use2D ? null : e.shiftKey ? 'pan' : h === 'toy' && e.button === 0 ? 'roll' : 'orbit', x, y, lx: x, ly: y, roll };
  }
  function move(e) {
    const [x, y] = at(e);
    if (!drag) { const h = hitAt(x, y); const hv = h === 'toy' ? null : h; if (hv !== hover) hover = hv; return; }
    const r0 = drag.rig, deepEnd = r0 && r0.offsetMm + r0.strokeMm, L = toy.length_mm;
    if (drag.which === 'out' || drag.which === 'deep') {
      let mm;
      if (use2D) { const G = frozen2; mm = (drag.y - y) / G.k; }
      else { const [p0, p1] = drag.axis, ux = (p1[0] - p0[0]) / 10, uy = (p1[1] - p0[1]) / 10; mm = ((x - drag.x) * ux + (y - drag.y) * uy) / (ux * ux + uy * uy || 1); }
      if (drag.which === 'out') { const off = Math.round(Math.min(deepEnd - 10, Math.max(-L, r0.offsetMm + mm))); dragRig = { offsetMm: off, strokeMm: Math.round(deepEnd - off) }; }
      else dragRig = { offsetMm: r0.offsetMm, strokeMm: Math.round(Math.min(400, Math.max(10, r0.strokeMm + mm))) };
      return;
    }
    const dx = x - drag.lx, dy = y - drag.ly;
    drag.lx = x; drag.ly = y;
    if (drag.which === 'roll') roll = drag.roll + (x - drag.x) * 0.012;
    else if (drag.which === 'orbit') cam = orbit(cam, dx, dy);
    else if (drag.which === 'pan' && lastView) cam = pan(cam, lastView, dx, dy, cw, ch);
  }
  function up() {
    if (!drag) return;
    const was = drag.which;
    drag = null; frozen2 = null;
    if (dragRig) { S.set('machine.rig', dragRig); dragRig = null; }
    if (was === 'orbit' || was === 'pan') saveCam();
    if (was === 'roll') saveRoll(roll);
  }
  /** Frame the toy and the opening: the current angle, no pan, auto distance. */
  const frameAll = () => goTo({ ...cam, zoom: cut ? 1.35 : 1, pan: [0, 0, 0], shift: cut ? 0 : DEFAULT_CAM.shift });
  function dbl(e) {
    const [x, y] = at(e);
    if (!use2D && hit3(x, y) === 'toy') { roll = roll0; saveRoll(null); }
    else frameAll();
  }
  const wheel = (node) => {
    const f = (e) => {
      if (use2D || !lastView) return;
      e.preventDefault(); anim = null;
      const [x, y] = at(e);
      cam = zoomAt(cam, lastView, Math.exp(-e.deltaY * 0.0015), (x / cw) * 2 - 1, 1 - (y / ch) * 2);
      saveCam();
    };
    node.addEventListener('wheel', f, { passive: false });
    return () => node.removeEventListener('wheel', f);
  };
  /** A preset's full camera (its pan scaled with the height). */
  const presetCam = (v) => { const p = PRESETS[v]; return { az: p.az, el: p.el, zoom: p.zoom ?? 1, pan: (p.pan || [0, 0, 0]).map((x) => x * bodyScale), shift: p.shift ?? DEFAULT_CAM.shift }; };
  // a preset is "on" only while the camera is exactly it (angle, zoom, pan): zoomed, panned or cut away, clicking it
  // applies it again (a segmented control ignores a click on the option already selected: the preset that seemed not
  // to apply)
  const viewName = $derived(cut ? '' : Object.keys(PRESETS).find((k) => { const p = presetCam(k); return Math.abs(p.az - (((cam.az % 360) + 540) % 360 - 180)) < 1 && Math.abs(p.el - cam.el) < 1 && Math.abs(cam.zoom - p.zoom) < 0.02 && cam.pan.every((x, i) => Math.abs(x - p.pan[i]) < 1); }) || '');
  function setView(v) { if (cut) { cut = false; camBeforeCut = null; } goTo(presetCam(v)); }
  /** The cutaway is the knot-timing view: slice the body and swing to a close side view on the opening. */
  function setCut(on) {
    cut = on;
    if (on) { camBeforeCut = { ...cam }; goTo({ ...PRESETS.side, el: 6, zoom: 1.35, pan: [0, P.anatomy ? 70 * P.bodyScale : -Math.min(50, toy.length_mm * 0.2), P.anatomy ? 30 * P.bodyScale : 0], shift: 0 }, 350); }
    else if (camBeforeCut) { goTo(camBeforeCut, 350); camBeforeCut = null; }
  }

  // ---- pickers and tuning ----
  const pick = (key) => S.set('machine.toy', key);
  const setTheme = (name) => S.set('machine.theme', { ...get('machine.theme', {}), [entry.key]: name });
  const charOptions = $derived(offered.map((c) => ({ value: c.id, label: c.name })));
  const setChar = (id) => S.set('machine.char', id);   // the body only: the tissue comes from the experience preset
  // (a draft while dragged: commit on release); back at the preset (a slider's Reset to default) the override goes
  const preset = $derived(paramsFor(experience, {}));
  const setParam = (key, v) => { const o = { ...overrides, [key]: v }; if (v === preset[key]) delete o[key]; tune('machine.params', o); };
  const setFirmness = (v) => S.set('machine.firmness', { ...get('machine.firmness', {}), [entry.key]: v });
  async function removeCustom(t) {
    if (!(await app.confirm({ title: 'Remove toy', message: `Remove "${t.name}" from your toys?`, ok: 'Remove', danger: true }))) return;
    S.set('machine.toys', custom.filter((x) => x.id !== t.key));
    if (toyKey === t.key) S.set('machine.toy', list[0].key);
  }
  function saveImported(t) { S.set('machine.toys', [...custom, t]); S.set('machine.toy', t.id); importing = false; }

  // an imported model's landmark nudges (machine.bodyFit), mm at the model's own height / degrees
  const FIT = [
    { key: 'up', label: 'Opening height', min: -40, max: 40, fmt: (v) => `${v > 0 ? '+' : ''}${v} mm`, tip: (n) => `Where the toy enters ${n}: + toward the back, - the belly` },
    { key: 'fwd', label: 'Opening depth', min: -40, max: 40, fmt: (v) => `${v > 0 ? '+' : ''}${v} mm`, tip: (n) => `${n}'s opening along the canal: + deeper, - out` },
  ];
  // the warm-up in the model's own terms: what the routine left for this toy, at this script's depth
  const warmTip = $derived.by(() => {
    const script = followOf(app).script, depth = scriptDepth(script, rig, toy), k = knotOf(toy);
    const base = 'Warmed start: the script starts warmed up, the state the model reaches after slow strokes (2 s each) with this toy, working up from a third of the depth the script reaches to all of it. None: from cold. Light: at least 2 min, and for a knotted toy until the ring is half ready for its knot. Full: at least 5 min, until it is ready (the knot taken without the cold-start resistance; at most 15 min)';
    if (warmup === 'none' || !(depth > 0)) return base;
    const w = warmStart(toy, rig, P, warmup, depth);
    if (!w) return base;
    return `${base}. Now (${warmup}, ${Math.round(depth)} mm deep, ${Math.round(w.warmMs / 6000) / 10} min): ring relaxed ${Math.round(w.w * 100)} %${k ? `, ${Math.round(readiness(P, k, w.w) * 100)} % ready for the knot` : ''}, rectosigmoid junction ${Math.round(w.acc[1] * 100)} % ready${w.sig >= 0.01 ? `, sigmoid straightened ${Math.round(w.sig * 100)} %` : ''}${P.bends?.desc && w.acc[2] >= 0.005 ? `, descending colon's turn ${Math.round(w.acc[2] * 100)} % open` : ''}`;
  });
  const ownTip = $derived(`${char.name} is imported: Build and Anatomy do not apply`);
  const VIEW_OPTIONS = [{ value: 'top', label: 'Top' }, { value: 'front', label: 'Front' }, { value: 'side', label: 'Side' }, { value: 'quarter', label: '3/4' }];
  // every preset, for the "..." menu (the two from below live only there: the view buttons stay one short row)
  const VIEW_ALL = [...VIEW_OPTIONS, { value: 'below', label: 'Below (the belly)' }, { value: 'quarterBelow', label: '3/4 below' }];
  const pct = (x) => `${Math.round(x * 100)} %`;
  const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const ttrText = $derived(!ttr || ro.ready == null ? '' : ttr.ms === 0 ? 'ready now'
    : ttr.never ? 'too big for this ring even fully warmed up'
    : ttr.idle ? 'no stroking to repeat: start stroking to warm up'
    : ttr.ms === Infinity ? `this stroking levels off at ${pct(ttr.plateau)}`
    : `${fmtDuration(ttr.ms)} more of this stroking`);
  /** The last snap (physics.js summary snap): "Knot in: peak 38 lbf (169 N), snapped in at 310 mm/s." */
  const snapText = $derived(!ro.snap ? '' : `${ro.snap.kind === 'in' ? 'Knot in' : 'Pop'}: peak ${Math.round(nToLbf(ro.snap.peak))} lbf (${Math.round(ro.snap.peak)} N), ${ro.snap.kind === 'in' ? 'snapped in' : 'flew out'} at ${Math.round(ro.snap.speed)} mm/s.`);
  const timing = $derived(ro.ready == null ? '' : ro.pushing != null ? `Pushing the knot: ${sec(ro.pushing)} so far.`
    : ro.pulling != null ? `Pulling on the knot: ${sec(ro.pulling)} so far.`
    : ro.fail != null ? (!Number.isFinite(ro.fail) ? 'Last push failed: that push could never open the ring this far.' : ro.fail < 100 ? 'Last push failed by a hair: hold it deep a moment longer.' : `Last push failed: needed ${sec(ro.fail)} more held deep.`)
    : ro.popFail != null ? (!Number.isFinite(ro.popFail) ? 'Pop failed: that pull could never open the ring this far.' : ro.popFail < 100 ? 'Pop failed by a hair: hold it out a moment longer.' : `Pop failed: needed ${sec(ro.popFail)} more pulled out.`)
    : Number.isFinite(ro.lagIn) ? `Knot in ${sec(ro.lagIn)} after the push began${Number.isFinite(ro.lagOut) ? `; popped ${sec(ro.lagOut)} after the pull` : ''}.` : '');
  // the planner's verdict over the visible range: script points the machine cannot reach (the lane marks them too)
  const planNote = $derived.by(() => {
    const p = vMode === 'video' ? null : plannedOf(followOf(app).script);
    if (!p) return { text: '', tip: '' };
    const a = app.view.start, b = a + app.view.span, n = p.misses.filter((m) => m.at >= a && m.at <= b).length;
    return { text: n ? `${n} script ${n === 1 ? 'point' : 'points'} out of the machine's reach in view` : '',
      tip: `Plays the device planner's output: ${p.engine === 'kinetic' ? 'Kinetic2' : 'analytic model'}, ${rig.strokeMm} mm, ${app.devicePreview.profile?.name || 'device profile'}${n ? `\n${n} ${n === 1 ? 'point' : 'points'} in view trimmed over 2 units` : ''}` };
  });
  const machineText = $derived(Math.abs(liveForce.lag) > 0.5 ? `At the force limit (${forceLbf} lbf) · carriage ${Math.round(Math.abs(liveForce.lag))} mm behind the script` : '');
  // script against video: now, and over the visible range (both modes with video; nothing where it is not trusted)
  const videoText = $derived(vMode === 'script' ? '' : [!Number.isFinite(liveDepth.v) ? 'Video: no confident reading here' : `Video: ${diffText(liveDepth.ds - liveDepth.v, (x) => fmtLen(Math.round(x), units))}`,
    vsum ? `in view ${fmtLen(Math.round(vsum.meanAbs), units)} off on average, worst ${fmtLen(Math.round(Math.abs(vsum.worst)), units)}${vsum.reversals.length ? `, ${vsum.reversals.length} reversed` : ''}` : ''].filter(Boolean).join(' · '));
  const videoLong = $derived(vMode === 'script' ? '' : [
    `Depth from video: the tracked shaft's inserted share x this toy's usable length (${fmtLen(Math.round(usableLen), units)}), only where the reading is confident (SAM-measured, 50 %+)`,
    vMode === 'video' ? 'The Machine plays the video there and the script elsewhere; the device still gets the script' : 'The script drives; the video\'s depth is the orange bar on the stroke window and the dashed outline in the view',
    vsum ? `In view: script minus video ${fmtLen(Math.round(vsum.mean), units)} on average (${vsum.mean >= 0 ? 'the script deeper' : 'the script shallower'}), worst ${fmtLen(Math.round(Math.abs(vsum.worst)), units)} ${vsum.worst >= 0 ? 'deeper' : 'shallower'} at ${sec(vsum.worstAt)}${vsum.reversals.length ? `; the script runs against the video at ${vsum.reversals.slice(0, 4).map((r) => sec(r.t0)).join(', ')}${vsum.reversals.length > 4 ? '…' : ''}` : ''}` : 'In view: no confident reading',
  ].join('. '));
  /** The shaft's knot state beside the Machine's own, when they disagree (a knotted toy, video on). */
  const MK = { out: 'out', pressing: 'entrance', tied: 'in' };
  const vKnot = $derived(knot && liveDepth.vk && MK[liveDepth.mk] !== liveDepth.vk ? liveDepth.vk : '');
  /** The junction's readiness for this toy (0..1) from a depth summary. */
  const readyOf = (dp) => (!dp ? 0 : dp.rs.verdict === 'ready' ? 1 : Math.min(1, dp.acc[1] / Math.max(0.01, dp.need)));
  const depthReady = $derived(readyOf(ro.depth));
  /** The Experience control's tip (paw-hito: the bends' resistance is the person's, not fixed). */
  const expTip = $derived(`How experienced the receiver is (now ${EXPERIENCE[experience].label}): sets the tissue values below (size, tone, warm-up, give, gape) and how much the rectosigmoid turn (~${fmtLen(Math.round(P.bends?.rs ?? ANATOMY.rsJunction * bodyScale), units)}) and the descending colon's turn${P.bends?.desc ? ` (~${fmtLen(Math.round(P.bends.desc), units)})` : ''} resist, where their readiness starts and how fast they ready over a session. New: the toy slows or stalls at each bend and the colon takes most of a session to lie along it up the middle of the belly; Very: little resistance at either, and the colon lies along the toy almost from the start. The sliders below override it`);
  const bendName = (i) => (i === 2 ? 'descending colon' : i ? 'sigmoid' : 'first bend');
  const longBend = (i) => (i === 2 ? "descending colon's turn" : i ? 'rectosigmoid bend' : 'anorectal angle');
  /** Said wherever the slow states show (paw-qin8). */
  // The sigmoid's straightening and the descending colon's turn are the model's estimates from anatomy texts and one person's
  // measurement (the descending colon reached at 280-300 mm at 180 cm, varying with the toy). Dynamics behind the readouts:
  // the canal's internal sphincter relaxes over tens of seconds of stretch and its tone returns over minutes; the rectum's
  // ampulla relaxes within a minute and stays open for minutes; the junction opens over minutes of depth work and closes
  // faster than the rectum; the sigmoid is carried by the toy and straightens over minutes, easing back over tens of
  // minutes; the descending turn is usually fixed to the back wall and opens far less (more with Descending give).
  const ESTIMATE = 'Model estimate from anatomy texts, not a measurement';
  /** The descending colon's turn in words (physics.js depthSummary desc): ready / time / not with this toy. */
  const descWords = (x) => !x ? '' : x.verdict === 'ready' ? 'ready' : x.verdict === 'work' ? `~${fmtDuration(x.ms)} more depth work` : x.verdict === 'short' ? 'toy too short' : 'not with this toy';
  /** The depth map's bars (physics.js depthSummary map): 0..1 each, the junction with this toy's need as a tick. */
  const mapBars = $derived.by(() => {
    const m = ro.depth?.map || { canal: 0, rectum: 0, junction: 0, sigmoid: 0, need: null }, J = fmtLen(Math.round(P.bends?.rs ?? ANATOMY.rsJunction * bodyScale), units);
    return [
      { key: 'canal', label: 'canal', v: m.canal, tip: `Anal canal warmed up ${pct(m.canal)}` },
      { key: 'rectum', label: 'rectum', v: m.rectum, tip: `Rectum at ${pct(m.rectum)} of its readiness` },
      { key: 'junction', label: 'junction', v: m.junction, need: m.need, tip: `Rectosigmoid junction (${J}) at ${pct(m.junction)}${m.need != null ? `\nThis toy needs ${pct(Math.min(1, m.need))} (the tick)` : ''}` },
      { key: 'sigmoid', label: 'sigmoid', v: m.sigmoid, tip: `Sigmoid colon at ${pct(m.sigmoid)}, straightened ${pct(m.straight || 0)}\n${ESTIMATE}` },
      ...(m.desc != null ? [{ key: 'desc', label: 'descending', v: m.desc, need: m.descNeed, tip: `Descending colon turn at ${pct(m.desc)}${ro.depth?.desc ? `\nAt ${fmtLen(Math.round(ro.depth.desc.at), units)}, the tip gets ${fmtLen(Math.round(ro.depth.desc.reach), units)} in` : ''}${m.descNeed != null ? `\n${m.descNeed > 1 ? 'This toy cannot pass it' : `This toy needs ${pct(m.descNeed)} (the tick)`}` : ''}\n${ESTIMATE}` }] : []),
    ];
  });
  const depthText = $derived(!ro.depth ? '' : [
    // (the descending colon is fixed: a toy too stiff for its turn stops there, it never gives)
    stallText(ro.depth, bendName),
    `Depth: ${fmtLen(ro.depth.comfortable, units)}${ro.depth.why >= 0 ? ` · blocked at ${bendName(ro.depth.why)}` : ''}`,
    ro.depth.rs.verdict === 'ready' ? 'Sigmoid: ready' : ro.depth.rs.verdict === 'work' ? `Sigmoid: ~${fmtDuration(ro.depth.rs.ms)} more depth work`
      : ro.depth.rs.verdict === 'short' ? 'Sigmoid: toy too short' : 'Sigmoid: not with this firmness',
    ro.depth.sig >= 0.01 ? `straightened ${pct(ro.depth.sig)}` : '',
    ro.depth.carried >= 0.01 ? `along the toy ${pct(ro.depth.carried)}` : '',
    ro.depth.desc ? `Descending: ${descWords(ro.depth.desc)}, reach ${fmtLen(Math.round(ro.depth.desc.reach), units)}` : '',
  ].filter(Boolean).join(' · '));
  /** Spelled out for the tooltip. */
  const depthLong = $derived(!ro.depth ? '' : [
    ro.depth.forced ? `${stallText(ro.depth, longBend)}: the script pushes past what the tissue has given.` : ro.depth.blocked >= 0 ? `${stallText(ro.depth, longBend)}.` : '',
    `Comfortable depth now: ${fmtLen(ro.depth.comfortable, units)}${ro.depth.why === 0 ? ', blocked at the first bend (anorectal angle) until it opens' : ro.depth.why === 1 ? ', blocked at the rectosigmoid junction until it opens' : ro.depth.why === 2 ? ', where this toy meets the descending colon\'s turn' : ''}.`,
    ro.depth.rs.verdict === 'ready' ? 'Past the rectosigmoid bend: ready.' : ro.depth.rs.verdict === 'work' ? `Past the rectosigmoid bend: needs about ${fmtDuration(ro.depth.rs.ms)} more of depth work near it.`
      : ro.depth.rs.verdict === 'short' ? 'Past the rectosigmoid bend: not with this toy (too short).' : 'Past the rectosigmoid bend: not with this toy\'s firmness.',
    `The sigmoid is straightened ${pct(ro.depth.sig)} (its resting shape, lying forward with use; it eases back over tens of minutes left alone).`,
    `The gut lies along the toy ${pct(ro.depth.carried || 0)} of the way: the toy holds its own line by its stiffness and the mobile sigmoid and the descending colon's lower part are carried onto it, so a deep toy lies forward under the belly's front wall and the bulge runs up the midline. It comes with the sigmoid's straightening and the descending turn's opening; how soon is set by Experience.`,
    ro.depth.desc ? `Into the descending colon: ${ro.depth.desc.verdict === 'firm' ? 'not with this toy: too stiff for the turn it has left even at its most open' : descWords(ro.depth.desc)}; its turn ${pct(ro.depth.desc.acc / ro.depth.desc.ceil)} of what depth work can open; this toy's tip gets about ${fmtLen(Math.round(ro.depth.desc.reach), units)} into it, meeting it at ${fmtLen(Math.round(ro.depth.desc.at), units)}.` : '',
    ro.depth.desc || ro.depth.sig >= 0.01 ? ESTIMATE : '',
  ].filter(Boolean).join(' '));
  const depthSince = $derived(ro.depth?.since != null ? `Depth last worked ${fmtDuration(ro.depth.since)} ago${ro.depth.lost > 0.01 ? `, ${pct(ro.depth.lost)} of its readiness lost` : ''}.` : '');
  const readyText = $derived(ro.ready == null ? '' : ro.ready >= 1 ? (ro.readyFor === Infinity ? 'Ready.' : `Ready; stays ready ~${fmtDuration(ro.readyFor)} at rest.`) : ttrText ? `To take the knot again: ${ttrText}.` : 'Working out how long until the knot is ready...');
  const tiesText = $derived(ro.ties ? `${ro.ties} ${ro.ties === 1 ? 'tie' : 'ties'}${ro.since != null ? `; last ${fmtDuration(ro.since)} ago` : ''}${ro.lost > 0.005 ? `, ${pct(ro.lost)} readiness lost since` : ''}.` : '');
  /** The readout lines, always the same rows (blank when there is nothing to say), so the view keeps its size. */
  const op = $derived(ro.opening);
  const openingText = $derived(!op ? '' : [
    op.empty ? `Opening ${fmtLen(op.gape, units)}${op.closing ? ', closing' : ''}` : `Opening ${fmtLen(op.gape, units)} (${Math.round((100 * op.gape) / op.relaxed)} % of relaxed) · Rim ${Math.abs(op.xi) < 0.5 ? 'at rest' : op.xi > 0 ? `in ${fmtLen(op.xi, units)}` : `out ${fmtLen(-op.xi, units)}`}`,
    op.hiltF > 0.5 ? `hilt ${Math.round(nToLbf(op.hiltF))} lbf (${Math.round(op.hiltF)} N)${Math.abs(liveForce.lag) > 0.5 ? ' at the force limit' : ''}` : '',
    Math.abs(op.xb) >= 1 ? `body pushed ${fmtLen(Math.abs(op.xb), units)} ${op.xb > 0 ? 'away' : 'back'}` : '',
    bulgeMm >= 1 ? `bulge ${fmtLen(bulgeMm, units)}` : '',
  ].filter(Boolean).join(' · '));
  // prostate stimulation (paw-xdcy; physics.js PROSTATE: contact x (pressure and sliding), 0..1)
  const prosText = $derived(ro.pros == null ? '' : `Prostate: ${Math.round(100 * ro.pros)} %${ro.pros > 0.6 ? ', pressed' : ro.pros > 0.25 ? ', stroked' : ro.pros > 0.03 ? ', touched' : ''}`);
  const prosStats = $derived(P.prostate ? prostateStats(events, app.view.start, app.view.start + app.view.span) : null);
  const lines = $derived([
    { text: timing, tip: [timing, snapText].filter(Boolean).join(' ') },
    { text: depthText, bad: !!ro.depth?.forced, tip: [depthLong, depthSince].filter(Boolean).join(' ') },
    { text: [machineText, planNote.text, videoText].filter(Boolean).join(' · '), mut: true, tip: [machineText, planNote.tip, videoLong].filter(Boolean).join('. ') },
    { text: openingText, mut: true, tip: openingText ? `${openingText}\nOpening: ring width now against its relaxed size\nRim: how far it is drawn in or out with the toy\nBody: how far the body has given\nBulge: belly skin over the toy at its peak` : '' },
    { text: readyText, tip: [readyText, tiesText, 'Readiness: how warmed up the ring is for this knot'].filter(Boolean).join('\n') },
    { text: prosText, tip: 'Prostate stimulation: contact, pressure and slide speed\nEach spell is a bar on the timeline' },
    { text: statsText + (prosStats?.spells ? ` · Prostate: ${prosStats.spells} spells, ${sec(prosStats.ms)}, peak ${Math.round(100 * prosStats.peak)} %, mean ${Math.round(100 * prosStats.mean)} %` : ''), mut: true },
  ]);
  const limitText = $derived(stats.limit?.count ? ` · force limit ${sec(stats.limit.ms)}, up to ${Math.round(stats.limit.peak)} mm behind` : '');
  // in view: knots, then only the bends something happened at, then time at the force limit
  const bendsText = $derived((stats.bends || []).map((b, i) => (b.passed || b.stalled ? `${bendName(i)} ${[b.passed ? `${b.passed} passed${b.forced ? ` (${b.forced} forced)` : ''}` : '', b.stalled ? `${b.stalled} stalled` : ''].filter(Boolean).join(', ')}${Number.isFinite(b.lag) && b.lag >= 50 ? `, lag ${sec(b.lag)}` : ''}` : '')).filter(Boolean).join('; '));
  const statsText = $derived((stats.attempts || stats.pops ? `Knots: ${stats.attempts} tried, ${stats.taken} taken, ${stats.failed} failed${Number.isFinite(stats.lagIn) ? `, lag ${sec(stats.lagIn)}` : ''}${stats.pops ? `; ${stats.pops} pops${Number.isFinite(stats.lagOut) ? ` (${sec(stats.lagOut)})` : ''}` : ''}` : 'Knots: none in view') + (bendsText ? ` · Bends: ${bendsText}` : '') + limitText);
  /** The collapsed readouts: the knot badge and readiness stay; the one status that matters most. */
  const shortStatus = $derived(ro.depth?.forced ? `forcing ${bendName(ro.depth.blocked)}` : Math.abs(liveForce.lag) > 0.5 ? 'at force limit'
    : ro.depth?.fixedStop ? 'too stiff for the descending colon' : ro.depth?.blocked >= 0 ? `stalled at ${bendName(ro.depth.blocked)}` : ro.depth?.why === 0 || ro.depth?.why === 1 ? `blocked at ${bendName(ro.depth.why)}` : '');
  const roOpen = $derived(get('machine.readouts', true) !== false);
  let more = $state(false), moreAnchor = $state(null);
  const moreItems = $derived([
    { label: 'View', items: VIEW_ALL.map((o) => ({ label: o.label, type: 'radio', checked: viewName === o.value, run: () => setView(o.value) })) },
    // a layered model (the Human): its layers, and how opaque the skin stays over the inner ones
    ...(layerList.length ? [{ label: 'Body layers…', icon: 'layers', run: () => { layersOpen = true; } }] : []),
    { separator: true },
    { label: 'Turn the toy 90°', icon: 'refresh', run: () => saveRoll(toyRoll + Math.PI / 2) },
    { label: 'Flip the toy 180°', icon: 'flip', run: () => saveRoll(toyRoll + Math.PI) },
    ...(themes.length > 1 ? [{ separator: true }, { label: 'Colorway', items: themes.map((t) => ({ label: t.name, type: 'radio', checked: t.name === theme?.name, run: () => setTheme(t.name) })) }] : []),
    { separator: true },
    { label: 'Import a toy from a picture…', icon: 'import', run: () => (importing = true) },
    { separator: true },
    { label: 'Knot events on the timeline', type: 'checkbox', checked: get('machine.laneEvents', false) === true, run: () => S.set('machine.laneEvents', !laneEventsOn(app)) },
    ...(prostateNow ? [{ label: 'Track prostate stimulation', type: 'checkbox', checked: prostateOn, run: () => S.set('machine.prostate', !prostateOn) }] : []),
  ]);
</script>

<!-- the mode switch, in either mode's bar: words, icons only in a narrow panel (the bar stays one row) -->
{#snippet modeSwitch(narrow = false)}
  <Prop {app} key="machine.mode" label="Mode" options={MODES} value={mode} iconOnly={narrow} />
{/snippet}
{#if mode === 'stroker'}
<StrokerView {app} {modeSwitch} />
{:else}
<div class="mc kit-root" bind:this={root}>
  <div class="bar" bind:clientWidth={barW}>
    {@render modeSwitch(barW > 0 && barW < 480)}
    <Select size="sm" label="Character" options={charOptions} value={char.id} onchange={setChar} />
    {#if entry.sizes.length}
      <Select size="sm" label="Size" options={entry.sizes} value={sizeValue} onchange={(v) => S.set('machine.size', v)} />
    {/if}
    <span class="tp" {@attach tooltip(`${toy.name}: ${Math.round(toy.length_mm)} mm${toy.usable_mm ? `, ${Math.round(toy.usable_mm)} mm usable` : ''}${knot ? `, knot ${Math.round(knot.radius * 2)} mm wide` : ''}`)}>
      <ToyPicker {list} current={entry} onpick={pick} onremove={removeCustom} />
    </span>
    <span class="grow"></span>
    <IconButton size="sm" icon="more" label="View (also from below), toy: turn, flip (kept for this toy; double-click the toy for its default), colourway, import" aria-haspopup="menu"
      onclick={(e) => { moreAnchor = e.currentTarget; more = !more; }} />
    <Menu bind:open={more} anchor={moreAnchor} placement="bottom-end" items={moreItems} label="View and toy" />
    <!-- a layered model's layers: one row each, a click on the name switches it off or back to its last opacity -->
    <Popover bind:open={layersOpen} anchor={moreAnchor} placement="bottom-end" title="Body layers" class="mc-layers">
      <div class="lyr">
        {#each layerList as l (l.id)}
          <button type="button" class="ln" class:off={!(layerOp[l.id] > 0)} onclick={() => S.set('machine.layers', flipLayer(layerSet, l.id, layerOp[l.id]))}
            {@attach tooltip(`${l.name}: click to ${layerOp[l.id] > 0 ? 'hide' : 'show'}${l.id === 'skin' ? '\nSee-through while an inner layer shows' : ''}`)}>{l.name}</button>
          <Slider size="sm" full label="{l.name} opacity" min={0} max={100} step={5} value={Math.round((layerOp[l.id] || 0) * 100)} showValue format={(v) => (v ? `${v} %` : 'off')}
            onchange={(v) => S.set('machine.layers', setOpacity(layerSet, l.id, v / 100))} />
        {/each}
      </div>
      <Button size="sm" icon="refresh" onclick={() => S.set('machine.layers', {})} tip="Defaults: skin see-through over the skeleton">Reset</Button>
    </Popover>
  </div>
  <div class="viewrow">
  <StrokeWindow {toy} {knot} {rig} over={P.overMax} d={liveDepth.d} dc={liveDepth.dc} src={vtrack ? vMode : null} v={liveDepth.v} onsrc={(x) => S.set('machine.depthSrc', x)} onhilt={saveHilt} onpreview={(r) => (dragRig = r)} onchange={(r) => { S.set('machine.rig', r); dragRig = null; }}
    onreset={() => { S.set('machine.rig', {}); dragRig = null; }} />
  <div class="stage" bind:this={stage} {@attach sized} {@attach onScreen}>
    {#if !use2D}
      <canvas class="gl" bind:this={cv} aria-hidden="true"></canvas>
      <canvas class="ov" bind:this={ov} aria-label="Machine view: {toy.name}, {ro.label}" data-hover={hover || undefined} {@attach wheel}
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} ondblclick={dbl} onpointerleave={() => { if (!drag) hover = null; }}></canvas>
      <div class="views">
        <SegmentedControl size="sm" label="View" options={VIEW_OPTIONS} value={viewName} onchange={setView} />
        <ToggleButton size="sm" icon="layers" label="Cutaway: slice the body along the axis to see the toy inside" pressed={cut} onchange={(p) => setCut(p)} />
      </div>
    {:else}
      <canvas class="gl" bind:this={cv2} aria-label="Machine view: {toy.name}, {ro.label}" data-hover={hover || undefined}
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => { if (!drag) hover = null; }}></canvas>
    {/if}
    {#if use2D && why2D}<div class="why2d">{why2D}. Showing the flat drawing.</div>{/if}
    {#if importing}<ToyImport {app} onsave={saveImported} oncancel={() => (importing = false)} />{/if}
  </div>
  </div>
  <!-- the readouts (event strip + fixed rows): the view changes size only when the owner folds them, never with content
       (one line each, full text in the tooltip; folded, the head keeps the badge, readiness and one short status) -->
  <Section title="Readouts" class="ros" open={roOpen} onchange={(o) => S.set('machine.readouts', o)} actionsVisible="always">
    {#snippet actions()}
      {#if !roOpen}<span class="rosum k-num"><Badge tone={ro.tone}>{ro.label}</Badge><span>ready {ro.ready != null ? pct(ro.ready) : '–'}</span><span class="st" class:forcing={!!ro.depth?.forced}>{shortStatus}</span></span>{/if}
    {/snippet}
  <div class="evs" class:stale={evStale || simStale} {@attach stripSized}><canvas bind:this={strip} style:height="64px" aria-label={statsText}></canvas></div>
  <div class="ro" class:stale={simStale}>
    <div class="row">
      <Badge tone={ro.tone}>{ro.label}</Badge>
      {#if vKnot}<span class="vk" {@attach tooltip(`The video says the knot is ${vKnot === 'entrance' ? 'at the entrance' : vKnot}, the Machine has it ${MK[liveDepth.mk] === 'entrance' ? 'at the entrance' : MK[liveDepth.mk]}`)}>video: {vKnot}</span>{/if}
      <span class="k">ready</span>
      <ProgressBar class="rb" value={ro.ready ?? 0} tone={ro.ready >= 1 ? 'ok' : 'accent'} aria-label="Readiness for the knot" />
      <span class="v k-num">{ro.ready != null ? pct(ro.ready) : '–'}</span>
    </div>
    <!-- the depth map: four small bars along the path (canal · rectum · junction · sigmoid), in the row the single
         depth bar had (the readouts keep their height); the number is the junction's readiness for this toy -->
    <div class="row">
      <span class="k">depth</span>
      <span class="dmap" role="img" aria-label={mapBars.map((b) => b.tip).join(' ')}>
        {#each mapBars as b (b.key)}
          <span class="db" {@attach tooltip(b.tip)}>
            <span class="dl">{b.label}</span><span class="ds" aria-hidden="true">{b.label[0]}</span>
            <span class="dt"><span class="df" style:width="{Math.round(Math.min(1, b.v) * 100)}%"></span>{#if b.need != null}<span class="dn" style:left="{Math.round(Math.min(1, b.need) * 100)}%"></span>{/if}</span>
          </span>
        {/each}
      </span>
      <span class="v k-num" class:okv={ro.depth?.rs.verdict === 'ready'} {@attach tooltip(ro.depth ? `Rectosigmoid junction at ${pct(depthReady)} of what this toy needs\n${depthLong}` : 'Depth readiness: the internal path is off')}>{ro.depth ? pct(depthReady) : '–'}</span>
    </div>
    <div class="row" {@attach tooltip(`Axial force through the toy: ${Math.round(Math.abs(liveForce.F))} N now (${liveForce.F >= 0 ? 'push' : 'pull'}), peak ${Math.round(liveForce.peak)} N over the last 3 s; the ${machine.name} limit is ${forceLbf} lbf (${Math.round(lbfToN(forceLbf))} N)`)}>
      <span class="k">force</span>
      <span class="fg" aria-hidden="true">
        <span class="fill" class:pull={liveForce.F < 0} class:cap={Math.abs(liveForce.lag) > 0.5} style:width="{Math.min(100, (Math.abs(liveForce.F) / lbfToN(forceLbf)) * 100)}%"></span>
        <span class="peak" style:left="{Math.min(100, (liveForce.peak / lbfToN(forceLbf)) * 100)}%"></span>
      </span>
      <span class="v k-num fv">{Math.round(nToLbf(Math.abs(liveForce.F)))}/{forceLbf} lbf</span>
    </div>
    {#each lines as l, i (i)}
      <div class="line" class:mut={l.mut} class:forcing={l.bad} {@attach tooltip(l.tip || l.text || '')}>{l.text || ' '}</div>
    {/each}
  </div>
  </Section>
  <Section title="Tuning" open={false}>
    <div class="tune">
      <span class="tl" {@attach tooltip('Machine thrust limit: past it the carriage falls behind')}>Machine</span>
      <Prop {app} key="machine.machine" full label="Machine" options={MACHINES.map((m) => ({ value: m.id, label: m.forceLbf ? `${m.name} (${m.forceLbf} lbf)` : m.name }))} value={machine.id} oncommit={() => S.set('machine.forceLbf', null)} />
      <span class="tl" {@attach tooltip('Thrust limit: pounds-force, newtons alongside')}>Force limit</span>
      <Prop {app} key="machine.forceLbf" slider full label="Force limit" min={FORCE_RANGE_LBF[0]} max={FORCE_RANGE_LBF[1]} value={forceLbf} default={machine.forceLbf ?? 60} format={(v) => `${v} lbf (${Math.round(lbfToN(v))} N)`}
        store={(v) => (machine.forceLbf && Math.abs(v - machine.forceLbf) <= 2 ? null : Math.round(v))} onpreview={preview('machine.forceLbf')} oncommit={clearDraft} />
      <span class="tl" {@attach tooltip('Toy firmness: softer toys compress and their knots lag more')}>Toy</span>
      <Select size="sm" full label="Toy firmness" options={firmOptions.map((c) => ({ value: c, label: firmnessLabel(c) }))} value={firmness} onchange={setFirmness} />
      <span class="tl" {@attach tooltip(expTip)}>Experience</span>
      <Prop {app} key="machine.experience" expand full label="Experience" tip={expTip} options={EXPERIENCE_LEVELS.map((k) => ({ value: k, label: EXPERIENCE[k].short }))} value={experience} />
      <span class="tl" {@attach tooltip(warmTip)}>Warmed start</span>
      <Prop {app} key="machine.warmup" expand full label="Warmed start" tip={warmTip} value={warmup} />
      {#each TUNABLE as p (p.key)}
        <span class="tl" {@attach tooltip(p.tip)}>{p.label}</span>
        <Slider size="sm" full label={p.label} min={p.min} max={p.max} step={p.step} value={P[p.key]} default={preset[p.key]} showValue format={p.fmt} onchange={(v) => setParam(p.key, v)} oncommit={commit} />
      {/each}
      <span class="tl" {@attach tooltip(`Receiver height, the body and anatomy scale with it${meshId ? `\n${char.name}'s own height: about ${char.body.height} cm` : ''}`)}>Height</span>
      <Prop {app} key="machine.height" slider full label="Height" min={HEIGHT[0]} max={HEIGHT[1]} value={height} default={Math.max(HEIGHT[0], Math.min(HEIGHT[1], char.body?.height ?? 175))} format={(v) => `${Math.round(v)} cm (${ftIn(v)})`}
        store={(v) => Math.round(v)} onpreview={preview('machine.height')} oncommit={clearDraft} />
      <span class="tl" {@attach tooltip(`Entry angle into ${char.name}: + toward the back, - the belly`)}>Entry angle</span>
      <span class="own" ondblclick={() => setFit('pitch', 0)} role="presentation"><Slider size="sm" full label="Entry angle" min={-25} max={25} step={0.5} value={pitchDeg} default={0} showValue format={(v) => `${v > 0 ? '+' : ''}${v}°`} onchange={(v) => setFit('pitch', v)} /></span>
      <span class="tl" {@attach tooltip(meshId ? ownTip : 'Body build, slim to chubby')}>Build</span>
      <Prop {app} key="machine.weight" slider full label="Build" tip={meshId ? ownTip : 'Body build, slim to chubby'} value={weight} disabled={!!meshId} format={(v) => (meshId ? 'Model' : v < 0.15 ? 'Slim' : v < 0.4 ? 'Lean' : v < 0.7 ? 'Average' : 'Chubby')}
        onpreview={preview('machine.weight')} oncommit={clearDraft} />
      <span class="tl" {@attach tooltip(meshId ? ownTip : 'Between the thighs: schematic male genitals or smooth')}>Anatomy</span>
      <Prop {app} key="machine.genitals" full label="Anatomy" tip={meshId ? ownTip : 'Between the thighs: schematic male genitals or smooth'} value={genitals} disabled={!!meshId} />
      <span class="tl" {@attach tooltip(BODY_GIVE.tip)}>{BODY_GIVE.label}</span>
      <Prop {app} key="machine.bodyGive" slider full label={BODY_GIVE.label} min={BODY_GIVE.min} max={BODY_GIVE.max} step={BODY_GIVE.step} value={bodyGive} format={BODY_GIVE.fmt} onpreview={preview('machine.bodyGive')} oncommit={clearDraft} />
      <span class="tl" {@attach tooltip('Units for lengths in the view and the readouts')}>Units</span>
      <Prop {app} key="machine.units" full label="Units" value={units} />
    </div>
    <div class="acts">
      <Button size="sm" icon="refresh" onclick={() => { S.set('machine.params', {}); S.set('machine.forceLbf', null); }} disabled={!Object.keys(overrides).length && get('machine.forceLbf', null) == null} tip="Back to the {EXPERIENCE[experience].label} preset and the {machine.name}'s force limit">Reset to preset</Button>
    </div>
    <Section title="Calibration" open={false}>
      <div class="tune">
        {#each CALIBRATION as p (p.key)}
          <span class="tl" {@attach tooltip(p.tip)}>{p.label}</span>
          <Slider size="sm" full label={p.label} min={p.min} max={p.max} step={p.step} value={P[p.key]} default={preset[p.key]} showValue format={p.fmt} onchange={(v) => setParam(p.key, v)} oncommit={commit} />
        {/each}
        {#if meshId}
          {#each FIT as f (f.key)}
            <span class="tl" {@attach tooltip(f.tip(char.name))}>{f.label}</span>
            <Slider size="sm" full label={f.label} min={f.min} max={f.max} step={0.5} value={bodyFit[f.key] || 0} default={0} showValue format={f.fmt} onchange={(v) => setFit(f.key, v)} />
          {/each}
        {/if}
      </div>
      {#if meshId}<p class="k-hint">{char.name}'s opening was found from the model; the last two sliders move it (saved for {char.name}; 0 is the fit). The toy's angle is Entry angle, above.</p>{/if}
      <p class="k-hint">The force and time scales, for matching what real toys and bodies do. Saved with the tuning; Reset to preset clears them.</p>
    </Section>
    <p class="k-hint">Typical adult anatomy (to scale, large individual variation) and plausible dynamics for planning scripts and scenes: not a measurement of any body and not guidance on what is safe for a person. Fantasy characters reuse the human-derived path, scaled. A plausible design aid, not a measurement of any real toy or body: a silicone toy that compresses, squashes and bends no tighter than it can, a canal whose two sphincters yield at a finite rate, recoil fast, relax slowly and gape for a while, an opening dragged along by friction, a body that gives. The state at the playhead is integrated over the script before it. The built-in bodies are crude placeholder limbs. With use the sigmoid straightens toward the front and the descending colon's turn (the Human) opens a little: estimates from anatomy texts and one person's measurement.</p>
    {#if meshId === 'human'}<p class="k-hint">Human: derived from BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan, and Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0 (Kousaku OKUBO, Gauthier KERVYN, Marcin ZIELINSKI, Lluis VINENT); posed, head removed, kidneys replaced by generated shapes, reduced; this mesh is CC-BY-SA 4.0.</p>{/if}
  </Section>
</div>
{/if}

<style>
  .mc { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .bar { flex: none; display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); flex-wrap: nowrap; min-width: 0; overflow: hidden; }
  .bar > :global(*) { flex: none; }
  /* the toy picker gives way first (its name ellipsises), the selects keep their width */
  .bar > .tp { flex: 0 1 auto; min-width: 48px; display: flex; }
  .bar > .tp > :global(*) { min-width: 0; max-width: 100%; }
  :global(.mc .ros) { flex: none; border-top: var(--bw) solid var(--line-1); }
  .rosum { display: flex; align-items: center; gap: var(--space-3); font-size: var(--fs-2); color: var(--tx-val); white-space: nowrap; overflow: hidden; min-width: 0; }
  .rosum .st { color: var(--tx-mut); overflow: hidden; text-overflow: ellipsis; }
  .rosum .st.forcing { color: var(--bad-ink); }
  .grow { flex: 1; }
  .lyr { display: grid; grid-template-columns: max-content minmax(140px, 1fr); gap: var(--space-2) var(--space-4); align-items: center; margin-bottom: var(--space-3); }
  .lyr .ln { all: unset; cursor: pointer; font-size: var(--fs-2); color: var(--tx); white-space: nowrap; }
  .lyr .ln.off { color: var(--tx-mut); text-decoration: line-through; }
  .lyr .ln:focus-visible { outline: var(--focus-ring, 2px solid var(--accent)); }
  .viewrow { flex: 1; min-height: 180px; display: flex; }
  .stage { flex: 1; min-width: 0; position: relative; }
  .gl, .ov { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  .ov { cursor: grab; }
  .ov[data-hover] { cursor: ns-resize; }
  /* held inside the stage (right too): in a narrow panel the view buttons shrink instead of widening the panel body (a
     horizontal scroll bar) */
  .views { position: absolute; top: var(--space-2); left: var(--space-2); right: var(--space-2); display: flex; gap: var(--space-1); align-items: center; min-width: 0; pointer-events: none; }
  .views > :global(*) { pointer-events: auto; }
  .views > :global(.k-segmented-control) { min-width: 0; }
  .evs { flex: none; }
  .evs canvas { display: block; width: 100%; }
  .evs.stale, .ro.stale { opacity: 0.55; }   /* paw-mnd8: from an approximate state / older inputs while the new ones are worked out */
  .ro { flex: none; display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); border-top: var(--bw) solid var(--line-1); font-size: var(--fs-2); }
  .row { display: flex; align-items: center; gap: var(--space-3); }
  .row :global(.rb) { flex: 1; min-width: 40px; }
  .ro { container-type: inline-size; }
  .dmap { flex: 1; min-width: 40px; display: flex; gap: var(--space-2); }
  .db { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); }
  .dl { flex: 0 1 auto; min-width: 0; font-size: var(--fs-1); color: var(--tx-mut); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dt { flex: 1 0 10px; height: 6px; border-radius: var(--radius-pill); background: var(--line-2); position: relative; overflow: hidden; }
  .df { position: absolute; left: 0; top: 0; bottom: 0; background: var(--series-sky); border-radius: var(--radius-pill); }
  .dn { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--tx-val); }
  .okv { color: var(--ok-ink); }
  .ds { display: none; font-size: var(--fs-1); color: var(--tx-mut); }
  @container (max-width: 400px) { .dl { display: none; } .ds { display: inline; } }   /* narrow: c · r · j · s */
  .row :global(.k-badge) { min-width: 78px; justify-content: center; }
  .vk { font-size: var(--fs-1); color: var(--series-orange); white-space: nowrap; }
  .fg { flex: 1; min-width: 40px; height: 6px; border-radius: var(--radius-pill); background: var(--bg-sunken); position: relative; overflow: hidden; }
  .fg .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--tx-mut); border-radius: var(--radius-pill); }
  .fg .fill.pull { background: var(--info); }
  .fg .fill.cap { background: var(--tx); }
  .fg .peak { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--tx-val); }
  .fv { min-width: 10ch; }
  .k { color: var(--tx-mut); font-size: var(--fs-1); text-transform: uppercase; letter-spacing: var(--caps-track); }
  .v { color: var(--tx-val); min-width: 4ch; text-align: right; }
  .line { color: var(--tx); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; line-height: 1.35; }
  .line.forcing { color: var(--bad-ink); }
  .ro { font-variant-numeric: tabular-nums; }
  .why2d { position: absolute; left: 8px; bottom: 8px; right: 8px; color: var(--warn-ink); font-size: var(--fs-1); pointer-events: none; }
  .mut { color: var(--tx-mut); }
  .tune { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); align-items: center; padding: var(--space-2) var(--space-3); }
  .tl { font-size: var(--fs-2); color: var(--tx-mut); white-space: nowrap; }
  .own { display: block; min-width: 0; }
  .acts { padding: 0 var(--space-3); }
  .k-hint { padding: var(--space-2) var(--space-3) var(--space-3); margin: 0; }
</style>
