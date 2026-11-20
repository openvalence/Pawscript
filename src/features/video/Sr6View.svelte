<!--
  Sr6View: the six-axis preview over the video (paw-jyde.2; the pure parts, mapping and box geometry in sr6pose.js). A plug-in
  overlay (overlay.js), every tab; on / off = app.player.ui.sr6 (the playback bar's button; double-click = back to its default
  place and view, commands video.sr6 / video.sr6Reset). A small 3-D view of a receiver (a sleeve: its opening ring in the
  stroke colour, a stripe on its up side and a nub on top in the twist colour) on a fixed shaft, posed by the six axes at the
  playhead (60 fps while playing), with a faint dashed neutral pose and the opening's path over the last second. The frame is the
  wearer's (the shaft's owner; the floor = their body, marked "your up" / "your right"); views 3/4, you (the wearer's own eye,
  looking down the shaft), facing (looking back at the wearer), side (their left), feet (from their feet). Six gauges in the lanes'
  axis colours under it (bars for the translations, arcs for the rotations; dim = no data in this shot; dot = measured, ring =
  estimate, ? = read from a guessed view). Hover a gauge: that axis alone in its colour with its travel / turning circle, the
  rest faded; click: solo it (the others held at centre; click again releases). Preview only: never edits a lane.
  Source: the final lanes (live runs in them, paw-x7w7); in the Track tab while a track runs, the stroke as the machine preview
  follows its live trace. Flips / per-shot settings are in those scripts already.
  Pointer: the box only (drag = move, the top-right grip = resize, saved in settings 'video.sr6view' with the view and the
  exaggeration); nothing here takes keyboard focus (Space stays play / pause); display only while an overlay tool other than the
  Track tab's pick tool ('tracking.roi') owns the pointer (as the position bar).
-->
<script>
  import { untrack } from 'svelte';
  import { cssVar } from '../../ui/kit/color.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { followOf } from '../../lib/follow.svelte.js';
  import { posAt } from '../../lib/core/script.js';
  import { sceneAt } from '../../lib/runs.js';
  import { FROM } from '../../lib/six-axis.js';
  import { peekTracking } from '../tracking/tracking.svelte.js';
  import { followedAxesGhosts, frameWords } from '../tracking/axes-derive.js';
  import { IDS, ROT, TCODE, VIEWS, viewOf, SLEEVE, SHAFT, pose, place, openingOf, masked, viewport, valuesAt, trail, pickScripts, hasData,
    qualityAt, gauge, hull, ARC, layout, boxOf, boxMove, boxResize } from './sr6pose.js';

  // the lanes' axis colours, guarded like the Simulator does (the preview works without the lanes feature)
  const mods = import.meta.glob(['../lanes/render.js'], { eager: true });
  const axisSeries = Object.values(mods).find((m) => typeof m.axisSeries === 'function')?.axisSeries;

  let { app } = $props();
  const p = $derived(app.player);
  const on = $derived(!!p.ui.sr6);
  const KEY = 'video.sr6view';
  const stored = $derived((app.settings.values, app.settings.get(KEY, null)));
  const view = $derived(viewOf(stored?.view));
  const k = $derived([1, 3, 6].includes(stored?.k) ? stored.k : 1);
  let stage = $state({ w: 0, h: 0 }), draft = $state(null), hl = $state(null), solo = $state(null), grab = $state('');
  const box = $derived(stage.w > 0 ? boxOf(draft || stored, stage.w, stage.h) : null);
  const L = $derived(box ? layout(box.w) : null);
  const save = (patch) => app.settings.set(KEY, { ...(stored || {}), ...patch });

  // ---- what is previewed ----
  const tr = $derived(on && app.mode === 'track' ? peekTracking(app) : null);
  const followed = $derived.by(() => {
    if (!tr) return null;
    void app.doc.ghosts;
    const f = {}, st = followOf(app, 'stroke');
    if (st.spans.length) f.stroke = st.script;
    return f;
  });
  const lanes = $derived(on ? Object.fromEntries(IDS.map((id) => [id, followOf(app, id).script])) : {});
  const pick = $derived(on ? pickScripts(followed, lanes) : { scripts: {}, src: 'script' });
  const scripts = $derived(pick.scripts);
  const segs = $derived(tr ? (void app.doc.ghosts, Object.fromEntries(followedAxesGhosts(app, tr).map((g) => [g.axis, g.source.segs]))) : {});
  // per axis: data in this shot, the measurement quality at the playhead (written by frame() when it changes)
  let meta = $state({});
  const passive = $derived.by(() => {
    const id = p.overlays.activeTool?.id;
    if (!id || id === 'tracking.roi') return false;
    return id === 'tracking.pair' ? !!peekTracking(app)?.pairPick?.first : true;
  });

  // ---- drawing ----
  let cv = $state(), raf = 0, C = null, stripeNear = false, themeTick = $state(0), cache = { key: null, has: {} }, lastMeta = '';
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  $effect(() => {
    if (!on) return;
    const off = untrack(() => p.overlays.add({ id: 'video.sr6', order: 1001, draw: (_, e) => { if (e.w !== stage.w || e.h !== stage.h) stage = { w: e.w, h: e.h }; } }));
    return () => off();
  });
  $effect(() => onThemeChange(() => themeTick++));
  $effect(() => {
    themeTick;
    if (!cv) return;
    const v = (n, f) => cssVar(n, cv) || f;
    // paw-p8o2: on the theme: the guides in --guide over the panel's --glass, text at the type ramp's --fs-1
    C = { font: v('--font', 'sans-serif'), fs: parseFloat(v('--fs-1')) || 11, ink: v('--guide'), halo: v('--guide-halo'),
      ax: Object.fromEntries(IDS.map((id) => [id, v('--series-' + (axisSeries?.(id) || 'grey'), v('--series-grey'))])) };
    kick();
  });
  $effect(() => {
    if (!on || !cv) return;
    scripts; segs; k; view; hl; solo; box;
    p.shownMs;   // paw-o60v.8.1: the frame on screen
    untrack(kick);
  });
  $effect(() => () => { cancelAnimationFrame(raf); raf = 0; });

  const ring = (y, r = SLEEVE.r, n = 28) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), y, r * Math.sin((i / n) * 2 * Math.PI)]);
  const BOT = ring(-SLEEVE.len / 2), TOP = ring(SLEEVE.len / 2);
  const rgba = (c, a) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return c; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  function frame() {
    raf = 0;
    const pl = app.player;
    if (!on || !cv || !C || !box || !L) return;
    const t = pl.shownMs;
    const dpr = window.devicePixelRatio || 1, W = Math.round(L.w * dpr), H = Math.round(L.h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    // per shot: which axes have data (recomputed when the shot or the scripts change)
    const shots = app.doc.scenes || [], si = sceneAt(shots, t), shot = si >= 0 ? shots[si] : null;
    if (cache.key !== shot || cache.scripts !== scripts) cache = { key: shot, scripts, has: Object.fromEntries(IDS.map((id) => [id, hasData(scripts[id], shot)])) };
    const raw = valuesAt(scripts, t, posAt), vals = Object.fromEntries(IDS.map((id) => [id, cache.has[id] ? raw[id] : NaN]));
    const q = Object.fromEntries(IDS.map((id) => [id, qualityAt(segs[id], t)]));
    const mk = IDS.map((id) => `${+cache.has[id]}${q[id]?.label || ''}${q[id]?.guessed ? '?' : ''}${q[id]?.frame ? 'f' : ''}${q[id]?.from || ''}`).join('|');
    if (mk !== lastMeta) { lastMeta = mk; meta = Object.fromEntries(IDS.map((id) => [id, { has: cache.has[id], q: q[id] }])); }

    const V = L.view;
    ctx.save(); ctx.translate(V.x, V.y);
    const px = viewport(view, V.w, V.h, 10), shown = masked(vals, solo), P = pose(shown, k);
    const A = hl || null, fade = A ? 0.28 : 1;
    scene(ctx, px, P, shown, t, A, fade);
    ctx.restore();
    for (const g of L.gauges) drawGauge(ctx, g, vals[g.id], q[g.id]);

    // what is painted, for checks (canvas css px)
    const at = (v) => { const [x, y] = px(v); return `${(x + V.x).toFixed(1)},${(y + V.y).toFixed(1)}`; };
    const ds = cv.dataset;
    ds.vals = IDS.map((id) => (Number.isFinite(vals[id]) ? vals[id] : 50).toFixed(1)).join(',');
    ds.open = at(openingOf(P)); ds.mid = at(P.p); ds.mark = at(place(P, [0, SLEEVE.len / 2, SLEEVE.r])); ds.side = at(place(P, [SLEEVE.r, 0, 0]));
    ds.stripe = stripeNear ? 'near' : 'far'; ds.view = view; ds.solo = solo || ''; ds.hl = hl || ''; ds.src = pick.src; ds.k = String(k);
  }

  function scene(ctx, px, P, shown, t, A, fade) {
    const line = (pts, col, w = 1.5, close = false, dash = null) => {
      ctx.beginPath(); pts.forEach((v, i) => { const [x, y] = px(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      if (close) ctx.closePath();
      ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]);
    };
    const text = (s, v, col, align = 'center') => { const [x, y] = px(v); ctx.font = `600 ${C.fs}px ${C.font}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = rgba(C.halo, .7); ctx.strokeText(s, x, y); ctx.fillStyle = col; ctx.fillText(s, x, y); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = fade;
    // the floor = the wearer's body at the shaft's base: their up (+z, the arrow) and their right (-x) marked
    line([[-60, 0, -60], [60, 0, -60], [60, 0, 60], [-60, 0, 60]], rgba(C.ink, .35), 1, true);
    // the up arrow off to the wearer's left (+x), so seen along the shaft it never sits under the receiver
    line([[40, 0, 30], [40, 0, 60]], rgba(C.ink, .6), 1.5); line([[34, 0, 52], [40, 0, 60], [46, 0, 52]], rgba(C.ink, .6), 1.5);
    // a direction pointing along the camera has no length on screen: its word would sit on the shaft
    const shows = (v) => { const a = px([0, 0, 0]), b = px(v); return Math.hypot(b[0] - a[0], b[1] - a[1]) > 22; };
    if (shows([0, 0, 60])) text('your up', [40, 0, 74], rgba(C.ink, .85));
    if (shows([-60, 0, 0])) text('your right', [-86, 0, 0], rgba(C.ink, .85));
    // the fixed shaft
    const s0 = px([0, 0, 0]), s1 = px([0, SHAFT.len, 0]);
    ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]);
    ctx.strokeStyle = rgba(C.ink, .4); ctx.lineWidth = 2 * SHAFT.r * px.scale; ctx.stroke();
    // the neutral pose, dashed
    sleeve(ctx, px, pose({}, 1), { ghost: true });
    // the opening's path over the last second
    const tp = trail(scripts, t, posAt, { k, solo }).map((v) => px(v));
    ctx.strokeStyle = C.ax.stroke; ctx.lineWidth = 2;
    for (let i = 1; i < tp.length; i++) { ctx.globalAlpha = fade * (0.08 + 0.8 * (i / tp.length)); ctx.beginPath(); ctx.moveTo(tp[i - 1][0], tp[i - 1][1]); ctx.lineTo(tp[i][0], tp[i][1]); ctx.stroke(); }
    ctx.globalAlpha = fade;
    sleeve(ctx, px, P, {});
    ctx.globalAlpha = 1;
    if (!A) return;
    // the hovered axis: what it alone does (in its colour) and its travel / turning circle
    const col = C.ax[A], Pa = pose(masked(shown, A), k);
    sleeve(ctx, px, Pa, { col });
    if (!ROT.includes(A)) {
      const lo = pose({ ...masked(shown, A), [A]: 0 }, k).p, hi = pose({ ...masked(shown, A), [A]: 100 }, k).p;
      line([lo, hi], col, 2, false, [5, 4]);
      const [hx, hy] = px(hi), [lx, ly] = px(lo), a = Math.atan2(hy - ly, hx - lx);
      ctx.beginPath(); ctx.moveTo(hx - 8 * Math.cos(a - 0.5), hy - 8 * Math.sin(a - 0.5)); ctx.lineTo(hx, hy); ctx.lineTo(hx - 8 * Math.cos(a + 0.5), hy - 8 * Math.sin(a + 0.5));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      text(A === 'stroke' ? 'out' : '+', hi, col);
    } else {
      const R = SLEEVE.r + 16, base = { p: Pa.p, r: { twist: 0, roll: A === 'twist' ? Pa.r.roll : 0, pitch: A === 'pitch' ? 0 : Pa.r.pitch } };
      const at = (u) => (A === 'twist' ? [R * Math.cos(u), 0, R * Math.sin(u)] : A === 'roll' ? [R * Math.cos(u), R * Math.sin(u), 0] : [0, R * Math.sin(u), R * Math.cos(u)]);
      const arc = Array.from({ length: 41 }, (_, i) => place(base, at(-2.6 + (5.2 * i) / 40)));
      line(arc, col, 2, false, [5, 4]);
      const e = px(arc[40]), f = px(arc[38]), a = Math.atan2(e[1] - f[1], e[0] - f[0]);
      ctx.beginPath(); ctx.moveTo(e[0] - 8 * Math.cos(a - 0.5), e[1] - 8 * Math.sin(a - 0.5)); ctx.lineTo(e[0], e[1]); ctx.lineTo(e[0] - 8 * Math.cos(a + 0.5), e[1] - 8 * Math.sin(a + 0.5));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      text('+', arc[40], col);
    }
  }

  /** The receiver: its outline (the hull of its end rings), the top ring, the opening ring (stroke colour), the up-side stripe
   *  and the nub on top (twist colour). ghost: the neutral pose, dashed and faint; col: one colour (a hovered axis). */
  function sleeve(ctx, px, P, { ghost = false, col = null }) {
    const bot = BOT.map((v) => px(place(P, v))), top = TOP.map((v) => px(place(P, v))), h = hull([...bot, ...top]);
    const poly = (pts, close = true) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (close) ctx.closePath(); };
    if (ghost) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba(C.ink, .4); ctx.lineWidth = 1;
      poly(h); ctx.stroke(); poly(bot); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    const ink = col || rgba(C.ink, .95);
    poly(h); ctx.fillStyle = col ? rgba(col, 0.2) : rgba(C.ink, .24); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = col ? 2 : 1.5; ctx.stroke();
    poly(top); ctx.lineWidth = 1; ctx.stroke();
    // the stripe on its up side (+z) and the nub on top: nearer than the sleeve's middle = solid, behind it = faint
    const mid = px(P.p)[2], f0 = px(place(P, [0, -SLEEVE.len / 2, SLEEVE.r])), f1 = px(place(P, [0, SLEEVE.len / 2, SLEEVE.r])), nub = px(place(P, [0, SLEEVE.len / 2 + 14, SLEEVE.r]));
    const front = (f0[2] + f1[2]) / 2 <= mid + 0.5, tw = col || C.ax.twist;
    if (!col) stripeNear = front;
    ctx.globalAlpha *= front ? 1 : 0.45;
    ctx.beginPath(); ctx.moveTo(f0[0], f0[1]); ctx.lineTo(f1[0], f1[1]); ctx.lineTo(nub[0], nub[1]); ctx.strokeStyle = tw; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(nub[0], nub[1], 3.5, 0, 2 * Math.PI); ctx.fillStyle = tw; ctx.fill();
    ctx.globalAlpha /= front ? 1 : 0.45;
    // the opening
    poly(bot); ctx.strokeStyle = col || C.ax.stroke; ctx.lineWidth = 3; ctx.stroke();
  }

  function drawGauge(ctx, g, v, q) {
    const G = gauge(g.id, v), col = C.ax[g.id], dim = !G.has, on1 = solo === g.id, hov = hl === g.id, faded = (solo && !on1) || dim;
    ctx.save();
    if (hov || on1) {
      ctx.beginPath(); ctx.roundRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2, 4);
      ctx.fillStyle = rgba(C.ink, .07); ctx.fill();
      if (on1) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    if (g.id !== 'stroke' && g.id !== 'twist') { ctx.fillStyle = rgba(C.ink, .1); ctx.fillRect(g.x, g.y + 4, 1, g.h - 8); }   // cell divider
    ctx.globalAlpha = faded ? 0.38 : 1;
    ctx.font = `600 ${C.fs}px ${C.font}`; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillStyle = col; ctx.fillText(g.id, g.x + 5, g.y + 12);
    const nw = ctx.measureText(g.id).width, mx = g.x + 5 + nw + 5, my = g.y + 8.5;
    if (q?.guessed) { ctx.fillStyle = rgba(C.ink, .85); ctx.fillText('?', mx - 2, g.y + 12); }
    else if (q?.label === 'measured') { ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill(); }
    else if (q?.label === 'estimate') { ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, 2 * Math.PI); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke(); }
    ctx.textAlign = 'right'; ctx.fillStyle = rgba(C.ink, .95); ctx.font = `500 ${C.fs}px ${C.font}`;
    const val = G.has ? String(Math.round(G.v)) : '–';
    if (mx + 4 + ctx.measureText(val).width <= g.x + g.w - 6) ctx.fillText(val, g.x + g.w - 6, g.y + 12);   // at --fs-1 a narrow cell keeps its name, the value in the tooltip
    if (G.kind === 'bar') {
      const x0 = g.x + 5, x1 = g.x + g.w - 5, y = g.y + 23, X = x0 + (x1 - x0) * G.f, from = G.centre ? (x0 + x1) / 2 : x0;
      ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = rgba(C.ink, .13);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      if (G.has) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(X, y); ctx.stroke(); }
      if (G.centre) { ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.ink, .6); ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y - 6); ctx.lineTo((x0 + x1) / 2, y + 6); ctx.stroke(); }
      if (G.has) { ctx.lineWidth = 2.5; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.moveTo(X, y - 6); ctx.lineTo(X, y + 6); ctx.stroke(); }
      if (g.id === 'stroke' && (ctx.font = `500 ${C.fs}px ${C.font}`) && ctx.measureText('deep out').width + 8 < x1 - x0) { ctx.fillStyle = rgba(C.ink, .55); ctx.textAlign = 'left'; ctx.fillText('deep', x0 - 1, y + 13); ctx.textAlign = 'right'; ctx.fillText('out', x1 + 1, y + 13); }
    } else {
      const cx = g.x + g.w / 2, cy = g.y + g.h - 2, R = Math.max(8, Math.min(g.w / 2 - 10, g.h - 17)), up = -Math.PI / 2;
      ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = rgba(C.ink, .13);
      ctx.beginPath(); ctx.arc(cx, cy, R, up - ARC, up + ARC); ctx.stroke();
      if (G.has) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(cx, cy, R, Math.min(up, up + G.a), Math.max(up, up + G.a)); ctx.stroke(); }
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(C.ink, .6); ctx.beginPath(); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx, cy - R + 3); ctx.stroke();
      if (G.has) { ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (R + 2) * Math.cos(up + G.a), cy + (R + 2) * Math.sin(up + G.a)); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ---- words ----
  const WHAT = {
    stroke: 'Stroke: the receiver sliding along the shaft (0 = deepest, at you; 100 = out); best seen from the side or your feet.',
    surge: 'Surge: the receiver moving across the shaft toward your up or down (+ = your up); best seen from the side or as you see it.',
    sway: 'Sway: the receiver moving to your left or right (+ = your left: the receiving body’s left seen from behind); best seen as you see it, facing you or from your feet.',
    twist: 'Twist: the receiver turning about the shaft (+ = counter-clockwise as you see it; watch the stripe and the nub); best seen as you see it or facing you.',
    roll: 'Roll: the receiver tilting to your left or right, about your up-down axis (+ = its top tips to your left); best seen from your feet.',
    pitch: 'Pitch: the receiver tilting toward your up or down, about your left-right axis (+ = its top tips toward your down); best seen from the side.',
  };
  const qWords = (x) => (!x ? '' : `${x.label}${x.guessed ? ', from a guessed view' : ''} (${x.from ? FROM[x.from] || x.from : 'the run'})`);
  function tipOf(id) {
    const m = meta[id] || {}, unap = pick.src === 'unapplied' && followed?.[id];
    const from = !m.has ? 'No data in this shot: held at centre.' : unap ? `From the track in progress${m.q ? `: ${qWords(m.q)}` : ''}.` : `From the ${id} lane.`;
    return `${WHAT[id]} ${TCODE[id]}. ${from} Hover: this axis alone in its colour. Click: ${solo === id ? 'show every axis again' : 'show only this axis (preview only)'}.`;
  }
  const frameSeg = $derived(IDS.map((id) => meta[id]?.q?.frame).find(Boolean) || null);
  const srcTip = $derived(pick.src === 'unapplied' ? 'Previewing the live track' : 'Previewing the script');
  const kTip = 'Exaggerate the five secondary axes (surge, sway, twist, roll, pitch) so small moves show. The stroke is never exaggerated.';
  const boxTip = 'Six-axis preview (a sketch: the travel per axis is a guess, not the device). Drag to move · the top-right grip resizes · the playback bar button hides it, double-click puts it back';

  // ---- pointer: move / resize (the box only; never focus) ----
  let drag = null;
  function down(e, kind) {
    if (passive || e.button !== 0 || !box) return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag = { kind, x: e.clientX, y: e.clientY, b0: { ...box }, el: e.currentTarget, id: e.pointerId };
    grab = kind;
  }
  function move(e) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    draft = { ...(stored || {}), ...(drag.kind === 'resize' ? boxResize(drag.b0, dx, dy, stage.w, stage.h) : boxMove(drag.b0, dx, dy, stage.w, stage.h)) };
  }
  function up() {
    if (!drag) return;
    try { drag.el.releasePointerCapture(drag.id); } catch { /* gone */ }
    const d = draft;
    drag = null; draft = null; grab = '';
    if (d) save({ fx: d.fx, fy: d.fy, w: d.w });
  }
  let gDown = null;
  const noFocus = (e) => e.preventDefault();
</script>

{#if on && box && L}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sr6" class:passive data-testid="sr6" data-grab={grab || undefined} style:left="{box.x}px" style:top="{box.y}px" style:width="{box.w}px" style:height="{L.h}px"
    onmousedown={noFocus} onpointerdown={(e) => down(e, 'move')} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <canvas bind:this={cv} style:width="{L.w}px" style:height="{L.h}px" aria-hidden="true"></canvas>
    <div class="head" style:height="{L.head}px">
      <span class="grow"></span>
      {#each Object.entries(VIEWS) as [id, v] (id)}
        <button type="button" tabindex="-1" class="b" class:on={view === id} aria-pressed={view === id} data-testid="sr6-view-{id}"
          onpointerdown={(e) => e.stopPropagation()} onclick={() => save({ view: id })} {@attach tooltip(v.tip)}>{v.label}</button>
      {/each}
      <button type="button" tabindex="-1" class="b" data-testid="sr6-k" onpointerdown={(e) => e.stopPropagation()}
        onclick={() => save({ k: k === 1 ? 3 : k === 3 ? 6 : 1 })} {@attach tooltip(kTip)}>×{k}</button>
    </div>
    <div class="body" style:top="{L.view.y}px" style:height="{L.view.h}px" {@attach tooltip(passive ? '' : boxTip)}></div>
    <div class="tags" style:top="{L.view.y}px">
      <span class="src" class:unap={pick.src === 'unapplied'} data-testid="sr6-src" {@attach tooltip(srcTip)}>{pick.src === 'unapplied' ? 'tracking' : 'script'}</span>
      {#if frameSeg}<span class="chip" data-testid="sr6-vs-frame" {@attach tooltip(frameWords(frameSeg))}>vs frame</span>{/if}
    </div>
    {#each L.gauges as g (g.id)}
      <div class="g" role="presentation" data-testid="sr6-g-{g.id}" data-axis={g.id} data-has={meta[g.id]?.has ? '1' : '0'} data-q={meta[g.id]?.q ? (meta[g.id].q.guessed ? 'guessed' : meta[g.id].q.label) : ''}
        style:left="{g.x}px" style:top="{g.y}px" style:width="{g.w}px" style:height="{g.h}px"
        onpointerenter={() => (hl = g.id)} onpointerleave={() => { if (hl === g.id) hl = null; }}
        onpointerdown={(e) => { e.stopPropagation(); gDown = g.id; }} onpointerup={() => { if (gDown === g.id) solo = solo === g.id ? null : g.id; gDown = null; }}
        {@attach tooltip(tipOf(g.id))}></div>
    {/each}
    <div class="rs" role="presentation" data-testid="sr6-resize" onpointerdown={(e) => down(e, 'resize')} {@attach tooltip('Drag: resize the six-axis preview')}></div>
  </div>
{/if}

<style>
  /* fixed inside the stage's containment (as PosBar): placed in stage px. On the theme (paw-p8o2): the see-through --glass of
     everything over the picture, the 2 px radius, --fs-1 text, kit button states */
  .sr6 { position: fixed; pointer-events: auto; border-radius: var(--radius); background: var(--glass); backdrop-filter: var(--glass-blur); box-shadow: 0 0 0 var(--bw) var(--line-2);
    user-select: none; -webkit-user-select: none; touch-action: none; cursor: move; font: 500 var(--fs-1) var(--font); color: var(--tx-hi); }
  .sr6.passive, .sr6.passive * { pointer-events: none; }
  .sr6[data-grab='move'] { cursor: grabbing; }
  canvas { position: absolute; left: 0; top: 0; display: block; pointer-events: none; }
  .head { position: absolute; left: 6px; right: 16px; top: 4px; display: flex; align-items: center; gap: 2px; min-width: 0; }
  .tags { position: absolute; left: 6px; right: 6px; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; pointer-events: none; }
  .tags > * { pointer-events: auto; max-width: 100%; }
  .src { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--tx-val); cursor: default; }
  .src.unap { color: var(--warn-ink); }
  .chip { flex: none; padding: 0 var(--space-2); border: var(--bw) solid var(--line-ctl); border-radius: var(--radius); line-height: 13px; cursor: default; }
  .grow { flex: 1; }
  .b { flex: none; font: 600 var(--fs-1) var(--font); color: var(--tx); background: transparent; border: var(--bw) solid var(--line-ctl);
    border-radius: var(--radius); padding: 0 var(--space-1); line-height: 14px; cursor: pointer; }
  .b:hover { border-color: var(--line-ctl-hover); }
  .b.on { background: var(--sel-bg); color: var(--accent-ink); border-color: var(--reality); }
  .body { position: absolute; left: 0; right: 0; }
  .g { position: absolute; cursor: pointer; }
  .rs { position: absolute; right: 0; top: 0; width: 14px; height: 14px; cursor: nesw-resize; border-top-right-radius: var(--radius);
    --g: color-mix(in srgb, var(--guide) 55%, transparent);
    background: linear-gradient(225deg, var(--g) 0 2px, transparent 2px 4px, var(--g) 4px 5.5px, transparent 5.5px); }
</style>
