// paw-k393: the knot brush on the image painter. The knot is a section of the penis (paw-njnf); a label stores it with its penis
// group (`knot`, as a .pawproj does), an old label's own knot part on a penis is read as the section (groups.js foldKnots), and K
// works in the workspace (Skip moved to L).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule } from 'svelte/compiler';

registerHooks({
  load(url, ctx, next) {
    if (!url.startsWith('file:') || url.includes('node_modules')) return next(url, ctx);
    if (url.endsWith('.svelte')) return { format: 'module', shortCircuit: true, source: 'export default function Stub() {}' };
    if (url.endsWith('.svelte.js')) return { format: 'module', shortCircuit: true, source: compileModule(readFileSync(fileURLToPath(url), 'utf8'), { filename: fileURLToPath(url), generate: 'server' }).js.code };
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' };
    if (url.endsWith('.js') && readFileSync(fileURLToPath(url), 'utf8').includes('import.meta.glob')) return { format: 'module', shortCircuit: true, source: readFileSync(fileURLToPath(url), 'utf8').replace(/import\.meta\.glob\([^)]*\)/g, '({})') };
    return next(url, ctx);
  },
});
const L = await import('../src/features/labelling/labels.js');
const { LabelWorkspace } = await import('../src/features/labelling/workspace.svelte.js');
const { encodeMask, knotOf, withKnot, PICK_PARTS } = await import('../src/features/tracking/groups.js');
const trackingCmds = (await import('../src/features/tracking/commands.js')).default;
const labellingCmds = (await import('../src/features/labelling/commands.js')).default;

const W = 80, H = 60, size = { w: W, h: H };
const rect = (x0, y0, x1, y1) => { const a = new Float32Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * W + x] = 1; return a; };
const grp = (name, r) => { const [who, part] = name.split('_'); return { name, who, part, poly: [[r[0] / W, r[1] / H], [r[2] / W, r[1] / H], [r[2] / W, r[3] / H], [r[0] / W, r[3] / H]], pinned: true, t_ms: 0, source: 'user', mask: encodeMask({ ...size, a: rect(...r) }) }; };
const fsBackend = () => ({
  async listDir(d) { return readdirSync(d).map((name) => { const p = join(d, name), s = statSync(p); return { name, path: p, is_dir: s.isDirectory(), size: s.size, mtime_ms: Math.round(s.mtimeMs) }; }); },
  async readText(p) { return readFileSync(p, 'utf8'); },
  async writeText(p, t) { if (!existsSync(join(p, '..'))) { const x = new Error('not_found'); x.code = 'not_found'; throw x; } writeFileSync(p, t); },
  async makeDir(p) { mkdirSync(p, { recursive: true }); },
  async remove(p) { rmSync(p); },
});

test('a label stores the knot section with its penis group and reads it back', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'lblk-')), 'labels'), st = L.createLabelStore(fsBackend(), dir);
  const pen = withKnot(grp('c1_penis', [10, 20, 60, 30]), rect(15, 20, 25, 30), size);
  await st.write(L.makeLabel({ image: 'C:\\x\\a.png', key: 'iabcdef01234567', w: 640, h: 480, groups: [pen, grp('c1_balls', [60, 30, 70, 40])], now: 1 }));
  const back = await st.read('iabcdef01234567');
  assert.deepEqual(back.groups[0].knot, pen.knot, 'stored as it was');
  const g = L.restoreGroups(back);
  assert.deepEqual(g.map((x) => x.name), ['c1_penis', 'c1_balls']);
  const sec = knotOf(g[0], size);
  assert.ok(sec[25 * W + 20] >= 0.5 && sec[25 * W + 40] < 0.5, 'the section is where it was painted');
});

test('an old label with a knot part on the penis is read as the section; another character\'s or a far one stays a knot part', () => {
  const pen = grp('c1_penis', [10, 20, 60, 30]);
  const g = L.restoreGroups({ groups: [pen, grp('c1_knot', [12, 18, 22, 32]), grp('c2_knot', [12, 18, 22, 32])] });
  assert.deepEqual(g.map((x) => x.name), ['c1_penis', 'c2_knot']);
  const sec = knotOf(g[0], size);
  assert.ok(sec && sec[25 * W + 15] >= 0.5 && sec[25 * W + 40] < 0.5, 'the knot is the penis\' section');
  assert.equal(L.restoreGroups({ groups: [pen, grp('c1_knot', [70, 50, 78, 58])] }).length, 2, 'not touching: left alone');
  const abut = L.restoreGroups({ groups: [pen, grp('c1_knot', [61, 20, 66, 30])] });
  assert.equal(abut.length, 1, 'abutting (within 2 px) folds, as projects do');
  assert.ok(!PICK_PARTS.includes('knot'), 'the picker still has no knot part');
});

test('the workspace: K toggles the knot brush; a penis label with a knot painted inside it is saved and comes back', async () => {
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() {} });
  const root = mkdtempSync(join(tmpdir(), 'lblk-ws-')), imgs = join(root, 'images'), data = join(root, 'data');
  mkdirSync(imgs); mkdirSync(data);
  for (const n of ['a.png', 'b.png']) writeFileSync(join(imgs, n), 'not decoded');
  const be = { ...fsBackend(), async readBytes(p) { return new Uint8Array(readFileSync(p)); }, async appPaths() { return { data_dir: data }; }, mediaUrl: (p) => p };
  const vals = { 'labelling.shuffle': false }, gate = [];
  const real = { settings: { get: (k, d) => (k in vals ? vals[k] : d), set: (k, v) => { vals[k] = v; } }, backend: be, doc: { scenes: [] }, labelling: null, mode: 'edit',
    commands: { keysFor: () => [], setGate: (f) => gate.push(f) }, toast: () => {}, player: { pause() {}, timeMs: 0 } };
  const ws = new LabelWorkspace(real);
  assert.ok(await ws.enter(imgs));
  const knotCmd = trackingCmds.find((c) => c.id === 'tracking.groupsKnot');
  assert.deepEqual(knotCmd.keys, ['K']); assert.ok(gate[0](knotCmd), 'the workspace admits the knot brush');
  assert.ok(knotCmd.when(real), 'K is on in the image painter');
  assert.ok(!labellingCmds.some((c) => c.keys?.includes('K')), 'no labelling key takes K (Skip is L)');
  assert.deepEqual(labellingCmds.find((c) => c.id === 'labelling.skip').keys, ['L']);
  const G = ws.G, { w, h } = G.size, at = (a, nx, ny) => a[Math.floor(ny * h) * w + Math.floor(nx * w)];
  G.pickPart('penis'); G.begin(0.3, 0.5, false); for (let i = 1; i <= 20; i++) G.move(0.3 + 0.3 * i / 20, 0.5); G.end();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_penis']);
  knotCmd.run(real);
  assert.ok(G.knotBrush);
  G.begin(0.32, 0.5, false); for (let i = 1; i <= 10; i++) G.move(0.32 + 0.08 * i / 10, 0.5); G.end();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_penis'], 'no knot group');
  assert.ok(at(knotOf(ws.groups[0], G.size), 0.36, 0.5) >= 0.5);
  await ws.next();
  const file = join(data, 'seeder', 'datasets', 'v2', 'labels', readdirSync(join(data, 'seeder', 'datasets', 'v2', 'labels'))[0]);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.groups.length, 1); assert.ok(saved.groups[0].knot?.rle?.length, 'the label file has the section on the penis');
  await ws.prev();
  assert.deepEqual(ws.groups.map((g) => g.name), ['c1_penis']);
  const sec = knotOf(ws.groups[0], G.size);
  assert.ok(at(sec, 0.36, 0.5) >= 0.5 && at(sec, 0.55, 0.5) < 0.5, 'reloaded: the section is there');
  await ws.leave();
});
