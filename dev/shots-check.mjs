// dev/shots-check.mjs -- scenes contain shots (paw-2zy). Default: headless Edge on dev/shell.html (its own vite on a
// random port, mock backend; no window ever shows). --app: YOUR Tauri test instance instead (node dev/test-app.mjs start
// ..., then the CDP_* env it prints; not while the owner is in a fullscreen game: those windows steal focus).
// What it checks (paw-k2u: shots are first-class in the selection): an old flat project migrates (scenes painted with shot dividers), click selects a scene, a second
// click the shot, scene tags reach every shot and camera chips one shot, split / merge at both levels, and (with
// --stab) the stabilised preview. Asserts on what is painted (the Scenes row canvas, the video's transform).
//   node dev/shots-check.mjs <old.pawproj> [out-dir] [--app]
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { connectTestApp } from './cdp-connect.mjs';

const args = process.argv.slice(2), APP = args.includes('--app'), [proj, outDir] = args.filter((a) => a !== '--app');
let browser, page, vite = null;
if (APP) ({ browser, page } = await connectTestApp());
else {
  const port = await new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  vite = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 2000)); });
  for (let k = 0; k < 60; k++) { try { await page.goto(`http://localhost:${port}/dev/shell.html?mode=track&video=/dev/assets/cfr2997.mp4`); break; } catch { await page.waitForTimeout(1000); } }
}
const ev = (f, a) => page.evaluate(f, a);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const shot = async (name) => { if (outDir) await page.screenshot({ path: `${outDir}/${name}.png` }); };
try {
  await page.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  if (APP) await ev((p) => window.app.project.openProject(p, { force: true }), proj);
  else await ev(async (text) => {   // the shell has no files: the project loader's own migration on the file's scenes
    const L = await import('/src/app/project-logic.js'), io = await import('/src/lib/io/index.js');
    window.app.doc.scenes = L.appDocFrom(io.parse(text, { lenient: true })).scenes;
  }, readFileSync(proj, 'utf8'));
  await page.waitForFunction(() => window.app.doc.scenes?.length === 7 && window.app.durationMs > 50000, null, { timeout: 30000 });
  await ev(() => { window.app.setMode?.('track'); window.app.setView({ start: 0, span: 60060 }); });
  await page.waitForTimeout(800);
  const runs = () => ev(() => { const l = window.app.doc.scenes, out = []; l.forEach((s, i) => { if (i && s.join === true) out[out.length - 1].push(i); else out.push([i]); }); return out; });
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4],[5,6]]', 'the old project migrates: 7 shots in 3 scenes ' + JSON.stringify(await runs()));
  ok(await ev(() => window.app.doc.scenes.every((s) => s.continues !== true) && window.app.doc.scenes[2].split === 'camera'), 'continues became the join; the camera split stays the same take');
  // painted: the Scenes row. A scene cut is a full-height line; a hard cut inside a scene only ticks at the top and bottom
  const px = (t, yFrac) => ev(([t, yFrac]) => {
    const el = document.querySelector('[data-tl-lane="scenes"]'), cv = el.querySelector('canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width;
    const v = window.app.view, x = Math.round(((t - v.start) / v.span) * r.width), g = cv.getContext('2d');
    const at = (xx) => Array.from(g.getImageData(Math.round(xx * d), Math.round(r.height * yFrac * d), 1, 1).data);
    const bes = at(x + 4), dist = (a) => Math.abs(a[0] - bes[0]) + Math.abs(a[1] - bes[1]) + Math.abs(a[2] - bes[2]);
    const line = [at(x - 1), at(x), at(x + 1)].sort((a, b) => dist(b) - dist(a))[0];   // the 1 px line may round either way
    return { line, beside: bes, right: [at(x), at(x + 1)] };
  }, [t, yFrac]);
  const differs = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30;
  // the Shots strip (lower ~40 %): how many pixels of the boundary's column differ from beside it, and is there a notch (wider at the top)
  const col = (t) => ev((t) => {
    const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width, g = cv.getContext('2d'), v = window.app.view;
    const x = Math.round(((t - v.start) / v.span) * r.width), y0 = Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58)) + 1, y1 = Math.round(r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) - 3;
    const at = (xx, yy) => Array.from(g.getImageData(Math.round(xx * d), Math.round(yy * d), 1, 1).data);
    const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 30;
    let n = 0, tot = 0;
    for (let y = y0 + 4; y < y1; y++) { tot++; if ([x - 1, x, x + 1].some((xx) => diff(at(xx, y), at(x - 5, y)) && diff(at(xx, y), at(x + 5, y)))) n++; }   // differs from both sides: the line, not a shot's own fill
    const yt = Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58)) + 1;   // the Shots strip's first row (ScenesLane split / modH)
    const notch = diff(at(x + 2, yt + 0.5), at(x + 7, yt + 0.5)) && diff(at(x - 2, yt + 0.5), at(x - 7, yt + 0.5));
    const gap = diff(at(x, r.height * 0.3), at(x + 7, r.height * 0.3));   // the gap between scene blocks above
    return { share: n / Math.max(1, tot), notch, gap };
  }, t);
  const sceneB = await col(8000), cutB = await col(32000), moveB = await col(20000);
  ok(sceneB.share > 0.9 && sceneB.gap, `scene boundary at 8 s: a solid line below, a gap above (${JSON.stringify(sceneB)})`);
  ok(cutB.share > 0.9 && cutB.notch && !cutB.gap, `cut at 32 s (inside scene 2): a solid line with a notch, no gap above (${JSON.stringify(cutB)})`);
  ok(moveB.share > 0.15 && moveB.share < 0.75 && !moveB.notch && !moveB.gap, `camera move at 20 s: dotted, no notch, no gap (${JSON.stringify(moveB)})`);
  await shot('1-migrated');
  // click inside scene 2 (on shot 2.4): that shot; double-click: the whole scene
  const clickAt = async (t, mods = []) => {
    const p = await ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view; return { x: r.left + ((t - v.start) / v.span) * r.width, y: r.top + ((Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58))) + 1 + r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) / 2 }; }, t);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(p.x, p.y);
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(250);
  };
  const range = () => ev(() => JSON.stringify(window.app.doc.range));
  // paw-hmn: the toolbar's chips say what they act on; the tag chips live in the Scene / Shot chip popovers
  const bar = () => ev(() => document.querySelector('.tb [data-target]')?.dataset.target);
  const chip = async (name) => {
    for (const which of ['scene', 'shot']) {
      await page.click(`.tb [data-chip="${which}"]`);
      await page.waitForTimeout(200);
      const hit = await ev((n) => { const b = [...document.querySelectorAll('.pop button')].find((x) => x.textContent.trim() === n); if (b) b.click(); return !!b; }, name);
      await page.waitForTimeout(150);
      if (await ev((w) => document.querySelector(`.tb [data-chip="${w}"]`)?.getAttribute('aria-expanded') === 'true', which)) await page.click(`.tb [data-chip="${which}"]`);   // close it again
      await page.waitForTimeout(150);
      if (hit) return true;
    }
    return false;
  };
  await clickAt(38000);
  ok(await range() === '{"t0":32000,"t1":44000}', 'click: shot 2.4 selected, the range is the shot ' + await range());
  ok((await bar()) === 'Scene 2 · shot 2.4', 'the quick bar names the shot: ' + await bar());
  await chip('zoom');
  await page.waitForTimeout(200);
  ok(await ev(() => (window.app.doc.scenes[4].tags || []).includes('zoom') && !(window.app.doc.scenes[1].tags || []).includes('zoom')), 'zoom (camera) on the selected shot only');
  await shot('2-shot-selected');
  // double-click: the whole scene; a where then reaches every shot of it
  const dblAt = async (t) => { const p = await ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view; return { x: r.left + ((t - v.start) / v.span) * r.width, y: r.top + ((Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58))) + 1 + r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) / 2 }; }, t); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(250); };
  await dblAt(38000);
  ok(await range() === '{"t0":8000,"t1":44000}' && (await bar()) === 'Scene 2', 'double-click: scene 2 selected, the range is the scene ' + await range() + ' / ' + await bar());
  await chip('vaginal');
  await page.waitForTimeout(200);
  ok(await ev(() => [1, 2, 3, 4].every((i) => (window.app.doc.scenes[i].tags || []).includes('vaginal')) && !(window.app.doc.scenes[5].tags || []).includes('vaginal')), 'vaginal (where) on the scene: every shot of scene 2, not scene 3');
  // a click in the Scenes strip (upper) selects the whole scene, one in the Shots strip that shot
  const clickTop = async (t) => { const p = await ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view; return { x: r.left + ((t - v.start) / v.span) * r.width, y: r.top + r.height * 0.25 }; }, t); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); };
  await clickAt(38000); await clickTop(38000);
  ok(await range() === '{"t0":8000,"t1":44000}' && (await bar()) === 'Scene 2', 'a click in the Scenes strip: the whole scene ' + await bar());
  // Shift+click: a run of shots across the scene cut; Ctrl+click: one out; chips act on the selection
  await clickAt(25000); await clickAt(55000, ['Shift']);
  ok(await range() === '{"t0":20000,"t1":60000}' && (await bar()) === '5 shots in Scenes 2 to 3', 'Shift+click from shot 2.2 to 3.2: five shots across the scene cut ' + await range() + ' / ' + await bar());
  await clickAt(28000, ['Control']);
  ok((await bar()) === '4 shots in Scenes 2 to 3', 'Ctrl+click takes shot 2.3 out: ' + await bar());
  await ev(() => [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim() === 'Scenes')?.click());
  await page.waitForTimeout(300);
  ok(await ev(() => document.querySelectorAll('.scp .shot.on').length) === 4, 'the Scenes panel mirrors it: four shot lines highlighted (' + await ev(() => document.querySelectorAll('.scp .shot.on').length) + ')');
  await chip('handheld');
  await page.waitForTimeout(200);
  ok(await ev(() => [2, 4, 5, 6].every((i) => (window.app.doc.scenes[i].tags || []).includes('handheld')) && ![1, 3].some((i) => (window.app.doc.scenes[i].tags || []).includes('handheld'))), 'handheld (camera) on the four selected shots only');
  await chip('throbbing');
  await page.waitForTimeout(200);
  // paw-8qb: a modifier chip marks a span over the range (the selection's hull), each scene its part; never the whole scene
  const modSpans = (id) => ev((id) => { const out = new Set(); for (const s of window.app.doc.scenes) for (const e of s.tags || []) if (e && typeof e === 'object' && e.id === id) out.add(`${e.t0}-${e.t1}`); return [...out].sort(); }, id);
  ok(JSON.stringify(await modSpans('throbbing')) === '["20000-44000","44000-60000"]', 'throbbing (modifier): a span over the range, clipped per scene ' + JSON.stringify(await modSpans('throbbing')));
  await shot('2b-multi');
  await ev(() => { window.app.undo(); window.app.undo(); });
  await page.waitForTimeout(200);
  // a drag on the row: box select
  const dragFrom = async (t0, t1) => {
    const xy = (t) => ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), v = window.app.view; return { x: r.left + ((t - v.start) / v.span) * r.width, y: r.top + ((Math.max(12, Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) * 0.58))) + 1 + r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2)))) / 2 }; }, t);
    const a = await xy(t0), b = await xy(t1);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 3 });
    if (process.env.PROBE) console.log('mid-drag range', await range(), await bar());
    await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };
  await dragFrom(11000, 23000);
  ok((await bar()) === 'Scene 2 · shots 2.1 to 2.2' && await range() === '{"t0":8000,"t1":26000}', 'a drag over 11-23 s box-selects shots 2.1 and 2.2: ' + await bar());
  await ev(() => window.app.commands.run('timeline.shot.own'));
  await page.waitForTimeout(200);
  ok(JSON.stringify(await runs()) === '[[0],[1,2],[3,4],[5,6]]', 'Make these shots their own scene: ' + JSON.stringify(await runs()));
  await ev(() => window.app.undo());
  await page.waitForTimeout(150);
  await dragFrom(11000, 23000);
  await ev(() => window.app.commands.run('timeline.shot.mergeSelected'));
  await page.waitForTimeout(200);
  ok(await ev(() => window.app.doc.scenes.length) === 6 && JSON.stringify(await runs()) === '[[0],[1,2,3],[4,5]]', 'Merge the selected shots: one shot 8-26 s ' + JSON.stringify(await runs()));
  await ev(() => window.app.undo());
  await page.waitForTimeout(150);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4],[5,6]]', 'undo: the shots are back');
  // split / merge at both levels (commands, as the right-click runs them)
  await ev(() => { window.app.player.seek(20000); });
  await page.waitForTimeout(150);
  await ev(() => window.app.commands.run('timeline.scene.split'));
  await page.waitForTimeout(150);
  ok(JSON.stringify(await runs()) === '[[0],[1],[2,3,4],[5,6]]', 'split scene at 20 s (a shot cut): 4 scenes ' + JSON.stringify(await runs()));
  ok(await ev(() => (window.app.doc.scenes[2].tags || []).includes('vaginal')), 'both halves keep the scene tags');
  await clickAt(25000);   // select the second half (commands act on the selection)
  await ev(() => window.app.commands.run('timeline.scene.mergePrev'));
  await page.waitForTimeout(150);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4],[5,6]]', 'merge with previous: back to 3 scenes');
  await ev(() => { window.app.player.seek(14000); });
  await page.waitForTimeout(150);
  await ev(() => window.app.commands.run('timeline.shot.split'));
  await page.waitForTimeout(150);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4,5],[6,7]]', 'split shot at 14 s: 8 shots, still 3 scenes ' + JSON.stringify(await runs()));
  await clickAt(50000);   // select another scene: the selected shot's outline would cover the new cut
  const nc = await col(14000);
  ok(nc.share > 0.9 && nc.notch && !nc.gap, `the new cut is painted as a cut (solid, notched, no gap above): ${JSON.stringify(nc)}`);
  await clickAt(16000);   // the shot after the new cut
  await ev(() => window.app.commands.run('timeline.shot.mergePrev'));
  await page.waitForTimeout(150);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4],[5,6]]', 'merge shot with previous: 7 shots again');
  await clickAt(46000);
  await ev(() => window.app.commands.run('timeline.scene.mergePrev'));
  await page.waitForTimeout(200);
  const offered = await ev(() => window.app.doc.scenes[1].offers);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4,5,6]]' && offered?.length === 1 && offered[0].tags?.includes('oral'), 'merge scenes 2 + 3: the later act is offered, not applied ' + JSON.stringify(offered?.map((o) => o.tags)));
  await shot('3-merged-offer');
  await ev(() => window.app.commands.run('edit.undo') || window.app.undo?.());
  await page.waitForTimeout(200);
  ok(JSON.stringify(await runs()) === '[[0],[1,2,3,4],[5,6]]', 'undo restores the two scenes');
  // paw-hmn: three chips on one toolbar line; a popover closes when the selection moves to another scene
  await clickAt(38000);
  const chipText = (w) => ev((x) => document.querySelector(`.tb [data-chip="${x}"] .txt`)?.textContent, w);
  ok((await chipText('scene')).startsWith('Scene 2 · ') && (await chipText('shot')) === 'Shot 2.4 · zoom', 'the Scene / Shot chips: ' + await chipText('scene') + ' | ' + await chipText('shot'));
  await page.click('.tb [data-chip="scene"]'); await page.waitForTimeout(250);
  ok(await ev(() => document.querySelector('.tb [data-chip="scene"]').getAttribute('aria-expanded') === 'true' && !!document.querySelector('.pop')), 'the Scene chip opens its popover');
  await clickAt(48000);
  ok(await ev(() => document.querySelector('.tb [data-chip="scene"]').getAttribute('aria-expanded') !== 'true'), 'selecting a shot of another scene closes it');
  if (!APP) {
    for (const W of [900, 1200, 1600]) {
      await page.setViewportSize({ width: W, height: 1000 });
      await page.waitForTimeout(400);
      const tb = await ev(() => ({ h: document.querySelector('.tb').getBoundingClientRect().height, n: [...document.querySelectorAll('.tb [data-chip]')].filter((c) => c.getBoundingClientRect().width > 20 && c.getBoundingClientRect().right <= document.querySelector('.tb').getBoundingClientRect().right).length }));
      ok(tb.h < 40 && tb.n === 3, `toolbar at ${W} px: one line (${tb.h.toFixed(0)} px), all three chips visible (${tb.n})`);
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(300);
  }
  // paw-8qb: mark an orgasm without a split: draw it on the Modifiers strip, mark in / out at the playhead, resize, delete
  const modsY = () => ev(() => { const r = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(); return r.top + r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2))) / 2; });
  const xAt = (t) => ev((t) => { const r = document.querySelector('[data-tl-lane="scenes"] canvas').getBoundingClientRect(), v = window.app.view; return r.left + ((t - v.start) / v.span) * r.width; }, t);
  const runs0 = JSON.stringify(await runs());
  { const y = await modsY(), a = await xAt(12000), b = await xAt(16000);
    await page.mouse.move(a, y); await page.mouse.down(); await page.mouse.move((a + b) / 2, y, { steps: 3 }); await page.mouse.move(b, y, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(300); }
  const picker = await ev(() => [...document.querySelectorAll('[role=menuitemcheckbox],[role=menuitemradio],[role=menuitem]')].map((m) => m.textContent.trim()));
  ok(['orgasm (spurting)', 'knotting', 'throbbing', 'idle'].every((k) => picker.includes(k)), 'drawing a span offers the kind picker (the last used kind is preset; orgasm is the spurting span; idle, paw-d8u): ' + JSON.stringify(picker.slice(-4)));
  await ev(() => [...document.querySelectorAll('[role=menuitemcheckbox],[role=menuitemradio],[role=menuitem]')].find((m) => m.textContent.trim() === 'orgasm (spurting)')?.click());
  await page.waitForTimeout(200);
  const org = await modSpans('orgasm');
  ok(org.length === 1 && Math.abs(+org[0].split('-')[0] - 12000) < 60 && Math.abs(+org[0].split('-')[1] - 16000) < 60, 'a drag on the Modifiers strip: an orgasm span 12-16 s ' + JSON.stringify(org));
  ok(JSON.stringify(await runs()) === runs0, 'no scene or shot was split for it');
  const modPx = await ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width, v = window.app.view, g = cv.getContext('2d');
    const at = (x) => Array.from(g.getImageData(Math.round(x * d), Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2))) / 2) * d), 1, 1).data);
    return { in: at(((t - v.start) / v.span) * r.width), out: at(((t + 8000 - v.start) / v.span) * r.width) }; }, 14000);
  ok(Math.abs(modPx.in[0] - modPx.out[0]) + Math.abs(modPx.in[1] - modPx.out[1]) + Math.abs(modPx.in[2] - modPx.out[2]) > 60, `the span is painted on the Modifiers strip (${modPx.in} vs ${modPx.out})`);
  // Shift+O at 30 s, Shift+O at 33 s: mark in, mark out
  await ev(() => window.app.player.seek(30000)); await page.waitForTimeout(150);
  await ev(() => window.app.commands.run('timeline.mod.mark.orgasm')); await page.waitForTimeout(100);
  await ev(() => window.app.player.seek(33000)); await page.waitForTimeout(150);
  await ev(() => window.app.commands.run('timeline.mod.mark.orgasm')); await page.waitForTimeout(150);
  const org2 = await modSpans('orgasm');
  ok(org2.length === 2 && org2.some((x) => Math.abs(+x.split('-')[0] - 30000) < 60 && Math.abs(+x.split('-')[1] - 33000) < 60), 'Shift+O twice: a second orgasm span 30-33 s in the same scene ' + JSON.stringify(org2));
  ok(await ev(() => window.app.commands.keysFor('timeline.mod.mark.orgasm')?.[0]) === 'Shift+O', 'the mark key is Shift+O');
  // drag its right end out to 18 s, then select it and X
  { const y = await modsY(), a = await xAt(16000), b = await xAt(18000);
    await page.mouse.move(a - 1, y); await page.mouse.down(); await page.mouse.move(b, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(250); }
  const org3 = await modSpans('orgasm');
  ok(org3.some((x) => Math.abs(+x.split('-')[1] - 18000) < 60 && Math.abs(+x.split('-')[0] - 12000) < 60), 'dragging its end resizes it to 12-18 s ' + JSON.stringify(org3));
  { const y = await modsY(), a = await xAt(14000); await page.mouse.click(a, y); await page.waitForTimeout(150); await page.keyboard.press('x'); await page.waitForTimeout(200); }
  ok(JSON.stringify(await modSpans('orgasm')) === JSON.stringify(org3.filter((x) => +x.split('-')[0] > 20000)), 'click + X deletes the selected span ' + JSON.stringify(await modSpans('orgasm')));
  // paw-d8u: "modifiers don't update when dragged around": drag a knotting span by its middle; mid-drag the bar, the
  // document's span and the Knotting effect tied to it (same times) have all moved and the effects row paints it there;
  // release = one undo step for both; G + Esc puts both back
  {
    const fxSpan = () => ev(() => (window.app.doc.fx || []).filter((e) => e.kind === 'knotting').map((e) => `${e.t0}-${e.t1}`));
    for (let k = 0; k < 4 && (await modSpans('knotting')).length; k++) {   // the fixture has knotting over shot 2.4: off first (the toggle under it)
      const [a0, a1] = (await modSpans('knotting'))[0].split('-').map(Number);
      await ev((t) => window.app.commands.run('timeline.mod.toggle.knotting', { t, here: true }), Math.round((a0 + a1) / 2)); await page.waitForTimeout(100);
    }
    await ev(() => window.app.commands.run('timeline.mod.toggle.knotting', { t: 36000, here: true }));   // a 4 s span from 36 s
    await ev(() => window.app.player.seek(37000));
    await page.waitForTimeout(150);
    await ev(() => window.app.commands.run('timeline.fx.knotting'));
    await page.waitForTimeout(200);
    ok(JSON.stringify(await modSpans('knotting')) === '["36000-40000"]' && JSON.stringify(await fxSpan()) === '["36000-40000"]', `a knotting span 36-40 s and a Knotting effect over it (Alt+N): ${await modSpans('knotting')} / ${await fxSpan()}`);
    const fxPx = (t) => ev((t) => { const el = document.querySelector('div.fx[role=presentation]'), cv = el.querySelector('canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width, v = window.app.view, g = cv.getContext('2d');
      return Array.from(g.getImageData(Math.round(((t - v.start) / v.span) * r.width * d), Math.round(r.height * 0.5 * d), 1, 1).data); }, t);
    const modPx2 = (t) => ev((t) => { const cv = document.querySelector('[data-tl-lane="scenes"] canvas'), r = cv.getBoundingClientRect(), d = cv.width / r.width, v = window.app.view, g = cv.getContext('2d');
      return Array.from(g.getImageData(Math.round(((t - v.start) / v.span) * r.width * d), Math.round((r.height - Math.max(8, Math.min(14, Math.round(r.height * 0.2))) / 2) * d), 1, 1).data); }, t);
    const dif = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 40;
    const fxIn0 = await fxPx(38000), fxOut0 = await fxPx(42000), mIn0 = await modPx2(38000), mOut0 = await modPx2(42000);
    ok(dif(fxIn0, fxOut0) && dif(mIn0, mOut0), `before the drag: the effect and the span are painted at 38 s, not at 42 s (${fxIn0} / ${fxOut0}; ${mIn0} / ${mOut0})`);
    const y = await modsY(), a = await xAt(38000), b = await xAt(41000);
    await page.mouse.move(a, y); await page.mouse.down(); await page.mouse.move((a + b) / 2, y, { steps: 3 }); await page.mouse.move(b, y, { steps: 3 });
    await page.waitForTimeout(200);   // mid-drag (the button still down)
    const midMod = await modSpans('knotting'), midFx = await fxSpan(), fxMid = await fxPx(42000), mMid = await modPx2(42000);
    ok(midMod.length === 1 && Math.abs(+midMod[0].split('-')[0] - 39000) < 60, 'mid-drag: the document already has the span at 39-43 s (every consumer reads it) ' + JSON.stringify(midMod));
    ok(midFx.length === 1 && midFx[0] === midMod[0], 'mid-drag: the tied Knotting effect moved with it ' + JSON.stringify(midFx));
    ok(dif(mMid, mOut0) && dif(fxMid, fxOut0), `mid-drag: the span bar and the effect are painted at 42 s now (${mMid} vs ${mOut0}; ${fxMid} vs ${fxOut0})`);
    await shot('6-span-drag-mid');
    await page.mouse.up(); await page.waitForTimeout(250);
    const upMod = await modSpans('knotting'), upFx = await fxSpan();
    ok(upMod.length === 1 && upFx[0] === upMod[0] && Math.abs(+upMod[0].split('-')[0] - 39000) < 60, `released: span and effect at ${upMod} / ${upFx}`);
    await ev(() => window.app.undo()); await page.waitForTimeout(200);
    ok(JSON.stringify(await modSpans('knotting')) === '["36000-40000"]' && JSON.stringify(await fxSpan()) === '["36000-40000"]', `one Ctrl+Z puts both back: ${await modSpans('knotting')} / ${await fxSpan()}`);
    ok(dif(await fxPx(38000), await fxPx(42000)) && !dif(await fxPx(42000), fxOut0), 'and the effects row repaints them back at 38 s');
    await ev(() => window.app.redo()); await page.waitForTimeout(200);
    ok(JSON.stringify(await fxSpan()) === JSON.stringify(upFx), 'redo moves both again ' + JSON.stringify(await fxSpan()));
    // G on the selected span, the mouse moves it, Esc: back
    const c = await xAt(41000);
    await page.mouse.click(c, y); await page.waitForTimeout(150);
    await page.keyboard.press('g'); await page.waitForTimeout(100);
    await page.mouse.move(c + 60, y, { steps: 4 }); await page.waitForTimeout(200);
    const gFx = await fxSpan();
    ok(gFx[0] !== upFx[0] && JSON.stringify(gFx) === JSON.stringify(await modSpans('knotting')), `G: the effect follows the span live (${gFx} / ${await modSpans('knotting')})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(JSON.stringify(await fxSpan()) === JSON.stringify(upFx) && JSON.stringify(await modSpans('knotting')) === JSON.stringify(upMod), `G, Esc: both back (${await modSpans('knotting')} / ${await fxSpan()})`);

    // Esc in the middle of a pointer drag: both back, the release changes nothing, no undo step
    { const n0 = await ev(() => window.app.history?.entries?.length ?? window.app._history?.entries?.length ?? -1), p0 = await xAt(40000), p1 = await xAt(37000);
      await page.mouse.move(p0, y); await page.mouse.down(); await page.mouse.move(p1, y, { steps: 4 }); await page.waitForTimeout(150);
      const mid = await fxSpan();
      await page.keyboard.press('Escape'); await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(200);
      ok(mid[0] !== upFx[0] && JSON.stringify(await fxSpan()) === JSON.stringify(upFx) && JSON.stringify(await modSpans('knotting')) === JSON.stringify(upMod)
        && await ev(() => window.app.history?.entries?.length ?? window.app._history?.entries?.length ?? -1) === n0, `drag, Esc, release: both back, no undo step (mid ${mid}, now ${await modSpans('knotting')} / ${await fxSpan()})`); }
    await ev(() => window.app.transact('clean up', () => { window.app.doc.fx = (window.app.doc.fx || []).filter((e) => e.kind !== 'knotting'); window.app.doc.scenes = window.app.doc.scenes.map((s) => ({ ...s, tags: (s.tags || []).filter((e) => e?.id !== 'knotting') })); }));
    await page.waitForTimeout(150);
  }
  // effects pared back: the Effects row's menu
  { const r = await ev(() => { const el = document.querySelector('div.fx[role=presentation] canvas') || document.querySelector('div.fx[role=presentation]'); const b = el?.getBoundingClientRect(); return b ? { x: b.left + b.width * 0.55, y: b.top + b.height / 2 } : null; });
    if (r) { await page.mouse.click(r.x, r.y, { button: 'right' }); await page.waitForTimeout(250);
      const items = await ev(() => [...document.querySelectorAll('[role=menu] [role=menuitem],[role=menu] [role=menuitemcheckbox]')].map((m) => m.textContent.trim().replace(/\s+/g, ' ')));
      ok(items.some((t) => t.startsWith('Knotting')) && items.some((t) => t.startsWith('Spurt')) && items.some((t) => t.startsWith('More effects')) && !items.some((t) => t.startsWith('Throb')), 'the Effects row offers Knotting, Spurt, More effects: ' + JSON.stringify(items.slice(0, 6)));
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
    else ok(false, 'the Effects row was not found'); }
  // the stabilised preview: with no camera path the command refuses (nothing shifts); with a drift the painted picture
  // (the <video> element's matrix, and the overlays that map through it) moves by minus the drift
  await ev(() => window.app.commands.run('track.stabilise'));
  await page.waitForTimeout(200);
  ok(await ev(() => window.app.player.stab === null), 'Stabilise with no camera path for the shot: refused, nothing shifts');
  const mat = () => ev(() => { const m = /matrix\(([^)]*)\)/.exec(document.querySelector('[data-testid="video-stage"] video').style.transform)[1].split(',').map(Number); return { a: m[0], e: m[4], f: m[5], vw: document.querySelector('[data-testid="video-stage"] video').videoWidth }; });
  const m0 = await mat();
  await ev(() => { window.app.player.stab = (t) => ({ x: 0.1, y: -0.05 }); });
  await page.waitForTimeout(250);
  const m1 = await mat(), vh = await ev(() => document.querySelector('[data-testid="video-stage"] video').videoHeight);
  ok(Math.abs((m1.e - m0.e) - (-0.1 * m0.vw * m0.a)) < 1 && Math.abs((m1.f - m0.f) - (0.05 * vh * m0.a)) < 1, `a drift of (0.1, -0.05) moves the painted picture by (${(m1.e - m0.e).toFixed(1)}, ${(m1.f - m0.f).toFixed(1)}) px`);
  await shot('4-stabilised');
  await ev(() => { window.app.player.stab = null; });
  await page.waitForTimeout(150);
  ok(Math.abs((await mat()).e - m0.e) < 0.5, 'off: the picture is back');
  // re-found groups after a hard cut inside a scene (v4.13): dotted with '?', Accept clears the flag
  await ev(() => {
    const sq = (x, y) => [[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1]], l = window.app.doc.scenes;
    window.app.doc.scenes = l.map((s, k) => (k === 5 ? { ...s, groups: [{ name: 'c1_penis', who: 'c1', part: 'penis', poly: sq(0.3, 0.4), pinned: true, t_ms: 46000, source: 'user' },
      { name: 'c1_penis', who: 'c1', part: 'penis', poly: sq(0.6, 0.4), pinned: true, t_ms: 54000, source: 'tagger', unconfirmed: true, prior: 'c1_penis' }] } : s));
    window.app.select([]); window.app.player.seek(54000);
  });
  await page.waitForTimeout(300);
  ok(await ev(() => window.app.doc.scenes[6].groups?.length === 2), 'the groups belong to the scene (both shots carry them)');
  await clickAt(54000);   // the shot after the cut
  await ev(() => { window.app.select([]); window.app.player.seek(54000); document.activeElement?.blur?.(); window.app.commands.run('tracking.groups'); });
  await page.waitForTimeout(400);
  const acc = page.getByRole('button', { name: 'Accept re-found' });
  ok(await acc.count() === 1, 'the Groups tool on the shot after the cut offers "Accept re-found"');
  await shot('5-refound');
  if (await acc.count()) await acc.click();
  await page.waitForTimeout(250);
  ok(await ev(() => window.app.doc.scenes[5].groups.every((g) => !g.unconfirmed) && window.app.doc.scenes[5].groups.length === 2), 'Accept: the re-found group is confirmed, the group of the first shot untouched');
  console.log(fails ? `${fails} FAILED` : 'all ok');
} finally {
  await browser.close();
  if (vite) { try { process.platform === 'win32' ? spawnSync('taskkill', ['/T', '/F', '/PID', String(vite.pid)], { windowsHide: true }) : vite.kill(); } catch { /* gone */ } }
}
process.exit(fails ? 1 : 0);
