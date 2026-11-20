// dev/scenes-gestures.mjs -- every timeline view gesture over every row of a tab, in YOUR test instance
// (node dev/test-app.mjs start ...; the CDP_* env it prints), a video with scenes open (paw-ef73.7):
//   node dev/scenes-gestures.mjs [tab ...]      (default: scenes track)
// Per row: middle-drag pans, Space+drag pans, wheel zooms, Shift+wheel pans, Ctrl+wheel (pinch) zooms; the scrub rows
// (the ruler's top, the filmstrip in Scenes) seek on a left-drag. Prints one line per row; exits 1 on a failure.
import { connectTestApp } from './cdp-connect.mjs';
const tabs = process.argv.slice(2).length ? process.argv.slice(2) : ['scenes', 'track'];
const { browser: b, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
let bad = 0;
const ok = (c, msg) => { if (!c) bad++; return c ? 'ok' : 'FAIL ' + msg; };
for (const tab of tabs) {
  await ev((m) => { app.setMode(m); app.player.pause(); }, tab);
  await page.waitForTimeout(600);
  const rows = await ev(() => [...document.querySelectorAll('.stack > .row')].filter((r) => r.getClientRects().length && r.querySelector('canvas'))
    .map((r) => { const q = r.querySelector('canvas').getBoundingClientRect(); return { name: r.querySelector('[data-tl-lane]')?.dataset.tlLane || r.querySelector('.lrow') && 'lanes' || '?', x: q.left, y: q.top, w: q.width, h: q.height }; }));
  for (const r of rows) {
    const y = r.y + Math.min(r.h - 3, Math.max(3, r.h * 0.5)), x = r.x + r.w * 0.5;
    const reset = () => ev(() => { app.setView({ start: 20000, span: 40000 }); app.player.seek(10000); });
    const view = () => ev(() => ({ ...app.view }));
    const res = [];
    await reset(); await page.mouse.move(x, y); let v0 = await view();
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(x - 200, y, { steps: 5 }); await page.mouse.up({ button: 'middle' });
    res.push('middle-drag ' + ok((await view()).start > v0.start + 1, 'no pan'));
    await reset(); await page.mouse.move(x, y); v0 = await view();
    await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(x - 200, y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space');
    await ev(() => app.player.pause());
    res.push('space-drag ' + ok((await view()).start > v0.start + 1, 'no pan'));
    await reset(); await page.mouse.move(x, y); v0 = await view();
    await page.mouse.wheel(0, 300); await page.waitForTimeout(100);
    res.push('wheel ' + ok((await view()).span > v0.span * 1.05, 'no zoom'));
    await reset(); await page.mouse.move(x, y); v0 = await view();
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, 300); await page.keyboard.up('Shift'); await page.waitForTimeout(100);
    const vs = await view(); res.push('shift-wheel ' + ok(vs.start !== v0.start && Math.abs(vs.span - v0.span) < 1, 'no pan'));
    await reset(); await page.mouse.move(x, y); v0 = await view();
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -40); await page.keyboard.up('Control'); await page.waitForTimeout(100);
    res.push('ctrl-wheel ' + ok((await view()).span !== v0.span, 'no zoom'));
    if (r.name === 'ruler' || r.name === 'filmstrip') {
      await reset(); const yy = r.name === 'ruler' ? r.y + 12 : y;
      await page.mouse.move(r.x + r.w * 0.2, yy); await page.mouse.down(); await page.mouse.move(r.x + r.w * 0.7, yy, { steps: 6 }); await page.waitForTimeout(150);
      const t = await ev(() => app.player.timeMs); await page.mouse.up();
      res.push('left-drag scrub ' + ok(t > 30000, 'playhead stayed at ' + t));
    }
    await page.keyboard.press('Escape');
    console.log(`${tab} ${r.name}: ${res.join(' · ')}`);
  }
}
await ev(() => app.setMode('scenes'));
await b.close();
process.exit(bad ? 1 : 0);
