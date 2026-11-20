// Runs the app's grow.js cleanMask on a mask given as JSON {w, h, a: [0..1 row-major], pos: [[x, y]], margin (the paint margin, %)}; prints {a: [...]}.
// Used by test_seedsam.py to check the Python port (pawtrack/seedsam.py clean_mask) against the JS it was ported from.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { cleanMask } = await import(pathToFileURL(resolve(here, '../../src/features/tracking/grow.js')).href);
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const r = cleanMask(Float32Array.from(d.a), d.w, d.h, d.pos, { margin: d.margin / 100 });
process.stdout.write(JSON.stringify({ a: Array.from(r.a) }));
