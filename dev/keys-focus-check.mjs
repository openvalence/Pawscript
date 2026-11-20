// dev/keys-focus-check.mjs -- paw-ks21 "space tab and the arrow keys navigate the ui": in YOUR test instance (node dev/test-app.mjs
// start ...; the CDP_* env it prints), real key presses over CDP after real clicks. Asserted:
//   a clicked button / checkbox / summary then Space: playback toggles, the control does not fire again; the app's speed
//     Select focused, Space: plays, its list stays shut;
//   Tab / Shift+Tab: document.activeElement stays where it was;
//   a focused slider (the volume thumb) and a native range / select: an arrow leaves the value alone, the app's arrow ran
//     (ArrowRight = next frame);
//   a text field: Space and the arrows type / move the caret, no app shortcut (the frame stays);
//   an open menu (the transport's More menu) still moves its active row with ArrowDown.
//   node dev/keys-focus-check.mjs <clip.mp4>        exits 1 on any FAIL
import { connectTestApp } from './cdp-connect.mjs';

const [clip] = process.argv.slice(2);
if (!clip) { console.error('usage: node dev/keys-focus-check.mjs <clip.mp4>'); process.exit(2); }
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
page.on('pageerror', (e) => { fails++; console.log('FAIL [pageerror]', String(e.message).slice(0, 300)); });
const settled = () => page.waitForFunction(() => !app.player.seeking && !app.player.scrubbing, null, { timeout: 10000 });
const st = () => ev(() => ({ playing: app.player.playing, frame: app.player.frame, loop: !!app.player.loop, active: document.activeElement?.outerHTML?.slice(0, 80) || '' }));

try {
  await page.waitForFunction(() => window.app && app.player, null, { timeout: 60000 });
  await ev(() => { if (app.dialog) app.dialog.resolve(app.dialog.choices?.some((c) => c.id === 'discard') ? 'discard' : null); app.history?.markSaved?.(); });
  const p = ev((c) => app.project.openVideo(c, { force: true }), clip);
  for (let k = 0; k < 8; k++) { await wait(400); await ev(() => { const d = app.dialog; if (d) d.resolve(/Save changes/.test(d.title || '') ? 'discard' : d.choices?.[0]?.id ?? null); }); }
  await p.catch(() => {});
  await page.waitForFunction(() => app.player.ready && app.player.vw > 0, null, { timeout: 60000 });
  await ev(() => { app.project.stopAutosave?.(); app.player.pause(); app.player.seekFrame(30); }); await settled(); await wait(300);
  // plain controls put in for the check (the browser's own activation is what is under test), over the app
  await ev(() => {
    document.querySelectorAll('#kfc').forEach((n) => n.remove());
    const box = document.createElement('div'); box.id = 'kfc'; box.style.cssText = 'position:fixed;left:10px;top:40px;z-index:99999;background:#222;padding:4px;display:flex;gap:6px';
    box.innerHTML = '<button id="kfc-b">count</button><input type="checkbox" id="kfc-c"><details id="kfc-d"><summary id="kfc-su">more</summary>x</details>'
      + '<input type="range" min="0" max="100" value="50" id="kfc-r"><select id="kfc-s"><option>a</option><option selected>b</option><option>c</option></select><input type="text" id="kfc-t" value="">';
    document.body.append(box);
    window.__kfc = 0; document.getElementById('kfc-b').addEventListener('click', () => window.__kfc++);
  });

  // 1. click a button / checkbox / summary, then Space: play / pause only
  for (const [sel, read, what] of [['#kfc-b', () => window.__kfc, 'button (clicks)'], ['#kfc-c', () => document.getElementById('kfc-c').checked, 'checkbox (checked)'],
    ['#kfc-su', () => document.getElementById('kfc-d').open, 'summary (open)']]) {
    await page.click(sel); await wait(150);
    const a = await st(), x0 = await ev(read);
    ok(/kfc/.test(a.active), `the click left focus on the ${what.split(' ')[0]} (${a.active})`);
    await page.keyboard.press('Space'); await wait(400);
    const b = await st(), x1 = await ev(read);
    ok(b.playing !== a.playing && x1 === x0, `Space on a clicked ${what}: playback toggled (${a.playing} -> ${b.playing}), the control did not fire again (${x0} -> ${x1})`);
    if (b.playing) { await ev(() => app.player.pause()); await settled(); }
  }
  // the app's own Select (speed): Space plays, the list does not open
  await ev(() => document.querySelector('.k-select.speed')?.focus());
  await page.keyboard.press('Space'); await wait(400);
  const sp = await ev(() => ({ open: document.querySelector('.k-select.speed')?.getAttribute('aria-expanded'), playing: app.player.playing }));
  ok(sp.open !== 'true' && sp.playing, `Space on the focused speed Select: plays (${sp.playing}), the list stays shut (aria-expanded ${sp.open})`);
  if (sp.open === 'true') await page.keyboard.press('Escape');
  await ev(() => app.player.pause()); await settled();

  // 2. Tab / Shift+Tab never move focus
  await page.click('#kfc-b');
  const before = await page.evaluateHandle(() => document.activeElement);
  for (const k of ['Tab', 'Shift+Tab', 'Tab']) await page.keyboard.press(k);
  await wait(100);
  ok(await ev((x) => document.activeElement === x, before), `Tab / Shift+Tab: focus stays on the button (${(await st()).active})`);

  // 3. a focused slider: a panel's kit slider (one with room to grow); then the native range and select
  await ev(() => { app.player.seekFrame(30); }); await settled(); await wait(200);
  // its accessible name: aria-label, or the text aria-labelledby points at (a Field's label); every slider on screen has one
  const { label, unnamed } = await ev(() => {
    const name = (n) => n.getAttribute('aria-label') || (n.getAttribute('aria-labelledby') || '').split(/\s+/).map((i) => document.getElementById(i)?.textContent.trim()).filter(Boolean).join(' ');
    const all = [...document.querySelectorAll('.kit-slider-track-thumb[role=slider]')].filter((n) => n.getClientRects().length);
    const t = all.find((n) => +n.getAttribute('aria-valuenow') < +n.getAttribute('aria-valuemax'));
    t?.setAttribute('data-kfc', ''); t?.focus();
    return { label: t ? name(t) : null, unnamed: all.filter((n) => !name(n)).map((n) => n.closest('[data-testid], section, [class]')?.className || '?') };
  });
  ok(unnamed.length === 0, `every slider on screen has an accessible name (${unnamed.length} without: ${unnamed.join(', ')})`);
  const thumb = page.locator('.kit-slider-track-thumb[data-kfc]').first();
  const v0 = await thumb.getAttribute('aria-valuenow'), f0 = (await st()).frame;
  await page.keyboard.press('ArrowRight'); await wait(300); await settled();
  const v1 = await thumb.getAttribute('aria-valuenow'), f1 = (await st()).frame;
  ok(v0 === v1 && f1 === f0 + 1, `ArrowRight on the focused "${label}" slider: its value stays ${v0} (${v1}), the app stepped a frame (${f0} -> ${f1})`);
  for (const [sel, read] of [['#kfc-r', (n) => n.value], ['#kfc-s', (n) => n.value]]) {
    await page.click(sel); await wait(100);
    if (sel === '#kfc-s') { await page.keyboard.press('Escape'); await page.focus(sel); }
    const g0 = await page.$eval(sel, read), h0 = (await st()).frame;
    await page.keyboard.press('ArrowRight'); await wait(250); await settled();
    await page.keyboard.press('ArrowDown'); await wait(250);
    const g1 = await page.$eval(sel, read), h1 = (await st()).frame;
    ok(g0 === g1 && h1 === h0 + 1, `arrows on a native ${sel === '#kfc-r' ? 'range' : 'select'}: its value stays ${g0} (${g1}), ArrowRight stepped the app a frame (${h0} -> ${h1})`);
  }
  // 4. a text field types
  await page.click('#kfc-t'); const t0 = (await st()).frame;
  await page.keyboard.type('a b'); await page.keyboard.press('ArrowLeft'); await page.keyboard.type('x'); await wait(200);
  const tv = await page.$eval('#kfc-t', (n) => n.value), t1 = await st();
  ok(tv === 'a xb' && t1.frame === t0 && !t1.playing, `a text field: Space and arrows type / move the caret ("${tv}"), no app shortcut (frame ${t0} -> ${t1.frame}, playing ${t1.playing})`);
  await ev(() => { document.getElementById('kfc')?.remove(); document.activeElement?.blur?.(); });

  // 5. an open menu still moves with the arrows
  await page.locator('button[aria-label="More"]').first().click(); await wait(300);
  const r0 = await ev(() => [...document.querySelectorAll('[role=menu] .k-item')].findIndex((n) => n.hasAttribute('data-active')));
  await page.keyboard.press('ArrowDown'); await wait(100); await page.keyboard.press('ArrowDown'); await wait(100);
  const r1 = await ev(() => [...document.querySelectorAll('[role=menu] .k-item')].findIndex((n) => n.hasAttribute('data-active')));
  ok(r1 > r0 && r1 >= 0, `the More menu's active row moves with ArrowDown (${r0} -> ${r1})`);
  await page.keyboard.press('Escape');
} catch (e) { fails++; console.log('FAIL', e.message); }
console.log(fails ? `${fails} failure(s)` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
