// dev/carried-outline-probe.mjs -- paw-rrtw "these islands are very rigid and tend to fly around": how well a pinned group's drawn
// outline (blobs view: its painting carried by its points, blobs.js carriedOutline; --fit-only: carriedPoly, the fit alone) sits on its LIVE members,
// on saved runs. Reads .pawproj / .pawruns as numbers only (never video or images), writes nothing beside them.
// Per group and frame (where it has live members): the share of its live members inside the drawn outline, and the distance from
// the outline's centroid to the live members' centroid in units of the group's size (sqrt of the painted area, frame heights);
// "off its points" = under half inside. By part: frames, off %, median / p90 distance, the frame-to-frame jump of the outline's
// centroid (group sizes) p50 / p90 / p99 (and the live members' own), the drawn area / painted area p10 / p90, frames drawn unsure /
// not drawn. Before paw-rrtw (the least-squares fit, never unsure), on the owner's 8 saved projects: 2.3 % of 44377 group-frames
// off their points (thighs 5.1, penis 5.4, tail 3.4 %), up to 58 % for single groups.
//   node dev/carried-outline-probe.mjs <project.pawproj> [...] [--fit-only] [--groups (one line per group)] [--json <out>]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { decodeRuns } from '../src/lib/runs-file.js';
import * as B from '../src/features/tracking/blobs.js';
import { inPoly, polyArea, splitName } from '../src/features/tracking/groups.js';
import { seedIds, ownsAt } from '../src/lib/runs-add.js';

const args = process.argv.slice(2), files = args.filter((a) => a.endsWith('.pawproj')), outJson = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const q = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cen = (P) => P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
const rows = {}, add = (part, k, v) => { const r = (rows[part] ??= { frames: 0, off: 0, d: [], jump: [], unsure: 0, none: 0, liveJump: [], area: [] }); if (Array.isArray(r[k])) r[k].push(v); else r[k] += v; };
const fitOf = args.includes('--fit-only') ? 'carriedPoly' : 'carriedOutline';
for (const f of files) {
  const runsF = f.replace(/\.pawproj$/, '.pawruns');
  if (!existsSync(runsF)) continue;
  const proj = JSON.parse(readFileSync(f, 'utf8')), A = proj.media?.width && proj.media?.height ? proj.media.width / proj.media.height : 16 / 9;
  const paint = (proj.scenes || []).flatMap((s) => s.groups || []).filter((g) => g.poly?.length >= 3 && Number.isFinite(g.t_ms) && !g.off);
  if (!paint.length) continue;
  for (const run of decodeRuns(readFileSync(runsF))) {
    const fr = run.frames;
    if (!fr?.t?.length) continue;
    const sn = B.semNames(run);
    for (let s = 1; s <= sn.length; s++) {
      const name = sn[s - 1];
      if (!name) continue;
      const own = paint.filter((g) => g.name === name);
      if (!own.length) continue;
      const seed = seedIds(run).get(s)?.find((x) => x.own !== null), pick = (t) => own.reduce((b, x) => (Math.abs(x.t_ms - (seed ? seed.t_ms : t)) < Math.abs(b.t_ms - (seed ? seed.t_ms : t)) ? x : b), own[0]);   // blobs.js paintOf
      let g = pick(fr.t[0]);
      const part = splitName(name).part || name;
      let prev = null, prevLive = null; const G0 = { n: 0, off: 0, none: 0, d: [] };
      for (let i = 0; i < fr.t.length; i++) {
        const pts = fr.ov[i]?.pts;
        if (!pts) { prev = prevLive = null; continue; }
        const live = pts.filter((p) => B.semOf(p) === s && p[2] && ownsAt(run, s, fr.t[i]));
        if (!live.length) { prev = prevLive = null; continue; }
        g = pick(fr.t[i]); const size = Math.sqrt(polyArea(g.poly) * A);
        let poly = null, sure = true;
        if (fitOf === 'carriedOutline') { const o = B.carriedOutline(fr, i, s, g.poly, g.t_ms, A); poly = o?.poly || null; sure = !!o?.sure; }
        else poly = B.carriedPoly(fr, i, s, g.poly, g.t_ms, A);
        add(part, 'frames', 1);
        const lc = cen(live);
        if (prevLive) add(part, 'liveJump', Math.hypot((lc[0] - prevLive[0]) * A, lc[1] - prevLive[1]) / size);
        prevLive = lc;
        if (!poly) { add(part, 'none', 1); G0.none++; prev = null; continue; }
        if (!sure) add(part, 'unsure', 1);
        const inside = live.filter((p) => inPoly(poly, p[0], p[1])).length / live.length, c = cen(poly);
        if (inside < 0.5 && sure) add(part, 'off', 1);
        G0.n++; if (inside < 0.5 && sure) G0.off++; G0.d.push(Math.hypot((c[0] - lc[0]) * A, c[1] - lc[1]) / size);
        if (sure) add(part, 'area', polyArea(poly) / polyArea(g.poly));
        add(part, 'd', Math.hypot((c[0] - lc[0]) * A, c[1] - lc[1]) / size);
        if (prev) add(part, 'jump', Math.hypot((c[0] - prev[0]) * A, c[1] - prev[1]) / size);
        prev = c;
      }
      if (args.includes('--groups') && G0.n) console.log(`${f.replace(/^.*[\/]/, '')} ${run.id} s${s} ${name} seeds ${JSON.stringify((seedIds(run).get(s) || []).map((x) => x.t_ms))} painting@${g.t_ms} of ${own.map((x) => x.t_ms)}: drawn ${G0.n}, off ${(100 * G0.off / G0.n).toFixed(0)} %, dist90 ${q(G0.d, 0.9).toFixed(2)}, none ${G0.none}`);
    }
  }
}
const out = Object.entries(rows).sort((a, b) => b[1].frames - a[1].frames).map(([part, r]) => ({ part, frames: r.frames, offPct: +(100 * r.off / r.frames).toFixed(1), unsurePct: +(100 * r.unsure / r.frames).toFixed(1), nonePct: +(100 * r.none / r.frames).toFixed(1),
  dist50: +q(r.d, 0.5).toFixed(2), dist90: +q(r.d, 0.9).toFixed(2), jump50: +q(r.jump, 0.5).toFixed(3), jump90: +q(r.jump, 0.9).toFixed(3), jump99: +q(r.jump, 0.99).toFixed(3), area10: +q(r.area, 0.1).toFixed(2), area90: +q(r.area, 0.9).toFixed(2), liveJump99: +q(r.liveJump, 0.99).toFixed(3) }));
const tot = Object.values(rows).reduce((a, r) => ({ frames: a.frames + r.frames, off: a.off + r.off, unsure: a.unsure + r.unsure, none: a.none + r.none }), { frames: 0, off: 0, unsure: 0, none: 0 });
console.log(`${fitOf}: ${tot.frames} group-frames, off its points (sure, < half its live members inside) ${(100 * tot.off / tot.frames).toFixed(1)} %, drawn unsure ${(100 * tot.unsure / tot.frames).toFixed(1)} %, not drawn ${(100 * tot.none / tot.frames).toFixed(1)} %`);
console.table(out);
if (outJson) writeFileSync(outJson, JSON.stringify({ fit: fitOf, tot, parts: out }, null, 1));
