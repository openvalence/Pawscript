// dev/mods-suggest-check.mjs -- paw-h2e2: the Modifiers row's suggestion strip (paint balls for its own run, balls -> spurts,
// detect cumshots) never lies over a modifier: in an empty stretch of the row when one holds it, else folded into a "suggest"
// button whose popover holds the same controls; a press on a modifier's top edge reaches the row. In YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env), a video open (30 s or longer):   node dev/mods-suggest-check.mjs [shot.png]
import { connectTestApp } from './cdp-connect.mjs';
const [shot] = process.argv.slice(2);
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
await ev(() => {
  const S = (a, b, o = {}) => ({ start_ms: a * 1000, end_ms: b * 1000, ...o }), A = ['anal', 'penetration'];
  app.doc.scenes = [S(0, 10, { tags: A }), S(10, 20, { tags: A }), S(20, 30, { tags: A })];
  const M = (id, kind, a, b) => ({ id, kind, t0: a * 1000, t1: b * 1000, params: {} });
  app.doc.fx = [M('k', 'knotting', 2, 8), M('o', 'orgasm', 21, 29.5), M('s1', 'spurt', 22, 22), M('s2', 'spurt', 23.2, 23.2), M('s3', 'spurt', 24.1, 24.1)];
  app.setMode?.('track'); app.setView({ start: 0, span: 30000 }); app.player.seek(25000);
});
await wait(800);
const geo = () => ev(() => {
  const R = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return q.width ? { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom } : null; };
  const c = document.querySelector('[data-tl-lane="fx"] canvas').getBoundingClientRect(), v = app.view, X = (t) => c.left + ((t - v.start) / v.span) * c.width;
  const s = document.querySelector('.fx .sug');
  const blocks = app.doc.fx.map((e) => (e.kind === 'spurt' ? [X(e.t0) - 7, X(e.t0) + 7] : [X(e.t0), X(e.t1)]));
  return { strip: getComputedStyle(s).visibility === 'visible' ? R(s) : null, btn: R(document.querySelector('.fx .sugbtn')), blocks, top: c.top + 4,
    atOrgasm: document.elementFromPoint(X(26000), c.top + 4)?.tagName };
});
const clear = (r, blocks) => !!r && blocks.every(([a, z]) => r.x1 <= a || r.x0 >= z);
let g = await geo();
ok(clear(g.strip, g.blocks), `whole clip: the strip is in an empty stretch (${g.strip ? Math.round(g.strip.x0) + '..' + Math.round(g.strip.x1) : 'not shown'})`);
ok(g.atOrgasm === 'CANVAS', `a press on the orgasm's top edge reaches the row (${g.atOrgasm})`);
await ev(() => app.setView({ start: 22000, span: 6000 })); await wait(600);
g = await geo();
ok(!g.strip && !!g.btn, `zoomed into the orgasm: no room, the strip is folded into "suggest"`);
await page.mouse.click((g.btn.x0 + g.btn.x1) / 2, (g.btn.y0 + g.btn.y1) / 2); await wait(400);
const pop = await ev(() => [...document.querySelectorAll('.k-popover.fx-sug button')].map((x) => x.textContent.trim()));
ok(pop.some((t) => /detect cumshots/.test(t)), `its popover holds the controls: ${pop.join(' | ')}`);
if (shot) await page.screenshot({ path: shot });
await page.keyboard.press('Escape');
await b.close();
process.exit(fails ? 1 : 0);
