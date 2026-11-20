// sidecar.js -- the Tauri seam: one run of the sidecar, events delivered as parsed objects.
import { invoke, Channel } from '@tauri-apps/api/core';
import { parseLine, createBatcher } from './protocol.js';

export const START_TIMEOUT_MS = 180_000;
const DRAIN_MS = 10_000;   // after the process exited: wait this long at most for the channel's {"type":"exit"}

// Rust runs one sidecar at a time: runs queue here, so a run started while the previous one is still dying (a
// timeout, a cancel's grace period, a caller outside tracking's job chain) waits for it instead of failing.
// paw-shgb: several tabs share the one process. A run carries its owner (a tab's tracking store); a cancel with an owner drops
// only that owner's queued runs and kills the running one only when it is that owner's, so nothing in one tab stops another's job.
// paw-1sa9: each run has an id, sent with sidecar_run and with every cancel of it, so the shell cancels only that run (a
// cancel posted as one run ends cannot reach the next). An older shell ignores the extra argument and cancels whatever runs.
let queue = Promise.resolve(), cancels = 0, running = null, runningId = null;
const newRunId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const epochs = new WeakMap();   // owner -> its cancels
const epochOf = (o) => (o ? epochs.get(o) || 0 : 0);
const NOBODY = {};
let lastError = null;
/** paw-frhy: the last run that failed, {at, cmd, message}, for Help › Copy bug report (which scrubs it). */
export const lastSidecarError = () => lastError;

/**
 * Runs one request. `onEvent(e)` gets every non-frame event as it arrives (stderr lines come as
 * {type:'log', line}); `onFrames(batch)` gets `frame` events batched once per animation frame.
 * startTimeoutMs: no line at all (log lines count) for this long after the start kills the run and fails it.
 * Resolves {result, error, stderr, cancelled}: `result` is the result event, `error` a message if the run
 * failed (error event, bad exit, no result, start timeout).
 */
export function runSidecar(request, opts = {}) {
  const owner = opts.owner ?? null, epoch = cancels, own = epochOf(owner), prev = queue;
  const p = prev.then(() => {
    if (epoch !== cancels || epochOf(owner) !== own) return { result: null, error: null, stderr: '', cancelled: true };
    running = owner ?? NOBODY;
    const id = (runningId = newRunId());
    try { opts.onStart?.(); } catch { /* a listener never stops the run */ }
    return runOnce(request, opts, id).finally(() => { running = null; runningId = null; });
  }).then((r) => { if (r?.error) lastError = { at: Date.now(), cmd: String(request?.cmd || ''), message: String(r.error) }; return r; });
  queue = p.catch(() => {});
  return p;
}
/** The owner of the run in flight (null: none, or one without an owner). */
export const sidecarOwner = () => (running === NOBODY ? null : running);

async function runOnce(request, { onEvent = () => {}, onFrames = () => {}, startTimeoutMs = START_TIMEOUT_MS } = {}, run) {
  const batch = createBatcher(onFrames);
  let result = null, errMsg = null, exited, timedOut = false, timer = 0;
  const exitSeen = new Promise((r) => { exited = r; });
  const on_line = new Channel();
  on_line.onmessage = (line) => {
    clearTimeout(timer);
    const e = parseLine(line);
    if (e.type === 'exit') return exited();
    if (e.type === 'frame') batch.push(e);
    else {
      if (e.type === 'result') { batch.flush(); result = e; }
      else if (e.type === 'error') errMsg = e.message;
      onEvent(e);
    }
  };
  if (startTimeoutMs > 0) timer = setTimeout(() => { timedOut = true; invoke('sidecar_cancel', { run }).catch(() => {}); }, startTimeoutMs);
  let exit;
  try { exit = await invoke('sidecar_run', { request, onLine: on_line, run }); }
  catch (e) { return { result: null, error: String(e), stderr: '', cancelled: false }; }
  finally { clearTimeout(timer); }
  // channel messages can still be on their way when invoke resolves: drain until the exit line
  if (!result && !errMsg && !exit.cancelled) { let t; await Promise.race([exitSeen, new Promise((r) => { t = setTimeout(r, DRAIN_MS); })]); clearTimeout(t); }
  batch.flush();
  const tail = exit.stderr_tail.trim().split(/\r?\n/).slice(-8).join('\n');
  let error = null;
  if (timedOut) error = `the sidecar sent nothing for ${Math.round(startTimeoutMs / 1000)} s after starting, so it was stopped (it may be installing packages or waiting for the GPU; the limit is the setting tracking.startTimeoutS)`;
  else if (!exit.cancelled) {
    if (errMsg) error = errMsg;
    else if (exit.code == null) error = 'the sidecar was killed';
    else if (exit.code !== 0) error = 'sidecar exited with code ' + exit.code;
    else if (!result) error = 'sidecar finished without a result';
  }
  if (error && tail) error += '\n' + tail;
  const cancelled = exit.cancelled && !timedOut;
  return { result: cancelled ? null : result, error, stderr: tail, cancelled };
}

/** Kills the running sidecar; runs queued before this call never start. owner: only that owner's (see the top); none: every
 *  run, as before. The cancel names the running run's id; with no run here (a reload's sweep) it names none: the shell's
 *  run, whatever it is, goes. */
export const cancelSidecar = (owner = null) => {
  if (!owner) { cancels++; return invoke('sidecar_cancel', runningId ? { run: runningId } : {}); }
  epochs.set(owner, epochOf(owner) + 1);
  return running === owner ? invoke('sidecar_cancel', { run: runningId }) : Promise.resolve();
};
