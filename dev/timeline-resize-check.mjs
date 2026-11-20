// dev/timeline-resize-check.mjs -- paw-1l5p: the timeline section's top border (against the video) drags in every tab, with one
// lane and with several, also when the video sits at its minimum and the bottom dock is open (the room then comes out of the dock);
// the size survives a tab switch; double-click = default. Real pointer events over CDP.
//   CDP_* env from `node dev/test-app.mjs start ...`;  node dev/timeline-resize-check.mjs <video path>
import { connectTestApp } from './cdp-connect.mjs';
const { browser, page: p } = await connectTestApp();
let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const wait = (ms) => p.waitForTimeout(ms);
const h = (a) => p.evaluate((a) => Math.round(document.querySelector(`.areas > [data-area=${a}]`)?.getBoundingClientRect().height || 0), a);
const border = () => p.evaluate(() => { const ty = document.querySelector('.areas > [data-area=timeline]').getBoundingClientRect().y; const e = [...document.querySelectorAll('.areas .border [role=separator][aria-orientation=horizontal]')].find((x) => Math.abs(x.parentElement.getBoundingClientRect().y - ty) < 3); const r = e.parentElement.getBoundingClientRect(); return { y: r.y, x: 700 }; });
async function drag(dy) { const b = await border(); await p.mouse.move(b.x, b.y); await p.mouse.down(); for (let k = 1; k <= 10; k++) await p.mouse.move(b.x, b.y + dy * k / 10); await p.mouse.up(); await wait(250); }
try {
  await p.waitForFunction(() => window.app?.project, null, { timeout: 30000 });
  await p.evaluate((v) => window.app.project.openVideo(v), process.argv[2]);
  await wait(1500);
  for (const mode of ['scenes', 'track', 'refine', 'review']) {
    for (const [name, open, many] of [['only the lanes row, dock folded', false, false], ['all rows, dock open', true, true]]) {
      await p.evaluate(([m, o, many]) => { const a = window.app; a.layout.reset(); a.setMode(m); a.layout.toggle('bottom', o); a.layout.size('timeline', 260); if (!many) for (const id of ['timeline.scenes', 'timeline.waveform', 'timeline.loops', 'timeline.plan', 'tracking', 'graph.probe']) a.layout.setRow(id, { collapsed: true }); }, [mode, open, many]);
      await wait(400);
      const t0 = await h('timeline');
      await drag(-60);
      const t1 = await h('timeline');
      ok(t1 > t0, `${mode} ${name}: drag up grows the section ${t0} -> ${t1}`);
      await drag(40);
      const t2 = await h('timeline');
      ok(t2 < t1, `${mode} ${name}: drag down shrinks it ${t1} -> ${t2}`);
    }
  }
  // video at its minimum, dock open: the old dead end
  await p.evaluate(() => { const a = window.app; a.layout.reset(); a.setMode('track'); a.layout.toggle('bottom', true); a.layout.size('bottom', 400); a.layout.size('timeline', 900); });
  await wait(400);
  const [v0, t0, d0] = [await h('video'), await h('timeline'), await h('bottom')];
  await drag(-80);
  const [v1, t1, d1] = [await h('video'), await h('timeline'), await h('bottom')];
  ok(v0 === 200 && v1 === 200, `video held at its minimum (${v0} -> ${v1})`);
  ok(t1 > t0 && d1 < d0, `timeline ${t0} -> ${t1} took the room from the dock ${d0} -> ${d1}`);
  // persistence over a tab switch and back, then double-click = default
  for (const m of ['refine', 'track']) { await p.evaluate((m) => window.app.setMode(m), m); await wait(300); }
  ok(Math.abs(await h('timeline') - t1) <= 1 && Math.abs(await h('bottom') - d1) <= 1, `sizes kept after a tab switch (${await h('timeline')} / ${await h('bottom')})`);
  await p.evaluate(() => { const a = window.app; a.layout.toggle('bottom', false); });
  await wait(300);
  const b = await border();
  await p.mouse.dblclick(b.x, b.y); await wait(300);
  const def = await p.evaluate(() => window.app.layout.cur.timeline.size);
  ok(def === Math.round(Math.max(360, 1000 * 0.45)) + 24 && await h('timeline') === def, `double-click: default ${def}`);
} catch (e) { fails++; console.log('ERR', e); }
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
