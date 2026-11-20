// crop-match.worker.js -- paw-o60v.1: the shot-link scan's pixel work and arithmetic (lib/crop-match.js) off the main thread, so
// the scan never stutters playback or input. {id, fn, args} -> {id, r} | {id, error}. The same functions shot-scan.js runs
// inline when there is no Worker: same results.
import { cropLink, loopLinks, matchCycles, spotCheck, framePrint } from './crop-match.js';

const FN = { cropLink, loopLinks, matchCycles, spotCheck, framePrint };
self.onmessage = ({ data: { id, fn, args } }) => {
  try { self.postMessage({ id, r: FN[fn](...args) }); } catch (e) { self.postMessage({ id, error: String(e?.message || e) }); }
};
