// dev/tabs-leak.mjs -- paw-shgb: is a closed (or parked) document's memory given back? In YOUR test instance (CDP_* env): a
// generated project with one synthetic run opens in a tab, then closes (or, with --park and a second tab shown, is parked);
// after a full GC a WeakRef to its run says whether anything still holds it. With --snapshot <file>: the heap snapshot, for
// the retaining path (a small heap: one 60-frame run).
//   node dev/tabs-leak.mjs <clip.mp4> [<other.mp4> --park] [--snapshot <out.heapsnapshot>]
import { createWriteStream, writeFileSync, existsSync, rmSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
import { encodeRuns } from '../src/lib/runs-file.js';
import { synthRuns } from './perf/synth-runs.mjs';

const args = process.argv.slice(2), clip = args[0], park = args.includes('--park'), other = park ? args[1] : null;
const snap = args.includes('--snapshot') ? args[args.indexOf('--snapshot') + 1] : null;
const stem = clip.replace(/\.[^.]+$/, '');
writeFileSync(stem + '.pawproj', JSON.stringify({ format: 'pawproj', version: 3, media: { path: clip, name: clip.split(/[\/]/).pop(), durationMs: 40000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100]] }, scenes: [{ start_ms: 0, end_ms: 40000 }] }));
writeFileSync(stem + '.pawruns', encodeRuns(synthRuns({ runs: 1, frames: 60, points: 1024 })));
const { browser, page } = await connectTestApp();
try {
  await page.evaluate(async () => { await appTabs.closeAll({ quit: true }); localStorage.setItem('pawscript.resume', JSON.stringify({ docs: {}, open: [], active: null, last: null })); });
  await page.reload();
  await page.waitForFunction(() => window.appTabs?.restored && window.__pawDev, null, { timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); await cdp.send('HeapProfiler.collectGarbage'); };
  await page.evaluate((p) => appTabs.open([p]), stem + '.pawproj');
  await page.waitForFunction(() => app.player.ready && __pawDev.trackingFor(app).runs.length === 1, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const r = __pawDev.trackingFor(app).runs[0]; r.__MARK__ = 'run'; window.__w = { run: new WeakRef(r), app: new WeakRef(app), id: app.tabId }; });
  if (park) {
    await page.evaluate((p) => appTabs.open([p]), other);
    await page.waitForFunction(() => appTabs.list.length === 2 && app.player.ready, null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    console.log('parked:', await page.evaluate(() => appTabs.park(appTabs.appOf(__w.id))));
  } else await page.evaluate(() => app.project.close());
  await page.waitForTimeout(3000);
  await gc();
  const r = await page.evaluate(() => ({ run: !!__w.run.deref(), app: !!__w.app.deref() }));
  console.log(`after ${park ? 'parking' : 'closing'}: run held ${r.run}, app held ${r.app}`);
  if (r.run && snap) {
    const out = createWriteStream(snap);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => out.write(e.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    await new Promise((res) => out.end(res));
  }
  process.exitCode = r.run ? 1 : 0;
} finally {
  await browser.close().catch(() => {});
  for (const f of ['.pawproj', '.pawruns']) if (existsSync(stem + f)) rmSync(stem + f);
  if (existsSync(stem + '.pawhistory')) rmSync(stem + '.pawhistory', { recursive: true });
}
