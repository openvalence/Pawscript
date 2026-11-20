// dev/groups-peek-check.mjs -- paw-bsyo in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated clip
// (ffmpeg: an orange box moving right 200 px / s on blue, 1280 x 720, 30 fps, every frame a keyframe). Asserts on what is painted:
//  1. an UNSAVED project (no media.hash) still gets a part proposal for a painted blob (the fake sidecar answers name_groups): the blob tints;
//  0. the keys (the owner's one purpose per key): Space outside the tool plays / pauses; G with the tool closed does not open it;
//     Tab opens it, Tab closes it, a held Tab (auto-repeat) toggles once;
//  2. hold Space and move the mouse (no button; off the video and back too): the video scrubs (the orange box moves in the picture), the groups stay drawn where painted (the overlay canvas still
//     has the painted blob's pixels at the same place), no stroke lands (a press while peeking does nothing), no take is split; Left / Right step one frame;
//  3. release Space: the exact seed frame is back, the tool is still open, and painting continues; Space never played; a
//     Space press without movement does nothing; holding Tab scrubs nothing (its press closes the tool, once).
// (dev/tracking.html harness checks: groups-check; this one is the real window)
//   node dev/groups-peek-check.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }   // a previous run's autosave (the scenes are reset below)
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 4000 }]; app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(1500);
  const on = () => ev(() => !!__pawDev.groupsFor(app).on), playing = () => ev(() => app.player.playing);
  { const V = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }); await page.mouse.move(...V); }
  await ev(() => { app.select([]); document.activeElement?.blur?.(); });
  // ---- 0. the keys ----
  await page.keyboard.press('Space'); await wait(500);
  const p1 = await playing();
  await page.keyboard.press('Space'); await wait(400);
  ok(p1 && !(await playing()), `outside the tool Space plays / pauses (playing ${p1} -> ${await playing()})`);
  await ev(() => { app.player.pause(); app.player.seek(1000, { exact: true }); }); await wait(500);
  await page.keyboard.press('g'); await wait(500);
  ok(!(await on()), 'G with the tool closed does not open Groups');
  await page.keyboard.press('Tab'); await wait(600);
  ok(await on(), 'Tab opens Groups');
  await page.keyboard.press('Tab'); await wait(500);
  ok(!(await on()), 'Tab closes Groups');
  await page.keyboard.down('Tab'); await wait(150);
  for (let k = 0; k < 4; k++) { await page.keyboard.down('Tab'); await wait(60); }   // Playwright: a down on a held key is an auto-repeat
  await page.keyboard.up('Tab'); await wait(500);
  ok(await on(), 'a held Tab (four auto-repeats) toggled once: open');
  await ev(() => { app.player.seek(1000, { exact: true }); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  ok(await ev(() => !app.doc.media.hash), 'the project is unsaved: no media.hash');
  const G = '__pawDev.groupsFor(app)';
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  // paint over the box at 1 s (x 300..540 of 1280, y 250..450 of 720)
  await page.mouse.move(...at(0.26, 0.40)); await page.mouse.down();
  for (let k = 0; k <= 10; k++) await page.mouse.move(...at(0.26 + 0.012 * k, 0.40 + (k % 2 ? 0.03 : -0.03)));
  await page.mouse.up(); await wait(300);
  const seed = await ev(() => __pawDev.groupsFor(app).t);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 1, 'one blob painted, seed frame ' + seed);
  await page.waitForFunction(() => { const g = __pawDev.groupsFor(app); return g.groups.some((x) => g.proposalFor(x)); }, null, { timeout: 15000 }).then(() => ok(true, 'PART 1: the proposal arrived on an unsaved video project'), () => ok(false, 'PART 1: no proposal arrived'));
  // pixels of the overlay canvas: count of non-transparent pixels in the blob's box, and in the video the orange box's centre column
  const paint = () => ev(([bx]) => { const cv = document.querySelector('canvas.ov'); const c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height).data; let n = 0, sx = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) { n++; sx += ((i - 3) / 4) % cv.width; } return { n, cx: n ? sx / n : -1 }; }, [0]);
  const shot = (tag) => page.screenshot({ path: `${out}/${tag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const timeNow = () => ev(() => app.player.timeMs);
  const before = await paint(); await shot('seed');
  const n0 = await ev(() => app._history.entries.length), scenes0 = await ev(() => app.doc.scenes.length);
  // a Space press without movement in the tool: nothing (no play, no move)
  const x0 = box.x + box.w * 0.5, y0 = box.y + box.h * 0.15;
  await page.mouse.move(x0, y0);
  await page.keyboard.press('Space'); await wait(500);
  ok(!(await playing()) && Math.abs((await timeNow()) - seed) < 0.5 && (await on()), `a Space press in the tool: no playback, the frame stays (${await timeNow()}), the tool stays open`);
  // hold Space, move right 120 px with NO button = 20 frames (the anchor: where the pointer was when Space went down)
  await page.keyboard.down('Space'); await wait(150);
  ok(await ev(() => !!__pawDev.groupsFor(app).peek), 'Space held: peeking');
  for (let k = 1; k <= 12; k++) await page.mouse.move(x0 + k * 10, y0); await wait(400);
  const t1 = await timeNow(), fms = await ev(() => app.player.frameMs);
  ok(Math.abs(t1 - (seed + 20 * fms)) < 1.5, `moving the mouse (no button) scrubbed 20 frames (${seed} -> ${t1})`);
  const mid = await paint(); await shot('peek-right');
  ok(mid.n > 800 && Math.abs(mid.cx - before.cx) < 10, `the groups stay drawn where painted, as outlines over the moving picture (px ${before.n} filled -> ${mid.n} outline, centre x ${before.cx.toFixed(0)} -> ${mid.cx.toFixed(0)})`);
  await page.mouse.down(); await page.mouse.move(x0 + 125, y0 + 30); await page.mouse.up(); await wait(300);   // a press and a small drag while peeking: nothing
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 1 && (await ev(() => app._history.entries.length)) === n0 && (await ev(() => app.doc.scenes.length)) === scenes0, 'no stroke landed (a press while peeking does nothing), no take split, no undo step');
  await page.mouse.move(x0 + 120, y0); await wait(250);
  await page.keyboard.press('ArrowLeft'); await wait(250);
  ok(Math.abs((await timeNow()) - (t1 - fms)) < 1.5, 'Left: one frame back');
  for (let k = 1; k <= 6; k++) await page.mouse.move(Math.max(1, x0 + 120 - k * 400), y0); await wait(400);
  ok((await timeNow()) >= 0 && (await timeNow()) < 100, 'moving far left (off the video) clamps at the take start: ' + (await timeNow()));
  ok(!(await playing()), 'peeking never plays');
  await page.mouse.move(x0 + 180, y0); await wait(400);   // back over the video, 60 px right of where Left was pressed: 19 + 10 frames
  ok(Math.abs((await timeNow()) - (seed + 29 * fms)) < 1.5, 'back over the video, still Space: it scrubs on from the stepped frame (' + (await timeNow()) + ')');
  await shot('peek-clamped');
  await page.keyboard.up('Space'); await wait(500);
  ok((await timeNow()) === seed || Math.abs((await timeNow()) - seed) < 0.5, 'released: the exact seed frame is back (' + (await timeNow()) + ')');
  ok(await ev(() => !__pawDev.groupsFor(app).peek), 'peek over');
  ok((await on()) && !(await playing()), 'the tool stays open after the scrub, nothing plays');
  await page.mouse.move(...at(0.8, 0.2)); await page.mouse.down(); await page.mouse.move(...at(0.84, 0.2)); await page.mouse.up(); await wait(300);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 2, 'painting continues: a second blob');
  await shot('after');
  // holding Tab scrubs nothing: its press closes the tool (once), moving the mouse leaves the frame alone
  const tT = await timeNow();
  await page.mouse.move(x0, y0); await page.keyboard.down('Tab'); await wait(200);
  for (let k = 1; k <= 12; k++) await page.mouse.move(x0 + k * 10, y0);
  await page.keyboard.down('Tab'); await wait(300);   // an auto-repeat while held
  const tH = await timeNow(), pkH = await ev(() => !!__pawDev.groupsFor(app).peek), onH = await on();
  await page.keyboard.up('Tab'); await wait(300);
  ok(!pkH && Math.abs(tH - tT) < 0.5 && !onH && !(await on()), `holding Tab + moving: no scrub (time ${tT} -> ${tH}, peek ${pkH}), the press closed the tool once (open ${onH} -> ${await on()})`);
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
