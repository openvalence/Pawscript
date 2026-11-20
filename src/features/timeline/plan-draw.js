// plan-draw.js -- the plan lane's canvas: segments as coloured blocks that read like an energy curve across the
// video (fill height from the bottom = intensity), a full-colour accent strip on top, kind icon + name +
// recipe/params where there is room, the generation state, the compiled motion as a thin ghost curve, and the
// selection with edge handles. Pixel rule (draw.js): block [t0, t1) fills X(t0) .. X(t1); its start edge is the
// 1px column X(t0). `blockLod` is pure (node-tested); the rest needs a 2D context.
import { msToX } from '../../lib/lane.js';
import { lowerBound } from '../../lib/core/script.js';
import { X, theme, font, ellipsize, drawKindIcon, drawRange, drawCuts, drawHint } from './draw.js';
import { kindOf, rgba } from './kinds.js';
import { cssVar } from '../../ui/kit/color.js';
import { onThemeChange } from '../../ui/kit/tokens.js';
import { segState, recipeLabel, paramSummary, intensityOf, schemaOf, paramValue } from './plan.js';

export const STRIP = 3;   // accent strip height (px)

/**
 * Level of detail for a block bw px wide in a lane h px tall:
 *   lod 'color' (fill + strip only) | 'icon' (kind icon) | 'text' (icon + name, then `rows` text lines).
 */
export function blockLod(bw, h) {
  if (bw < 18 || h < 22) return { lod: 'color', rows: 0 };
  if (bw < 46) return { lod: 'icon', rows: 0 };
  const rows = bw < 80 ? 1 : h >= 96 ? 3 : h >= 50 ? 2 : 1;
  return { lod: 'text', rows };
}

/** Text rows of a segment for `rows` lines: [name, line2?, line3?]. */
export function blockText(s, rows) {
  const name = s.name || kindOf(s.kind).label, rec = recipeLabel(s.recipe), ps = paramSummary(s);
  const pct = hasIntensity(s) ? Math.round(intensityOf(s) * 100) + '%' : '';
  if (rows >= 3) return [name, [rec, pct].filter(Boolean).join(' · '), ps];
  if (rows === 2) return [name, [rec, ps].filter(Boolean).join(' · ')];
  return [name];
}

/** Does the segment's recipe take an intensity (hold does not: no energy bar)? */
export const hasIntensity = (s) => schemaOf(s.recipe).some((p) => p.key === 'intensity');

/** Energy at the segment's start and end, 0..1: intensity x depth envelope (ramp amp0/amp1, fadeFrom/fadeTo).
 *  null when the recipe has no intensity (a hold). */
export function energyOf(s) {
  if (!hasIntensity(s)) return null;
  const I = intensityOf(s), n = (k, d) => { const v = Number(paramValue(s, k) ?? d); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; };
  return [I * n('amp0', 1) * n('fadeFrom', 1), I * n('amp1', 1) * n('fadeTo', 1)];
}

// per-segment derived look, cached by identity (segments are immutable values)
const looks = new WeakMap();
function lookOf(s) {
  let L = looks.get(s);
  if (!L) {
    const k = kindOf(s.kind), st = segState(s);
    L = { k, st, energy: energyOf(s), text: [null, blockText(s, 1), blockText(s, 2), blockText(s, 3)] };
    looks.set(s, L);
  }
  return L;
}

// --warn-ink: the warn hue that holds contrast on the theme's background (dark amber in the light theme)
let warnInk = null;
if (typeof document !== 'undefined') onThemeChange(() => { warnInk = null; });

const LOCK = typeof Path2D !== 'undefined' ? new Path2D('M1.5 5.5h7v5h-7z M3 5.5V3.5a2 2 0 0 1 4 0v2') : null;

/**
 * o: {sel: Set(ids), hover: {id, part} | null, preview: Script | null, cuts: [ms], range, drop: {t0, t1} | null,
 *     hint: string (drawn when the plan is empty), runs: Map(segId -> run label) chips (several runs overlap, or explicit)}
 */
export function drawPlan(ctx, w, h, view, plan, o) {
  const T = theme(), a = view.start, b = view.start + view.span;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, h);
  drawCuts(ctx, view, w, h, o.cuts || [], rgba(T.txHi, 0.1));
  warnInk ??= cssVar('--warn-ink') || T.warn;

  const body = h - STRIP;
  for (const s of plan) {
    if (s.t1 < a || s.t0 > b) continue;
    const L = lookOf(s), c = L.k.color, locked = L.st === 'locked';
    const sel = o.sel.has(s.id), hov = o.hover?.id === s.id;
    const x0 = X(view, w, s.t0), x1 = Math.max(x0 + 1, X(view, w, s.t1));
    const cx0 = Math.max(-2, x0), cx1 = Math.min(w + 2, x1), bw = x1 - x0;
    const k = locked ? 0.45 : 1;

    // base tint over the whole block, energy fill from the bottom, its top edge as the energy line
    ctx.fillStyle = rgba(c, (sel ? 0.14 : hov ? 0.11 : 0.07) * k); ctx.fillRect(cx0, 0, cx1 - cx0, h);
    if (L.energy) {   // a trapezoid: flat for most recipes, a slope for ramps and fades
      const top = body - 2, y0 = h - Math.max(1, Math.round(L.energy[0] * top)), y1 = h - Math.max(1, Math.round(L.energy[1] * top));
      ctx.fillStyle = rgba(c, (sel ? 0.26 : 0.2) * k);
      if (y0 === y1) ctx.fillRect(cx0, y0, cx1 - cx0, h - y0);
      else { ctx.beginPath(); ctx.moveTo(x0, h); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, h); ctx.fill(); }
      if (bw >= 3) {
        ctx.strokeStyle = rgba(c, 0.6 * k); ctx.lineWidth = 1; ctx.beginPath();
        if (y0 === y1) { ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(cx0, y0, cx1 - cx0, 1); }
        else { ctx.moveTo(x0, y0 + 0.5); ctx.lineTo(x1, y1 + 0.5); ctx.stroke(); }
      }
    }

    // compiled motion, behind the text
    if (o.preview?.length && bw >= 24) ghost(ctx, o.preview, view, w, Math.max(0, x0), Math.min(w, x1), Math.max(s.t0, a), Math.min(s.t1, b), STRIP + 3, body - 6, c, k);

    // accent strip: solid once generated, dashed while new (never generated)
    ctx.fillStyle = rgba(c, k * (sel || hov ? 1 : 0.85));
    if (L.st === 'new' && bw >= 20) { for (let x = x0; x < x1; x += 7) if (x + 4 > cx0 && x < cx1) ctx.fillRect(x, 0, Math.min(4, x1 - x), STRIP); }
    else ctx.fillRect(cx0, 0, cx1 - cx0, STRIP);
    // start edge
    if (bw >= 4) { ctx.fillStyle = rgba(c, (bw >= 20 ? 0.9 : 0.5) * k); ctx.fillRect(x0, 0, 1, h); }

    // labels
    const { lod, rows } = blockLod(bw, h);
    const vx0 = Math.max(x0, 0), vx1 = Math.min(x1, w);   // keep labels in view when a block runs off the edge
    let right = vx1 - 4;
    if (lod !== 'color' && (L.st === 'stale' || locked) && vx1 - vx0 > 30) {   // state glyph, top right
      if (locked) { ctx.save(); ctx.translate(right - 10, STRIP + 3); ctx.strokeStyle = T.txMut; ctx.lineWidth = 1.2; ctx.stroke(LOCK); ctx.restore(); }
      else { ctx.fillStyle = warnInk; ctx.beginPath(); ctx.arc(right - 3, STRIP + 7, 2.5, 0, 6.2832); ctx.fill(); }
      right -= 14;
    }
    const run = o.runs?.get(s.id);
    if (run && lod === 'text') {   // the tracker run this segment follows, as a quiet outlined chip at the top right
      ctx.font = font(9, true);
      const tw = Math.ceil(ctx.measureText(run).width) + 8;
      if (right - tw > vx0 + 70) {
        const cx = right - tw;
        ctx.fillStyle = rgba(T.bg, 0.7); ctx.fillRect(cx, STRIP + 3, tw, 12);
        ctx.strokeStyle = rgba(c, 0.7 * k); ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, STRIP + 3.5, tw - 1, 11);
        ctx.fillStyle = T.txVal; ctx.textBaseline = 'alphabetic'; ctx.fillText(run, cx + 4, STRIP + 12);
        right = cx - 4;
      }
    }
    if (lod === 'icon') {
      const sz = Math.min(14, bw - 6), ix = Math.round((Math.max(vx0, x0) + Math.min(vx1, x1)) / 2 - sz / 2);
      if (vx1 - vx0 >= sz + 4) drawKindIcon(ctx, s.kind, Math.max(vx0 + 3, Math.min(ix, vx1 - sz - 3)), STRIP + 4, sz, rgba(c, k));
    } else if (lod === 'text' && vx1 - vx0 > 30) {
      // each line sits on a soft backing of the lane background, so text holds its contrast on every kind
      // colour and over the ghost curve, in every theme
      const tx = vx0 + 5, lines = L.text[rows], back = rgba(T.bg, 0.62);
      ctx.textBaseline = 'alphabetic';
      ctx.font = font(11, false, 500);
      const name = ellipsize(ctx, lines[0], right - tx - 16);
      ctx.fillStyle = back; ctx.fillRect(tx - 2, STRIP + 2, 16 + ctx.measureText(name).width + 4, 14);
      drawKindIcon(ctx, s.kind, tx, STRIP + 4, 12, rgba(c, k));
      ctx.fillStyle = locked ? T.txMut : T.txHi; ctx.fillText(name, tx + 16, STRIP + 13);
      ctx.font = font(10);
      for (let r = 1; r < lines.length; r++) {
        const y = STRIP + 13 + 12 * r;
        if (!lines[r] || y >= h - 2) continue;
        const t = ellipsize(ctx, lines[r], vx1 - tx - 4);
        if (!t) continue;
        ctx.fillStyle = back; ctx.fillRect(tx - 2, y - 9, ctx.measureText(t).width + 4, 12);
        ctx.fillStyle = T.txMut; ctx.fillText(t, tx, y);   // locked reads from the lock glyph and the dimmed block, never a ghost-grey label
      }
    }

    // selection: outline and edge handles; hovered edge highlighted
    if (sel) {
      ctx.strokeStyle = T.txHi; ctx.globalAlpha = 0.8; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(0, bw - 1), h - 1); ctx.globalAlpha = 1;
      if (bw >= 10) {
        const gy = Math.round(h / 2 - Math.min(9, h / 5)), gh = Math.round(Math.min(18, (2 * h) / 5));
        ctx.fillStyle = T.txHi; ctx.fillRect(x0 + 2, gy, 2, gh); ctx.fillRect(x1 - 4, gy, 2, gh);
      }
    }
    if (hov && (o.hover.part === 't0' || o.hover.part === 't1')) {
      ctx.fillStyle = T.txHi; ctx.fillRect(o.hover.part === 't0' ? x0 : x1 - 2, 0, 2, h);
    }
  }

  if (o.drop) {   // drop target preview
    const x0 = X(view, w, o.drop.t0), x1 = X(view, w, o.drop.t1);
    ctx.fillStyle = rgba(T.txHi, 0.08); ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.strokeStyle = T.txHi; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 + 0.5, 0.5, Math.max(0, x1 - x0 - 1), h - 1); ctx.setLineDash([]);
  }
  if (!plan.length && o.hint) drawHint(ctx, h, o.hint, 10);
  drawRange(ctx, view, w, h, o.range);
}

/**
 * Script s between ta..tb as a thin line in columns [xa, xb): a polyline when sparse, a per-pixel min/max
 * envelope when there are more than two points per column. No allocation (100k-action previews).
 */
function ghost(ctx, s, view, w, xa, xb, ta, tb, top, hh, c, k) {
  const i0 = Math.max(0, lowerBound(s, ta) - 1), i1 = Math.min(s.length, lowerBound(s, tb) + 1);
  if (i1 - i0 < 2 || xb <= xa) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(xa, 0, xb - xa, top + hh + 4); ctx.clip();
  const dense = i1 - i0 > 2 * (xb - xa), Y = (p) => top + (1 - p / 100) * hh;
  ctx.strokeStyle = rgba(c, (dense ? 0.18 : 0.45) * k); ctx.lineWidth = 1; ctx.beginPath();
  if (dense) {
    let col = -1e9, mn = 0, mx = 0, prev = s[i0].pos;
    for (let i = i0; i <= i1; i++) {
      const c = i < i1 ? Math.floor(msToX(view, w, s[i].at)) : 1e9;
      if (c !== col) {
        if (col >= xa - 1 && col <= xb) { ctx.moveTo(col + 0.5, Y(mx) - 0.5); ctx.lineTo(col + 0.5, Y(mn) + 0.5); }
        if (i === i1) break;
        col = c; mn = mx = prev;
      }
      const p = s[i].pos;
      if (p < mn) mn = p;
      if (p > mx) mx = p;
      prev = p;
    }
  } else {
    for (let i = i0; i < i1; i++) { const x = msToX(view, w, s[i].at), y = Y(s[i].pos); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
  }
  ctx.stroke();
  ctx.restore();
}
