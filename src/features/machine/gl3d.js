// gl3d.js -- the small raw-WebGL layer under the Machine view (no dependency): 4x4 maths, one lit program, geometry
// builders and buffers. The program draws everything: plain meshes through uModel, and toy meshes (uToy = 1) from
// their mesh frame (x, s, z in units of the length, about the rest centreline) skinned onto the toy's solved
// centreline (uToyC / uToyQ) with the silicone deformation (axial scale, radial bulge) and the roll about the toy's
// axis, plus an optional object-space normal map. A clip plane (cutaway) is cut in the fragment shader. Body meshes
// (uBody = 1) open their canal to the canal sleeve (uSleeve), with the rim's travel and the skin around it; a modelled
// body's layers fade out at the head's cut (uFade) and the colon under the drawn path is kept faint (uFlagA).

// ---- 4x4 column-major maths ----
export const mul = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
};
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return Float32Array.of(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export { sub, cross, norm, dot };
export function lookAt(eye, target, up) {
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  return Float32Array.of(x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1);
}
/** Model matrix: translate t, then the basis columns ax, ay, az (scaled axes). */
export const basis = (t, ax, ay, az) => Float32Array.of(...ax, 0, ...ay, 0, ...az, 0, ...t, 1);
export const trs = (t, s) => basis(t, [s[0], 0, 0], [0, s[1], 0], [0, 0, s[2]]);
/** Inverse-transpose of the upper 3x3 (normals of a scaled / rotated mesh). */
export function normalMat(m) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return Float32Array.of(A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det);
}
/** World point -> [x, y] CSS px (and depth) through view-projection vp on a w x h canvas. */
export function project(vp, p, w, h) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const ww = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return [(x / ww * 0.5 + 0.5) * w, (1 - (y / ww * 0.5 + 0.5)) * h, ww];
}

// ---- the program ----
const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute vec4 aCol; attribute vec4 aBind;
uniform mat4 uVP, uModel; uniform mat3 uNorM;
uniform float uToy; uniform vec4 uToyP; uniform vec2 uRoll; uniform vec3 uBulge;
uniform vec3 uToyC[40]; uniform vec4 uToyQ[40];
uniform float uPush; uniform vec2 uPushM;
#ifdef RIM
// the hole's own shape (ring.js openingSleeve): per sleeve sample (row) and angle round the canal its ratio to the oval
// of uSleeve, 0..4 in 16 bits over r and g; in b and a the toy's radius from its tip (ring.js PROFILE: 512 mm, 128 mm)
uniform sampler2D uRim; uniform float uRimOn;
float toyProfile(float u) {   // ring.js profileAt: texel centres, linear between
  float x = clamp(u / 512.0, 0.0, 1.0) * 1023.0, k = min(floor(x), 1022.0), f = x - k;
  vec2 a = texture2D(uRim, vec2((mod(k, 64.0) + 0.5) / 64.0, (floor(k / 64.0) + 0.5) / 16.0)).ba, b = texture2D(uRim, vec2((mod(k + 1.0, 64.0) + 0.5) / 64.0, (floor((k + 1.0) / 64.0) + 0.5) / 16.0)).ba;
  return mix(a.x * 65280.0 + a.y * 255.0, b.x * 65280.0 + b.y * 255.0, f) / 65535.0 * 128.0;
}
#endif
#ifdef COLON
// uColonS = (station spacing, stations, the tip's arc, the opening at the tip); uColonV = (1: the opening per vertex from
// the toy's own profile, the tip's arc, the wall added to it, -), the stations' w then the chord's sag (paw-fbqn;
// centreline.js colonStations exact)
uniform float uColonOn; uniform vec4 uColonC[32]; uniform vec4 uColonQ[32]; uniform vec4 uColonS; uniform vec4 uColonV;
float colonW(float s) {   // the opening (toy + wall) at arc s: per vertex where it can, else linear between stations
  float fi = clamp(s / uColonS.x, 0.0, uColonS.y - 1.001); int i = int(fi); float w0 = uColonC[0].w, w1 = uColonC[1].w;
  for (int k = 0; k < 31; k++) { if (k == i) { w0 = uColonC[k].w; w1 = uColonC[k + 1].w; } }
  float w = mix(w0, w1, fi - float(i));
#ifdef RIM
  if (uColonV.x > 0.5) return s <= uColonV.y ? toyProfile(uColonV.y - s) + uColonV.z + w : 0.0;
#endif
  return w;
}
// centreline.js colonRadius (FOLD 4 mm, TENT 18 mm): never inside the opening w, folds pressed to within FOLD of it
// where the toy is, eased back to the wall's own r over TENT past the tip (monotone: no waist at the toy's narrow tip)
float colonR(float r, float s, float w) {
  float t = smoothstep(0.0, 18.0, s - uColonS.z), hi = (s <= uColonS.z ? w : uColonS.w) + 4.0;
  return mix(max(w, min(r, hi)), max(w, r), t);
}
#endif
#ifdef LATTICE
// the soft organs' lattice (lattice.js, paw-dk87): uLatO = (origin xyz, largest push mm), uLatD = (cell xyz, control
// points), uLatN = points per axis; uLat: one texel per point, x fastest, 128 = no push
uniform sampler2D uLat; uniform float uLatOn; uniform vec4 uLatO; uniform vec4 uLatD; uniform vec3 uLatN;
vec3 latAt(float i) { return (texture2D(uLat, vec2((i + 0.5) / uLatD.w, 0.5)).rgb * 255.0 - 128.0) / 127.0 * uLatO.w; }
#endif
uniform float uBody; uniform float uR0; uniform vec4 uSleeve[12]; uniform vec2 uSleeveY; uniform vec4 uHole; uniform vec4 uToyW[40]; uniform vec4 uWall; uniform float uBone[16]; uniform vec4 uHilt;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vRim; varying float vCanal; varying vec3 vObj; varying vec4 vQ; varying float vBulge; varying float vGap; varying vec4 vCol;
vec3 roll(vec3 q) { return vec3(q.x * uRoll.x - q.z * uRoll.y, q.y, q.x * uRoll.y + q.z * uRoll.x); }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// the body wall over the toy (centreline.js bulgeAt, the same maths): how far (mm) the skin at world point pw (normal
// nn) is pushed along dir (halfway between its normal and away from the toy's axis: along the normal alone the push
// copied the mesh's own small unevenness in its normals; away from the nearest point alone the skin inside the toy's
// bend was driven to the bend's focus and pleated); the skin stays
// at least the wall thickness outside the toy's own surface (uToyW: per centreline sample its rolled cross-section
// half-widths, offset, depth), with a knee that softens as the wall thickens, saturating softly at uWall.y; uWall =
// (wall, cap, from depth, half the sample spacing). gap: the tissue between the skin at rest and the toy beyond the
// wall (mm: < 0 where it pushes), for the footprint
float bulge(vec3 pw, vec3 nn, out vec3 dir, out float gap, out vec3 tilt) {
  // bone-backed skin never moves (paw-dd9): the back, dorsal of the front of the sacrum and spine (uBone: the bone line,
  // body.js boneLine, linear; eased over 30 mm), and the pelvic ring, the pubic arch and the genitals (skin short of
  // 1.5-3.2 x the from depth into the body, eased over that whole band); centreline.js bulgeAt mirrors it
  dir = nn; gap = 1e3; tilt = vec3(0.0);
  float bz = uBone[1];
  for (int k = 1; k < 8; k++) { if (pw.y > uBone[k * 2 - 2]) bz = mix(uBone[k * 2 - 1], uBone[k * 2 + 1], clamp((pw.y - uBone[k * 2 - 2]) / max(1e-3, uBone[k * 2] - uBone[k * 2 - 2]), 0.0, 1.0)); }
  float near = smoothstep(1.5 * uWall.z, 3.2 * uWall.z, pw.y) * (1.0 - smoothstep(bz - 30.0, bz, pw.z));
  if (near < 1e-4) return 0.0;   // (most of the body: no walk over the toy)
  // (a soft minimum over the samples, over 4 mm, and the direction away from the toy's axis their like-weighted blend:
  // no crease or jump in the push where the nearest sample changes, so the displaced skin is smooth to its
  // finite-difference normal; the direction to the nearest point flipped to the axis past a sample's end and the facing
  // test with it, pleating the belly)
  float dist = 1e9, S = 0.0; vec3 G = vec3(0.0);
  // (per segment between two samples, its cross-section and frame interpolated along it: one sample's section held
  // over its own stretch stepped the push at every sample, rippling the belly)
  for (int k = 0; k < 39; k++) {
    vec3 e = uToyC[k + 1] - uToyC[k];
    float t = clamp(dot(pw - uToyC[k], e) / max(dot(e, e), 1e-6), 0.0, 1.0);
    vec4 W = mix(uToyW[k], uToyW[k + 1], t), q1 = uToyQ[k + 1], q = normalize(mix(uToyQ[k], dot(uToyQ[k], q1) < 0.0 ? -q1 : q1, t));
    vec3 T = qrot(q, vec3(0.0, 1.0, 0.0)), ex = qrot(q, roll(vec3(1.0, 0.0, 0.0))), ez = qrot(q, roll(vec3(0.0, 0.0, 1.0)));
    vec3 d = pw - (uToyC[k] + e * t + ex * W.z);
    float al = dot(d, T), cx = dot(d, ex), cz = dot(d, ez), rho = length(vec2(cx, cz));
    float gp = rho - W.x * W.y * rho / max(1e-3, length(vec2(W.y * cx, W.x * cz)));
    // (a capped tube: ax the signed distance past its nearer end, the tip or the base, < 0 within it; aj how far past
    // this segment's end a point lies that projects beyond it at a joint)
    float sl = sqrt(max(dot(e, e), 1e-6)), aj = abs(dot(pw - uToyC[k] - e * t, e)) / sl, ax = -min((float(k) + t) * sl, (39.0 - float(k) - t) * sl);
    if (k == 0 && t <= 0.0) { ax = aj; aj = 0.0; }
    if (k == 38 && t >= 1.0) { ax = aj; aj = 0.0; }
    float gate = 1.0 - clamp((W.w - uWall.z) / 40.0, 0.0, 1.0);
    float dk = min(max(gp, ax), 0.0) + length(vec2(max(gp, 0.0), max(ax, 0.0) + aj)) + gate * 200.0;
    vec3 gk = (cx * ex + cz * ez) / max(rho, 1e-3);   // (away from its axis: the facing test)
    if (dk < dist) { float r = exp((dk - dist) / 10.0); S *= r; G *= r; dist = dk; }
    float w = exp((dist - dk) / 10.0); S += w; G += w * gk;
  }
  dist -= 10.0 * log(max(S, 1.0) / 2.0);   // (a point between two segments counts both: that much back)
  vec3 grad = dot(G, G) > 1e-8 ? normalize(G) : nn;
  // (only skin facing away from the toy, and not back toward the opening: in a crease, the groin and the genitals the
  // skin faces across it and would fold)
  near *= smoothstep(0.1, 0.5, dot(grad, nn)) * (1.0 - smoothstep(0.35, 0.6, -nn.y));
  float ws = 0.35 * uWall.x + 2.0, x = (uWall.x - dist) / ws, raw = ws * (x > 30.0 ? x : log(1.0 + exp(x))), cap = max(uWall.y, 1.0);
  vec3 h = nn + grad; dir = dot(h, h) > 1e-4 ? normalize(h) : nn;
  gap = near > 0.01 ? (dist - uWall.x) / near : 1e3;
  float e2 = exp(-2.0 * raw / cap), th = (1.0 - e2) / (1.0 + e2);   // (tanh: GLSL ES 1.0 has none)
  // the displaced surface's normal: the push's own slope (d push / d distance: the knee's logistic, eased by the cap)
  // tilts it along the away direction (analytic, from the blended direction: finite differences of the distance showed
  // its small creases at the toy's samples as rings)
  tilt = (1.0 / (1.0 + exp(-x))) * (1.0 - th * th) * near * (grad - dot(grad, nn) * nn);
  return cap * th * near;
}
void main() {
  vec3 p = aPos; vec3 n = aNor; vRim = 0.0; vCanal = 0.0; vObj = aPos; vQ = vec4(0.0, 0.0, 0.0, 1.0); vBulge = 0.0; vGap = 1e3;
  if (uToy > 0.5) {
    // the toy rides its centreline (centreline.js: 40 samples tip -> base, position + frame quaternion); the mesh is
    // expressed about its rest centreline (mesh.js straighten); uToyP = (length mm, tip depth d, axial scale, radial
    // scale); uBulge = (extra radial scale just outside the opening where the compressed toy bulges, girth lost at the
    // opening where it is squashed, -)
    float L = uToyP.x, fi = clamp(p.y, 0.0, 1.0) * 39.0, sg = uToyP.y - p.y * L * uToyP.z;
    int i = int(min(fi, 38.0));
    vec3 c0 = uToyC[0], c1 = uToyC[1]; vec4 q0 = uToyQ[0], q1 = uToyQ[1];
    for (int k = 0; k < 39; k++) { if (k == i) { c0 = uToyC[k]; c1 = uToyC[k + 1]; q0 = uToyQ[k]; q1 = uToyQ[k + 1]; } }
    float f = fi - float(i);
    vec4 q = normalize(mix(q0, dot(q0, q1) < 0.0 ? -q1 : q1, f));
    float outside = exp(-pow((sg + 0.1 * L) / (0.1 * L), 2.0)), atRing = exp(-pow(sg / 7.0, 2.0));
    float rs = uToyP.w * (1.0 + uBulge.x * outside) * (1.0 - uBulge.y * atRing) * (1.0 + uBulge.z * smoothstep(0.86, 1.0, p.y));   // the base spreads as it is pressed
    p = mix(c0, c1, f) + qrot(q, roll(vec3(p.x * L * rs, 0.0, p.z * L * rs)));
    n = qrot(q, roll(vec3(n.x, -n.y, n.z)));
    vQ = q;
#ifdef COLON
  } else if (uColonOn > 0.5 && aBind.x >= 0.0) {
    // a modelled body's colon carried by the solved path (paw-kkmv; centreline.js colonStations / bindColon): each
    // vertex at its arc's station (where the gut lies now, its frame), its offset across opened to the radius the toy
    // needs there (uColonC.w; colonR), its normal from the frame, tilted by the slope of that opening along the gut
    // (the normal's inverse-transpose under the radial scaling: the lighting follows the tenting, no crease)
    float fi = clamp(aBind.x / uColonS.x, 0.0, uColonS.y - 1.001);
    int i = int(fi);
    vec4 c0 = uColonC[0], c1 = uColonC[1], q0 = uColonQ[0], q1 = uColonQ[1];
    for (int k = 0; k < 31; k++) { if (k == i) { c0 = uColonC[k]; c1 = uColonC[k + 1]; q0 = uColonQ[k]; q1 = uColonQ[k + 1]; } }
    float f = fi - float(i);
    vec4 q = normalize(mix(q0, dot(q0, q1) < 0.0 ? -q1 : q1, f)), c = mix(c0, c1, f);
    float r = length(aBind.yz), sc = 1.0;
    vec3 nl = n;
    if (r > 0.01) {
      float s = aBind.x, dR = (colonR(r, s + 2.0, colonW(s + 2.0)) - colonR(r, s - 2.0, colonW(s - 2.0))) / 4.0;
      sc = colonR(r, s, colonW(s)) / r;
      nl = normalize(vec3(n.x, n.y * sc - dot(aBind.yz, n.xz) / r * dR, n.z));
    }
    p = c.xyz + qrot(q, vec3(aBind.y * sc, aBind.w, aBind.z * sc));
    n = qrot(q, nl);
#endif
#ifdef LATTICE
  } else if (uLatOn > 0.5) {
    // moved by the trilinear blend of the eight control points round its resting place (lattice.js latticeAt)
    vec3 g = clamp((p - uLatO.xyz) / uLatD.xyz, vec3(0.0), uLatN - 1.0001), i = floor(g), f = g - i;
    float nx = uLatN.x, nxy = uLatN.x * uLatN.y, b = i.x + nx * i.y + nxy * i.z;
    vec3 lo = mix(mix(latAt(b), latAt(b + 1.0), f.x), mix(latAt(b + nx), latAt(b + nx + 1.0), f.x), f.y);
    vec3 hi = mix(mix(latAt(b + nxy), latAt(b + nxy + 1.0), f.x), mix(latAt(b + nxy + nx), latAt(b + nxy + nx + 1.0), f.x), f.y);
    p += mix(lo, hi, f.z);
#endif
  } else if (uPush > 0.5) {
    // organs beside the path pushed out of the toy's way (paw-kkmv): each vertex out along the direction away from the
    // nearest station of the toy inside the body, by how far it is inside the toy's radius plus a wall (uPushM.x),
    // softly over uPushM.y (a C1 ramp), at most 60 mm; from the toy's pose alone, so it holds still frame to frame and
    // settles back when the toy leaves
    // (two passes: what one station's push leaves inside the next is pushed out by the second)
    vec3 pw = (uModel * vec4(p, 1.0)).xyz, push = vec3(0.0);
    // (each pass a soft maximum over the stations, weighted by their push: the nearest station changing never jumps it,
    // which tore the coarse loops into slivers across the toy)
    for (int pass = 0; pass < 2; pass++) {
      float ws = 0.0, sm = 0.0; vec3 add = vec3(0.0);
      for (int k = 0; k < 40; k++) {
        vec4 W = uToyW[k];
        if (W.w < 4.0) continue;
        vec4 q = uToyQ[k];
        vec3 T = qrot(q, vec3(0.0, 1.0, 0.0)), dd = pw + push - uToyC[k];
        float al = dot(dd, T);
        if (abs(al) > 2.0 * uWall.w + 2.0) continue;
        vec3 rad = dd - T * al;
        float rho = length(rad), x = max(W.x, W.y) + uPushM.x - rho, F = uPushM.y;
        float s = x > F ? x : (x > -F ? (x + F) * (x + F) / (4.0 * F) : 0.0);
        if (s > 0.0 && rho > 1e-3) { float w = s * exp(min(s, 60.0) / 6.0); ws += w; add += w * rad / rho; sm += w * s; }
      }
      if (ws > 0.0 && length(add) > 1e-6) push += normalize(add) * sm / ws;
    }
    float pl = length(push);
    if (pl > 60.0) push *= 60.0 / pl;
    p += push;
  } else if (uBody > 0.5) {
    // the canal (radius uR0 in the mesh) opens to the sleeve (uSleeve every uSleeveY.y mm from uSleeveY.x: x / z
    // half-widths of the opening there, its axial travel); the flesh around follows with a soft falloff, the skin
    // around the opening tents out / dimples in with the rim's travel uHole.x over uHole.z mm; uHole.y: the soft
    // tissue's lagged follow of the body's recoil (glutes)
    float rho = length(p.xz);
    if (p.y > -60.0 && p.y < 190.0 && rho > 0.01) {
      float fi = clamp((p.y - uSleeveY.x) / uSleeveY.y, 0.0, 10.99);
      int i = int(fi);
      vec4 s0 = uSleeve[0], s1 = uSleeve[1];
      for (int k = 0; k < 11; k++) { if (k == i) { s0 = uSleeve[k]; s1 = uSleeve[k + 1]; } }
      vec4 S = mix(s0, s1, fi - float(i));
      float cx = p.x / rho, cz = p.z / rho, R = S.x * S.y / max(0.01, length(vec2(S.y * cx, S.x * cz)));
#ifdef RIM
      if (uRimOn > 0.5) { vec2 t = texture2D(uRim, vec2(atan(cz, cx) / 6.2831853, (fi + 0.5) / 16.0)).rg; R *= (t.r * 65280.0 + t.g * 255.0) / 65535.0 * 4.0; }
#endif
      float fall = exp(-pow((rho - uR0) / 32.0, 2.0)) * smoothstep(-40.0, -5.0, p.y) * (1.0 - smoothstep(uHole.w + 20.0, uHole.w + 60.0, p.y));
      p.xz *= (rho + (R - uR0) * fall) / rho;
      float skin = exp(-pow(max(0.0, rho - uR0) / uHole.z, 2.0)) * smoothstep(-60.0, -15.0, p.y) * (1.0 - smoothstep(uHole.w, uHole.w + 30.0, p.y));
      p.y += S.z * fall + uHole.x * skin * (1.0 - fall);
      vRim = exp(-pow((rho - uR0) / 9.0, 2.0)) * (1.0 - smoothstep(6.0, 22.0, p.y - S.z));
      vCanal = (1.0 - smoothstep(uR0 + 1.0, uR0 + 4.0, rho)) * smoothstep(6.0, 14.0, p.y - S.z);
    }
    // the body wall over the toy (centreline.js bulgeAt, the same maths): the skin stays at least the wall thickness
    // outside the toy's own surface (uToyW: per centreline sample its rolled cross-section half-widths, offset, depth),
    // with a knee that softens as the wall thickens; uWall = (wall, cap, from depth, half the sample spacing). The
    // skin's normal follows the displaced surface (the field's gradient: away from the nearest part of the toy), so
    // the light shows the relief; vBulge carries the push (mm), vGap the tissue between the skin at rest and the toy
    // beyond the wall (mm: < 0 where it pushes), for the footprint and its contours
    if (uWall.x > 0.0) {
      // (paw-ani1: the push is smooth (C1) everywhere: a soft saturation, gates that ease over a wide band and round
      // the opening, not along a plane, only on skin facing away from the toy, its normal tilted by the push's slope; the
      // skin is drawn finer there: meshbody.js refineWhere)
      vec3 pw = (uModel * vec4(p, 1.0)).xyz, nn = normalize(n), dir;
      float gap;
      vec3 tilt; float b = bulge(pw, nn, dir, gap, tilt);
      n = normalize(nn + tilt);
      p += dir * b; vBulge = b; vGap = gap;   // (the body's model matrix only translates: one direction in both spaces)
    }
    // the base pressed into the body: the tissue around it pushed in (uHilt.x mm) and spread out past its rim (uHilt.y)
    if (uHilt.x > 0.01) { float rr = length(p.xz), ring = exp(-pow(max(0.0, rr - uHilt.y) / (0.8 * uHilt.y + 10.0), 2.0)) * (1.0 - smoothstep(-5.0, 40.0, p.y));
      p.y += uHilt.x * ring; if (rr > 0.01) p.xz *= 1.0 + 0.25 * uHilt.x * ring * smoothstep(0.6 * uHilt.y, 1.4 * uHilt.y, rr) / max(rr, 1.0); }
    float glute = smoothstep(25.0, 70.0, abs(p.x)) * exp(-pow((p.y - 60.0) / 70.0, 2.0)) * smoothstep(-90.0, 0.0, p.z);
    p.y += uHole.y * glute;
  }
  vec4 w = uModel * vec4(p, 1.0);
  vW = w.xyz; vN = uToy > 0.5 ? n : uNorM * n; vUv = aUv; vCol = aCol;
  gl_Position = uVP * w;
}`;
const FS = `
precision highp float;
uniform vec3 uColor, uEye, uLight, uLip, uInner, uEdge; uniform vec4 uClip; uniform float uClipOn, uAlpha, uGrid;
uniform sampler2D uNrm; uniform float uNrmOn, uToy, uShine; uniform vec2 uRoll;
uniform float uTube, uDash; uniform float uRdy[40]; uniform vec2 uRdyS; uniform vec3 uReady; uniform float uSkin; uniform vec2 uContour;
uniform sampler2D uTex; uniform float uTexOn, uColOn, uBodyM, uBaseM, uBaseLine; uniform vec4 uBodyS[6]; uniform vec4 uBaseS[6];
uniform float uVCol, uBodyTexOn; uniform sampler2D uBodyTex;
uniform vec4 uProsC; uniform float uProsI; uniform vec3 uProsCol;   // the prostate's glow (paw-xdcy): centre + radius (mm), stimulation 0..1, colour
uniform vec4 uFade; uniform vec4 uFadeC; uniform float uFlagA; uniform float uGlow;
uniform float uRimA;   // a clear shell (the Stroker's sleeve): more opaque edge-on, so its shape reads (0: off)
// the Stroker's realistic style (paw-iaai; every one 0 = the Machine's look, unchanged): uReal skin shading (a soft wrap
// light, a warm light-through at the terminator and a warm rim, uWarm), uSpecK the highlight's exponent (0: 16), uTone
// a gentle filmic tone curve
uniform float uReal, uSpecK, uTone, uVAlpha; uniform vec3 uWarm;   // uVAlpha: the vertex colour's alpha fades the surface (0: off)
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vRim; varying float vCanal; varying vec3 vObj; varying vec4 vQ; varying float vBulge; varying float vGap; varying vec4 vCol;
// a colourway ramp: rgb at position w, sorted, padded with the last stop
vec3 ramp(vec4 s[6], float x) {
  vec3 c = s[0].rgb;
  for (int i = 0; i < 5; i++) { if (x > s[i].w) c = mix(s[i].rgb, s[i + 1].rgb, clamp((x - s[i].w) / max(1e-4, s[i + 1].w - s[i].w), 0.0, 1.0)); }
  return c;
}
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
float marble(vec3 q) { q *= 5.0; float v = sin(q.x * 1.3 + 1.6 * sin(q.y * 1.7 + q.z * 1.1) + 1.2 * sin(q.z * 2.3 - q.x * 0.6)); return smoothstep(-0.6, 0.6, v); }
void main() {
  if (uClipOn > 0.5 && dot(vW, uClip.xyz) > uClip.w) discard;
  if (uDash > 0.5 && fract(vUv.y / 9.0) > 0.6) discard;   // a dashed tube: the colon past the junction
  if (uGrid > 0.5) {   // the floor: a faint 50 mm grid fading out with distance
    vec2 q = abs(fract(vW.xy / 50.0 - 0.5) - 0.5) * 50.0;
    float line = 1.0 - smoothstep(0.0, 1.4, min(q.x, q.y));
    float fade = exp(-length(vW.xy - vec2(0.0, -120.0)) / 520.0);
    gl_FragColor = vec4(uColor, (0.06 + 0.4 * line) * fade);
    return;
  }
  vec3 n = normalize(vN);
  if (uToy > 0.5 && uNrmOn > 0.5) {   // the toy's object-space normal map, kept subtle
    vec3 m = texture2D(uNrm, vec2(vUv.x, 1.0 - vUv.y)).xyz * 2.0 - 1.0;
    float ml = length(m);
    if (abs(ml - 1.0) > 0.22) m = n;   // off the UV islands (black) or a blurred seam: no detail
    else { m = vec3(m.x, -m.y, m.z) / ml; m = qrot(normalize(vQ), vec3(m.x * uRoll.x - m.z * uRoll.y, m.y, m.x * uRoll.y + m.z * uRoll.x)); }
    if (dot(m, n) > 0.3) n = normalize(mix(n, m, 0.6));   // a texel far off the surface normal is bleed from another island
  }
  vec3 v = normalize(uEye - vW);
  // a light, not a surface (uGlow: the opening's marker, ring.js; blended additively): its own colour times its
  // brightness (vCol.r, brightest at the hole, clear at its free edges) and opacity; no shading and no edge-on term (a
  // fresnel rim lit its silhouette edges: the owner's "onion ring")
  if (uGlow > 0.5) { gl_FragColor = vec4(uColor * vCol.r * uAlpha * 0.6, 1.0); return; }
  float inside = 0.0;
  if (dot(n, v) < 0.0) { n = -n; inside = 1.0; }   // the back of a surface: a cut face or the inside of the canal
  // an imported body (meshbody.js): its own colour per vertex, or (part flag vCol.a 1 skin, 2 other) its texture atlas:
  // the skin's colour in the top 3/4, its emission (added unlit below) bottom left, the other parts bottom right
  vec3 own = uColor, glow = vec3(0.0);
  if (uVCol > 0.5) {
    own = vCol.rgb;
    if (uBodyTexOn > 0.5 && vCol.a > 0.5) {
      own = texture2D(uBodyTex, vec2(vUv.x, 1.0 - vUv.y)).rgb;
      if (vCol.a < 1.5) glow = texture2D(uBodyTex, vec2(0.5 * vUv.x, 1.0 - 0.25 * (vUv.y - 0.25) / 0.75)).rgb * (1.0 - vCanal);
    }
  }
  vec3 base = mix(mix(own, uInner, vCanal), uLip, clamp(vRim * 1.2, 0.0, 1.0));
  // the internal path: tinted by readiness along its length (uRdy: 40 samples from arc uRdyS.x every uRdyS.y mm; a calm
  // ramp toward uReady); the strain where a bend is forced goes on its edge (below), so ready and forcing never mix
  float strainW = 0.0;
  if (uTube > 0.5) {
    float x = clamp((vUv.y - uRdyS.x) / max(1e-3, uRdyS.y), 0.0, 38.999), r0 = 0.0, r1 = 0.0;
    int i = int(x);
    for (int k = 0; k < 39; k++) { if (k == i) { r0 = uRdy[k]; r1 = uRdy[k + 1]; } }
    base = mix(uColor, uReady, 0.8 * clamp(mix(r0, r1, x - float(i)), 0.0, 1.0));
    strainW = clamp(vUv.x, 0.0, 1.0);
  }
  if (uToy > 0.5 && uColOn > 0.5) {
    // the toy's colourway: R = marble pattern, G = position along the body fade (1 at the tip), B = base weight; from
    // its texture map, else from the position along the toy (base past uBaseLine) and a procedural marble
    vec3 t = uTexOn > 0.5 ? texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb : vec3(marble(vObj), 1.0 - vObj.y, smoothstep(uBaseLine - 0.03, uBaseLine + 0.03, vObj.y));
    vec3 bodyC = ramp(uBodyS, uBodyM > 0.5 ? t.r : t.g), baseC = ramp(uBaseS, uBaseM > 0.5 ? t.r : t.g);
    base = mix(bodyC, baseC, clamp(t.b, 0.0, 1.0));
  }
  float lam = max(dot(n, uLight), 0.0), fres = pow(1.0 - abs(dot(n, v)), 3.0);
  float spec = pow(max(dot(reflect(-uLight, n), v), 0.0), uSpecK > 0.0 ? uSpecK : 16.0) * uShine;
  vec3 c = base * (0.46 + 0.54 * lam) * (1.0 - 0.35 * inside);
  if (uSkin > 0.5) {
    // the body's form, kept neutral and diagram-like: a wrapped key light with more range, a weak fill from below and
    // behind (the underside and the thighs' inner sides still read), a soft broad sheen; creases (the cleft, the
    // gluteal folds, the spinal furrow) a touch darker and ridges a touch lighter by the surface's curvature
    float wrap = max(0.0, (dot(n, uLight) + 0.3) / 1.3), fill = max(0.0, dot(n, normalize(vec3(0.15, -0.55, -0.8))));
    c = base * (0.26 + 0.66 * wrap + 0.16 * fill) * (1.0 - 0.35 * inside);
    c += vec3(0.07 * pow(max(dot(reflect(-uLight, n), v), 0.0), 12.0));
#ifdef DERIV
    float curv = length(fwidth(n)) / max(length(fwidth(vW)), 1e-3);   // 1/mm, unsigned
    c *= 1.0 - 0.18 * smoothstep(0.012, 0.05, curv) * (1.0 - wrap);
#endif
  }
  if (uReal > 0.5) {
    float wrapR = max(0.0, (dot(n, uLight) + 0.5) / 1.5), through = exp(-pow(dot(n, uLight) * 2.2, 2.0));
    c = base * (0.2 + 0.8 * wrapR) * (1.0 - 0.3 * inside) + uWarm * base * (0.32 * through + 0.25 * fres);
  }
  c = mix(c, uEdge, fres * (uReal > 0.5 ? 0.18 : 0.55)) + vec3(spec) + 0.6 * glow;   // a soft fresnel edge separates shapes from the dark background
  if (strainW > 0.0) c = mix(c, uLip, strainW * pow(1.0 - abs(dot(n, v)), 1.2));   // forcing: the tube's rim in the strain colour
  // the toy under the skin (uContour = (spacing mm, how much thicker this body's wall is than the slimmest one's)): the
  // skin itself is displaced over the toy and its shading shows the swelling; on top only a soft, even footprint (h =
  // the push where the skin is pushed out, minus the tissue still between, ramped over six spacings: no hard edge for
  // the mesh's triangles to stair-step) and the pushed patch a little more opaque. The contour rings are gone
  // (paw-kkmv: they read as jagged stacks on a coarse skin)
  float cs = uContour.x, h = -vGap - uContour.y, foot = 0.0;
  if (cs > 0.0 && h > -6.0 * cs) foot = smoothstep(-6.0 * cs, cs, h);
  c = mix(c, uEdge, 0.14 * foot);
  float skinP = smoothstep(0.5, 6.0, vBulge);
  float a = mix(mix(uAlpha, max(uAlpha, 0.85), skinP), 1.0, clamp(vRim * 1.5, 0.0, 1.0));
  a = min(1.0, a + uRimA * fres);
  if (uVAlpha > 0.5) a *= vCol.a;
  // a modelled body: the colon the internal path runs in (part flag 4) at its own opacity uFlagA (faint under a drawn
  // path; the canal itself when it is carried; -1: the layer's); the head's cut
  // hidden by a fade to transparent over the last uFade.w mm below the plane (normal uFade.xyz through uFadeC.xyz), within
  // the neck (radius uFadeC.w, softly past it)
  if (uProsI > 0.001) { float k = uProsI * (1.0 - smoothstep(uProsC.w - 2.0, uProsC.w + 8.0, distance(vW, uProsC.xyz))); c = mix(c, uProsCol, 0.65 * k) + 0.3 * k * uProsCol; a = max(a, k); }
  if (abs(vCol.a - 4.0) < 0.5 && uFlagA >= 0.0) a = uFlagA;
  if (a < 0.003) discard;
  if (uFade.w > 0.0) {
    vec3 q = vW - uFadeC.xyz; float below = -dot(q, uFade.xyz), r = length(q + uFade.xyz * below);
    a *= mix(1.0, smoothstep(0.0, uFade.w, below), 1.0 - smoothstep(uFadeC.w, 1.4 * uFadeC.w, r));
  }
  if (uTone > 0.5) c = vec3(1.0) - exp(-c * 1.35);
  gl_FragColor = vec4(c, a);
}`;

function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

/** A WebGL context with the program, or throws (the caller falls back to the 2D drawing). */
export function createGL(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('no WebGL');
  // the skin's curvature accent and the bulge's contour lines need fwidth (OES_standard_derivatives, near universal); without it it is left out
  const fs = gl.getExtension('OES_standard_derivatives') ? `#extension GL_OES_standard_derivatives : enable
#define DERIV 1
${FS}` : FS;
  // a modelled body's carried colon (COLON) takes 66 more vertex uniforms: with it where the GPU has the room, else
  // without (that body then draws its colon in place and the path as a tube)
  // the soft organs' lattice (LATTICE) needs a texture in the vertex shader (most GPUs; else the organs are pushed
  // per vertex)
  // the hole's own shape (RIM) takes a second vertex texture: with it where there are two units, else the oval
  const link = (colon, lat, rim = false) => {
    const prog = gl.createProgram();
    try {
      gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, (colon ? `#define COLON 1
` : '') + (rim ? `#define RIM 1
` : '') + (lat ? `#define LATTICE 1
` : '') + VS)); gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('program: ' + gl.getProgramInfoLog(prog));
      return prog;
    } catch (e) { gl.deleteProgram(prog); if (colon || lat || rim) return null; throw e; }
  };
  const colon = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) >= 256, lat = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
  const rim = lat && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 1;
  const prog = (colon && rim && link(true, true, true)) || (colon && lat && link(true, true)) || (rim && link(false, true, true)) || (colon && link(true, false)) || (lat && link(false, true)) || link(false, false);
  const hasColon = colon && !!gl.getUniformLocation(prog, 'uColonOn'), hasLat = lat && !!gl.getUniformLocation(prog, 'uLatOn'), hasRim = !!gl.getUniformLocation(prog, 'uRimOn');
  gl.useProgram(prog);
  const U = {};
  for (const n of ['uPush', 'uPushM', 'uColonOn', 'uColonC', 'uColonQ', 'uColonS', 'uColonV', 'uVP', 'uModel', 'uNorM', 'uToy', 'uToyP', 'uRoll', 'uBulge', 'uBody', 'uR0', 'uSleeve', 'uSleeveY', 'uHole', 'uToyW', 'uWall', 'uHilt', 'uToyC', 'uToyQ', 'uDash', 'uColor', 'uLip', 'uInner', 'uEdge', 'uEye', 'uLight', 'uClip', 'uClipOn', 'uAlpha', 'uGrid', 'uNrmOn', 'uShine', 'uTexOn', 'uColOn', 'uBodyM', 'uBaseM', 'uBaseLine', 'uBodyS', 'uBaseS', 'uNrm', 'uTex', 'uTube', 'uRdy', 'uRdyS', 'uReady', 'uSkin', 'uContour', 'uBone', 'uVCol', 'uBodyTexOn', 'uBodyTex', 'uFade', 'uFadeC', 'uFlagA', 'uLat', 'uLatOn', 'uLatO', 'uLatD', 'uLatN', 'uProsC', 'uProsI', 'uProsCol', 'uGlow', 'uRim', 'uRimOn', 'uRimA', 'uReal', 'uSpecK', 'uTone', 'uWarm', 'uVAlpha']) U[n] = gl.getUniformLocation(prog, n);
  const A = { pos: gl.getAttribLocation(prog, 'aPos'), nor: gl.getAttribLocation(prog, 'aNor'), uv: gl.getAttribLocation(prog, 'aUv'), col: gl.getAttribLocation(prog, 'aCol'), bind: gl.getAttribLocation(prog, 'aBind') };
  gl.uniform1i(U.uNrm, 0); gl.uniform1i(U.uTex, 1); gl.uniform1i(U.uBodyTex, 2); if (U.uLat) gl.uniform1i(U.uLat, 3); if (U.uRim) gl.uniform1i(U.uRim, 4);   // texture units: normal map 0, colour map 1, an imported body's atlas 2, the lattice 3, the hole's shape 4
  gl.enable(gl.DEPTH_TEST);
  return { gl, prog, U, A, colon: hasColon, lattice: hasLat, rim: hasRim };
}

/** A panel's 3D scene kept up (paw-avu6; the Machine and the Stroker): make(canvas) is retried a few times when it throws
 *  (a panel restored at start-up can mount before the GPU process is ready) and run again when a lost context is
 *  restored; the scene of the lost context is dropped without destroy(), whose loseContext() would lose the restored
 *  context again. on(scene) gets each new scene; on(null, error) once it gives up. -> teardown (destroys the scene). */
export function keepScene(canvas, make, on, { tries = 4, waitMs = 400 } = {}) {
  let scene = null, timer = 0, n = 0;
  const build = () => {
    try { scene = make(canvas); on(scene); }
    catch (e) { scene = null; if (++n < tries) timer = setTimeout(build, waitMs * n); else on(null, e); }
  };
  const restored = () => { clearTimeout(timer); n = 0; scene = null; build(); };
  canvas.addEventListener('webglcontextrestored', restored);
  build();
  return () => { clearTimeout(timer); canvas.removeEventListener('webglcontextrestored', restored); scene?.destroy(); scene = null; };
}

/** Upload {pos, nor, uv?, col? (rgba per vertex: an imported body), idx} -> a drawable; pass `old` to reuse its buffers (meshes rebuilt every frame). */
export function upload(G, m, old) {
  const { gl } = G, b = old || { pos: gl.createBuffer(), nor: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer() };
  const put = (buf, data, target = gl.ARRAY_BUFFER) => { gl.bindBuffer(target, buf); gl.bufferData(target, data, old ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); };
  put(b.pos, m.pos); put(b.nor, m.nor); put(b.uv, m.uv || new Float32Array((m.pos.length / 3) * 2)); put(b.idx, m.idx, gl.ELEMENT_ARRAY_BUFFER);
  if (m.col) { b.col = b.col || gl.createBuffer(); put(b.col, m.col); }
  if (m.bind) { b.bind = b.bind || gl.createBuffer(); put(b.bind, m.bind); }
  b.count = m.idx.length;
  return b;
}
export function drop(G, b) { if (b) for (const k of ['pos', 'nor', 'uv', 'idx', 'col', 'bind']) if (b[k]) G.gl.deleteBuffer(b[k]); }

/** Draw a drawable with the uniforms in `u` (anything not given keeps its last value). */
export function draw(G, b, u = {}) {
  const { gl, U, A } = G;
  for (const [k, v] of Object.entries(u)) {
    const loc = U[k];
    if (!loc) continue;
    if (k === 'uVP' || k === 'uModel') gl.uniformMatrix4fv(loc, false, v);
    else if (k === 'uBodyS' || k === 'uBaseS' || k === 'uSleeve' || k === 'uToyQ' || k === 'uToyW' || k === 'uColonC' || k === 'uColonQ') gl.uniform4fv(loc, v);
    else if (k === 'uToyC') gl.uniform3fv(loc, v);
    else if (k === 'uRdy' || k === 'uBone') gl.uniform1fv(loc, v);
    else if (k === 'uNorM') gl.uniformMatrix3fv(loc, false, v);
    else if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else gl.uniform4fv(loc, v);
  }
  const attr = (loc, buf, n) => { if (loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
  attr(A.pos, b.pos, 3); attr(A.nor, b.nor, 3); attr(A.uv, b.uv, 2);
  if (A.col >= 0) { if (b.col) attr(A.col, b.col, 4); else { gl.disableVertexAttribArray(A.col); gl.vertexAttrib4f(A.col, 0, 0, 0, 0); } }
  if (A.bind >= 0) { if (b.bind) attr(A.bind, b.bind, 4); else { gl.disableVertexAttribArray(A.bind); gl.vertexAttrib4f(A.bind, -1, 0, 0, 0); } }
  gl.uniform1f(U.uVCol, b.col ? 1 : 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
  gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
}

// ---- geometry ----
/** Unit sphere (radius 1). */
export function sphere(lat = 14, lon = 24) {
  const pos = [], idx = [];
  for (let i = 0; i <= lat; i++) for (let j = 0; j <= lon; j++) {
    const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2;
    pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
  }
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) { const a = i * (lon + 1) + j, b = a + lon + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const P = Float32Array.from(pos);
  return { pos: P, nor: P, idx: Uint16Array.from(idx) };
}
/** Unit cube centred on the origin (side 1), flat faces. */
export function box() {
  const pos = [], nor = [], idx = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, base = pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[ax] = sg * 0.5; p[u] = a * 0.5; p[v] = b * 0.5 * sg; n[ax] = sg;
      pos.push(...p); nor.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint16Array.from(idx) };
}
/** A torus around the y axis at y = 0: major radius R, minor radius r. */
export function torus(R, r, seg = 48, tube = 10) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= tube; j++) {
    const u = (i / seg) * Math.PI * 2, v = (j / tube) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
    pos.push((R + r * cv) * cu, r * sv, (R + r * cv) * su); nor.push(cv * cu, sv, cv * su);
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) { const a = i * (tube + 1) + j, b = a + tube + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint16Array.from(idx) };
}
/** A tube around the y axis through rings [[y, radius], ...] (open ends). */
export function tube(rings, seg = 28) {
  const pos = [], nor = [], idx = [];
  rings.forEach(([y, r], i) => {
    const dr = i ? (r - rings[i - 1][1]) / ((y - rings[i - 1][0]) || 1) : 0;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), l = Math.hypot(1, dr);
      pos.push(c * r, y, s * r); nor.push(c / l, -dr / l, s / l);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint16Array.from(idx) };
}

/** A one-row RGBA byte texture for data read texel by texel (the lattice), nearest, clamped; pass `old` to refill it. */
export function dataTexture(G, bytes, old = null) {
  const { gl } = G, t = old || gl.createTexture();
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bytes.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  if (!old) for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.activeTexture(gl.TEXTURE0);
  return t;
}

/** The hole's shape texture (ring.js openingSleeve rim: 64 x 16 RGBA bytes) on unit 4: linear, repeating round the
 *  canal, clamped along it; pass `old` to refill it. */
export function rimTexture(G, bytes, old = null) {
  const { gl } = G, t = old || gl.createTexture();
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  if (!old) for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.activeTexture(gl.TEXTURE0);
  return t;
}

/** An RGBA texture from an image (normal maps); linear, clamped, mipmapped when it can be. */
export function texture(G, img) {
  const { gl } = G, t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const pow2 = (n) => (n & (n - 1)) === 0;
  if (pow2(img.width) && pow2(img.height)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
  else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** A tube along a sampled 3D path ({n, step, P, U, V}: anatomy.js / centreline.js) from arc s0 to s1: ring radius
 *  r(s), a per-ring weight w(s) in uv.x (the strain colour), the arc length in uv.y (dashes). */
export function pathTube(path, r, w = () => 0, seg = 20, s0 = 0, s1 = Infinity) {
  const { n, step, P, U, V } = path, pos = [], nor = [], uv = [], idx = [];
  const i0 = Math.max(0, Math.floor(s0 / step)), i1 = Math.min(n - 1, Math.ceil(Math.min(s1, (n - 1) * step) / step));
  for (let i = i0; i <= i1; i++) {
    const s = i * step, R = r(s), W = w(s);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ca * U[i * 3] + sa * V[i * 3], ny = ca * U[i * 3 + 1] + sa * V[i * 3 + 1], nz = ca * U[i * 3 + 2] + sa * V[i * 3 + 2];
      pos.push(P[i * 3] + nx * R, P[i * 3 + 1] + ny * R, P[i * 3 + 2] + nz * R); nor.push(nx, ny, nz); uv.push(W, s);
    }
  }
  for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), uv: Float32Array.from(uv), idx: Uint16Array.from(idx) };
}
