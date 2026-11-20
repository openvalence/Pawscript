// make-icons.mjs -- switches the Pawscript mark to one candidate and regenerates every icon from its SVGs (paw-mpor).
//   node dev/make-icons.mjs [id]           (default r1, the mark; any <id> with src/assets/brand/pawscript-<id>-*.svg)
// 1. Copies src/assets/brand/pawscript-<x>-{app,small,16,mono}.svg to pawscript-{app,small,16,glyph}.svg: the names
//    the app uses (top bar, Projects page, favicon, setup screen; vite hot-reloads them).
// 2. Writes src-tauri/icons/ (rebuilds a running `tauri dev`): the PNG ladder, icon.icns and the Store logos from
//    the Tauri CLI's `tauri icon` on a 1024 render of the app SVG, kept to the files already there; then, the
//    Valence way, 32x32.png and the ICO's 16-32 px layers from the hand-set small SVGs, never a downscale of
//    the 1024 (ICO: 16 from -16.svg, 24/32 from -small.svg, 48/64/256 from -app.svg, each with a 1 px clear edge).
// Construction, carried over from OpenValence's Valence/assets/icons (the Phosphor icon): the #111318 chassis
// square, corner radius 22 % (225 of 1024), artwork group translate(512 512) scale(1.17) reaching ~80 % of the
// tile, flat colour (Valence's violet #A78BFA ring arcs, blue #4DA6FF dots, and one per-app accent: Pawscript's
// highlight pink #FF5CB3 on the core / pad), no glow or gradient; 16 px drawn on a 14 grid with heavier strokes.
// The mark (r1, the owner's pick): Valence's ring and core with the paw worked in: four blue toes sit in the ring's
// gaps, fanned over the pink core (the pad), the rest of the ring two arcs below. At 24-32 and 16 px the toes are a
// little bigger, the outer pair a touch lower and the core smaller, so the four read as a fan over the pad.
import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pick = process.argv[2] || 'r1';
const root = fileURLToPath(new URL('..', import.meta.url));
const brand = join(root, 'src/assets/brand');
if (!/^[a-z0-9]+$/.test(pick) || !existsSync(join(brand, `pawscript-${pick}-app.svg`))) throw new Error('usage: node dev/make-icons.mjs <id>, an id with src/assets/brand/pawscript-<id>-app.svg');
const out = join(root, 'src-tauri/icons');
for (const [from, to] of [['app', 'app'], ['small', 'small'], ['16', '16'], ['mono', 'glyph']]) {
  copyFileSync(join(brand, `pawscript-${pick}-${from}.svg`), join(brand, `pawscript-${to}.svg`));
}

const tmp = mkdtempSync(join(tmpdir(), 'paw-icons-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(svg, size, pad = 0) {
  const uri = 'data:image/svg+xml;base64,' + readFileSync(join(brand, svg)).toString('base64');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent"><img src="${uri}" style="position:absolute;left:${pad}px;top:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px"></body>`);
  await page.waitForLoadState('load');
  return page.screenshot({ omitBackground: true });
}

try {
  const app = join(tmp, 'app.png');
  writeFileSync(app, await render('pawscript-app.svg', 1024));
  execFileSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', app, '-o', join(tmp, 'gen')], { cwd: root, stdio: 'inherit' });
  const keep = readdirSync(out);   // the set the repo ships (tauri icon also writes iOS/Android sets: not ours)
  for (const f of keep) copyFileSync(join(tmp, 'gen', f), join(out, f));

  writeFileSync(join(out, '32x32.png'), await render('pawscript-small.svg', 32, 1));
  writeFileSync(join(out, 'Square30x30Logo.png'), await render('pawscript-small.svg', 30, 1));
  const layers = [];
  for (const s of [16, 24, 32, 48, 64, 256]) layers.push([s, await render(s === 16 ? 'pawscript-16.svg' : s <= 32 ? 'pawscript-small.svg' : 'pawscript-app.svg', s, 1)]);
  writeFileSync(join(out, 'icon.ico'), ico(layers));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Pawscript mark ${pick}: src/assets/brand/pawscript-{app,small,16,glyph}.svg and src-tauri/icons/ written`);

/** An ICO of PNG-encoded entries (Vista and later): [[size, pngBuffer]]. */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, data], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size & 255, e);
    head.writeUInt8(size & 255, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map(([, d]) => d)]);
}
