// dev/proxy-check.mjs -- paw-nydn: a proxy of any video, in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it
// prints). Real clicks on the transport's proxy button and menu, real ffmpeg; what is PAINTED is read back: the clip's frames carry
// their own index as 10 bars across the middle (bit i = bar i, white = 1), read from a screenshot of the <video>.
//   make     (fresh instance) on a playable 1080p clip: the control is there ("Original"); 720p started and cancelled mid-way (the
//            status bar task, a frame step while it runs) leaves the original playing; on frame 137 make 480p: the player switches
//            to it on the same frame number, same time, same painted index (and one step on); back to the original; to the proxy
//            again without a new transcode (paw-mh1a: the scrub cache follows the file playing: the proxy's is built from it,
//            the exact-frame stills from both caches show the same picture number for the same frame, hover scrub decodes the
//            proxy's, switching back and forth fetches both caches without a rebuild; their sizes); another video, then this one again: the proxy comes back by itself; the usage lines.
//   restart  (the same --id after a restart) the clip opens on its proxy; the media cache cleared: it opens on the original,
//            silently, with the offer to make the 480p proxy again.
//   cache    (paw-mh1a; needs the shell WITH the media-cache Rust patch, a fresh instance) cache limit 0.5 GB: two 20 s noisy
//            1080p clips whose full scrub caches pass the limit are made smaller ('scrub-<h>.mp4'; the dialog says so); opening
//            the second evicts the least recently used entries of the others (usage lines media:evicted), never its own; a
//            1080p proxy of it (its scrub cache too) evicts nothing of the open video even over the limit; the proxy's ffmpeg
//            runs below-normal with -threads <= 8 while the scrub cache's does not (start that instance at normal priority).
//   node dev/proxy-check.mjs make|restart|cache <dir for the generated clips>        exits 1 on any FAIL
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { connectTestApp } from './cdp-connect.mjs';

const [phase, dir] = process.argv.slice(2);
if (!['make', 'restart', 'cache'].includes(phase) || !dir) { console.error('usage: node dev/proxy-check.mjs make|restart|cache <clip dir>'); process.exit(2); }
mkdirSync(dir, { recursive: true });
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ffmpeg inherits it */ }
const clip = join(dir, 'proxy-index-1080.mp4'), other = join(dir, 'proxy-other.mp4');
const ff = (a) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit', windowsHide: true }); if (r.status) process.exit(1); };
if (!existsSync(clip)) {
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=40', '-f', 'lavfi', '-i', "color=c=black:s=1920x200:r=30:d=40,format=gray,geq=lum='255*mod(floor(N/pow(2\\,floor(X*10/W)))\\,2)',format=yuv420p",
    '-f', 'lavfi', '-i', 'sine=f=440:d=40', '-filter_complex', '[0:v][1:v]overlay=0:440[v]', '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '4', '-c:a', 'aac', '-shortest', clip]);
}
if (!existsSync(other)) ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=5', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-threads', '4', other]);

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver loop|Failed to load resource/.test(m.text())) { fails++; console.log('FAIL [console.error]', m.text().slice(0, 300)); } });

const open = async (p) => {
  await ev(async (p) => { app.dialog?.resolve?.('discard'); await app.project.openVideo(p, { force: true }); }, p);
  await page.waitForFunction((p) => app.doc.media?.path === p && app.player.ready && app.player.vw > 0, p, { timeout: 60000 });
  await wait(600);
};
const state = () => ev(() => ({ h: app.player.proxyH, path: app.player.media?.path, proxyOf: app.player.media?.proxyOf || null, frame: app.player.frame, timeMs: app.player.timeMs,
  vw: app.player.vw, vh: app.player.vh, err: app.player.error?.message || null, job: app.player.proxyJob, lost: app.player.proxyLost, made: Object.keys(app.player.proxies),
  el: app.player.el ? Math.round(app.player.el.currentTime * 1000 - app.player.startMs) : null, tasks: app.tasks.map((t) => t.label) }));
const label = () => ev(() => document.querySelector('[data-testid="proxy-menu"]')?.getAttribute('aria-label') || null);
async function painted() {
  const r = await ev(() => { const q = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const png = (await page.screenshot({ clip: { x: Math.floor(r.x), y: Math.floor(r.y + r.h / 2) - 2, width: Math.floor(r.w), height: 4 }, scale: 'css' })).toString('base64');
  return ev(async (png) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const row = x.getImageData(0, 2, bmp.width, 1).data; let n = 0;
    for (let i = 0; i < 10; i++) { const k = Math.floor((i + 0.5) * bmp.width / 10) * 4; if (row[k] > 128) n |= 1 << i; }
    return n;
  }, png);
}
const goFrame = async (k) => { await ev((k) => { app.player.pause(); app.player.seekFrame(k); }, k); await page.waitForFunction((k) => app.player.frame === k && !app.player.seeking, k, { timeout: 15000 }); await wait(400); };
/** Open the proxy menu with a real click and click the item whose text starts with `text`. */
async function pick(text) {
  await page.click('[data-testid="proxy-menu"]');
  const item = page.locator('[role="menu"] [role^="menuitem"]', { hasText: new RegExp('^\\s*' + text.replace(/[()]/g, '\\$&')) }).first();   // the item that starts with it
  await item.waitFor({ timeout: 5000 });
  const t = (await item.innerText()).trim();
  await item.click();
  await wait(200);
  return t;
}
/** The picture number painted in still(n) (the scrub cache's own decoder when it is ready), for each n. */
const stillNums = (ns) => ev(async (ns) => {
  const out = [];
  for (const n of ns) {
    const b = await app.player.still(n, 240);
    if (!b) { out.push(null); continue; }
    const c = new OffscreenCanvas(b.width, b.height), x = c.getContext('2d'); x.drawImage(b, 0, 0);
    const row = x.getImageData(0, Math.floor(b.height / 2), b.width, 1).data; let v = 0;
    for (let i = 0; i < 10; i++) { const k = Math.floor((i + 0.5) * b.width / 10) * 4; if (row[k] > 128) v |= 1 << i; }
    out.push(v);
  }
  return out;
}, ns);
const cacheReady = (ms = 120000) => page.waitForFunction(() => app.player.scrubCache?.state === 'ready' && app.player.scrubCache.src === app.player.media?.path, null, { timeout: ms, polling: 100 });
const cacheInfo = () => ev(async () => { const sc = app.player.scrubCache; const st = await app.backend.stat(sc.path).catch(() => null); return { src: sc.src.split(/[\\/]/).slice(-2).join('/'), mb: st ? +(st.size / 2 ** 20).toFixed(1) : null }; });
const hoverStats = async () => { await ev(() => { app.player.pause(); app.player.scrub(app.player.timeOfFrame(300)); }); await wait(400); await ev(() => app.player.scrub(app.player.timeOfFrame(305))); await wait(600); await ev(() => app.player.scrubEnd()); await wait(400); return ev(() => app.player.scrubStats); };
const FR = [0, 137, 611, 1000, 1023];   // the bars hold 10 bits
const menuTexts = async () => { await page.click('[data-testid="proxy-menu"]'); await wait(250); const t = await page.locator('[role="menu"] [role^="menuitem"]').allInnerTexts(); await page.keyboard.press('Escape'); await wait(200); return t.map((s) => s.trim().replace(/\s+/g, ' ')); };

/** The app's ffmpeg processes now: {proxy, priority (Win32 base priority: 8 normal, 6 below normal), threads}. */
const ffmpegs = (root) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | ForEach-Object { '' + $_.Priority + '|' + $_.CommandLine }"], { encoding: 'utf8', windowsHide: true });
  return String(r.stdout).split(/\r?\n/).filter((l) => l.includes(root)).map((l) => {   // this instance's jobs: they write into its media cache
    const [pr, cmd] = [l.slice(0, l.indexOf('|')), l.slice(l.indexOf('|') + 1)];
    // which job: by its output (the last argument)
    return { proxy: /proxy\.mp4"?\s*$/.test(cmd), scrub: /scrub[-\d]*\.mp4"?\s*$/.test(cmd), priority: +pr, threads: [...cmd.matchAll(/-threads (\d+)/g)].map((m) => +m[1]) };
  });
};

if (phase === 'cache') {
  const noisy = (n, d) => { const f = join(dir, `noisy-${n}-${d}s.mp4`); if (!existsSync(f)) ff(['-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=30:d=${d},noise=alls=30:allf=t+u:all_seed=${n}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-threads', '4', f]); return f; };
  const [A, B] = [noisy(1, 45), noisy(2, 20)];   // A's full scrub cache ~600 MB (over 0.5 GB), B's ~270 MB
  const info = await ev(async () => { app.settings.set('media.cacheGb', 0.5); return app.player.setCacheLimit(0.5); });
  console.log('cache limit:', JSON.stringify(info && { mb: Math.round(info.limit / 2 ** 20), usedMb: Math.round(info.bytes / 2 ** 20) }));
  await open(clip); await cacheReady();
  const xPath = await ev(() => app.player.scrubCache.path);
  await open(A); await cacheReady(240000);
  let sc = await ev(() => app.player.scrubCache);
  const aPath = sc.path;
  ok(sc.h > 0 && sc.h < 1080, `clip A: its full scrub cache would pass 0.5 GB: made at ${sc.h} lines (${sc.path.split(/[\\/]/).pop()}, ${(await cacheInfo()).mb} MB)`);
  await ev(() => { app.player.cacheDialog = true; }); await wait(500);
  const dlg = await ev(() => document.querySelector('dialog[open]')?.innerText || '');
  ok(new RegExp(`made at ${sc.h} lines`).test(dlg), `the Scrub cache dialog says so: "${(dlg.match(/This video[^\n]*/) || [''])[0]}"`);
  await page.keyboard.press('Escape'); await wait(300);
  const t0 = await ev(() => app.usage.log.length);
  await open(B); await cacheReady(240000);
  const bPath = await ev(() => app.player.scrubCache.path);
  await wait(800);
  const exists = (p) => ev((p) => app.backend.stat(p).then((s) => s.exists), p);
  const ev1 = await ev((t0) => app.usage.log.slice(t0).filter((e) => e.kind === 'media:evicted').map((e) => e.detail), t0);
  console.log('     evicted on opening B:' + ev1.map((d) => '\n       ' + d).join(''));
  ok(ev1.length > 0 && !(await exists(xPath)) && (await exists(bPath)), `opening B evicted the least recently used entries of the others (the 1080p index clip's scrub cache gone: ${!(await exists(xPath))}; A's: ${!(await exists(aPath))}), B's own kept`);
  ok(ev1.every((d) => /"what":"\w+"/.test(d) && /"mb":/.test(d) && /"ageH":/.test(d) && !/[A-Z]:[\\/]/.test(d)), 'each a usage line with kind, size and age, no paths');
  // a 1080p proxy of B (and its own scrub cache): over the limit, B's original entries stay (the open video's)
  let seen = [];
  const root = await ev(() => app.backend.mediaCacheInfo().then((i) => i.path));
  const watch = setInterval(() => { seen.push(...ffmpegs(root)); }, 700);
  const t1 = await ev(() => app.usage.log.length);
  await pick('1080p');
  await page.waitForFunction(() => app.player.proxyH === 1080 && app.player.ready, null, { timeout: 300000, polling: 500 });
  await cacheReady(300000);
  clearInterval(watch);
  const ev2 = await ev((t1) => app.usage.log.slice(t1).filter((e) => e.kind === 'media:evicted').map((e) => e.detail), t1);
  const pxScrub = await ev(() => app.player.scrubCache.path);
  ok((await exists(bPath)) && (await exists(pxScrub)) && (await ev(() => app.backend.stat(app.player.media.path).then((s) => s.exists))), `B's original scrub cache, its 1080p proxy and the proxy's scrub cache all kept (evicted meanwhile: ${ev2.length ? ev2.join(' ') : 'nothing'})`);
  const total = await ev(() => app.backend.mediaCacheInfo().then((i) => Math.round(i.bytes / 2 ** 20)));
  console.log(`     media cache now ${total} MB of 512 (over only by the open video's own entries)`);
  const px = seen.filter((p) => p.proxy), scr = seen.filter((p) => p.scrub);
  console.log('     ffmpeg seen: proxy ' + JSON.stringify([...new Set(px.map((p) => `${p.priority}/${p.threads}`))]) + ', scrub ' + JSON.stringify([...new Set(scr.map((p) => `${p.priority}/${p.threads}`))]));
  ok(px.length > 0 && px.every((p) => p.priority === 6 && p.threads.length === 2 && p.threads.every((t) => t >= 2 && t <= 8)), 'the proxy transcode ran at below-normal priority (6) with -threads capped (decoder and x264)');
  if (scr.length && scr.every((p) => p.priority === 6)) console.log('     (the scrub cache ran below normal too: this instance itself runs below normal, so the per-job flag cannot be told apart here)');
  else ok(!scr.length || scr.every((p) => p.priority > 6), `the flag is the proxy job's own: the scrub cache's ffmpeg ran at ${[...new Set(scr.map((p) => p.priority))]}`);
} else if (phase === 'make') {
  await open(clip);
  let s = await state();
  ok(s.h === 0 && !s.err && s.made.length === 0, `a playable 1080p clip opens on the original (${s.vw}x${s.vh}, no proxies yet)`);
  ok(/Original/.test(await label() || ''), `the transport's proxy button is there: "${await label()}"`);
  const menu0 = await menuTexts();
  ok(menu0.some((t) => /^Original \(1080p\)/.test(t)) && ['1080p', '720p', '480p'].every((h) => menu0.some((t) => t.startsWith(h))), `its menu: ${menu0.join(' | ')}`);

  // cancel mid-way: the original keeps playing, editing goes on meanwhile
  console.log(`clicked: ${await pick('720p')}`);
  await page.waitForFunction(() => app.player.proxyJob?.fraction > 0, null, { timeout: 60000 });
  s = await state();
  ok(s.tasks.includes('Proxy 720p'), `while it runs: the status bar task "${s.tasks.join(', ')}", the button reads "${await label()}"`);
  await goFrame(50);
  ok((await state()).frame === 50 && (await painted()) === 50, 'editing goes on while it runs: frame 50 shown and painted');
  console.log(`clicked: ${await pick('Cancel')}`);
  await page.waitForFunction(() => !app.player.proxyJob, null, { timeout: 30000 });
  await wait(500);
  s = await state();
  ok(s.h === 0 && s.path === clip && !s.err && s.made.length === 0 && !s.tasks.length, `cancelled mid-way: the original still plays (frame ${s.frame}, painted ${await painted()}), no card, no proxy kept, no task (h ${s.h}, path ${s.path === clip ? 'the clip' : s.path}, made ${s.made.length}, err ${s.err || '-'}, tasks "${s.tasks.join(', ')}")`);

  // make 480p on frame 137: the same frame, time and picture before and after
  await goFrame(137);
  const before = { ...(await state()), painted: await painted() };
  const t0 = Date.now();
  console.log(`clicked: ${await pick('480p')}`);
  await page.waitForFunction(() => app.player.proxyH === 480 && app.player.ready && app.player.frame === 137 && !app.player.seeking, null, { timeout: 120000 });
  const secs = (Date.now() - t0) / 1000;
  await wait(600);
  const after = { ...(await state()), painted: await painted() };
  ok(after.vh === 480 && after.proxyOf === clip, `the player switched to the 480p proxy in ${secs.toFixed(1)} s (${after.vw}x${after.vh})`);
  ok(after.frame === before.frame && after.timeMs === before.timeMs && after.painted === before.painted && after.painted === 137,
    `same frame ${before.frame} -> ${after.frame}, time ${before.timeMs} -> ${after.timeMs} ms, painted ${before.painted} -> ${after.painted}; element ${before.el} -> ${after.el} ms`);
  ok(/480p/.test(await label() || ''), `the button shows it: "${await label()}"`);
  await ev(() => app.player.step(1)); await page.waitForFunction(() => app.player.frame === 138 && !app.player.seeking, null, { timeout: 10000 }); await wait(400);
  ok((await painted()) === 138, 'one frame step on the proxy: frame 138 painted');
  await goFrame(611);
  ok((await painted()) === 611, 'a jump on the proxy: frame 611 painted');

  // back to the original and to the proxy again (no new transcode)
  console.log(`clicked: ${await pick('Original')}`);
  await page.waitForFunction(() => app.player.proxyH === 0 && app.player.ready && app.player.frame === 611 && !app.player.seeking, null, { timeout: 30000 });
  await wait(600);
  s = await state();
  ok(s.vh === 1080 && (await painted()) === 611 && /Original/.test(await label() || ''), `back to the original on frame ${s.frame} (painted ${await painted()}, ${s.vw}x${s.vh}), the button: "${await label()}"`);
  const menu1 = await menuTexts();
  ok(menu1.includes('Proxy 480p') && !menu1.includes('480p'), `the 480p proxy is listed to play, no longer to make: ${menu1.join(' | ')}`);
  // paw-mh1a: the original's scrub cache, its stills
  await cacheReady();
  const origCache = await cacheInfo(), origStills = await stillNums(FR);
  ok(origStills.every((v, i) => v === FR[i]), `the original's scrub cache (${origCache.mb} MB): stills of frames ${FR} show ${origStills}`);
  console.log(`clicked: ${await pick('Proxy 480p')}`);
  await page.waitForFunction(() => app.player.proxyH === 480 && app.player.ready && !app.player.seeking, null, { timeout: 30000 });
  ok((await state()).frame === 611, 'to the proxy again on the same frame');
  const t1 = Date.now();
  await cacheReady();
  const pxCache = await cacheInfo(), pxStills = await stillNums(FR), hs = await hoverStats();
  ok(/proxy\.mp4$/.test(pxCache.src) && pxStills.every((v, i) => v === origStills[i]), `the proxy's own scrub cache (${pxCache.src}, ${pxCache.mb} MB, ready in ${((Date.now() - t1) / 1000).toFixed(1)} s): the same frames show ${pxStills} (original ${origStills})`);
  console.log(`     disk: the original's scrub cache ${origCache.mb} MB, the proxy ${await ev(async () => +((await app.backend.stat(app.player.media.path)).size / 2 ** 20).toFixed(1))} MB, its scrub cache ${pxCache.mb} MB`);
  ok(hs?.intra && hs.height === 480, `hover scrub decodes the proxy's scrub cache (${JSON.stringify(hs && { intra: hs.intra, w: hs.width, h: hs.height, codec: hs.codec })})`);
  // back and forth: both caches fetched, never rebuilt (no "Scrub cache" task, ready at once)
  for (const [what, h] of [['Original', 0], ['Proxy 480p', 480]]) {
    let sawTask = false;
    const watch = setInterval(() => ev(() => app.tasks.some((t) => t.label === 'Scrub cache')).then((v) => { sawTask ||= v; }, () => {}), 50);
    const t2 = Date.now();
    await pick(what);
    await page.waitForFunction((h) => app.player.proxyH === h && app.player.ready && !app.player.seeking, h, { timeout: 30000 });
    await cacheReady(10000);
    const secs = (Date.now() - t2) / 1000;
    clearInterval(watch);
    const nums = await stillNums([137, 1000]);
    ok(!sawTask && secs < 5 && nums[0] === 137 && nums[1] === 1000, `${what}: its scrub cache fetched, not rebuilt (no build task, switch + cache ready in ${secs.toFixed(1)} s), stills 137 / 1000 show ${nums}`);
  }

  // another video, then this one again: the proxy comes back by itself
  await open(other);
  s = await state();
  ok(s.h === 0 && s.made.length === 0, 'another video opens on its original, with no proxies');
  await open(clip);
  await page.waitForFunction(() => app.player.proxyH === 480 && app.player.ready, null, { timeout: 30000 }).catch(() => {});
  s = await state();
  ok(s.h === 480 && !s.tasks.length, `reopened: the 480p proxy plays again, remembered (${s.vw}x${s.vh}, painted ${await painted()} on frame ${s.frame})`);
  const log = await ev(() => app.usage.log.filter((e) => e.kind === 'video:proxy').map((e) => e.detail));
  console.log('usage:\n  ' + log.join('\n  '));
  ok(log.filter((d) => /"act":"made"/.test(d)).length === 1 && log.some((d) => /"act":"cancelled"/.test(d)) && !log.some((d) => /[A-Z]:[\\/]/.test(d)), 'one "made" line (no second transcode), the cancel logged, no paths');
} else {
  await open(clip);
  await page.waitForFunction(() => app.player.proxyH === 480 && app.player.ready, null, { timeout: 30000 }).catch(() => {});
  let s = await state();
  ok(s.h === 480 && !s.tasks.length, `after a restart the clip opens on its 480p proxy (${s.vw}x${s.vh}, painted ${await painted()} on frame ${s.frame})`);
  await open(other);
  await wait(1500);
  const info = await ev(() => app.backend.mediaCacheClear().then((i) => i && { bytes: i.bytes, entries: i.entries }));
  console.log('media cache cleared:', JSON.stringify(info));
  await open(clip);
  await wait(1500);
  s = await state();
  ok(s.h === 0 && s.path === clip && !s.err && s.lost === 480, `the proxy gone from the cache: the original plays, silently (no card: ${!s.err}), lost = ${s.lost}`);
  const cls = await ev(() => document.querySelector('[data-testid="proxy-menu"]')?.className || '');
  const menu = await menuTexts();
  ok(/\blost\b/.test(cls) && menu.some((t) => /^480p \(again/.test(t)), `the button turns amber and offers it again: ${menu.join(' | ')}`);
}
await browser.close();
console.log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
