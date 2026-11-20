// plate.js -- the backing plate of a label drawn on the video canvas, in the theme's ground: the label inks follow the
// theme (a light theme's tokens are dark), so the fixed dark plate made them unreadable there (paw-098).
import { paint } from './colors.js';

/** '#rgb' / '#rrggbb' / 'rgb(a)(r, g, b, …)' -> perceived brightness 0..255, NaN when it cannot tell. */
export function brightness(col) {
  const s = String(paint(col) || '').trim();
  let m = /^#([\da-f])([\da-f])([\da-f])$/i.exec(s);
  const rgb = m ? m.slice(1).map((h) => parseInt(h + h, 16))
    : (m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(s)) ? m.slice(1).map((h) => parseInt(h, 16))
    : (m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)) ? m.slice(1).map(Number) : null;
  return rgb ? 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] : NaN;
}
/** The plate at opacity a: light on a light theme ground (`bg`, default the theme's --bg), else dark. */
export const plate = (a = 0.8, bg = 'var(--bg)') => (brightness(bg) > 128 ? `rgba(246, 247, 249, ${a})` : `rgba(8, 9, 11, ${a})`);
