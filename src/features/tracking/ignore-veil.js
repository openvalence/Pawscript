// ignore-veil.js -- how an ignore region (groups.js IGNORE, paw-855t) is drawn: the picture as the trainer will "see" it, that region
// blacked out. A dark veil over the painted area with a diagonal hatch, unlike a part's light tint (GroupsOverlay.svelte tint(): a
// colour at <= 43 % alpha, no hatch). Pure: the RGBA bytes of one mask (any size, m.a floats 0..1), drawn like a tinted mask.
export const VEIL_ALPHA = 190;   // 0..255 at full mask value (the part tint peaks at 110)
export const HATCH_PX = 5;       // hatch lines run every this many mask px, 45 degrees
/** RGBA bytes (w * h * 4) of the veil: near-black, a lighter diagonal hatch, alpha = mask value; fully clear where the mask is 0. */
export function veilPixels(m) {
  const { w, h, a } = m, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = a[i];
    if (!(v > 0)) continue;
    const hatch = (x + y) % HATCH_PX === 0, k = i * 4;
    d[k] = d[k + 1] = d[k + 2] = hatch ? 205 : 8;
    d[k + 3] = Math.round(v * (hatch ? 235 : VEIL_ALPHA));
  }
  return d;
}
