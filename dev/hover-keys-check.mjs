// dev/hover-keys-check.mjs -- paw-cnfg in YOUR test instance (node dev/test-app.mjs start ..., then the CDP_* env it prints) on GENERATED images:
// paints three blobs with the real pointer, hover + 2 on one, hover + F on another, Enter (names by proposal), opens the picker on the third and
// CLICKS the thigh target (a point inside its padded rectangle but outside the drawn ellipse), measures the picker against the window, and
// screenshots the picker and the full colour palette over a dark and a light picture.
//   node dev/hover-keys-check.mjs <image folder> <out dir>
import { connectTestApp } from './cdp-connect.mjs';
import { mkdirSync } from 'node:fs';
import { groupColor } from '../src/features/tracking/colors.js';
import { PARTS, PAIRED, WHOS, partLabel } from '../src/features/tracking/groups.js';

const [folder, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a), wait = (ms = 300) => page.waitForTimeout(ms);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await page.waitForFunction(() => window.app?.commands, null, { timeout: 90000 });
  const rect = () => ev(() => { const r = document.querySelector('[data-testid="label-stage"]').getBoundingClientRect(), b = app.labelling.player.bmp; return { x: r.x, y: r.y, w: r.width, h: r.height, iw: b?.width, ih: b?.height }; });
  const at = async (fx, fy) => { const r = await rect(), s = Math.min(r.w / r.iw, r.h / r.ih), ox = r.x + (r.w - r.iw * s) / 2, oy = r.y + (r.h - r.ih * s) / 2; return [ox + fx * r.iw * s, oy + fy * r.ih * s]; };
  const paint = async (a, b) => { const [x0, y0] = await at(...a), [x1, y1] = await at(...b); await page.mouse.move(x0, y0); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(x0 + ((x1 - x0) * k) / 8, y0 + ((y1 - y0) * k) / 8); await page.mouse.up(); await wait(150); };
  const hover = async (f) => { const [x, y] = await at(...f); await page.mouse.move(x - 6, y - 3); await page.mouse.move(x, y); await wait(120); };
  const names = () => ev(() => app.labelling.groups.map((g) => g.name + ':' + (g.named_by || '-')).join(' '));
  const open = async () => {
    await ev((f) => app.commands.run('labelling.open', { folder: f }), folder);
    await page.waitForFunction(() => app.labelling?.on && app.labelling.ready, null, { timeout: 30000 });
  };
  await open();
  await ev(async () => { await app.labelling.leave(); const d = await app.labelling.labelsDir(); for (const e of await app.backend.listDir(d).catch(() => [])) await app.backend.remove(e.path); });
  await open();
  // four blobs: the fake namer makes every third UNNAMED blob doubtful, so once hover + 2 has named one, the last is the doubtful one
  await paint([0.2, 0.25], [0.3, 0.25]); await paint([0.5, 0.25], [0.6, 0.25]); await paint([0.4, 0.75], [0.5, 0.75]); await paint([0.75, 0.6], [0.85, 0.6]);
  await page.waitForFunction(() => app.labelling.G.proposals.size === 4, null, { timeout: 10000 });
  ok(await ev(() => app.labelling.G.who) === 'c1', 'the active character is Bottom');
  // hover blob 2 + 2 -> Top: since b63077b the key APPLIES the blob's proposal as that character at once (the owner: "pressing 1 or 2
  // on a unlabelled region should apply the suggestion"); the other blobs stay tentative
  await hover([0.55, 0.25]); await page.keyboard.press('2'); await wait(200);
  const g1 = await ev(() => { const g = app.labelling.groups[1]; return { name: g.name, by: g.named_by || '' }; });
  ok(g1.name.startsWith('c2_thighs') && g1.by === 'auto', `hover + 2: the blob is named as Top's proposed part at once (${g1.name}:${g1.by})`);
  ok(await ev(() => app.labelling.G.who) === 'c1', '... and the character painted next is still Bottom');
  ok(await ev(() => [0, 2, 3].every((k) => app.labelling.groups[k].name.startsWith('unassigned'))), '... the other blobs are not named yet (tentative proposals)');
  // hover blob 1 + F -> the other side than proposed
  const side0 = await ev(() => app.labelling.G.proposedSide(app.labelling.groups[0])?.side);
  await hover([0.25, 0.25]); await page.keyboard.press('f'); await wait(200);
  const side1 = await ev(() => app.labelling.G.sideSet.get(app.labelling.groups[0]));
  ok(!!side0 && !!side1 && side1 !== side0, `hover + F: the first thigh blob flips its side (${side0} -> ${side1})`);
  ok(await ev(() => app.labelling.G.hoverK) === 0, 'the hint knows the hovered group');
  console.log('hint', await ev(() => document.body.innerText.match(/On this group:[^\n]*/)?.[0] || '(no hint text found)'));
  await page.screenshot({ path: out + '/h1-hover-2-and-f.png' });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => app.labelling.groups.some((g) => g.named_by === 'auto'), null, { timeout: 10000 });
  await wait(300);
  const n = await names(), nn = n.split(' ');
  ok(new RegExp(`_thighs_${side1}\\d*:auto$`).test(nn[0]) && nn[1] === `${g1.name}:auto` && nn[2].endsWith(':auto') && nn[3] === 'unassigned_4:-', 'Enter named the confident ones (the first on the side F gave it); the doubtful one waits: ' + n);
  ok(await ev(() => !!app.labelling.G.picker?.pass && app.labelling.G.picker.k === 3), 'the pass opened the picker on the doubtful blob');
  await wait(300);
  await page.screenshot({ path: out + '/h2-picker-after.png' });
  const box = await ev(() => { const r = document.querySelector('[data-testid="groups-picker"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vh: innerHeight, vw: innerWidth }; });
  console.log('picker', JSON.stringify(box));
  ok(box.y >= 0 && box.y + box.h <= box.vh && box.x + box.w <= box.vw, 'the picker stays inside the window');
  // the thigh target: a point inside its padded rectangle, outside the drawn ellipse (the top-left corner, 3 px in)
  const th = await ev(() => { const g = document.querySelector('[data-testid="body-figure"] g[data-drop-part="thighs"][data-drop-side="l"]'), r = g.querySelector('.hit').getBoundingClientRect(), s = g.querySelector('.sh').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, sx: s.x, sy: s.y }; });
  console.log('thigh L target', JSON.stringify(th));
  ok(th.w >= 28 && th.h >= 28, `the thigh target is ${th.w.toFixed(0)} x ${th.h.toFixed(0)} px on screen`);
  await page.mouse.move(th.x + 3, th.y + 3); await wait(150);
  await page.screenshot({ path: out + '/h3-picker-thigh-hover.png', clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.w + 20, height: box.h + 20 } });
  await page.mouse.click(th.x + 3, th.y + 3); await wait(400);
  const n2 = await names();
  ok(/ c1_thighs_l\d*:-$/.test(n2), 'a click in the padding took the Bottom\'s L thighs: ' + n2);
  // the colour palette over a dark and a light picture
  const palette = [];
  for (const who of WHOS) for (const p of PARTS) for (const s of PAIRED.includes(p) ? ['l', 'r'] : [null]) palette.push({ who, name: `${who}_${p}${s ? '_' + s : ''}`, label: partLabel(`${who}_${p}${s ? '_' + s : ''}`), color: groupColor(`${who}_${p}${s ? '_' + s : ''}`) });
  for (const [i, tag] of [[0, 'p1'], [1, 'p2']]) {
    await ev((k) => app.labelling.show(k), i); await wait(500);
    await ev((pal) => {
      document.getElementById('__pal')?.remove();
      const d = document.createElement('div'); d.id = '__pal';
      d.style.cssText = 'position:fixed;left:520px;top:300px;padding:8px;z-index:99999;display:grid;grid-template-columns:repeat(3,auto);gap:2px 14px;font:10px sans-serif';
      for (const who of ['c1', 'c2', 'x']) { const col = document.createElement('div'); col.style.cssText = 'display:flex;flex-direction:column;gap:2px'; for (const p of pal.filter((q) => q.who === who)) { const row = document.createElement('div'); row.style.cssText = `display:flex;align-items:center;gap:4px;color:#fff;text-shadow:0 0 2px #000`; row.innerHTML = `<i style="width:44px;height:15px;background:color-mix(in srgb, ${p.color} 55%, transparent);border:2px solid ${p.color};box-sizing:border-box;border-radius:3px"></i><i style="width:11px;height:11px;border-radius:50%;background:${p.color}"></i>${p.label}`; col.append(row); } d.append(col); }
      document.body.append(d);
    }, palette);
    await wait(200);
    const pb = await ev(() => { const r = document.getElementById('__pal').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); await page.screenshot({ path: `${out}/${tag}-palette.png`, clip: pb });
  }
  await ev(() => document.getElementById('__pal')?.remove());
  await ev(() => app.labelling.leave());
  ok(!errs.length, `no console errors (${errs.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
