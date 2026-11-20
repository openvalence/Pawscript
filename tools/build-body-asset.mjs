// tools/build-body-asset.mjs -- one-off build of an imported character body for the Machine panel (private use).
//
//   node tools/build-body-asset.mjs --obj <model.obj> --mtl <model.mtl> --id mybody --name "My body" --height 170
//        --mask <MAIN two-tone mask.png> --tones <an older full MAIN colour map.png> --emission <MAIN_Emission.png>
//        --fins <FINS_BaseColor.png> [--skin MAIN,<more skin materials>] [--drop Mouth] [--out src/features/machine/bodies]
//
// The OBJ (posed, triangulated, Y up, metres, never copied) becomes a compact mesh the panel loads fast
// (src/features/machine/meshbody.js parseBody: 16-bit positions, 8-bit normals, the atlas UVs, a colour and part flag
// per vertex):
//  - parts that never show are dropped (--drop: object names; the closed mouth's inside, ~145k of the 227k triangles);
//    the eyes (24k triangles for two small spheres) are welded by vertex clustering on a 2.5 mm grid; the skin and the
//    rest keep their own triangles (the hips, rear, belly and thighs at the model's own quality);
//  - colour: the skin (material MAIN, and any other material --skin names that carries the MAIN maps) samples one texture atlas
//    (<out>/<id>.tex.webp, 2048 px): the top 3/4 the skin's colour (the two tones mixed by the mask: MTL MAIN Kd for
//    black, the light tone from the older full colour map where the mask is white; the glowing markings from the
//    emission map painted on), the bottom-left quarter the emission (the shader adds it unlit), the bottom-right the
//    fins' colour map (the Fins material); every other material a flat colour (MTL Kd, sRGB; FLAT below for the ones
//    without);
//  - the landmarks (the opening, the entry direction, dorsal; meshbody.js autoLandmarks, on the quantised mesh the
//    panel loads, so the numbers match) and the model's standing height (cm, --height: from its limb lengths, see the
//    json's note) go to <out>/<id>.json; the panel fits everything else (sections, bone, belly) at run time.
// Image decoding and encoding run in a headless Edge via Playwright (already a dev dependency), one image at a time,
// downscaled as it is decoded.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { encodeBody, parseBody, autoLandmarks } from '../src/features/machine/meshbody.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OBJ = arg('obj'), MTL = arg('mtl'), ID = arg('id', 'mybody'), NAME = arg('name', 'My body'), HEIGHT = +arg('height', 170), OUT = arg('out', 'src/features/machine/bodies');
const DROP = (arg('drop', 'Mouth') || '').split(',').filter(Boolean), TEX = 2048;
if (!OBJ || !MTL) { console.error('usage: --obj <obj> --mtl <mtl> --mask <png> --tones <png> --emission <png> --fins <png> [--id --name --height --out]'); process.exit(2); }
// materials without a usable Kd (texture-only in the MTL): flat colours (sRGB 0..1)
const FLAT = { 'Tiny_Sclera_1.3_(Style_Blackout)': [0.05, 0.05, 0.06], 'Tiny_Iris_1.3_(Style_Blackout)': [0.12, 0.13, 0.16] };
const SKIN = arg('skin', 'MAIN').split(',').filter(Boolean), TEXTURED = { Fins: 2 };
const srgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// ---- the MTL's colours ----
const kd = {};
let cur = null;
for (const line of readFileSync(MTL, 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'newmtl') cur = line.trim().slice(7);
  else if (p[0] === 'Kd' && cur) kd[cur] = p.slice(1, 4).map(Number).map(srgb);
}
const DARK = kd.MAIN || [0.32, 0.38, 0.5];

// ---- the OBJ ----
const v = [], vt = [], vn = [], F = [];   // F: [obj, mat, [v, vt, vn] x 3]
let obj = '', mat = '';
for (const line of readFileSync(OBJ, 'utf8').split('\n')) {
  if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
  else if (line.startsWith('vt ')) { const p = line.split(/\s+/); vt.push(+p[1], +p[2]); }
  else if (line.startsWith('vn ')) { const p = line.split(/\s+/); vn.push(+p[1], +p[2], +p[3]); }
  else if (line.startsWith('o ')) obj = line.slice(2).trim();
  else if (line.startsWith('usemtl ')) mat = line.slice(7).trim();
  else if (line.startsWith('f ')) {
    const c = line.trim().split(/\s+/).slice(1).map((x) => x.split('/').map((s) => (s ? parseInt(s, 10) - 1 : -1)));
    for (let i = 1; i + 1 < c.length; i++) F.push([obj, mat, c[0], c[i], c[i + 1]]);
  }
}
const srcTris = F.length;
const pos = [], nor = [], uv = [], col = [], idx = [], ids = new Map();
const vert = (mat, flag, rgb, [pi, ti, ni], snap = 0) => {
  let p = [v[pi * 3], v[pi * 3 + 1], v[pi * 3 + 2]];
  if (snap) p = p.map((x) => (Math.round(x / snap) + 0.5) * snap);
  const key = snap ? `${mat}|s${p.join(',')}` : `${mat}|${pi}|${ti}|${ni}`;
  let id = ids.get(key);
  if (id !== undefined) return id;
  id = pos.length / 3; ids.set(key, id);
  pos.push(...p); nor.push(...(ni >= 0 ? [vn[ni * 3], vn[ni * 3 + 1], vn[ni * 3 + 2]] : [0, 1, 0]));
  let u = ti >= 0 ? vt[ti * 2] : 0, w = ti >= 0 ? vt[ti * 2 + 1] : 0;
  if (flag === 1) { u = Math.min(1, Math.max(0, u)); w = 0.25 + 0.75 * Math.min(1, Math.max(0, w)); }
  else if (flag === 2) { u = 0.5 + 0.5 * Math.min(1, Math.max(0, u)); w = 0.25 * Math.min(1, Math.max(0, w)); }
  else { u = 0; w = 0; }
  uv.push(u, w); col.push(...rgb.map((x) => Math.round(x * 255)), flag);
  return id;
};
const dropped = {}, used = new Set();
for (const [o, m, a, b, c] of F) {
  if (DROP.includes(o)) { dropped[o] = (dropped[o] || 0) + 1; continue; }
  used.add(m);
  const flag = SKIN.includes(m) ? 1 : TEXTURED[m] || 0, rgb = flag === 1 ? DARK : FLAT[m] || kd[m] || [0.7, 0.7, 0.7], snap = o === 'Eyes' ? 0.0025 : 0;
  const t = [vert(m, flag, rgb, a, snap), vert(m, flag, rgb, b, snap), vert(m, flag, rgb, c, snap)];
  if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
  idx.push(...t);
}
// welded eye vertices: smooth normals from their faces
{
  const eyes = new Set(); for (const [k, id] of ids) if (k.includes('|s')) eyes.add(id);
  const acc = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (!eyes.has(a)) continue;
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]), e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const q of [a, b, c]) { const s = acc.get(q) || [0, 0, 0]; acc.set(q, s.map((x, k) => x + n[k])); }
  }
  for (const [q, n] of acc) { const l = Math.hypot(...n) || 1; nor.splice(q * 3, 3, n[0] / l, n[1] / l, n[2] / l); }
}
const bytes = encodeBody({ pos: Float32Array.from(pos), nor: Float32Array.from(nor), uv: Float32Array.from(uv), col: Uint8Array.from(col), idx: Uint16Array.from(idx) });
const lm = autoLandmarks(parseBody(bytes));
const r4 = (a) => a.map((x) => +x.toFixed(5));

// ---- the texture atlas ----
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const b64 = (f) => readFileSync(f).toString('base64');
await page.evaluate(() => { window.img = async (s, w, h) => createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob(), { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); window.px = (bm) => { const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); bm.close(); return g.getImageData(0, 0, c.width, c.height); }; });
// the light tone: the older full map's colour where the mask is white (and no marking)
const light = await page.evaluate(async ({ mask, tones }) => {
  const m = px(await img(mask, 512, 512)).data, t = px(await img(tones, 512, 512)).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < m.length; i += 4) if (m[i] > 230 && Math.abs(t[i] - t[i + 2]) < 30) { r += t[i]; g += t[i + 1]; b += t[i + 2]; n++; }
  return [r / n / 255, g / n / 255, b / n / 255];
}, { mask: b64(arg('mask')), tones: b64(arg('tones')) });
const webp = await page.evaluate(async ({ mask, emission, fins, dark, light, S }) => {
  const c = new OffscreenCanvas(S, S), g = c.getContext('2d'), H = (S * 3) / 4;
  const m = px(await img(mask, S, H)), e = px(await img(emission, S, H)), out = g.createImageData(S, S), d = out.data;
  // the skin: two tones by the mask, the markings (the emission's colour) over them
  for (let i = 0; i < S * H; i++) {
    const k = i * 4, a = m.data[k] / 255, er = e.data[k], eg = e.data[k + 1], eb = e.data[k + 2], w = Math.max(er, eg, eb) / 255;
    for (let q = 0; q < 3; q++) { const t = (dark[q] + (light[q] - dark[q]) * a) * 255, em = [er, eg, eb][q]; d[k + q] = Math.round(t + (em - t) * w); }
    d[k + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  g.imageSmoothingQuality = 'high';
  const eb = await img(emission, S / 2, S / 4); g.drawImage(eb, 0, H); eb.close();
  const fb = await img(fins, S / 2, S / 4); g.drawImage(fb, S / 2, H); fb.close();
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 0.88 })).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}, { mask: b64(arg('mask')), emission: b64(arg('emission')), fins: b64(arg('fins')), dark: DARK, light, S: TEX });
await browser.close();

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${ID}.bin`), bytes);
writeFileSync(join(OUT, `${ID}.tex.webp`), Buffer.from(webp, 'base64'));
const nv = pos.length / 3, nt = idx.length / 3, hex = (c) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
const info = {
  v: 1, id: ID, name: NAME, units: 'm', up: [0, 1, 0], fwd: [0, 0, 1], height_cm: HEIGHT, note: arg('note', ''),
  landmarks: { opening: r4(lm.opening), entry: r4(lm.entry), dorsal: r4(lm.dorsal), symmetry: +lm.symmetry.toFixed(5) },
  colours: { skinDark: hex(DARK), skinLight: hex(light), ...Object.fromEntries(Object.entries({ ...kd, ...FLAT }).filter(([k]) => used.has(k) && !SKIN.includes(k) && !(k in TEXTURED)).map(([k, c]) => [k, hex(c)])) },
  mesh: { vertices: nv, triangles: nt, sourceTriangles: srcTris, dropped },
};
writeFileSync(join(OUT, `${ID}.json`), JSON.stringify(info, null, 1) + '\n');
console.log(JSON.stringify(info, null, 1));
