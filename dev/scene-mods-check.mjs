// dev/scene-mods-check.mjs -- paw-8b4h in YOUR test instance (node dev/test-app.mjs start ...; the CDP_* env it prints), on a generated
// clip (ffmpeg testsrc2, 40 s). Orgasm / knotting are modifiers only: every scene control (the quick bar chip, the Scenes row's menu,
// the key, the tagger's dashed suggestion on the Modifiers row) adds the modifier over the scene, the scene label stays its action.
// Asserts on what is painted (the canvas text the lanes draw, the chip and popover DOM) and on doc.fx:
//  - the label never gains "orgasm"; the Modifiers row gains one spanning the scene; undo removes it in one step; again: off;
//  - a trimmed one overlapping the scene is selected instead of a second one;
//  - the tagger's detected orgasm is a dashed suggestion on the Modifiers row, a click there makes the modifier.
//   node dev/scene-mods-check.mjs <clip.mp4> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
import { stripLayout, layersIn } from '../src/features/timeline/actions-strip.js';
const [clip, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const S2 = [10000, 25000];   // scene 2: the one the controls act on (its describe saw a cumshot)
try {
  await ev((p) => { app.project.openVideo(p, { force: true }); }, clip);
  for (let k = 0; k < 6; k++) { await wait(500); await ev(() => { if (app.dialog) app.dialog.resolve('restore'); }); }
  await page.waitForFunction(() => app.doc.media && (app.player.error || (app.player.ready && app.player.vw > 0)), null, { timeout: 60000 });
  // what the lanes paint: every fillText on a timeline lane's canvas, by lane
  await ev(() => {
    window.__ft = [];
    const o = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { const l = this.canvas?.closest?.('[data-tl-lane]')?.getAttribute('data-tl-lane'); if (l) window.__ft.push([l, String(t)]); return o.call(this, t, ...a); };
  });
  await ev(([a, z]) => {
    app.setMode('scenes'); app.player.pause();
    const cum = { tags: [{ tag: 'cumshot', score: 0.9 }], summary: { acts: ['anal_penetration'], positions: [], views: [], count: 'duo' } };
    app.doc.scenes = [{ start_ms: 0, end_ms: a, tags: ['anal', 'penetration'] }, { start_ms: a, end_ms: z, tags: ['anal', 'penetration'], describe: cum }, { start_ms: z, end_ms: 40000, tags: ['oral', 'penetration'] }];
    app.doc.fx = []; app.doc.range = null;
    app.setView({ start: 0, span: 40000 });
    app.player.seek(15000, { exact: true });
  }, S2);
  await wait(1200);
  const fx = () => ev(() => (app.doc.fx || []).map((e) => [e.kind, e.t0, e.t1]));
  const painted = async (lane) => { await ev(() => { window.__ft = []; app.setView({ start: 0, span: 40001 }); }); await wait(250); await ev(() => app.setView({ start: 0, span: 40000 })); await wait(400); return ev((l) => window.__ft.filter(([x]) => x === l).map(([, t]) => t), lane); };
  const label = async () => (await painted('scenes')).filter((t) => t.startsWith('· ')).join(' | ');
  const sceneChip = () => ev(() => document.querySelector('[data-chip="scene"] .txt')?.textContent ?? '');
  const lane = async (name) => ev((n) => { const r = document.querySelector(`[data-tl-lane="${n}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, name);
  const xAt = (r, t) => r.x + (t / 40000) * r.w;
  const steps = () => ev(() => app._history.entries.length);
  const reset = () => ev(() => { app.doc.fx = []; app.doc.range = null; });
  const span2 = [['orgasm', S2[0], S2[1]]];

  ok(!(await label()).includes('orgasm'), `before: the Scenes row's labels say no orgasm (${await label()})`);
  ok((await painted('fx')).some((t) => t.startsWith('orgasm? tagger')), 'the tagger\'s detected orgasm is a dashed suggestion on the Modifiers row');
  await page.screenshot({ path: `${out}/0-suggestion.png` });

  // ---- 1. the quick bar chip (the Scene chip's popover, the scene at the playhead) ----
  await page.click('[data-chip="scene"]'); await wait(400);
  const n0 = await steps();
  await page.click('[data-mod="orgasm"]'); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify(span2), `chip: the Modifiers row gains one spanning scene 2 (${JSON.stringify(await fx())})`);
  ok((await steps()) === n0 + 1, 'chip: one undo step');
  ok(await ev(() => !!document.querySelector('.modspan.on')), 'chip: the new modifier is selected (its chip in the scene popover is lit)');
  ok(!(await sceneChip()).includes('orgasm') && !(await label()).includes('orgasm'), `chip: the scene label stays the action (chip "${await sceneChip()}", row "${await label()}")`);
  ok(!(await painted('fx')).some((t) => t.startsWith('orgasm? tagger')), 'chip: the suggestion is gone once the scene has one');
  await page.screenshot({ path: `${out}/1-chip.png` });
  await ev(() => app.undo()); await wait(300);
  ok((await fx()).length === 0, 'chip: undo removes it in one step');
  await page.click('[data-mod="orgasm"]'); await wait(300); await page.click('[data-mod="orgasm"]'); await wait(300);
  ok((await fx()).length === 0, 'chip: pressed again, it toggles off');
  await page.keyboard.press('Escape'); await wait(300);

  // ---- 2. the key (Alt+Shift+O; the lane has the keyboard) ----
  await reset();
  const sc = await lane('scenes');
  await page.mouse.click(xAt(sc, 17000), sc.y + sc.h * 0.3); await wait(400);   // a click on scene 2's block: selects it (the range follows)
  await page.keyboard.press('Alt+Shift+O'); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify(span2), `key: Alt+Shift+O adds one spanning scene 2 (${JSON.stringify(await fx())})`);
  ok(!(await label()).includes('orgasm'), 'key: the label stays the action');
  await page.keyboard.press('Alt+Shift+O'); await wait(400);
  ok((await fx()).length === 0, 'key: again, off');
  await page.keyboard.press('Alt+Shift+N'); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify([['knotting', S2[0], S2[1]]]), `key: Alt+Shift+N adds knotting over scene 2 (${JSON.stringify(await fx())})`);
  ok(!(await label()).includes('knotting'), 'key: the label never says knotting');

  // ---- 3. the Scenes row's right-click > Modifier > Orgasm ----
  await reset();
  // 57ea40a (paw-2lp7.5): the row's top is the Actions strip (an action's own right-click); the scene / shot menu with its
  // Modifier submenu is the shots strip's under it
  const acts = await ev(() => app.doc.acts || []), L = stripLayout(sc.h, layersIn(acts, 0, 40000));
  await page.mouse.click(xAt(sc, 17000), sc.y + (L.y1 + sc.h) / 2, { button: 'right' }); await wait(400);
  await page.click('.k-menu .k-item:has(.k-item-label:text-is("Modifier"))'); await wait(400);
  await page.click('.k-menu .k-item:has(.k-item-label:text-is("Orgasm"))'); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify(span2), `menu: Modifier > Orgasm adds one spanning scene 2 (${JSON.stringify(await fx())})`);
  ok(!(await label()).includes('orgasm'), 'menu: the label stays the action');
  await ev(() => app.undo()); await wait(300);
  ok((await fx()).length === 0, 'menu: undo removes it in one step');

  // ---- 4. a trimmed one overlapping the scene is selected, not doubled ----
  await ev(() => { app.doc.fx = [{ id: 'trim', kind: 'orgasm', t0: 12000, t1: 15000, params: {} }]; });
  await page.mouse.click(xAt(sc, 17000), sc.y + sc.h * 0.3); await wait(400);
  const n1 = await steps();
  await page.keyboard.press('Alt+Shift+O'); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify([['orgasm', 12000, 15000]]) && (await steps()) === n1, 'trimmed: no second orgasm, no undo step');
  await page.click('[data-chip="scene"]'); await wait(400);
  ok(await ev(() => document.querySelector('.modspan.on')?.textContent?.includes('0:12.0')), 'trimmed: that one is selected');
  await page.keyboard.press('Escape'); await wait(300);

  // ---- 5. the tagger's suggestion: a click on the dashed box makes it ----
  await reset(); await wait(300);
  const fr = await lane('fx');
  await page.mouse.click(xAt(fr, 20000), fr.y + fr.h / 2); await wait(400);
  ok(JSON.stringify(await fx()) === JSON.stringify(span2), `suggestion: a click on it adds the Orgasm modifier over scene 2 (${JSON.stringify(await fx())})`);
  ok(!(await label()).includes('orgasm'), 'suggestion: the label stays the action');
  await page.screenshot({ path: `${out}/5-after.png` });
} finally { await b.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
