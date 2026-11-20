// test/perf.mjs -- speed budgets (paw-0u3v, paw-o9u3). They are calibrated on the owner's PC and fail on a slower or busy one,
// so they do not gate `npm run check` (nor `npm run build` / `tauri build`, which run it): budget() asserts only in
// `npm run check:perf` (one test file at a time) or with PAW_PERF=1. Measure synchronous work as this thread's CPU time
// (cpuNow / cpuMs), not wall time: other processes keeping the thread waiting is not the code's cost.
import assert from 'node:assert/strict';

export const PERF = process.env.PAW_PERF === '1' || process.env.npm_lifecycle_event === 'check:perf';
export const cpuNow = () => process.threadCpuUsage();
export const cpuMs = (t0) => { const u = process.threadCpuUsage(t0); return (u.user + u.system) / 1000; };
/** A speed budget: asserted under PERF only, otherwise nothing (the work above it has still run, so a crash still fails). */
export function budget(ok, msg) { if (PERF) assert.ok(ok, msg); }
