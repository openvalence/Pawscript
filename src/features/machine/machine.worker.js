// machine.worker.js -- paw-h83k: the Machine panel's heavy readouts (offload.js) off the main thread. {id, fn: 'ttr' | 'bulge' | 'knots', a}
// -> {id, r} | {id, error}. The context, script and mesh come once and are held until a new one is sent.
import { timeToReady, simulateKnots } from './physics.js';
import { bulgePeak } from './offload.js';

let ctx = null, script = null, mesh = null;
self.onmessage = ({ data: { id, fn, a } }) => {
  try {
    if (a.ctx) ctx = a.ctx;
    if (a.script) script = a.script;
    if (a.mesh) mesh = a.mesh;
    self.postMessage({ id, r: fn === 'ttr' ? timeToReady(a.s, script, a.t, ctx) : fn === 'knots' ? simulateKnots(script, a.toy, a.rig, a.P) : bulgePeak({ ...a, mesh }) });
  } catch (e) { self.postMessage({ id, error: String(e?.message || e) }); }
};
