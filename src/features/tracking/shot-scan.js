// shot-scan.js -- paw-o60v.1: what keeps tracking's shot-link scan (tracking.svelte.js #propose) off the main thread and from
// being done twice.
//   await offMain('framePrint' | 'cropLink' | 'loopLinks' | 'matchCycles' | 'spotCheck', args, transfer?)   lib/crop-match.js in
//     a Worker (lib/crop-match.worker.js); no Worker (tests, a failed load): the same call inline.
//   await scanCacheGet(key) / scanCachePut(key, value)   the scan's results per video in IndexedDB (structured clone: Maps and
//     floats as they are); no IndexedDB / an error: null / nothing (the scan just runs).
import { cropLink, loopLinks, matchCycles, spotCheck, framePrint } from '../../lib/crop-match.js';

const INLINE = { cropLink, loopLinks, matchCycles, spotCheck, framePrint };
let worker = null, seq = 0;
const wait = new Map();   // id -> {res, rej, fn, args}
function inline(fn, args) { try { return Promise.resolve(INLINE[fn](...args)); } catch (e) { return Promise.reject(e); } }
function start() {
  try {
    worker = new Worker(new URL('../../lib/crop-match.worker.js', import.meta.url), { type: 'module' });
  } catch { return (worker = false); }
  worker.onmessage = ({ data: { id, r, error } }) => { const w = wait.get(id); if (!w) return; wait.delete(id); if (error) w.rej(new Error(error)); else w.res(r); };
  worker.onerror = (e) => {   // the worker did not load / died: everything asked so far, and from now on, runs inline (a transferred frame is gone: that print fails)
    console.info('[tracking] shot links compare on the main thread:', e?.message || e);
    worker.terminate(); worker = false;
    for (const [, w] of wait) inline(w.fn, w.args).then(w.res, w.rej);
    wait.clear();
  };
  return worker;
}
export function offMain(fn, args, transfer = []) {
  if (worker === null && typeof Worker !== 'undefined') start();
  if (!worker) return inline(fn, args);
  return new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej, fn, args }); worker.postMessage({ id, fn, args }, transfer); });
}

// ponytail: one entry per video ever scanned, never evicted (~10-50 KB each); evict by age if that ever adds up
let db = null;
const open = () => (db ??= new Promise((res) => {
  try {
    const q = indexedDB.open('pawscript-shot-scan', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('v');
    q.onsuccess = () => res(q.result);
    q.onerror = () => res(null);
  } catch { res(null); }
}));
export async function scanCacheGet(key) {
  const d = typeof indexedDB === 'undefined' ? null : await open();
  if (!d) return null;
  return new Promise((res) => { try { const r = d.transaction('v').objectStore('v').get(key); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); } catch { res(null); } });
}
export async function scanCachePut(key, value) {
  const d = typeof indexedDB === 'undefined' ? null : await open();
  try { d?.transaction('v', 'readwrite').objectStore('v').put(value, key); } catch { /* a cache */ }
}
