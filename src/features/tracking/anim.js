// anim.js -- ONE animation loop per driver (paw-m2cg perf fix). run(true) any number of times leaves exactly one scheduled
// frame; run(false) (or stop) cancels it; the loop ends by itself when `want` is off. sched is injectable for tests.
export function driver(tick, sched = { raf: (f) => requestAnimationFrame(f), cancel: (i) => cancelAnimationFrame(i) }) {
  let id = 0, want = false;
  const loop = () => { id = 0; if (!want) return; tick(); if (want && !id) id = sched.raf(loop); };
  return {
    run(on) { want = !!on; if (want && !id) id = sched.raf(loop); else if (!want && id) { sched.cancel(id); id = 0; } },
    stop() { this.run(false); },
    get live() { return id ? 1 : 0; },
  };
}
