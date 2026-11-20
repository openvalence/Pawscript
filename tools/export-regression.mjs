// Export regression harness (paw-j6e): per .pawproj in a folder, a hash of the funscript text a save and every export
// preset write for each axis, through the finishing stack (lib/finish.js) when the tree has it. Run it against the tree
// before a change and after (git archive <rev> src | tar -x -C <dir>), then diff the two JSONs: old projects must
// export identically. Read-only on the fixtures; copy real projects somewhere private first.
//   node tools/export-regression.mjs <tree root> <fixtures dir> > out.json
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [root, dir] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(`${root}/${p}`).href);
const { parse } = await imp('src/lib/io/project.js');
const L = await imp('src/app/project-logic.js');
const { BUILTIN_PRESETS } = await imp('src/lib/io/export.js');
let fin = null; try { fin = await imp('src/lib/finish.js'); } catch { /* the old tree has no stack */ }
const out = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.pawproj')).sort()) {
  try {
    const text = readFileSync(`${dir}/${f}`, 'utf8'), r = parse(text), pd = r.doc ?? r;
    const d = L.appDocFrom(pd, { path: `C:/x/${f}` });
    const axes = fin ? (d.axes?.stroke ? { ...d.axes, stroke: fin.finalScript(d, 'stroke', {}) } : d.axes) : d.axes;
    const { items } = L.saveItems({ axes, chapters: d.chapters, bookmarks: d.bookmarks, files: {} }, 'C:/x/video.mp4');
    const exp = BUILTIN_PRESETS.flatMap((p) => L.exportItems({ axes, chapters: d.chapters, bookmarks: d.bookmarks, files: {} }, { axes: Object.keys(axes), base: 'C:/x/video.mp4', preset: p }).map((i) => ({ ...i, axis: `${p.id}:${i.axis}` })));
    const h = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
    out[f] = { save: Object.fromEntries(items.map((i) => [i.axis, h(i.text)])), export: Object.fromEntries(exp.map((i) => [i.axis, h(i.text)])), points: Object.fromEntries(Object.entries(axes).map(([a, s]) => [a, s.length])) };
  } catch (e) { out[f] = { error: String(e.message).slice(0, 120) }; }
}
console.log(JSON.stringify(out, null, 1));
