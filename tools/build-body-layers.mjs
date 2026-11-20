// tools/build-body-layers.mjs -- a layered body for the Machine panel from tools/zanatomy_export.py's buffers (paw-27u0).
//
//   node tools/build-body-layers.mjs --in <export dir> [--id human] [--name Human] [--out src/features/machine/bodies]
//
// Per layer (skin, skeleton and the organ groups of tools/zanatomy_export.py) the mesh becomes PWB1 parts (meshbody.js encodeBody: 16-bit
// indices, so a layer over 65535 vertices is split, never truncated): <id>.<layer>.<k>.bin. Triangles go in order of
// distance from the opening, so the skin's first part holds the whole rear (the canal is cut into it at run time,
// meshbody.js cutCanal) with room for the canal's rings. The json lists the layers (and which are on by default), the
// landmarks (the opening from the anal sphincter's axis through the skin; the entry along the torso and dorsal from
// autoLandmarks on the skin, as for any imported body), the neck's cut plane and fade, the colon's centre line
// (rectum -> sigmoid -> descending colon, metres), the measured standing height. The attribution goes beside it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBody, parseBody, autoLandmarks } from '../src/features/machine/meshbody.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('in'), ID = arg('id', 'human'), NAME = arg('name', 'Human'), OUT = arg('out', 'src/features/machine/bodies');
if (!IN) { console.error('usage: --in <export dir> [--id --name --out]'); process.exit(2); }
const LAYERS = [['skin', 'Skin', true], ['skeleton', 'Skeleton', true], ['colon', 'Rectum and colon', false], ['small', 'Small intestine', false], ['stomach', 'Stomach and oesophagus', false],
  ['bladder', 'Bladder', false], ['genitals', 'Prostate and genitals', false], ['kidneys', 'Kidneys and adrenals', false], ['liver', 'Liver, gallbladder, pancreas, spleen', false], ['thorax', 'Lungs, heart, trachea', false]];
const MAXV = 60000;   // per part: under 65535 with room for the canal cutCanal stitches in
const man = JSON.parse(readFileSync(join(IN, 'manifest.json'), 'utf8'));
const f32 = (f) => { const b = readFileSync(join(IN, f)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const r5 = (a) => a.map((x) => +x.toFixed(5));

/** Triangles nearest `o` first, in parts of at most MAXV vertices -> [{pos, nor, uv, col, idx}]. */
function split(pos, nor, col, idx, o) {
  const nt = idx.length / 3, order = Array.from({ length: nt }, (_, t) => t), d = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { let s = 0; for (let q = 0; q < 3; q++) { const c = (pos[idx[t * 3] * 3 + q] + pos[idx[t * 3 + 1] * 3 + q] + pos[idx[t * 3 + 2] * 3 + q]) / 3 - o[q]; s += c * c; } d[t] = s; }
  order.sort((a, b) => d[a] - d[b]);
  const parts = [];
  let map = new Map(), P = [], N = [], C = [], I = [];
  const flush = () => { if (I.length) parts.push({ pos: Float32Array.from(P), nor: Float32Array.from(N), uv: new Float32Array((P.length / 3) * 2), col: Uint8Array.from(C), idx: Uint16Array.from(I) }); map = new Map(); P = []; N = []; C = []; I = []; };
  for (const t of order) {
    const vs = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    if (map.size + vs.filter((v) => !map.has(v)).length > MAXV) flush();
    for (const v of vs) {
      if (!map.has(v)) { map.set(v, P.length / 3); P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]); C.push(col[v * 4], col[v * 4 + 1], col[v * 4 + 2], col[v * 4 + 3]); }
      I.push(map.get(v));
    }
  }
  flush();
  return parts;
}

mkdirSync(OUT, { recursive: true });
const layers = [], skinParts = [];
let total = 0;
for (const [L, name, on] of LAYERS) {
  const pos = f32(`${L}.pos.f32`), nor = f32(`${L}.nor.f32`), col = readFileSync(join(IN, `${L}.col.u8`)), ib = readFileSync(join(IN, `${L}.idx.u32`)), idx = new Uint32Array(ib.buffer, ib.byteOffset, ib.byteLength / 4);
  const parts = split(pos, nor, col, idx, man.opening), files = [];
  let bytes = 0;
  parts.forEach((p, k) => {
    const b = encodeBody(p), f = `${ID}.${L}.${k}.bin`;
    writeFileSync(join(OUT, f), b); files.push(f); bytes += b.length;
    if (L === 'skin') skinParts.push(parseBody(b));
  });
  total += bytes;
  layers.push({ id: L, name, on, parts: files, vertices: pos.length / 3, triangles: idx.length / 3, bytes });
  console.log(L, parts.length, 'parts', pos.length / 3, 'vertices', idx.length / 3, 'triangles', (bytes / 1e6).toFixed(2), 'MB');
}
// the skin as one mesh (as the panel loads it, quantised) for the landmarks
const nv = skinParts.reduce((s, p) => s + p.pos.length / 3, 0), sk = { pos: new Float32Array(nv * 3), col: new Float32Array(nv * 4), idx: [] };
let off = 0;
for (const p of skinParts) { sk.pos.set(p.pos, off * 3); sk.col.set(p.col, off * 4); for (const i of p.idx) sk.idx.push(i + off); off += p.pos.length / 3; }
sk.idx = Uint32Array.from(sk.idx);
// the entry: along the rectum (the anal verge -> the rectosigmoid junction, in the midline plane); the torso's own line
// (autoLandmarks) runs along the sacrum's front from this opening, the rectum ~20 deg below it
const lm = autoLandmarks(sk), height = Math.round(man.height_m * 1000) / 10;
const rs = man.rectosigmoid, op = man.opening, el = Math.hypot(rs[1] - op[1], rs[2] - op[2]), entry = [0, (rs[1] - op[1]) / el, (rs[2] - op[2]) / el], dorsal = [0, entry[2], -entry[1]];
const info = {
  v: 2, id: ID, name: NAME, units: 'm', up: [0, 1, 0], fwd: [0, 0, 1], height_cm: height,
  note: `Z-Anatomy's male model (BodyParts3D), standing height ${height} cm measured on its skin (hair excluded); posed on all fours by tools/zanatomy_export.py (torso pitched ${man.pitch_deg.toFixed(1)} deg head-up so knees and palms meet one floor), head removed, kidneys replaced by generated shapes.`,
  landmarks: { opening: r5(man.opening), entry: r5(entry), dorsal: r5(dorsal), symmetry: +lm.symmetry.toFixed(5), shapeOpening: r5(lm.opening), torsoEntry: r5(lm.entry) },
  sphincter: { centre: r5(man.sphincter.centre), axis: r5(man.sphincter.axis) },
  layers,
  fade: { point: r5(man.cut.point), normal: r5(man.cut.normal), width: man.cut.fade, neck: man.cut.neck },
  colonPath: man.colonPath.map(r5), rectosigmoid: r5(man.rectosigmoid),
  // (the prostate's centre and radius for the stimulation readout, paw-xdcy: kept from the last build; measured once
  // from the Prostate object's vertices)
  ...(() => { try { const prev = JSON.parse(readFileSync(join(OUT, `${ID}.json`), 'utf8')); return prev.prostate ? { prostate: prev.prostate } : {}; } catch { return {}; } })(),
  attribution: `${ID}.ATTRIBUTION.txt`,
  mesh: { bytes: total, objects: Object.fromEntries(Object.entries(man.objects).map(([k, v]) => [k, v.length])) },
};
writeFileSync(join(OUT, `${ID}.json`), JSON.stringify(info, null, 1) + '\n');
writeFileSync(join(OUT, `${ID}.ATTRIBUTION.txt`), `The Machine panel's Human body (${ID}.json and ${ID}.*.bin) is derived from the Z-Anatomy atlas:

BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan
Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0

Authors: Kousaku OKUBO (BodyParts3D), Gauthier KERVYN (design, 3D, anatomy), Marcin ZIELINSKI (Blender add-on), Lluis VINENT (Unity development).

Modified for Pawscript (tools/zanatomy_export.py, tools/build-body-layers.mjs): posed on all fours, the head removed
(everything above the base of the neck, the brain and the inner ear with it), the kidneys replaced by generated shapes
(the atlas's kidney model is not included), the hair, muscles, vessels and nerves left out, the meshes reduced and
coloured per tissue. This derived mesh is itself licensed CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
`);
console.log('total', (total / 1e6).toFixed(2), 'MB; landmarks', JSON.stringify(info.landmarks));
