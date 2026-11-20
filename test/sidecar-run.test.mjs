// sidecar-run.test.mjs -- src/lib/sidecar.js against a fake Tauri IPC with the Rust side's rules: one run at a
// time ("already active" otherwise), sidecar_cancel kills the current run, lines arrive over the Channel.
// paw-1sa9: shell = 'new' cancels only the run its `run` id names (none: whatever runs); 'old' ignores the id, as the
// shell before it did.
import test from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const callbacks = new Map();
let nextId = 1, current = null, shell = 'new', cancelGate = null;
const log = [], calls = [];
/** script(send, run) -> Promise<{code}>; run.killed is set by sidecar_cancel. */
let script = null;
globalThis.window = globalThis;
globalThis.__TAURI_INTERNALS__ = {
  transformCallback: (cb) => { const id = nextId++; callbacks.set(id, cb); return id; },
  unregisterCallback: (id) => callbacks.delete(id),
  async invoke(cmd, args) {
    log.push(args?.request?.cmd ? `${cmd}:${args.request.cmd}` : cmd);
    calls.push({ cmd, args });
    if (cmd === 'sidecar_cancel') {
      if (cancelGate) await cancelGate;   // the cancel reaches the shell late
      if (current && (shell === 'old' || !args?.run || args.run === current.id)) { current.killed = true; current.wake?.(); }
      return;
    }
    if (current) throw 'a sidecar run is already active';
    const run = (current = { killed: false, id: shell === 'new' ? args.run : undefined }), cb = callbacks.get(args.onLine.id);
    let i = 0;
    const send = (line, delay = 0) => { const idx = i++; setTimeout(() => cb({ index: idx, message: line }), delay); };
    try {
      const { code, lateExitMs = 0 } = await script(send, run, args.request);
      send('{"type":"exit"}', lateExitMs);
      return { code: run.killed ? null : code, stderr_tail: '', cancelled: run.killed };
    } finally { current = null; }
  },
};
const { runSidecar, cancelSidecar } = await import('../src/lib/sidecar.js');
const killable = (run, ms) => new Promise((r) => { run.wake = r; setTimeout(r, ms); });

test('runs queue instead of failing with "already active"', async () => {
  log.length = 0;
  script = async (send, run, req) => { await killable(run, 40); send(JSON.stringify({ type: 'result', cmd: req.cmd })); return { code: 0 }; };
  const [a, b] = await Promise.all([runSidecar({ cmd: 'track' }), runSidecar({ cmd: 'probe' })]);
  assert.equal(a.error, null); assert.equal(b.error, null);
  assert.equal(b.result.cmd, 'probe');
});

test('cancel kills the current run and drops the queued ones', async () => {
  log.length = 0;
  script = async (send, run) => { await killable(run, 5000); return { code: 0 }; };
  const a = runSidecar({ cmd: 'track' }), b = runSidecar({ cmd: 'score' });
  await sleep(20);
  await cancelSidecar();
  const c = runSidecar({ cmd: 'list' });   // asked after the cancel: runs
  script = async (send) => { send('{"type":"result"}'); return { code: 0 }; };
  assert.deepEqual([(await a).cancelled, (await b).cancelled], [true, true]);
  assert.equal((await c).error, null);
  assert.ok(!log.includes('sidecar_run:score'), 'the queued run never started');
});

test('lines arriving after the invoke response are drained until the exit line', async () => {
  script = async (send) => { send('{"type":"progress","done":1,"total":2}', 300); send('{"type":"result","ok":1}', 300); return { code: 0, lateExitMs: 300 }; };
  const r = await runSidecar({ cmd: 'track' });
  assert.equal(r.error, null);
  assert.equal(r.result.ok, 1);
});

test('stderr log lines reach onEvent and count as a start', async () => {
  const seen = [];
  script = async (send, run) => { send('{"type":"log","line":"waiting for the GPU"}', 10); send('{"type":"result"}', 80); await killable(run, 100); return { code: 0 }; };
  const r = await runSidecar({ cmd: 'track' }, { onEvent: (e) => seen.push(e.type), startTimeoutMs: 50 });
  assert.equal(r.error, null);
  assert.deepEqual(seen, ['log', 'result']);
});

test('no line at all within startTimeoutMs kills the run with a clear error', async () => {
  log.length = 0;
  script = async (send, run) => { await killable(run, 5000); return { code: 0 }; };
  const r = await runSidecar({ cmd: 'scenes' }, { startTimeoutMs: 60 });
  assert.equal(r.cancelled, false);
  assert.match(r.error, /sent nothing for 0 s after starting/);
  assert.ok(log.includes('sidecar_cancel'));
});

test('a process killed from outside is reported as killed, not "code null"', async () => {
  script = async (send, run) => { run.killed = false; return { code: null }; };
  const r = await runSidecar({ cmd: 'track' });
  assert.match(r.error, /killed/);
});

// paw-shgb: several tabs share the process; a cancel with an owner (a tab's tracking store) is that owner's only
test("a tab's cancel never stops another tab's run: only its own queued runs drop, the running one is killed only when it is its own", async () => {
  log.length = 0;
  const A = {}, B = {};
  script = async (send, run, req) => { await killable(run, req.cmd === 'track' ? 300 : 10); if (!run.killed) send(JSON.stringify({ type: 'result', cmd: req.cmd })); return { code: 0 }; };
  let started = 0;
  const a = runSidecar({ cmd: 'track' }, { owner: A, onStart: () => { started++; } });
  const b = runSidecar({ cmd: 'list' }, { owner: B });
  await sleep(20);
  assert.equal(started, 1, 'onStart: when the run starts');
  await cancelSidecar(B);   // B's Esc / timeout while A tracks
  assert.equal((await b).cancelled, true, "B's queued run dropped");
  const ra = await a;
  assert.equal(ra.cancelled, false, "A's track not killed");
  assert.equal(ra.result.cmd, 'track');
  assert.ok(!log.includes('sidecar_cancel'), 'nothing was sent to Rust');
  // A's own cancel kills A's run, B's later run goes on
  script = async (send, run, req) => { await killable(run, 300); if (!run.killed) send(JSON.stringify({ type: 'result', cmd: req.cmd })); return { code: 0 }; };
  const a2 = runSidecar({ cmd: 'track' }, { owner: A }), b2 = runSidecar({ cmd: 'describe' }, { owner: B });
  await sleep(20);
  await cancelSidecar(A);
  assert.equal((await a2).cancelled, true);
  const rb = await b2;
  assert.equal(rb.cancelled, false, "B's queued run still runs after A's cancel");
  assert.equal(rb.result.cmd, 'describe');
});

test('each run sends its own id; a cancel names the running one', async () => {
  calls.length = 0;
  const A = {};
  script = async (send, run, req) => { await killable(run, req.cmd === 'track' ? 5000 : 10); if (!run.killed) send('{"type":"result"}'); return { code: 0 }; };
  const a = runSidecar({ cmd: 'track' }, { owner: A }), b = runSidecar({ cmd: 'list' });
  await sleep(20);
  await cancelSidecar(A);
  await Promise.all([a, b]);
  const runs = calls.filter((c) => c.cmd === 'sidecar_run').map((c) => c.args.run);
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => typeof r === 'string' && r), 'every run has an id');
  assert.notEqual(runs[0], runs[1]);
  assert.deepEqual(calls.find((c) => c.cmd === 'sidecar_cancel').args, { run: runs[0] });
  calls.length = 0;
  script = async (send, run) => { await killable(run, 5000); return { code: 0 }; };
  await runSidecar({ cmd: 'scenes' }, { startTimeoutMs: 40 });   // the start timeout's cancel names its run too
  const [r, c] = [calls.find((x) => x.cmd === 'sidecar_run'), calls.find((x) => x.cmd === 'sidecar_cancel')];
  assert.equal(c.args.run, r.args.run);
  calls.length = 0;
  await cancelSidecar();   // nothing running here (a reload's sweep): no id, the shell cancels whatever runs
  assert.deepEqual(calls[0], { cmd: 'sidecar_cancel', args: {} });
});

// paw-1sa9: tab A's cancel is posted as A's run ends, and reaches the shell only after tab B's run has started
async function lateCancel() {
  const A = {}, B = {};
  let finishA, bStarted;
  cancelGate = new Promise((r) => { bStarted = r; });
  script = async (send, run, req) => {
    if (req.cmd === 'track') await new Promise((r) => { finishA = r; });
    else { bStarted(); await killable(run, 100); }
    if (!run.killed) send(JSON.stringify({ type: 'result', cmd: req.cmd }));
    return { code: 0 };
  };
  const a = runSidecar({ cmd: 'track' }, { owner: A }), b = runSidecar({ cmd: 'describe' }, { owner: B });
  while (!finishA) await sleep(5);
  const c = cancelSidecar(A);   // A still runs here: the cancel goes to the shell, which is slow to act on it
  finishA();
  await c;
  cancelGate = null;
  return [await a, await b];
}

test("a cancel aimed at a run that has ended does not touch the next tab's run", async () => {
  shell = 'new';
  const [, rb] = await lateCancel();
  assert.equal(rb.cancelled, false);
  assert.equal(rb.result.cmd, 'describe');
});

test('against a shell without the run argument: runs and cancels work as before', async () => {
  shell = 'old';
  try {
    script = async (send, run, req) => { await killable(run, 5000); if (!run.killed) send(JSON.stringify({ type: 'result', cmd: req.cmd })); return { code: 0 }; };
    const A = {};
    const a = runSidecar({ cmd: 'track' }, { owner: A });
    await sleep(20);
    await cancelSidecar(A);
    assert.equal((await a).cancelled, true, "the old cancel still stops the owner's run");
    script = async (send, run, req) => { send(JSON.stringify({ type: 'result', cmd: req.cmd })); return { code: 0 }; };
    assert.equal((await runSidecar({ cmd: 'list' })).result.cmd, 'list');
    const [, rb] = await lateCancel();   // the residual an old shell keeps: the late cancel reaches the next run
    assert.equal(rb.cancelled, true);
  } finally { shell = 'new'; }
});
