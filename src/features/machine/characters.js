// characters.js -- whose rear the hole belongs to: a top-down body silhouette drawn around the hole (the 2D fallback)
// and the 3D body. A data list: add an entry to add a character. Characters change the body only; the tissue comes
// from the experience preset (physics.js EXPERIENCE). `path` is an SVG path in mm with the hole at (0, 0) and the body
// toward negative y (up the panel, away from the machine); every sub-path is filled and outlined, so a tail over the
// back shows. `body` is the 3D view's body (body.js): its default `height` in cm (the Height setting overrides it; the body and
// the internal path scale with height / 175), hip `width` (x scale), its `tail` (or none), and `side`: which side
// the sigmoid and descending colon run to (-1 = the receiver's left, as in human anatomy; +1 mirrored).
// A tail is a few numbers (body.js tailSdf), mm at height 175: `root` (where it leaves the body), `pts` (its spline,
// from the root), `r` (radius profile, root -> tip, evenly spaced), optional `hair` (a soft outer shell's radius
// profile) with `fluff` (tufts), `blend` (how softly it joins the body). Every tail is posed lifted and swept to the
// receiver's right (+x) and toward the head, so it never covers the opening, the toy or the rail in any view.

const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${-x} ${y}`);
const legs = (d) => d + ' ' + mirror(d);

export const CHARACTERS = Object.freeze([
  { id: 'generic', body: { height: 170, width: 1, tail: { root: [0, 25, 85], r: [20, 18, 15, 12, 8], pts: [[0, 0, 0], [5, -6, 45], [35, -10, 95], [90, -5, 120], [150, 15, 110]] }, side: -1 }, name: 'Generic',
    path: 'M -150 -700 L -150 -120 C -150 -40 -90 0 -30 0 L 30 0 C 90 0 150 -40 150 -120 L 150 -700 Z' },
  { id: 'canine', body: { height: 170, width: 0.9, tail: { root: [0, 42, 88], r: [20, 16, 12, 8, 4], hair: [22, 38, 46, 42, 28, 8], fluff: 0.35,
      pts: [[0, 0, 0], [6, 0, 55], [40, 5, 115], [105, 5, 150], [165, 25, 140], [200, 60, 105]] }, side: -1 }, name: 'Canine',
    path: 'M -105 -700 L -110 -170 C -110 -70 -60 -6 -18 0 L 18 0 C 60 -6 110 -70 110 -170 L 105 -700 Z '
      + legs('M -100 -250 C -150 -190 -150 -60 -128 50 L -96 50 C -92 -30 -86 -120 -88 -190 Z')
      + ' M -10 -30 C -40 -140 25 -250 -5 -420 L 12 -420 C 40 -250 -20 -140 12 -30 Z' },
  { id: 'feline', body: { height: 165, width: 0.95, tail: { root: [0, 25, 85], r: [14, 11, 9, 8, 8, 9, 11],
      pts: [[0, 0, 0], [3, -6, 70], [30, -14, 140], [90, -12, 170], [150, 0, 150], [200, 25, 170], [215, 55, 215]] }, side: -1 }, name: 'Feline',
    path: 'M -80 -700 L -82 -140 C -82 -55 -45 -4 -14 0 L 14 0 C 45 -4 82 -55 82 -140 L 80 -700 Z '
      + legs('M -76 -210 C -112 -160 -112 -50 -96 40 L -72 40 C -68 -30 -64 -100 -66 -160 Z')
      + ' M -6 -24 C -20 -160 40 -300 10 -520 L 22 -520 C 54 -300 -6 -160 6 -24 Z' },
  { id: 'equine', body: { height: 190, width: 1.05, tail: { root: [0, 35, 92], r: [34, 28, 18, 6, 1, 1, 1, 1], hair: [20, 34, 46, 56, 64, 70, 72, 60], squash: [1, 1, 2.2], fluff: 0.3,
      pts: [[0, 0, 0], [10, 5, 45], [60, 10, 85], [130, 40, 105], [190, 95, 100], [230, 160, 80], [250, 230, 60], [255, 300, 45]] }, side: -1 }, name: 'Equine',
    path: 'M -230 -700 L -240 -200 C -240 -80 -130 -8 -40 0 L 40 0 C 130 -8 240 -80 240 -200 L 230 -700 Z '
      + legs('M -225 -320 C -290 -240 -290 -60 -255 70 L -205 70 C -200 -40 -195 -160 -200 -250 Z')
      + ' M -30 -40 C -70 -200 -40 -380 -60 -560 L 60 -560 C 40 -380 70 -200 30 -40 Z' },
  { id: 'dragon', body: { height: 185, width: 1, tail: { root: [0, 72, 118], r: [80, 64, 50, 38, 28, 19, 11, 5], blend: 45,
      pts: [[0, 0, 0], [10, -5, 35], [70, -10, 70], [160, 0, 85], [240, 40, 75], [290, 110, 60], [310, 200, 50], [310, 300, 45]] }, side: -1 }, name: 'Dragon',
    path: 'M -185 -700 L -195 -180 C -195 -70 -110 -8 -32 0 L 32 0 C 110 -8 195 -70 195 -180 L 185 -700 Z '
      + legs('M -180 -280 C -245 -210 -250 -60 -215 60 L -230 85 L -200 75 L -185 95 L -170 70 C -160 -40 -155 -150 -160 -230 Z')
      + ' M -55 -40 C -80 -200 -30 -380 -8 -640 L 8 -640 C 30 -380 80 -200 55 -40 Z'
      + ' M -40 -160 L -62 -190 L -36 -205 Z M 40 -160 L 62 -190 L 36 -205 Z M -26 -330 L -46 -360 L -22 -372 Z M 26 -330 L 46 -360 L 22 -372 Z' },
]);

// Imported models (meshbody.js; bodies/<mesh>.*): `body.mesh` names the asset, `body.height` is the model's own standing
// height (cm; its json's height_cm: the Height setting scales the model against it), `side` as above (a layered model
// measures its own from its colon). Build and Anatomy do not apply (the model is its own shape). The 2D fallback draws
// a plain outline. The Human is Z-Anatomy's male model (tools/zanatomy_export.py, tools/build-body-layers.mjs: posed on
// all fours, head removed, in layers); any other bodies/<id>.json in a checkout (the owner's own models, kept out of
// the repo) is offered too (meshCharacter), once its asset is there (bodies.js bodyAsset).
const OUTLINE = 'M -150 -700 L -150 -120 C -150 -40 -90 0 -30 0 L 30 0 C 90 0 150 -40 150 -120 L 150 -700 Z';
export const MESH_CHARACTERS = Object.freeze([
  { id: 'human', body: { mesh: 'human', height: 171, side: -1 }, name: 'Human',
    path: 'M -175 -700 L -178 -150 C -178 -40 -115 12 -55 12 C -28 12 -10 2 0 0 C 10 2 28 12 55 12 C 115 12 178 -40 178 -150 L 175 -700 Z' },
]);
/** A character for a local model's asset json ({id, name, height_cm, side?}). */
export const meshCharacter = (info) => ({ id: info.id, body: { mesh: info.id, height: info.height_cm, side: info.side ?? -1 }, name: info.name || info.id, path: OUTLINE });
/** Once per install (settings machine.charV): an install that has used the Machine panel before (any machine.* setting)
 *  is switched to the owner's own model (paw-dt9) when there is one (ownId: a local model's id); a fresh install keeps
 *  the default. settings: {values, get, set}. */
export function adoptOwnModel(settings, ownId = null) {
  if (settings.get('machine.charV', 0)) return false;
  const used = !!ownId && Object.keys(settings.values || {}).some((k) => k.startsWith('machine.') && k !== 'machine.charV');
  if (used) settings.set('machine.char', ownId);
  settings.set('machine.charV', 1);
  return used;
}
/** Every character the dropdown can offer: Generic, the Human, the other procedural bodies, then local models. */
export const ALL_CHARACTERS = Object.freeze([CHARACTERS[0], ...MESH_CHARACTERS, ...CHARACTERS.slice(1)]);

export const characterOf = (id, local = []) => ALL_CHARACTERS.find((c) => c.id === id) || local.find((c) => c.id === id) || CHARACTERS[0];
