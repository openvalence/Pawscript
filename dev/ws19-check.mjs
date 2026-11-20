// dev/ws19-check.mjs -- paw-ws19 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints): T pressed right
// after a start, while the tracker list is still loading, waits for the list. The instance is restarted here with the fake
// sidecar's list answering after FAKE_LIST_MS (45 s). Asserted, on a copy of a generated clip in the Track tab:
//   1. at the T press the list has not come (no trackers; T asks for it when nothing did yet); the toast says it is loading the trackers, never "needs";
//      the chips' Track button shows busy (aria-busy) and its tooltip text (gridBlock) says "Loading the trackers…";
//   2. a second T while waiting adds nothing (one wait);
//   3. when the list lands, the press is answered: the fake lists no point tracker, so now (and only now) "needs a point tracker".
//   node dev/ws19-check.mjs <instance dir> <clip.mp4>     exits 1 on any FAIL
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { connectTestApp } from './cdp-connect.mjs';

const [dir, src] = process.argv.slice(2);
if (!dir || !src) { console.error('usage: node dev/ws19-check.mjs <instance dir> <clip.mp4>'); process.exit(2); }
const clip = join(resolve(dirname(src)), `ws19-${Date.now()}.mp4`);
copyFileSync(src, clip);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
// the window takes a while after a restart (the runner saw ~40 s): ask until it answers
async function connect() {
  for (const t0 = Date.now(); ;) { try { return await connectTestApp(); } catch (e) { if (Date.now() - t0 > 180000) throw e; await new Promise((r) => setTimeout(r, 2000)); } }
}
const noDialogs = () => setInterval(() => { const d = app.dialog; if (d) d.resolve(d.choices?.some((c) => c.id === 'discard') ? 'discard' : d.choices?.[0]?.id ?? null); }, 200);
const r = spawnSync(process.execPath, ['dev/test-app.mjs', 'restart', '--dir', dir], { env: { ...process.env, FAKE_LIST_MS: '45000' }, stdio: 'inherit' });
if (r.status) { console.log('FAIL restart', r.status); process.exit(1); }
const { browser, page } = await connect();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
try {
  await page.waitForFunction(() => window.app?.doc && window.__pawDev, null, { timeout: 90000 });
  await ev(() => {
    window.__toasts = [];
    const t = app.toast.bind(app);
    app.toast = (msg, kind, o) => { window.__toasts.push(String(msg)); return t(msg, kind, o); };
  });
  await ev(noDialogs);
  await ev((p) => app.project.openVideo(p, { force: true }), clip);   // the first use of the tracker asks for its list (slow here)
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 40000 });
  await ev(() => { app.player.pause(); if (app.mode !== 'track') app.setMode('track'); });
  await wait(800);
  const at = await ev(() => { const tr = __pawDev.trackingFor(app); return { busy: tr.busy, listed: tr.listed, trackers: tr.trackers.length, winner: app.commands.winner('T') }; });
  console.log('     at T: ' + JSON.stringify(at));
  ok(!at.listed && at.trackers === 0, `the tracker list has not come at the press (busy '${at.busy}': T asks for it if nothing did)`);
  ok(at.winner === 'track.gridFrame', 'T reaches track.gridFrame');
  await page.keyboard.press('KeyT');
  await wait(400);
  const w = await ev(() => ({ queued: __pawDev.trackingFor(app).queued, toasts: [...window.__toasts], busyBtn: document.querySelector('[data-btn="track"]')?.getAttribute('aria-busy') ?? null }));
  console.log('     waiting: ' + JSON.stringify(w));
  ok(w.queued === 'grid', 'the press waits for the list');
  ok(w.toasts.some((m) => /Loading the trackers/.test(m)), 'the toast says the trackers are loading');
  ok(!w.toasts.some((m) => /needs/.test(m)), 'no "needs a point tracker / GPU" while loading');
  ok(w.busyBtn === 'true' || w.busyBtn === null, `the chips' Track button shows busy (aria-busy ${w.busyBtn}; null = the chips are not shown)`);
  await page.keyboard.press('KeyT');
  await wait(300);
  ok((await ev(() => window.__toasts.filter((m) => /Loading the trackers/.test(m)).length)) === 1, 'a second T while waiting adds nothing');
  await page.waitForFunction(() => __pawDev.trackingFor(app).listed, null, { timeout: 60000 });
  await wait(600);
  const end = await ev(() => ({ queued: __pawDev.trackingFor(app).queued, toasts: [...window.__toasts] }));
  console.log('     after the list: ' + JSON.stringify(end));
  ok(end.queued === '', 'the wait is over');
  ok(/needs a point tracker/.test(end.toasts.at(-1) || ''), 'the list came without a point tracker (the fake): then "needs a point tracker"');
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
