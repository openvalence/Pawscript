// tools/export-body-obj.mjs -- write a procedural Machine-panel body (body.js) as an OBJ to edit in Blender.
//
//   node tools/export-body-obj.mjs [--char generic] [--weight 0.25] [--genitals male|neutral] [--cell 5] --out <file.obj>
//
// Y up, metres, the floor at Y = 0, the head end toward -Z (the panel's x / z-up / depth-y in mm -> X / Y / -Z), which
// is what tools/build-body-asset.mjs reads back. The character's own height and tail are kept. (The Human is a modelled
// body now, tools/zanatomy_export.py; the generic body is the built-in human base.)
import { writeFileSync } from 'node:fs';
import { rearMesh } from '../src/features/machine/body.js';
import { characterOf } from '../src/features/machine/characters.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const char = characterOf(arg('char', 'generic')), out = arg('out');
if (!out || char.body.mesh) { console.error('usage: --char <procedural character id> --out <file.obj>'); process.exit(1); }
const { pos, nor, idx } = rearMesh({ ...char.body, scale: char.body.height / 175, weight: +arg('weight', 0.25), genitals: arg('genitals', 'male') }, +arg('cell', 5));
let floor = Infinity;
for (let i = 2; i < pos.length; i += 3) floor = Math.min(floor, pos[i]);
const f = (v) => +v.toFixed(5), L = [`# Pawscript body: ${char.id}, ${char.body.height} cm`, `o ${char.id}`];
for (let i = 0; i < pos.length; i += 3) L.push(`v ${f(pos[i] / 1000)} ${f((pos[i + 2] - floor) / 1000)} ${f(-pos[i + 1] / 1000)}`);
for (let i = 0; i < nor.length; i += 3) L.push(`vn ${f(nor[i])} ${f(nor[i + 2])} ${f(-nor[i + 1])}`);
for (let i = 0; i < idx.length; i += 3) L.push(`f ${idx[i] + 1}//${idx[i] + 1} ${idx[i + 1] + 1}//${idx[i + 1] + 1} ${idx[i + 2] + 1}//${idx[i + 2] + 1}`);
writeFileSync(out, L.join('\n') + '\n');
console.log(`${out}: ${pos.length / 3} vertices, ${idx.length / 3} triangles`);
