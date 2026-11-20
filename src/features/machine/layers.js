// layers.js -- a layered body's layer opacities (paw-mr7f; pure). Setting machine.layers = {op: {layer: 0..1}, last:
// {layer: 0..1}}: each layer's opacity, 0 = off (the toggle and the opacity are one control), and the last opacity it
// had when it was switched off (a click on its name brings it back). A layer never set takes its default: on (1) for
// the asset's default layers (skin, skeleton), off otherwise; the skin's default is see-through (SKIN_OVER) while any
// inner layer shows, else the panel's usual x-ray opacity (SKIN_ALONE).
export const SKIN_OVER = 0.35, SKIN_ALONE = 0.55;
// the layers of the first layered Human (paw-27u0) and what they became
const SPLIT = { digestive: ['colon', 'small', 'stomach'], urogenital: ['bladder', 'genitals', 'kidneys'], organs: ['liver', 'thorax'] };

/** The opening's ring (ring.js, paw-j7em): a layer of every layered model, drawn rather than loaded, on by default. */
export const OPENING = Object.freeze({ id: 'opening', name: 'Opening (ring)', on: true });
/** A layered model's layer list with the opening's ring added (none for a single-mesh body). */
export const withOpening = (list) => (list?.length ? [...list, OPENING] : []);

/** Older settings ({layer: boolean, skinAlpha}) in the current shape; the current shape as it is. */
export function migrateLayers(saved) {
  if (!saved || typeof saved !== 'object') return { op: {}, last: {} };
  if (saved.op || saved.last) return { op: { ...(saved.op || {}) }, last: { ...(saved.last || {}) } };
  const op = {};
  for (const [k, v] of Object.entries(saved)) {
    if (k === 'skinAlpha') continue;
    if (typeof v !== 'boolean') continue;
    for (const id of SPLIT[k] || [k]) op[id] = v ? 1 : 0;
  }
  if (op.skin === 1) delete op.skin;   // (skin on: its default, which already goes see-through over inner layers)
  if (Number.isFinite(saved.skinAlpha) && op.skin !== 0) op.skin = saved.skinAlpha;
  return { op, last: {} };
}

/** {layer: opacity 0..1} for a layer list [{id, on}] and the saved setting. */
export function layerOpacities(saved, list) {
  const { op } = migrateLayers(saved), out = {};
  for (const l of list) if (l.id !== 'skin') out[l.id] = Number.isFinite(op[l.id]) ? clamp01(op[l.id]) : l.on ? 1 : 0;
  const inner = list.some((l) => l.id !== 'skin' && l.id !== OPENING.id && out[l.id] > 0);   // (the ring sits in the skin: not an inner layer)
  if (list.some((l) => l.id === 'skin')) out.skin = Number.isFinite(op.skin) ? clamp01(op.skin) : inner ? SKIN_OVER : SKIN_ALONE;
  return out;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The setting with a layer's opacity set (0 = off). */
export function setOpacity(saved, id, v) {
  const s = migrateLayers(saved);
  s.op[id] = Math.round(clamp01(v) * 100) / 100;
  return s;
}

/** The setting with a layer flipped: off (remembering its opacity), or back to its last opacity (else fully on; the
 *  skin to its see-through default). current: its opacity now. */
export function flipLayer(saved, id, current) {
  const s = migrateLayers(saved);
  if (current > 0) { s.op[id] = 0; s.last[id] = current; }
  else s.op[id] = s.last[id] > 0 ? s.last[id] : id === 'skin' ? SKIN_OVER : 1;
  return s;
}
