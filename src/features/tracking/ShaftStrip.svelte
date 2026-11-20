<script>
  // paw-4c48: the shaft strip, a thin row under the Tracker lane's trace while the selected run has a shaft (lib/shaft.js
  // shaftState: one reading per frame). Display and the owner's marks only: nothing that makes the script reads it.
  //   the visible share, deep DOWN like the script (top = all of it outside, the tip at the entry: the dashed entry level;
  //   bottom = all in): solid where confident, thin where unsure, hatched at the bottom where hidden (inferred fully in),
  //   blank where lost; a green tick along the top where the tip is free; the knot line (dashed = automatic, solid = the
  //   owner's) at the knot's place: drag it up / down for the shot (one undo step; where the shot has none, a vertical drag
  //   anywhere sets one), double-click = automatic; event glyphs (went in, pulled out, knot in, knot out).
  //   Click: the top edge = "fully out here", the bottom edge = "hilted here" (the existing calibration marks), elsewhere = seek.
  //   The truth row along the top: the owner's six marks per shot (Alt+1..6 at the frame on screen, or the readout's buttons):
  //   drag to correct, click = go there, Delete removes. The readout at the end: this shot's scorecard; click = in place.
  import { xToMs, msToX, gridOf } from '../../lib/lane.js';
  import { sceneAt } from '../../lib/runs.js';
  import { shaftOf, fullText, shaftScore, stateIndex, stateText, scoreLine, eventCell, TRUTH_KINDS, EVENT_KINDS, KIND_TEXT } from '../../lib/shaft.js';
  import { trackingFor } from './tracking.svelte.js';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { paint as tok } from './colors.js';
  import { onThemeChange } from '../../ui/kit/tokens.js';
  import { fmtTime } from '../../lib/funscript.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  // paw-1ysd stage 5: `layered` = over the combined Track lane's foot (`bottom` px above its edge), translucent; the area lets
  // the lane's own gestures through, only its handles take the pointer: the knot line (drag up / down, double-click = automatic;
  // a shot without one: the K grip at its start sets it), the entry line = "fully out here", the foot line = "hilted here",
  // the truth row's marks and the readout; the hover words are the shaft data's (ShaftData), shown with the data toggle
  let { app, run, layered = false, bottom = 0 } = $props();
  // svelte-ignore state_referenced_locally
  const tr = trackingFor(app);
  let canvas = $state(), w = $state(0), h = $state(0), themeTick = $state(0), open = $state(false), readBtn = $state(null);
  $effect(() => onThemeChange(() => themeTick++));
  const GLYPH = { out: '⊤', hilt: '⊥', wentIn: '▼', pulledOut: '▲', knotIn: '●', knotOut: '○' };
  const COLOR = { out: 'var(--series-sky)', hilt: 'var(--series-blue)', wentIn: 'var(--series-green)', pulledOut: 'var(--series-vermilion)', knotIn: 'var(--series-orange)', knotOut: 'var(--series-yellow)' };
  const KEY = (k) => app.commands.keysFor(k === 'out' ? 'tracking.shaftOut' : k === 'hilt' ? 'tracking.shaftHilt' : `tracking.shaftMark.${k}`)?.[0] || '';
  const TR = 7, Y0 = 9;   // the truth row's height; the visible share 1 (the entry level) at Y0, 0 at the bottom
  const Y1 = $derived(Math.max(Y0 + 6, h - 2));
  const yOf = (v) => Y1 - v * (Y1 - Y0), vOf = (y) => Math.min(0.98, Math.max(0.02, (Y1 - y) / (Y1 - Y0)));
  const X = (t) => msToX(app.view, w, t);

  // one entry per run scene with a shaft: its reading, the shot that calibrates it, its time span
  const states = $derived.by(() => {
    if (!run) return [];
    app.doc.scenes; tr.derivePreview; gridOf(app.player);   // what the readings depend on (marks, knot, the clock)
    const sc = run.scenes?.length ? run.scenes : [{ start_ms: run.range.start, end_ms: run.range.end }];
    return sc.flatMap((s, k) => {
      if (!shaftOf(run, k, { points: true, part: tr.shotPart(run, sceneAt(tr.scenes, (s.start_ms + s.end_ms) / 2)) })) return [];   // paw-4c48.19: the depth part the shot plays
      const st = tr.shaftStateOf(run, k);
      return st?.t.length ? [{ k, st, shot: sceneAt(tr.scenes, (s.start_ms + s.end_ms) / 2), t0: Math.max(s.start_ms, run.range.start), t1: Math.min(s.end_ms, run.range.end) }] : [];
    });
  });
  const stateAt = (t) => states.find((e) => t >= e.t0 && t < e.t1) || null;
  // the owner's marks on the shots the run covers
  const marks = $derived.by(() => {
    if (!run) return [];
    const out = [];
    tr.scenes.forEach((s, i) => { if (s.end_ms > run.range.start && s.start_ms < run.range.end) for (const m of tr.shaftTruth(i, run.id)) out.push({ ...m, i }); });
    return out;
  });
  // this shot's scorecard (the shot under the playhead)
  const card = $derived.by(() => {
    const t = app.player.timeMs, i = sceneAt(tr.scenes, t), s = tr.scenes[i], e = stateAt(t) || (s && stateAt((s.start_ms + s.end_ms) / 2));
    if (!s || !e) return null;
    return { i, c: shaftScore(e.st, { t0: s.start_ms, t1: s.end_ms, script: scriptOf(app, 'stroke'), truth: tr.shaftTruth(i, run.id), calib: tr.shotDerive(i, run.id)?.shaft }) };
  });

  // ---- painting ----
  let raf = 0, knotDrag = $state(null), markDrag = $state(null);
  $effect(() => { w; h; themeTick; app.view; app.player.timeMs; states; knotDrag; if (!raf) raf = requestAnimationFrame(paintIt); });
  $effect(() => () => cancelAnimationFrame(raf));
  function paintIt() {
    raf = 0;
    if (!canvas || !w || !h) return;
    const d = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const a = app.view.start, b = a + app.view.span, col = tok(run?.color || 'var(--tx-hi)'), ghost = tok('var(--tx-ghost)');
    ctx.fillStyle = tok('var(--bg)'); ctx.fillRect(0, 0, w, TR);   // the truth row
    for (const e of states) {
      if (e.t1 < a || e.t0 > b) continue;
      const st = e.st, x0 = Math.max(0, X(e.t0)), x1 = Math.min(w, X(e.t1));
      ctx.setLineDash([2, 3]); ctx.strokeStyle = ghost; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;   // the entry level
      ctx.beginPath(); ctx.moveTo(x0, Y0 + 0.5); ctx.lineTo(x1, Y0 + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const n = st.t.length, xs = Array.from(st.t, X);
      ctx.fillStyle = tok('var(--series-green)');
      for (let i = 0; i < n; i++) if (st.free[i] === 1 && xs[i] >= -2 && xs[i] <= w + 2) ctx.fillRect(xs[i], Y0 - 2, Math.max(1, (xs[i + 1] ?? xs[i] + 1) - xs[i]), 2);
      // hidden: hatched at the bottom (inferred fully in)
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      for (let i = 0; i < n;) {
        if (st.state[i] !== 'hidden') { i++; continue; }
        let j = i; while (j + 1 < n && st.state[j + 1] === 'hidden') j++;
        const ha = xs[i], hb = xs[j + 1] ?? xs[j] + 2;
        if (hb >= 0 && ha <= w) {
          ctx.save(); ctx.beginPath(); ctx.rect(ha, Y1 - 6, hb - ha, 6); ctx.clip(); ctx.globalAlpha = 0.7;
          ctx.beginPath(); for (let x = ha - 6; x < hb + 6; x += 4) { ctx.moveTo(x, Y1); ctx.lineTo(x + 6, Y1 - 6); } ctx.stroke(); ctx.restore();
          ctx.setLineDash([1, 2]); ctx.beginPath(); ctx.moveTo(ha, Y1 - 0.5); ctx.lineTo(hb, Y1 - 0.5); ctx.stroke(); ctx.setLineDash([]);
        }
        i = j + 1;
      }
      // the visible share: unsure thin and faint, confident solid; lost = blank
      for (const [cls, lw, al] of [['low', 1, 0.4], ['seen', 1.5, 1]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.globalAlpha = al; ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const ok = st.state[i] === 'seen' || st.state[i] === 'low', use = ok && (cls === 'low' ? st.state[i] === 'low' || st.state[i - 1] === 'low' : st.state[i] === 'seen');
          if (!use || xs[i] < -4 || xs[i] > w + 4) { pen = false; continue; }
          const y = yOf(st.vis[i]);
          if (pen) ctx.lineTo(xs[i], y); else { ctx.moveTo(xs[i], y); if (cls === 'seen' && st.state[i + 1] !== 'seen') ctx.lineTo(xs[i] + 1, y); }
          pen = true;
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      // the knot line (the drag's preview wins)
      const kv = knotDrag?.k === e.k ? knotDrag.v : st.knotVis;
      if (kv != null) {
        ctx.strokeStyle = tok(COLOR.knotIn); ctx.lineWidth = 1.25; ctx.setLineDash(st.knotFrom === 'mark' || knotDrag?.k === e.k ? [] : [5, 3]);
        ctx.beginPath(); ctx.moveTo(x0, yOf(kv)); ctx.lineTo(x1, yOf(kv)); ctx.stroke(); ctx.setLineDash([]);
      }
      // the events: a faint tick through the area, the glyph near the top (knot events on the knot line)
      ctx.font = '11px ' + (getComputedStyle(canvas).getPropertyValue('--mono').trim() || 'monospace');   // a canvas reads no var(): the token, at the type floor (paw-p8o2) ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const ev of st.events) {
        const x = X(ev.t);
        if (x < -6 || x > w + 6) continue;
        ctx.fillStyle = tok(COLOR[ev.kind]); ctx.globalAlpha = 0.45; ctx.fillRect(Math.round(x), Y0, 1, Y1 - Y0); ctx.globalAlpha = 1;
        ctx.fillText(GLYPH[ev.kind], x, ev.kind.startsWith('knot') && kv != null ? yOf(kv) : Y0 + 4);
      }
    }
    const px = X(app.player.timeMs);   // the playhead, as on the lane above
    if (px >= 0 && px <= w) { ctx.fillStyle = tok('var(--highlight)'); ctx.fillRect(Math.round(px), 0, 1, h); }
  }

  // ---- hover: a kit tooltip per 6 px column (the frame's reading in words) ----
  const CELL = 6;
  const cells = $derived.by(() => {
    if (!w || !states.length) return [];
    app.view;
    const out = [];
    for (let x = 0; x < w; x += CELL) {
      const t = xToMs(app.view, w, x + CELL / 2), e = stateAt(t);
      if (!e) continue;
      const i = stateIndex(e.st, t), evs = e.st.events.filter((q) => Math.abs(X(q.t) - (x + CELL / 2)) <= CELL).map((q) => `${KIND_TEXT[q.kind]} detected here`);
      out.push({ x, text: `${fmtTime(t)} · ${i >= 0 ? stateText(e.st, i) : 'no reading'}${evs.length ? ' · ' + evs.join(', ') : ''}${e.st.knotWhy ? ` · knot place rejected: ${e.st.knotWhy}` : ''} · ${fullText(e.st)}. Click the top edge = fully out here, the bottom edge = hilted here; drag the knot line (double-click = automatic)` });
    }
    return out;
  });

  // ---- pointer: the knot line drag, click = out / hilt mark or seek ----
  let press = null;
  const local = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  function down(ev) {
    if (ev.button !== 0 || !canvas) return;
    const [x, y] = local(ev), t = xToMs(app.view, w, x), e = stateAt(t);
    if (y < TR) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const onLine = e?.st.knotVis != null && Math.abs(y - yOf(e.st.knotVis)) <= 4;
    press = { x, y, t, e, onLine, free: !!e && e.st.knotVis == null, moved: false };
  }
  function move(ev) {
    if (!press) return;
    const [x, y] = local(ev);
    if (!press.moved && Math.hypot(x - press.x, y - press.y) < 3) return;
    if (!press.moved && !press.onLine && !(press.free && Math.abs(y - press.y) > Math.abs(x - press.x))) { press.moved = true; press.dead = true; return; }
    press.moved = true;
    if (press.dead) return;
    knotDrag = { k: press.e.k, v: vOf(y) };
  }
  function up(ev) {
    const p = press, kd = knotDrag;
    press = null; knotDrag = null;
    if (!p) return;
    if (kd && ev.type === 'pointerup') { tr.setShaftKnot(p.e.shot, +p.e.st.toLen(kd.v).toFixed(4), run.id); return; }
    if (p.moved || ev.type !== 'pointerup') return;
    const t = app.player.snap(p.t);
    if (p.e && p.y <= Y0 + 3) tr.setShaftMark('out', t, null, run.id);
    else if (p.e && p.y >= Y1 - 3) tr.setShaftMark('hilt', t, null, run.id);
    else app.player.seek(t, { exact: true });
  }
  // layered: the handles start the same gestures (their own pointer capture; the area itself is not hit)
  function knotDown(ev, e, free = false) {
    if (ev.button !== 0 || !canvas) return;
    ev.preventDefault(); ev.stopPropagation();
    const el = ev.currentTarget, [x, y] = local(ev);
    el.setPointerCapture(ev.pointerId);
    press = { x, y, t: xToMs(app.view, w, x), e, onLine: !free, free, moved: false };
    const mv = (m) => move(m), done = (m) => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); up(m); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  }
  function edgeDown(ev, e, kind) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const [x] = local(ev);
    tr.setShaftMark(kind, app.player.snap(xToMs(app.view, w, x)), null, run.id);
  }
  function dbl(ev) {
    const [x, y] = local(ev), e = stateAt(xToMs(app.view, w, x));
    if (e?.st.knotFrom === 'mark' && Math.abs(y - yOf(e.st.knotVis)) <= 5) tr.setShaftKnot(e.shot, null, run.id);
  }

  // ---- the truth row's ticks: drag = move (inside its shot, on frame starts), click = go there, Delete = remove ----
  let markSwallow = false;
  function markDown(ev, m) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const el = ev.currentTarget, x0 = ev.clientX, s = tr.scenes[m.i], perPx = app.view.span / w;
    el.setPointerCapture(ev.pointerId);
    const mv = (e2) => {
      if (!markDrag && Math.abs(e2.clientX - x0) < 3) return;
      const t = Math.max(s.start_ms, Math.min(s.end_ms - 1, app.player.snap(m.t + (e2.clientX - x0) * perPx)));
      markDrag = { k: m.k, from: m.t, t };
    };
    const off = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); markCancel = null; };
    const done = (e2) => {
      off();
      const d = markDrag; markDrag = null;
      if (d && e2.type === 'pointerup') { markSwallow = true; setTimeout(() => (markSwallow = false), 0); if (d.t !== d.from) tr.setShaftMark(d.k, d.t, d.from, run.id); }
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
    markCancel = () => { off(); markDrag = null; };   // paw-k8rq: Escape ends the drag; the next move or the release writes nothing
  }
  let markCancel = null;
  function markKey(ev, m) {
    if (['Delete', 'Backspace'].includes(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); ev.stopPropagation(); tr.setShaftMark(m.k, null, m.t, run.id); }
  }
  const markTip = (m) => `${KIND_TEXT[m.k]} (your mark) at ${fmtTime(m.t)}${m.k === 'out' || m.k === 'hilt' ? ': also the depth calibration of this shot' : ': the truth the scorecard times the detected events against'}. Drag to correct, click = go there, Delete removes. One undo step`;
  const L = (t) => ((t - app.view.start) / app.view.span) * 100 + '%';
  const W = (ms) => (Math.max(0, ms) / app.view.span) * 100 + '%';
  const pct = (x) => `${Math.round(100 * x)} %`;
  const readTip = $derived(card ? `This shot's shaft scorecard: ${scoreLine(card.c)}. Click for the whole card (coverage, depth agreement with the accepted script, event timing against your marks, the knot place, why it fails) and the six marks` : '');
  const panelPos = $derived.by(() => { open; if (!readBtn) return { x: 0, y: 0 }; const r = readBtn.getBoundingClientRect(); return { x: Math.max(4, Math.min(window.innerWidth - 344, r.right - 340)), y: Math.max(4, r.top - 6) }; });
</script>

<svelte:window onkeydowncapture={(e) => { if (e.key !== 'Escape') return; if (knotDrag || markDrag) { markCancel?.(); knotDrag = null; markDrag = null; press = null; e.preventDefault(); e.stopPropagation(); } else if (open) { open = false; e.stopPropagation(); } }} />
<div class="shs" class:layered data-testid="shaft-strip" bind:clientWidth={w} bind:clientHeight={h} role="group" aria-label="Shaft: visible share, knot line, events and your marks"
  style:bottom={layered ? bottom + 'px' : null}
  onpointerdown={layered ? null : down} onpointermove={layered ? null : move} onpointerup={layered ? null : up} onpointercancel={layered ? null : up} ondblclick={layered ? null : dbl}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
  {#each layered ? [] : cells as c (c.x)}<span class="cell" style:left="{c.x}px" style:width="{CELL}px" style:top="{TR}px" {@attach tooltip({ text: c.text, placement: 'top', delay: 300 })}></span>{/each}
  {#each marks as m (m.k + m.t)}
    {@const t = markDrag && markDrag.k === m.k && markDrag.from === m.t ? markDrag.t : m.t}
    <button class="tm" data-kind={m.k} data-t={m.t} style:left={L(t)} style:--c={COLOR[m.k]} aria-label="{KIND_TEXT[m.k]} mark at {fmtTime(m.t)}" {@attach tooltip(markTip(m))}
      onpointerdown={(e) => markDown(e, m)} onclick={() => { if (!markSwallow) app.player.seek(m.t, { exact: true }); }} onkeydown={(e) => markKey(e, m)}>{GLYPH[m.k]}</button>
  {/each}
  {#if layered}
    {#each states as e (e.k)}
      {@const kv = knotDrag?.k === e.k ? knotDrag.v : e.st.knotVis}
      <span class="hit edge-out" role="presentation" style:left={L(e.t0)} style:width={W(e.t1 - e.t0)} style:top="{Y0 - 2}px" {@attach tooltip('Click: fully out here')}
        onpointerdown={(ev) => edgeDown(ev, e, 'out')}></span>
      <span class="hit edge-hilt" role="presentation" style:left={L(e.t0)} style:width={W(e.t1 - e.t0)} style:top="{Y1 - 2}px" {@attach tooltip('Click: hilted here')}
        onpointerdown={(ev) => edgeDown(ev, e, 'hilt')}></span>
      {#if kv != null}
        <span class="hit knot" role="presentation" data-testid="shaft-knot" style:left={L(e.t0)} style:width={W(e.t1 - e.t0)} style:top="{yOf(kv) - 3}px" {@attach tooltip('Knot place: drag; double-click = automatic')}
          onpointerdown={(ev) => knotDown(ev, e)} ondblclick={() => { if (e.st.knotFrom === 'mark') tr.setShaftKnot(e.shot, null, run.id); }}></span>
      {:else}
        <button class="kgrip" data-testid="shaft-knot-grip" style:left={L(e.t0)} style:top="{(Y0 + Y1) / 2 - 4}px" aria-label="Set the knot place" {@attach tooltip('Drag up or down to set the knot place')}
          onpointerdown={(ev) => knotDown(ev, e, true)}>K</button>
      {/if}
    {/each}
  {/if}
  {#if card}
    <button bind:this={readBtn} class="read num" data-testid="shaft-readout" aria-expanded={open} {@attach tooltip(readTip)} onpointerdown={(e) => e.stopPropagation()} onclick={() => (open = !open)}>{scoreLine(card.c)}</button>
  {/if}
</div>
{#if open && card}
  {@const c = card.c}
  <div class="card" data-testid="shaft-card" style:left="{panelPos.x}px" style:top="{panelPos.y}px">
    <div class="hd"><span class="grow">Shot {card.i + 1}: shaft scorecard</span><button class="x" aria-label="Close the scorecard" onclick={() => (open = false)}>×</button></div>
    <p>{c.frames} frames: {pct(c.seen)} seen · {pct(c.hidden)} hidden (inferred fully in) · {pct(c.low)} unsure · {pct(c.lost)} lost{#each Object.entries(c.lostBy) as [why, sh]}<br />&nbsp; {pct(sh)} {why}{/each}</p>
    <p>Depth vs the accepted script: {c.depth ? `r ${c.depth.r} at ${c.depth.lagMs} ms, swing ${c.depth.swing ?? '–'} (${c.depth.n} frames)` : c.depthWhy}</p>
    <p data-testid="shaft-card-events">{#each EVENT_KINDS as k}<span class="ev" style:--c={COLOR[k]}>{GLYPH[k]} {KIND_TEXT[k]} {eventCell(c.events[k])}</span>{/each}</p>
    <p>Knot place: {c.knot?.sane ? `${pct(c.knot.at)} of the length (${c.knot.from === 'mark' ? 'yours' : c.knot.from})` : c.knot?.why ? `rejected: ${c.knot.why}` : 'none'} · out mark {c.calib.out ? 'yes' : 'no'} · hilt mark {c.calib.hilt ? 'yes' : 'no'}</p>
    {#if c.diagnosis.length}<ul>{#each c.diagnosis.slice(0, 8) as d}<li>{d}</li>{/each}{#if c.diagnosis.length > 8}<li>… {c.diagnosis.length - 8} more (the all-shots table has them)</li>{/if}</ul>{/if}
    <div class="marks">{#each TRUTH_KINDS as k}<button class="mk" style:--c={COLOR[k]} {@attach tooltip({ text: `Mark "${KIND_TEXT[k]}" at the frame on screen`, shortcut: KEY(k) })} onclick={() => tr.markTruth(k)}>{GLYPH[k]} {KIND_TEXT[k]}</button>{/each}</div>
    <button class="mk all" {@attach tooltip('Copy every shot\'s card as a table')} onclick={() => tr.shaftScoreAll()}>All shots: copy the table</button>
  </div>
{/if}

<style>
  .shs { position: relative; overflow: hidden; background: var(--bg-sunken); touch-action: none; cursor: crosshair; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* paw-1ysd stage 5: over the lane's foot; only the handles take the pointer */
  .shs.layered { position: absolute; left: 0; right: 0; height: 26px; z-index: 1; background: none; pointer-events: none; cursor: default; }
  .shs.layered canvas { opacity: .55; }   /* the lane's points at the foot stay readable through it */
  .shs.layered .tm, .shs.layered .read, .shs.layered .hit, .shs.layered .kgrip { pointer-events: auto; }
  .shs.layered .read { background: color-mix(in srgb, var(--bg) 70%, transparent); }
  .hit { position: absolute; height: 4px; }
  .hit.knot { height: 6px; cursor: ns-resize; }
  .hit.edge-out, .hit.edge-hilt { cursor: pointer; }
  .kgrip { position: absolute; width: 12px; height: 12px; margin-top: -2px; padding: 0; color: var(--series-orange); font: var(--fs-1)/12px var(--mono); cursor: ns-resize; opacity: .7; }   /* paw-k8pe: the kit's small type, not 7 px */
  .kgrip:hover { opacity: 1; }
  .cell { position: absolute; bottom: 0; }
  .tm { position: absolute; top: 0; z-index: 1; height: 12px; min-width: 12px; padding: 0; transform: translateX(-50%); color: var(--c); font: var(--fs-1)/12px var(--mono); cursor: ew-resize; touch-action: none; }   /* paw-k8pe: the kit's small type, not 7 px */
  .tm:hover, .tm:focus-visible { color: var(--tx-hi); outline: none; text-shadow: 0 0 2px var(--c); }
  .read { position: absolute; right: 0; bottom: 0; z-index: 1; max-width: 40%; padding: 0 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--tx-mut); background: var(--bg); font: var(--fs-1)/12px var(--mono); border-radius: var(--radius) 0 0 0; }
  .read:hover, .read[aria-expanded='true'] { color: var(--highlight); }
  .card { position: fixed; z-index: 30; width: 340px; transform: translateY(-100%); padding: 0 8px 6px; font: var(--fs-1)/1.35 var(--mono); color: var(--tx-mut); background: var(--bg-card); border: 1px solid var(--line-2); border-radius: var(--radius); box-shadow: var(--shadow-1); }
  .card .hd { display: flex; align-items: center; margin: 0 -8px 4px; padding: 0 2px 0 8px; color: var(--tx-hi); background: var(--line-0); line-height: 16px; }
  .card .grow { flex: 1; }
  .card .x { padding: 0 4px; color: var(--tx-mut); font: var(--fs-1)/14px var(--mono); }
  .card p { margin: 0 0 4px; }
  .card ul { margin: 0 0 4px; padding-left: 12px; color: var(--tx); }
  .card .ev { display: inline-block; margin-right: 8px; color: var(--tx); }
  .card .ev::first-letter { color: var(--c); }
  .marks { display: flex; flex-wrap: wrap; gap: 3px; margin: 4px 0; }
  .mk { padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: var(--fs-1)/16px var(--mono); }
  .mk:hover { background: var(--line-3); color: var(--tx-hi); }
  .mk::first-letter { color: var(--c); }
</style>
