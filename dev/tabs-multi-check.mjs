// dev/tabs-multi-check.mjs -- paw-shgb stage 2 (several projects open as tabs) in the REAL window: your test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints). Generated clips only (ffmpeg testsrc2).
//   node dev/tabs-multi-check.mjs open <a.mp4> <b.mp4> <c.mp4>   open three as tabs, edit / move the playhead / zoom / select in two, switch
//                                                        by clicking the tabs and assert each tab's playhead, view, selection, undo,
//                                                        mode and the picture; Space plays only the shown one; close the third with
//                                                        its x; then the window closes as the owner's would (every tab written)
//   node dev/tabs-multi-check.mjs back <a.mp4> <b.mp4>          after a restart of the same instance (--id): the two tabs are back, in order,
//                                                        the one shown at quit shown, each where it was: its playhead and view as
//                                                        painted (the ruler row's picture as at quit, the video at the playhead)
//   node dev/tabs-multi-check.mjs restart <dir> <a.mp4> <b.mp4> <c.mp4>   open, then node dev/test-app.mjs restart --dir <dir> (the
//                                                        instance started there), then back: the whole journey in one line (paw-hoxz)
//   node dev/tabs-multi-check.mjs perf <a.mp4> <b.mp4> <c.mp4>  frame times while playing 8 s with 1 tab open, then with 3
//   node dev/tabs-multi-check.mjs mem <a.mp4> ... <d.mp4>       JS heap (after a GC) and the instance's WebView2 working set with 1, 2, 4
//                                                        generated projects open (each with synthetic runs: dev/perf/synth-runs.mjs)
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, ...clips] = process.argv.slice(2);
if (phase === 'restart') {
  const [dir, ...cs] = clips;
  const self = (...a) => spawnSync(process.execPath, [process.argv[1], ...a], { stdio: 'inherit', windowsHide: true }).status;
  if (self('open', ...cs)) process.exit(1);
  const r = spawnSync(process.execPath, ['dev/test-app.mjs', 'restart', '--dir', dir], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(r.stdout + r.stderr);
  if (r.status) process.exit(1);
  // the window again (the shell is compiled already): the page with this instance's id stamped
  const { CDP_PORT: port, CDP_EXPECT_URL: url, CDP_TEST_ID: id } = process.env, until = Date.now() + 5 * 60e3;
  let up = false;
  while (!up && Date.now() < until) {
    try {
      const b = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 3000 });
      const p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().startsWith(url));
      up = !!p && (await p.evaluate(() => window.__pawscriptTestId).catch(() => null)) === id;
      await b.close();
    } catch { /* not listening yet */ }
    if (!up) await new Promise((ok) => setTimeout(ok, 1000));
  }
  if (!up) { console.log('FAIL the window did not come back after the restart'); process.exit(1); }
  process.exit(self('back', cs[0], cs[1]) ? 1 : 0);
}
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); return c; };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 400)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 400)); } });
const settle = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))));
const stem = (p) => p.replace(/\.[^.]+$/, '');
const clean = (c) => { for (const f of ['.pawproj', '.funscript', '.pawruns']) if (existsSync(stem(c) + f)) rmSync(stem(c) + f); if (existsSync(stem(c) + '.pawhistory')) rmSync(stem(c) + '.pawhistory', { recursive: true }); };
/** The shown tab's state, from its app and from what is painted (the <video> element's source and time, the editor's tab). */
const shownState = () => ev(() => {
  const a = app, v = document.querySelector('[data-testid=editor] video');
  return { tab: a.tabId, file: a.doc.media?.name, t: Math.round(a.player.displayMs ?? a.player.timeMs), view: { start: Math.round(a.view.start), span: Math.round(a.view.span) },
    mode: a.mode, sel: [...a.doc.selection.ats].sort((x, y) => x - y), undo: a.history.entries.length, stroke: (a.doc.axes.stroke || []).length,
    paintedTab: document.querySelector('[data-testid=editor]')?.dataset.tab, videoSrc: decodeURIComponent(v?.currentSrc || v?.src || ''), videoT: v ? Math.round(v.currentTime * 1000) : null,
    activeTab: document.querySelector('[data-testid=tab-doc].on')?.dataset.tabId };
});
const openTab = async (c) => {
  const n = await ev(() => appTabs.list.length);
  await ev((c) => appTabs.open([c]), c);
  await page.waitForFunction(([c, n]) => appTabs.list.length === n + 1 && app.doc.media?.path === c && app.player.ready, [c, n], { timeout: 60000 });
  await settle();
};
const clickTab = async (id) => { await page.click(`[data-tab-id="${id}"] .go`); await page.waitForFunction((id) => app.tabId === id && app.player.ready, id, { timeout: 30000 }); await settle(); };
const name = (c) => c.split(/[\\/]/).pop();
/** The ruler row as painted (its ticks and labels follow the view, the playhead line sits on it): a PNG, base64. */
const rulerPng = async () => {
  const clip = await ev(() => { const b = document.querySelector('[data-tl-lane=ruler]').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  return (await page.screenshot({ clip })).toString('base64');
};
/** Share of pixels that differ between two PNGs (1 when their sizes differ). */
const pxDiff = (a, b) => ev(async ([a, b]) => {
  const dec = async (s) => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return x.getImageData(0, 0, bmp.width, bmp.height); };
  const [A, B] = [await dec(a), await dec(b)];
  if (A.width !== B.width || A.height !== B.height) return 1;
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 30) n++;
  return n / (A.width * A.height);
}, [a, b]);
const atPlayhead = (t) => page.waitForFunction((t) => { const v = document.querySelector('[data-testid=editor] video'); return v && v.readyState >= 2 && Math.abs(v.currentTime * 1000 - t) < 60; }, t, { timeout: 10000 }).then(() => true, () => false);

try {
  await page.waitForFunction(() => window.appTabs && window.app?.project, null, { timeout: 90000 });
  if (phase === 'open') {
    for (const c of clips) clean(c);
    for (const a of await ev(() => appTabs.list.map((t) => t.id))) { await ev((id) => appTabs.appOf(id).project.close(), a); await wait(100); }
    await ev(() => { window.__asked = []; for (const a of appTabs.apps) { const c = a.choose.bind(a); a.choose = (o) => { window.__asked.push(o?.title || '?'); return c(o); }; } });
    // A: refine, four points by keys, playhead 3000, zoom, select two
    await openTab(clips[0]);
    const A = await ev(() => app.tabId);
    await ev(() => app.setMode('refine')); await settle();
    for (const [ms, key] of [[1000, '0'], [1500, '9'], [2000, '1'], [2600, '8']]) { await ev((ms) => app.player.seek(ms, { exact: true }), ms); await wait(150); await page.keyboard.press('Numpad' + key); }   // paw-5zpf: NumPad digits place points (the number row picks the selection mode)
    await ev(() => { app.player.seek(3000, { exact: true }); app.setView({ start: 500, span: 6000 }); app.select([1500, 2000]); });
    await settle();
    const sa = await shownState();
    // B: track tab, two points, playhead 7000, another zoom, select one
    await openTab(clips[1]);
    const B = await ev(() => app.tabId);
    ok(B !== A, `B opened in a tab of its own (${A}, ${B})`);
    await ev(() => app.setMode('refine')); await settle();
    for (const [ms, key] of [[5000, '2'], [5500, '7']]) { await ev((ms) => app.player.seek(ms, { exact: true }), ms); await wait(150); await page.keyboard.press('Numpad' + key); }   // paw-5zpf: NumPad digits place points (the number row picks the selection mode)
    await ev(() => { app.setMode('track'); app.player.seek(7000, { exact: true }); app.setView({ start: 4000, span: 12000 }); app.select([5500]); });
    await settle();
    const sb = await shownState();
    ok(sa.stroke === 4 && sb.stroke === 2, `A has its 4 points, B its 2 (${sa.stroke}, ${sb.stroke})`);
    await openTab(clips[2]);
    const C = await ev(() => app.tabId);
    ok((await ev(() => appTabs.list.length)) === 3, 'three tabs');
    ok((await page.locator('[data-testid=tab-doc]').count()) === 3, 'three tabs painted in the top bar');
    // switch back and forth by clicking the tabs
    for (let k = 0; k < 3; k++) for (const [id, want, nm] of [[A, sa, 'A'], [B, sb, 'B']]) {
      const t0 = Date.now();
      await clickTab(id);
      const ms = Date.now() - t0, s = await shownState();
      const same = s.t === want.t && s.view.start === want.view.start && s.view.span === want.view.span && s.mode === want.mode && JSON.stringify(s.sel) === JSON.stringify(want.sel) && s.undo === want.undo && s.stroke === want.stroke;
      ok(same, `${nm} round ${k + 1}: playhead ${s.t}, view ${s.view.start}+${s.view.span}, mode ${s.mode}, selection ${s.sel}, undo ${s.undo} as left (${ms} ms to switch)`);
      ok(s.paintedTab === id && s.activeTab === id && s.videoSrc.includes(name(clips[nm === 'A' ? 0 : 1])), `${nm}: its editor, its tab lit, its video painted (${s.videoSrc.split('/').pop()})`);
      if (!ok(await atPlayhead(want.t), `${nm}: the picture is at its playhead`)) console.log('     player:', JSON.stringify(await ev(() => { const p = app.player, v = document.querySelector('[data-testid=editor] video'); return { timeMs: p.timeMs, cur: v && Math.round(v.currentTime * 1000), ready: v?.readyState, seeking: p.seeking, elSeeking: v?.seeking, scrubbing: p.scrubbing, cache: p.scrubCache?.state, src: v?.currentSrc?.split('/').pop(), stats: p.stats }; })));
    }
    // undo in A undoes A's last point only
    await clickTab(A);
    await page.keyboard.press('Control+z'); await settle();
    const ua = await ev(() => app.doc.axes.stroke.length), ub = await ev((id) => appTabs.appOf(id).doc.axes.stroke.length, B);
    ok(ua === 3 && ub === 2, `Ctrl+Z in A: A 3 points, B still 2 (${ua}, ${ub})`);
    await page.keyboard.press('Control+y'); await settle();
    // Space plays only the shown tab
    const tB = await ev((id) => appTabs.appOf(id).player.timeMs, B), tC = await ev((id) => appTabs.appOf(id).player.timeMs, C);
    await page.keyboard.press('Space');
    await wait(1200);
    const play = await ev(([b, c]) => ({ a: app.player.playing, at: app.player.timeMs, b: appTabs.appOf(b).player.playing, bt: appTabs.appOf(b).player.timeMs, c: appTabs.appOf(c).player.playing, ct: appTabs.appOf(c).player.timeMs,
      videos: document.querySelectorAll('video').length, playingVideos: [...document.querySelectorAll('video')].filter((v) => !v.paused).length }), [B, C]);
    ok(play.a && !play.b && !play.c && play.bt === tB && play.ct === tC, `Space: A plays (${Math.round(play.at)} ms), B and C do not move (${Math.round(play.bt)}, ${Math.round(play.ct)})`);
    ok(play.playingVideos === 1, `one <video> plays in the window (${play.playingVideos} of ${play.videos})`);
    await clickTab(B);
    ok(!(await ev((a) => appTabs.appOf(a).player.playing, A)), 'switching away paused A');
    // close C with its x
    await page.hover(`[data-tab-id="${C}"]`);
    await page.click(`[data-tab-id="${C}"] [data-testid=tab-close]`);
    await page.waitForFunction(() => appTabs.list.length === 2, null, { timeout: 15000 });
    ok((await ev(() => appTabs.list.map((t) => t.app.doc.media.name))).join() === [name(clips[0]), name(clips[1])].join(), 'C closed: A and B left, in order');
    ok((await ev(() => app.tabId)) === B, 'closing a background tab keeps the shown one');
    // each tab as it is at quit (A played on and had an undo / redo since), with its ruler row as painted
    const atQuit = (id) => ev((id) => { const a = appTabs.appOf(id); return { t: Math.round(a.player.displayMs ?? a.player.timeMs), view: { start: Math.round(a.view.start), span: Math.round(a.view.span) }, sel: [...a.doc.selection.ats].sort((x, y) => x - y),
      raw: { timeMs: a.player.timeMs, displayMs: a.player.displayMs, heldFrame: a.player.heldFrame, start: a.view.start, span: a.view.span } }; }, id);
    await clickTab(A);
    const qa = { ...(await atQuit(A)), ruler: await rulerPng() };
    await clickTab(B);   // B shown at quit
    const qb = { ...(await atQuit(B)), ruler: await rulerPng() };
    ok((await pxDiff(qa.ruler, qb.ruler)) > 0.002, 'A and B paint different ruler rows (their own view and playhead)');
    await wait(1500);    // the continuous write and the resume tick
    ok((await ev(() => window.__asked.length)) === 0, 'no dialog at any point: ' + (await ev(() => window.__asked.join(' | '))));
    writeFileSync(stem(clips[0]) + '.tabs-check.json', JSON.stringify({ A: qa, B: qb }));
    // the window closes as the owner's would: every tab written, then the window goes
    await ev(() => appTabs.closeAll({ quit: true }));
    await ev(() => { setTimeout(() => app.backend.windowCloseNow(), 50); });
  } else if (phase === 'back') {
    const want = JSON.parse(readFileSync(stem(clips[0]) + '.tabs-check.json', 'utf8'));
    await page.waitForFunction(() => window.appTabs?.restored, null, { timeout: 60000 });
    // paw-hoxz: the same instance id keeps its page origin, so the resume store is still there (no hand carry-over)
    // paw-a82t (46aa474): a start-up reopen still marked "opening" at the next start is not reopened (a crash loop guard): a
    // mark left here means the page was stopped or reloaded within 5 s of the reopen (dev/check-all.mjs waits for the marks)
    console.log('     open-guard marks after the restart: ' + (await ev(() => `${localStorage.getItem('pawscript.opening') || 'none'} (now ${Date.now()})`)));
    const store = JSON.parse((await ev(() => localStorage.getItem('pawscript.resume'))) || '{}');
    ok((store.open || []).length === 2, `the resume store survived the restart (${(store.open || []).length} open tabs in it)`);
    await page.waitForFunction(() => appTabs.restored && appTabs.list.length >= 2 && app.player.ready, null, { timeout: 60000 }).catch(() => {});
    await settle();
    const l = await ev(() => appTabs.list.map((t) => ({ id: t.id, file: appTabs.nameOf(t.app), parked: !!t.parked })));
    const base = (f) => f.replace(/\.[^.]+$/, '');
    ok(l.map((x) => base(x.file)).join() === [base(name(clips[0])), base(name(clips[1]))].join(), 'both tabs back, in order: ' + l.map((x) => x.file + (x.parked ? ' (parked: opens when shown)' : '')).join(', '));
    ok((await page.locator('[data-testid=tab-doc]').count()) === 2, 'two tabs painted');
    /** The ruler row against the one at quit; on a difference both pictures go beside the clip and the raw player state is printed. */
    const rulerSame = async (nm, w) => {
      const png = await rulerPng(), d = await pxDiff(png, w.ruler);
      ok(d < 0.002, `${nm}: the ruler row painted as at quit (${(d * 100).toFixed(2)} % pixels differ)`);
      if (d >= 0.002) {
        writeFileSync(`${stem(clips[0])}.ruler-${nm}-quit.png`, Buffer.from(w.ruler, 'base64'));
        writeFileSync(`${stem(clips[0])}.ruler-${nm}-back.png`, Buffer.from(png, 'base64'));
        console.log(`     ${nm} at quit ${JSON.stringify(w.raw)}, now ${JSON.stringify(await ev(() => ({ timeMs: app.player.timeMs, displayMs: app.player.displayMs, heldFrame: app.player.heldFrame, start: app.view.start, span: app.view.span })))}`);
      }
    };
    if (l.length === 2) {
      const s = await shownState();
      ok(s.file === name(clips[1]) && s.paintedTab === l[1].id && s.activeTab === l[1].id, `the tab shown at quit (B) shows, its tab lit (${s.file})`);
      ok(s.t === want.B.t && s.view.start === want.B.view.start && s.view.span === want.B.view.span && JSON.stringify(s.sel) === JSON.stringify(want.B.sel), `B where it was: ${s.t} ms, view ${s.view.start}+${s.view.span}, selection ${s.sel} (at quit ${want.B.t}, ${want.B.view.start}+${want.B.view.span})`);
      ok(await atPlayhead(want.B.t), 'B: the picture is at its playhead');
      await rulerSame('B', want.B);
      await clickTab(l[0].id);
      const a = await shownState();
      ok(a.t === want.A.t && a.view.start === want.A.view.start && a.view.span === want.A.view.span && JSON.stringify(a.sel) === JSON.stringify(want.A.sel), `A where it was: ${a.t} ms, view ${a.view.start}+${a.view.span}, selection ${a.sel} (at quit ${want.A.t}, ${want.A.view.start}+${want.A.view.span})`);
      ok(await atPlayhead(want.A.t), 'A: the picture is at its playhead');
      await rulerSame('A', want.A);
    }
  } else if (phase === 'perf') {
    for (const a of await ev(() => appTabs.list.map((t) => t.id))) { await ev((id) => appTabs.appOf(id).project.close(), a); await wait(100); }
    const play = async (label) => {
      await ev(() => app.player.seek(1000));
      await wait(800);
      const r = await ev(() => new Promise((res) => {
        const v = document.querySelector('[data-testid=editor] video'), q0 = v.getVideoPlaybackQuality(), d = [];
        let last = performance.now(), long = 0;
        const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long += e.duration; });
        try { po.observe({ type: 'longtask', buffered: false }); } catch { /* no long tasks */ }
        const tick = (t) => { d.push(t - last); last = t; if (d.length < 1e5 && performance.now() - t0 < 8000) requestAnimationFrame(tick); else done(); };
        const t0 = performance.now();
        const done = () => { app.player.pause(); po.disconnect(); const q = v.getVideoPlaybackQuality(); d.sort((a, b) => a - b); const pc = (p) => +d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1);
          res({ frames: d.length, p50: pc(0.5), p95: pc(0.95), p99: pc(0.99), max: +d[d.length - 1].toFixed(1), over25: d.filter((x) => x > 25).length, longMs: Math.round(long), dropped: q.droppedVideoFrames - q0.droppedVideoFrames, presented: q.totalVideoFrames - q0.totalVideoFrames }); };
        app.player.play(); requestAnimationFrame(tick);
      }));
      console.log(`perf ${label}: ${JSON.stringify(r)}`);
      return r;
    };
    await openTab(clips[0]);
    const one = await play('1 tab');
    await openTab(clips[1]); await openTab(clips[2]);
    await clickTab(await ev(() => appTabs.list[0].id));
    const three = await play('3 tabs');
    // a switch: from the call to the other tab's editor painted with its picture (and the longest task meanwhile)
    const ids = await ev(() => appTabs.list.map((t) => t.id)), sw = [];
    for (let k = 0; k < 6; k++) {
      const id = ids[(k + 1) % ids.length];
      sw.push(await ev((id) => new Promise((res) => {
        let long = 0; const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long = Math.max(long, e.duration); });
        try { po.observe({ type: 'longtask' }); } catch { /* none */ }
        const t0 = performance.now(); appTabs.show(id);
        const check = () => { const ed = document.querySelector('[data-testid=editor]'), v = ed?.querySelector('video'); if (ed?.dataset.tab === id && v && v.readyState >= 2) { const ms = performance.now() - t0; requestAnimationFrame(() => { po.disconnect(); res({ ms: Math.round(ms), longest: Math.round(long) }); }); } else requestAnimationFrame(check); };
        requestAnimationFrame(check);
      }), id));
      await wait(400);
    }
    console.log('switch to a tab, painted with its picture (ms):', JSON.stringify(sw));
    ok(three.p95 <= one.p95 + 4 && three.dropped <= one.dropped + 3, `frame times with 3 tabs open match 1 tab (p95 ${one.p95} -> ${three.p95} ms, dropped ${one.dropped} -> ${three.dropped})`);
  } else if (phase === 'mem') {
    // generated projects with runs: <clip>.pawproj + .pawruns (synthetic, dev/perf/synth-runs.mjs), written here
    const { encodeRuns } = await import('../src/lib/runs-file.js'), { synthRuns } = await import('./perf/synth-runs.mjs');
    for (const a of await ev(() => appTabs.list.map((t) => t.id))) { await ev((id) => appTabs.appOf(id).project.close(), a); await wait(100); }
    let mb = 0;
    for (const c of clips) {
      clean(c);
      writeFileSync(stem(c) + '.pawproj', JSON.stringify({ format: 'pawproj', version: 3, media: { path: c, name: name(c), durationMs: 40000, fps: 30 }, axes: { stroke: [[1000, 0], [1500, 100]] }, scenes: [{ start_ms: 0, end_ms: 40000 }] }));
      const bytes = encodeRuns(synthRuns({ runs: 4, frames: 300, points: 1024 }));
      writeFileSync(stem(c) + '.pawruns', bytes);
      mb = bytes.length / 1e6;
    }
    console.log(`each project: 4 runs x 300 frames x 1024 points (.pawruns ${mb.toFixed(1)} MB)`);
    const cdp = await page.context().newCDPSession(page);
    const id = process.env.CDP_TEST_ID;
    const ws = () => { try { return Math.round(+execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${id}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum`], { encoding: 'utf8', windowsHide: true }).trim() / 2 ** 20); } catch { return null; } };
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await wait(300); const h = await cdp.send('Runtime.getHeapUsage'); return Math.round(h.usedSize / 2 ** 20); };
    const out = [];
    const note = async (n) => { await wait(2500); out.push({ open: n, heapMB: await heap(), webview2MB: ws() }); console.log(`mem ${n} open: ${JSON.stringify(out.at(-1))}`); };
    await note(0);
    for (let k = 0; k < clips.length; k++) {
      await ev((p) => appTabs.open([p]), stem(clips[k]) + '.pawproj');
      await page.waitForFunction((n) => appTabs.list.length === n && app.player.ready, k + 1, { timeout: 60000 });
      await page.waitForFunction(() => (window.__pawDev?.trackingFor(app).runs.length || 0) >= 4, null, { timeout: 60000 }).catch(() => console.log('(runs not seen)'));
      if ([1, 2, 4].includes(k + 1)) await note(k + 1);
    }
    // the policy at work: a budget under one project's runs parks every hidden tab (the default, 1200 MB, keeps these four in memory)
    const est = await ev(() => appTabs.list.map((t) => t.app.heavyMB?.() ?? null));
    console.log('estimated runs MB per tab (tabs.memoryMB budget input):', JSON.stringify(est));
    await ev(async () => { app.settings.set('tabs.memoryMB', 100); await appTabs.budget(); });
    await page.waitForFunction(() => Object.keys(appTabs.parked).length === 3, null, { timeout: 30000 }).catch(() => {});
    out.push({ open: 4, parked: await ev(() => Object.keys(appTabs.parked).length), heapMB: await heap(), webview2MB: (await wait(2500), ws()) });
    console.log(`mem 4 open, 3 parked: ${JSON.stringify(out.at(-1))}`);
    const t0 = Date.now();
    await ev(() => appTabs.show(appTabs.list[0].id));
    await page.waitForFunction(() => app.tabId === appTabs.list[0].id && app.player.ready && (window.__pawDev?.trackingFor(app).runs.length || 0) >= 4, null, { timeout: 60000 });
    console.log(`a parked tab shown: open again with its runs in ${Date.now() - t0} ms`);
    await ev(() => app.settings.set('tabs.memoryMB', null));
    for (const c of clips) clean(c);
    writeFileSync(stem(clips[0]) + '.tabs-mem.json', JSON.stringify(out));
  }
} finally {
  console.log(fails ? `${fails} FAILED` : 'all ok');
  await browser.close().catch(() => {});
  process.exitCode = fails ? 1 : 0;
}
