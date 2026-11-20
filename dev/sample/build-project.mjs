// dev/sample/build-project.mjs -- builds the sample project (paw-ys3x) the way a person would, through the app's own code
// (headless: the stores under vite's SSR transform, as the tests load them) and the REAL tracker:
//
//   node dev/sample/build-project.mjs [--out sample] [--gb 10] [--points 128]     (SAMPLE_CACHE=<dir>: replay a same track)
//
// sample/Pawscript sample.mp4 (dev/sample/make_sample.py) -> open it, cut it at its two hard cuts (K), paint Top hips, Top
// penis and Bottom hips with the Groups brush on one frame of each shot (the strokes come from truth.json's seeds), Track
// the whole video (T: a TAPNext++ point grid, model auto), flip each shot that runs the wrong way (F: what a person sees by
// watching; the tracker cannot tell direction), bake shot 1 (Shift+B), an anchor fully in on a deep turn of
// shot 2 (Alt+0), an orgasm modifier around the peak with one spurt marker at its exact frame (U), a commit with a note,
// Publish (v1). Writes <out>/Pawscript sample.{pawproj,pawruns,funscript} and .pawhistory/ with relative media paths only
// (no undo.json: it is tied to this build), then prints the score against the true stroke (dev/sample/score.mjs).
// The tracker runs through trackers/gpu_lock.py (the machine's VRAM budget). Nothing else is written.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine } from '../../src/lib/protocol.js';
import { score, posAt } from './score.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = join(root, arg('out', 'sample')), GB = arg('gb', '10');
const NAME = 'Pawscript sample', REAL = join(root, 'sample', NAME + '.mp4');
const DIR = 'C:/PawscriptSample', VIDEO = `${DIR}/${NAME}.mp4`, PROJ = `${DIR}/${NAME}.pawproj`;   // the mock's own paths (scrubbed on the way out)
const truth = JSON.parse(readFileSync(join(root, 'dev/sample/truth.json'), 'utf8'));
const TRACKERS = join(root, 'trackers'), PY = join(TRACKERS, '.venv/Scripts/python.exe'), LOCK = join(TRACKERS, 'gpu_lock.py');
const ms = (f) => Math.round(f * 1000 / truth.fps);
const log = (...a) => console.log('[sample]', ...a);

/** app.backend.sidecar over the real pawtrack (one process per request, through the GPU lock), as src/lib/sidecar.js does
 *  over the shell: stdout lines -> events, frames handed over in batches, stderr lines as log events. */
const CACHE = process.env.SAMPLE_CACHE || '';   // a folder: track answers replayed from it when the request is the same (iterating on the steps after Track)
async function sidecar(request, handlers = {}) {
  if (!CACHE || request.cmd !== 'track') return sidecarRun(request, handlers);
  const file = join(CACHE, createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16) + '.json');
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    handlers.onStart?.();
    for (let i = 0; i < c.frames.length; i += 64) handlers.onFrames?.(c.frames.slice(i, i + 64));
    log('track answer replayed from', file);
    return c.answer;
  }
  const frames = [];
  const answer = await sidecarRun(request, { ...handlers, onFrames: (b) => { frames.push(...b); handlers.onFrames?.(b); } });
  if (!answer.error) { mkdirSync(CACHE, { recursive: true }); writeFileSync(file, JSON.stringify({ answer, frames })); }
  return answer;
}
function sidecarRun(request, { onEvent = () => {}, onFrames = () => {}, onStart } = {}) {
  const req =JSON.parse(JSON.stringify(request).replaceAll(JSON.stringify(VIDEO).slice(1, -1), REAL.replace(/\\/g, '\\\\')));
  try { onStart?.(); } catch { /* a listener never stops the run */ }
  return new Promise((resolve) => {
    const p = spawn(PY, [LOCK, '--gb', request.cmd === 'track' ? GB : '1', PY, '-m', 'pawtrack.cli'], { cwd: TRACKERS, windowsHide: true, env: { ...process.env, HF_HUB_OFFLINE: '1' } });
    let result = null, error = null, batch = [], buf = '', ebuf = '', last = 0;
    const flush = () => { if (batch.length) { const b = batch; batch = []; onFrames(b); } };
    const line = (l) => {
      if (!l.trim()) return;
      const e = parseLine(l);
      if (e.type === 'frame') { batch.push(e); if (batch.length >= 64) flush(); return; }
      if (e.type === 'result') { flush(); result = e; } else if (e.type === 'error') error = e.message;
      if (e.type === 'progress' && Date.now() - last > 5000) { last = Date.now(); log(request.cmd, e.stage || '', e.done, '/', e.total); }
      onEvent(e);
    };
    p.stdout.on('data', (d) => { buf += d; const ls = buf.split(/\r?\n/); buf = ls.pop(); ls.forEach(line); });
    p.stderr.on('data', (d) => { ebuf += d; const ls = ebuf.split(/\r?\n/); ebuf = ls.pop(); for (const l of ls) if (l.trim()) onEvent({ type: 'log', line: l }); });
    p.stdin.end(JSON.stringify(req));
    p.on('close', (code) => {
      line(buf); flush();
      if (!error && code !== 0) error = 'sidecar exited with code ' + code;
      if (!error && !result) error = 'sidecar finished without a result';
      if (error) log(request.cmd, 'failed:', error.split('\n')[0]);
      resolve({ result: error ? null : result, error, stderr: '', cancelled: false });
    });
  });
}

/** file_fingerprint (src-tauri/src/ident.rs quick): sha256("pawfp1", size u64 le, the head / middle / tail MiB). */
function quick(bytes) {
  const C = 1 << 20, n = bytes.length, h = createHash('sha256').update('pawfp1'), sz = Buffer.alloc(8);
  sz.writeBigUInt64LE(BigInt(n)); h.update(sz);
  if (n <= 3 * C) h.update(bytes); else for (const o of [0, Math.floor(n / 2) - C / 2, n - C]) h.update(bytes.subarray(o, o + C));
  return { size: n, fingerprint: `q1-${n}-${h.digest('hex').slice(0, 32)}` };
}

const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

async function main() {
  const video = new Uint8Array(readFileSync(REAL));
  if (createHash('sha256').update(video).digest('hex') !== truth.sha256) throw new Error(`${REAL} is not the clip truth.json describes: run dev/sample/make_sample.py`);
  const { createServer } = await import('vite');
  const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const load = (p) => server.ssrLoadModule(p);
    const [M, P, T, GS, ST, SH, CS, CF, FIN] = await Promise.all(['/dev/mock-app.js', '/src/app/project.svelte.js', '/src/features/tracking/tracking.svelte.js',
      '/src/features/tracking/groups.svelte.js', '/src/features/timeline/state.svelte.js', '/src/lib/shown.svelte.js', '/src/features/timeline/commands-scenes.js',
      '/src/features/timeline/commands-fx.js', '/src/lib/finish.js'].map(load));
    const be = M.mockBackend({ cow: true });
    be.files.set(VIDEO, video);
    be.fileFingerprint = async (p) => (p === VIDEO ? quick(video) : { size: 0, fingerprint: 'q1-0-none' });
    be.mediaProbe = async () => ({ duration_ms: Math.round(truth.frames * 1000 / truth.fps), has_audio: false,
      video: { fps: truth.fps, is_vfr: false, display_width: truth.width, display_height: truth.height, frame_count: truth.frames, fps_rational: { num: truth.fps, den: 1 } } });
    be.sidecar = sidecar;
    const app = M.createMockApp({ backend: be, doc: {}, keys: false, storage: memStorage() });
    const toasts = [];
    app.toast = (m, kind = 'info') => { toasts.push([kind, m]); log(`toast (${kind}):`, String(m).split('\n')[0]); };
    app.confirm = async () => true; app.choose = async () => null;
    const tr = app.tracking = T.trackingFor(app);
    ST.bindApp(app); SH.shown.app = app;
    app.project = P.createProject(app);
    const project = app.project;

    // ---- open the video, check the cuts (K at each), the Track tab
    if (!(await project.openVideo(VIDEO))) throw new Error('could not open the video');
    log('opened', app.doc.media.name, app.doc.media.durationMs, 'ms', app.doc.media.fps, 'fps');
    app.transact('Shots', () => { app.doc.scenes = [{ start_ms: 0, end_ms: app.doc.media.durationMs }]; });
    for (const f of truth.cuts) CS.structure.splitShot(app, ms(f));
    app.doc.range = null;
    log('shots', app.doc.scenes.map((s) => `${s.start_ms}-${s.end_ms}`).join(' '));
    app.history.markDirty(); await project.flush();   // the app writes continuously (about a second after a change)
    app.mode = 'track';
    tr.openVideo(VIDEO);
    await tr.list();
    if (!tr.listed) throw new Error('the tracker list failed: ' + tr.error);

    // ---- paint the parts on one frame of each shot (the Groups brush: who, part, radius, strokes)
    const G = GS.groupsFor(app);
    for (const seed of truth.seeds) {
      app.player.seek(ms(seed.frame));
      G.toggle(true);
      for (const [, g] of Object.entries(seed.groups)) {
        G.disarm(); G.setWho(g.who); G.pickPart(g.part); G.setRadius(g.radius);   // disarm first: picking the armed part again disarms it
        for (const s of g.strokes) {
          if (!G.begin(s[0][0], s[0][1], false)) throw new Error(`the brush did not start on frame ${seed.frame}`);
          for (const q of s.slice(1)) G.move(q[0], q[1]);
          G.end();
          await new Promise((r) => setTimeout(r, 5));
        }
      }
      G.toggle(false);
    }
    const painted = app.doc.scenes.map((s) => (s.groups || []).map((g) => `${g.name}(${g.poly?.length})`).join(','));
    log('groups per shot:', painted.join(' | '));
    app.player.seek(0);

    // ---- Track: T over the whole video (no shot or range selected)
    // 128 grid points (the setting tracking.gridPoints, 512 by default): the runs file 6 MB instead of 17 (its per-frame overlay is the bulk,
    // paw-o9qe), the turns as good (512: 61 of 61 turns, median 0.12 frames, depth error 8.9; 128: 61 of 61, 0.12, 9.2)
    app.settings.set('tracking.gridPoints', +arg('points', 128));
    if (!tr.canGrid) throw new Error('T is not available (no point tracker listed?)');
    await tr.gridFrame();
    const run = tr.runs.at(-1);
    if (!run || tr.error) throw new Error('tracking failed: ' + tr.error);
    log(tr.notice);
    const live = () => (FIN.finalAxes(app).stroke || []).map((p) => [p.at, p.pos]);
    log('live (as tracked):', JSON.stringify(score(truth, live())));
    const corr = (pts, a, b) => {   // per shot: Pearson r of the script and the truth on its frames
      const xs = [], ys = [];
      for (let f = a; f < b; f++) { xs.push(posAt(pts, ms(f))); ys.push(truth.pos[f]); }
      const m = (v) => v.reduce((s, x) => s + x, 0) / v.length, mx = m(xs), my = m(ys);
      let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
      return Math.round(100 * sxy / Math.sqrt(sxx * syy || 1)) / 100;
    };
    const shotsF = [0, ...truth.cuts, truth.frames];
    const rs = shotsF.slice(0, -1).map((a, i) => corr(live(), a, shotsF[i + 1]));
    log('live, r per shot:', rs.join(' '));
    // the check a person makes by watching: a shot that runs the wrong way is flipped (F, the run selected). Direction is
    // the one thing the tracker cannot know on its own (one keypress per scene)
    rs.forEach((r, i) => { if (r < 0) { app.player.seek(ms((shotsF[i] + shotsF[i + 1]) / 2)); tr.flipAtPlayhead(); } });
    log('flipped shots:', rs.map((r, i) => (r < 0 ? i + 1 : null)).filter(Boolean).join(', ') || 'none', '-> r per shot:', shotsF.slice(0, -1).map((a, i) => corr(live(), a, shotsF[i + 1])).join(' '));
    log('live (checked):', JSON.stringify(score(truth, live())));
    app.history.markDirty(); await project.flush();

    // ---- shot 1 baked, an anchor fully in on a deep turn of shot 2, the peak's orgasm span with a spurt at its frame
    log('baked spans:', tr.bake({ shots: [0] }));
    const deep = truth.turnFrames.find(([f, p]) => f > truth.cuts[0] + 20 && f < truth.pause[0] && p <= 20);
    app.player.seek(ms(deep[0])); tr.anchorAt(0);
    const peak = ms(truth.peak), span = [peak - 1500, peak + 2500];
    CF.addModifier(app, 'orgasm', { t0: span[0], t1: span[1] });
    CF.spurtAtPlayhead(app, peak);
    app.history.markDirty(); await project.flush();
    log('fx:', JSON.stringify(app.doc.fx.map((e) => [e.kind, e.t0, e.t1])), 'anchors:', JSON.stringify(app.doc.scenes.map((s) => s.anchors || [])));

    // ---- a commit with a note, then Publish
    const c = await project.commit({ note: 'First pass: tracked, shot 1 baked' });
    if (!c) throw new Error('commit failed');
    if (!(await project.publish())) throw new Error('publish failed');
    await project.flush();

    // ---- out: the project's files with the mock's folder taken out (media paths relative to the project)
    const files = [...be.files.keys()].filter((p) => p.startsWith(DIR + '/') && p !== VIDEO && !p.endsWith('/undo.json') && !p.endsWith('.bak'));
    const scrub = (s) => s.replaceAll(DIR + '/', '').replaceAll(DIR.replace(/\//g, '\\\\') + '\\\\', '').replaceAll(DIR, '.');
    for (const old of [join(OUT, NAME + '.pawhistory')]) if (existsSync(old)) rmSync(old, { recursive: true });
    const written = [];
    for (const p of files) {
      const v = be.files.get(p), to = join(OUT, p.slice(DIR.length + 1));
      mkdirSync(dirname(to), { recursive: true });
      if (v instanceof Uint8Array) {
        if (Buffer.from(v).toString('latin1').includes('PawscriptSample')) throw new Error(`${p} names the build folder inside binary data`);
        writeFileSync(to, v);
      } else writeFileSync(to, scrub(v));
      written.push(to.slice(OUT.length + 1));
    }
    log('wrote', written.join(', '));
    const pub = JSON.parse(readFileSync(join(OUT, NAME + '.funscript'), 'utf8'));
    const pts = pub.actions.map((a) => [a.at, a.pos]);
    log('published v1, whole clip:', JSON.stringify(score(truth, pts)));
    log('published v1, outside the orgasm span:', JSON.stringify(score(truth, pts, { skip: [span] })));
    // content hashes (run record names, the clip's fingerprint) read as "32-hex id" to the privacy gate: they belong in its allow list
    const hex = new Set(written.flatMap((f) => readFileSync(join(OUT, f)).toString('latin1').match(/\b[0-9a-f]{32}\b/gi) || []).map((x) => x.toLowerCase()));
    log(`32-hex content hashes for dev/share/privacy-markers.json ("32-hex id" allow): ${[...hex].join('|')}`);
  } finally { await server.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
