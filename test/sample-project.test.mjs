// paw-ys3x: the sample project. The clip is the one dev/sample/make_sample.py made (its hash in truth.json), the published
// script follows the clip's TRUE stroke (an end-to-end check of tracking + fusion + bake / anchor / modifier / publish on a
// fixed input), nothing in it names this machine, it opens with its video found beside it, and Help › Open the sample
// project copies it once and opens the copy on the Track tab.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score, turnsOf } from '../dev/sample/score.mjs';
import { privacyIssues } from '../src/app/pack.js';
import { CURRENT_VERSION } from '../src/lib/io/project.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const S = join(root, 'sample'), NAME = 'Pawscript sample';
const truth = JSON.parse(readFileSync(join(root, 'dev/sample/truth.json'), 'utf8'));
const list = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? list(join(d, n)) : [join(d, n)]));
const files = list(S);
const proj = JSON.parse(readFileSync(join(S, NAME + '.pawproj'), 'utf8'));
const pub = JSON.parse(readFileSync(join(S, NAME + '.funscript'), 'utf8'));
const orgasm = (proj.modifiers || proj.fx || []).find((e) => e.kind === 'orgasm');

test('the clip is the generated one (truth.json hash), small; the whole sample is well under 20 MB', () => {
  const v = readFileSync(join(S, NAME + '.mp4'));
  assert.equal(createHash('sha256').update(v).digest('hex'), truth.sha256, 'regenerate with dev/sample/make_sample.py, then rebuild the project');
  assert.ok(v.length < 8e6, `${v.length} bytes`);
  const total = files.reduce((s, f) => s + statSync(f).size, 0);
  assert.ok(total < 20e6, `${total} bytes`);
  assert.equal(truth.frames, 1080); assert.deepEqual(truth.cuts, [390, 750]);
});

test('the published v1 follows the true stroke: turns within a few frames, depth within tolerance', () => {
  assert.equal(pub.metadata?.pawscript?.publish?.version, 1);
  const pts = pub.actions.map((a) => [a.at, a.pos]);
  const all = score(truth, pts), rest = score(truth, pts, { skip: orgasm ? [[orgasm.t0, orgasm.t1]] : [] });
  console.log('sample vs truth (whole clip):', JSON.stringify(all));
  console.log('sample vs truth (outside the orgasm modifier):', JSON.stringify(rest));
  assert.ok(rest.matched >= 0.95 * rest.turns, `${rest.matched} of ${rest.turns} turns found`);
  assert.ok(rest.frames.median <= 1, `median turn error ${rest.frames.median} frames`);
  assert.ok(rest.pos.mae <= 12, `mean position error ${rest.pos.mae}`);
});

// paw-5uyg: an older format opens with a "migrated" toast on the person's first look; re-save it through the app (open + write)
test('the sample project is at the current project format', () => {
  assert.equal(proj.format, 'pawproj');
  assert.equal(proj.version, CURRENT_VERSION, 'open the sample in the app and let it write, then scrub the folder as dev/sample/build-project.mjs does');
});

test('score: a perfect script scores zero, a shifted one by its shift, a missing turn counts', () => {
  const pts = truth.turns.map(([t, p]) => [t, p]);
  const s = score(truth, pts);
  assert.equal(s.matched, s.turns); assert.equal(s.frames.median, 0); assert.ok(s.pos.mae < 6, 'cosine vs linear between turns');
  const late = score(truth, pts.map(([t, p]) => [t + 100, p]));
  assert.equal(late.signedFrames, 3);
  assert.equal(score(truth, pts.filter((_, i) => i !== 5)).matched < s.turns, true);
  assert.equal(turnsOf([[0, 0], [1, 50], [2, 50], [3, 0]]).length, 1);
});

test('nothing in the sample names this machine: relative media paths, no drive / user paths in any file', () => {
  assert.equal(proj.media.path, NAME + '.mp4');
  assert.equal(proj.media.relativePath, NAME + '.mp4');
  // the runs file is binary (random bytes can look like 'x:/'): its JSON records must not name a user folder or the build's
  const runs = readFileSync(join(S, NAME + '.pawruns')).toString('latin1');
  assert.doesNotMatch(runs, /Users[\\/]|PawscriptSample|AppData/i);
  for (const f of files.filter((f) => !/\.(mp4|pawruns)$/.test(f))) {
    const text = readFileSync(f).toString('latin1');
    assert.deepEqual(privacyIssues(text, {}), [], f);
    assert.doesNotMatch(text, /(?<![A-Za-z])[A-Za-z]:[\\/]|PawscriptSample|\\\\\\\\[A-Za-z]/, f);
  }
  assert.equal(files.some((f) => /undo\.json$|\.bak$/.test(f)), false, 'no undo stack or backups');
});

test('the project has the whole workflow: three shots with named parts, a run with its range, a baked shot, an anchor, a modifier and a spurt, a commit and v1', () => {
  const shots = proj.scenes;
  assert.equal(shots.length, 3);
  for (const s of shots) assert.deepEqual((s.groups || []).map((g) => g.name).sort(), ['c1_hips', 'c2_hips', 'c2_penis']);
  assert.ok(proj.runRanges?.length >= 1, 'run ranges');
  assert.ok(shots.flatMap((s) => [s, ...(s.shots || [])]).some((s) => s.anchors?.some((a) => a.pos === 0)), 'an anchor fully in');
  assert.ok(orgasm && (proj.modifiers || proj.fx).some((e) => e.kind === 'spurt' && Math.abs(e.t0 - Math.round(truth.peak * 1000 / truth.fps)) <= 1), 'the spurt on the peak frame');
  assert.ok(proj.axes.stroke.length > 10, 'shot 1 baked into the points');
  const idx = JSON.parse(readFileSync(join(S, NAME + '.pawhistory', 'index.json'), 'utf8')).checkpoints;
  assert.ok(idx.some((c) => c.kind === 'commit' && c.note), 'a commit with a note');
  assert.ok(idx.some((c) => c.kind === 'publish' && c.version === 1), 'published v1');
  for (const c of idx) assert.ok(files.some((f) => f.endsWith(c.id + '.pawproj')), c.id);
  assert.equal(readFileSync(join(S, NAME + '.pawruns')).subarray(0, 8).toString('latin1'), 'PAWRUNS1');
});

let server, M, P, T, SM;
before(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  [M, P, T, SM] = await Promise.all(['/dev/mock-app.js', '/src/app/project.svelte.js', '/src/features/tracking/tracking.svelte.js', '/src/features/onboard/sample.js'].map((p) => server.ssrLoadModule(p)));
});
after(() => server?.close());

/** A mock app; home = the profile's folder (appPaths), with Videos. */
function appWith(be) {
  be.appPaths = async () => ({ config_dir: 'C:\\Users\\you\\AppData\\Roaming\\app.pawscript' });
  // the shell reads any file it wrote as text; the mock keeps bytes as bytes
  const wb = be.writeBytes.bind(be);
  be.writeBytes = async (p, b) => (/\.(pawproj|json|funscript)$/.test(p) ? be.writeText(p, new TextDecoder().decode(b)) : wb(p, b));
  const stat = be.stat.bind(be);
  be.stat = async (p) => (p === 'C:\\Users\\you\\Videos' ? { exists: true, is_dir: true } : stat(p));
  const app = M.createMockApp({ backend: be, doc: {}, keys: false });
  const toasts = [];
  app.toast = (m, kind) => toasts.push([kind, m]);
  app.tracking = T.trackingFor(app);
  app.project = P.createProject(app);
  return { app, toasts };
}
const fromDisk = async (url) => readFileSync(join(root, decodeURIComponent(url.replace(/^\/@fs\//, '').replace(/\?.*$/, ''))));

test('Open the sample project: the bundled files are copied to Videos\\Pawscript sample once, the copy opens on the Track tab with its video and run', async () => {
  const be = M.mockBackend({ cow: true });
  const { app, toasts } = appWith(be);
  const rel = SM.sampleFiles().map((f) => f.rel);
  assert.deepEqual([...rel].sort(), files.filter((f) => !/README\.md$|\.gitattributes$/.test(f)).map((f) => f.slice(S.length + 1).replace(/\\/g, '/')).sort());
  assert.equal(rel.at(-1), NAME + '.pawproj', 'the project is written last');
  assert.equal(await SM.openSample(app, { fetchBytes: fromDisk }), true);
  const dir = 'C:\\Users\\you\\Videos\\Pawscript sample';
  assert.ok(be.files.get(`${dir}\\${NAME}.mp4`) instanceof Uint8Array);
  assert.equal(app.doc.media.path, `${dir}\\${NAME}.mp4`, 'the video beside the copy');
  assert.equal(app.project.path, `${dir}\\${NAME}.pawproj`);
  assert.equal(app.mode, 'track');
  assert.equal(app.doc.scenes.length, 3);
  assert.deepEqual(toasts.filter(([, m]) => /migrated/.test(m)), [], 'no migration note on open');
  app.tracking.openVideo(app.doc.media.path);   // the store's media effect, which SSR does not run
  await app.tracking.runsLoad;
  assert.equal(app.tracking.runs.length, 1, 'the run read back from the copied (copy-on-write) runs file');
  assert.ok(app.tracking.runs[0].frames?.t?.length >= 1000, 'with its frames');
  // the copy is the app's own: its first write keeps no "changed outside Pawscript" backup
  app.edit('Move point', 'stroke', app.doc.axes.stroke.map((p, i) => (i === 3 ? { ...p, pos: Math.max(0, p.pos - 5) } : p)));
  app.history.markDirty();
  await app.project.flush();
  assert.deepEqual([...be.files.keys()].filter((p) => p.endsWith('.bak')), []);
  assert.match(toasts.at(-1)[1], /Sample project copied to C:\\Users\\you\\Videos\\Pawscript sample/);
  // a second time: the copy (and what was done in it) is opened as it is, nothing is copied over it
  be.files.set(`${dir}\\${NAME}.funscript`, 'mine');
  const again = appWith(be);
  assert.equal(await SM.openSample(again.app, { fetchBytes: () => { throw new Error('copied again'); } }), true);
  assert.equal(be.files.get(`${dir}\\${NAME}.funscript`), 'mine');
  assert.match(again.toasts.at(-1)[1], /Opened your copy/);
});
