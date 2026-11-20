// dev/groups-copy-check.mjs -- paw-lgtx "Copy from…" and paw-55la (the two-way search) in YOUR test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints), on a generated clip (1280 x 720, 30 fps, every frame a keyframe, 4 s; make it with
// --make <clip.mp4>): 0-2 s (shot A) an orange box at 300,250 240x200 and a green one at 620,180 120x120 on blue; 2-4 s (shot B)
// the same picture moved 30 px down and 80 + 40 x |n - 91| px right (frame n), a white band rising 25 x |n - 91| px from the
// bottom: frame 91 of shot B is the closest to shot A (moved 80, 30), its neighbours less so, the rest not at all. Asserts on what is painted; sets its own brush / tool settings:
//  1. on shot B (no groups), the playhead on frame 75, C opens a strip over the video: one tile, shot A's painted frame, its
//     thumbnail decoded (orange pixels), "→ f 91 (+16)": the two-way search found the frame of shot B that matches; the print
//     move found the picture's shift;
//  2. hovering the tile = peek: the video shows frame 91 and shot A's groups LINED UP on it (~80 px right of where they were
//     painted); leaving the tile returns to frame 75;
//  3. a click goes to frame 91 and copies there as ONE undo step, the set lined up by one move (paw-trxk: no per-part re-find),
//     every copy dotted (unconfirmed); Ctrl+Z takes the copy back in one step;
//  4. C again, Esc: the strip closes, the tool stays open; on shot A (the only painted take) the strip says there is nothing to copy.
//   node dev/groups-copy-check.mjs --make <clip.mp4>
//   node dev/groups-copy-check.mjs <clip.mp4> <out dir>
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === '--make') {
  const box = (c, w, h) => `color=c=${c}:s=${w}x${h}:r=30:d=4`;
  // (overlay's n runs one ahead of the decoded frame index here: n - 92 is frame 91)
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2040a0:s=1280x720:r=30:d=4', '-f', 'lavfi', '-i', box('0xff8c00', 240, 200), '-f', 'lavfi', '-i', box('0x20c040', 120, 120), '-f', 'lavfi', '-i', box('white', 1280, 720),
    '-filter_complex', "[0][1]overlay=eval=frame:x='if(lt(t,2),300,380+40*abs(n-92))':y='if(lt(t,2),250,280)'[a];[a][2]overlay=eval=frame:x='if(lt(t,2),620,700+40*abs(n-92))':y='if(lt(t,2),180,210)'[b];[b][3]overlay=eval=frame:x=0:y='if(lt(t,2),720,max(360,720-25*abs(n-92)))',format=yuv420p",
    '-c:v', 'libx264', '-g', '1', '-threads', '4', '-t', '4', process.argv[3]], { stdio: 'inherit', windowsHide: true });
  process.exit(r.status);
}
const { connectTestApp } = await import('./cdp-connect.mjs');
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const frame = () => ev(() => app.player.clock.frameAt(app.player.timeMs));
try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  // paw-fulb: its own brush / tool settings (other checks leave grow on, a small brush, snap...)
  await ev(() => { for (const [k, v] of Object.entries({ autoFromRepeats: false, brush: 0.04, grow: false, snap: false, circle: false, askAfter: false, corner: 'tl', compact: true })) app.settings.set('tracking.groups.' + k, v); });
  await ev(() => { app.setMode('track'); app.doc.scenes = [{ start_ms: 0, end_ms: 2000 }, { start_ms: 2000, end_ms: 4000 }]; app.player.pause(); app.player.seek(1000, { exact: true }); });
  await wait(1500);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  const scribble = async (cx, cy, rx, ry) => { await page.mouse.move(...at(cx - rx, cy)); await page.mouse.down(); for (let k = 0; k <= 12; k++) await page.mouse.move(...at(cx - rx + (2 * rx * k) / 12, cy + (k % 2 ? ry : -ry))); await page.mouse.up(); await wait(300); };
  await scribble(0.328, 0.486, 0.06, 0.07);   // the orange box
  await scribble(0.531, 0.333, 0.025, 0.04);  // the green box (Ctrl not needed: it is off the first)
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'hips' }); G.assign(1, { who: 'c1', part: 'tail' }); });
  await wait(300);
  ok(await ev(() => __pawDev.groupsFor(app).groups.map((g) => g.name).join()) === 'c1_hips,c1_tail', 'shot A: hips and tail painted');
  // the overlay's painted pixels (alpha > 20) inside the picture: count and centre x
  const paint = () => ev((bx) => { const cv = document.querySelector('canvas.ov'), r = cv.getBoundingClientRect(), k = cv.width / r.width; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0, sx = 0;
    for (let i = 3; i < d.length; i += 4) { const p = (i - 3) / 4, x = (p % cv.width) / k + r.x, y = Math.floor(p / cv.width) / k + r.y; if (d[i] > 20 && x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h) { n++; sx += x; } } return { n, cx: n ? sx / n : -1 }; }, box);
  const shot = (tag) => page.screenshot({ path: `${out}/${tag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const painted = await paint(); await shot('1-painted');
  // ---- shot B, frame 75: C opens the strip ----
  await ev(() => app.player.seek(2500, { exact: true })); await wait(1200);
  ok(await ev(() => __pawDev.groupsFor(app).groups.length) === 0, 'shot B has no groups');
  ok((await frame()) === 75, 'the playhead is on frame 75');
  const blank = await paint();
  await page.mouse.move(...at(0.5, 0.1));
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 30000 }).catch(() => {});
  const tiles = await ev(() => [...document.querySelectorAll('[data-testid="groups-copy-item"]')].map((e) => ({ kind: e.dataset.kind, text: e.textContent.replace(/\s+/g, ' ').trim() })));
  ok(tiles.length === 1 && tiles[0].kind === 'painted', 'C: the strip shows shot A\'s painted frame: ' + JSON.stringify(tiles));
  ok(/→ f 91 \(\+16\)/.test(tiles[0]?.text || ''), 'the tile says which frame of this shot it matches: → f 91 (+16)');
  console.log('     search:', JSON.stringify(await ev(() => __pawDev.groupsFor(app).copyStats)));
  const orange = await ev(() => { const cv = document.querySelector('[data-testid="groups-copy-item"] canvas'); if (!cv) return 0; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 90 && d[i + 2] < 90) n++; return n; });
  ok(orange > 300, `its thumbnail is the decoded frame (${orange} orange px)`);
  await shot('2-strip');
  // ---- hover = peek on frame 91, lined up ----
  const tileBox = await ev(() => { const r = document.querySelector('[data-testid="groups-copy-item"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(tileBox.x, tileBox.y); await wait(600);
  const xf = await ev(() => { const G = __pawDev.groupsFor(app), c = G.copy.items[0]; return c.moved?.xf; });
  ok(xf && Math.abs(xf.dx - 80 / 1280) < 0.02 && Math.abs(xf.dy - 30 / 720) < 0.02 && Math.abs(xf.s - 1) < 0.04, 'the print move found the picture\'s shift (0.0625, 0.0417): ' + JSON.stringify(xf));
  ok((await frame()) === 91, `hover: the video shows frame 91 (${await frame()})`);
  const hov = await paint(); await shot('3-hover');
  // paw-trjh as bb2d421 left it: the picture must not move under the pointer while the copy is peeked. FAILS since bb2d421: the
  // picture is fitted beside the bar (player.inset from its width); the peek brings Accept all / Notes into a bar already as
  // tall as the stage (1600 x 1000), it wraps into a second column (37 -> 70 px) and the picture jumps (342,90 579 wide ->
  // 375,99 546 wide)
  const box2 = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(), q = (s) => !!document.querySelector(s); return { x: r.x, y: r.y, w: r.width, h: r.height, bar: Math.round(document.querySelector('[data-testid="groups-tools"]')?.getBoundingClientRect().width), accept: q('[data-testid="groups-accept"]'), notes: q('[data-testid="groups-notes"]') }; });
  ok(['x', 'y', 'w', 'h'].every((k) => Math.abs(box2[k] - box[k]) < 1), `the picture stays where it was painted while peeking (${[box.x, box.y, box.w].map(Math.round)} / ${[box2.x, box2.y, box2.w].map(Math.round)}; bar ${box2.bar} px, Accept all ${box2.accept}, Notes ${box2.notes})`);
  ok(hov.n > blank.n + 800, `hover draws the groups on that frame (${blank.n} px before, ${hov.n} while hovering)`);
  // the line-up in frame units, each centre against the picture it was drawn on (the picture may have moved, asserted above)
  const lined = (hov.cx - box2.x) / box2.w - (painted.cx - box.x) / box.w, want = 80 / 1280;
  ok(Math.abs(lined - want) < 0.4 * want, `lined up: ${(lined * 1280).toFixed(1)} px of the frame right of where they were painted (the picture moved ${want * 1280})`);
  await page.mouse.move(...at(0.5, 0.1)); await wait(600);
  ok((await frame()) === 75 && !(await ev(() => __pawDev.groupsFor(app).copy.hover)), `leaving the tile: back on frame 75 (${await frame()}), the strip stays`);
  // ---- click: frame 91, one undo step ----
  const h0 = await ev(() => app._history.entries.length);
  await page.mouse.click(tileBox.x, tileBox.y);
  await page.waitForFunction(() => { const G = __pawDev.groupsFor(app); return !G.busy && !G.copyWait && G.groups.length > 0; }, null, { timeout: 30000 }).catch(() => {});
  await wait(400);
  const gs = await ev(() => __pawDev.groupsFor(app).groups.map((g) => ({ name: g.name, lined: g.lined, un: !!g.unconfirmed, source: g.source, t: g.t_ms })));
  ok((await frame()) === 91, `the click went to frame 91 (${await frame()})`);
  ok(gs.length === 2 && gs.every((g) => g.source === 'repeat' && Math.abs(g.t - 91000 / 30) < 17), 'copied there: two groups seeded on frame 91, copy kind: ' + JSON.stringify(gs));
  ok(gs.every((g) => g.un && g.lined === 'moved'), 'paw-trxk: no part re-found on its own: both lined up by the one move, dotted (unconfirmed) ' + JSON.stringify(gs));
  ok((await ev(() => app._history.entries.length)) === h0 + 1, 'one undo step');
  ok(!(await ev(() => !!document.querySelector('[data-testid="groups-copy"]'))), 'the strip closed');
  await shot('4-copied');
  await page.keyboard.press('Control+z'); await wait(400);
  ok((await ev(() => __pawDev.groupsFor(app).groups.length)) === 0, 'Ctrl+Z: the copy is gone in one step');
  // ---- Esc ----
  await page.keyboard.press('c');
  await page.waitForSelector('[data-testid="groups-copy"]', { timeout: 10000 }).catch(() => {});
  ok(await ev(() => !!document.querySelector('[data-testid="groups-copy"]')), 'C again: the strip is back');
  await page.keyboard.press('Escape'); await wait(300);
  ok(!(await ev(() => !!document.querySelector('[data-testid="groups-copy"]'))) && (await ev(() => __pawDev.groupsFor(app).on)), 'Esc: the strip closes, the tool stays open');
  // ---- nothing to copy ----
  await ev(() => app.player.seek(1000, { exact: true })); await wait(1000);
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 15000 }).catch(() => {});
  const none = await ev(() => document.querySelector('[data-testid="groups-copy-none"]')?.textContent || '');
  ok(/Nothing to copy/.test(none) && !(await ev(() => document.querySelectorAll('[data-testid="groups-copy-item"]').length)), 'shot A (the only painted take): one line, no empty strip: ' + none);
  await shot('5-none');
  await page.keyboard.press('Escape');
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
