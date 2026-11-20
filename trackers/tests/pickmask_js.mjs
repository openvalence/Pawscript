// Runs the app's grow.js pickMask (a dab) on candidates given as JSON {w, h, masks: [{a: [...0..1], score}], pos: [[x, y]]}; prints {index, why}.
// Used by test_seedsam.py to check that Suggest's choice (pawtrack/seedsam.py choose / walk_up) is the dab's rule.
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const { pickMask } = await import(pathToFileURL(resolve(here, '../../src/features/tracking/grow.js')).href);
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const r = pickMask(d.masks.map((m) => ({ a: Float32Array.from(m.a), score: m.score })), d.pos, d.w, d.h);
process.stdout.write(JSON.stringify({ index: r.index, why: r.why }));
