// offload.js -- paw-h83k: the Machine panel's two heavy readouts off the main thread while it plays: the time to take the
// knot again (physics.js timeToReady: up to 10 min of steps, every 500 ms) and the bulge's peak (centreline.js bulgeAt over
// the sampled belly skin, ~25 ms, every 120 ms). Both in a Worker (machine.worker.js), one per panel; no Worker (tests, a
// failed load): the same call inline. Same functions, same data (structured clones): the same numbers.
//   const off = createOffload()
//   await off.ready(s, script, t, ctx)   -> timeToReady's result | null (passed over: a newer one was asked meanwhile)
//   await off.bulge(job)                 -> bulgePeak(job) | null (passed over)
//   await off.knots(script, toy, rig, P) -> simulateKnots's events | null (passed over) (paw-mnd8: the whole script's steps,
//                                           also paused: a tuning change no longer runs them in one main-thread task)
//   off.close()
// One call of each kind runs at a time; one asked while it runs waits, and a newer one replaces it (null): the worker never
// falls behind (a worker thread may run several times slower than the main thread while video plays).
import { timeToReady, simulateKnots } from './physics.js';
import { bulgeAt } from './centreline.js';

/** The bulge readout's peak: bulgeAt over the sampled skin vertices ix of mesh {pos, nor} (moved by bxb), the toy at
 *  tc {C, Q} with its wall stations wallSt, roll, wall [thickness, cap, from], o {from, cap, h}, bone line bl. */
export function bulgePeak({ mesh: m, ix, tc, wallSt, roll, wall, o, bl, bxb }) {
  let bp = 0;
  for (const i of ix) bp = Math.max(bp, bulgeAt([m.pos[i * 3], m.pos[i * 3 + 1] + bxb, m.pos[i * 3 + 2]], tc, wallSt, roll, wall[0], { ...o, bone: bl, nor: m.nor ? [m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]] : null }));
  return bp;
}

const INLINE = { ttr: (a) => timeToReady(a.s, a.script, a.t, a.ctx), bulge: bulgePeak, knots: (a) => simulateKnots(a.script, a.toy, a.rig, a.P) };
const inline = (fn, a) => { try { return Promise.resolve(INLINE[fn](a)); } catch (e) { return Promise.reject(e); } };

export function createOffload() {
  let worker = null, seq = 0;
  const wait = new Map();   // id -> {res, rej, fn, a}
  const held = { ctx: null, script: null, mesh: null };   // what the worker holds (sent again only when they change)
  const lanes = { ttr: { busy: false, next: null }, bulge: { busy: false, next: null }, knots: { busy: false, next: null } };
  function start() {
    try { worker = new Worker(new URL('./machine.worker.js', import.meta.url), { type: 'module' }); } catch { return (worker = false); }
    worker.onmessage = ({ data: { id, r, error } }) => { const w = wait.get(id); if (!w) return; wait.delete(id); if (error) w.rej(new Error(error)); else w.res(r); };
    worker.onerror = (e) => {   // did not load / died: what was asked, and everything from now on, inline
      console.info('[machine] readouts on the main thread:', e?.message || e);
      worker.terminate(); worker = false;
      for (const [, w] of wait) inline(w.fn, w.a).then(w.res, w.rej);
      wait.clear();
    };
  }
  const fresh = (k, v) => (held[k] === v ? null : (held[k] = v));
  /** fn on the worker (msg(): its message, with only what the worker does not hold yet), else inline on a. */
  function call(fn, a, msg) {
    if (worker === null && typeof Worker !== 'undefined') start();
    if (!worker) return inline(fn, a);
    return new Promise((res, rej) => { const id = ++seq; wait.set(id, { res, rej, fn, a }); worker.postMessage({ id, fn, a: msg() }); });
  }
  function pump(L) {
    if (L.busy || !L.next) return;
    const { run, res } = L.next;
    L.next = null; L.busy = true;
    run().then(res, () => res(null)).finally(() => { L.busy = false; pump(L); });
  }
  const latest = (kind, run) => new Promise((res) => { const L = lanes[kind]; L.next?.res(null); L.next = { run, res }; pump(L); });
  return {
    ready: (s, script, t, ctx) => latest('ttr', () => call('ttr', { s, script, t, ctx }, () => ({ s, t, ctx: fresh('ctx', ctx), script: fresh('script', script) }))),
    bulge: (job) => latest('bulge', () => call('bulge', job, () => { const { mesh, ...rest } = job; return { ...rest, mesh: fresh('mesh', mesh) && { pos: mesh.pos, nor: mesh.nor || null } }; })),
    knots: (script, toy, rig, P) => latest('knots', () => call('knots', { script, toy, rig, P }, () => ({ toy, rig, P, script: fresh('script', script) }))),
    close() { if (worker) worker.terminate(); worker = false; for (const [, w] of wait) w.res(null); wait.clear(); },
  };
}
