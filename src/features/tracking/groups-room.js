// groups-room.js -- paw-8ehz: where the Groups tool's chrome goes so that none of it lies over the picture. The bar takes a
// column at the stage's left, the notes card, the context line and the first-run hint a column at its right; the picture is
// fitted between them. Pure: GroupsOverlay.svelte feeds it the stage and applies the answer (the player's fit inset, the
// right column's width on the stage, the side docks folded while the tool is open when even that leaves no picture).

/**
 * @param {number} W  stage width, css px
 * @param {number} H  stage height
 * @param {number} a  the picture's aspect (width / height)
 * @param {number} bar  the left column: the bar's width and its gap
 * @param {{rMin?: number, rMax?: number, minPic?: number}} [o]  the right column's least / most width; the narrowest picture
 *   worth painting on
 * @returns {{inset: {l: number, r: number, t: number, b: number} | null, right: number, fold: boolean}}  inset null: the
 *   picture's own margins hold both columns, it stays where it is; fold: the stage is too narrow even so (fold the side docks)
 */
export function groupsRoom(W, H, a, bar, { rMin = 180, rMax = 320, minPic = 240 } = {}) {
  const P = Math.min(W, H * a), side = (W - P) / 2;
  if (side >= bar && side >= rMin) return { inset: null, right: Math.floor(Math.min(side, rMax)), fold: false };
  const pw = Math.min(W - bar - rMin, H * a);
  if (pw < minPic) return { inset: { l: bar, r: rMin, t: 0, b: 0 }, right: rMin, fold: true };
  const right = Math.floor(Math.min(rMax, W - bar - pw));
  return { inset: { l: bar, r: right, t: 0, b: 0 }, right, fold: false };
}

/** paw-iwb7: where Tab puts the pointer on the picture, client px: the last point painted in this take (frame fraction
 *  [nx, ny]) while it is on the visible picture, else the middle of the picture's part on the stage; null with none on it.
 *  st = the stage's client rect, map(nx, ny) -> stage px (the overlay env's: zoom, pan, rotation, flips). */
export function pictureTarget(st, map, last = null) {
  const cs = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => map(x, y)), xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(st.width, Math.max(...xs)), y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(st.height, Math.max(...ys));
  if (!(x1 > x0 && y1 > y0)) return null;
  const at = last ? map(last[0], last[1]) : null, on = at && at[0] >= x0 && at[0] <= x1 && at[1] >= y0 && at[1] <= y1;
  return [st.left + (on ? at[0] : (x0 + x1) / 2), st.top + (on ? at[1] : (y0 + y1) / 2)];
}
