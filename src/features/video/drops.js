// drops.js -- the sustained drop rate of the video decoder (paw-wfd2.3: the health slot's "Dropping frames"). Pure (test/drops.test.mjs).
export const WINDOW_MS = 10000;   // the rate is over this much playing
const MIN_SPAN_MS = 3000, MIN_FRAMES = 60, GAP_MS = 2000;   // less than this much is too little to call a rate; a longer gap between samples is a pause

/** win: [[ms, dropped, total]] (kept between calls, mutated); one sample in. -> % dropped over the window, 0 until it holds enough. */
export function dropRate(win, now, dropped, total) {
  const last = win[win.length - 1];
  if (last && (now - last[0] > GAP_MS || total < last[2])) win.length = 0;   // paused, or a new video's counters
  win.push([now, dropped, total]);
  while (win.length > 2 && now - win[1][0] >= WINDOW_MS) win.shift();
  const [t0, d0, n0] = win[0], dn = total - n0;
  return now - t0 >= MIN_SPAN_MS && dn >= MIN_FRAMES ? Math.round(100 * (dropped - d0) / dn) : 0;
}
