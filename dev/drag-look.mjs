// dev/drag-look.mjs -- paw-ef73.22 in YOUR test instance: drag a scene boundary / a shot cut on the Scenes row, read the
// computed cursors over a fade handle / a cut / a body, press-drag a fade-less shot edge (no fade made), the frame
// cursor and the pink playhead after the step keys. node dev/drag-look.mjs <project.pawproj> <out-dir>
import { mkdirSync } from 'node:fs';
import { connectTestApp } from './cdp-connect.mjs';
const [proj, out = '.'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { page } = await connectTestApp();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 300)));
const wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
await page.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
if (!(await page.evaluate(() => window.app.doc.media?.path))) await page.evaluate((p) => window.app.project.openProject(p, { force: true }), proj);
await page.waitForFunction(() => window.app.doc.media && window.app.doc.scenes?.length, null, { timeout: 60000 });
await page.evaluate(() => { window.app.setMode?.('scenes'); window.app.player.pause(); });
await page.waitForFunction(() => window.app.saveBlocks?.().transitions?.list?.length > 0, null, { timeout: 180000, polling: 1000 }).catch(() => {});
const ev = (f, a) => page.evaluate(f, a);
const shots = () => ev(() => window.app.doc.scenes.map((s) => ({ s: s.start_ms, e: s.end_ms, j: s.join === true, tags: (s.tags || s.acts || []).length })));
const geom = async () => { const b = await (await page.$('[data-tl-lane="scenes"]')).boundingBox(); const v = await ev(() => ({ ...window.app.view })); const H = b.height, modH = Math.max(8, Math.min(14, Math.round(H * 0.2))), ym = H - modH, split = Math.max(12, Math.round((H - modH) * 0.58)); return { b, v, ym, split, px: (t) => b.x + ((t - v.start) / v.span) * b.width }; };
const cur = () => ev(() => { const el = document.querySelector('[data-tl-lane="scenes"]'); return [getComputedStyle(el).cursor, getComputedStyle(el.querySelector('canvas')).cursor]; });
const L = await shots();
console.log('shots', L.length, 'first', JSON.stringify(L.slice(0, 3)));
const fades = await ev(() => window.app.saveBlocks().transitions?.list || []);
// a scene boundary (the Scenes strip): find i where the scene changes (not join)
const sceneStarts = await ev(() => { const l = window.app.doc.scenes; const r = []; for (let i = 1; i < l.length; i++) if (l[i].join !== true) r.push(i); return r; });
console.log('scene boundaries', sceneStarts.length);
globalThis.__ctx = { L, fades, sceneStarts, geom, cur, ev, wait, ok, page, out, shots };
export { L, fades, sceneStarts, geom, cur, ev, wait, ok, page, out, shots };
if (process.env.ONLY_LOAD) process.exit(0);
