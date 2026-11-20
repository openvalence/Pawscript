// scene3d.js -- the Machine view as a 3D scene (raw WebGL through gl3d.js). World in mm: the opening (at rest) at the
// origin, y = depth into the body, x across (+x the receiver's right), z up. The rail and carriage run along -y under
// the toy; the toy mesh hangs on the carriage and rides its solved centreline (centreline.js) into the body, deformed
// by the silicone model; a translucent ghost shows where a rigid toy would be. The body is one procedural rear
// (body.js), moved by its recoil, whose canal opens to the canal sleeve in the vertex shader (the rim travelling with
// the toy, the skin around it following), its rim coloured by strain; the internal path is a tube along the solved
// path (solid to the rectosigmoid junction, fainter and dashed past it). The cutaway clips on the camera's side.
import { createGL, upload, drop, draw, trs, basis, mul, normalMat, box, texture, pathTube, dataTexture, rimTexture } from './gl3d.js';
import { rearMesh, rearReady, CANAL_R } from './body.js';
import { ringMesh } from './ring.js';

/** The canal's lining (the body shader's uInner, past the rim): a mucosa tone, lit like the other cut faces. It was a
 *  near-black "lumen" colour, which in the cutaway read as a flat dark block inside the opening. */
export const LINING = [0.7, 0.47, 0.46];
const ID3 = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), I4 = trs([0, 0, 0], [1, 1, 1]);

export class MachineScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.G = createGL(canvas);
    this.unitBox = upload(this.G, box());
    this.toy = null; this.nrm = null; this.tex = null; this.theme = null; this.body = null; this.bodyKey = '';
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
  }
  /** The toy mesh ({pos, nor, uv, idx}, about its rest centreline) and its optional normal-map and colour-map images. */
  setToy(mesh, nrmImage, texImage) {
    const G = this.G;
    drop(G, this.toy); this.toy = mesh ? upload(G, mesh) : null;
    for (const t of [this.nrm, this.tex]) if (t) G.gl.deleteTexture(t);
    this.nrm = nrmImage ? texture(G, nrmImage) : null;
    this.tex = texImage ? texture(G, texImage) : null;
  }
  /** The colourway: {body, base: {m, s: [[t, 'rrggbb']]}} (library themes) and where the base starts (0..1 from the tip). */
  setTheme(theme, baseLine = 0.85) {
    const pack = (r) => {
      const out = new Float32Array(24), st = r?.s?.length ? r.s : [[0, 'b0a0d8'], [1, 'b0a0d8']];
      for (let i = 0; i < 6; i++) {
        const [t, h] = st[Math.min(i, st.length - 1)], n = parseInt(h, 16);
        out.set([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, i < st.length ? t : 1 + i], i * 4);
      }
      return out;
    };
    this.theme = theme ? { uColOn: 1, uBodyM: theme.body?.m || 0, uBaseM: theme.base?.m || 0, uBodyS: pack(theme.body), uBaseS: pack(theme.base || theme.body), uBaseLine: baseLine } : { uColOn: 0 };
  }
  /** The body for a character's proportions. While a setting moves (Height, Build drags) a quick coarse body stands in;
   *  the fine one replaces it once the setting rests, then `redraw` is called. */
  setBody(p, redraw) {
    const key = JSON.stringify(p);
    this.bodyTexOn = 0;
    if (key === this.bodyKey) return;
    this.bodyKey = key; clearTimeout(this.bodyTimer); this.dropLayers();
    const put = (m) => { drop(this.G, this.body); this.body = upload(this.G, m); };
    if (!this.body || rearReady(p)) return put(rearMesh(p));
    put(rearMesh(p, 9));
    this.bodyTimer = setTimeout(() => { if (this.bodyKey === key && !this.lost) { put(rearMesh(p)); redraw?.(); } }, 300);
  }
  /** An imported body (meshbody.js framedMesh: in the simulation's frame, rgba per vertex) and its texture atlas, under a
   *  key (a new key replaces it; the same key is a no-op). A layered model passes its layers instead of one mesh:
   *  [{id, parts: [framed mesh, ...]}] (the parts: each under 65536 vertices); 'skin' is the body the canal opens in. */
  setBodyMesh(mesh, key, texImage) {
    if (key === this.bodyKey) return;
    this.bodyKey = key; clearTimeout(this.bodyTimer);
    this.dropLayers();
    if (Array.isArray(mesh)) {
      this.layers = mesh.map((l) => ({ id: l.id, parts: l.parts.map((m) => upload(this.G, m)) }));
      drop(this.G, this.body); this.body = null;
    } else { drop(this.G, this.body); this.body = upload(this.G, mesh); }
    if (texImage !== this.bodyImg) { if (this.bodyTex) this.G.gl.deleteTexture(this.bodyTex); this.bodyImg = texImage; this.bodyTex = texImage ? texture(this.G, texImage) : null; }
    this.bodyTexOn = this.bodyTex ? 1 : 0;
  }
  dropLayers() { for (const l of this.layers || []) for (const b of l.parts) drop(this.G, b); this.layers = null; }
  /** One frame. f: {w, h, dpr, view (camera.js viewOf), L, R, dc (carriage), roll, bulge, squash, toyP ([L, d, axial
   *  scale, radial scale]), toyC / toyQ (the toy's centreline, centreline.js toyCentreline), ghostC / ghostQ (a rigid
   *  toy's), sleeve (Float32Array(48): per sample x / z half-widths, axial travel), sleeveY ([y0, dy]), hole ([rim
   *  travel, glute follow, skin falloff, canal length]), xb (body recoil), cut, ghost, xray (body opacity), colors (rgb
   *  0..1), railFrom, stroke, target, path (solved, body frame), junction (arc of the rectosigmoid junction), tubeR(s) /
   *  tubeW(s), ready / readyS (the tube's readiness tint: 40 samples 0..1 from arc readyS[0] every readyS[1] mm), ghostPath (the relaxed path, or null), prostate ({c, r, i}: its centre and radius, mm, and its stimulation 0..1: the genitals layer glows there; or null), lattice ({box, bytes, range}: lattice.js, the soft organs' control points; or null: pushed per vertex), push ({C, Q, W}: the toy that pushes the organs aside, when the gut's slow return holds them deeper than the toy is; or null), wallSt / wall (the toy's envelope for the body wall: centreline.js
   *  bulgeStations, [wall, cap, from depth, half the sample spacing]; wall null = no bulge), contour ([spacing, wall past
   *  the slimmest]: the relief map on the skin), canalR (the canal radius in the body mesh; huge: no canal to open);
   *  a layered model's: layers ({id: opacity 0..1, 0 hidden}; xray is the skin's), fade ([[nx, ny, nz, width], [cx, cy, cz, neck radius]]: the head's cut,
   *  world mm), flagA (the colon under the drawn path: its opacity, -1 none), colon (the carried colon: {C, Q, step, alpha
   *  (its path part's opacity), tip}, centreline.js colonStations; then no path tube), rim (ring.js openingSleeve: the
   *  hole's ratio to the sleeve's oval per angle, or null: the oval), ring ({rel (the relaxed aperture, mm), scale,
   *  lite}: the opening's marker, ring.js ringMesh; a layered model's `opening` layer is its intensity; null none)}. */
  render(f) {
    const { gl } = this.G, G = this.G, W = Math.max(1, Math.round(f.w * f.dpr)), H = Math.max(1, Math.round(f.h * f.dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(...f.colors.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const v = f.view, light = [0, 1, 2].map((i) => v.dir[i] - 0.45 * v.right[i] + 0.6 * v.up[i]), ll = Math.hypot(...light);
    const cn = [v.dir[0], v.dir[1] * 0, v.dir[2]], cl = Math.hypot(cn[0], cn[2]) || 1;
    // the cutaway plane contains the rail axis and faces the camera
    const common = { uGlow: 0, uRimOn: 0, uFade: [0, 0, 0, 0], uFlagA: -1, uColonOn: 0, uPush: 0, uLatOn: 0, uProsI: 0, uVP: v.vp, uSkin: 0, uTube: 0, uDash: 0, uEye: v.eye, uLight: light.map((x) => x / ll), uToy: 0, uBody: 0, uNrmOn: 0, uClipOn: 0, uAlpha: 1, uGrid: 0, uShine: 0,
      uClip: [cn[0] / cl, 0, cn[2] / cl, 0], uLip: f.colors.lip, uInner: LINING, uEdge: f.colors.edge };
    const solid = (b, model, color, extra = {}) => draw(G, b, { ...common, uModel: model, uNorM: normalMat(model), uColor: color, ...extra });
    const bodyM = trs([0, f.xb || 0, 0], [1, 1, 1]);

    const zr = -(f.R + 12), y0 = f.railFrom, y1 = -20, yb = f.dc - f.L;
    // the floor grid (translucent, under everything)
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    // (level with the floor when the scene is drawn turned for a pitched rail: camera.js tiltView)
    const gridM = v.tilt ? mul(basis([0, 0, 0], [1, 0, 0], [0, Math.cos(v.tilt), -Math.sin(v.tilt)], [0, Math.sin(v.tilt), Math.cos(v.tilt)]), trs([0, -100, zr - 11], [3000, 3000, 0.1])) : trs([0, -100, zr - 11], [3000, 3000, 0.1]);
    if (v.eye[2] > zr - 11 || v.tilt) solid(this.unitBox, gridM, f.colors.grid, { uGrid: 1 });   // not from below it
    gl.depthMask(true); gl.disable(gl.BLEND);
    // rail with a mm ruler, carriage, mount plate
    solid(this.unitBox, trs([0, (y0 + y1) / 2, zr - 5], [22, y1 - y0, 10]), f.colors.rail);
    for (let mm = Math.ceil(y0 / 10) * 10; mm <= 0; mm += 10) solid(this.unitBox, trs([-14, mm, zr - 0.5], [mm % 50 === 0 ? 9 : 5, 1.1, 1.2]), f.colors.tick);
    if (f.stroke) {   // the stroke, shaded on the rail: where the carriage's front runs between fully out and deepest
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      solid(this.unitBox, trs([0, (f.stroke[0] + f.stroke[1]) / 2, zr + 0.6], [24, Math.abs(f.stroke[1] - f.stroke[0]), 1]), f.colors.strokeBand, { uAlpha: 0.45 });
      gl.disable(gl.BLEND);
    }
    if (f.target != null) {   // where the script wants the carriage while the machine is at its force limit: a faint ghost
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      solid(this.unitBox, trs([0, f.target - 14, zr + 4], [40, 26, 14]), f.colors.carriage, { uAlpha: 0.25 });
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    solid(this.unitBox, trs([0, yb - 14, zr + 4], [40, 26, 14]), f.colors.carriage);
    solid(this.unitBox, trs([0, yb - 9, (zr + 4) / 2], [12, 12, Math.abs(zr)]), f.colors.carriage);

    // the toy on its centreline, bulging where compressed, squashed at the opening
    const roll = [Math.cos(f.roll), Math.sin(f.roll)];
    const toyU0 = () => ({ ...common, uModel: I4, uNorM: ID3, uToy: 1, uToyP: f.toyP, uToyC: f.toyC, uToyQ: f.toyQ, uRoll: roll, uBulge: [f.bulge || 0, f.squash || 0, f.baseSquash || 0],
      uColor: f.colors.toy, uNrmOn: this.nrm ? 1 : 0, uTexOn: this.tex ? 1 : 0, ...(this.theme || { uColOn: 0 }), uShine: 0.05 });
    if (this.toy) {
      if (this.nrm) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.nrm); }
      if (this.tex) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.activeTexture(gl.TEXTURE0); }
      draw(G, this.toy, toyU0());
    }
    // the body: one rear, x-ray translucent (a depth pre-pass keeps only its nearest surface), moved by its recoil, its
    // canal opened to the sleeve, the rim (lips) opaque in the strain colour
    const skinParts = this.layers ? (this.layers.find((l) => l.id === 'skin')?.parts || []) : this.body ? [this.body] : [];
    // (a carried colon, f.colon: the colon layer shows its path part (flag 4) as the canal whatever the layer's own opacity)
    const carried = !!(f.colon && this.G.colon && this.layers?.some((l) => l.id === 'colon' && l.parts.some((b) => b.bind)));
    const opOf = (id) => (id === 'colon' && carried ? Math.max(f.layers?.colon ?? 0, f.colon.alpha) : f.layers?.[id] ?? 0), inner = this.layers ? this.layers.filter((l) => l.id !== 'skin' && opOf(l.id) > 0.001) : [];
    const fade = f.fade ? { uFade: f.fade[0], uFadeC: f.fade[1] } : {};
    const rim = f.rim && this.G.rim ? f.rim : null;
    if (rim) this.rimTex = rimTexture(G, rim, this.rimTex);   // (the hole's shape, and the toy's profile for the carried colon)
    const drawBody = () => {
      // a layered model's inner layers first, in their own colours (the neck's fade and the faint colon blend), each at its
      // own opacity (paw-mr7f): the opaque ones, then the see-through ones, the organs before the skeleton, each by its
      // nearest surface (a depth pre-pass, then blended over what is behind), as the skin is
      const lay = { uSkin: 1, uClipOn: f.cut ? 1 : 0, uFlagA: f.flagA ?? -1, uColonOn: 0, uPush: 0, ...fade };
      // per layer: the carried colon (its path part opened round the toy, the rest of the colon at the layer's own
      // opacity); the small intestine and the bladder pushed aside by the toy (paw-kkmv)
      // (f.push: the toy where the gut's slow return still holds the organs, else the toy now)
      const toyU = { uToyC: f.push?.C || f.toyC, uToyQ: f.push?.Q || f.toyQ, uToyW: f.push?.W || f.wallSt || new Float32Array(160), uWall: f.wall || [0, 0, 0, 0], uPushM: [8, 15] };
      const own = (l) => (l.id === 'colon' && carried ? { uColonOn: 1, uColonC: (rim && f.colon.exact?.C) || f.colon.C, uColonQ: f.colon.Q, uColonS: [f.colon.step, f.colon.C.length / 4, ...((rim && f.colon.exact?.tip) || f.colon.tip || [-1e4, 0])], uColonV: rim && f.colon.exact ? [1, f.colon.exact.d, f.colon.exact.add, 0] : [0, 0, 0, 0], uFlagA: f.colon.alpha, uAlpha: f.layers?.colon ?? 0 }
        : (l.id === 'small' || l.id === 'bladder') && f.wallSt ? (lat ? { uLatOn: 1, ...lat } : { uPush: 1, ...toyU })
        : l.id === 'genitals' && f.prostate ? { uProsC: [...f.prostate.c, f.prostate.r], uProsI: f.prostate.i, uProsCol: f.colors.pros || f.colors.lip } : {});
      // (the soft organs on their lattice where the GPU reads textures in the vertex shader, else pushed per vertex)
      const L = f.lattice && this.G.lattice ? f.lattice : null, lat = L ? { uLatO: [...L.box.o, L.range], uLatD: [...L.box.d, L.bytes.length / 4], uLatN: L.box.n } : null;
      if (L) this.latTex = dataTexture(this.G, L.bytes, this.latTex);
      for (const l of inner) if (opOf(l.id) >= 0.99) for (const b of l.parts) solid(b, bodyM, f.colors.body, { ...lay, uAlpha: 1, ...own(l) });
      for (const l of inner.filter((x) => opOf(x.id) < 0.99).sort((a, b) => (a.id === 'skeleton') - (b.id === 'skeleton'))) {
        gl.colorMask(false, false, false, false);
        for (const b of l.parts) solid(b, bodyM, f.colors.body, { ...lay, uAlpha: opOf(l.id), ...own(l) });
        gl.colorMask(true, true, true, true); gl.depthFunc(gl.LEQUAL);
        for (const b of l.parts) solid(b, bodyM, f.colors.body, { ...lay, uAlpha: opOf(l.id), ...own(l) });
        gl.depthFunc(gl.LESS);
      }
      if (!skinParts.length || (this.layers && f.layers && !(opOf('skin') > 0.001))) return;
      if (this.bodyTexOn) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bodyTex); gl.activeTexture(gl.TEXTURE0); }
      // (the hole shaped like the toy's own section where the shader reads the rim texture: ring.js openingSleeve)
      const rimOn = rim ? 1 : 0;
      const body = { uRimOn: rimOn, uBodyTexOn: this.bodyTexOn || 0, uBody: 1, uR0: f.canalR ?? CANAL_R, uSleeve: f.sleeve, uSleeveY: f.sleeveY, uHole: f.hole, uToyW: f.wallSt || new Float32Array(160), uWall: f.wall || [0, 0, 0, 0], uToyC: f.toyC, uToyQ: f.toyQ, uRoll: [Math.cos(f.roll), Math.sin(f.roll)], uHilt: f.hilt || [0, 0, 0, 0], uClipOn: f.cut ? 1 : 0, uAlpha: f.xray, uSkin: 1, uContour: f.contour || [3, 0], uBone: f.bone || new Float32Array(16).fill(1e4), ...fade };
      gl.colorMask(false, false, false, false);
      for (const b of skinParts) solid(b, bodyM, f.colors.body, body);
      gl.colorMask(true, true, true, true); gl.depthFunc(gl.LEQUAL);
      for (const b of skinParts) solid(b, bodyM, f.colors.body, body);
      gl.depthFunc(gl.LESS);
    };
    // with inner layers drawn, the toy's parts hidden behind bone or organs show faintly through them (drawn last)
    const toyThrough = () => {
      if (!this.toy || !inner.length || (skinParts.length && f.xray >= 0.99 && !f.cut)) return;   // (an opaque skin hides it all)
      // (front faces only: the toy's own back faces lie behind its front and would tint it all)
      gl.depthMask(false); gl.depthFunc(gl.GREATER); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      draw(G, this.toy, { ...common, uModel: I4, uNorM: ID3, uToy: 1, uToyP: f.toyP, uToyC: f.toyC, uToyQ: f.toyQ, uRoll: roll, uBulge: [f.bulge || 0, f.squash || 0, f.baseSquash || 0], uColor: f.colors.toy, uNrmOn: 0, uTexOn: 0, uColOn: 0, uAlpha: 0.35, uClipOn: 0 });
      gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LESS); gl.depthMask(true);
    };
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (f.cut) { drawBody(); gl.depthMask(false); }   // the cutaway: the opaque cut body first, the path over its inside
    // the internal path: translucent, moved with the body; to the junction solid (strain where a bend is forced), the
    // colon past it thinner, fainter and dashed; a thin ghost of the relaxed path where the toy has moved it
    if (f.path && !carried) {   // (a carried colon is the path itself)
      const J = f.junction;
      this.tube = upload(G, pathTube(f.path, f.tubeR, f.tubeW, 20, 0, J), this.tube);
      const rdy = { uRdy: f.ready || new Float32Array(40), uRdyS: f.readyS || [0, 1], uReady: f.colors.ready || f.colors.tube };
      solid(this.tube, bodyM, f.colors.tube, { uTube: 1, uLip: f.colors.bend, uAlpha: 0.45, uClipOn: f.cut ? 1 : 0, ...rdy });
      this.colon = upload(G, pathTube(f.path, (s) => f.tubeR(s) * 0.75, () => 0, 14, J, Infinity), this.colon);
      solid(this.colon, bodyM, f.colors.tube, { uTube: 1, uDash: 1, uAlpha: 0.24, uClipOn: f.cut ? 1 : 0, ...rdy });
      gl.depthMask(true);
      if (f.ghostPath) { this.ghostTube = upload(G, pathTube(f.ghostPath, () => 1.2, () => 0, 8), this.ghostTube); solid(this.ghostTube, bodyM, f.colors.edge, { uTube: 1, uAlpha: 0.55, uReady: f.colors.edge }); }
    }
    // the rigid-toy ghost (where the carriage would put an unyielding toy), translucent; in a modelled body only its
    // part outside the opening (paw-ani1: drawn straight up the tilted rail it ran through the whole torso, a pale sleeve)
    if (this.toy && f.ghost) {
      gl.depthMask(false);
      const clip = f.layers ? { uClipOn: 1, uClip: [0, 1, 0, f.xb || 0] } : {};
      draw(G, this.toy, { ...common, uModel: I4, uNorM: ID3, uToy: 1, uToyP: [f.L, f.dc, 1, 1], uToyC: f.ghostC, uToyQ: f.ghostQ, uRoll: roll, uBulge: [0, 0, 0], uColor: f.colors.ghost, uNrmOn: 0, uColOn: 0, uAlpha: 0.2, ...clip });
      gl.depthMask(true);
    }
    if (!f.cut) drawBody();
    toyThrough();
    // the opening's marker (ring.js ringMesh: the hole's outline carried inward, in the rim's strain colour; a layered
    // model's "opening" layer is its intensity): a light, added over everything, faintly where the body is in front of
    // it, fully where nothing is, never where the toy is (the owner: "the part behind the toy gets composited behind");
    // never written to depth (Lite: only the faint pass, at its own strength)
    const rOp = f.ring ? (f.layers ? f.layers.opening ?? 1 : 1) : 0;
    this.ringInfo = null;
    if (rOp > 0.001) {
      const rm = ringMesh({ sleeve: f.sleeve, sleeveY: f.sleeveY, rim }, { ...f.ring, view: Math.hypot(v.eye[0], v.eye[1] - (f.xb || 0), v.eye[2]) });
      this.ring = upload(G, rm, this.ring); this.ringInfo = { a: rm.a, stretch: rm.stretch };
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      const gu = { uGlow: 1, uClipOn: 0 };
      gl.depthFunc(gl.LEQUAL);
      if (!f.ring.lite) solid(this.ring, bodyM, f.colors.lip, { ...gu, uAlpha: rOp * 0.7 });   // against everything drawn
      if (this.toy) {   // then against the toy alone: the depth buffer cleared and refilled with the toy's depth only
        gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); gl.colorMask(false, false, false, false); gl.depthFunc(gl.LESS);
        draw(G, this.toy, toyU0());
        gl.colorMask(true, true, true, true); gl.depthMask(false); gl.depthFunc(gl.LEQUAL);
      }
      solid(this.ring, bodyM, f.colors.lip, { ...gu, uAlpha: rOp * (f.ring.lite ? 0.8 : 0.3) });
      gl.depthFunc(gl.LESS); gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.disable(gl.BLEND);
  }
  destroy() {
    const G = this.G;
    clearTimeout(this.bodyTimer);
    for (const b of [this.toy, this.body, this.unitBox, this.tube, this.colon, this.ghostTube, this.ring]) drop(G, b);
    for (const t of [this.latTex, this.rimTex]) if (t) G.gl.deleteTexture(t);
    this.dropLayers();
    for (const t of [this.nrm, this.tex, this.bodyTex]) if (t) G.gl.deleteTexture(t);
    G.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
