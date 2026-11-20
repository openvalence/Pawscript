<script>
  // The Groups tool on the video (paw-kkb, reworked paw-1mo): a soft brush paints one mask per group on the take's
  // frame, the polygon fitted to each mask (groups.js fitPoly, live while painting) is what Track sends. Registers a
  // drawer and a pointer tool on app.player.overlays (features/video); without that layer it shows nothing.
  // Paint first, assign after: a stroke that starts on a group adds to it, elsewhere it makes a new unassigned group
  // ('? 1', neutral); Ctrl+drag always makes a new one (a part over another); Shift erases (the group under the
  // pointer, else the active one). Assign with the picker (A or right click on a group; "Assign all" walks the
  // unassigned ones; its Ignore toggle makes the group an ignore region), by dragging a part off the picker's figure onto
  // a group, or a group's label (on the video or in the list) onto another group (they trade). paw-i5qx: no palette to arm
  // parts from; "the next stroke paints X" (a modifier's seed, the labelling queue, V, Shift+click on a list row) is state
  // shown as one chip beside the bar. Alt+click picks the group under the pointer (again: the next one under it);
  // G / S grab / scale the active group (click or Enter keeps, Esc or right click cancels); X / Delete deletes it.
  // Drawn: masks tinted in their group's colour (what was painted), the fitted outline on top (what is tracked), a
  // name chip, patches the polygon leaves out dashed grey; the brush ring on a cursor canvas of its own (drawn right in
  // the pointer event, never waiting on the video's overlays): its middle circle is exactly where a stroke's edge lands,
  // the faint inner / outer ones the soft falloff, and what the stroke will do next to it. paw-o60v.6: a stroke in
  // progress is drawn on a stroke canvas of its own (its paint once a frame; its outline when the pen rests and at pen
  // up); the overlay leaves that group out meanwhile and is not repainted per move. paw-i5qx: the tool's controls are one
  // slim translucent column of icons over the stage's left edge (taking no room: the picture never moves when the tool
  // opens, paw-trjh), faded and click-through while a stroke is in progress. Top to bottom: fold, keys (i), erase,
  // circle, grow, knot, brush size, magnet, who, Suggest, accept all, Copy from…, the groups (a popover: rows, hover
  // lights the group on the video and back, the unassigned folded into one line, Assign all, suggestions), notes (where
  // the groups are when off their frame, repeats, patches: a card beside the bar, open by itself off the frame), options
  // (ask after a stroke, fill, points, margin, seeder), close. The key list is behind the (i); no standing hint line.
  // The tool closes when a track job starts (the stroke in progress kept); unassigned groups in range: a warning toast.
  // Suggest (v4.18): each suggestion's confidence is a bar under its chip and in the list (tentative ones dashed and
  // faint); ✓ accepts one (Enter: all), ✕ deletes it, a repaint / reassign fixes it: then it is painted like any other.
  // The seeder row says what the learned head was trained on (Retrain: now); Suggest may pick another frame of the
  // take's first 2 s (most confident parts): the toolbar says so and offers Go there (never a seek of its own).
  // Repeats (paw-8mf4): a take without groups is filled from a matching frame elsewhere when it is selected (the toolbar
  // says from where, Drop removes them; the "auto" box turns it off, then "Use groups from" does it); a take without
  // groups shows its best frame to paint (most empty takes its repeats would fill), also marked on the ruler.
  import { untrack } from 'svelte';
  import { groupsRoom, pictureTarget } from './groups-room.js';
  import { leaves } from '../../app/areas.js';
  import { groupsFor, BRUSH, repeatCopyAt, copyGroupsToRepeats, twinGroupsAt, useTwinGroups, autoFill, dropFill, bestPaintMark } from './groups.svelte.js';
  import { repeatsOf } from '../timeline/repeats.svelte.js';
  import { trackingFor } from './tracking.svelte.js';
  import { PAIRED, WHOS, whoName, whoShort, nextWho, SOFT, partLabel, partWord, splitName, takeGroups, groupsShownAt, polyArea, isUnassigned, unassignedIn, canPulse, isPulse, canShaft, isShaft, canDepth, isDepth, isSuggested, isCopy, confidenceOf, isTentative, shownLine, youngNote, WHO_GATE, isIgnore, dockRows } from './groups.js';
  import { veilPixels } from './ignore-veil.js';
  import { shortTag, sharedWho, dropWho, LABEL_MODE_NAMES } from './group-labels.js';
  import { maskStats, chainDirs, hatchOf, ditherOf, ditherOn, ditherGeom, busyCells, fitLabel, readable, labelTone, DASH, FILL_NAMES } from './group-look.js';
  import { groupTarget } from './commands.js';
  import { shotLabel, sceneRange } from '../timeline/shots.js';
  import { modLabel } from '../timeline/mods.js';
  import { ARM } from '../timeline/mod-runs.js';
  /** 'scene 3' or 'shot 3.2' (scenes contain shots): where the tool paints. */
  // paw-ef73.29: painting a modifier's own seed: the toolbar says whose seed it is and the hint names the part asked for
  const modM = $derived(G.mod ? G.modObj : null);
  const modClock = (t) => { const s = Math.round(t / 100) / 10; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
  const modTitle = $derived(modM ? `Seed · ${modLabel(modM.kind)} ${modClock(modM.t0)}–${modClock(modM.t1)}` : '');
  const modPart = (a) => `${a[0] === 'c1' ? 'Bottom' : 'Top'} ${partLabel(a.join('_'))}`;
  const modHint = () => { if (!modM) return ''; const arm = ARM[modM.kind] || []; return `${modTitle}: ${arm.length ? `paint ${arm.map(modPart).join(' + ')}` : 'paint the part'} · `; };
  const shotLabelOf = (l, i) => { const r = sceneRange(l, i); return r && r[1] > r[0] ? `shot ${shotLabel(l, i)}` : `scene ${shotLabel(l, i)}`; };
  import { proposedName, guessText, sureWho, sideText } from './autoname.js';
  import { groupColor, groupPaint, knotPaint, whoColor, paint as tok } from './colors.js';
  import { rasterPoly } from './groups.js';
  import { sceneIndexAt } from '../timeline/scenes.js';
  import { groupShare } from './parts-first.js';
  import { frameAt, gridOf } from '../../lib/lane.js';
  import { scoreLine, scoreChange, scoreTip, weakestLine, featuresLine, outlineNote, overviewLine, crossLine } from './seed-score.js';
  import { pathPoly } from '../video/overlays.svelte.js';
  import { plate } from './plate.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import Button from '../../ui/kit/Button.svelte';
  import IconButton from '../../ui/kit/IconButton.svelte';
  import Slider from '../../ui/kit/Slider.svelte';
  import Checkbox from '../../ui/kit/Checkbox.svelte';
  import Icon from '../../ui/kit/Icon.svelte';
  import Spinner from '../../ui/kit/Spinner.svelte';
  import Popover from '../../ui/kit/Popover.svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import Prop from '../../app/Prop.svelte';
  import GroupsPicker from './GroupsPicker.svelte';
  import CopyStrip from './CopyStrip.svelte';
  import { driver } from './anim.js';

  let { app } = $props();
  // svelte-ignore state_referenced_locally
  const G = groupsFor(app), tr = trackingFor(app);
  // svelte-ignore state_referenced_locally
  const layer = app.player.overlays || null;
  let themeTick = $state(0);
  $effect(() => onThemeChange(() => { themeTick++; layer?.invalidate(); }));
  const key = (id) => app.commands?.keysFor?.(id)?.[0] || '';
  const PLATE = 'rgba(8, 9, 11, .82)';

  // ---- tinted masks: one small canvas per mask array, repainted when the array (or the live one: its version) changes ----
  // paw-c1m1: three kinds per mask: the soft tint (gradient: the mask's own falloff, as before), an even one (flat: hard edge) and
  // the hatch's stencil (alpha: where the lines go, the edge pulled in a little so touching parts keep a seam between their lines)
  const smooth = (a, lo, hi) => { const t = Math.min(1, Math.max(0, (a - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const KIND = { gradient: { map: new WeakMap(), al: (a) => a * 110 }, flat: { map: new WeakMap(), al: (a) => smooth(a, 0.4, 0.6) * 110 }, alpha: { map: new WeakMap(), al: (a) => smooth(a, 0.6, 0.85) * 255 } };
  /** ver: a live mask's version (it changes in place: repainted when ver differs), -1 for a stored one. */
  function tint(m, color, ver = -1, kind = 'gradient') {
    const K = KIND[kind];
    let c = K.map.get(m.a);
    if (!c) { const cv = document.createElement('canvas'); cv.width = m.w; cv.height = m.h; c = { cv, color: '', ver: -2 }; K.map.set(m.a, c); }
    if (c.color !== color || (ver >= 0 && c.ver !== ver)) {
      const g = c.cv.getContext('2d'), img = g.createImageData(m.w, m.h), d = img.data;
      const h = /^#?([0-9a-f]{6})$/i.exec(color)?.[1], rgb = h ? [0, 8, 16].map((s) => (parseInt(h, 16) >> (16 - s)) & 255) : (color.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number);
      for (let i = 0; i < m.a.length; i++) { const k = i * 4; d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = Math.round(K.al(m.a[i])); }
      g.putImageData(img, 0, 0);
      c.color = color; c.ver = ver;
    }
    return c.cv;
  }
  /** mask px -> stage px (zoom, pan, rotation, flips) on ctx. */
  const maskXf = (ctx, env, m) => { const [x0, y0] = env.map(0, 0), [x1, y1] = env.map(1, 0), [x2, y2] = env.map(0, 1); ctx.transform((x1 - x0) / m.w, (y1 - y0) / m.w, (x2 - x0) / m.h, (y2 - y0) / m.h, x0, y0); };
  function drawMask(ctx, env, m, color, ver = -1, kind = 'gradient') {
    ctx.save();
    maskXf(ctx, env, m);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tint(m, color, ver, kind), 0, 0);
    ctx.restore();
  }
  // ---- paw-c1m1: the parts' look (setting tracking.groups.fill; group-look.js): hatch / gradient / flat ----
  const fillStyle = $derived(app.settings?.get?.('tracking.groups.fill') ?? 'dither');
  const dCell = $derived(app.settings?.get?.('tracking.groups.ditherCell') ?? 4), dDot = $derived(app.settings?.get?.('tracking.groups.ditherDot') ?? 100), dAlpha = $derived(app.settings?.get?.('tracking.groups.ditherOpacity') ?? 92);
  const statsMemo = new WeakMap();   // Float32Array -> {ver, st}: maskStats per mask (once per stored mask; a live one per change)
  const statsOf = (m, ver = -1) => { let c = statsMemo.get(m.a); if (!c || (ver >= 0 && c.ver !== ver)) { c = { ver, st: maskStats(m) }; statsMemo.set(m.a, c); } return c.st; };
  const polyMasks = new WeakMap();   // poly -> a coarse mask of it, for its label's spot (the take's groups seeded elsewhere: only an outline here, a tracked one new each frame)
  const polyMask = (poly) => { let m = polyMasks.get(poly); if (!m) { const s = G.size; m = rasterPoly(poly, { w: 96, h: Math.max(8, Math.round((96 * s.h) / s.w)) }); polyMasks.set(poly, m); } return m; };
  const HATCH_BASE = 0.5, RAMP_END = 0.3;   // hatch: the plain tint under the lines (share of the gradient's); the lines' alpha at the far end
  const tiles = new Map();   // `${hatch key}|${colour}|${dpr}` -> one tile of the pattern (lines along x; the pattern is turned per part)
  function hatchTile(h, color, dpr) {
    const key = `${h.key}|${color}|${dpr}`;
    let t = tiles.get(key);
    if (t) return t;
    const P = h.dash ? Math.max(h.spacing, DASH[0] + DASH[1]) : h.spacing, on = h.dash ? Math.round(P * DASH[0] / (DASH[0] + DASH[1])) : P;
    const W = h.dots || h.cross ? P : h.dash ? P : 8, H = h.dots || h.cross ? P : h.spacing;
    t = document.createElement('canvas'); t.width = Math.max(1, Math.round(W * dpr)); t.height = Math.max(1, Math.round(H * dpr));
    const g = t.getContext('2d');
    g.scale(t.width / W, t.height / H); g.fillStyle = color;
    if (h.dots) { g.beginPath(); g.arc(W / 2, H / 2, h.width, 0, 2 * Math.PI); g.fill(); }
    else {
      g.fillRect(0, H / 2 - h.width / 2, h.dash ? on : W, h.width);
      if (h.cross) g.fillRect(W / 2 - h.width / 2, 0, h.width, h.dash ? on : H);
    }
    tiles.set(key, t);
    return t;
  }
  const hatches = new WeakMap();   // Float32Array -> {cv, key, x, y, w, h}: the part's lines, clipped to it, on its box on the stage
  /** The hatch of mask m (stats st, its hatch h, direction dir) as a canvas over its box on stage, rebuilt only when the mask, its
   *  colour, the pattern, the direction or the view changed (painting / scrubbing: one drawImage per part). */
  function hatchCanvas(env, m, ver, color, h, dir, st) {
    const P = [[st.x0, st.y0], [st.x1 + 1, st.y0], [st.x0, st.y1 + 1], [st.x1 + 1, st.y1 + 1]].map(([x, y]) => env.map(x / m.w, y / m.h));
    const x0 = Math.max(0, Math.floor(Math.min(...P.map((p) => p[0])))), y0 = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1]))));
    const W = Math.min(env.w, Math.ceil(Math.max(...P.map((p) => p[0])))) - x0, H = Math.min(env.h, Math.ceil(Math.max(...P.map((p) => p[1])))) - y0;
    if (W <= 0 || H <= 0) return null;
    const dpr = env.dpr || 1, [ox, oy] = env.map(0, 0), [ax, ay] = env.map(1, 0), [bx, by] = env.map(0, 1);
    // ponytail: keyed on the whole view, so a pan / zoom rebuilds every part's canvas once; key on the linear part + an offset if panning stutters
    const key = [color, h.key, dir.ux.toFixed(3), dir.uy.toFixed(3), dir.ramp, ver, dpr, ...[ox, oy, ax, ay, bx, by].map((v) => v.toFixed(1)), x0, y0, W, H].join('|');
    let c = hatches.get(m.a);
    if (c?.key === key) return c;
    if (!c) { c = { cv: document.createElement('canvas') }; hatches.set(m.a, c); }
    const cv = c.cv;
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);   // (clears it)
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);   // stage px, like the overlay's ctx
    g.save(); maskXf(g, env, m); g.imageSmoothingEnabled = true; g.drawImage(tint(m, 'black', ver, 'alpha'), 0, 0); g.restore();   // where: the mask
    // the lines: along the part's direction (stage), anchored on its middle so they never swim as the view moves
    const [cx, cy] = env.map((st.cx + 0.5) / m.w, (st.cy + 0.5) / m.h), [dx, dy] = env.map((st.cx + 0.5 + dir.ux) / m.w, (st.cy + 0.5 + dir.uy) / m.h);
    const L = Math.hypot(dx - cx, dy - cy) || 1, ux = (dx - cx) / L, uy = (dy - cy) / L;
    const pat = g.createPattern(hatchTile(h, color, dpr), 'repeat');
    pat.setTransform(new DOMMatrix().translateSelf(cx, cy).rotateSelf((Math.atan2(uy, ux) * 180) / Math.PI).scaleSelf(1 / dpr));
    g.globalCompositeOperation = 'source-in'; g.fillStyle = pat; g.fillRect(x0, y0, W, H);
    if (dir.ramp) {   // the sense: the lines strong at the joint, fading outward (each part of a limb starts strong again: the joints read)
      const ts = P.map(([X, Y]) => (X - cx) * ux + (Y - cy) * uy), t0 = Math.min(...ts), t1 = Math.max(...ts);
      const te = t0 + (t1 - t0) / (1 - RAMP_END), gr = g.createLinearGradient(cx + ux * t0, cy + uy * t0, cx + ux * te, cy + uy * te);   // (opaque -> clear over a longer run: RAMP_END left at the far end)
      gr.addColorStop(0, 'black'); gr.addColorStop(1, 'transparent');
      g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(x0, y0, W, H);
    }
    g.globalCompositeOperation = 'source-over';
    Object.assign(c, { key, x: x0, y: y0, w: W, h: H });
    return c;
  }
  /** items: [{name, m, ver?} | null] -> [{ux, uy, ramp} | null]: the hatch direction of each part painted here (chainDirs). */
  const dirsOf = (items) => chainDirs(items.map((it) => (it ? { name: it.name, st: statsOf(it.m, it.ver ?? -1) } : { name: '', st: { n: 0 } })));
  const dithers = new WeakMap();   // Float32Array -> {cv, key, x, y, w, h}: the part's dot grid, device px (drawn unsmoothed)
  /** Dither (group-look.js DITHER): one square grid per part, anchored on its middle (it moves with the picture, never swims), the cell
   *  a fixed number of device px (css px x DPI, rounded: crisp; zoom never scales it); a cell is on when its middle is in the mask
   *  and the ordered threshold passes the coverage there (from `hi` at the joint to `lo` at the far end along dir). */
  function ditherCanvas(env, m, ver, color, d, dir, st) {
    const dpr = env.dpr || 1, { cd, s: ds, off } = ditherGeom(dCell, dDot, dpr);   // cell pitch, dot side, dot offset: device px
    const P = [[st.x0, st.y0], [st.x1 + 1, st.y0], [st.x0, st.y1 + 1], [st.x1 + 1, st.y1 + 1]].map(([x, y]) => env.map(x / m.w, y / m.h));
    const X0 = Math.max(0, Math.min(...P.map((p) => p[0]))) * dpr, Y0 = Math.max(0, Math.min(...P.map((p) => p[1]))) * dpr;
    const X1 = Math.min(env.w, Math.max(...P.map((p) => p[0]))) * dpr, Y1 = Math.min(env.h, Math.max(...P.map((p) => p[1]))) * dpr;
    if (X1 <= X0 || Y1 <= Y0) return null;
    const [cx, cy] = env.map((st.cx + 0.5) / m.w, (st.cy + 0.5) / m.h), ox = Math.round(cx * dpr), oy = Math.round(cy * dpr);   // the grid's anchor (device px)
    const i0 = Math.floor((X0 - ox) / cd), j0 = Math.floor((Y0 - oy) / cd), nw = Math.ceil((X1 - ox) / cd) - i0, nh = Math.ceil((Y1 - oy) / cd) - j0;
    if (nw <= 0 || nh <= 0) return null;
    const [ex, ey] = env.map((st.cx + 0.5 + dir.ux) / m.w, (st.cy + 0.5 + dir.uy) / m.h), L = Math.hypot(ex - cx, ey - cy) || 1, ux = (ex - cx) / L, uy = (ey - cy) / L;
    const ts = P.map(([X, Y]) => (X - cx) * ux + (Y - cy) * uy), t0 = Math.min(...ts), t1 = Math.max(...ts);
    const [a0x, a0y] = env.map(0, 0), [a1x, a1y] = env.map(1, 0), [a2x, a2y] = env.map(0, 1);
    const key = [color, d.key, dir.ux.toFixed(3), dir.uy.toFixed(3), dir.ramp, ver, dpr, cd, ds, dAlpha, ...[a0x, a0y, a1x, a1y, a2x, a2y].map((v) => v.toFixed(1)), i0, j0, nw, nh].join('|');
    let c = dithers.get(m.a);
    if (c?.key === key) return c;
    if (!c) { c = { cv: document.createElement('canvas') }; dithers.set(m.a, c); }
    c.cv.width = nw * cd; c.cv.height = nh * cd;
    const g = c.cv.getContext('2d'), img = g.createImageData(nw * cd, nh * cd), px = img.data, W4 = nw * cd;
    const hx = /^#?([0-9a-f]{6})$/i.exec(color)?.[1], rgb = hx ? [16, 8, 0].map((s) => (parseInt(hx, 16) >> s) & 255) : [230, 233, 238], al = Math.round(2.55 * dAlpha);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const X = (ox + (i0 + i + 0.5) * cd) / dpr, Y = (oy + (j0 + j + 0.5) * cd) / dpr, [nx, ny] = env.unmap(X, Y);   // the cell's middle, stage px -> picture
      const mx = Math.floor(nx * m.w), my = Math.floor(ny * m.h);
      if (mx < 0 || my < 0 || mx >= m.w || my >= m.h || m.a[my * m.w + mx] < 0.5) continue;
      const t = dir.ramp ? Math.min(1, Math.max(0, ((X - cx) * ux + (Y - cy) * uy - t0) / Math.max(1e-6, t1 - t0))) : 0.5;
      if (!ditherOn(i0 + i, j0 + j, d.hi + (d.lo - d.hi) * t, d.mirror)) continue;
      for (let y = 0; y < ds; y++) for (let x = 0; x < ds; x++) { const k = ((j * cd + off + y) * W4 + i * cd + off + x) * 4; px[k] = rgb[0]; px[k + 1] = rgb[1]; px[k + 2] = rgb[2]; px[k + 3] = al; }
    }
    g.putImageData(img, 0, 0);
    return Object.assign(c, { key, x: (ox + i0 * cd) / dpr, y: (oy + j0 * cd) / dpr, w: (nw * cd) / dpr, h: (nh * cd) / dpr });
  }
  // ---- paw-c1m1: what a part is set to do, readable from its look in every fill style (never colour alone): measured (depth with
  // SAM / how much of the shaft is inside) = a ruler along its long edge; spurt cue (its contractions) = dotted rings inside its
  // outline; both = both. A part too small for them: a small glyph at its middle (ticks / a dotted ring) ----
  const isMeasured = (g) => (canShaft(g) ? isShaft(g, G.scenes?.[G.scene]) : isDepth(g));
  const isCue = (g) => canPulse(g) && isPulse(g);
  /** ' · depth measured · spurt cue' (the hover texts name what the look shows). */
  const flagText = (g) => `${g && isMeasured(g) ? ' · depth measured' : ''}${g && isCue(g) ? ' · spurt cue' : ''}`;
  const MARK_MIN = 26;   // stage px: a part's shorter run along its axis below this gets the glyph
  function drawMarks(ctx, env, g, m, ver, poly, color) {
    const meas = isMeasured(g), cue = isCue(g);
    if (!meas && !cue) return;
    const st = statsOf(m, ver);
    if (!st.n) return;
    const toS = (x, y) => env.map((x + 0.5) / m.w, (y + 0.5) / m.h), [cx, cy] = toS(st.cx, st.cy), [ex, ey] = toS(st.cx + st.ax, st.cy + st.ay);
    const k = Math.hypot(ex - cx, ey - cy) || 1, long = (st.tb - st.ta) * k, wide = (st.nb - st.na) * k, ink = labelTone(color);
    const inside = (x, y) => { const X = Math.floor(x + 0.5), Y = Math.floor(y + 0.5); return X >= 0 && Y >= 0 && X < m.w && Y < m.h && m.a[Y * m.w + X] >= 0.5; };
    const stroke = (w) => { ctx.strokeStyle = PLATE; ctx.lineWidth = w + 2; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.strokeStyle = ink; ctx.lineWidth = w; ctx.globalAlpha = 1; ctx.stroke(); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (Math.min(long, wide) < MARK_MIN) {   // the glyph: at the part's widest spot, ticks and / or a dotted ring side by side
      const [sx, sy] = toS(st.spot.x, st.spot.y), gx = meas && cue ? 6 : 0;
      if (meas) { ctx.beginPath(); for (const [dx, h] of [[-3, 3], [0, 5], [3, 3]]) { ctx.moveTo(sx - gx + dx, sy + 3); ctx.lineTo(sx - gx + dx, sy + 3 - h); } ctx.moveTo(sx - gx - 4, sy + 3); ctx.lineTo(sx - gx + 4, sy + 3); stroke(1.2); }
      if (cue) { ctx.beginPath(); ctx.arc(sx + gx, sy, 3.5, 0, 2 * Math.PI); ctx.setLineDash([1.2, 2]); stroke(1.2); ctx.setLineDash([]); }
      ctx.restore();
      return;
    }
    if (meas) {   // the ruler: just inside the long edge on the +normal side, ticks pointing in, a long one every fourth
      const nx = -st.ay, ny = st.ax, q = st.nb - Math.max(1, 0.15 * (st.nb - st.na)), step = 5 / k, pts = [];
      for (let t = st.ta + step, i = 0; t <= st.tb - step * 0.5; t += step, i++) {
        const bx = st.cx + st.ax * t + nx * q, by = st.cy + st.ay * t + ny * q, len = (i % 4 === 0 ? 6 : 3) / k;
        if (inside(bx, by) && inside(bx - nx * len, by - ny * len)) pts.push([toS(bx, by), toS(bx - nx * len, by - ny * len)]);
        else pts.push(null);
      }
      ctx.beginPath();
      pts.forEach((p, i) => { if (!p) return; const prev = pts[i - 1]; if (prev) { ctx.moveTo(...prev[0]); ctx.lineTo(...p[0]); } ctx.moveTo(...p[0]); ctx.lineTo(...p[1]); });
      stroke(1.2);
    }
    if (cue && poly?.length >= 3) {   // the rings: its outline drawn smaller about its middle, dotted
      const [mx, my] = [(st.cx + 0.5) / m.w, (st.cy + 0.5) / m.h];
      ctx.setLineDash([1.5, 3.5]);
      for (const s of [0.72, 0.42]) { ctx.beginPath(); pathPoly(ctx, env, poly.map(([x, y]) => [mx + (x - mx) * s, my + (y - my) * s])); stroke(1.4); }
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  /** A part's mask in the fill style: dither (the dot grid alone; parts without one: the gradient), hatch (a fainter tint + the
   *  lines), gradient, flat. */
  function drawLook(ctx, env, m, color, ver, h, dir, name) {
    if (fillStyle === 'flat') return drawMask(ctx, env, m, color, ver, 'flat');
    if (fillStyle === 'dither') {
      const d = ditherOf(name), st = d && dir ? statsOf(m, ver) : null, dc = st?.n ? ditherCanvas(env, m, ver, color, d, dir, st) : null;
      if (!dc) return drawMask(ctx, env, m, color, ver);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(dc.cv, dc.x, dc.y, dc.w, dc.h); ctx.restore();
      return;
    }
    if (fillStyle !== 'hatch' || !h || !dir) return drawMask(ctx, env, m, color, ver);
    const a0 = ctx.globalAlpha, st = statsOf(m, ver), hc = st.n ? hatchCanvas(env, m, ver, color, h, dir, st) : null;
    ctx.globalAlpha = a0 * HATCH_BASE; drawMask(ctx, env, m, color, ver); ctx.globalAlpha = a0 * 0.9;
    if (hc) ctx.drawImage(hc.cv, hc.x, hc.y, hc.w, hc.h);
    ctx.globalAlpha = a0;
  }
  // an ignore region (paw-855t): a dark hatched veil, not a tint; cached per mask array like the tints
  const veils = new WeakMap();
  function drawVeil(ctx, env, m, ver = -1) {
    let c = veils.get(m.a);
    if (!c) { const cv = document.createElement('canvas'); cv.width = m.w; cv.height = m.h; c = { cv, ver: -2 }; veils.set(m.a, c); }
    if (!c.done || (ver >= 0 && c.ver !== ver)) { c.cv.getContext('2d').putImageData(new ImageData(veilPixels(m), m.w, m.h), 0, 0); c.ver = ver; c.done = true; }
    const [x0, y0] = env.map(0, 0), [x1, y1] = env.map(1, 0), [x2, y2] = env.map(0, 1);
    ctx.save();
    ctx.transform((x1 - x0) / m.w, (y1 - y0) / m.w, (x2 - x0) / m.h, (y2 - y0) / m.h, x0, y0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c.cv, 0, 0);
    ctx.restore();
  }
  let shown = [];   // the labels drawn inside the parts: [{k, key, x, y (centre), w, h, ang, full, text (the full name), shown}] stage px; never a hit target (paw-c1m1)
  const tintName = (g) => { const p = isUnassigned(g) ? G.proposalFor(g) : null; return p?.auto ? proposedName(p, G.whoFor(g, p), G.proposedSide(g)?.side) : g.name; };   // a confident proposal tints its blob in the would-be colour (paw-p9ve)
  /** A group's full label (pr: its proposal when unassigned on its frame). */
  function nameText(g, pr) {
    const conf = confidenceOf(g), who = G.whoSet.has(g) ? whoName(G.whoSet.get(g)) + ' ' : '';
    if (pr) return pr.auto ? `${who}${PAIRED.includes(pr.parts[0].part) ? sideText(G.proposedSide(g)) + ' ' : ''}${partWord(pr.parts[0].part)}?` : `${who}?`;
    return `${isUnassigned(g) ? who : ''}${partLabel(g.name)}${g.unconfirmed ? ' ?' : ''}${conf != null ? ' ' + Math.round(conf * 100) + '%' : ''}${isTentative(g) ? ' ?' : ''}${g.off ? ' (off)' : ''}`;
  }
  // ---- the name labels (paw-c1m1, was paw-6m6o's chips above the masks): drawn INSIDE each part, part of the picture, never a
  // hit target (a press on one paints, as if it were not there). Each at its mask's widest interior spot (group-look.js maskStats,
  // cached per mask), along the part's long axis when that is upright enough (else level, if it fits), never upside down; the
  // full name, else the short tag, else nothing (the brush's own label names the part under it). The mode (tracking.groups.labels,
  // Shift+H): smart = full names for the active, hovered and '?' groups, tags for the rest; all = full names wherever they fit; none ----
  const labelMode = $derived(app.settings?.get?.('tracking.groups.labels') ?? 'smart');
  const LABEL_FONT = (px, full) => `${full ? 500 : 600} ${px}px Chakra Petch, sans-serif`, LABEL_ALPHA = 0.88, STEEP = Math.PI / 3;
  /** Q: [{k, key, m (mask), ver, text, tag, color, conf?, hot?, attn?, alpha?}]. Placed in order hot, '?', then the larger parts;
   *  one that would cover a label already placed tries its tag, else is left out. */
  function drawLabels(ctx, env, Q) {
    if (labelMode === 'none') return;
    const rank = (q) => (q.hot ? 0 : q.attn ? 1 : 2), boxes = [];
    const measure = (t, px) => { ctx.font = LABEL_FONT(px, true); return ctx.measureText(t).width; };
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const q of Q.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map((x) => x.q)) {
      const st = statsOf(q.m, q.ver), sp = st.spot;
      if (!st.n || !sp) continue;
      const [X, Y] = env.map((sp.x + 0.5) / q.m.w, (sp.y + 0.5) / q.m.h), [AX, AY] = env.map((sp.x + 0.5 + st.ax) / q.m.w, (sp.y + 0.5 + st.ay) / q.m.h);
      const k = Math.hypot(AX - X, AY - Y) || 1, axis = readable(Math.atan2(AY - Y, AX - X)), thick = 2 * sp.r * k;
      const level = { ang: 0, along: Math.min(sp.along * k, thick / Math.max(0.25, Math.abs(Math.sin(axis)))), thick };   // level: the chord across the part
      const along = { ang: axis, along: sp.along * k, thick };
      const tries = st.elong < 1.3 ? [{ ...level, along: thick * 0.95 }] : Math.abs(axis) <= STEEP ? [along, level] : [level, along];
      const tagOnly = labelMode !== 'all' && !q.hot && !q.attn;
      let f = null, o = null;
      for (const t of tries) { f = fitLabel(t, q.text, q.tag, measure, { tagOnly }); if (f) { o = t; break; } }
      if (!f) continue;
      const boxOf = (f) => { ctx.font = LABEL_FONT(f.px, f.full); const w = ctx.measureText(f.text).width + 4, h = f.px * 1.25, c = Math.abs(Math.cos(o.ang)), s = Math.abs(Math.sin(o.ang)); return { w, h, bw: w * c + h * s, bh: w * s + h * c }; };
      const free = (b) => !boxes.some((r) => Math.abs(r.x - X) * 2 < r.bw + b.bw && Math.abs(r.y - Y) * 2 < r.bh + b.bh);
      let b = boxOf(f);
      if (!free(b) && f.full) { const t = fitLabel(o, q.text, q.tag, measure, { tagOnly: true }); if (t) { f = t; b = boxOf(f); } }
      if (!free(b)) continue;
      boxes.push({ x: X, y: Y, bw: b.bw, bh: b.bh });
      ctx.save(); ctx.translate(X, Y); ctx.rotate(o.ang);
      ctx.globalAlpha = LABEL_ALPHA * (q.alpha ?? 1);
      ctx.font = LABEL_FONT(f.px, f.full);
      ctx.strokeStyle = PLATE; ctx.lineWidth = fillStyle === 'dither' ? 4 : 2.5; ctx.strokeText(f.text, 0, 0);   // a thin dark halo: reads on any footage (a wider one on the loud dither)
      ctx.fillStyle = labelTone(q.color); ctx.fillText(f.text, 0, 0);
      if (f.full && q.conf != null) ctx.fillRect(-b.w / 2 + 2, b.h / 2 - 1, (b.w - 4) * q.conf, 1.5);   // a suggestion's confidence: the bar's length
      ctx.restore();
      shown.push({ k: q.k, key: q.key, x: +X.toFixed(1), y: +Y.toFixed(1), w: Math.round(b.w), h: Math.round(b.h), ang: +o.ang.toFixed(3), full: f.full, text: q.text, shown: f.text });
    }
    ctx.restore();
  }
  /** An outline with a dark halo under it (reads on light and dark footage). */
  function outline(ctx, env, poly, color, width, dash, alpha) {
    ctx.beginPath(); pathPoly(ctx, env, poly);
    ctx.globalAlpha = alpha * 0.7; ctx.strokeStyle = PLATE; ctx.lineWidth = width + 2; ctx.setLineDash(dash); ctx.stroke();
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // ---- the active group (paw-m2cg): unmistakable on any picture, whatever its colour ----
  const ASSIGN_VEIL = 0.34;     // opacity of the dark veil over the picture outside the group being assigned (drawing only: tracker and snap never see it)
  const OTHERS_ALPHA = 0.5, OTHERS_WIDTH = 0.9;   // the other groups while one is assigned: dimmer, thinner
  const TINY_PX = 14;           // a group smaller than this on stage (its longer side) gets a ring and an arrow
  /** Where a polygon is on the stage: {cx, cy, size (longer side), vis (part of its box on stage)}. */
  function stageBox(env, poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of poly) { const [X, Y] = env.map(q[0], q[1]); x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y); }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0), vis: x1 >= 0 && y1 >= 0 && x0 <= env.w && y0 <= env.h };
  }
  const pathD = (env, poly) => poly.map(([x, y], i) => { const [X, Y] = env.map(x, y); return `${i ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`; }).join('') + 'Z';
  /** The active group's highlight as plain geometry for the SVG layer (computed per draw, which only happens when something it
   *  reads changed: no animation loop here; the pulse and the marching dashes are CSS on the layer). */
  function highlight(ctx, env, poly, { text, color, assigning, veil }) {
    const box = stageBox(env, poly), out = { w: env.w, h: env.h, d: pathD(env, poly), color, assigning, veil, ptr: null, pill: null };
    let at = box;
    if (!box.vis || box.size < TINY_PX) {   // off stage: an arrow at the edge pointing to it; too small to see: a ring round it
      const { cx, cy } = box, mx = env.w / 2, my = env.h / 2, dx = cx - mx, dy = cy - my, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      if (!box.vis) {
        const m = 22, tx = ux ? (ux > 0 ? env.w - m - mx : m - mx) / ux : Infinity, ty = uy ? (uy > 0 ? env.h - m - my : m - my) / uy : Infinity, t = Math.min(tx, ty);
        out.ptr = { kind: 'arrow', x: +(mx + ux * t).toFixed(1), y: +(my + uy * t).toFixed(1), ang: +(Math.atan2(uy, ux) * 180 / Math.PI).toFixed(1) };
        at = { cx: out.ptr.x, x0: out.ptr.x, x1: out.ptr.x, y0: out.ptr.y - 8, y1: out.ptr.y + 8 };
      } else out.ptr = { kind: 'ring', x: +cx.toFixed(1), y: +cy.toFixed(1) };
    }
    ctx.font = '600 12px Chakra Petch, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 16, h = 20;   // a dark pill above the group (below it when there is no room), kept on stage
    let x = at.cx - w / 2, y = at.y0 - h - 8;
    if (y < 4) y = at.y1 + 8;
    x = Math.min(env.w - w - 4, Math.max(4, x)); y = Math.min(env.h - h - 4, Math.max(4, y));
    out.pill = { x: +x.toFixed(1), y: +y.toFixed(1), w, h, text };
    return out;
  }

  let hl = $state.raw(null), hlKey = '';   // the active group's highlight (SVG layer): geometry of the last draw
  const flash = driver(() => paintStroke());   // the one animation loop: the fade of a just-assigned group, on the stroke canvas (paw-o60v.6: not the whole overlay per frame)
  $effect(() => () => flash.stop());
  let lastEnv = null;   // the overlay layer's env of the last paint (map / unmap: the cursor canvas, coalesced samples, drops)
  let dropK = $state(-1);   // a drag hovering group k on the video (its drop highlight)
  let rowHover = $state(-1);   // paw-ls54: the dock row under the pointer: its group is lit on the video like a drop target
  function draw(ctx, env) {
    G.tick; themeTick; app.doc.scenes; G.active; dropK; rowHover; G.marginShow; G.picker; G.pickHover; G.xf; G.lasso; G.growBusy; G.dial; G.copy; G.copyWait; G.hoverK; labelMode; fillStyle; dCell; dDot; dAlpha;
    lastEnv = env; shown = []; G.labelsShown = shown;   // labelsShown: what was drawn (dev/groups-labels-check.mjs reads it)
    if (!app.doc.media || app.mode !== 'track') return;
    const on = G.on, here = !on || G.onFrame, i = on ? G.scene : sceneIndexAt(app.doc.scenes || [], env.timeMs), s = app.doc.scenes?.[i];
    const list = on ? G.groups : s ? groupsShownAt(takeGroups(app.doc.scenes, i), tr.runs, env.timeMs, app.player.frameMs) : [];   // paw-o74b: the tool on: the groups seeded on this frame (the others below); off: paw-0apg, tracked here: only on their own frame
    ctx.save(); ctx.lineJoin = 'round';
    const pv = on ? G.copyPreview : null;   // paw-lgtx: a Copy from… candidate hovered (or being re-found): its groups lined up on this frame, instead of the take's
    if (pv) {
      const dirs = dirsOf(pv.map((g) => ({ name: g.name, m: G.maskFor(g) })));
      pv.forEach((g, j) => drawLook(ctx, env, G.maskFor(g), groupPaint(g.name), -1, hatchOf(g.name), dirs[j], g.name));
      const Q = [];
      for (const g of pv) { outline(ctx, env, g.poly, groupPaint(g.name), 1.75, [6, 4], 1); if (g.poly?.length >= 3) Q.push({ k: -1, key: 'pv:' + g.name, m: G.maskFor(g), ver: -1, text: partLabel(g.name), tag: shortTag(g.name), color: groupPaint(g.name), attn: true }); }
      drawLabels(ctx, env, Q);
      shown = []; G.labelsShown = shown;
      if (hlKey) { hlKey = ''; hl = null; }
      ctx.restore(); paintCursor(); return;
    }
    // off the groups' frame (tool on): ghosts only, where they were painted; the toolbar says where they are
    const assignK = on && here && !G.draft && G.picker && list[G.picker.k] ? G.picker.k : -1;   // the group being assigned: the rest recedes (paw-m2cg)
    const actK = assignK >= 0 ? assignK : on && here && !G.draft && !G.xf && !G.lasso && list[G.active] && !list[G.active].off ? G.active : -1;   // assigned or just selected: drawn two-tone
    const prev = assignK >= 0 ? G.pickHover : '';
    const order = list.map((_, k) => k).sort((a, b) => polyArea(list[b].poly || []) - polyArea(list[a].poly || []));   // a part on another (a knot on the penis) draws above it: the larger first   // the part hovered in the picker, previewed in its colour on the group
    const dk = on && G.draft ? G.draft.k : -1, liveOf = (k) => (k === dk ? null : G.liveFor(k)), lver = (lv) => (lv ? G.tick : -1);   // paw-o60v.6: the stroke's group is the stroke canvas'
    if (on && here) order.forEach((k) => { const g = list[k]; if (k !== dk && !g.off && isIgnore(g)) { const lv = liveOf(k); drawVeil(ctx, env, lv ? lv.mask : G.maskFor(g), lver(lv)); } });   // ignore regions: the veil first, parts draw above it
    const lookName = (k) => (k === assignK && prev ? prev : tintName(list[k])), maskOfK = (k) => liveOf(k)?.mask || G.maskFor(list[k]);   // paw-c1m1: the hatch follows the would-be name too
    const dirs = on && here && (fillStyle === 'hatch' || fillStyle === 'dither') ? dirsOf(list.map((g, k) => (k === dk || g.off || isIgnore(g) ? null : { name: lookName(k), m: maskOfK(k), ver: lver(liveOf(k)) }))) : [];
    if (on && here) order.forEach((k) => { const g = list[k]; if (k !== dk && !g.off && !isIgnore(g)) { const lv = liveOf(k); if (assignK >= 0 && k !== assignK) ctx.globalAlpha = OTHERS_ALPHA; drawLook(ctx, env, lv ? lv.mask : G.maskFor(g), groupPaint(lookName(k)), lver(lv), hatchOf(lookName(k)), dirs[k], lookName(k)); const kn = !lv && G.knotFor(g); if (kn) drawMask(ctx, env, kn, knotPaint(g.name)); ctx.globalAlpha = 1; } });   // tints first: outlines and chips stay on top; paw-njnf: a penis' knot section a darker shade on it
    const Q = [], oth = on && !G.draft ? G.othersHere() : [];   // the labels, placed and drawn together after the outlines
    const who1 = on ? sharedWho([...list.map((g) => g.name), ...oth.map((o) => o.g.name)]) : null;   // one character: its name left out of the labels (said once beside the bar)
    order.forEach((k) => {
      const g = list[k], pr = on && here && isUnassigned(g) ? G.proposalFor(g) : null, color = groupPaint(pr?.auto ? proposedName(pr, G.whoFor(g, pr), G.proposedSide(g)?.side) : g.name), lv = on ? liveOf(k) : null, poly = lv ? lv.poly : g.poly, act = on && k === G.active;
      if (on && here && !g.off && !g.points && k !== dk) for (const q of lv ? lv.islands || [] : G.fitFor(g).islands) outline(ctx, env, q, tok('var(--tx-mut)'), 1, [3, 3], 0.9);   // patches the polygon leaves out
      if (!(poly?.length >= 3)) return;
      const hot = k === dropK || (k === rowHover && here);   // a drop target, or its dock row hovered (the group the picker assigns is drawn two-tone, below)
      if (on && hot) {   // (a group just assigned: the stroke canvas fills it in its new colour, fading)
        ctx.beginPath(); pathPoly(ctx, env, poly); ctx.fillStyle = tok('var(--tx-hi)'); ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;
      }
      const tent = isTentative(g), conf = confidenceOf(g);
      const dash = g.unconfirmed ? [2, 3] : !here ? [6, 5] : tent ? [3, 3] : isUnassigned(g) ? [4, 3] : g.off || !g.pinned ? [5, 4] : [];   // dotted = re-found after a cut, unconfirmed; short dashes = a tentative suggestion
      if (k !== actK && k !== dk) outline(ctx, env, poly, k === dropK ? tok('var(--tx-hi)') : color, k === dropK ? 2.5 : assignK >= 0 ? OTHERS_WIDTH : (act && here) ? 2.5 : 1.25, dash, (!on ? 0.35 : !here ? (G.peek ? 0.95 : 0.5) : g.off ? 0.4 : tent || pr ? 0.6 : 1) * (assignK >= 0 ? OTHERS_ALPHA : 1));
      if (on && here && !g.off && k !== dk) drawMarks(ctx, env, g, lv?.mask || G.maskFor(g), lver(lv), poly, color);   // paw-c1m1: measured / spurt cue, from the look
      if (on && here && !g.off && g.points && !lv && k !== dk) {   // paw-8mf4: the run's seed points Track seeds (the tint is their footprint)
        ctx.fillStyle = PLATE; for (const q of g.points) { const [X, Y] = env.map(q[0], q[1]); ctx.fillRect(X - 2, Y - 2, 4, 4); }
        ctx.fillStyle = color; for (const q of g.points) { const [X, Y] = env.map(q[0], q[1]); ctx.fillRect(X - 1.25, Y - 1.25, 2.5, 2.5); }
      }
      if (on && k !== actK && k !== dk) Q.push({ k, key: g.name, m: lv?.mask || G.maskFor(g), ver: lver(lv), text: dropWho(nameText(g, pr), who1), tag: shortTag(g.name, !who1), color, conf, hot: k === G.hoverK || k === rowHover || k === dropK, attn: !!g.unconfirmed || isUnassigned(g) || isSuggested(g) || tent, alpha: g.off ? 0.55 : 1 });
    });
    // paw-o74b: the take's groups seeded on other frames: dimmed, where a run tracked them on this frame (long dashes), else
    // where they were painted (dotted); never edited here. What is already covered; a stroke over a tracked one proposes that
    // part (paw-o74b.1: another seed of it, a re-anchor here)
    for (const o of oth) {
      if (o.g.off || !(o.poly?.length >= 3)) continue;
      const c = groupPaint(o.g.name);
      outline(ctx, env, o.poly, c, 1.25, o.tracked ? [6, 3] : [2, 4], o.tracked ? 0.6 : 0.35);
      Q.push({ k: -1, key: `o:${o.g.name}:${o.t_ms}`, m: polyMask(o.poly), ver: -1, text: dropWho(`${partLabel(o.g.name)} · ${o.tracked ? 'tracked' : 'seed'} f${frameOf(o.t_ms)}`, who1), tag: shortTag(o.g.name, !who1), color: c, alpha: 0.75 });
    }
    let next = null;
    if (actK >= 0) {   // the active group: handed to the SVG layer (two-tone outline, spotlight veil, arrow; its pill only while assigning)
      const g = list[actK], lv = G.liveFor(actK), poly = lv ? lv.poly : g.poly;
      if (poly?.length >= 3) {
        const color = groupPaint(prev || g.name), conf = confidenceOf(g);
        const text = assignK >= 0 ? (prev ? `assigning: ${partLabel(prev)}` : isUnassigned(g) ? 'assigning: pick a part' : `assigning: ${partLabel(g.name)}`) : dropWho(`${partLabel(g.name)}${g.unconfirmed ? ' ?' : ''}${conf != null ? ' ' + Math.round(conf * 100) + '%' : ''}${isTentative(g) ? ' ?' : ''}`, who1);
        next = highlight(ctx, env, poly, { text, color, assigning: assignK >= 0, veil: assignK >= 0 });
        if (assignK < 0) { next.pill = null; Q.push({ k: actK, key: g.name, m: lv?.mask || G.maskFor(g), ver: lver(lv), text, tag: shortTag(g.name, !who1), color, conf, hot: true }); }   // paw-c1m1: its name inside it like the rest
      }
    }
    drawLabels(ctx, env, Q);
    const mp = on && here ? G.marginPreview() : null;   // the margin being changed: where an edge repainted now would sit, dashed (never rewrites the painted group)
    if (mp?.length >= 3) outline(ctx, env, mp, tok('var(--tx-hi)'), 1.5, [3, 3], 1);
    if (on && G.growBusy && G.growAt) { const [X, Y] = env.map(G.growAt[0], G.growAt[1]); next = next || { w: env.w, h: env.h, d: '', ptr: null, pill: null }; next.busy = { x: +X.toFixed(1), y: +Y.toFixed(1) }; }   // a SAM prompt is out
    if (on && G.dial?.label) { const [X, Y] = env.map(G.dial.at[0], G.dial.at[1]); next = next || { w: env.w, h: env.h, d: '', ptr: null, pill: null }; next.dial = { x: +X.toFixed(1), y: +(Y - 18).toFixed(1), text: G.dial.label }; }   // the loosen / tighten readout
    { const k = next ? JSON.stringify(next) : ''; if (k !== hlKey) { hlKey = k; hl = next; } }   // a new object only when something moved (the SVG layer re-renders then)
    const ls = G.lasso;
    if (ls && ls.pts.length > 1) {   // circle to fill: the thin lasso, its closing line faint
      const ring = tok('var(--tx-hi)');
      ctx.beginPath(); pathPoly(ctx, env, ls.pts);
      ctx.setLineDash([2, 4]); ctx.globalAlpha = 0.45; ctx.strokeStyle = ring; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.beginPath(); ls.pts.forEach(([x, y], i) => { const [X, Y] = env.map(x, y); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.strokeStyle = PLATE; ctx.lineWidth = 3.5; ctx.stroke(); ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
    untrack(paintStroke);   // the view moved / the stroke began or ended: the stroke canvas follows
    cursorSoon();   // ... and the ring (once a frame: the pointer draws it right away itself)
  }

  // ---- the cursor canvas: the brush ring and what the stroke will do, redrawn on every pointer move (cheap) ----
  let cur = $state(), hoverPt = $state(null);   // hoverPt: the pointer over the stage (stage px)
  let stageW = $state(0), stageH = $state(0);
  const pressureOf = (e) => (e?.pointerType === 'pen' && e.pressure > 0 ? 0.25 + 0.75 * e.pressure : 1);
  /** What a stroke from stage point h does, as people read it. */
  function strokeLabel(h) {
    if (!lastEnv?.unmap) return '';
    if (G.circle && !h.erase) return G.lasso ? (G.grow ? 'circle: let go to grow' : 'circle: let go to fill') : (G.grow ? 'circle: loop a part, SAM finds it' : 'circle: loop most of a part');
    const [nx, ny] = lastEnv.unmap(h.x, h.y), t = G.strokeTarget(nx, ny, h.erase, h.force), g = G.groups[t.k];
    if (h.erase) return g ? `${G.grow ? 'grow: not this, ' : 'erase '}${partLabel(g.name)}` : 'erase: nothing here';
    if (G.grow) return g ? `grow ${partLabel(g.name)}` : 'grow: new part';
    return g ? `add to ${partLabel(g.name)}${flagText(g)}` : isUnassigned(t.name) ? 'new group' : 'new ' + partLabel(t.name);
  }
  const strokeColor = (h) => { if (!lastEnv?.unmap) return tok('var(--tx-hi)'); const [nx, ny] = lastEnv.unmap(h.x, h.y), t = G.strokeTarget(nx, ny, h.erase, h.force); return groupPaint(t.k >= 0 ? G.groups[t.k]?.name : t.name); };
  /** The ring, drawn right away (in the pointer event itself: never behind the overlay's work); reads nothing reactively. */
  function paintCursor() { untrack(drawCursor); }
  let rafCur = 0;
  function cursorSoon() { if (!rafCur) rafCur = requestAnimationFrame(() => { rafCur = 0; paintCursor(); }); }
  function drawCursor() {
    {
      const cv = cur, env = lastEnv;
      if (!cv) return;
      const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      stageW = W; stageH = H;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const h = hoverPt;
      if (!G.on || !h || !env?.map || app.mode !== 'track' || drag?.live || G.peek) return;
      const [ax, ay] = env.map(0, 0), [bx, by] = env.map(0, 1), r = G.circle && !h.erase ? 4 : G.radius * h.f * Math.hypot(bx - ax, by - ay);   // circle on: a small cross-hair, not the brush
      const xf = G.xf, split = !G.onFrame && !G.draft && !h.erase && !!G.splitHere, here = G.onFrame || split, d = G.draft, color = d ? groupPaint(d.g?.name || d.name) : strokeColor(h);
      let label, lc = color;
      if (xf) label = `${xf.kind === 'grab' ? 'move' : 'scale'} ${partLabel(xf.g.name)} · click / Enter keeps · Esc cancels`;
      else if (!here) { label = 'not the groups’ frame: see the notes by the bar'; lc = tok('var(--warn)'); }
      else if (split) label = 'paint: new groups for this shot';
      else if (d?.knot) label = `${d.erase ? 'erase the knot on' : 'knot on'} ${partLabel(d.g.name)}`;
      else if (G.knotBrush) { const [nx, ny] = env.unmap(h.x, h.y), kk = G.knotTarget(nx, ny); label = kk >= 0 ? `${h.erase ? 'erase the knot on' : 'knot on'} ${partLabel(G.groups[kk].name)}` : 'knot brush: start on a penis (K: the brush)'; lc = kk >= 0 ? knotPaint(G.groups[kk].name) : tok('var(--warn)'); }
      else if (d) label = d.g ? `${d.erase ? 'erase' : 'paint'} ${partLabel(d.g.name)}` : isUnassigned(d.name || '') ? 'new group' : 'new ' + partLabel(d.name);
      else label = strokeLabel(h);
      if (!xf) {
        const ring = (rad, w, col, alpha, dash) => { ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(0.5, rad), 0, 2 * Math.PI); ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.stroke(); };
        const erase = d ? d.erase : h.erase, dash = erase ? [4, 3] : [], col = erase || !here ? tok('var(--tx-hi)') : color;
        ring(r, 3.5, PLATE, 0.75, []);                              // halo under the edge ring
        ring(r, 1.5, col, here ? 1 : 0.5, dash);                    // where a stroke's edge lands (the mask's 0.5 level)
        ring(r * (1 - SOFT), 1, col, 0.35, [2, 3]); ring(r * (1 + SOFT), 1, col, 0.35, [2, 3]);   // the soft falloff
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = col; ctx.fillRect(h.x - 0.75, h.y - 0.75, 1.5, 1.5);
      }
      if (!label) return;
      ctx.font = '11px Chakra Petch, sans-serif';
      const tw = ctx.measureText(label).width + 10, lx = Math.min(W - tw - 2, h.x + (xf ? 12 : r * 0.72 + 6)), ly = Math.max(16, h.y - (xf ? 12 : r * 0.72 + 4));
      ctx.globalAlpha = 1; ctx.fillStyle = plate(.82); ctx.fillRect(lx, ly - 12, tw, 15);
      ctx.fillStyle = lc; ctx.textAlign = 'left'; ctx.fillText(label, lx + 5, ly);
    }
  }

  // ---- the stroke canvas (paw-o60v.6): the stroke in progress, its paint once a frame (groups.svelte.js onStroke), its
  // outline and patches once fitted (the pen resting, pen up), drawn as the overlay drew them before ----
  let strokeCv = $state(), rafStroke = 0;
  function paintStroke() { if (!rafStroke) rafStroke = requestAnimationFrame(drawStroke); }
  function drawStroke() {
    rafStroke = 0;
    const cv = strokeCv, env = lastEnv, d = G.draft;
    if (!cv) { flash.run(false); return; }
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!env?.map || !G.on || app.mode !== 'track' || G.copyPreview) { flash.run(false); return; }
    const fl = G.flash, fa = fl ? 1 - (performance.now() - fl.t0) / 700 : 0, fg = fa > 0 ? G.groups.find((x) => x.name === fl.name) : null;
    if (fg?.poly?.length >= 3) { ctx.beginPath(); pathPoly(ctx, env, fg.poly); ctx.fillStyle = groupPaint(tintName(fg)); ctx.globalAlpha = 0.55 * fa; ctx.fill(); ctx.globalAlpha = 1; }
    flash.run(fa > 0);
    if (!d) return;
    const g = d.g, name = g ? g.name : d.name || G.nextName, color = groupPaint(g ? tintName(g) : name), fitted = d.fitVer === d.ver, m = fitted ? d.mask : d.raw;
    ctx.save(); ctx.lineJoin = 'round';
    if (d.knot) { drawMask(ctx, env, G.maskFor(g), color); drawMask(ctx, env, m, knotPaint(name), d.ver); if (g.poly?.length >= 3) outline(ctx, env, g.poly, color, 1.25, [], 1); ctx.restore(); d.drawnVer = d.ver; return; }   // paw-njnf: the knot brush: the penis as it is, the section darker on it
    if (isIgnore(name)) drawVeil(ctx, env, m, d.ver); else drawMask(ctx, env, m, color, d.ver);
    if (fitted) {   // the paint moved on since: its last outline would be stale, so none until the next fit
      for (const q of d.islands || []) outline(ctx, env, q, tok('var(--tx-mut)'), 1, [3, 3], 0.9);
      const tent = !!g && isTentative(g), dash = !g ? (isUnassigned(name) ? [4, 3] : []) : g.unconfirmed ? [2, 3] : tent ? [3, 3] : isUnassigned(g) ? [4, 3] : g.off || !g.pinned ? [5, 4] : [];
      if (d.poly?.length >= 3) outline(ctx, env, d.poly, color, 2.5, dash, g && (tent || (isUnassigned(g) && G.proposalFor(g))) ? 0.6 : 1);
    }
    ctx.restore();
    d.drawnVer = d.ver;   // what this frame shows (dev/paint-perf-check.mjs reads it)
  }
  $effect(() => { G.flash; untrack(paintStroke); });   // a group just assigned: its fade starts
  $effect(() => { const f = () => paintStroke(); G.onStroke = f; return () => { if (G.onStroke === f) G.onStroke = null; cancelAnimationFrame(rafStroke); rafStroke = 0; }; });

  // ---- dragging labels: a palette part, a group's chip (on the video or in the list) -> a group, a palette part, a row ----
  // pointer events with capture (HTML5 drag and drop is unreliable in WebView2). drag = {kind: 'label', who, part, side,
  // text, color} | {kind: 'group', k, text, color}; live once it moved 4 px (before that a release is a click).
  let drag = $state(null), ghost = $state(null), dropKey = $state('');
  let peekDrag = null;   // paw-bsyo: {x0 (null: the next move sets it), base (frames)}: while the peek key is held the mouse scrubs, no button
  let lastX = null;      // the pointer's last clientX anywhere in the window (the peek's anchor when the peek key goes down)
  let altDown = null;   // Alt held at pointer down: a click picks the group under it, a drag paints with the snap flipped
  const stageEl = () => app.stageEl?.() || document.querySelector('[data-testid="video-stage"]');   // app.stageEl: the labelling workspace's stage (paw-714j)
  function dropAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy), st = stageEl()?.getBoundingClientRect();
    const part = el?.closest?.('[data-drop-part]');
    if (part) return { part: part.dataset.dropPart, side: part.dataset.dropSide || null, key: 'part:' + part.dataset.dropPart + (part.dataset.dropSide || '') };
    const row = el?.closest?.('[data-drop-who]');
    if (row) return { who: row.dataset.dropWho, key: 'who:' + row.dataset.dropWho };
    if (!st || el?.closest?.('.gdock, .gside, .gpick') || !lastEnv?.unmap) return null;
    const [nx, ny] = lastEnv.unmap(cx - st.left, cy - st.top), k = G.hitAt(nx, ny);
    return k >= 0 ? { k, key: 'k:' + k } : null;
  }
  function dragMove(cx, cy) {
    if (!drag) return;
    const st = stageEl()?.getBoundingClientRect();
    if (!drag.live && Math.hypot(cx - drag.x0, cy - drag.y0) < 4) return;
    drag.live = true;
    ghost = st ? { x: cx - st.left, y: cy - st.top, text: drag.text, color: drag.color } : null;
    const t = dropAt(cx, cy), ok = t && !(drag.kind === 'group' && t.k === drag.k) && !(drag.kind === 'label' && !('k' in t));
    dropKey = ok ? t.key : ''; dropK = ok && 'k' in t ? t.k : -1;
    paintCursor();
  }
  /** -> whether it was a drag (else the release is a click). */
  function dragEnd(cx, cy) {
    const d = drag;
    drag = null; ghost = null; dropKey = ''; dropK = -1;
    if (!d?.live) return false;
    const t = dropAt(cx, cy);
    if (!t) return true;
    if (d.kind === 'label' && 'k' in t) G.assign(t.k, { who: d.who, part: d.part, side: d.side });
    else if (d.kind === 'group') {
      const g = G.groups[d.k];
      if (!g) return true;
      if ('k' in t && t.k !== d.k) G.swapGroups(d.k, t.k);
      else if (t.part) G.assign(d.k, { who: g.who || G.who, part: t.part, side: t.side });
      else if (t.who && !isUnassigned(g)) { if ((g.who || G.who) !== t.who) G.moveWho(d.k, t.who); }
      else if (t.who) { G.who = t.who; G.openPicker(d.k); }
    }
    return true;
  }
  /** pointerdown on a draggable element of the toolbar: capture the pointer, a drag once it moves. */
  function grab(e, payload) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    drag = { ...payload, x0: e.clientX, y0: e.clientY, live: false };
    el.setPointerCapture?.(e.pointerId);
    const mv = (ev) => dragMove(ev.clientX, ev.clientY);
    const up = (ev) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (dragEnd(ev.clientX, ev.clientY)) suppress = true; };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  // a value by hand on its control (the brush size, the magnet's strength, Suggest's shown confidence): drag up / down
  // (4 px before it counts as a drag; then set(dy), dy = px moved up) or scroll; a click after a drag is not a click
  function dragV(e, set) {
    if (e.button !== 0) return;
    const el = e.currentTarget, y0 = e.clientY;
    let live = false;
    const mv = (ev) => { if (!live && Math.abs(ev.clientY - y0) < 4) return; if (!live) { live = true; el.setPointerCapture?.(e.pointerId); } set(y0 - ev.clientY); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (live) { suppress = true; setTimeout(() => { suppress = false; }, 0); } };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  const wheelV = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(e.deltaY < 0 ? 1 : -1); };
  const sizeDown = (e) => { const r0 = G.radius; dragV(e, (dy) => G.setRadius(r0 * Math.pow(1.01, dy))); };
  const sizeWheel = wheelV((s) => G.resize(s > 0 ? 1.1 : 1 / 1.1));
  const magDown = (e) => { const v0 = G.snapStrength; dragV(e, (dy) => G.setSnapStrength(v0 + dy * 0.6)); };
  const magWheel = wheelV((s) => G.setSnapStrength(G.snapStrength + 5 * s));
  const confDown = (e) => { const v0 = G.suggestConf; dragV(e, (dy) => G.setSuggestConf(v0 + dy * 0.003)); };
  const confWheel = wheelV((s) => G.setSuggestConf(G.suggestConf + 0.05 * s));
  /** The brush ring's size as a ring on the size control (4..15 px). */
  const sizeDot = $derived(4 + 11 * Math.min(1, Math.max(0, (G.radius - BRUSH.min) / (BRUSH.max - BRUSH.min))));
  let suppress = false;   // the click that follows a drag's release
  const clickUnlessDrag = (fn) => (e) => { if (suppress) { suppress = false; return; } fn(e); };

  // ---- the pointer tool ----
  // paw-ls54: no standing hint line under the video (the tool has no hint()): the full key list is the dock's (i) hover,
  // generated here from the same strings; what changes with what the owner does (peeking, a modifier's seed, SAM busy,
  // the group under the pointer and what 1 / 2 / 3 / F do to it, paw-cnfg) is the dock's one context line
  const keyList = $derived.by(() => {
    const k = (id, d) => key(id) || d;
    return [
      G.knotBrush ? 'Knot brush: paint the knot on the penis (darker) · Shift erases it · K: back to the brush' : G.grow ? 'Grow: dab or scribble a part · Shift+dab: not this' : 'Paint · Shift erases (the bar’s eraser: Shift paints)',
      'Ctrl+drag: a new group, painted over what is under it',
      'A or right click assigns (the picker’s ignore: an ignore region) · a group’s row in the list onto another group: they trade',
      'The groups list: click selects · Shift+click: strokes paint into that group',
      `Alt+click picks · Alt+drag ${G.snap ? 'without' : 'with'} edge snap`,
      'G / S move / scale the selected group (click / Enter keeps, Esc cancels) · X / Delete deletes it',
      '[ ] or the wheel: brush size · Alt + wheel over a group: looser / tighter',
      `${k('tracking.groupsCircle', 'W')} circle to fill · ${k('tracking.groupsGrow', 'E')} grow · ${k('tracking.groupsKnot', 'K')} knot brush (the knot is a section of the penis) · ${k('tracking.groupsIgnore', 'V')} ignore region`,
      `Over a group: 1 / 2 / 3 make it Bottom / Top / Extra · F flips its side L / R (the character’s own left / right; nothing known: their L)${G.labelMode ? '' : ' (off the groups F flips the scene)'}`,
      `${k('tracking.groupsLabels', 'Shift+H')} labels Smart / All / None (Smart: names for the selected, hovered and ‘?’ groups, a tag for the rest) · the labels are drawn inside the parts: a stroke on one paints`,
      `Fill: ${FILL_NAMES[fillStyle] || fillStyle} (${key('tracking.groupsFill') ? key('tracking.groupsFill') + ' or ' : ''}the options: Dither, Hatch, Gradient, Flat) · Dither: square dots dense at the body end of a part, thinning toward the next limb (body cells big, each segment out smaller); Hatch: lines along each limb · the character’s L side: mirrored dots / dashed lines`,
      'A ruler along a part: its depth is measured on the next Track · dotted rings inside it: its contractions are spurt cues (right click: the picker’s switches, or the list row’s icons)',
      `${k('tracking.groupsConfirm', 'Enter')} accepts the suggestions and sure names · ${k('tracking.groupsDecline', 'Shift+Enter')} declines the suggestions`,
      `hold ${PEEK_KEY}: scrub · move the mouse sideways to peek around this frame (← → one frame, Shift fine)${G.groups.length ? '' : ', once a group is painted'}`,
      ...(G.labelMode ? [] : [`${k('tracking.groupsCopyFrom', 'C')} copy the groups from a similar frame`]),
      `${PEEK_KEY} does not play / pause in this tool (the play button does) · Esc closes the picker, the stroke, then the tool${!G.labelMode && key('tracking.groups') ? ` · ${key('tracking.groups')} opens / closes it` : ''}`,
    ].join('\n');
  });
  const ctxLine = $derived.by(() => {
    if (!G.on) return '';
    const pk = G.peek;
    if (pk) return `Peeking ${clock(pk.ms)} · ${pk.k === 0 ? 'the seed frame' : (pk.k > 0 ? '+' : '−') + Math.abs(pk.k) + (Math.abs(pk.k) === 1 ? ' frame' : ' frames')} · release ${PEEK_KEY} to return`;
    if (G.growBusy) return 'grow: SAM is finding the part…';
    if (!G.onFrame || G.xf || G.draft) return '';
    const g = G.hoverK >= 0 ? G.groups[G.hoverK] : null;
    if (g) {
      const paired = PAIRED.includes(isUnassigned(g) ? G.proposalFor(g)?.parts[0]?.part : splitName(g.name).part), ps = paired && isUnassigned(g) ? G.proposedSide(g) : null;
      const why = ps ? ` (${ps.side.toUpperCase()}: ${ps.how === 'own' ? 'yours' : ps.how === 'pair' ? 'the other side is painted' : 'the default, the character’s left'})` : '';
      return `On ${partLabel(g.name)}${flagText(g)}: 1 / 2 / 3 Bottom / Top / Extra · F ${paired ? `flips its side, the character’s own L / R${why}` : 'has no side here'}`;
    }
    return modM ? modHint().replace(`${modTitle}: `, '').replace(/ · $/, '') : '';
  });
  const tool = {
    id: 'tracking.groups', cursor: 'none', frame: 'var(--intent)',   // painting is a mode: the stage's border says so
    down(p, e) {
      if (e.button !== 0 || !G.on) return false;
      if (G.peek) return true;   // peeking: a press does nothing (moving the mouse scrubs), never paints
      if (G.xf) { G.endXf(true); return true; }
      if (G.picker) { G.closePicker(); return true; }
      if (G.onFrame) notesOpen = false;   // paw-i5qx: painting closes the notes card (off the frame it stays: it says why nothing paints)
      const er = e.shiftKey !== eraseOn;   // the bar's erase toggle: Shift then paints
      if (e.altKey) { altDown = { p, x: e.clientX, y: e.clientY, shift: er, force: e.ctrlKey || e.metaKey }; return true; }   // a click picks, a drag paints with the other snap
      if (G.circle && !er && G.beginLasso(p.rx, p.ry, e.ctrlKey || e.metaKey)) return true;   // paw-714j: a thin loop, filled on pen up
      G.begin(p.rx, p.ry, er, pressureOf(e), e.ctrlKey || e.metaKey);
      return true;
    },
    move(p, e) {
      if (G.peek) return;
      if (drag) { dragMove(e.clientX, e.clientY); return; }
      if (altDown) {   // Alt+drag (paw-ywby): a stroke with the edge snap flipped, from where the button went down
        if (Math.hypot(e.clientX - altDown.x, e.clientY - altDown.y) < 4) return;
        const a = altDown;
        altDown = null;
        if (!G.begin(a.p.rx, a.p.ry, a.shift, pressureOf(e), a.force, true)) return;
      }
      if (G.lasso) { G.moveLasso(p.rx, p.ry); return; }
      if (!G.draft) return;
      // every sample the pointer took since the last event (fast strokes keep their curve, not just straight chords)
      const evs = typeof e?.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      if (evs.length > 1 && lastEnv?.unmap) {
        const ox = p.x - e.clientX, oy = p.y - e.clientY;
        for (const c of evs) { const [nx, ny] = lastEnv.unmap(c.clientX + ox, c.clientY + oy); G.move(nx, ny, pressureOf(c)); }
      } else G.move(p.rx, p.ry, pressureOf(e));
    },
    up(p, e) {
      if (G.peek) return;
      if (drag) { const k = drag.k; if (!dragEnd(e.clientX, e.clientY)) G.pick(k); return; }
      if (altDown) { const a = altDown; altDown = null; G.pickAt(a.p.rx, a.p.ry); return; }
      if (G.lasso) { G.endLasso(); return; }
      G.end();
    },
    context(p) {
      if (G.xf) { G.endXf(false); return true; }
      const k = G.on && G.onFrame ? G.hitAt(p.rx, p.ry) : -1;   // paw-c1m1: the labels are inside the parts: a right click on one is on its part
      if (k >= 0) G.openPicker(k, [p.x, p.y]);
      return true;
    },
  };
  $effect(() => {
    if (!layer) return;
    const offs = untrack(() => [layer.add({ id: 'tracking.groups', order: 25, draw }), layer.addTool(tool)]);
    return () => untrack(() => offs.forEach((f) => f()));
  });
  // the tool owns the pointer while on (the axis tool turns it off); off again, the ROI tool takes over as before
  $effect(() => { if (G.on && tr.axisOn) untrack(() => G.toggle(false)); });
  $effect(() => {
    if (!layer) return;
    const on = G.on && app.mode === 'track', cur = layer.tool;
    untrack(() => {
      if (on && cur !== 'tracking.groups') layer.tool = 'tracking.groups';
      else if (!on && cur === 'tracking.groups') layer.tool = tr.tracker && tr.tracker.roi !== 'none' && tr.busy !== 'track' ? 'tracking.roi' : null;
    });
  });
  $effect(() => { if (app.mode !== 'track' && G.on) untrack(() => G.toggle(false)); });
  $effect(() => { const t = app.player.timeMs; untrack(() => G.follow(t)); });
  // paw-8mf4: a take selected (or the repeats / runs arriving for it) -> fill it from a matching frame when it is empty
  $effect(() => { G.on; G.scene; repeatsOf(app); tr.runs; autoFill(app); untrack(() => G.maybeAutoFill()); });
  // a track job starting closes the tool (the stroke in progress is kept: toggle commits it) so the run shows
  // unobstructed; it does not reopen. Unassigned groups in the range are not tracked: say so.
  const QUIET = ['', 'list', 'scenes', 'describe', 'score', 'seed', 'segment', 'name'];
  let wasTracking = false;
  $effect(() => {
    const b = tr.busy, tracking = !QUIET.includes(b) && !(b === 'groups' && G.busy);
    untrack(() => {
      if (tracking && !wasTracking) {
        if (G.on) G.toggle(false);
        const r = tr.busyRange || app.doc.range, n = r ? unassignedIn(app.doc.scenes, r.t0, r.t1) : 0;
        if (n) app.toast(`${n} group${n === 1 ? '' : 's'} not assigned: not tracked (${key('tracking.groups') || 'Groups'}, then A to assign)`, 'warn');
      }
      wasTracking = tracking;
    });
  });
  // grab / scale: the pointer from where it was when G / S was pressed
  let xfOrigin = null, rafXf = 0;
  $effect(() => { const x = G.xf; untrack(() => { xfOrigin = x && hoverPt ? [hoverPt.x, hoverPt.y] : null; }); });
  function xfMove(x, y) {
    const xf = G.xf, env = lastEnv;
    if (!xf || !env?.unmap) return;
    if (!xfOrigin) xfOrigin = [x, y];
    const [nx, ny] = env.unmap(x, y), [ox, oy] = env.unmap(...xfOrigin), a = env.vw / env.vh || 1;
    const amt = xf.kind === 'grab' ? { dx: nx - ox, dy: ny - oy }
      : { s: Math.min(10, Math.max(0.1, Math.hypot((nx - xf.c[0]) * a, ny - xf.c[1]) / Math.max(1e-3, Math.hypot((ox - xf.c[0]) * a, oy - xf.c[1])))) };
    if (rafXf) cancelAnimationFrame(rafXf);
    rafXf = requestAnimationFrame(() => { rafXf = 0; G.previewXf(amt); });
  }
  // the brush ring follows the pointer; the wheel resizes the brush (Ctrl + wheel still zooms the view)
  $effect(() => {
    if (!G.on || !layer) return;
    const stage = stageEl();
    if (!stage) return;
    const mv = (e) => {
      lastX = e.clientX;
      if (peekDrag) {   // paw-bsyo: the peek key held: the mouse moving sideways scrubs (window-wide, so off the video too)
        if (peekDrag.x0 == null) peekDrag.x0 = e.clientX;
        else G.peekDrag(peekDrag.base, e.clientX - peekDrag.x0, e.shiftKey);
        return;
      }
      const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      // over the picture's canvas itself (not the toolbar, the picker, the simulator or a popover on the stage)
      const over = x >= 0 && y >= 0 && x <= r.width && y <= r.height && e.target instanceof Element && stage.contains(e.target) && e.target.matches('canvas.ov');
      hoverPt = over ? { x, y, erase: e.shiftKey !== eraseOn, force: e.ctrlKey || e.metaKey, f: G.draft ? pressureOf(e) : 1 } : null;
      const n = over && lastEnv?.unmap ? lastEnv.unmap(x, y) : null;
      G.hover = n ? { nx: n[0], ny: n[1], x, y } : null;   // the A key's target
      const hk = n && G.onFrame && !G.draft && !G.xf ? G.hitAt(n[0], n[1]) : -1;   // paw-cnfg: the group the 1 / 2 / 3 / F keys would act on
      if (hk !== G.hoverK) G.hoverK = hk;
      if (G.xf) xfMove(x, y);
      paintCursor();
    };
    // paw-bsyo: hold the peek key (PEEK_CODE, Space) + move the mouse = peek around the seed frame (no button: the window-wide pointermove above scrubs) (Left / Right step a frame); capture phase so the app's keys never see them
    const editing = (t) => t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');
    const pk = (e) => {
      if (!G.on || app.tabs?.hidden) return;   // the home tab hides the editor: Space / Alt are the project page's (paw-shgb)
      // paw-h07u: a lone Alt tap (the loosen / tighten wheel's modifier) puts Windows in menu mode: the pointer stops reaching the page until a click, the ring freezes while the brush works. The tool owns Alt, so its release is swallowed.
      if (e.type === 'keyup' && e.key === 'Alt' && !editing(e.target)) { e.preventDefault(); return; }
      if (e.type === 'keyup') { if (e.code === PEEK_CODE && G.peek) { e.preventDefault(); peekDrag = null; G.peekEnd(); paintCursor(); } return; }
      // the peek key is the tool's while it is open, peek or not (it never reaches the key map: no play / pause in the tool; a
      // text field types it). Its keyup is not stopped: the window's Space-held watchers (CanvasLane, LaneStack) see the release
      if (e.code === PEEK_CODE && !e.ctrlKey && !e.altKey && !e.metaKey && !editing(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); if (G.peek || G.peekStart()) { if (!peekDrag) peekDrag = { x0: lastX, base: G.peek.k }; paintCursor(); } return; }
      if (G.peek && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopImmediatePropagation(); G.peekStep(e.key === 'ArrowRight' ? 1 : -1); peekDrag = { x0: lastX, base: G.peek.k }; }   // the mouse scrubs on from the stepped frame
    };
    const pb = () => { peekDrag = null; G.peekEnd(); };
    window.addEventListener('keydown', pk, true); window.addEventListener('keyup', pk, true); window.addEventListener('blur', pb);
    const kd = (e) => { if (hoverPt && ['Shift', 'Control', 'Meta'].includes(e.key)) { hoverPt = { ...hoverPt, erase: e.shiftKey !== eraseOn, force: e.ctrlKey || e.metaKey }; paintCursor(); } };
    const wh = (e) => {
      if (e.ctrlKey || (e.target instanceof Element && e.target.closest('.gdock, .gside, .gpick'))) return;
      e.preventDefault(); e.stopPropagation();
      if (e.altKey) { if (G.hover) G.dialWheel(e.deltaY || e.deltaX, e.deltaMode, G.hover.nx, G.hover.ny); return; }   // Alt + wheel over a group: looser / tighter (paw-k8jj)
      G.resize(Math.pow(1.0015, -(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY)));
      paintCursor();
    };
    const lv = () => { hoverPt = null; G.hover = null; G.hoverK = -1; paintCursor(); };
    window.addEventListener('pointermove', mv, { passive: true });
    window.addEventListener('keydown', kd); window.addEventListener('keyup', kd);
    stage.addEventListener('pointerleave', lv);
    stage.addEventListener('wheel', wh, { capture: true, passive: false });
    return () => { window.removeEventListener('keydown', pk, true); window.removeEventListener('keyup', pk, true); window.removeEventListener('blur', pb); window.removeEventListener('pointermove', mv); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', kd); stage.removeEventListener('pointerleave', lv); stage.removeEventListener('wheel', wh, { capture: true }); hoverPt = null; paintCursor(); };
  });
  $effect(() => { G.radius; G.active; G.nextName; G.armed; G.xf; G.on; untrack(paintCursor); });   // [ ] / the slider / a chip: the ring at once
  // paw-iwb7: Tab over the timeline opened the tool: the OS pointer onto the picture (where this take was last painted, else the
  // middle of the picture on the stage) once the stage has laid out with the tool open; already over the stage: nothing moves
  let tabSeen = untrack(() => G.tabTo);   // a remount never replays an older Tab
  $effect(() => {
    const n = G.tabTo;
    if (n === tabSeen) return;
    tabSeen = n;
    untrack(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const stage = stageEl(), env = lastEnv;
      if (!G.on || !stage || !env?.map || stage.matches(':hover')) return;
      const p = pictureTarget(stage.getBoundingClientRect(), env.map, G.lastPaintHere);
      if (p) app.backend?.setCursorPosition?.(p[0], p[1]);
    })));
  });

  const list = $derived(G.on ? (app.doc.scenes, G.groups) : []);   // paw-o74b: the groups seeded on the frame on screen (G.groups' indices)
  const others = $derived(G.on && !G.mod ? (app.doc.scenes, tr.runs, G.othersHere()) : []);   // ... and the take's others, where a run tracked them here
  // paw-i5qx: no palette; "the next stroke paints X" (a modifier's seed, the labelling queue, V, Shift+click on a list
  // row) is state, shown as one chip beside the bar (click: back to paint first, assign after)
  const armedName = $derived(G.armed ? (G.activeGroup?.name || G.nextName) : '');
  // the bar folded to its one button (settings)
  const collapsed = $derived(!!app.settings?.get?.('tracking.groups.collapsed', false));
  const foldClick = () => app.settings.set('tracking.groups.collapsed', !collapsed);
  const barAlpha = $derived(app.settings?.get?.('tracking.groups.barOpacity') ?? 48);   // setting: the bar's background over the picture, %
  let eraseOn = $state(false);   // the bar's erase toggle: strokes erase (Shift then paints)
  let notesOpen = $state(false);   // the notes card beside the bar (opens by itself off the groups' frame and on a nudge)
  const autoNote = $derived(G.on && !G.peek && (!G.onFrame || addHere || !!G.pickedAway));   // off the groups' frame, or a frame where painting seeds new groups
  $effect(() => { G.nudge; const on = autoNote; untrack(() => { notesOpen = on; }); });
  const painting = $derived(!!G.draft || !!G.lasso || !!drag?.live);   // a stroke in progress: the bar fades and lets the pointer through
  let unOpen = $state(false);   // the unassigned groups' line opened in place
  $effect(() => { if (!G.on) untrack(() => { rowHover = -1; groupTarget.row = -1; }); });   // a row hovered when the tool closed gets no pointerleave
  const rows = $derived(dockRows(list, unOpen));
  /** A list row's click: select it; Shift+click: the next strokes paint into it wherever they start. */
  const rowClick = (e, k) => (e.shiftKey ? G.armGroup(k) : G.pick(k));
  // paw-ls54 / paw-trjh: the bar is moved onto the stage (VideoPane's, the labelling workspace's), over its left edge, out
  // of the picture's box (paw-8ehz: on the video stage the fitted picture moves beside it, see below). A stroke started on the
  // picture keeps the pointer (capture) under the bar. Its wrapper stays put for Svelte (TrackerDock's portal).
  // paw-q3ad: the bar's width (one column, two or three on a short stage) is published on the stage as --gdock-w, so the cards
  // beside it and the first-run hint (onboard/NextStep.svelte) stay clear of it
  let dockStage = $state(null), dockW = $state(36);
  function onStage(node) {
    dockStage = node.parentElement?.closest('[data-testid="video-stage"], [data-testid="label-stage"]') || null;
    dockStage?.append(node);
    return { destroy() { dockStage?.style.removeProperty('--gdock-w'); node.remove(); dockStage = null; } };
  }
  $effect(() => { dockStage?.style.setProperty('--gdock-w', dockW + 'px'); });
  // paw-8ehz: on the video stage nothing of the tool lies over the picture: the bar in a column at the left, the cards, the
  // context line and the first-run hint in one at the right ([data-gcols], --gcol-r), the picture fitted between them
  // (player.inset; groups-room.js); a stage too narrow even so has the side docks folded while the tool is open, then unfolded
  let folded = [];
  $effect(() => {
    const st = dockStage, p = app.player, bar = dockW + 4;
    if (!st || st.dataset.testid !== 'video-stage' || !p) return;
    const plan = () => {
      const W = st.clientWidth, H = st.clientHeight, vw = p.vw || app.doc.media?.width, vh = p.vh || app.doc.media?.height;
      if (!W || !H || !vw || !vh) return;
      const r = groupsRoom(W, H, vw / vh, bar);
      if (r.fold && app.layout) {   // any side dock open again meanwhile (a layout reset) folds again too
        const open = leaves(app.layout.tree).filter((l) => (l.home === 'left' || l.home === 'right') && !l.collapsed).map((l) => l.home);
        for (const d of open) { app.layout.toggle(d, false); if (!folded.includes(d)) folded.push(d); }
      }
      p.inset = r.inset; st.dataset.gcols = ''; st.style.setProperty('--gcol-r', r.right + 'px');
    };
    const ro = new ResizeObserver(plan);
    ro.observe(st); untrack(plan);
    return () => { ro.disconnect(); p.inset = null; delete st.dataset.gcols; st.style.removeProperty('--gcol-r'); };
  });
  const unfold = () => { const d = folded; folded = []; for (const x of d) app.layout?.toggle(x, true); };
  $effect(() => { if (!G.on) untrack(unfold); });   // the tool closed: the docks it folded come back
  $effect(() => () => untrack(unfold));
  // paw-9qim: the points each pinned group seeds (the tracker's group_points; 0 = auto: groupShare of the box's points),
  // set right here (the same param as the Tracker panel's "Points per group")
  const gpSpec = $derived(tr.tracker?.params?.find((q) => q.key === 'group_points') || null);
  const gpVal = $derived(gpSpec ? +(tr.params.group_points ?? gpSpec.default) || 0 : 0);
  const ptsEach = $derived.by(() => {
    if (!gpSpec) return '';
    const n = +tr.params.box_points || 0, k = G.all.filter((g) => !isIgnore(g) && !isSuggested(g)).length, s = groupShare(n, k);
    if (gpVal > 0) return `${gpVal} pts per group${k ? ` (+${k * gpVal} on top of the ${n})` : ''}`;
    return s ? `≈ ${s.avg} pts per group (${s.base}+, bigger parts more; of the ${n})` : `${n ? Math.max(16, Math.round(0.1 * n)) : 16}+ pts per group`;
  });
  const setGroupPoints = (v) => { if (tr.paramsBy[tr.trackerId]) tr.paramsBy[tr.trackerId].group_points = Math.round(v); };
  const frameOf = (t) => frameAt(t, gridOf(app.player));
  // paw-bsyo: the peek key, held (not pressed): a listener here, not a command. Matched on the physical key (e.code). Space: while
  // the tool is open Space only scrubs (the owner's deliberate exception to "Space is always play / pause": the listener takes
  // it before the key map, so player.toggle never sees it; a press without movement does nothing). Tab opens / closes the tool
  const PEEK_CODE = 'Space', PEEK_KEY = 'Space';
  const clock = (t) => { const s = t / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`; };
  // the active group's (or the stroke's) patches beyond the tracked one
  const islands = $derived.by(() => { G.tick; const d = G.draft; if (d) return d.islands?.length || 0; const g = G.activeGroup; return g && !g.off && !g.points ? G.fitFor(g).islands.length : 0; });
  const nUn = $derived(list.filter(isUnassigned).length);
  // paw-8yip: this take's groups' frame repeats exactly in other takes (copy them there), or a twin of the frame on
  // screen has groups while this take has none (use them)
  const repCopy = $derived(G.on && list.length ? repeatCopyAt(app, G.t) : null);
  const twin = $derived(G.on && !list.length ? twinGroupsAt(app, app.player.timeMs) : null);
  // paw-8mf4: the take was filled from a repeat (all its groups still copies), and a take without groups: its best frame
  const filled = $derived(list.length && list.every(isCopy) ? { kind: list[0].source, from: list[0].from, lined: list.some((g) => g.lined) } : null);
  const best = $derived(G.on && !list.length ? bestPaintMark(app) : null);
  const onBest = $derived(!!best && Math.abs(app.player.timeMs - best.t) <= Math.max(20, (app.player.frameMs || 33) * 0.75));
  // paw-do8a: the frame on screen is in another shot of the take than its groups: new groups for this shot
  const splitNow = $derived(G.on ? G.splitHere : null);
  // paw-o74b: a frame of a seeded take with no groups of its own: painting here adds groups seeded on it
  const addHere = $derived(G.on && !G.mod && G.onFrame && !list.length && others.length > 0);
  const nSug = $derived(list.filter(isSuggested).length);
  const nHeld = $derived((G.held, list, G.heldCount)), young = $derived(youngNote(G.seeder, G.datasets?.info?.()?.name));
  const nUnsure = $derived(list.filter((g) => g.unconfirmed).length);
  // the notes card's content exists (its button shows only then)
  const hasNotes = $derived(G.on && !G.peek && (addHere || !G.onFrame || !!G.pickedAway || !!filled || (!!best && !twin) || !!repCopy?.targets.length || !!twin || islands > 0));
  // the learned seeder in words (toolbar row, tooltip)
  const seedLine = $derived.by(() => { const s = G.seeder; return s?.frames ? `learned from ${s.frames} painted frame${s.frames === 1 ? '' : 's'} · ${s.videos} video${s.videos === 1 ? '' : 's'}${s.images ? ` · ${s.images} image${s.images === 1 ? '' : 's'}` : ''}` : 'not trained yet'; });
  const featText = $derived(featuresLine(G.seeder));
  const scoreText = $derived(scoreLine(G.seeder?.score)), scoreChg = $derived(scoreChange(G.seeder?.score)), scoreWeak = $derived(weakestLine(G.seeder?.score, partLabel));
  const seedTip = $derived.by(() => {
    const s = G.seeder, parts = s?.parts && !Array.isArray(s.parts) ? Object.entries(s.parts) : [];
    const used = parts.filter(([, v]) => v.use).map(([p, v]) => `${p} ${v.labels}`), cam = parts.filter(([, v]) => !v.use).map(([p]) => p);
    const folders = G.seedFolders;
    return `Suggest's parts come from a small model trained on your painted groups (accepted and fixed suggestions count). ${s?.frames ? `Learned: ${used.join(', ') || 'none'}; the tagger's heat for ${cam.join(', ') || 'none'} (fewer than 5 painted from 2 videos).` : 'Paint groups and save: it trains then.'} It retrains after a save with new paint. Library: ${folders.length ? folders.join('; ') : 'the folders of your recent projects (none yet)'} (setting tracking.seeder.folders)`;
  });
  // paw-ls54: the seeder is one short line in the dock; every number it used to show on lines of its own is in its hover
  const seedShort = $derived(`Seeder${G.datasets.active ? ' ' + G.datasets.active.name : ''} · ${G.seeder?.frames ? `${G.seeder.frames} frame${G.seeder.frames === 1 ? '' : 's'}` : 'not trained'}`);
  const seedHover = $derived.by(() => {
    const ov = overviewLine(G.overview), lines = [`Seeder${G.datasets.active ? ` (${G.datasets.active.name})` : ''}: ${seedLine}`];
    if (featText) lines.push(featText);
    if (ov && G.overview.filter((o) => o.trained).length > 1) lines.push(`datasets: ${ov}${G.cross ? ` · ${crossLine(G.cross, (id) => G.datasets.reg?.datasets.find((d) => d.id === id)?.name || id)}` : ''}`);
    if (scoreText) lines.push(`${scoreText}${scoreChg ? ` (${scoreChg.split(' since')[0]})` : ''}${scoreWeak ? ` · weakest ${scoreWeak}` : ''}`);
    if (young) lines.push(young);
    return lines.join('\n');
  });
  // ... and with what they mean (click the line): the old per-line tips, in a popover that scrolls
  const seedMore = $derived([seedTip, featText ? 'Features: which model reads the pictures for the seeder. taggerine is an optional pack (found 59 % against 51 % for Hydra on 52 labelled pictures: probably better, not proven); nothing is downloaded by the app. Setting tracking.seeder.features: auto | hydra' : '', G.overview.filter((o) => o.trained).length > 1 ? 'Datasets: each is scored on its own pictures (not comparable); the second part scores every head on the labels of the active dataset. Switch datasets in File > Label images for the seeder' : '', scoreText ? scoreTip(G.seeder?.score, partLabel) : ''].filter(Boolean).join('\n\n'));
  // the picker's anchor: where it was asked for, else next to its group
  const pickAt = $derived.by(() => {
    G.tick; const pk = G.picker;
    if (!pk) return null;
    if (pk.at) return pk.at;
    const g = list[pk.k], env = lastEnv;
    if (!g?.poly?.length || !env?.map) return [stageW / 2, stageH / 2];
    let best = null;
    for (const q of g.poly) { const m = env.map(q[0], q[1]); if (!best || m[0] > best[0]) best = m; }   // its right-most point
    return best;
  });
  // paw-6m6o: no labels (None): the name of the group under the pointer as a tip beside it; one character: its name said once
  // here (the labels leave it out), on the labels chip beside the bar (click / Shift+H: the next mode)
  const noneTip = $derived.by(() => { if (labelMode !== 'none' || !G.on || !hoverPt || G.draft) return ''; G.tick; const g = G.hoverK >= 0 ? G.groups[G.hoverK] : null; return g ? nameText(g, G.onFrame && isUnassigned(g) ? G.proposalFor(g) : null) + flagText(g) : ''; });
  const whoAll = $derived(G.on ? sharedWho([...list, ...others.map((o) => o.g)].map((g) => g.name)) : null);
  const LABEL_TIPS = { smart: 'names for the selected, hovered and ‘?’ groups, a short tag for the rest (hover it)', all: 'every name, none over another', none: 'hover a group for its name' };
  const labelTip = $derived(`Labels: ${LABEL_MODE_NAMES[labelMode] || labelMode}, ${LABEL_TIPS[labelMode] || ''}${whoAll && labelMode !== 'none' ? `\nEvery group is ${whoName(whoAll)}’s: the labels leave the name out` : ''}\nClick: the next (Smart, All, None)`);
  const pulseOn = $derived(app.settings?.get?.('tracking.groups.pulse', true) !== false);   // setting 'tracking.groups.pulse': false = the highlight stays, static
  const BUSY = busyCells();   // the grow mark's dither cells, centred on the prompt point
  const partKey = (p, sd) => 'part:' + p + (sd || '');
</script>

{#if layer && G.on && app.mode === 'track'}
  {#if hl}
    <!-- the active group: drawn once per change; the pulse / marching dashes are CSS (nothing runs per frame) -->
    <svg class="ghl" class:still={!pulseOn} width={hl.w} height={hl.h} viewBox="0 0 {hl.w} {hl.h}" aria-hidden="true">
      {#if hl.veil}<path d="M0 0H{hl.w}V{hl.h}H0Z {hl.d}" fill="rgba(0, 0, 0, {ASSIGN_VEIL})" fill-rule="evenodd" />{/if}
      {#if hl.d}<path d={hl.d} class="dk" /><path d={hl.d} class="lt" class:pulse={hl.assigning} /><path d={hl.d} class="dash" class:march={hl.assigning} style:stroke={hl.color} />{/if}
      {#if hl.ptr?.kind === 'arrow'}<g transform="translate({hl.ptr.x} {hl.ptr.y}) rotate({hl.ptr.ang})"><path d="M11 0L-8 9L-3 0L-8 -9Z" class="arrow" /></g>{/if}
      {#if hl.ptr?.kind === 'ring'}<circle cx={hl.ptr.x} cy={hl.ptr.y} r={TINY_PX} class="dk" /><circle cx={hl.ptr.x} cy={hl.ptr.y} r={TINY_PX} class="lt" />{/if}
      {#if hl.busy}<g transform="translate({hl.busy.x} {hl.busy.y})" class="busy" style:--bc={hl.color || null}>{#each BUSY as c}<rect x={c.x - 1} y={c.y - 1} width="6" height="6" class="bh" style:--t={c.t} />{/each}{#each BUSY as c}<rect x={c.x} y={c.y} width="4" height="4" class="bc" style:--t={c.t} />{/each}<rect x="-26" y="20" width="52" height="17" class="pill" /><text x="0" y="32" class="pilltx" style="font-size: var(--fs-1)">grow…</text></g>{/if}
      {#if hl.dial}<rect x={hl.dial.x - 4 * hl.dial.text.length - 6} y={hl.dial.y - 13} width={8 * hl.dial.text.length + 12} height={19} class="pill" /><text x={hl.dial.x} y={hl.dial.y + 1} class="pilltx" style="font-size: var(--fs-2)">{hl.dial.text}</text>{/if}
      {#if hl.pill}<rect x={hl.pill.x} y={hl.pill.y} width={hl.pill.w} height={hl.pill.h} class="pill" /><text x={hl.pill.x + hl.pill.w / 2} y={hl.pill.y + 14} class="pilltx">{hl.pill.text}</text>{/if}
    </svg>
  {/if}
  <canvas class="gstroke" bind:this={strokeCv} aria-hidden="true"></canvas>
  <canvas class="gcursor" bind:this={cur} aria-hidden="true"></canvas>
  {#if noneTip}<div class="k-tip gtip" role="tooltip" data-testid="groups-label-tip" style:left="{hoverPt.x + 16}px" style:top="{hoverPt.y + 18}px">{noneTip}</div>{/if}
  <!-- paw-i5qx: the bar, the chips beside it and the context line, moved onto the stage together (onStage) -->
  <div class="gdock-at"><div class="gtools" class:painting use:onStage>
    <div class="gdock" class:col={collapsed} bind:offsetWidth={dockW} style:--gbar-a="{barAlpha}%" data-testid="groups-tools" role="toolbar" aria-orientation="vertical" aria-label="Groups">
      <button type="button" class="tb" data-testid="groups-collapse" aria-label={collapsed ? 'Open the Groups bar' : 'Fold the Groups bar'} onclick={foldClick}
        {@attach tooltip({ text: collapsed ? 'Open the Groups bar' : 'Fold the Groups bar', placement: 'right' })}><Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} /></button>
      {#if !collapsed}
        <button type="button" class="tb info" aria-label="Keys and mouse" data-testid="groups-keys" {@attach tooltip({ text: keyList, placement: 'right-start' })}><Icon name="info" size={14} /></button>
        <span class="sep"></span>
        <button type="button" class="tb" class:on={eraseOn} aria-pressed={eraseOn} aria-label="Erase" data-testid="groups-erase" onclick={() => { eraseOn = !eraseOn; if (hoverPt) hoverPt = { ...hoverPt, erase: !hoverPt.erase }; paintCursor(); }}
          {@attach tooltip({ text: eraseOn ? 'Erasing: Shift paints' : 'Erase: strokes erase until clicked again', shortcut: 'Shift', placement: 'right' })}><Icon name={eraseOn ? 'eraser' : 'brush'} size={15} /></button>
        <button type="button" class="tb" class:on={G.circle} aria-pressed={G.circle} aria-label="Circle to fill" data-testid="groups-circle" onclick={() => app.settings.set('tracking.groups.circle', !G.circle)}
          {@attach tooltip({ text: 'Circle to fill: loop a part, let go', shortcut: key('tracking.groupsCircle'), placement: 'right' })}><Icon name="lasso" size={15} /></button>
        <button type="button" class="tb" class:on={G.grow} class:bad={!!G.growNote} aria-pressed={G.grow} aria-label="Grow" data-testid="groups-grow" onclick={() => app.settings.set('tracking.groups.grow', !G.grow)}
          {@attach tooltip({ text: G.growNote ? `Grow: the last try failed (${G.growNote})` : 'Grow: dab a part, SAM finds its outline', shortcut: key('tracking.groupsGrow'), placement: 'right' })}><Icon name="grow" size={15} /></button>
        <button type="button" class="tb" class:on={G.knotBrush} aria-pressed={G.knotBrush} aria-label="Knot brush" data-testid="groups-knot" onclick={() => G.toggleKnot()}
          {@attach tooltip({ text: 'Knot brush: paint the knot on a penis', shortcut: key('tracking.groupsKnot'), placement: 'right' })}><Icon name="dot" size={15} /></button>
        <button type="button" class="tb val" aria-label="Brush size" data-testid="groups-size" onpointerdown={sizeDown} onwheel={sizeWheel}
          {@attach tooltip({ text: 'Brush size: drag up or down, or scroll', shortcut: key('tracking.groupsBigger'), placement: 'right' })}><span class="szw"><span class="szdot" style:width="{sizeDot}px" style:height="{sizeDot}px"></span></span><span class="v num">{(G.radius * 100).toFixed(1)}</span></button>
        <button type="button" class="tb val" class:on={G.snap} aria-pressed={G.snap} aria-label="Edge snap" data-testid="groups-snap" onpointerdown={magDown} onwheel={magWheel} onclick={clickUnlessDrag(() => app.settings.set('tracking.groups.snap', !G.snap))}
          {@attach tooltip({ text: `Edge snap ${G.snap ? 'on' : 'off'}, ${G.snapStrength} %: drag up or down to set`, placement: 'right' })}><Icon name={G.snap ? 'magnet' : 'magnet-off'} size={13} /><span class="v num">{G.snapStrength}</span></button>
        <span class="sep"></span>
        <button type="button" class="tb whob" style:--c={whoColor(G.who)} aria-label="Character: {whoName(G.who)}" data-testid="groups-who" onclick={() => G.setWho(nextWho(G.who))}
          {@attach tooltip({ text: `New groups are ${whoName(G.who)}'s · click: the next one`, shortcut: key('tracking.groupsWho' + (WHOS.indexOf(G.who) + 1)), placement: 'right' })}>{whoShort(G.who)}</button>
        <button type="button" class="tb prim" aria-label="Suggest" data-testid="groups-suggest" aria-busy={G.busy || undefined} disabled={G.busy || !G.onFrame || (!!tr.busy && tr.busy !== 'groups' && tr.busy !== 'seed' && tr.busy !== 'name')} onclick={() => G.suggest()}
          {@attach tooltip({ text: 'Suggest the parts on this frame', shortcut: key('tracking.groupsSuggest'), placement: 'right' })}>{#if G.busy}<Spinner size={14} label="" />{:else}<Icon name="wand" size={15} />{/if}</button>
        {#if nSug || nUnsure}<button type="button" class="tb" aria-label="Accept all" data-testid="groups-accept" onclick={() => G.accept()}
          {@attach tooltip({ text: 'Accept every suggestion as it is', shortcut: key('tracking.groupsConfirm'), placement: 'right' })}><Icon name="check" size={15} /><b class="badge num">{nSug + nUnsure}</b></button>{/if}
        {#if !G.labelMode && !modM}<button type="button" class="tb" class:on={!!G.copy} aria-pressed={!!G.copy} aria-label="Copy from a similar frame" data-testid="groups-copy-open" disabled={G.busy} onclick={() => G.openCopy()}
          {@attach tooltip({ text: 'Copy the groups from a similar frame', shortcut: key('tracking.groupsCopyFrom'), placement: 'right' })}><Icon name="copy" size={15} /></button>{/if}
        <Popover title="{modM ? 'Seed' : 'Groups'} · {shotLabelOf(app.doc.scenes || [], G.scene)}" placement="right-start" class="gpop" onclose={() => { rowHover = -1; groupTarget.row = -1; }}>
          {#snippet trigger({ props })}<button type="button" {...props} class="tb" aria-label="Groups list" data-testid="groups-list-open"
            {@attach tooltip({ text: `${list.length} group${list.length === 1 ? '' : 's'}${nUn ? `, ${nUn} unassigned` : ''}: names, visibility, delete`, placement: 'right' })}><Icon name="list" size={15} />{#if list.length}<b class="badge num" class:warn={nUn > 0}>{list.length}</b>{/if}</button>{/snippet}
          <div class="gpl">
            <div class="row">
              <span class="k-hint">{whoName('c1')} / {whoName('c2')}</span>
              <span class="grow"></span>
              <Button size="sm" variant="ghost" icon="flip-h" disabled={!list.some((g) => g.who)} onclick={() => G.swap()} tip="Swap Bottom and Top in this take">Swap</Button>
            </div>
            {#if nUnsure || nSug || nHeld}
              <div class="note sug">
                <span class="k-hint" data-testid="groups-shown" {@attach tooltip(young || '')}>{nUnsure ? 'Dotted \'?\': re-found after a cut' : shownLine(nSug, nHeld, G.suggestConf)}</span>
                <span class="acts">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="mag" onwheel={confWheel} onpointerdown={confDown} data-testid="groups-conf" {@attach tooltip({ text: 'Shown confidence: drag up or down, or scroll', shortcut: key('tracking.suggestConfMore') })}>
                    <span class="k-hint">shown ≥</span><span class="k-hint num mag-v" data-testid="groups-conf-v">{Math.round(G.suggestConf * 100)}</span>
                  </span>
                  <span class="grow"></span>
                  <Button size="sm" variant="ghost" icon="check" onclick={() => G.accept()} tip="Accept every suggestion as it is" shortcut={key('tracking.groupsConfirm')}>All</Button>
                  {#if nSug}<Button size="sm" variant="ghost" icon="close" data-testid="groups-decline" onclick={() => G.declineAll()} tip="Decline every pending suggestion" shortcut={key('tracking.groupsDecline')}>All</Button>{/if}
                </span>
              </div>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="glist" data-testid="groups-list" onpointerleave={() => (rowHover = -1)}>
              {#each rows as r (r.fold != null ? 'fold' : r.k)}
                {#if r.fold != null}
                  <div class="fold" data-testid="groups-unassigned">
                    <button type="button" class="foldb" aria-expanded={unOpen} data-testid="groups-unassigned-toggle" onclick={() => (unOpen = !unOpen)} {@attach tooltip(unOpen ? 'Fold the unassigned groups' : 'Not tracked until assigned · click: list them')}><Icon name={unOpen ? 'chevron-down' : 'chevron-right'} size={10} /><b class="num">{r.fold}</b> unassigned</button>
                    {#if G.onFrame}<Button size="sm" variant="primary" onclick={() => G.startPass()} tip="Assign each unassigned group in turn" shortcut={key('tracking.groupsAssign')}>Assign all</Button>{/if}
                  </div>
                {:else}
                  {@const k = r.k}
                  {@const g = list[k]}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="grp" class:on={k === G.active} class:hov={k === G.hoverK || k === rowHover} class:off={g.off} class:unsure={g.unconfirmed} class:un={isUnassigned(g)} class:sug={isSuggested(g)} class:ign={isIgnore(g)} style:--c={groupColor(g.name)} data-k={k}
                    onpointerenter={() => { rowHover = k; groupTarget.row = k; }} onpointerleave={() => { if (rowHover === k) rowHover = -1; if (groupTarget.row === k) groupTarget.row = -1; }} oncontextmenu={(e) => { e.preventDefault(); G.openPicker(k); }}>
                    <button type="button" class="pick" onpointerdown={(e) => grab(e, { kind: 'group', k, text: partLabel(g.name), color: groupColor(g.name) })} onclick={clickUnlessDrag((e) => rowClick(e, k))}
                      {@attach tooltip(`${partLabel(g.name)}${isCopy(g) ? ` (copied from ${clock(g.from)})` : g.source && g.source !== 'user' ? ` (suggested${g.score != null ? ', ' + Math.round(g.score * 100) + ' %' : ''})` : ''} · click selects · Shift+click paints into it${G.proposalFor(g) ? ' · ' + guessText(G.proposalFor(g), partWord) : ''}`)}><i></i><span class="nm">{partLabel(g.name)}{g.unconfirmed ? ' ?' : ''}{isSuggested(g) && g.who && g.who_conf < WHO_GATE ? ' · who?' : ''}{#if G.proposalFor(g)}<span class="prop" class:ok={G.proposalFor(g).auto} data-testid="groups-proposal">{G.proposalFor(g).auto ? ' ' + (sureWho(G.proposalFor(g)) ? partLabel(proposedName(G.proposalFor(g), sureWho(G.proposalFor(g)), G.sideSet.get(g))) : partWord(G.proposalFor(g).parts[0].part)) + '?' : ' ?'}</span>{/if}</span></button>
                    {#if !isUnassigned(g) && !isIgnore(g) && G.seedsOfPart(g.name).length > 1}<span class="seeds" data-testid="groups-seed-chips">{#each G.seedsOfPart(g.name) as st (st)}<button type="button" class="seed num" class:here={Math.abs(st - G.t) <= 1} onclick={() => G.goToFrame(st)} {@attach tooltip(Math.abs(st - G.t) <= 1 ? 'Seeded on this frame and others; Delete removes this seed' : `Seeded on frame ${frameOf(st)} too · click: go there`)}>f{frameOf(st)}</button>{/each}</span>{/if}
                    {#if isSuggested(g)}{@const c = confidenceOf(g)}
                      {#if c != null}<span class="conf" class:tent={isTentative(g)} style:--v={c} aria-label={`confidence ${Math.round(c * 100)} %`} {@attach tooltip(`Confidence ${Math.round(c * 100)} %${isTentative(g) ? ' (tentative)' : ''}${outlineNote(g)}`)}><i></i></span>{/if}
                      <button type="button" class="eye ok" aria-label={`Accept ${partLabel(g.name)}`} onclick={() => G.accept(k)} {@attach tooltip('Accept: it becomes a painted group')}><Icon name="check" size={12} /></button>
                    {/if}
                    {#if canPulse(g)}<button type="button" class="eye pulse" class:on={isPulse(g)} aria-pressed={isPulse(g)} aria-label={`${partLabel(g.name)}: spurt pulse cue`} data-command="tracking.groupsPulse" onclick={() => { groupTarget.row = k; app.commands.run('tracking.groupsPulse', { k }); }}
                      {@attach tooltip(isPulse(g) ? 'Spurt cue: its contractions mark spurts · click: off' : 'Use its contractions as spurt cues')}><Icon name="heart-rate" size={12} /></button>{/if}
                    {#if canShaft(g)}{@const on = isShaft(g, G.scenes[G.scene])}<button type="button" class="eye shaft" class:on aria-pressed={on} aria-label={`${partLabel(g.name)}: measure how much is inside`} data-command="tracking.groupsDepth" onclick={() => { groupTarget.row = k; app.commands.run('tracking.groupsDepth', { k }); }}
                      {@attach tooltip(on ? 'Depth: Track measures how much is inside · click: off' : 'Track measures how much of the shaft is inside')}><Icon name="ruler" size={12} /></button>
                    {:else if canDepth(g)}{@const on = isDepth(g)}<button type="button" class="eye shaft" class:on aria-pressed={on} aria-label={`${partLabel(g.name)}: measure depth with SAM`} data-testid="groups-depth" data-command="tracking.groupsDepth" onclick={() => { groupTarget.row = k; app.commands.run('tracking.groupsDepth', { k }); }}
                      {@attach tooltip(on ? 'Depth with SAM on the next Track · click: off' : 'Measure its depth with SAM on the next Track')}><Icon name="ruler" size={12} /></button>{/if}
                    <button type="button" class="eye" aria-label={g.off ? `Use ${partLabel(g.name)} again` : `Leave ${partLabel(g.name)} out of Track`} onclick={() => G.toggleOff(k)} {@attach tooltip(g.off ? 'Left out of Track · click: use it again' : 'Click: leave it out of Track')}><Icon name={g.off ? 'eye-off' : 'eye'} size={12} /></button>
                    <button type="button" class="eye del" aria-label={`Delete ${partLabel(g.name)}`} data-testid="groups-delete" onclick={() => G.remove(k)} {@attach tooltip({ text: isSuggested(g) ? 'Delete this suggestion' : 'Delete this group', shortcut: key('tracking.groupsDelete') })}><Icon name="trash" size={12} /></button>
                  </div>
                {/if}
              {:else}
                <span class="k-hint empty">Paint anywhere: a stroke off a group starts a new one, then assign</span>
              {/each}
            </div>
            {#if others.length}
              <!-- paw-o74b: the take's groups seeded on other frames: not edited here; a row goes to its seed frame -->
              <div class="glist others" data-testid="groups-others">
                <span class="k-hint lead">Seeded on other frames</span>
                {#each others as o (o.g)}
                  <button type="button" class="grp other" class:off={o.g.off} style:--c={groupColor(o.g.name)} data-name={o.g.name} onclick={() => G.goToFrame(o.t_ms)}
                    {@attach tooltip(`${partLabel(o.g.name)}: ${o.tracked ? 'tracked here' : 'seeded elsewhere'} · click: go to its seed frame`)}>
                    <i></i><span class="nm">{partLabel(o.g.name)}</span><span class="k-hint num">{o.tracked ? 'tracked · ' : ''}{o.seeds.length > 1 ? o.seeds.map((st) => 'f' + frameOf(st)).join(' ') : 'f' + frameOf(o.t_ms)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </Popover>
        {#if hasNotes}<button type="button" class="tb" class:on={notesOpen} class:warn={!G.onFrame} aria-pressed={notesOpen} aria-label="Notes" data-testid="groups-notes" onclick={() => (notesOpen = !notesOpen)}
          {@attach tooltip({ text: G.onFrame ? 'Notes on this take' : 'Not the groups\' frame: where they are', placement: 'right' })}><Icon name={G.onFrame ? 'flag' : 'warning'} size={15} /></button>{/if}
        <Popover title="Groups options" placement="right-end" class="gpop">
          {#snippet trigger({ props })}<button type="button" {...props} class="tb" aria-label="Groups options" data-testid="groups-options" {@attach tooltip({ text: 'Options: ask, fill, points, margin, seeder', placement: 'right' })}><Icon name="sliders" size={15} /></button>{/snippet}
          <div class="opts">
            <Prop {app} key="tracking.groups.labels" expand full label="Labels" data-testid="groups-labels-mode" />
            <Prop {app} key="tracking.groups.fill" expand full label="Fill" data-testid="groups-fill-mode" />
            {#if fillStyle === 'dither'}
              <Prop {app} key="tracking.groups.ditherCell" full />
              <Prop {app} key="tracking.groups.ditherDot" full />
              <Prop {app} key="tracking.groups.ditherOpacity" full />
            {/if}
            <span {@attach tooltip('Open the picker after each new group')}><Checkbox size="sm" checked={G.askAfter} onchange={(v) => app.settings.set('tracking.groups.askAfter', v)} label="Ask for the part after each new group" /></span>
            {#if !G.labelMode}<Prop {app} key="tracking.groups.tabPointer" caption="Tab moves the pointer to the picture" />{/if}
            {#if !G.labelMode}<span {@attach tooltip('Fill an empty take from a repeat of the same picture')}><Checkbox size="sm" checked={autoFill(app)} onchange={(v) => app.settings.set('tracking.groups.autoFromRepeats', v)} label="Fill empty takes from repeated frames" /></span>{/if}
            {#if ptsEach}
              <span {@attach tooltip('Points per group (auto: share the box\'s points)\nAbove 0: extra points per group, more VRAM')}><Slider min={0} max={64} step={4} value={gpVal} onchange={setGroupPoints} format={(v) => (v ? `${v}` : 'auto')} showValue label="Points per group" size="sm" /></span>
              <span class="k-hint num">Track seeds {ptsEach}</span>
            {/if}
            <span data-testid="groups-margin" {@attach tooltip({ text: 'How far inside a part\'s edge the outline sits', shortcut: key('tracking.groupsMarginMore') })}><Slider min={0} max={100} step={1} value={G.margin} onchange={(v) => G.setMargin(v)} format={(v) => `${v} %`} showValue label="Paint margin" size="sm" /></span>
            {#if !G.labelMode}
              <div class="seedrow" data-testid="groups-seeder">
                <details class="seedd"><summary class="seedline" data-testid="groups-seeder-line">{seedShort}</summary><div class="seedmore">{seedHover}{'\n\n'}{seedMore}</div></details>
                <IconButton icon="refresh" size="sm" label="Retrain the seeder now" disabled={G.training} onclick={() => G.retrain()} />
              </div>
            {/if}
          </div>
        </Popover>
        <span class="sep"></span>
      {/if}
      <button type="button" class="tb" aria-label="Close the Groups tool" data-testid="groups-close" onclick={() => G.toggle(false)} {@attach tooltip({ text: 'Close the Groups tool', shortcut: 'Esc', placement: 'right' })}><Icon name="close" size={14} /></button>
    </div>
    <div class="gside">
      {#if modM}
        <div class="card">
          <span class="k-hint num" data-testid="groups-seed-of" {@attach tooltip('Strokes paint this modifier\'s seed')}>{modTitle.replace('Seed · ', '')}</span>
          <Button size="sm" variant="ghost" icon="arrow-left" data-testid="groups-seed-back" onclick={() => { G.mod = null; }} tip="Back to the shot's groups (the seed stays)">Shot's groups</Button>
        </div>
      {/if}
      {#if list.length > 1}<Button size="sm" variant="ghost" class="lmode" data-testid="groups-labels" data-command="tracking.groupsLabels" onclick={() => app.commands.run('tracking.groupsLabels')}
        tip={labelTip} shortcut={key('tracking.groupsLabels')}>{LABEL_MODE_NAMES[labelMode] || labelMode} labels{#if whoAll && labelMode !== 'none'}<span class="k-hint">&nbsp;· {whoName(whoAll)}</span>{/if}</Button>{/if}
      {#if armedName}<button type="button" class="armed" data-testid="groups-armed" style:--c={groupColor(armedName)} onclick={() => G.disarm()} {@attach tooltip('Strokes paint this part · click: paint first')}><i></i>paints {partLabel(armedName)} ✕</button>{/if}
      {#if notesOpen && hasNotes && !collapsed}
        <div class="card notes" data-testid="groups-notes-card">
          {#if addHere && !G.pickedAway}
            <div class="note" data-testid="groups-add-here">
              <span {@attach tooltip('A part painted here is seeded on this frame')}>Painting here adds groups seeded on frame <b class="num">{frameOf(G.t)}</b> <span class="k-hint num">{clock(G.t)}</span></span>
              <span class="acts">
                <Button size="sm" variant="ghost" icon="arrow-left" data-testid="groups-goto-seed" onclick={() => G.goToFrame()} tip="Go to the nearest seed frame of this take">Go there</Button>
                {#if G.seedFrames.length === 1}<Button size="sm" variant="ghost" icon="arrow-down" onclick={() => G.moveHere()} tip="Move the take's groups to this frame">Move here</Button>{/if}
                {#if splitNow}<Button size="sm" variant="ghost" icon="plus" onclick={() => G.newHere()} tip="Give this shot groups of its own">New groups for this shot</Button>{/if}
              </span>
            </div>
          {/if}
          {#if G.pickedAway}
            {@const pk = G.pickedAway}
            <!-- paw-o74b made every frame of the take paint (onFrame is true off the seed frames): Suggest's pick is said here -->
            <div class="note" data-testid="groups-frame">
              <span {@attach tooltip(`Suggest's pick: ${pk.parts ?? '?'} parts vs ${pk.here ?? '?'} on frame ${frameOf(pk.from)}`)}>Suggest picked frame <b class="num">{frameOf(pk.t)}</b> <span class="k-hint num">{clock(pk.t)}</span>{#if pk.parts != null} <span class="k-hint">· {pk.parts} parts vs {pk.here ?? '?'} here</span>{/if}</span>
              <span class="acts"><Button size="sm" variant="ghost" icon="arrow-left" data-testid="groups-goto-seed" onclick={() => G.goToFrame(pk.t)} tip="Go to the frame Suggest picked">Go there</Button></span>
            </div>
          {:else if !G.onFrame}
            {#key G.nudge}
              <div class="note" data-testid="groups-frame">
                <span {@attach tooltip(G.picked && G.picked.t === G.t && G.picked.parts != null ? `Suggest's pick: ${G.picked.parts} parts vs ${G.picked.here ?? '?'} on frame ${frameOf(G.picked.from)}` : 'The groups are painted on one frame of the take')}>{G.picked && G.picked.t === G.t && list.some(isSuggested) ? 'Suggest picked' : list.length ? 'Groups on' : 'Painting on'} frame <b class="num">{frameOf(G.t)}</b> <span class="k-hint num">{clock(G.t)}</span></span>
                {#if splitNow}<span class="k-hint">{shotLabelOf(app.doc.scenes || [], splitNow.k)} shares them (a camera move): paint here for its own</span>{/if}
                <span class="acts">
                  <Button size="sm" variant="ghost" icon="arrow-left" data-testid="groups-goto-seed" onclick={() => G.goToFrame()} tip="Go to the groups' frame">Go there</Button>
                  {#if list.length}<Button size="sm" variant="ghost" icon="arrow-down" onclick={() => G.moveHere()} tip="Move the take's groups to this frame">Move here</Button>{/if}
                  {#if splitNow}<Button size="sm" variant="ghost" icon="plus" onclick={() => G.newHere()} tip="Give this shot groups of its own">New groups for this shot</Button>{/if}
                </span>
              </div>
            {/key}
          {/if}
          {#if filled}
            <div class="note cta" data-testid="groups-filled">
              <span>{filled.kind === 'run' ? 'Points from the run at' : 'Groups from'} <b class="num">{clock(filled.from)}</b>{filled.lined ? ' · lined up here' : filled.kind === 'run' ? ' · the same frame' : ' · same frame'}</span>
              <span class="acts"><Button size="sm" variant="ghost" icon="close" onclick={() => dropFill(app, G.scene)} tip="Remove the copied groups (one undo step)">Drop</Button></span>
            </div>
          {/if}
          {#if best && !twin}
            <div class="note cta" data-testid="groups-best">
              <span>{#if onBest}This is the best frame to paint{:else}Best frame to paint <b class="num">{clock(best.t)}</b>{/if} <span class="k-hint num">· repeats {best.repeats}×{best.covers ? `, covers ${best.covers} take${best.covers === 1 ? '' : 's'}` : ''}{best.loop ? ' · your loop frame' : ''}</span></span>
              {#if !onBest}<span class="acts"><Button size="sm" variant="ghost" icon="arrow-left" onclick={() => app.player.seek(best.t)} tip="Go to the best frame to paint">Go there</Button></span>{/if}
            </div>
          {/if}
          {#if repCopy?.targets.length || twin}
            <div class="note" data-testid="groups-repeats">
              {#if repCopy?.targets.length}
                {@const n = repCopy.targets.length}
                <span>The groups' frame repeats exactly in {n} other take{n === 1 ? '' : 's'}{repCopy.skipped.length ? ` (+${repCopy.skipped.length} with groups of their own)` : ''}</span>
                <span class="acts"><Button size="sm" variant="ghost" icon="copy" onclick={() => copyGroupsToRepeats(app, G.t)} tip="Copy these groups to each repeat of this frame">Copy to {n} repeat{n === 1 ? '' : 's'}</Button></span>
              {/if}
              {#if twin}
                <span>Frame <b class="num">{frameOf(twin.t)}</b> of this take shows the picture of {twin.kind === 'run' ? 'a tracked frame' : 'a painted frame'}</span>
                <span class="acts"><Button size="sm" variant="ghost" icon="copy" onclick={() => useTwinGroups(app, app.player.timeMs)} tip={twin.kind === 'run' ? 'Seed this take with the run\'s points there' : 'Use that frame\'s groups on this take'}>{twin.kind === 'run' ? 'Use points from the run at' : 'Use groups from'} {clock(twin.from)}</Button></span>
              {/if}
            </div>
          {/if}
          {#if islands > 0}
            <div class="note" data-testid="groups-patches">
              <span>{islands} more patch{islands === 1 ? '' : 'es'} (dashed): only the largest is tracked</span>
              {#if !G.draft}<span class="acts">
                <Button size="sm" variant="ghost" onclick={() => G.split()} tip="Each patch its own group">Split</Button>
                <Button size="sm" variant="ghost" onclick={() => G.split(G.active, true)} tip="Erase the smaller patches">Drop them</Button>
              </span>{/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {#if ctxLine}<div class="ctx" data-testid="groups-context">{ctxLine}</div>{/if}
  </div></div>
  {#if G.copy || G.copyWait}<CopyStrip {app} {G} />{/if}
  {#if G.picker && pickAt}<GroupsPicker {G} {grab} unlessDrag={clickUnlessDrag} x={pickAt[0]} y={pickAt[1]} W={stageW} H={stageH} />{/if}
  {#if ghost}<div class="gghost" style:left="{ghost.x + 10}px" style:top="{ghost.y + 8}px" style:--c={ghost.color}><i></i>{ghost.text}</div>{/if}
{/if}

<style>
  /* the stage is `contain: strict` (VideoPane): fixed = pinned to the stage, not to the picture box this plug-in sits
     in (zoomed in, that box is far off-stage) */
  .gcursor { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 11; }
  .gstroke { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9; }
  .ghl { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10; overflow: hidden; }
  .ghl path, .ghl circle { fill: none; stroke-linejoin: round; }
  .ghl .dk { stroke: color-mix(in srgb, var(--media-bg) 90%, transparent); stroke-width: 7; }
  .ghl .lt { stroke: color-mix(in srgb, var(--on-media) 95%, transparent); stroke-width: 4; }
  .ghl .dash { stroke-width: 2; stroke-dasharray: 7 7; }
  .ghl .lt.pulse { animation: gpulse calc(var(--t-slow) * 5) ease-in-out infinite; }
  .ghl .dash.march { animation: gmarch calc(var(--t-slow) * 3) linear infinite; }
  @property --p { syntax: '<number>'; inherits: true; initial-value: 0.55; }
  .ghl .busy { animation: gbusy calc(var(--t-slow) * 2) ease-in-out infinite alternate; }
  .ghl .bh { fill: color-mix(in srgb, var(--media-bg) 90%, transparent); opacity: clamp(0, (var(--p) - var(--t)) * 40, 1); }
  .ghl .bc { fill: var(--bc, var(--accent)); stroke: none; opacity: clamp(0, (var(--p) - var(--t)) * 40, 1); }
  @keyframes gbusy { from { --p: 0; } to { --p: 1; } }
  .ghl .arrow { fill: var(--on-media); stroke: color-mix(in srgb, var(--media-bg) 90%, transparent); stroke-width: 3; }
  .ghl .pill { fill: color-mix(in srgb, var(--media-bg) 94%, transparent); stroke: color-mix(in srgb, var(--on-media) 85%, transparent); stroke-width: 1; }
  .ghl .pilltx { fill: var(--on-media); font: 600 12px 'Chakra Petch', sans-serif; text-anchor: middle; }
  @keyframes gpulse { 50% { opacity: .5; } }
  @keyframes gmarch { to { stroke-dashoffset: -14; } }
  .ghl.still * { animation: none !important; }
  @media (prefers-reduced-motion: reduce) { .ghl * { animation: none !important; } }
  /* paw-i5qx: the bar, moved onto the stage (onStage): one slim column of icons at the stage's left edge, only as tall as
     its buttons. paw-8ehz: on the video stage the fitted picture keeps beside it (player.inset), elsewhere it lies over the
     picture's edge, translucent; while a stroke is in progress it all but disappears and lets the pointer through. */
  .gdock-at, .gtools { display: contents; }
  /* paw-q3ad: a stage shorter than the bar wraps it into a second (third) column, never a hidden scroll; the first-run hint
     sits right of it (onboard/NextStep.svelte) */
  .gdock { position: absolute; left: 0; top: 0; z-index: 4; pointer-events: auto; max-height: 100%; overflow: visible;
    min-width: 36px; box-sizing: border-box; display: flex; flex-direction: column; flex-wrap: wrap; align-content: flex-start; align-items: center; gap: 1px 3px; padding: 3px 3px 4px;
    user-select: none; -webkit-user-select: none; color: var(--tx); font-size: var(--fs-1);
    background: color-mix(in srgb, var(--bg) var(--gbar-a, 48%), transparent); backdrop-filter: blur(5px) saturate(1.2);
    border: 1px solid color-mix(in srgb, var(--line-2) 70%, transparent); border-width: 0 1px 1px 0; border-radius: 0 0 var(--radius) 0;
    transition: opacity var(--t-quick) var(--ease-out); }
  .gdock > * { flex: none; }
  .gdock.col { padding-bottom: 3px; }
  .sep { width: 20px; height: 1px; margin: 2px 0; background: color-mix(in srgb, var(--line-2) 80%, transparent); }
  .tb { all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; width: 30px; height: 28px; border-radius: var(--radius); color: var(--tx); cursor: pointer; }
  .tb:hover { background: color-mix(in srgb, var(--bg-hover) 85%, transparent); color: var(--tx-hi); }
  .tb:focus-visible { outline: 2px solid var(--focus); }
  .tb.on { color: var(--tx-hi); background: var(--sel-bg); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tx-hi) 30%, transparent); }
  .tb:disabled { opacity: .4; cursor: default; }
  .tb.info { color: var(--tx-mut); cursor: help; }
  .tb.bad { color: var(--warn); }
  .tb.warn { color: var(--warn); }
  .tb.prim { color: var(--accent, var(--tx-hi)); }
  .tb.val { touch-action: none; cursor: ns-resize; }
  .tb.val:has(.v) { grid-template-rows: 15px 9px; height: 30px; align-content: center; }
  .tb .v { font-size: 9px; /* micro, below --fs-1: its box is fixed */ line-height: 9px; color: var(--tx); }
  .szw { display: grid; place-items: center; width: 16px; height: 15px; }
  .szdot { box-sizing: border-box; border-radius: 50%; border: 1.5px solid var(--tx-hi); box-shadow: 0 0 0 1px color-mix(in srgb, var(--media-bg) 50%, transparent); }
  .tb.whob { font-weight: 700; font-size: var(--fs-3); color: var(--c); }
  .badge { position: absolute; right: 0; bottom: 1px; min-width: 9px; padding: 0 2px; border-radius: var(--radius-pill); font-size: 9px; /* micro, below --fs-1: its box is fixed */ line-height: 11px; text-align: center; font-weight: 600;
    color: var(--tx-hi); background: color-mix(in srgb, var(--bg) 80%, transparent); }
  .badge.warn { color: var(--warn); }
  /* beside the bar: the modifier's seed, the armed part, the notes card */
  /* clear of the bar (--gdock-w); the first-run hint is at the stage's foot meanwhile (--ob-h, onboard/NextStep.svelte) */
  .gside { position: absolute; left: calc(var(--gdock-w, 36px) + 4px); top: 4px; z-index: 4; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: min(250px, calc(100% - var(--gdock-w, 36px) - 12px)); pointer-events: none; transition: opacity .12s; }
  .gside { max-height: calc(100% - 8px - var(--ob-h, 0px)); }   /* never down onto the hint: a long card scrolls */
  .gside > * { pointer-events: auto; }
  .gside > .card { min-height: 0; overflow: hidden auto; }
  .card { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px; border-radius: var(--radius); font-size: var(--fs-1); color: var(--tx);
    background: color-mix(in srgb, var(--bg-card) 66%, transparent); backdrop-filter: blur(8px) saturate(1.2); border: 1px solid color-mix(in srgb, var(--line-2) 70%, transparent); }
  .armed { background: none; border: 0; font: inherit; cursor: pointer; padding: 1px 8px; line-height: 18px; display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-1);
    color: var(--tx-hi); border: 1px solid var(--c); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--c) 30%, color-mix(in srgb, var(--bg) 55%, transparent)); backdrop-filter: blur(6px); }
  .gside :global(.lmode) { background: color-mix(in srgb, var(--bg) 55%, transparent); backdrop-filter: blur(6px); }
  .gtip { z-index: 12; pointer-events: none; }
  /* paw-8ehz: on the video stage the cards and the context line keep to the right column, off the picture */
  :global([data-gcols]) .gside { left: auto; right: 4px; align-items: flex-end; max-width: calc(var(--gcol-r, 250px) - 8px); }
  :global([data-gcols]) .ctx { left: auto; right: 4px; max-width: calc(var(--gcol-r, 250px) - 8px); }
  .ctx { position: absolute; left: calc(var(--gdock-w, 36px) + 4px); bottom: calc(4px + var(--ob-h, 0px)); z-index: 4; max-width: calc(100% - var(--gdock-w, 36px) - 12px); pointer-events: none; padding: 2px var(--space-2); border-radius: var(--radius); font-size: var(--fs-1);
    color: var(--tx-hi); background: color-mix(in srgb, var(--bg) 62%, transparent); backdrop-filter: blur(6px); border-left: 2px solid var(--tx-hi); }
  .painting .gdock, .painting .gside { opacity: .12; pointer-events: none; }
  .painting .gside > * { pointer-events: none; }
  /* the blobs view's tracker dock would sit on the picture's edge beside this one: the Groups bar owns the edge while it is up */
  :global([data-testid="video-stage"]:has(> .gtools) .tdock-at) { display: none; }
  /* the popovers from the bar: translucent like it */
  :global(.k-popover.gpop) { background: color-mix(in srgb, var(--bg-card) 72%, transparent); backdrop-filter: blur(10px) saturate(1.2); padding: var(--space-3); }
  :global(.k-popover.gpop .kit-popover-title) { font-size: var(--fs-2); margin-bottom: var(--space-2); }
  .row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
  .row > .k-hint { white-space: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .gpl { display: flex; flex-direction: column; gap: 5px; width: 236px; max-height: min(520px, 70vh); overflow: hidden auto; font-size: var(--fs-1); }
  .opts { display: flex; flex-direction: column; gap: var(--space-2); width: 250px; font-size: var(--fs-1); }
  .note { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--space-1); padding: 2px var(--space-2); border-left: 2px solid var(--warn); background: color-mix(in srgb, var(--warn) 10%, transparent); position: relative; }
  .note::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: var(--warn); opacity: 0; animation: flash var(--t-slow) var(--ease-out); }
  .note.cta, .note.sug { border-left-color: var(--tx-hi); background: color-mix(in srgb, var(--tx-hi) 7%, transparent); }
  .note.cta::after, .note.sug::after { animation: none; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; width: 100%; }
  @keyframes flash { from { opacity: .35; } }
  .glist { flex: 0 1 auto; min-height: 0; overflow: hidden auto; display: flex; flex-direction: column; gap: 1px; border-top: 1px solid var(--line-1); padding-top: 3px; }
  .glist > * { flex: none; }
  .empty { white-space: normal; padding: 2px var(--space-1); }
  .grp { display: flex; align-items: center; min-width: 0; border: 1px solid transparent; border-radius: var(--radius); padding-right: 1px; }
  .grp.hov { background: var(--bg-hover); }
  .grp.on { border-color: var(--c); box-shadow: inset 0 0 0 1px var(--c); }
  .grp.unsure, .grp.un, .grp.ign { border-style: dashed; } .grp.un:not(.on), .grp.ign:not(.on) { border-color: var(--line-1); }
  .grp.sug { border-style: dotted; } .grp.sug:not(.on) { border-color: var(--line-2); }
  .grp.off .pick { opacity: .5; text-decoration: line-through; }
  .pick { background: none; border: 0; color: var(--tx); font: inherit; padding: 0 6px 0 4px; line-height: 18px; display: inline-flex; align-items: center; gap: 4px; touch-action: none; cursor: grab; flex: 1; min-width: 0; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* paw-o74b: groups seeded on other frames: dimmed rows, a click goes to the seed frame */
  .others { min-height: 0; }
  .grp.other { background: none; color: var(--tx); font: inherit; cursor: pointer; gap: 4px; padding: 0 4px; line-height: 18px; opacity: .6; border-style: dashed; border-color: var(--line-1); text-align: left; }
  .grp.other:hover { opacity: 1; background: var(--bg-hover); }
  .seeds { display: flex; gap: 2px; flex: none; margin: 0 2px; }
  .seed { border: 1px solid var(--line-1); border-radius: var(--radius); background: none; color: var(--tx-mut); font-size: var(--fs-1); line-height: 14px; padding: 0 3px; cursor: pointer; }
  .seed:hover { color: var(--tx); background: var(--bg-hover); }
  .seed.here { color: var(--tx); border-color: var(--c); }
  .grp.other .nm { flex: 1; min-width: 0; }
  .grp.other i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .pick i, .armed i, .gghost i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .fold { display: flex; align-items: center; gap: var(--space-1); padding: 1px 0; }
  .foldb { all: unset; flex: 1; display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px; border-radius: var(--radius); color: var(--tx-mut); cursor: pointer; }
  .foldb:hover { background: var(--bg-hover); color: var(--tx); }
  .foldb:focus-visible { outline: 2px solid var(--focus); }
  .foldb b { color: var(--tx-hi); }
  .lead { margin-right: 2px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eye { flex: none; background: none; border: 0; padding: 1px 3px; color: var(--tx-mut); cursor: pointer; display: inline-flex; }
  .eye:hover { color: var(--tx-hi); }
  .eye.del:hover { color: var(--warn); }
  .eye.pulse:not(.on), .eye.shaft:not(.on) { opacity: .45; }
  .eye.pulse.on, .eye.shaft.on { color: var(--c); }
  .mag { display: inline-flex; align-items: center; gap: 2px; flex: none; touch-action: none; cursor: ns-resize; }
  .mag-v { flex: none; min-width: 3ch; text-align: left; white-space: nowrap; }
  .conf { flex: none; display: inline-block; width: 18px; height: 4px; margin: 0 3px; background: var(--line-1); border-radius: var(--radius); overflow: hidden; }
  .conf i { display: block; height: 100%; width: calc(var(--v) * 100%); background: var(--c); }
  .conf.tent i { opacity: .5; }
  .eye.ok:hover { color: var(--ok, var(--tx-hi)); }
  .seedrow { display: flex; align-items: flex-start; gap: var(--space-1); border-top: 1px solid var(--line-1); padding-top: 4px; }
  .seedd { flex: 1; min-width: 0; }
  .seedline { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tx-mut); cursor: pointer; }
  .seedline:hover { color: var(--tx); }
  .seedline:focus-visible { outline: 2px solid var(--focus); }
  .seedmore { max-height: min(320px, 50vh); overflow: auto; white-space: pre-line; color: var(--tx); font-size: var(--fs-1); padding-top: 4px; }
  .gghost { position: fixed; z-index: 14; pointer-events: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--bg) 92%, transparent); border: 1px solid var(--c); color: var(--tx-hi); font-size: var(--fs-1); box-shadow: 0 3px 12px rgba(var(--shade-rgb), .5); }
  .prop { margin-left: 3px; opacity: 0.55; font-style: italic; }
  .prop.ok { opacity: 0.9; }
</style>
