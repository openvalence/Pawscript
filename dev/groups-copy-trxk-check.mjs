// dev/groups-copy-trxk-check.mjs -- paw-trxk in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints):
// Copy from... when the frames are hard to read, the linked shot first, all painted frames listed, one move for the set.
// Clips (--make <base.mp4>): groups-copy-crop-check's three 5 s shots (A, an unrelated insert I, A cropped x2 at 0.22,0.30)
// written twice: <base>.tim.mp4 = an 'mp42' MP4 whose moov holds udta/'©TIM' (the box an editor wrote into the owner's
// an owner file, which made mp4box drop the moov: no frames for Copy from, no crop / loop links), and <base>.frag.mp4 =
// a fragmented MP4 (WebCodecs' demuxer refuses it; the <video> plays it).
//  1. the ©TIM clip: Detect, the crop link 1-3 arrives (frames decoded), shot A and the insert painted;
//  2. on shot 3, C: tile 1 is shot A's painted frame "linked ×2.0", the insert's painted frame follows ("similar picture"),
//     the search compared many frames of the shot and says nothing is wrong;
//  3. click: both parts copied by ONE move (centres on the characters, the corner part left out), names and characters kept;
//  4. the fragmented clip, the player's stills, cached copies and transcode stubbed dead too: C says "Frames of this video
//     cannot be read yet: make a proxy" (paw-b88b) and lists the painted frame as "not compared"; stills back, C again: frames read the slow way.
//   node dev/groups-copy-trxk-check.mjs --make <base.mp4>
//   node dev/groups-copy-trxk-check.mjs <base.mp4> <out dir> [--reload]
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv[2] === '--make') {
  const base = process.argv[3], tmp = base + '.mp4v.mp4', plain = base + '.plain.mp4';
  const py = spawnSync('trackers/.venv/Scripts/python.exe', ['-I', 'experiments/cropscene/make_clips.py', tmp, 'A', 'I', 'A2'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, CLIP_SHOT_S: '5' } });
  if (py.status) process.exit(py.status);
  const enc = (out, extra) => spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-c:v', 'libx264', '-g', '1', '-pix_fmt', 'yuv420p', '-threads', '4', '-brand', 'mp42', ...extra, out], { stdio: 'inherit', windowsHide: true }).status;
  if (enc(plain, []) || enc(base + '.frag.mp4', ['-movflags', 'frag_keyframe+empty_moov'])) process.exit(1);
  // udta { '©TIM' } appended inside the moov (the moov is the file's last box here: no sample offset moves)
  const f = readFileSync(plain), boxes = [];
  for (let p = 0; p < f.length;) { const n = f.readUInt32BE(p); boxes.push([f.toString('latin1', p + 4, p + 8), p, n]); p += n; }
  const [, mp, mn] = boxes.find((b) => b[0] === 'moov');
  if (mp + mn !== f.length) { console.error('moov is not last: ' + JSON.stringify(boxes)); process.exit(1); }
  const tim = Buffer.from([0, 0, 0, 12, 0xa9, 0x54, 0x49, 0x4d, 0, 0, 0, 0]), udta = Buffer.concat([Buffer.from([0, 0, 0, 8 + tim.length, 0x75, 0x64, 0x74, 0x61]), tim]);
  const out = Buffer.concat([f, udta]);
  out.writeUInt32BE(mn + udta.length, mp);
  writeFileSync(base + '.tim.mp4', out);
  rmSync(tmp, { force: true }); rmSync(plain, { force: true });
  process.exit(0);
}
const { connectTestApp } = await import('./cdp-connect.mjs');
const [base, out] = process.argv.slice(2), clip = base + ".tim.mp4";
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
if (process.argv.includes('--reload')) {   // a dist rebuilt from a scratch copy after start
  await page.reload();
  await page.waitForFunction(() => window.app?.project && window.__pawDev?.trackingFor, null, { timeout: 60000 });
}
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const near = (p, q, tol) => p && Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
try {
  await ev(async (p) => {
    clearInterval(window.__noRecover);
    window.__noRecover = setInterval(() => { if (app.dialog) app.dialog.resolve('discard'); }, 150);
    await app.project.openVideo(p, { force: true });
    window.__tr = window.__pawDev.trackingFor(app);
  }, clip);
  await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__pawDev?.groupsFor, null, { timeout: 30000 });
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  const det = await ev(async () => { const r = await __tr.detectScenes(); return { error: r?.error ?? null, cuts: app.doc.scenes.map((s) => s.start_ms) }; });
  ok(det.cuts.join() === '0,5000,10000', `Detect: three shots ${JSON.stringify(det)}`);
  await page.waitForFunction(() => __tr.shotLinks.links.length > 0, null, { timeout: 120000, polling: 500 }).catch(() => {});   // before paw-trxk the ©TIM file gave no frames: no link ever came
  const L = await ev(() => __tr.shotLinks.links.map((l) => ({ a: l.a.start_ms, b: l.b.start_ms, scale: +l.scale.toFixed(2), tighter: l.tighter, box: l.box })));
  ok(L.length === 1 && L[0].a === 0 && L[0].b === 10000 && Math.abs(L[0].scale - 2) < 0.1 && L[0].tighter === 'b', 'the crop link: shot 3 = shot 1 x2 ' + JSON.stringify(L));
  await ev(() => { for (const [k, v] of Object.entries({ autoFromRepeats: false, brush: 0.03, grow: false, snap: false, circle: false, askAfter: false, corner: 'tl', compact: true })) app.settings.set('tracking.groups.' + k, v); });
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(2500, { exact: true }); });
  await wait(1500);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  ok(await ev(() => !!document.querySelector('[data-testid="groups-tools"]')), 'Groups tool is on');
  const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  const scribble = async (cx, cy, rx, ry) => { await page.mouse.move(...at(cx - rx, cy)); await page.mouse.down(); for (let k = 0; k <= 12; k++) await page.mouse.move(...at(cx - rx + (2 * rx * k) / 12, cy + (k % 2 ? ry : -ry))); await page.mouse.up(); await wait(300); };
  const shot = (tag) => page.screenshot({ path: `${out}/${tag}.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  /** Painted overlay pixels (alpha > 20) within r (0..1 of the picture's height) of a picture point. */
  const paintNear = (pts, r) => ev(([bx, pts, r]) => {
    const cv = document.querySelector('canvas.ov'), cr = cv.getBoundingClientRect(), k = cv.width / cr.width, d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const n = pts.map(() => 0);
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] <= 20) continue;
      const p = (i - 3) / 4, x = ((p % cv.width) / k + cr.x - bx.x) / bx.w, y = (Math.floor(p / cv.width) / k + cr.y - bx.y) / bx.h;
      pts.forEach(([px, py], j) => { if (Math.hypot((x - px) * bx.w, (y - py) * bx.h) <= r * bx.h) n[j]++; });
    }
    return n;
  }, [box, pts, r]);
  /** Hover the tile until the strip says so (a pointer already moving can miss the first enter). */
  const hoverTile = async (t) => {
    for (let k = 0; k < 3; k++) {
      await page.mouse.move(t.x, t.y - 200); await wait(150); await page.mouse.move(t.x, t.y);
      if (await page.waitForFunction(() => !!__pawDev.groupsFor(app).copy?.hover, null, { timeout: 2000 }).then(() => true, () => false)) break;
      console.log('     (hover not seen yet, again)');
    }
    await wait(800);
  };
  const tiles = () => ev(() => [...document.querySelectorAll('[data-testid="groups-copy-item"]')].map((e) => ({ kind: e.dataset.kind, key: e.dataset.key, more: !!e.dataset.more, why: e.querySelector('[data-testid="groups-copy-crop"]')?.textContent || '', text: e.textContent.replace(/\s+/g, ' ').trim() })));
  const openC = async () => {
    await page.mouse.move(...at(0.5, 0.05));
    await page.keyboard.press('c');
    await page.waitForFunction(() => { const c = __pawDev.groupsFor(app).copy; return c && !c.busy; }, null, { timeout: 60000 }).catch(() => {});
    await wait(300);
  };
  // ---- 1. shot A and the insert painted ----
  await scribble(0.42, 0.55, 0.025, 0.06);
  await scribble(0.62, 0.6, 0.025, 0.05);
  await scribble(0.08, 0.12, 0.03, 0.04);
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'hips' }); G.assign(1, { who: 'c2', part: 'thighs', side: 'l' }); G.assign(2, { who: 'c1', part: 'tail' }); });
  await wait(300);
  const painted = await ev(() => __pawDev.groupsFor(app).groups.map((g) => g.name).sort().join());
  ok(/c1_hips/.test(painted) && /c1_tail/.test(painted) && /c2_thighs/.test(painted),'shot A: three parts painted ' + painted);
  await ev(() => app.player.seek(7500, { exact: true })); await wait(1200);
  await scribble(0.5, 0.5, 0.04, 0.06);
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c2', part: 'head' }); });
  await wait(300);
  // ---- 2. shot 3, C: the linked shot first ----
  await ev(() => app.player.seek(12500, { exact: true })); await wait(1200);
  await openC();
  const t1 = await tiles(), st = await ev(() => __pawDev.groupsFor(app).copyStats);
  console.log('     tiles:', JSON.stringify(t1.map((t) => `${t.kind} ${t.why}`)), 'search:', JSON.stringify(st));
  ok(t1[0]?.kind === 'painted' && /^(linked|same loop) ×2\.0$/.test(t1[0].why), 'tile 1: shot A\'s painted frame, "linked ×2.0" or "same loop ×2.0" (the clip\'s shots are loops) ' + JSON.stringify(t1[0]));
  ok(t1.some((t, i) => i > 0 && t.kind === 'painted' && t.why === 'similar picture'), 'the insert\'s painted frame is listed after it ("similar picture")');
  ok(st?.frames > 10 && !st.warn, `the search read the shot's frames (${st?.frames}) and says nothing is wrong`);
  ok(!(await ev(() => !!document.querySelector('[data-testid="groups-copy-warn"]'))), 'no warning line');
  await shot('2-strip');
  // ---- 3. click tile 1: one move for the set ----
  const tb = await ev(() => { const r = document.querySelector('[data-testid="groups-copy-item"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await hoverTile(tb);
  const xf = await ev(() => { const G = __pawDev.groupsFor(app), p = G.copyPreview; return { lost: p?.lost, of: p?.of }; });
  await page.mouse.click(tb.x, tb.y);
  await page.waitForFunction(() => __pawDev.groupsFor(app).groups.length > 0, null, { timeout: 30000 }).catch(() => {});
  await wait(500);
  const gs = await ev(() => __pawDev.groupsFor(app).groups.map((g) => ({ name: g.name, who: g.who, part: g.part, side: g.side, un: !!g.unconfirmed, lined: g.lined, c: g.poly.reduce((s, q) => [s[0] + q[0] / g.poly.length, s[1] + q[1] / g.poly.length], [0, 0]) })));
  const g1 = gs.find((g) => g.name === 'c1_hips'), g2 = gs.find((g) => /^c2_thighs/.test(g.name));
  ok(gs.length === 2 && xf.lost === 1 && xf.of === 3, 'two parts copied, the corner one left out ' + JSON.stringify(gs.map((g) => g.name)));
  ok(near(g1?.c, [0.4, 0.5], 0.04) && near(g2?.c, [0.8, 0.6], 0.04), `one move: both on their characters (c1 ${g1?.c.map((v) => v.toFixed(3))}, c2 ${g2?.c.map((v) => v.toFixed(3))})`);
  ok(g1?.who === 'c1' && g2?.who === 'c2' && g2?.side === 'l' && gs.every((g) => g.un && g.lined === 'moved'), 'names, characters and side kept; every copy a dotted proposal ' + JSON.stringify(gs.map(({ c, ...r }) => r)));
  const toast = await ev(() => document.body.innerText.match(/Copied 2 groups[^\n]*/)?.[0] || '');
  ok(/lined up as one set/.test(toast), 'the toast: ' + toast.slice(0, 200));
  await shot('3-copied');
  await page.keyboard.press('Control+z'); await wait(400);
  // ---- 4. the fragmented clip, every frame source dead, then back ----
  await ev(async (p) => { await app.project.openVideo(p, { force: true }); window.__tr = window.__pawDev.trackingFor(app); }, base + '.frag.mp4');
  await page.waitForFunction(() => app.doc.media?.path?.endsWith('.frag.mp4') && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.setMode('scenes'); app.player.pause(); });
  await ev(async () => { await __tr.detectScenes(); });
  await ev(() => { app.setMode('track'); app.player.pause(); app.player.seek(2500, { exact: true }); }); await wait(1500);
  await ev(() => { const G = __pawDev.groupsFor(app); if (!G.on) app.commands.run('tracking.groups'); }); await wait(600);
  await scribble(0.42, 0.55, 0.025, 0.06);
  await ev(() => { const G = __pawDev.groupsFor(app); G.assign(0, { who: 'c1', part: 'hips' }); }); await wait(300);
  await ev(() => app.player.seek(12500, { exact: true })); await wait(1200);
  // the player's stills dead too; paw-b88b: and no cached copy or transcode to read instead (else the reader takes those)
  await ev(() => { app.player.still = async () => null; app.player.frameFiles = () => []; app.backend.remuxMp4 = () => ({ promise: Promise.reject(new Error('stub')), cancel() {} }); });
  await openC();
  const st2 = await ev(() => __pawDev.groupsFor(app).copyStats), warn = await ev(() => document.querySelector('[data-testid="groups-copy-warn"]')?.textContent || ''), t2 = await tiles();
  console.log('     search:', JSON.stringify(st2), JSON.stringify(t2.map((t) => `${t.kind} ${t.why}`)));
  ok(warn === 'Frames of this video cannot be read yet: make a proxy', 'the strip says it plainly, no reasons (paw-b88b): ' + warn);
  ok(t2.some((t) => t.kind === 'painted' && t.why === 'not compared'), 'the painted frame is listed all the same, "not compared"');
  await shot('4-dead');
  await page.keyboard.press('Escape'); await wait(300);
  await ev(() => { delete app.player.still; });
  await openC();
  const st3 = await ev(() => __pawDev.groupsFor(app).copyStats), t3 = await tiles();
  console.log('     search:', JSON.stringify(st3), JSON.stringify(t3.map((t) => `${t.kind} ${t.why}`)));
  ok(st3?.frames > 10 && !st3.warn && t3[0]?.kind === 'painted' && t3[0].why !== 'not compared', `stills back, C again: frames read the slow way (${st3?.frames}), no warning, the painted frame compared (${t3[0]?.why})`);
  await page.keyboard.press('Escape'); await wait(300);
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
