// export.js -- write a ghost's actions next to the video, through app.backend (exists / readText / writeText).
// Policy (the bench's): the default target is <name>.pawscript.funscript when <name>.funscript exists (never
// replaced silently); `overwrite` writes <name>.funscript itself. Whatever file is replaced is first copied to
// <target>.bak (first free name: .bak, .bak2, ...), and its unknown keys are kept (lib/runs.js funscriptDoc).
import { exportTarget, funscriptDoc } from '../../lib/runs.js';
import { stamp } from '../../lib/provenance.js';

const basename = (p) => p.split(/[\\/]/).pop();
const stem = (p) => p.replace(/\.[^.\\/]+$/, '');

/** script: Action[]. project: the open .pawproj's file name (provenance, lib/provenance.js). Returns { path, note } (note:
 *  human-readable extras for the toast). Throws on IO errors. */
export async function exportFunscript(be, video, script, overwrite = false, project = null) {
  const origExists = await be.exists(stem(video) + '.funscript');
  const { script: path, bak, alt } = exportTarget(video, origExists, overwrite);
  let existing = null, note = alt ? ` (${basename(stem(video))}.funscript left untouched)` : '';
  if (await be.exists(path)) {
    const text = await be.readText(path);
    let dest = bak;
    for (let i = 2; await be.exists(dest); i++) dest = bak + i;
    await be.writeText(dest, text);
    note += ` (previous file saved as ${basename(dest)})`;
    try { existing = JSON.parse(text); } catch { note += ' (it was not valid JSON, so it was replaced)'; }
  }
  const doc = funscriptDoc(existing, { at: script.map((a) => a.at), pos: script.map((a) => a.pos) });
  await be.writeText(path, JSON.stringify(stamp(doc, { project, how: { tracked: 1 } })));   // a run's own points, as tracked
  return { path, note };
}
