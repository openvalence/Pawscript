/**
 * color.js -- the colour maths the kit's tests and canvas users need: WCAG contrast, OKLab distance and a
 * colour-vision-deficiency simulation (Machado 2009, full severity). Pure, no DOM at import.
 * `cssVar()` is the one DOM helper: read a token for a canvas (re-read it when `data-theme` changes).
 */

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** '#RGB' | '#RRGGBB' -> [r, g, b] 0..255 */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error('not a hex color: ' + hex);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21 */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const M = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

/** Linear-light RGB 0..1, optionally as seen with a CVD ('protan' | 'deutan' | 'tritan'). */
function linearRgb(hex, cvd) {
  const v = hexToRgb(hex).map(lin);
  if (!cvd) return v;
  return M[cvd].map((row) => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
}

/** OKLab [L, a, b] of a hex colour, optionally CVD-simulated. */
export function oklab(hex, cvd) {
  const [r, g, b] = linearRgb(hex, cvd);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance in OKLab (0.02 is about one just-noticeable difference). */
export function deltaE(a, b, cvd) {
  const p = oklab(a, cvd), q = oklab(b, cvd);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** A token's computed value, e.g. cssVar('--series-sky'). Browser only. */
export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
