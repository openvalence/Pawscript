<script>
  // Range row (Autorange, lib/autorange.js + lib/autorange-env.js; commands-range.js): the target band as an ENVELOPE
  // over time (top = 100 = out, bottom = 0 = deepest), drawn piece by piece: a piece is a scene, or a stretch of one
  // where a reason splits it (a shot with its own stroke depth, a modifier span, a knot / tie, a hand split; the hover
  // says which). Every piece is a quad with FOUR CORNER handles (start-top, start-bottom, end-top, end-bottom):
  //   corner drag  that corner's level (up / down) or, dragged sideways, that side in time (both its corners)
  //   edge drag    top / bottom: both corners of that edge (between two keys: just those two keys)
  //   side drag    the piece's start / end in time, taking the neighbour's shared boundary along (Alt: detach it)
  //   body drag    the whole piece in level (Alt: only its end: the slope; Ctrl: the piece's strength)
  //   click edge   a key there (an extra handle on that edge inside the piece); drag a key in time and level
  //   double-click a corner / the piece: back to auto; a key: delete it
  // Shift: no snapping (else frames, cuts, span ends, spurt markers in time; the neighbour's touching corner and round
  // levels). Click selects a handle (Shift+click adds); G / S / X / Shift+D / Esc on the selection (Range focused), K
  // splits the band at the playhead. Right-click: split here / by shots / by modifier spans, merge, ease of a key,
  // strength, leave as it is, back to auto (piece / scene / all), flatten. ONE undo step per gesture; the final in the
  // stroke lane follows live (nothing is ever baked). Gap and tease suggestions (no points yet) draw as before.
  import { untrack } from 'svelte';
  import { tooltip } from '../../ui/kit/tooltip.js';
  import { Popover, showContextMenu } from '../../ui/kit/index.js';
  import CanvasLane from './CanvasLane.svelte';
  import RangePolicy from './RangePolicy.svelte';
  import { tl, scenesOf } from './state.svelte.js';
  import { theme, font, X, ellipsize, drawHint } from './draw.js';
  import { kindOf, rgba } from './kinds.js';
  import { tintOf } from './acts.js';
  import { GAIN, FINE } from '../../ui/kit/curve.js';
  import { gridOf } from '../../lib/lane.js';
  import { bandText, hitBand, outlineOf, segmentKeys, neighbourLevels, snapLevel, snapTime, yOfPos, PADY } from './range-edit.js';
  import { planOf, policyOf, setAutorange, gapsOf, acceptGaps, flatten, envOf, ovOf, writeOv, editOv, splitBand, splitByShots, splitBySpans, mergeBand, setBandPiece, resetBand, dropOrphans, pieceAt, fadesOf, editFadeEnv, patchFinish } from './commands-range.js';
  import { setFadeEnv } from '../../lib/autorange-env.js';
  import { gapText, buildUpOf, pieceMaps } from '../../lib/autorange.js';
  import { cornersOf, setCorners, moveLevel, moveSide, moveKeys, addKey, deleteKeys, setEase, setPiece, neighbourOf, keyId } from '../../lib/autorange-env.js';
  import { scriptOf } from '../../lib/script-of.js';   // paw-x7w7: baked + live

  let { app } = $props();
  const SNAP_PX = 7;
  const plan = $derived.by(() => { app.doc.scenes; app.doc.fx; scriptOf(app, 'stroke'); app.doc.finish; tl.draft.scenes; tl.rangePolicy; policyOf(app); return untrack(() => planOf(app)); });
  const env = $derived.by(() => { plan; app.doc.finish; return untrack(() => envOf(app, plan)); });
  const gaps = $derived.by(() => { plan; return untrack(() => gapsOf(app, plan)); });
  // paw-ef73.9: the soft start / stop over each fade (lib/autorange-env.js fadeEnvelopes; the band already narrows in env)
  const fades = $derived.by(() => { env; return untrack(() => fadesOf(app)); });
  /** A fade envelope's handle: at its low-share end, on the band's bottom there. */
  const fadeHandle = (f, w, h) => { const t = f.side === 'in' ? f.t0 : f.t1, b = env.edgeAt(t); return b && { x: X(app.view, w, t), y: yOfPos(h, b[0]), t }; };
  const fadeHit = (a) => a && fades.find((f) => { if (f.off) return false; const q = fadeHandle(f, a.w, a.h); return q && Math.abs(q.x - a.x) <= 6 && Math.abs(q.y - a.y) <= 6; });
  const on = $derived(!!app.doc.finish?.autorange);
  let root = $state(), hover = $state.raw(null), drag = $state.raw(null), group = null, timer = null, pending = null;
  const cursor = $derived(!hover ? 'default' : ['t0', 't1'].includes(hover.part) ? 'ew-resize' : hover.part === 'key' || hover.part?.length === 3 ? 'move' : hover.part === 'hi' || hover.part === 'lo' || hover.part === 'fade' ? 'ns-resize' : 'grab');
  const sel = $derived(tl.rangeSel || []);
  const isSel = (s) => sel.some((x) => x.type === s.type && (s.type === 'key' ? x.id === s.id : x.t0 === s.t0 && x.t1 === s.t1 && x.corner === s.corner));
  const same = (p, q) => !!p && !!q && p.t0 === q.t0 && p.t1 === q.t1;
  const canvasOf = () => root?.querySelector('canvas');

  function paint(ctx, w, h) {
    const T = theme(), v = app.view, sc = scenesOf(app), yOf = (pos) => yOfPos(h, pos);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = T.grid; ctx.lineWidth = 1;
    for (const p of [0, 50, 100]) { const y = Math.round(yOf(p)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (!plan.length) { drawHint(ctx, h, 'Range: detect scenes, track a shot, then Autorange (Ctrl+Alt+R)'); return; }
    ctx.globalAlpha = on ? 1 : 0.45;   // off: the bands are kept, the points play as they are
    // rows with nothing tracked: gaps (dashed: a fill is suggested), unranged (dotted), teases (orange boxes)
    for (const r of plan) {
      const x0 = X(v, w, r.t0), x1 = X(v, w, r.t1);
      if (x1 < 0 || x0 > w) continue;
      const c = kindOf(tintOf(sc[r.i]) ?? 'custom').color, a = x0 + 1, b = Math.max(a + 1, x1 - 1);
      for (const s of r.tease || []) {
        const qa = Math.max(a, X(v, w, s.t0)), qb = Math.min(b, X(v, w, s.t1)), ya = yOf(r.teaseHi), yb = yOf(r.teaseLo);
        ctx.fillStyle = rgba(T.warn, 0.14); ctx.fillRect(qa, ya, qb - qa, Math.max(2, yb - ya));
        ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(T.warn, 0.8); ctx.strokeRect(qa + 0.5, ya + 0.5, qb - qa - 1, Math.max(2, yb - ya)); ctx.setLineDash([]);
      }
      if (r.source === 'tracked' && (r.stats?.turns ?? 0) >= 2) continue;   // drawn as envelope pieces below
      ctx.beginPath(); ctx.moveTo(a, yOf(r.hi)); ctx.lineTo(b, yOf(r.hi1)); ctx.lineTo(b, yOf(r.lo1)); ctx.lineTo(a, yOf(r.lo)); ctx.closePath();
      if (r.source === 'gap') { ctx.fillStyle = rgba(c, 0.12); ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = c; ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.setLineDash([1, 3]); ctx.strokeStyle = rgba(c, 0.5); ctx.stroke(); ctx.setLineDash([]); }
      if (r.off && b - a > 40) { ctx.font = font(9, true); ctx.fillStyle = T.txVal; ctx.textBaseline = 'top'; const txt = ellipsize(ctx, `S${r.i + 1} as is`, b - a - 6); if (txt) ctx.fillText(txt, a + 3, 2); }
    }
    // the envelope: one quad (or bent outline) per piece
    for (const p of env.pieces) {
      const x0 = X(v, w, p.t0), x1 = X(v, w, p.t1);
      if (x1 < 0 || x0 > w) continue;
      const r = p.rows[0], c = kindOf(tintOf(sc[r.i]) ?? 'custom').color, hot = same(hover?.piece, p) || same(drag?.piece, p);
      const o = outlineOf(env, p);
      ctx.beginPath();
      o.forEach((q, k) => (k ? ctx.lineTo(X(v, w, q.t), yOf(q.hi)) : ctx.moveTo(X(v, w, q.t), yOf(q.hi))));
      for (let k = o.length - 1; k >= 0; k--) ctx.lineTo(X(v, w, o[k].t), yOf(o[k].lo));
      ctx.closePath();
      if (p.off) { ctx.setLineDash([1, 3]); ctx.strokeStyle = rgba(c, 0.6); ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = rgba(c, (hot ? 0.5 : 0.32) * (0.25 + 0.75 * p.strength)); ctx.fill(); ctx.strokeStyle = p.hand ? T.txHi : c; ctx.lineWidth = p.hand ? 1.5 : 1; ctx.stroke(); ctx.lineWidth = 1; }
      // a boundary tick between touching pieces, and the hand marker (a small notch at the top-left corner)
      ctx.strokeStyle = rgba(T.txHi, 0.25); ctx.beginPath(); ctx.moveTo(x0 + 0.5, PADY); ctx.lineTo(x0 + 0.5, h - PADY); ctx.stroke();
      if (p.hand) { ctx.fillStyle = T.txHi; ctx.beginPath(); ctx.moveTo(x0 + 1, yOf(o[0].hi) - 1); ctx.lineTo(x0 + 7, yOf(o[0].hi) - 1); ctx.lineTo(x0 + 1, yOf(o[0].hi) + 5); ctx.closePath(); ctx.fill(); }
      // keys: always (the owner put them there)
      const ks = env.keysIn(p);
      for (const edge of ['hi', 'lo']) for (const k of ks[edge]) {
        const b = env.edgeAt(k.t, p), x = X(v, w, k.t), y = yOf(edge === 'hi' ? b[1] : b[0]), s = isSel({ type: 'key', id: keyId(k) });
        ctx.fillStyle = s ? T.txHi : c; ctx.strokeStyle = T.bg;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      // corners: on the hovered / dragged piece, and wherever selected
      const c4 = { hi0: [x0, o[0].hi], lo0: [x0, o[0].lo], hi1: [x1, o[o.length - 1].hi], lo1: [x1, o[o.length - 1].lo] };
      for (const [k, [cx, pos]] of Object.entries(c4)) {
        const s = isSel({ type: 'corner', t0: p.t0, t1: p.t1, corner: k });
        if (!hot && !s) continue;
        const act = (hover?.part === k && same(hover.piece, p)) || (drag?.part === k && same(drag.piece, p));
        ctx.fillStyle = s || act ? T.txHi : T.bg; ctx.strokeStyle = s || act ? T.bg : T.txHi; ctx.lineWidth = 1.25;
        ctx.fillRect(Math.round(cx) - 3.5, Math.round(yOf(pos)) - 3.5, 7, 7); ctx.strokeRect(Math.round(cx) - 3.5, Math.round(yOf(pos)) - 3.5, 7, 7); ctx.lineWidth = 1;
      }
      // the label, or the numbers while dragging
      const top = Math.min(...o.map((q) => yOf(q.hi)));
      if (same(drag?.piece, p) && drag.moved) {
        const cc = cornersOf(env, p), txt = drag.part === 'strength' ? `strength ${Math.round(100 * p.strength)} %` : `${Math.round(cc.lo0)}–${Math.round(cc.hi0)} → ${Math.round(cc.lo1)}–${Math.round(cc.hi1)}`;
        ctx.font = font(10, true); ctx.textBaseline = 'top';
        const tw = ctx.measureText(txt).width + 6, tx = Math.min(Math.max(2, x0), w - tw - 2), ty = Math.max(1, Math.min(h - 14, top - 15));
        ctx.fillStyle = T.bg; ctx.fillRect(tx, ty, tw, 13); ctx.fillStyle = T.txHi; ctx.fillText(txt, tx + 3, ty + 1);
      } else if (x1 - x0 > 46) {
        const lo = Math.min(...o.map((q) => q.lo)), hi = Math.max(...o.map((q) => q.hi));
        ctx.font = font(9, true); ctx.fillStyle = hot ? T.txHi : T.txVal; ctx.textBaseline = 'top';
        const txt = ellipsize(ctx, `S${(typeof p.scene === 'number' ? p.scene : r.i) + 1} ${Math.round(lo)}–${Math.round(hi)}${p.hand ? ' ✎' : ''}${p.strength < 1 ? ` ${Math.round(100 * p.strength)} %` : ''}`, x1 - x0 - 12);
        if (txt) ctx.fillText(txt, Math.max(2, x0) + 9, Math.min(h - 11, top + 2));
      }
    }
    for (const f of fades) {   // the soft start / stop: its handle and words (the narrowing itself is in the band)
      if (f.off) continue;
      const q = fadeHandle(f, w, h);
      if (!q || q.x < -8 || q.x > w + 8) continue;
      const act = drag?.fade?.key === f.key || hover?.fade?.key === f.key;
      ctx.fillStyle = act ? T.txHi : T.reality; ctx.strokeStyle = T.bg; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1;
      ctx.font = font(9, true); ctx.fillStyle = act ? T.txHi : T.txVal; ctx.textBaseline = 'top';
      const txt = `${f.side === 'in' ? 'fade in' : 'fade out'} ${Math.round(100 * f.share)} %`, tw = ctx.measureText(txt).width;
      ctx.fillText(txt, f.side === 'in' ? Math.min(w - tw - 2, q.x + 6) : Math.max(2, q.x - tw - 6), Math.min(h - 11, q.y + 5));
    }
    ctx.globalAlpha = 1;
  }

  const at = (e) => {
    const el = canvasOf();
    if (!el) return null;
    const rc = el.getBoundingClientRect();
    return { rc, x: e.clientX - rc.left, y: e.clientY - rc.top, w: rc.width, h: rc.height };
  };
  const hitAt = (e) => { const a = at(e), f = fadeHit(a); return f ? { part: 'fade', fade: f } : a ? hitBand(env, app.view, a.w, a.h, a.x, a.y) : null; };
  const hoverText = (t, _x, ev) => {
    const hh = ev ? hitAt(ev) : null, p = hh?.piece ?? pieceAt(env, t);
    if (hh?.part === 'fade') return `${hh.fade.side === 'in' ? 'Soft start: the range ramps up over the fade in' : 'Soft stop: the range ramps down over the fade out'}, from ${Math.round(100 * hh.fade.share)} % of the band (follows the fade's handles on the shot)
Drag: the starting share · double-click: the default · right-click: remove`;
    if (!p) {
      const r = plan.find((q) => t >= q.t0 && t < q.t1);
      if (!r) return null;
      const teases = gaps.filter((g) => g.row.i === r.i && g.row.kind === 'tease').map((g) => gapText(g.row));
      return `S${r.i + 1} · ${r.off ? 'as it is' : bandText(r)}\n${r.reason}${r.source === 'gap' ? `\n${gapText(r)}` : ''}${teases.length ? `\n${teases.join('\n')}` : ''}`;
    }
    const m = pieceMaps(scriptOf(app, 'stroke'), plan, {}, env).find((q) => same(q.piece, p)), cc = cornersOf(env, p), r = p.rows[0];
    const band = `${Math.round(cc.lo0)}–${Math.round(cc.hi0)}${Math.round(cc.lo0) !== Math.round(cc.lo1) || Math.round(cc.hi0) !== Math.round(cc.hi1) ? ` → ${Math.round(cc.lo1)}–${Math.round(cc.hi1)}` : ''}`;
    const how = m?.measured ? `base ${Math.round(m.b)}–${Math.round(m.T)} · depth measured from the shaft: kept · band ${band} limits only · strength ${Math.round(m.strength * 100)} %`
      : m ? `base ${Math.round(m.b)}–${Math.round(m.T)} → band ${band} · keeps ${Math.round(m.keep * 100)} % of its own depth · strength ${Math.round(m.strength * 100)} %` : `band ${band}${p.off ? ' · left as it is' : ' · too few strokes to map'}`;
    const part = { hi0: 'start-top corner', lo0: 'start-bottom corner', hi1: 'end-top corner', lo1: 'end-bottom corner', t0: 'start side', t1: 'end side', hi: 'top edge', lo: 'bottom edge', body: 'the piece', key: 'key' }[hh?.part] ?? '';
    return `${p.why.join(' · ')} (${(p.t0 / 1000).toFixed(1)}–${(p.t1 / 1000).toFixed(1)} s)\n${how}${p.why.includes(r.reason) ? '' : `\n${r.reason}`}${part ? `\n${part}: drag (Shift: no snap; Alt: ${hh.part === 't0' || hh.part === 't1' ? 'detach the side' : 'the slope'}; Ctrl: strength) · double-click: back to auto · right-click: more` : ''}`
      + `${on ? '' : '\nAutorange is off: the points play as they are (Ctrl+Alt+R turns the live pass on)'}`;
  };

  // ---- dragging: every move recomputes from the state at the press (ov0 / env0), written every 40 ms inside one group ----
  const timeTargets = () => [...scenesOf(app).flatMap((s) => [s.start_ms, s.end_ms]), ...env.mods.flatMap((m) => [m.t0, m.t1]), ...(app.doc.fx || []).filter((f) => f.kind === 'spurt').map((f) => f.t0), ...env.pieces.flatMap((p) => [p.t0, p.t1 + 1])];
  function down(e) {
    if (e.button !== 0) return;
    const hh = hitAt(e), a = at(e);
    if (!hh) { if (!e.shiftKey) tl.rangeSel = []; return; }
    if (hh.part === 'fade') {   // its height: the starting share (one undo step)
      const f = hh.fade, b = env.edgeAt(f.side === 'in' ? f.t1 : f.t0);
      drag = { fade: f, part: 'fade', y0: e.clientY, x0: e.clientX, h: a.h, moved: false, full: b ? Math.max(1, b[1] - b[0]) : 100 };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    const handle = hh.part === 'key' ? { type: 'key', id: keyId(hh.key) } : hh.part.length === 3 ? { type: 'corner', t0: hh.piece.t0, t1: hh.piece.t1, corner: hh.part } : null;
    if (handle) tl.rangeSel = e.shiftKey ? (isSel(handle) ? sel.filter((s) => !(s.type === handle.type && (s.id ?? s.corner) === (handle.id ?? handle.corner) && s.t0 === handle.t0)) : [...sel, handle]) : isSel(handle) ? sel : [handle];
    else if (!e.shiftKey) tl.rangeSel = [];
    const part = e.ctrlKey && hh.part === 'body' ? 'strength' : hh.part;
    drag = { piece: hh.piece, part, key: hh.key, x0: e.clientX, y0: e.clientY, w: a.w, h: a.h, vs: app.view.start, ov0: ovOf(app), env0: env, alt: e.altKey, moved: false, axis: null,
      s0: hh.piece.hand?.strength ?? hh.piece.strength, t: app.view.start + (a.x / a.w) * app.view.span, seg: (hh.part === 'hi' || hh.part === 'lo') ? segmentKeys(env, hh.piece, hh.part, app.view.start + (a.x / a.w) * app.view.span) : null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function compute(d, e) {
    if (d.part === 'fade') { const dv = (-(e.clientY - d.y0) / Math.max(1, d.h - 2 * PADY)) * 100; return Math.max(0, Math.min(1, Math.round((d.fade.share - dv / d.full) * 100) / 100)); }
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, gain = e.shiftKey ? FINE : GAIN, noSnap = e.shiftKey;
    const dv = (-dy / Math.max(1, d.h - 2 * PADY)) * 100, dt = (dx / d.w) * app.view.span + (app.view.start - d.vs), p = d.piece, E = d.env0;   // + the pan under a drag held at an edge
    const tolMs = (SNAP_PX / d.w) * app.view.span, fms = gridOf(app.player);
    const tSnap = (t) => snapTime(t, { frameMs: fms, targets: timeTargets().filter((x) => x !== p.t0 && x !== p.t1 && x !== p.t1 + 1), tolMs, off: noSnap });
    if (d.part === 'strength') return setPiece(d.ov0, E, p, { strength: Math.max(0, Math.min(1, Math.round((d.s0 + dv / 100) * 100) / 100)) });
    if (d.part === 't0' || d.part === 't1') return moveSide(d.ov0, E, p, d.part, tSnap((d.part === 't0' ? p.t0 : p.t1) + dt), { detach: e.altKey });
    if (d.part === 'key') {
      const t = tSnap(d.key.t + dt), b = E.edgeAt(d.key.t, p), lvl = (d.key.edge === 'hi' ? b[1] : b[0]) + dv * gain, s = snapLevel(lvl, { tol: noSnap ? 0 : 1.5 });
      const r = moveKeys(d.ov0, E, [keyId(d.key)], t - d.key.t, s - (d.key.edge === 'hi' ? b[1] : b[0]));
      d.newId = r.ids[0];
      return r.ov;
    }
    if (d.part.length === 3) {   // a corner: level, or (dragged sideways first) its side in time
      d.axis ??= Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : Math.abs(dy) > 3 ? 'y' : null;
      if (d.axis === 'x') return moveSide(d.ov0, E, p, d.part.endsWith('1') ? 't1' : 't0', tSnap((d.part.endsWith('1') ? p.t1 : p.t0) + dt), { detach: e.altKey });
      const c = cornersOf(E, p), lvl = c[d.part] + dv * gain, side = d.part.endsWith('1') ? 't1' : 't0';
      return setCorners(d.ov0, E, p, { [d.part]: snapLevel(lvl, { targets: neighbourLevels(E, p, side), tol: noSnap ? 0 : 2 }) });
    }
    if ((d.part === 'hi' || d.part === 'lo') && d.seg) {   // between two keys: just those two
      return moveKeys(d.ov0, E, d.seg.map(keyId), 0, Math.round(dv * gain)).ov;
    }
    if (d.part === 'body' && d.alt) { const c = cornersOf(E, p); return setCorners(d.ov0, E, p, { hi1: c.hi1 + dv * gain, lo1: c.lo1 + dv * gain }); }
    return moveLevel(d.ov0, E, p, d.part, dv * gain);
  }
  function move(e) {
    if (!drag) { const hh = hitAt(e); if (hh?.part !== hover?.part || !same(hh?.piece, hover?.piece)) hover = hh; return; }
    const d = drag;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    group ??= app.begin(`Range: ${d.part === 'fade' ? 'fade envelope height' : d.part === 'strength' ? 'strength' : d.part === 'key' ? 'key' : d.part.length === 3 ? 'corner' : d.part === 't0' || d.part === 't1' ? 'side' : d.part === 'body' ? 'move piece' : 'edge'}`);
    pending = compute(d, e);
    drag = { ...d, moved: true };
    timer ??= setTimeout(flush, 40);
  }
  function flush() { clearTimeout(timer); timer = null; if (group && pending != null) { if (drag?.part === 'fade') patchFinish(app, { fades: setFadeEnv(app.doc.finish?.fades, drag.fade.key, { share: pending }) }); else writeOv(app, pending); } }
  function up(e) {
    const d = drag;
    if (group) { flush(); if (d?.part === 'key' && d.newId) tl.rangeSel = [{ type: 'key', id: d.newId }]; }
    else if (d && !d.moved && (d.part === 'hi' || d.part === 'lo')) {   // a click on an edge: a key there
      const r = addKey(ovOf(app), d.part, Math.round(d.t), 0);
      app.transact('Range: add key', () => writeOv(app, r.ov));
      tl.rangeSel = [{ type: 'key', id: r.id }];
    }
    drag = null; pending = null;
    const g = group; group = null; g?.commit();
    // the hover text was made mid-drag: say what the piece is now
    if (tl.hover?.lane === 'range') queueMicrotask(() => { if (tl.hover?.lane === 'range') tl.hover = { ...tl.hover, text: hoverText(tl.hover.t, 0, e) }; });
  }
  function cancel() { clearTimeout(timer); timer = null; drag = null; pending = null; const g = group; group = null; g?.cancel(); }
  function dbl(e) {
    const hh = hitAt(e);
    if (!hh) return;
    if (hh.part === 'fade') { editFadeEnv(app, hh.fade.key, null); return; }   // back to the default share
    if (hh.part === 'key') { editOv(app, 'Range: delete key', (ov) => deleteKeys(ov, [keyId(hh.key)])); tl.rangeSel = []; return; }
    if (hh.part === 'hi' || hh.part === 'lo') return;   // the click already added a key
    if (hh.piece.hand || env.keysIn(hh.piece).hi.length || env.keysIn(hh.piece).lo.length) resetBand(app, 'piece', hh.piece);
    else app.toast('This piece already follows the policy', 'quiet');
  }

  function menu(e) {
    const a = at(e);
    if (!a) return;
    const t = app.view.start + (a.x / a.w) * app.view.span, hh = hitAt(e), p = hh?.piece ?? pieceAt(env, t);
    const r = plan.find((q) => t >= q.t0 && t < q.t1), fills = r ? gaps.filter((g) => g.row.i === r.i) : [];
    if (!p && !r && !fades.some((f) => t >= f.t0 - 100 && t <= f.t1 + 100)) return;
    e.preventDefault();
    const items = [];
    const fz = fades.find((f) => t >= f.t0 - 100 && t <= f.t1 + 100);   // paw-ef73.9: the soft start / stop here
    if (fz) items.push({ section: `${fz.side === 'in' ? 'soft start (fade in)' : 'soft stop (fade out)'} · ${Math.round(100 * fz.share)} %` },
      { label: fz.off ? `Ramp the range over the fade ${fz.side}` : 'Remove the fade envelope', run: () => editFadeEnv(app, fz.key, { off: !fz.off }) },
      { label: 'Fade envelope back to the default', disabled: !app.doc.finish?.fades?.[fz.key], run: () => editFadeEnv(app, fz.key, null) }, { separator: true });
    if (hh?.part === 'key') {
      const id = keyId(hh.key);
      items.push({ section: `key · ${hh.key.edge === 'hi' ? 'top' : 'bottom'} edge` },
        ...['hold', 'linear', 'smooth'].map((ease) => ({ label: `${ease === 'hold' ? 'Hold' : ease === 'linear' ? 'Linear' : 'Smooth'} to the next handle${(hh.key.ease ?? 'linear') === ease ? ' ✓' : ''}`, run: () => editOv(app, `Range: key ${ease}`, (ov) => setEase(ov, [id], ease)) })),
        { label: 'Delete key', run: () => editOv(app, 'Range: delete key', (ov) => deleteKeys(ov, [id])) }, { separator: true });
    }
    if (p) {
      items.push({ section: `${p.why[0]} · ${(p.t0 / 1000).toFixed(1)}–${(p.t1 / 1000).toFixed(1)} s${p.hand ? ' (hand)' : ''}` },
        { label: 'Split band here', run: () => splitBand(app, Math.round(t)) },
        { label: 'Split by shots', run: () => splitByShots(app, p) },
        { label: 'Split by modifier spans', disabled: !env.mods.some((m) => (m.t0 > p.t0 && m.t0 < p.t1) || (m.t1 > p.t0 && m.t1 < p.t1)), run: () => splitBySpans(app, p) },
        { label: 'Merge with the piece before', disabled: !neighbourOf(env, p, 't0'), run: () => mergeBand(app, p, 't0') },
        { label: 'Merge with the piece after', disabled: !neighbourOf(env, p, 't1'), run: () => mergeBand(app, p, 't1') },
        { separator: true },
        { label: 'Strength back to the policy\'s', disabled: p.hand?.strength == null, run: () => setBandPiece(app, p, { strength: null }, 'Range: strength back to the policy') },
        { label: p.off ? 'Range this piece again' : 'Leave this piece as it is', run: () => setBandPiece(app, p, { off: p.off ? null : true }, p.off ? 'Range: range the piece again' : 'Range: leave the piece as it is') },
        { label: 'Back to auto: this piece', disabled: !p.hand && !env.keysIn(p).hi.length && !env.keysIn(p).lo.length, run: () => resetBand(app, 'piece', p) },
        { label: 'Back to auto: this scene', run: () => resetBand(app, 'scene', p) },
        { label: 'Back to auto: everything', disabled: !(app.doc.finish?.bands?.length || app.doc.finish?.keys?.length || scenesOf(app).some((s) => s.range)), run: () => resetBand(app, 'all') },
        { label: 'Flatten this piece (its final into the points)', run: () => flatten(app, { t0: p.t0, t1: p.t1 + 1 }) });
    }
    if (fills.length) items.push({ separator: true }, { label: fills.length === 1 ? `Accept gap fill (${fills[0].row.kind === 'tease' ? 'tease' : fills[0].row.recipe})` : `Accept ${fills.length} gap fills`, run: () => acceptGaps(app, [r.i]) });
    showContextMenu(e, items, { source: root });
  }

  // hand pieces / keys whose scene was deleted: dropped with an undoable toast (not silently)
  $effect(() => { app.doc.scenes; untrack(() => { if (!tl.draft.scenes && (app.doc.finish?.bands?.length || app.doc.finish?.keys?.length)) dropOrphans(app); }); });

  // the gap fills as a preview ghost on the stroke (never saved, never a run; accepted from the strip)
  const GHOST = 'autorange-gaps';
  $effect(() => {
    const script = gaps.flatMap((g) => g.script).sort((a, b) => a.at - b.at);
    untrack(() => {
      const cur = app.doc.ghosts || [], old = cur.find((g) => g.id === GHOST);
      if (!script.length && !old) return;
      if (old && JSON.stringify(old.script) === JSON.stringify(script)) return;
      const rest = cur.filter((g) => g.id !== GHOST);
      app.doc.ghosts = script.length ? [...rest, { id: GHOST, name: 'Autorange gap fills (suggested)', color: theme().warn, axis: 'stroke', script, visible: true, source: { kind: 'autorange-preview' } }] : rest;
    });
  });
  $effect(() => () => untrack(() => { if ((app.doc.ghosts || []).some((g) => g.id === GHOST)) app.doc.ghosts = app.doc.ghosts.filter((g) => g.id !== GHOST); }));

  let policyBtn = $state(), gapsBtn = $state(), policyOpen = $state(false), gapsOpen = $state(false);
  const P = $derived(tl.rangePolicy ?? policyOf(app));
</script>

<div class="rg" bind:this={root} role="presentation" onpointerleave={() => (hover = null)}>
  <CanvasLane {app} lane="range" label="Range" tag={plan.length ? (on ? 'Range · live' : 'Range · off') : null} {paint} {cursor} {hoverText}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} ondblclick={dbl} oncontextmenu={menu} />
  <div class="strip" role="group" aria-label="Autorange">
    <button bind:this={policyBtn} {@attach tooltip('Edit the range policy as curves')} onclick={() => (policyOpen = !policyOpen)}>
      {P.device === 'machine' ? `machine ≥${Math.round(P.floor)}` : 'stroker'} · build-up {Math.round(buildUpOf('penetration', P) * 100)}% · knot ≤{Math.round(P.knotReserve)}{P.width !== 1 ? ` · ×${(+P.width).toFixed(2)}` : ''}{P.offset ? ` · ${P.offset > 0 ? '+' : ''}${Math.round(P.offset)}` : ''}</button>
    <button class="go" class:off={!on} aria-pressed={on} {@attach tooltip(on ? 'Autorange live: the stroke plays through these bands' : 'Autorange off: the points play as they are', 'Ctrl+Alt+R')} onclick={() => setAutorange(app, !on)}>{on ? 'live' : 'off'}</button>
    {#if gaps.length}<button bind:this={gapsBtn} {@attach tooltip('Fills for scenes with no points and dead gaps (orange ghost)')} onclick={() => (gapsOpen = !gapsOpen)}>gaps {gaps.length}</button>{/if}
  </div>
</div>
{#if policyBtn && policyOpen}
  <Popover open={true} anchor={policyBtn} label="Autorange policy" class="fx-pop" onclose={() => (policyOpen = false)}><RangePolicy {app} /></Popover>
{/if}
{#if gapsBtn && gapsOpen && gaps.length}
  <Popover open={true} anchor={gapsBtn} label="Autorange gaps" class="fx-pop" onclose={() => (gapsOpen = false)}>
    <div class="gaps">
      {#each gaps as g (g.row.i + ':' + g.row.t0)}
        <div class="gap"><span>{gapText(g.row)}</span><button onclick={() => acceptGaps(app, [g.row.i])}>accept</button></div>
      {/each}
      <button class="go all" onclick={() => { acceptGaps(app); gapsOpen = false; }}>accept all ({gaps.length}) — one undo step</button>
    </div>
  </Popover>
{/if}

<style>
  .rg { position: absolute; inset: 0; }
  .strip { position: absolute; bottom: 1px; left: 4px; z-index: 2; display: flex; align-items: center; gap: 2px; font: var(--fs-1)/14px var(--mono); white-space: nowrap; }
  .strip button, .gap button, .all { padding: 0 5px; border-radius: var(--radius); color: var(--tx-mut); background: var(--line-0); font: var(--fs-1)/14px var(--mono); }
  .strip button:hover, .gap button:hover, .all:hover { background: var(--line-3); color: var(--tx-hi); }
  .strip button.go, .all { color: var(--highlight); background: rgba(var(--highlight-rgb), .18); }
  .strip button.go.off { color: var(--tx-mut); background: var(--line-0); }
  .strip button:focus-visible, .gap button:focus-visible, .all:focus-visible { outline: var(--ring-w, 2px) solid var(--focus); outline-offset: -1px; }
  .gaps { display: flex; flex-direction: column; gap: var(--space-1); padding: 0 var(--space-3); max-width: min(460px, calc(100vw - 32px)); font: var(--fs-1)/1.5 var(--mono); color: var(--tx); }
  .gap { display: flex; gap: var(--space-2); align-items: center; justify-content: space-between; }
  .gap span { min-width: 0; }
  .gap button { flex: none; }
  .all { align-self: flex-start; margin-top: var(--space-1); }
</style>
