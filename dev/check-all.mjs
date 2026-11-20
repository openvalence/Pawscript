// dev/check-all.mjs -- every real-window check (dev/*-check.mjs, tips-e2e / mods-e2e / shell-e2e) against test instances
// started here with dev/test-app.mjs (hidden desktop, fake sidecar), one table at the end, exit 1 on any failure: the release
// gate. Not part of `npm test` (it needs the Tauri shell and takes a while).
//
//   node dev/check-all.mjs --dir <scratch dir> --target <CARGO_TARGET_DIR> [--skip-slow] [--only a,b] [--from name] [--list]
//          [--app-repo <repo with src-tauri, default: this tree>] [--src <tree to build the dist from, default: none>]
//          [--shard i/n] [--adopt <run dir>] [--vite-port <n>, default 5200: the first one tried] [--sync <dir shared by the shards>]
//
// On the second PC (the dev/remote runner with -Gui, one line per shard, run in parallel; -TimeoutMin 120):
//   node dev/check-all.mjs --dir {work}\ca --adopt {work} --shard 1/4      (... 2/4, 3/4, 4/4)
// --adopt: the instance the dev/remote runner started in that run folder is the main instance (its cargo target from job.json; a
// restart = stop / start there with the same id); the other groups stop it and start their own on the same target.
// --shard i/n: every n-th check from the i-th (the table then covers that shard). On the main PC run it pinned to CPUs 16-31
// (cmd /c start "" /b /wait /belownormal /affinity FFFF0000 node dev/check-all.mjs ...). Checks marked alone (time / frame
// budgets) run last, once every shard is done with the rest, one at a time (--sync, default: beside the runner's <stamp>-0).
// Each check starts as in a fresh instance: the settings and open tabs an earlier check left are reset (ready() clean).
//
// --app-repo: where dev/test-app.mjs runs (the Rust shell is built there; its Cargo.toml has paths relative to it, so a scratch
// copy cannot be the app repo). --src: after every start the instance's dist is rebuilt from that tree (VITE_TEST_ID) and the
// page reloaded, so a scratch copy's frontend is what is checked. The scripts themselves always come from THIS tree.
// Fixtures (generated clips / pictures) are made once under <dir>/fx and reused; each script gets its own copy of its clip in
// <dir>/out/<name> (the app writes .pawproj / .funscript beside a clip). Instances: one main instance (most checks, a restart with
// the same id where a check needs one), a fresh one for home-check, one per fake-sidecar environment, and a vite server on :5200
// for the headless-Edge checks on dev/tracking.html / dev/shell.html. --list prints the inventory (what each check needs).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const DIR = opt('dir') && resolve(opt('dir')), TARGET = opt('target') && resolve(opt('target'));
const APP = resolve(opt('app-repo') || here), SRC = opt('src') && resolve(opt('src'));
const SKIP_SLOW = argv.includes('--skip-slow'), ONLY = opt('only')?.split(','), FROM = opt('from');
const ADOPT = opt('adopt') && resolve(opt('adopt')), [SHARD, SHARDS] = (opt('shard') || '1/1').split('/').map(Number);
let VPORT = String(+opt('vite-port') || 5200);   // where vite starts looking; taken (another run on the rig): the next free one
const node = process.execPath, PY = join(APP, 'trackers/.venv/Scripts/python.exe');

// ---- the inventory ------------------------------------------------------------------------------------------------------
// steps: argument lists (f = fixture paths, o = this check's out dir), 'restart' (same id, app data kept) between phases.
// group: main | home (fresh, nothing else in it) | shaft (FAKE_SHAFT_STORY=strokes) | env (slow fake tracks / naming / shaft
// pass) | vite (headless Edge on a vite server, no instance). marks: how it reports when not ok/FAIL lines + exit code.
const C = (name, need, steps, extra = {}) => ({ name, need, steps, group: 'main', ...extra });
const own = (o, f) => { const d = join(o, 'clip'); mkdirSync(d, { recursive: true }); const t = join(d, basename(f)); copyFileSync(f, t); return t; };
const CHECKS = [
  C('onboard', 'fresh instance (first-run hints), any clip', [(f, o) => [own(o, f.cfr30)]], { first: true }),
  // synthetic runs, no clip
  ...['anchor-strokes', 'detail-render', 'direction', 'fuse-depth', 'fusion-how', 'fusion-pad', 'fusion-panel', 'fusion-runs', 'held', 'override',
    'polarity', 'runsel', 'smart-cusp', 'smart-default'].map((n) => C(n, 'synthetic run, no clip', [() => []])),
  C('smart-flip', 'synthetic run on a clip > 13 s (F needs a video, 0d33bfa)', [(f, o) => [own(o, f.cfr2997)]]),
  C('fusion-jitter', 'synthetic run (panel phase)', [() => ['panel']]),
  // any clip
  ...['boot-store', 'commit', 'continuous', 'keys-focus', 'lanes-resize', 'timeline-resize', 'areas', 'feedback-app', 'seeder-app',
    'qa-keys-retrack', 'acttrack', 'paint-target'].map((n) => C(n, 'cfr30 copy', [(f, o) => [own(o, f.cfr30)]])),
  C('lanes-compact', 'cfr30 copy', [(f, o) => [own(o, f.cfr30), o]]),
  ...['axes', 'axes-solo', 'dancing', 'tailtypes', 'posbar', 'sr6view', 'part-depth', 'shaft-strip'].map((n) =>
    C(n, 'clip >= 8 s', [(f, o) => [own(o, f.cfr30), o]])),
  C('bake', 'cfr30 (copied by the check)', [(f, o) => [own(o, f.cfr30), o]]),
  C('runranges', 'cfr30 (copied by the check)', [(f, o) => [own(o, f.cfr30), o, o]]),
  C('stroker', 'clip >= 13 s (it seeks to 12.7 s), Machine panel 3D', [(f, o) => [own(o, f.t16), o]]),
  C('tips-e2e', 'clip >= 10 s', [(f, o) => [own(o, f.cfr30), o]]),
  C('shell-e2e', 'clip >= 9 s, own folder', [(f, o) => [own(o, f.cfr30), o]]),
  C('furry', 'makes its own clip', [(f, o) => [o]]),
  C('relink', 'makes its own clips in a dir', [(f, o) => [join(o, 'dir')]]),
  C('pack', 'makes its own clip; python zipfile', [(f, o) => [join(o, 'dir')]]),
  // longer clips
  ...['anchors', 'pov', 'tracker-panel', 'mods-e2e'].map((n) => C(n, 'clip > 20 s (cfr2997)', [(f, o) => [own(o, f.cfr2997), ...(n === 'mods-e2e' || n === 'tracker-panel' ? [o] : [])]])),
  C('actions', '60 s clip (12 shots of 5 s)', [(f, o) => [own(o, f.cfr2997), '--shots', o]]),
  C('positioning', 'clip >= 15 s', [(f, o) => [own(o, f.assist60), '--shots', o]]),
  C('cutaway', 'assist60', [(f, o) => [own(o, f.assist60), '--shots', o]]),
  C('scene-mods', 'testsrc2 40 s', [(f, o) => [own(o, f.t40), o]]),
  C('edge-follow', 'testsrc2 40 s (drags held at a row edge: the view follows)', [(f, o) => [own(o, f.t40)]]),
  C('selkeys', 'testsrc2 40 s (A toggles, B box, C circle select on the points and the Modifiers row; Alt+C cutaway)', [(f, o) => [own(o, f.t40)]]),
  C('rapid', 'testsrc2 40 s (paw-5zpf: selection modes 1-4, active element, Alt / Ctrl click, pivot, S / R, E, F, keymap presets)', [(f, o) => [own(o, f.t40), '--shots', o]]),
  C('sim-rail', 'testsrc2 16 s 30 fps', [(f, o) => [own(o, f.t16), o]]),
  // generated content
  C('tracklane', 'index clip 20 s (make-index-clip 20 30 600)', [(f, o) => [own(o, f.index20), '--shot', join(o, 'lane.png')]]),
  C('runbar', 'synthetic runs on the index clip (F needs a video)', [(f, o) => [own(o, f.index20), '--shots', join(o, 'shots')]]),   // paw-k8pe
  C('menus', 'index clip 20 s (make-index-clip 20 30 600)', [(f, o) => [own(o, f.index20), o]]),
  C('quick', 'index clip 20 s (make-index-clip 20 30 600)', [(f, o) => [own(o, f.index20), o]]),
  C('palette', 'index clip 20 s (make-index-clip 20 30 600)', [(f, o) => [own(o, f.index20), o]]),
  C('props', 'index clip 20 s (make-index-clip 20 30 600)', [(f, o) => [own(o, f.index20), o]]),
  C('loops-ui', 'loop clip (make-loop-clip --segs)', [(f, o) => [own(o, f.loopsui), '--shots', o]]),
  C('loops-grid', 'loop clip (make-loop-clip defaults)', [(f, o) => [own(o, f.loopgrid)]]),
  C('tile-extent', 'loop clip with a slip (make-loop-clip --redraw)', [(f, o) => [own(o, f.tilestop)]]),
  C('crop-scene', 'cropscene make_clips.py A I A16', [(f, o) => [own(o, f.cropscene)]]),
  C('groups-hide', 'groups-hide --make', [(f, o) => [own(o, f.hide), o]]),
  C('carried-outline', 'groups-hide --make', [(f, o) => [own(o, f.hide), o]]),
  C('groups-outline', 'groups-hide --make', [(f, o) => [own(o, f.hide)]]),
  C('groups-erase', '1280x720 clip (groups-hide --make)', [(f, o) => [own(o, f.hide), o]]),
  C('groups-labels', '1280x720 clip (groups-hide --make)', [(f, o) => [own(o, f.hide), o]]),
  C('paint-erase-knot', 'clip >= 4 s (groups-hide --make)', [(f, o) => [own(o, f.hide)]]),
  C('groups-peek', 'orange box moving 200 px/s (ffmpeg)', [(f, o) => [own(o, f.peek), o]]),
  C('groups-copy', 'groups-copy --make', [(f, o) => [own(o, f.copy), o]]),
  C('groups-copy-crop', 'groups-copy-crop --make (venv python)', [(f, o) => [own(o, f.crop), o]]),
  C('groups-copy-trxk', 'groups-copy-trxk --make (.tim / .frag mp4)', [(f, o) => { const b = join(o, 'clip', 'trxk.mp4'); mkdirSync(dirname(b), { recursive: true }); for (const s of ['.tim.mp4', '.frag.mp4']) copyFileSync(f.trxk + s, b + s); return [b, o]; }]),
  C('groups-dock', 'wide / tall / bright box clips (ffmpeg) + a picture folder', [(f, o) => [own(o, f.dockWide), own(o, f.dockTall), own(o, f.dockBright), o, f.picsDisc]]),
  C('seedmarks', 'groups-hide --make (one shot, 4 s)', [(f, o) => [own(o, f.hide), o]]),
  C('roi', 'groups-hide --make (one shot, 4 s): Track ROI = one painted part (paw-x8we)', [(f, o) => [own(o, f.hide), o]]),
  C('groups-seed2', 'clip + FAKE_REQ_LOG (emptied first)', [(f, o) => [own(o, f.hide), o, f.reqlog]], { pre: (f) => rmSync(f.reqlog, { force: true }) }),
  C('modrun', 'orange bar toward a blue box (ffmpeg)', [(f, o) => [own(o, f.modrun), o]]),
  C('vp8-frames', 'VP8 WebM (vp8-frames --make)', [(f, o) => [own(o, f.vp8), o]]),
  C('shot-land', 'frame-number bars clip (ffmpeg geq)', [(f, o) => [own(o, f.shotland)]]),
  C('filmstrip-cut', 'index clip 104 s 45 fps, band at 600', [(f, o) => [own(o, f.index104mid)]], { slow: true }),
  C('scrub-linear', 'index clip 104 s 45 fps', [(f, o) => [own(o, f.index104)]], { slow: true }),
  C('overlay-sync', 'cfr24 / cfr30 / cfr60 in a dir', [(f, o) => { for (const n of ['cfr24', 'cfr30', 'cfr60']) own(o, f[n]); return [join(o, 'clip')]; }]),
  // (alone: its seeks per drag count the 120 ms rests, which the CDP moves get on a loaded PC: 19 seeks once beside three shards)
  C('ruler-scrub', 'cfr30 / cfr24 in a dir', [(f, o) => { for (const n of ['cfr30', 'cfr24']) own(o, f[n]); return [join(o, 'clip')]; }], { alone: true }),
  // pictures (the labelling workspace); groups-loosen (a notch under 150 ms: 178 once beside three shards) and groups-perf (frame
  // time, long tasks) measure budgets: alone
  ...['autoname', 'groups-loosen', 'groups-suggest-sam', 'limbs', 'groups-perf'].map((n) => C(n, '1080p orange disc picture', [(f, o) => [f.picsDisc, o]], ['groups-loosen', 'groups-perf'].includes(n) ? { alone: true } : {})),
  C('groups-alt', '1080p orange disc picture', [(f) => [f.picsDisc]]),
  C('hover-keys', 'a dark and a light picture', [(f, o) => [f.picsTwo, o]]),
  C('suggest-confidence', 'pictures named many-*', [(f, o) => [f.picsMany, o]]),
  // restarts with the same id (app data kept)
  C('linkfill', 'loop clip; prepare, restart, check', [(f, o) => ['prepare', own(o, f.loopfill), o], 'restart', (f, o) => ['check', join(o, 'clip', 'loopfill.mp4'), o]]),
  C('loopcrop', 'make_loopclips.py; prepare, restart, check', [(f, o) => ['prepare', own(o, f.loopcrop), o], 'restart', (f, o) => ['check', join(o, 'clip', 'loopcrop.mp4'), o]]),
  C('regions', 'assist60; prepare, restart, check', [(f, o) => ['prepare', own(o, f.assist60), o], 'restart', (f, o) => ['check', join(o, 'clip', 'assist60.mp4'), o]]),
  C('smoke', 'clip >= 14 s + FAKE_REQ_LOG; prepare, restart, check', [(f, o) => ['prepare', own(o, f.cfr2997), f.reqlog], 'restart', (f, o) => ['check', join(o, 'clip', 'cfr2997.mp4'), f.reqlog]]),
  // (a clip > 4 s: it seeks to 4 s; groups-hide's clip is exactly 4 s long)
  C('groups-mseed', 'clip > 4 s + FAKE_REQ_LOG; run, restart, reopen', [(f, o) => ['run', own(o, f.cfr30), o, f.reqlog], 'restart', (f, o) => ['reopen', join(o, 'clip', 'cfr30.mp4'), o, f.reqlog]]),
  C('bottom', 'cfr30; check (PERSIST), restart, persisted', [(f, o) => ['check', own(o, f.cfr30)], 'restart', (f, o) => ['persisted', join(o, 'clip', 'cfr30.mp4')]], { env: { PERSIST: '1' } }),
  C('tabs-multi', 'three distinct clips; open (closes the window), restart, back', [(f, o) => ['open', own(o, f.ta), own(o, f.tb), own(o, f.tc)], 'restart', (f, o) => ['back', join(o, 'clip', 'ta.mp4'), join(o, 'clip', 'tb.mp4')]], { last: true }),
  // long clips
  // (alone: playback while fillers load vs nothing to load, 3 s each: 70 vs 87 frames beside three shards, 26/0 alone)
  C('gridfilm', '13-minute index clip', [(f, o) => [own(o, f.index13m), '--shots', o]], { slow: true, alone: true }),
  C('lod', '140 s clip + 20-minute clip', [(f, o) => [own(o, f.t140), own(o, f.t20m), o, 'after']], { slow: true }),
  C('proxy', 'fresh instance, real ffmpeg proxies; make, restart, restart phase', [(f, o) => ['make', join(o, 'dir')], 'restart', (f, o) => ['restart', join(o, 'dir')]], { group: 'proxy', slow: true }),
  // other instances
  C('home', 'fresh instance, alpha / bravo / charlie clips; prepare, restart, check', [(f, o) => ['prepare', homeDir(f, o)], 'restart', (f, o) => ['check', join(o, 'clips')]], { group: 'home' }),
  ...['posbar-shaft', 'shaft-data', 'shaft-source'].map((n) => C(n, 'FAKE_SHAFT_STORY=strokes, clip >= 8 s', [(f, o) => [own(o, f.cfr30), o]], { group: 'shaft' })),
  C('tabs', 'FAKE_DELAY_MS=20', [(f, o) => [own(o, f.cfr30)]], { group: 'env' }),
  C('groups-naming', 'FAKE_NAME_MS=2000, a picture', [(f, o) => [f.picsDisc, o]], { group: 'env' }),
  C('shaft-live', 'FAKE_SHAFT_MS=30, clip >= 4 s', [(f, o) => [own(o, f.cfr30), o]], { group: 'env' }),
  // headless Edge on vite (no instance)
  ...['groups', 'pulse', 'seeder', 'shaft'].map((n) => C(n, 'vite :5200, dev/tracking.html?video=1', [(f, o) => [VPORT, join(o, n + '.png')]], { group: 'vite' })),
  C('tracking', 'vite :5200, dev/tracking.html', [(f, o) => [o]], { group: 'vite' }),   // VITE_PORT: every vite check's env
  C('machine-stage', 'vite :5200, dev/shell.html', [(f, o) => [`http://localhost:${VPORT}/dev/shell.html`, o]], { group: 'vite' }),
  // not run here
  C('dataset', 'old-layout migration with a manual step between phases', [], { skip: 'manual step (move the labels folder by hand between phases)' }),
  C('shots', 'an old flat .pawproj (not in the repo)', [], { skip: 'its fixture (an old flat project) is not in the repo' }),
  C('no-stock-toys', 'a dist built with the stock toy library emptied', [], { skip: 'needs the public build (dev/share/build-nas.ps1)' }),
  C('paint-perf', 'the big generated project (10-min 1080p, 126 MB runs)', [], { skip: 'measurement on dev/perf/big-project.mjs; run by hand with --assert' }),
  C('playback-app', 'device server', [], { skip: 'prints a dump, asserts nothing' }),
];
const homeDir = (f, o) => { const d = join(o, 'clips'); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); copyFileSync(f.cfr24, join(d, 'alpha.mp4')); copyFileSync(f.cfr25, join(d, 'bravo.mp4')); copyFileSync(f.cfr30, join(d, 'charlie.mp4')); return d; };
const GROUPS = { main: {}, home: {}, proxy: {}, shaft: { FAKE_SHAFT_STORY: 'strokes' }, env: { FAKE_DELAY_MS: '20', FAKE_NAME_MS: '2000', FAKE_SHAFT_MS: '30' } };

if (argv.includes('--list')) {
  for (const c of CHECKS) console.log(`${c.name.padEnd(20)} ${(c.skip ? 'skip' : c.group + (c.slow ? ' slow' : '') + (c.alone ? ' alone' : '')).padEnd(17)} ${c.need}${c.skip ? '  (' + c.skip + ')' : ''}`);
  process.exit(0);
}
if (!DIR || !(TARGET || ADOPT)) { console.error('usage: node dev/check-all.mjs --dir <scratch dir> --target <CARGO_TARGET_DIR> [--skip-slow] [--only a,b] [--list] [--app-repo <repo>] [--src <tree>]'); process.exit(2); }

// ---- fixtures -----------------------------------------------------------------------------------------------------------
const FX = join(DIR, 'fx'); mkdirSync(FX, { recursive: true });
const sh = (exe, args, env = {}) => { const r = spawnSync(exe, args, { cwd: here, env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${basename(exe)} ${args.join(' ').slice(0, 200)}: ${(r.stderr || r.stdout || '').slice(-400)}`); };
const ff = (...a) => sh('ffmpeg', ['-y', '-v', 'error', '-threads', '4', ...a]);
const X264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
// a fixture that cannot be made here (no Python venv, no dev/assets) is reported; the checks that need it are skipped, not failed
const make = (file, fn, slow) => {
  const p = join(FX, file);
  if (existsSync(p) && !statSync(p).size) rmSync(p);
  if (!existsSync(p) && !(slow && SKIP_SLOW)) { console.log('  fixture ' + file); try { fn(p); } catch (e) { rmSync(p, { force: true }); console.log('  fixture ' + file + ' not made: ' + String(e.message).split('\n')[0]); } }
  return p;
};
const asset = (n) => make(n + '.mp4', (p) => copyFileSync(join(APP, 'dev/assets', n + '.mp4'), p));
const disc = "geq=r='if(lt(hypot(X-960,Y-540),348),255,24)':g='if(lt(hypot(X-960,Y-540),348),140,40)':b='if(lt(hypot(X-960,Y-540),348),0,80)'";
function fixtures() {
  const f = {};
  for (const n of ['cfr24', 'cfr25', 'cfr30', 'cfr60', 'cfr2997', 'assist60']) f[n] = asset(n);
  f.reqlog = join(DIR, 'reqlog.jsonl');
  const src = (d, extra = '') => ['-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${d}${extra}`];
  f.t16 = make('t16.mp4', (p) => ff(...src(16), ...X264, p));
  f.t40 = make('t40.mp4', (p) => ff(...src(40), ...X264, p));
  for (const [k, h] of [['ta', 0], ['tb', 120], ['tc', 240]]) f[k] = make(k + '.mp4', (p) => ff(...src(10), '-vf', `hue=h=${h}`, ...X264, p));
  f.index20 = make('index20.mp4', (p) => sh(node, ['dev/make-index-clip.mjs', p, '20', '30', '600']));
  f.index104 = make('index104.mp4', (p) => sh(node, ['dev/make-index-clip.mjs', p]), true);
  f.index104mid = make('index104mid.mp4', (p) => sh(node, ['dev/make-index-clip.mjs', p, '104', '45', '600']), true);
  f.index13m = make('index13m.mp4', (p) => sh(node, ['dev/make-index-clip.mjs', p, '780', '30', '600']), true);
  f.loopfill = make('loopfill.mp4', (p) => sh(node, ['dev/make-loop-clip.mjs', p, '--secs', '14', '--segs', '60:20:100:100;300:20:90:100']));
  f.loopsui = make('loopsui.mp4', (p) => sh(node, ['dev/make-loop-clip.mjs', p, '--secs', '24', '--segs', '60:8:228:100;288:8:236:200;600:8:44:100;680:8:16:100']));
  f.loopgrid = make('loopgrid.mp4', (p) => sh(node, ['dev/make-loop-clip.mjs', p]));
  f.tilestop = make('tilestop.mp4', (p) => sh(node, ['dev/make-loop-clip.mjs', p, '--secs', '16', '--segs', '60:20:100:100;160:1:1:119;161:20:100:100', '--redraw', '160:24']));
  f.hide = make('hide.mp4', (p) => sh(node, ['dev/groups-hide-check.mjs', '--make', p]));
  f.copy = make('copy.mp4', (p) => sh(node, ['dev/groups-copy-check.mjs', '--make', p]));
  f.crop = make('crop.mp4', (p) => sh(node, ['dev/groups-copy-crop-check.mjs', '--make', p]));
  f.trxk = join(FX, 'trxk.mp4'); make('trxk.mp4.tim.mp4', () => sh(node, ['dev/groups-copy-trxk-check.mjs', '--make', f.trxk]));
  f.vp8 = make('vp8.webm', (p) => sh(node, ['dev/vp8-frames-check.mjs', '--make', p]));
  const viaPy = (script, args) => (p) => { const raw = p + '.raw.mp4'; sh(PY, ['-I', script, raw, ...args], { CLIP_SHOT_S: '5' }); ff('-i', raw, ...X264, '-g', '1', p); rmSync(raw, { force: true }); };
  f.cropscene = make('cropscene.mp4', viaPy('experiments/cropscene/make_clips.py', ['A', 'I', 'A16']));
  f.loopcrop = make('loopcrop.mp4', viaPy('experiments/cropscene/make_loopclips.py', ['A', 'F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'A18']));
  // ponytail: the next four are made to the checks' stated geometry; their headers give no exact command
  f.peek = make('peek.mp4', (p) => ff('-f', 'lavfi', '-i', 'color=c=0x2040a0:s=1280x720:r=30:d=4', '-vf', "drawbox=x='100+200*t':y=250:w=240:h=200:color=0xff8000:t=fill", ...X264, '-g', '1', p));
  f.modrun = make('modrun.mp4', (p) => ff('-f', 'lavfi', '-i', 'color=c=0x303030:s=1280x720:r=30:d=8', '-vf', "drawbox=x=900:y=300:w=160:h=160:color=0x2060ff:t=fill,drawbox=x='300+500*abs(sin(t*1.6))':y=360:w=400:h=40:color=0xff8000:t=fill", ...X264, '-g', '1', p));
  const dock = (s, bg) => (p) => ff('-f', 'lavfi', '-i', `color=c=${bg}:s=${s}:r=30:d=6`, '-vf', 'drawbox=x=iw*0.3:y=ih*0.35:w=iw*0.2:h=ih*0.25:color=0xff8000:t=fill,drawbox=x=iw*0.55:y=ih*0.3:w=iw*0.12:h=ih*0.15:color=0x20c040:t=fill', ...X264, p);
  f.dockWide = make('dock-wide.mp4', dock('1280x720', '0x101838'));
  f.dockTall = make('dock-tall.mp4', dock('720x1280', '0x101838'));
  f.dockBright = make('dock-bright.mp4', dock('1280x720', '0xe8e8e0'));
  f.shotland = make('shotland.mp4', (p) => ff('-f', 'lavfi', '-i', "color=c=black:s=320x180:r=30,format=yuv420p,geq=lum='255*bitand(1,floor(N/pow(2,floor(X*12/W))))':cb=128:cr=128", '-frames:v', '2300', ...X264, '-g', '30', p));
  f.t140 = make('t140.mp4', (p) => ff(...src(140), ...X264, p), true);
  f.t20m = make('t20m.mp4', (p) => ff(...src(1200), ...X264, '-preset', 'veryfast', p), true);
  const pics = (name, files) => { const d = join(FX, name); if (!existsSync(d)) { mkdirSync(d); for (const [file, vf] of files) ff('-f', 'lavfi', '-i', 'color=c=0x203040:s=1920x1080:d=1', '-vf', vf, '-frames:v', '1', join(d, file)); } return d; };
  f.picsDisc = pics('pics-disc', [['disc.png', 'format=rgb24,' + disc]]);
  f.picsTwo = pics('pics-two', [['a-dark.png', 'drawbox=x=700:y=300:w=500:h=500:color=0x402010:t=fill'], ['b-light.png', 'drawbox=x=0:y=0:w=1920:h=1080:color=0xe0e0d0:t=fill,drawbox=x=700:y=300:w=500:h=500:color=0xc08040:t=fill']]);
  f.picsMany = pics('pics-many', [1, 2, 3].map((k) => [`many-${k}.png`, `format=rgb24,${disc},hue=h=${k * 90}`]));
  return f;
}

// ---- instances ----------------------------------------------------------------------------------------------------------
let inst = null;   // { id, cdpPort, url, dir }
// --adopt: the run folder's instance (the dev/remote runner started it) is the main one; its cargo target is the job's
const job = ADOPT ? JSON.parse(readFileSync(join(ADOPT, 'job.json'), 'utf8').replace(/^\uFEFF/, '')) : null;
const TGT = TARGET || resolve(job.target), started = new Set();
if (ADOPT) inst = { ...JSON.parse(readFileSync(join(ADOPT, 'test-app.json'), 'utf8')), dir: ADOPT, group: 'main' };
const testApp = (args, env = {}) => spawnSync(node, ['dev/test-app.mjs', ...args], { cwd: APP, env: { ...process.env, ...env }, windowsHide: true, encoding: 'utf8' });
async function start(group, id) {
  const dir = group === 'main' && ADOPT ? ADOPT : join(DIR, 'inst-' + group);
  const r = testApp(['start', '--dir', dir, '--target', TGT, ...(id ? ['--id', id] : [])], { FAKE_REQ_LOG: join(DIR, 'reqlog.jsonl'), ...GROUPS[group] });
  if (r.status !== 0) throw new Error('test-app start failed: ' + (r.stdout + r.stderr).slice(-600));
  inst = { ...JSON.parse(readFileSync(join(dir, 'test-app.json'), 'utf8')), dir, group };
  if (dir !== ADOPT) started.add(inst.id);
  if (SRC) {
    const b = spawnSync(node, [join(SRC, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(dir, 'dist'), '--emptyOutDir'], { cwd: SRC, env: { ...process.env, VITE_TEST_ID: inst.id, VITE_EXPOSE_APP: '1' }, windowsHide: true, encoding: 'utf8' });
    if (b.status !== 0) throw new Error('dist build from --src failed: ' + b.stderr.slice(-600));
  }
  await ready(15 * 60e3);
}
function stop() { if (inst) testApp(['stop', '--dir', inst.dir]); inst = null; }
async function restart() { const { group, id } = inst; stop(); await start(group, id); }
const cdpEnv = () => ({ CDP_PORT: String(inst.cdpPort), CDP_EXPECT_URL: inst.url, CDP_TEST_ID: inst.id });
/** wait until the instance's page answers as the app (cargo may still be building), then reload it; clean (a check starts on an
 *  instance an earlier check used): the area layout back to the default first */
async function ready(ms, clean = false) {
  const t0 = Date.now();
  for (;;) {
    const b = await chromium.connectOverCDP('http://127.0.0.1:' + inst.cdpPort).catch(() => null);
    const page = b?.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(inst.url));
    // the window loaded while --src's build had emptied its dist (a 404: chrome-error://, never inst.url again): load it again
    if (!page) await b?.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('chrome-error://'))?.goto(inst.url).catch(() => {});
    const ok = page && (await page.evaluate(() => window.__pawscriptTestId).catch(() => null)) === inst.id;
    if (ok) {
      // the browser's input state outlives a CDP connection: a button or a modifier a check left down (it failed mid-drag)
      // would reach the next check (a tip never shows while a button is held), so let go of everything first
      const s = await page.context().newCDPSession(page).catch(() => null);
      for (const button of ['left', 'right', 'middle']) await s?.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button, clickCount: 1 }).catch(() => {});
      for (const key of ['Shift', 'Control', 'Alt', 'Meta', ' ']) await s?.send('Input.dispatchKeyEvent', { type: 'keyUp', key }).catch(() => {});
      // paw-a82t (46aa474): a start-up reopen is marked "opening" until it has stood 5 s; a reload before that reads as a crash at
      // the next boot and that document is NOT reopened (tabs-multi 'back' lost the tab shown at quit): wait out a fresh mark (an
      // old one is a reopen already refused: it stays until Open anyway)
      await page.waitForFunction(() => { try { return (!window.appTabs || window.appTabs.restored) && Object.values(JSON.parse(localStorage.getItem('pawscript.opening') || '{}') || {}).every((t) => Date.now() - t > 6000); } catch { return true; } }, null, { timeout: 30e3 }).catch(() => {});
      // a check starts as in a fresh instance (where each passes alone): the settings an earlier check left go back to their
      // defaults (runsel's open tracker panel took 200 px from groups-dock's 900 x 600 stage; area layouts), and the tabs it left
      // open are not reopened by this reload (or by a reload of the check's own): the start-up restore lands whenever it is done
      // and its tab shows, taking window.app away from the clip the check opened (see below; paw-mawd)
      if (clean) {
        const had = await page.evaluate(() => {
          const s = window.app?.settings, k = Object.keys(s?.values || {}), out = [];
          if (k.length) { s.reset(k); out.push('settings ' + k.join(' ')); }
          try { const r = JSON.parse(localStorage.getItem('pawscript.resume') || 'null'); if (r?.open?.length || r?.active) { localStorage.setItem('pawscript.resume', JSON.stringify({ ...r, open: [], active: null })); out.push('open tabs'); } } catch { /* no store */ }
          return out;
        }).catch(() => []);
        if (had.length) console.log(`  (left by an earlier check, reset: ${had.join(', ')})`);
      }
      await page.reload().catch(() => {});
      const up = await page.waitForFunction(() => window.app?.commands, null, { timeout: 60e3 }).then(() => true, () => false);
      // the start-up tab restore (tabs.svelte.js restore) reopens the documents open before the reload, and the tab of each one
      // that lands shows: window.app is that tab's app from then on. A check started before it lands opens its clip in one app and
      // goes on driving the restored document (under load it lands seconds late: runs, saves and tracks went to the other
      // document, paw-mawd). Wait until it is done, or a question it asks is up (the check answers it).
      if (up && !(await page.waitForFunction(() => !window.appTabs || window.appTabs.restored || !!window.app?.dialog, null, { timeout: 60e3 }).then(() => true, () => false))) console.log(`  instance ${inst.id}: the start-up tab restore had not finished after 60 s`);
      await b.close().catch(() => {});
      if (up) return;
    } else await b?.close().catch(() => {});
    if (Date.now() - t0 > ms) throw new Error(`instance ${inst.id} did not come up in ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---- running a check ----------------------------------------------------------------------------------------------------
const scriptOf = (name) => join(here, 'dev', /-e2e$/.test(name) ? name + '.mjs' : name + '-check.mjs');
function runScript(name, args, env, timeoutMs) {
  return new Promise((done) => {
    const p = spawn(node, [scriptOf(name), ...args], { cwd: here, env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write('    ' + String(d).replace(/\n(?=.)/g, '\n    ')); });
    p.stderr.on('data', (d) => { out += d; process.stdout.write('    ' + String(d).replace(/\n(?=.)/g, '\n    ')); });
    const kill = setTimeout(() => { out += '\nFAIL timed out after ' + timeoutMs / 1000 + ' s\n'; spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true }); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(kill); done({ code, out }); });
  });
}
// ok / PASS lines pass, FAIL lines fail (std checks, tips / mods / shell-e2e, machine-stage, shot-land); scripts that print
// neither (filmstrip-cut, scrub-linear, loops-grid, lod) count as one assertion decided by their exit code.
function tally({ code, out }) {
  const lines = out.split(/\r?\n/);
  let pass = lines.filter((l) => /^(ok|PASS)\b/.test(l)).length, fail = lines.filter((l) => /^FAIL\b/.test(l)).length;
  if (!pass && !fail) (code === 0 ? pass++ : fail++);
  else if (code !== 0 && !fail) fail++;   // a crash or a refused connection after some ok lines
  return { pass, fail };
}

let viteProc = null;
async function vite() {
  const root = SRC || here;
  if (!existsSync(join(root, 'dev/assets/cfr2997.mp4'))) for (const n of readdirSync(join(APP, 'dev/assets')).filter((x) => x.endsWith('.mp4'))) { mkdirSync(join(root, 'dev/assets'), { recursive: true }); copyFileSync(join(APP, 'dev/assets', n), join(root, 'dev/assets', n)); }
  // paw-7dhk: the second PC's tree has no dev/assets clips (gitignored, not exported): without one the page shows its 'no picture' card over the stage and
  // the groups / pulse / seeder / shaft checks fail on the card swallowing the pointer; a plain 60 s clip does (none reads a burned-in index)
  const clip = join(root, 'dev/assets/cfr2997.mp4');
  if (!existsSync(clip)) { mkdirSync(join(root, 'dev/assets'), { recursive: true }); try { ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30000/1001:d=60', ...X264, clip); } catch (e) { rmSync(clip, { force: true }); console.log('  dev/assets/cfr2997.mp4 not made: ' + String(e.message).split('\n')[0]); } }
  // its own dep cache (the default node_modules/.vite is shared with the live dev server through a junctioned node_modules)
  const { createServer } = await import('vite');
  // strictPort off: a port taken meanwhile (another run on the rig) moves it to the next free one; the checks get the one it got
  viteProc = await createServer({ root, logLevel: 'error', cacheDir: join(DIR, 'vite-cache'), server: { port: +VPORT, strictPort: false, hmr: false, watch: null } });
  try { await viteProc.listen(); } catch (e) { console.log(`  vite did not listen from :${VPORT}: ${e.message}`); viteProc = null; return false; }
  VPORT = String(viteProc.httpServer.address().port);
  // its first page is transformed on demand (deps optimised into a fresh cache): seconds under load, so asked until it answers
  let why = '';
  for (const t0 = Date.now(); Date.now() - t0 < 60e3; await new Promise((r) => setTimeout(r, 1000))) {
    why = await fetch(`http://localhost:${VPORT}/dev/tracking.html`, { signal: AbortSignal.timeout(30e3) }).then((r) => r.ok || 'HTTP ' + r.status, (e) => e.cause?.code || e.message);
    if (why === true) return true;
  }
  console.log(`  vite on :${VPORT} did not serve dev/tracking.html in 60 s: ${why}`);
  return false;
}

// ---- main ---------------------------------------------------------------------------------------------------------------
let todo = CHECKS.filter((c, i) => (!ONLY || ONLY.includes(c.name)) && (c.group === 'vite' ? 0 : i) % SHARDS === SHARD - 1);   // the vite checks share :5200: one shard
if (FROM) todo = todo.slice(Math.max(0, todo.findIndex((c) => c.name === FROM)));
const rows = [];
const f = fixtures();
// --adopt: the runner (dev/remote) started that instance without FAKE_REQ_LOG (smoke, groups-seed2, groups-mseed read their requests from
// it): restarted once here, same id, with this run's environment
if (ADOPT && todo.some((c) => c.group === 'main')) await restart();
const order = ['main', 'home', 'shaft', 'env', 'proxy', 'vite'];
const sorted = [...todo].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (b.first ? 1 : 0) - (a.first ? 1 : 0) || (a.last ? 1 : 0) - (b.last ? 1 : 0));
async function runCheck(c) {
  const group = c.group;
  if (c.skip || (c.slow && SKIP_SLOW)) { rows.push({ name: c.name, skip: c.skip || 'slow (--skip-slow)' }); return; }
  const o = join(DIR, 'out', c.name); rmSync(o, { recursive: true, force: true }); mkdirSync(o, { recursive: true });
  const t0 = Date.now(), res = { name: c.name, group, pass: 0, fail: 0 };
  try {
    if (group === 'vite') { if (!viteProc && !(await vite())) throw new Error(`vite from :${VPORT} did not start (see above)`); }
    else if (!inst || inst.group !== group || (['home', 'proxy'].includes(group) && rows.some((x) => x.group === group))) { stop(); await start(group); }
    else await ready(60e3, true);
    c.pre?.(f);
    for (const s of c.steps) {
      if (s === 'restart') { await restart(); continue; }
      const args = s(f, o);
      console.log(`\n== ${c.name} ${args.map((a) => basename(String(a))).join(' ')}`);
      const r = tally(await runScript(c.name, args, { ...(inst ? cdpEnv() : {}), ...(group === 'vite' ? { VITE_PORT: VPORT } : {}), SHOT_DIR: o, ...c.env }, (c.slow ? 30 : 10) * 60e3));
      res.pass += r.pass; res.fail += r.fail;
    }
    if (c.name === 'tabs-multi') stop();   // its 'open' closed the window; 'back' ran on a restarted one
  } catch (e) {
    if (e.code === 'ENOENT' && String(e.path).startsWith(FX)) { rows.push({ name: c.name, skip: 'fixture not made here: ' + basename(e.path) }); return; }
    console.log('FAIL ' + e.message); res.fail++; if (inst) stop();
  }
  res.secs = Math.round((Date.now() - t0) / 1000);
  rows.push(res);
}
// ---- checks that run alone (alone: a time or frame budget the other shards' load breaks, paw-mawd) -------------------------
// Every shard runs its other checks first and says so in SYNC (<n>.done); a shard's alone checks then wait until every shard is
// done, and run one at a time across the shards (SYNC/alone.lock). SYNC: --sync <dir>, else beside the dev/remote runner's
// first run folder of this run (<stamp>-0\shard-sync: the shards of one dev/remote runner call share the stamp).
const SYNC = opt('sync') ? resolve(opt('sync')) : ADOPT && SHARDS > 1 ? join(ADOPT.replace(/-\d+$/, '-0'), 'shard-sync') : null;
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const markDone = () => { if (SYNC && SHARDS > 1) { mkdirSync(SYNC, { recursive: true }); writeFileSync(join(SYNC, `${SHARD}.done`), String(process.pid)); } };
async function othersDone() {
  if (!SYNC || SHARDS < 2) return;
  const all = () => Array.from({ length: SHARDS }, (_, i) => existsSync(join(SYNC, `${i + 1}.done`))).every(Boolean), t0 = Date.now();
  if (!all()) console.log(`\n  (the checks that run alone wait for the other shards: ${SYNC})`);
  while (!all() && Date.now() - t0 < 60 * 60e3) await nap(2000);
  if (!all()) console.log('  (not every shard was done after 60 min: the checks that run alone run beside them)');
}
async function aloneLock(fn) {
  if (!SYNC || SHARDS < 2) return fn();
  const lock = join(SYNC, 'alone.lock');
  for (;;) {
    try { writeFileSync(lock, String(SHARD), { flag: 'wx' }); break; } catch { /* another shard's alone check runs */ }
    try { if (Date.now() - statSync(lock).mtimeMs > 45 * 60e3) rmSync(lock, { force: true }); } catch { /* gone meanwhile */ }   // a shard that died holding it
    await nap(1000);
  }
  try { return await fn(); } finally { rmSync(lock, { force: true }); }
}
try {
  for (const group of order) for (const c of sorted.filter((c) => c.group === group && !c.alone)) await runCheck(c);
  markDone();
  const alone = sorted.filter((c) => c.alone);
  if (alone.length) await othersDone();
  for (const c of alone) await aloneLock(() => runCheck(c));
} finally {
  markDone();   // (a shard that threw: the others' alone checks do not wait for it)
  stop();
  await viteProc?.close().catch(() => {});
  // on the second PC: the app data of the instances started here (the dev/remote runner removes its own)
  if (ADOPT) for (const id of started) for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) if (base && /^test-[0-9a-f]+$/.test(id)) rmSync(join(base, 'app.pawscript.' + id), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

const w = Math.max(...rows.map((r) => r.name.length));
console.log('\n' + 'check'.padEnd(w) + '  pass  fail   secs');
for (const r of rows) console.log(r.skip ? `${r.name.padEnd(w)}  skipped: ${r.skip}` : `${r.name.padEnd(w)}  ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.secs).padStart(5)}${r.fail ? '  FAIL' : ''}`);
const bad = rows.filter((r) => r.fail).length;
console.log(`\n${rows.filter((r) => !r.skip && !r.fail).length} passed, ${bad} failed, ${rows.filter((r) => r.skip).length} skipped`);
writeFileSync(join(DIR, 'check-all.json'), JSON.stringify(rows, null, 1));
process.exit(bad ? 1 : 0);
