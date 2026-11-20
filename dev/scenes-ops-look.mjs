// dev/scenes-ops-look.mjs -- paw-ef73.18 in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a
// generated clip (ffmpeg -f lavfi -i "testsrc2=s=640x360:r=24:d=24" ...): five shots in three scenes and a fade in are laid
// over it, then: a press-drag on a block's body selects a range and moves no cut (also pressed 8 px from a cut); a drag on
// a cut's grip moves the cut onto a frame start; K / M / Shift+M / N / , / . / [ / ] / Delete on a selected cut do what
// they say (one undo step each); Shift+Z shows the ruler's frame cells and goes back. Cursors and the hint line are read
// at each place; screenshots go to <out-dir>.
//   node dev/scenes-ops-look.mjs <clip> <out-dir>        exits 1 on a failure
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const [clip, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };

await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
await ev(async (p) => { if (app.doc.media?.path !== p) await app.project.openVideo(p, { force: true }); }, clip);   // a second run: the clip is open already
await page.waitForFunction(() => app.doc.media && app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
const discard = page.getByRole('button', { name: 'Discard', exact: true });   // an autosave of an earlier run: not restored
if (await discard.isVisible().catch(() => false)) { await discard.click(); await wait(500); }
await ev(() => { app.setMode('scenes'); app.player.pause(); });
const fm = await ev(() => app.player.frameMs), F = (n) => Math.round(n * fm);
const base = await ev(([F, dur]) => {
  app.doc.scenes = [{ start_ms: 0, end_ms: F[0] }, { start_ms: F[0], end_ms: F[1], join: true }, { start_ms: F[1], end_ms: F[2] }, { start_ms: F[2], end_ms: F[3], join: true }, { start_ms: F[3], end_ms: dur }];
  return app.doc.scenes.map((s) => s.start_ms);
}, [[F(96), F(192), F(312), F(408)], await ev(() => app.player.durationMs)]);
await ev((t) => app.player.seek(t), F(200)); await wait(300);
await ev(() => app.commands.run('timeline.fade.addIn'));   // a 0.3 s fade in on shot 3.1 (index 2)
await ev((t) => { app.setView({ start: 1500, span: 16000 }); app.player.seek(t); }, F(20)); await wait(700);
const starts = () => ev(() => app.doc.scenes.map((s) => s.start_ms));
const bounds = () => ev(() => app.doc.scenes.map((s, k) => (k && s.join !== true ? 'S' : k ? 'c' : '')).join(''));
const geo = async () => {
  const r = await (await page.$('[data-tl-lane="scenes"]')).boundingBox(), v = await ev(() => ({ ...app.view }));
  const H = r.height, sh = Math.max(12, Math.round(H * 0.58)), y1 = sh + 1, bh = Math.max(6, Math.min(28, Math.round((H - y1) * 0.3))), g0 = Math.min(y1 + 1 + bh + 3, H - 6);
  return { r, px: (t) => r.x + ((t - v.start) / v.span) * r.width, yGrip: r.y + (g0 + H) / 2, yScenes: r.y + (13 + sh) / 2, yBand: r.y + y1 + 1 + bh / 2 };
};
const cursor = () => ev(() => getComputedStyle(document.querySelector('[data-tl-lane="scenes"] canvas')).cursor);
const hint = () => ev(() => document.querySelector('[data-testid="status-hint"]')?.textContent || '');
const undo = async () => { await ev(() => app.undo()); await wait(200); };
const key = async (k) => { await page.keyboard.press(k); await wait(250); };
const shotRow = async (name) => { const g = await geo(); await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: Math.max(0, g.r.y - 34), width: 1600, height: 34 + g.r.height + 200 } }); };

let g = await geo();
// ---- hover: a body, a grip, a fade handle
await page.mouse.move(g.px(F(48)), g.yGrip); await wait(150);
ok((await cursor()) === 'default' && /drag: select a range/.test(await hint()), `shot body: default cursor, hint "${(await hint()).slice(0, 90)}..."`);
await shotRow('1-hover-body');
await page.mouse.move(g.px(F(96)), g.yGrip); await wait(150);
ok((await cursor()) === 'col-resize' && /^Cut .* drag: move it/.test(await hint()), `cut grip: col-resize, hint "${(await hint()).slice(0, 80)}..."`);
await shotRow('2-hover-grip');
await page.mouse.move(g.px(F(96)) + 8, g.yGrip); await wait(150);
ok((await cursor()) === 'default', '8 px off the cut, at the grip height: default (the body)');
await page.mouse.move(g.px(F(96)), g.yBand); await wait(150);
ok((await cursor()) === 'default', 'on the cut line above the grip strip: default');
await page.mouse.move(g.px(F(192)), g.yScenes); await wait(150);
// paw-2lp7.5: no scene boundary grips: above a former scene boundary is the edge of an action region (resize it)
ok((await cursor()) === 'ew-resize' && /^(Start|End) of /.test(await hint()), `above a scene boundary: an action region's edge, ew-resize (${await cursor()})`);

// ---- a body drag: a range, no cut moves (also pressed 8 px from a cut)
await page.mouse.move(g.px(F(40)), g.yGrip); await page.mouse.down(); await page.mouse.move(g.px(F(340)), g.yGrip, { steps: 8 }); await wait(150);
await shotRow('3-range-drag');
await page.mouse.up(); await wait(250);
ok(JSON.stringify(await starts()) === JSON.stringify(base), 'body drag: no cut moved');
ok(await ev(() => !!app.doc.range && app.doc.range.t0 === 0 && app.doc.range.t1 === app.doc.scenes[3].end_ms), 'body drag: shots 1.1 to 2.2 selected (the range follows them)');
await page.mouse.move(g.px(F(96)) + 8, g.yGrip); await page.mouse.down(); await page.mouse.move(g.px(F(96)) + 60, g.yGrip, { steps: 6 }); await page.mouse.up(); await wait(250);
ok(JSON.stringify(await starts()) === JSON.stringify(base), 'pressed 8 px from a cut and dragged: no cut moved');

// ---- a grip drag moves the cut onto a frame start; one undo step
await page.mouse.move(g.px(F(96)), g.yGrip); await page.mouse.down(); await page.mouse.move(g.px(F(96)) + 47, g.yGrip, { steps: 8 }); await wait(150);
await shotRow('4-grip-drag');
await page.mouse.up(); await wait(250);
let s = await starts();
ok(s[1] > base[1] + 100 && s[1] === F(Math.round(s[1] / fm)), `grip drag: the cut moved ${base[1]} -> ${s[1]} (a frame start)`);
await undo(); ok((await starts())[1] === base[1], 'one undo step puts it back');

// ---- the single keys
await ev((t) => app.player.seek(t), F(50) + 5); await wait(250);
await key('KeyK'); s = await starts();
ok(s.includes(F(50)) && s.length === 6, `K: cut at the playhead's frame start (${F(50)})`);
await key('KeyM'); s = await starts();
ok(!s.includes(F(96)) && s.includes(F(50)), 'M: merged with the shot to the right (the cut at frame 96 went)');
await key('Shift+KeyM'); s = await starts();
ok(JSON.stringify(s) === JSON.stringify([0, F(192), F(312), F(408)]), 'Shift+M: merged with the shot to the left');
await undo(); await undo(); await undo();
ok(JSON.stringify(await starts()) === JSON.stringify(base), 'three undo steps: back to the start');
g = await geo(); await page.mouse.click(g.px(F(350)), g.yGrip); await wait(250);   // paw-2lp7.5: N acts on the selected shots: select the shot there
await key('KeyN');
ok((await bounds()) === 'cSSS', `N: an action region over the shot at the playhead: the action breaks at its cut (frame 312) (${await bounds()})`);   // paw-2lp7.5
await undo();
await ev((t) => app.player.seek(t), F(100)); await wait(250);
await key('Period'); s = await starts();
ok(s[1] === F(97) && Math.abs((await ev(() => app.player.timeMs)) - F(97)) < 2, '.: the cut nearest the playhead one frame later, the playhead with it');
await key('Comma'); await key('Comma'); s = await starts();
ok(s[1] === F(95), ', twice: two frames earlier');
await undo(); await undo(); await undo();
await ev((t) => app.player.seek(t), F(100)); await wait(250);
await key('BracketRight'); const fadeT1 = await ev(() => (app.doc.repeats?.fades || []).find((f) => f.kind === 'fade-in')?.t1);
ok(Math.abs((await ev(() => app.player.timeMs)) - fadeT1) < 2, `]: next cut, landing after its fade in (${fadeT1})`);
await key('BracketLeft');
ok(Math.abs((await ev(() => app.player.timeMs)) - F(96)) < 2, '[: previous cut');
await key('Shift+BracketRight'); await key('Shift+BracketRight');
ok(Math.abs((await ev(() => app.player.timeMs)) - F(408)) < 2, 'Shift+] twice: the second scene boundary (frame 408)');
// a click on a grip selects the cut; Delete merges across it
g = await geo();
await page.mouse.click(g.px(F(408)), g.yGrip); await wait(250);
await shotRow('5-cut-selected');
await key('Delete'); s = await starts();
ok(!s.includes(F(408)) && (await bounds()) === 'cSS', `Delete on the selected cut (a scene boundary): the shots merged, the action regions stay (${await bounds()})`);   // paw-2lp7.5
await undo();

// ---- the ruler at frame zoom, and back
const v0 = await ev(() => ({ ...app.view }));
await ev((t) => app.player.seek(t), F(200) + 3); await wait(200);
await key('Shift+KeyZ'); await wait(400);
const rw = await ev(() => document.querySelector('[data-tl-lane="ruler"]').clientWidth), v1 = await ev(() => ({ ...app.view }));
ok(Math.abs((fm / v1.span) * rw - 12) < 0.5, `Shift+Z: frames ${((fm / v1.span) * rw).toFixed(2)} px wide`);
await page.mouse.move(5, 5); await wait(200);
const rr = await (await page.$('[data-tl-lane="ruler"]')).boundingBox();
await page.screenshot({ path: `${out}/6-ruler-frames.png`, clip: { x: 0, y: rr.y, width: 1600, height: 34 + 260 } });
await page.screenshot({ path: `${out}/6b-ruler-frames-zoom.png`, clip: { x: 500, y: rr.y, width: 600, height: 120 }, scale: 'device' });
await ev(() => app.setView({ start: app.view.start, span: app.view.span / 3 })); await wait(300);
await page.screenshot({ path: `${out}/7-ruler-frames-36px.png`, clip: { x: 0, y: rr.y, width: 1600, height: 34 + 140 } });
await ev((v) => app.setView(v), v1); await wait(150);
await key('Shift+KeyZ');
const v2 = await ev(() => ({ ...app.view }));
ok(Math.abs(v2.span - v0.span) < 1 && Math.abs(v2.start - v0.start) < 1, 'Shift+Z again: back to the view before');
await page.mouse.move(5, 5); await wait(200);
await shotRow('8-rest');
await b.close();
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
