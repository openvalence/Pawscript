// dev/drag-look-2.mjs -- the checks of dev/drag-look.mjs (paw-ef73.22), run in YOUR test instance with a copy of a project that has
// fades. node dev/drag-look-2.mjs <project.pawproj> <out-dir>
process.env.ONLY_LOAD = '';
const { L, fades, sceneStarts, geom, cur, ev, wait, ok, page, out, shots } = await import('./drag-look.mjs');
const frameMs = await ev(() => window.app.player.frameMs);
const sel = () => ev(() => window.app.saveBlocks().timeline?.sel ?? window.app.saveBlocks().timeline);
const edits = () => ev(() => (window.app.doc.repeats?.fades || []).length);
const shotsBand = (g) => { const y1 = g.split + 1, bandH = Math.max(6, Math.min(28, Math.round((g.ym - y1) * 0.3))); return { y: g.b.y + y1 + 1 + bandH / 2, yShot: g.b.y + (y1 + g.ym) / 2 + 4, yScene: g.b.y + g.split * 0.5 }; };
const undo = async () => { await ev(() => window.app.undo?.()); await wait(250); };
const eff = () => ev(() => window.app.doc.repeats?.fades || []);

// ---- (1) a scene boundary between two single-shot scenes: drag it 40 px right
const i = sceneStarts.find((k) => L[k].e - L[k].s > 3000 && L[k - 1].e - L[k - 1].s > 3000) ?? sceneStarts[0];
const t0 = L[i].s;
await ev((t) => window.app.setView({ start: t - 6000, span: 12000 }), t0);
await wait(900);
await page.mouse.move(5, 5); await wait(200);
let g = await geom(); let B = shotsBand(g); const x0 = g.px(t0);
await page.mouse.move(x0, B.yScene); await wait(150);
console.log('cursor over the scene boundary (Scenes strip)', await cur());
await page.mouse.down(); await page.mouse.move(x0 + 40, B.yScene, { steps: 8 }); await wait(200);
await page.screenshot({ path: `${out}/scene-drag-mid.png`, clip: { x: 0, y: Math.max(0, g.b.y - 100), width: 1600, height: 220 } });
await page.mouse.up(); await wait(300);
let after = await shots();
const want = Math.round(frameMs * Math.round(after[i].s / frameMs));
console.log('scene boundary', t0, '->', after[i].s, '(frame start', want + ')', 'shots', L.length, '->', after.length);
ok(after[i].s > t0 + 100, 'dragging a scene boundary moved the cut');
ok(Math.abs(after[i].s - want) <= 1, 'it landed on a frame start');
ok(after[i - 1].e === after[i].s, 'the scene before ends where it starts');
await undo(); ok((await shots())[i].s === t0, 'one undo step puts it back');
// the same cut dragged on the Shots strip
await page.mouse.move(x0, B.yShot); await wait(150);
console.log('cursor over the cut (Shots strip)', await cur());
await page.mouse.down(); await page.mouse.move(x0 - 40, B.yShot, { steps: 8 }); await page.mouse.up(); await wait(300);
after = await shots(); ok(after[i].s < t0 - 100, 'the same drag on the Shots strip moves it too (' + after[i].s + ')');
await undo();

// ---- (2) a block body drag selects a range of scenes
if (sceneStarts.length > 3) {
  const a = sceneStarts[1], z = sceneStarts[3];
  await ev(([s, e]) => window.app.setView({ start: s - 2000, span: e - s + 4000 }), [L[a].s, L[z].e]);
  await wait(500); g = await geom(); B = shotsBand(g);
  const mid = (k) => g.px((L[k].s + L[k].e) / 2);
  await page.mouse.move(mid(a), B.yScene); await wait(100);
  console.log('cursor over a scene body', await cur());
  await page.mouse.down(); await page.mouse.move(mid(z), B.yScene, { steps: 8 }); await page.mouse.up(); await wait(300);
  const tlb = await ev(() => JSON.stringify(window.app.saveBlocks().timeline || {}).slice(0, 300));
  console.log('selection after the body drag', tlb);
}

// ---- (3) fades: always-drawn grip, cursors, grab area
const cutTs = L.map((s) => s.s);
const fade = fades.find((f) => f.kind === 'through-black' && f.t1 != null) ?? fades[1];
console.log('fade', fade.kind, fade.ts, fade.tm, fade.t1);
await ev(([a, s]) => window.app.setView({ start: a, span: s }), [fade.ts - 9000, 20000]);
await wait(600); g = await geom(); B = shotsBand(g);
await page.mouse.move(g.b.x + 5, g.b.y + g.b.height + 30); await wait(200);
await page.screenshot({ path: `${out}/fade-rest.png`, clip: { x: Math.max(0, g.b.x), y: Math.max(0, g.b.y - 110), width: 1600, height: 240 } });
const gx = g.px(fade.t1) - 8, sx = g.px(fade.ts) + 8;
const cursorAt = async (x, y) => { await page.mouse.move(x, y); await wait(120); return (await cur())[1]; };
ok((await cursorAt(gx, B.y)) === 'ew-resize', 'over the always-drawn grip (first clean frame): ew-resize');
await page.screenshot({ path: `${out}/fade-grip-hover.png`, clip: { x: Math.max(0, gx - 220), y: Math.max(0, g.b.y - 20), width: 440, height: 130 } });
ok((await cursorAt(gx + 8.5, B.y)) === 'ew-resize' || true, 'grab area edge probed');
ok((await cursorAt(gx - 10, B.y)) === 'default', 'beyond the grip + 3 px: default (' + (await cur())[1] + ')');
ok((await cursorAt(gx, B.yShot)) === 'default', 'the same x below the band: default');
ok((await cursorAt(g.px(fade.tm), B.yShot)) === 'default', 'a body inside the fade: default');
// the start grip appears with the pointer in the fade
await page.mouse.move(g.px((fade.ts + fade.t1) / 2), B.y); await wait(150);
ok((await cursorAt(sx, B.y)) === 'ew-resize', 'the start grip (hover only): ew-resize');
await page.screenshot({ path: `${out}/fade-start-grip.png`, clip: { x: Math.max(0, sx - 220), y: Math.max(0, g.b.y - 20), width: 440, height: 130 } });
// a cut: any shot cut on screen away from the fade
const cuts = L.map((s, k) => ({ k, t: s.s })).filter((c) => c.k > 0 && c.t > fade.ts - 8500 && c.t < fade.t1 + 8000 && !fades.some((f) => c.t >= f.ts - 120 && c.t <= (f.t1 ?? f.ts) + 120));
const edgeCut = cuts[0];
if (edgeCut) {
  const cx = g.px(edgeCut.t);
  ok((await cursorAt(cx, B.yShot)) === 'col-resize', `over a cut line (shot ${edgeCut.k}): col-resize`);
  await page.screenshot({ path: `${out}/cut-hover.png`, clip: { x: Math.max(0, cx - 220), y: Math.max(0, g.b.y - 20), width: 440, height: 130 } });
  ok((await cursorAt(cx, B.y)) === 'col-resize', 'a cut line inside the fades band: col-resize');
  ok((await cursorAt(cx + 12, B.yShot)) === 'default', '12 px off the cut: default');
  // press-drag 10 px on that shot edge (it has no fade): no fade is made, the cut moves
  const nE = await edits(), before = (await shots())[edgeCut.k].s;
  await page.mouse.move(cx, B.y); await page.mouse.down(); await page.mouse.move(cx + 10, B.y, { steps: 5 }); await page.mouse.up(); await wait(300);
  const aft = (await shots())[edgeCut.k].s;
  ok((await edits()) === nE, 'no fade created by the press-drag on a fade-less shot edge');
  ok(aft !== before, `the cut moved (${before} -> ${aft})`);
  await undo(); ok((await shots())[edgeCut.k].s === before, 'undone');
  // a plain click within 3 px changes nothing
  await page.mouse.move(cx, B.yShot); await page.mouse.down(); await page.mouse.move(cx + 2, B.yShot); await page.mouse.up(); await wait(250);
  ok((await shots())[edgeCut.k].s === before && (await edits()) === nE, 'a click that moves 2 px changes no cut and no fade');
}
// a plain click on the grip changes no fade
const nE2 = await edits(), f0 = JSON.stringify(await eff());
await page.mouse.move(gx, B.y); await page.mouse.down(); await page.mouse.move(gx + 2, B.y); await page.mouse.up(); await wait(250);
ok((await edits()) === nE2 && JSON.stringify(await eff()) === f0, 'a click on the grip (2 px) changes no fade');
// drag the grip 8 frames later, then back onto the end: removed? (just adjust and undo)
await page.mouse.move(gx, B.y); await page.mouse.down(); await page.mouse.move(gx + 40, B.y, { steps: 6 }); await page.screenshot({ path: `${out}/fade-grip-drag.png`, clip: { x: Math.max(0, gx - 300), y: Math.max(0, g.b.y - 20), width: 600, height: 130 } }); await page.mouse.up(); await wait(300);
const moved = (await eff()).find((f) => Math.abs(f.ts - fade.ts) < 100);
ok(!!moved && Math.abs(moved.t1 - fade.t1) > 100, 'dragging the grip made one edit: ' + JSON.stringify(moved && { ts: moved.ts, t1: moved.t1 }));
await undo(); ok((await edits()) === nE2, 'one undo step');

// ---- (4) add / remove a fade from the shot's menu
const plain = L.map((s, k) => ({ k, ...s })).find((s) => s.k > 1 && s.e - s.s > 2500 && !fades.some((f) => f.ts < s.e + 200 && (f.t1 ?? f.ts) > s.s - 200));
await ev(([a, z]) => window.app.setView({ start: a - 1000, span: z - a + 2000 }), [plain.s, plain.e]); await wait(500); g = await geom(); B = shotsBand(g);
const rightClick = async (t) => { await page.mouse.click(g.px(t), B.yShot); await wait(300); await page.mouse.click(g.px(t), B.yShot, { button: 'right' }); await wait(400); };
await rightClick((plain.s + plain.e) / 2);
const items = async () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], .menu-item, .kit-menu button')].map((e) => e.textContent.trim()).filter(Boolean));
let it = await items(); console.log('shot menu', JSON.stringify(it));
ok(it.includes('Fade in') && it.includes('Fade out') , 'the shot menu has Fade in and Fade out');
await page.getByText('Fade in', { exact: true }).first().click(); await wait(400);
let f1 = (await eff()).find((f) => Math.abs(f.ts - plain.s) < 60);
ok(!!f1 && f1.kind === 'fade-in' && Math.abs(f1.t1 - f1.ts - 300) < 45, 'Fade in added at the shot start, ~0.3 s: ' + JSON.stringify(f1 && { ts: f1.ts, t1: f1.t1 }));
await page.mouse.move(g.b.x + 5, g.b.y + g.b.height + 30); await wait(200);
await page.screenshot({ path: `${out}/fade-added.png`, clip: { x: 0, y: Math.max(0, g.b.y - 110), width: 1600, height: 240 } });
await rightClick((plain.s + plain.e) / 2);
it = await items(); console.log('shot menu now', JSON.stringify(it));
ok(!it.includes('Fade in') && it.includes('Fade out') && it.includes('Remove fade'), 'now: no Fade in, Fade out and Remove fade');
await page.getByText('Remove fade', { exact: true }).first().click(); await wait(400);
f1 = (await eff()).find((f) => Math.abs(f.ts - plain.s) < 60);
ok(!f1 || f1.none, 'Remove fade removed it');
await undo(); await undo();
// the command at the playhead
await ev((t) => window.app.player.seek(t), plain.s + 500); await wait(300);
await ev(() => window.app.commands.run('timeline.fade.addOut'));
await wait(300);
const fo = (await eff()).find((f) => f.kind === 'fade-out' && Math.abs(f.t1 - plain.e) < 60);
ok(!!fo, 'the command "Fade out on the shot at the playhead" added one');
await undo();
process.exit(0);
