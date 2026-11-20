// dev/lanes-resize-check.mjs -- paw-3lmy: inside the timeline section the rows and the lanes share its height. The row splitter
// above the lanes moves height between its neighbours and never makes anything scroll; the last lane's bottom grip (the lone lane's
// too) and Ctrl+wheel over it resize the section itself (from the open bottom dock, else from the video); double-click = default;
// sizes survive a tab switch; an empty lane draws no "Empty lane" hint (owner 2026-11-15: removed). Every tab, 1600x1000 and 1100x700.
// Real pointer events over CDP.   CDP_* env from `node dev/test-app.mjs start ...`;  node dev/lanes-resize-check.mjs <video path>
import { connectTestApp } from './cdp-connect.mjs';
const { browser, page: p } = await connectTestApp();
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const wait = (ms) => p.waitForTimeout(ms);
const cdp = await p.context().newCDPSession(p);
const size = (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: false });

// what the owner sees: the areas, the fill row, every lane canvas, and each scroll container in the section that overflows
const S = () => p.evaluate(() => {
  const H = (q) => Math.round(document.querySelector(q)?.getBoundingClientRect().height || 0);
  const tl = document.querySelector('.areas > [data-area=timeline]');
  const over = [...tl.querySelectorAll('*')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight)
    .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => !c.startsWith('s-') && !c.startsWith('svelte-')).join('.')} ${e.scrollHeight}>${e.clientHeight}`);
  // the rows' minimums (16 px a fixed row, the fill row's min-height, the 1 px splitters, the folded strip): past the section, scrolling is the rule
  const st = tl.querySelector('.stack.k-scroll'), fillEl = st.querySelector(':scope > .row.fill');
  const need = st.querySelectorAll(':scope > .row:not(.fill)').length * 16 + (fillEl ? parseFloat(getComputedStyle(fillEl).minHeight) : 0) + st.querySelectorAll(':scope > [role=separator]').length + (st.querySelector(':scope > .folded')?.offsetHeight || 0);
  return { cramped: need > st.clientHeight, need, sec: H('.areas > [data-area=timeline]'), video: H('.areas > [data-area=video]'), dock: H('.areas > [data-area=bottom]'), fill: H('[data-area=timeline] .row.fill'),
    lanes: [...tl.querySelectorAll('.lrow .canvas')].map((e) => Math.round(e.getBoundingClientRect().height)), over };
});
const fmt = (s) => `section ${s.sec} video ${s.video} dock ${s.dock} fill ${s.fill} lanes [${s.lanes}]${s.over.length ? ' OVERFLOW ' + s.over.join(', ') : ''}${s.cramped ? ` (minimums ${s.need} do not fit)` : ''}`;
const calm = (s) => !s.over.length || s.cramped;   // nothing scrolls, unless the minimums alone do not fit
async function drag(pt, dy) {
  await p.mouse.move(pt.x, pt.y);
  if (process.env.DBG) console.log('  hit', pt, await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && (e.className || e.tagName); }, pt));
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) await p.mouse.move(pt.x, pt.y + (dy * k) / 12);
  await p.mouse.up(); await wait(300);
}
const center = (sel) => p.evaluate((sel) => { const e = eval(sel); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, sel);
const ROWSPLIT = `document.querySelector('[data-area=timeline] .row.fill')?.previousElementSibling?.matches('[role=separator]') && document.querySelector('[data-area=timeline] .row.fill').previousElementSibling`;
const LASTGRIP = `[...document.querySelectorAll('[data-area=timeline] .lrow .split')].at(-1)`;
const CANVAS = `[...document.querySelectorAll('[data-area=timeline] .lrow .canvas')].at(-1)`;

async function setup(mode, { dock = false, lanes = ['stroke'] } = {}) {
  await p.evaluate(([m, dock, lanes]) => {
    const a = window.app; a.layout.reset(); a.setMode(m); a.layout.toggle('bottom', dock);
    a.settings.set('lanes.layout', { order: [], h: {}, collapsed: {}, hidden: {}, locked: {}, ghostsOff: {} });
    a.doc.axes = Object.fromEntries(lanes.map((id) => [id, []]));
  }, [mode, dock, lanes]);
  await wait(500);
}

try {
  await p.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  // open the clip; a "Save changes?" for the last run's edits: Discard
  let opened = false;
  const opening = p.evaluate((v) => window.app.project.openVideo(v), process.argv[2]).then(() => (opened = true));
  for (let k = 0; k < 40 && !opened; k++) { await p.evaluate(() => [...document.querySelectorAll('.k-dialog.choice button')].find((x) => x.offsetParent && /Discard/.test(x.textContent))?.click()); await wait(250); }
  await opening; await wait(1500);
  for (const [W, Hh] of [[1600, 1000], [1100, 700]]) {
    await size(W, Hh); await wait(400);
    console.log(`--- window ${W}x${Hh}`);
    for (const mode of ['scenes', 'track', 'refine', 'review']) {
      for (const dock of [false, true]) {
        const tag = `${W}x${Hh} ${mode} dock ${dock ? 'open' : 'folded'}`;
        await setup(mode, { dock });
        const s0 = await S();
        console.log(`${tag}: start ${fmt(s0)}`);
        ok(calm(s0), `${tag}: nothing scrolls at the start`);
        // (2) the row splitter above the lanes (or the filmstrip): down past the fill's minimum, then back up
        const rs = await center(ROWSPLIT);
        if (rs) {
          await drag(rs, 300);
          const s1 = await S();
          console.log(`${tag}: row splitter +300 -> ${fmt(s1)}`);
          ok(calm(s1), `${tag}: row splitter dragged down: nothing scrolls`);
          ok(s1.sec === s0.sec, `${tag}: the section keeps its height (${s0.sec} -> ${s1.sec})`);
          ok(s1.fill < s0.fill || s0.fill <= 180, `${tag}: the fill row gave the room (${s0.fill} -> ${s1.fill})`);
          await drag(await center(ROWSPLIT), -200);
          const s2 = await S();
          ok(calm(s2) && (s2.fill > s1.fill || s1.cramped), `${tag}: row splitter back up: the fill grows ${s1.fill} -> ${s2.fill}, nothing scrolls`);
        }
        if (mode === 'scenes') continue;
        // (1) the lone lane's bottom grip
        await setup(mode, { dock });
        const t0 = await S();
        if (t0.cramped) { console.log(`${tag}: the rows' minimums do not fit: the section scrolls, grip not driven`); continue; }
        const g = await center(LASTGRIP);
        if (!g) { ok(false, `${tag}: no grip under the lone lane`); continue; }
        await drag(g, 60);
        const t1 = await S();
        console.log(`${tag}: lone lane grip +60 -> ${fmt(t1)}`);
        const stuck = !dock && t0.video <= 200;   // the video at its minimum and no dock: nothing to trade with downward
        if (stuck) ok(t1.sec === t0.sec && t1.lanes[0] === t0.lanes[0], `${tag}: video at its minimum, dock folded: grip down holds (${t0.sec} -> ${t1.sec})`);
        // paw-s3ex: with the tray open the section's bottom edge is also the area border; the grip must be the one pressed
        else ok(t1.sec > t0.sec && t1.lanes[0] > t0.lanes[0], `${tag}: grip down grows the lane ${t0.lanes[0]} -> ${t1.lanes[0]} and the section ${t0.sec} -> ${t1.sec}`);
        if (!stuck) ok(dock ? t1.dock < t0.dock && t1.video === t0.video : t1.video < t0.video, `${tag}: traded with the ${dock ? 'dock' : 'video'} (video ${t0.video} -> ${t1.video}, dock ${t0.dock} -> ${t1.dock})`);
        ok(calm(t1), `${tag}: nothing scrolls after the grip drag`);
        await drag(await center(LASTGRIP), -40);
        const t2 = await S();
        ok((t2.sec < t1.sec || t1.fill <= 180) && calm(t2), `${tag}: grip up shrinks it ${t1.sec} -> ${t2.sec} (or the lanes row sits at its minimum ${t1.fill})`);
        // Ctrl+wheel over the lane: the same rule
        const c = await center(CANVAS);
        await p.mouse.move(c.x, c.y); await p.keyboard.down('Control'); await p.mouse.wheel(0, -100); await p.keyboard.up('Control'); await wait(300);
        const t3 = await S();
        console.log(`${tag}: Ctrl+wheel up -> ${fmt(t3)}`);
        ok((stuck && t2.video <= 200 ? t3.sec === t2.sec : t3.lanes[0] > t2.lanes[0] && t3.sec > t2.sec) && calm(t3), `${tag}: Ctrl+wheel grows the lane ${t2.lanes[0]} -> ${t3.lanes[0]} with the section, nothing scrolls`);
        // persistence over a tab switch and back
        for (const m of [mode === 'refine' ? 'track' : 'refine', mode]) { await p.evaluate((m) => window.app.setMode(m), m); await wait(300); }
        const t4 = await S();
        ok(Math.abs(t4.sec - t3.sec) <= 1 && Math.abs(t4.lanes[0] - t3.lanes[0]) <= 1, `${tag}: kept after a tab switch (${t3.sec}/${t3.lanes[0]} -> ${t4.sec}/${t4.lanes[0]})`);
        // double-click the grip: the lane's default height (168 for the stroke); with the tray open it reset the section instead (paw-s3ex)
        const gg = await center(LASTGRIP);
        await p.mouse.dblclick(gg.x, gg.y); await wait(300);
        const t5 = await S();
        const spent = t5.video <= 200 && (!dock || t5.dock <= 121);   // nothing left to trade with
        ok(Math.abs(t5.lanes[0] - 168) <= 1 || t5.fill <= 181 || spent, `${tag}: double-click: lane ${t5.lanes[0]} (default 168, or nothing left to trade: video ${t5.video} dock ${t5.dock})`);
      }
    }
    // several lanes: the grip between two lanes trades between them; the last lane's grip resizes the section
    await setup('track', { dock: true, lanes: ['stroke', 'surge'] });
    await p.evaluate(() => { const a = window.app; a.layout.size('bottom', 170); for (const id of ['tracking', 'timeline.scenes', 'timeline.overview']) a.layout.setRow(id, { collapsed: true }); }); await wait(400);
    const m0 = await S();
    await drag(await center(LASTGRIP), 50);
    const m1 = await S();
    console.log(`${W}x${Hh} two lanes: last grip +50 -> ${fmt(m1)}`);
    ok(m1.sec > m0.sec && m1.lanes[1] > m0.lanes[1] && Math.abs(m1.lanes[0] - m0.lanes[0]) <= 1 && calm(m1), `two lanes: the last grip grows the last lane [${m0.lanes}] -> [${m1.lanes}] and the section ${m0.sec} -> ${m1.sec}`);
    await drag(await center(`document.querySelector('[data-area=timeline] .lrow .split')`), 30);
    const m2 = await S();
    console.log(`${W}x${Hh} two lanes: first grip +30 -> ${fmt(m2)}`);
    ok(m2.sec === m1.sec && m2.lanes[0] > m1.lanes[0] && m2.lanes[1] < m1.lanes[1] && m2.lanes[0] + m2.lanes[1] === m1.lanes[0] + m1.lanes[1] && calm(m2), `two lanes: the first grip moves height between them [${m1.lanes}] -> [${m2.lanes}]`);
  }
  // (4) paw-oben: a clicked row splitter is the editor selection: ArrowDown moves it 8 px (no frame step), Esc lets go and
  // ArrowRight steps a frame again; a drag selects nothing
  await size(1600, 1000); await setup('refine');
  const vNow = () => p.evaluate((sel) => +eval(sel).getAttribute('aria-valuenow'), ROWSPLIT);
  const tNow = () => p.evaluate(() => Math.round(window.app.player.timeMs));
  await p.evaluate(() => window.app.player.seek(2000)); await wait(400);
  const rc = await center(ROWSPLIT);
  await p.mouse.click(rc.x, rc.y); await wait(200);
  const k0 = await vNow(), f0 = await tNow();
  await p.keyboard.press('ArrowDown'); await wait(300);
  const k1 = await vNow(), f1 = await tNow();
  ok(k1 === k0 + 8 && f1 === f0, `a clicked row splitter: ArrowDown moves it ${k0} -> ${k1} (8 px), the playhead stays (${f0} -> ${f1})`);
  await p.keyboard.press('Escape'); await wait(200); await p.keyboard.press('ArrowRight'); await wait(400);
  const k2 = await vNow(), f2 = await tNow();
  ok(k2 === k1 && f2 > f1, `after Esc ArrowRight steps a frame (${f1} -> ${f2}), the splitter stays (${k1} -> ${k2})`);
  await drag(await center(ROWSPLIT), 20);
  const k3 = await vNow(), f3 = await tNow();
  await p.keyboard.press('ArrowRight'); await wait(400);
  ok((await vNow()) === k3 && (await tNow()) > f3, `after a splitter drag ArrowRight steps a frame (${f3} -> ${await tNow()}), the splitter stays ${k3}`);
  await setup('refine');   // the Refine layout back to its default for the checks after this one (layouts persist)
  // (3) no hint text over an empty lane, with or without a ghost (owner 2026-11-15: "remove the empty lane press 0-9 text")
  await size(1600, 1000); await setup('track');
  const texts = (ghost) => p.evaluate(async (ghost) => {
    const a = window.app, P = CanvasRenderingContext2D.prototype, o = P.fillText, seen = [];
    P.fillText = function (t, ...r) { seen.push(String(t)); return o.call(this, t, ...r); };
    a.doc.ghosts = ghost ? [{ id: 'chk-run', name: 'run', color: '#5ac8fa', visible: true, script: Array.from({ length: 400 }, (_, i) => ({ at: i * 250, pos: i % 2 ? 90 : 10 })) }] : [];
    a.setView({ ...a.view, start: 1000 });
    await new Promise((r) => setTimeout(r, 300));
    P.fillText = o;
    return seen.some((t) => t.startsWith('Empty lane'));
  }, ghost);
  ok(!(await texts(false)), 'no hint over a truly empty lane');
  ok(!(await texts(true)), 'no hint over a lane showing a ghost');
  await p.evaluate(() => { window.app.doc.ghosts = []; });
} catch (e) { fails++; console.log('ERR', e); }
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
