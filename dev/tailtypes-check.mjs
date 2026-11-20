// dev/tailtypes-check.mjs -- paw-210e in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated
// clip (dev/assets/make-clips.sh). The scene types tailjob, tail penetration and facesitting: a scene whose describe saw tail_in_ass
// (with the anal_penetration e621 implies) reads "anal tail penetration" on the Scenes row and the Scene chip, its quick bar shows the
// pressed chip (kit tooltip, no native title) and no penetration chip; "+ What" on another scene lists all three and adds each in one
// undo step; tail penetration with no where outlines the where chips ("pick where").
//   node dev/tailtypes-check.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('[pageerror]', String(e.message).slice(0, 300)); });
try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  await ev(() => {   // what the lanes paint: every fillText on a timeline lane's canvas, by lane (as dancing-check)
    window.__ft = [];
    const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { const l = this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane'); if (l) window.__ft.push([l, String(t)]); return o.call(this, t, ...a); };
  });
  const dur = await ev(() => Math.round(app.doc.media?.duration_ms || app.player.duration * 1000 || 10000));
  const mid = Math.round(dur / 2);
  await ev(([m, d]) => {
    app.setMode('scenes'); app.player.pause();
    const tail = { tags: [{ tag: 'tail_in_ass', score: 0.9 }, { tag: 'anal_penetration', score: 0.9 }], summary: { acts: ['anal_penetration'], positions: [], views: [], count: 'duo', rating: 'explicit' } };
    app.doc.scenes = [{ start_ms: 0, end_ms: m, describe: tail }, { start_ms: m, end_ms: d }];
    app.setView({ start: 0, span: d });
    app.player.seek(Math.round(m / 2), { exact: true });
  }, [mid, dur]);
  await wait(1200);
  const painted = async (lane) => { await ev((d) => { window.__ft = []; app.setView({ start: 0, span: d + 1 }); }, dur); await wait(250); await ev((d) => app.setView({ start: 0, span: d }), dur); await wait(400); return ev((l) => window.__ft.filter(([x]) => x === l).map(([, t]) => t), lane); };
  const rowText = (await painted('scenes')).join(' | ');
  ok(/anal tail penetration/.test(rowText), `the Scenes row paints "anal tail penetration" (${rowText.slice(0, 160)})`);
  const chip = await ev(() => document.querySelector('[data-chip="scene"] .txt')?.textContent ?? '');
  ok(/tail penetration/.test(chip), `the Scene chip names it: "${chip}"`);
  await page.click('[data-chip="scene"]'); await wait(400);
  const pressed = page.locator('.qb button:visible[aria-pressed="true"]', { hasText: /^\s*tail penetration\s*$/ });
  ok(await pressed.count() === 1, 'the quick bar shows the tail penetration chip, pressed');
  ok(await pressed.first().getAttribute('title') == null, 'no native title on it');
  ok(await page.locator('.qb button:visible[aria-pressed="true"]', { hasText: /^\s*penetration\s*$/ }).count() === 0, 'no plain penetration chip (hidden: no penis in it)');
  await page.screenshot({ path: `${out}/1-tailpen-chip.png` });
  await page.keyboard.press('Escape'); await wait(300);

  // + What on the empty scene: each of the three is offered and added in one undo step
  await ev((t) => app.player.seek(t, { exact: true }), Math.round((mid + dur) / 2)); await wait(500);
  for (const [label, id] of [['tailjob', 'tailjob'], ['facesitting', 'facesitting'], ['tail penetration', 'tailpen']]) {
    await page.click('[data-chip="scene"]'); await wait(400);
    const n0 = await ev(() => app._history.entries.length);
    await page.locator('.qb button:visible', { hasText: /^\s*What\s*$/ }).first().click(); await wait(400);
    const item = page.locator(`.k-menu .k-item:has(.k-item-label:text-is("${label}"))`);
    ok(await item.count() === 1, `"+ What" lists ${label}`);
    if (id === 'tailjob') await page.screenshot({ path: `${out}/2-what-menu.png` });
    await item.first().click(); await wait(400);
    const tags = await ev(() => app.doc.scenes[1].tags || []);
    ok(tags.includes(id) && (await ev(() => app._history.entries.length)) === n0 + 1, `${label} added in one undo step: ${JSON.stringify(tags)}`);
    await page.keyboard.press('Escape'); await wait(300);
  }
  await page.click('[data-chip="scene"]'); await wait(400);
  ok(await page.locator('.qb .k-hint:visible', { hasText: 'pick where' }).count() === 1, 'tail penetration with no where: "pick where"');
  await page.screenshot({ path: `${out}/3-three-added.png` });
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
