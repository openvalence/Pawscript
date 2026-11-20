// dev/cancel-run-check.mjs -- paw-1sa9 in the REAL window (your test instance: node dev/test-app.mjs start ...; the CDP_* env it
// prints). Two tabs, a track job in each, in sequence (B queued behind A on the one sidecar): once A has finished and B is
// running, a cancel naming A's run reaches the shell and must leave B alone; B's own cancel then stops B.
//   node dev/cancel-run-check.mjs <a.mp4> <b.mp4>     generated clips only
import { connectTestApp } from './cdp-connect.mjs';

const clips = process.argv.slice(2);
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });

try {
  await page.waitForFunction(() => window.appTabs && window.app?.project && window.__pawDev, null, { timeout: 90000 });
  for (const id of await ev(() => appTabs.list.map((t) => t.id))) await ev((id) => appTabs.appOf(id).project.close(), id);
  for (const c of clips) {
    const n = await ev(() => appTabs.list.length);
    await ev((c) => appTabs.open([c]), c);
    await page.waitForFunction(([c, n]) => appTabs.list.length === n + 1 && app.doc.media?.path === c && app.player.ready, [c, n], { timeout: 60000 });
  }
  const r = await ev(async (clips) => {
    // what goes over the wire: Tauri's IPC is a POST to ipc.localhost/<command> (its invoke is not writable; fetch is)
    const calls = [], ipc = window.__TAURI_INTERNALS__, fetch0 = window.fetch;
    window.fetch = (url, o) => {
      const cmd = String(url).match(/\/(sidecar_\w+)/)?.[1];
      if (cmd) { let run = null; try { run = JSON.parse(o.body).run ?? null; } catch { /* not JSON */ } calls.push({ cmd, run, t: Math.round(performance.now()) }); }
      return fetch0(url, o);
    };
    const [A, B] = appTabs.list.map((t) => window.__pawDev.trackingFor(t.app));
    await A.list();   // the first list's sweep (a cancel of whatever runs) is over before the jobs start
    const req = (video) => ({ cmd: 'track', video, tracker: 'fake.none', start_ms: 0, end_ms: 30000, params: {} });
    let bFrames = 0;
    const pa = A.job('track', req(clips[0])), pb = B.job('track', req(clips[1]), { onFrames: (f) => { bFrames += f.length; } });
    const ra = await pa;
    const runs = calls.filter((c) => c.cmd === 'sidecar_run').map((c) => c.run);
    while (bFrames < 25) await new Promise((res) => setTimeout(res, 20));   // B is running in the shell
    if (runs.length < 2) return { runs, calls };   // nothing to aim at: report what went over the wire
    await ipc.invoke('sidecar_cancel', { run: runs.at(-2) });   // aimed at A, which has finished
    const atCancel = bFrames, rb = await pb;
    // B's own cancel (its tab's Esc) stops B's next track
    let cFrames = 0;
    const pc = B.job('track', req(clips[1]), { onFrames: (f) => { cFrames += f.length; } });
    while (cFrames < 25) await new Promise((res) => setTimeout(res, 20));
    B.cancel();
    const rc = await pc;
    return { runs, atCancel, bFrames, ra: { error: ra.error, cancelled: ra.cancelled, result: !!ra.result }, rb: { error: rb.error, cancelled: rb.cancelled, result: !!rb.result },
      rc: { cancelled: rc.cancelled, error: rc.error }, cRun: calls.filter((c) => c.cmd === 'sidecar_run').at(-1).run, cancels: calls.filter((c) => c.cmd === 'sidecar_cancel'), aBusy: A.busy };
  }, clips);
  console.log(JSON.stringify(r));
  ok(r.runs.length >= 2 && new Set(r.runs).size === r.runs.length && r.runs.every(Boolean), `every run sent its own id (${r.runs.length} runs)`);
  ok(!r.ra.error && !r.ra.cancelled && r.ra.result, 'A tracked to its result');
  ok(r.rb.result && !r.rb.cancelled && !r.rb.error, `a cancel naming A's run, sent while B ran (B at ${r.atCancel} frames), left B alone: B tracked on to its result (${r.bFrames} frames)`);
  ok(r.rc.cancelled, "B's own cancel (with B's id) stopped B's next track");
  ok(r.cancels.at(-1)?.run === r.cRun, "that cancel named B's run");
} catch (e) { fails++; console.log('FAIL', e.message); }
await browser.close().catch(() => {});
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
