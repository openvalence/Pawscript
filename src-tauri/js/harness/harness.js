// Self-running verification of the native API in the real app (withGlobalTauri). Writes a JSON report, then exits.
import { parsePeaks } from '../media-data.js';

const { invoke, Channel, convertFileSrc } = window.__TAURI__.core;
const results = [];
const $ = (id) => document.getElementById(id);
const t0 = () => performance.now();

function show(r) {
  const tr = document.createElement('tr');
  for (const v of [r.name, r.ok ? 'OK' : 'FAIL', r.ms.toFixed(0), JSON.stringify(r.detail)]) {
    const td = document.createElement('td');
    td.textContent = v;
    tr.append(td);
  }
  tr.children[1].className = r.ok ? 'ok' : 'bad';
  $('results').append(tr);
}

/** Run fn; it returns detail (or throws). A thrown {code,message} is recorded as the failure. */
async function check(name, fn) {
  const s = t0();
  let ok = true, detail;
  try { detail = await fn(); } catch (e) { ok = false; detail = e && e.code ? { code: e.code, message: e.message } : { message: String(e && e.stack || e) }; }
  const r = { name, ok, ms: t0() - s, detail: detail ?? null };
  results.push(r); show(r);
  return r;
}
const assert = (c, msg) => { if (!c) throw new Error('assertion failed: ' + msg); };
/** Expect invoke to reject with this code. */
async function expectCode(code, p) {
  try { await p; } catch (e) { assert(e && e.code === code, `expected code ${code}, got ${JSON.stringify(e)}`); return { code, message: e.message }; }
  throw new Error(`expected rejection ${code}, but it resolved`);
}
/** invoke with a Channel; collects events. */
function job(cmd, args, onEv) {
  const id = crypto.randomUUID(), events = [], onEvent = new Channel();
  onEvent.onmessage = (ev) => { events.push({ t: t0(), ev }); onEv?.(ev); };
  return { id, events, promise: invoke(cmd, { ...args, job: id, onEvent }) };
}
const progress = (events) => events.filter((e) => e.ev.kind === 'progress');
const bytes = (buf, n) => Array.from(new Uint8Array(buf, 0, n));

async function run(cfg) {
  const { video, videoNoAudio, workDir } = cfg;
  const sep = workDir.includes('\\') ? '\\' : '/';
  const join = (...p) => p.join(sep);
  const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
  const W = (name) => join(workDir, name);
  let fp, strip;

  await check('app_paths', async () => {
    const p = await invoke('app_paths');
    assert(p.settings && p.autosave && p.media_cache, 'paths missing');
    return p;
  });
  await check('settings roundtrip', async () => {
    const value = { harness: true, n: 42, nested: { a: [1, 2] } };
    await invoke('settings_set', { value });
    const got = await invoke('settings_get');
    assert(JSON.stringify(got.value) === JSON.stringify(value), 'value differs');
    return { warning: got.warning };
  });
  await check('recent add/list/remove', async () => {
    const f = W('recent-probe.txt');
    await invoke('write_text_atomic', { path: f, text: 'x' });
    const added = await invoke('recent_add', { path: f });
    assert(added[0] && added[0].path === f, 'not first after add');
    const listed = await invoke('recent_list');
    assert(listed.some((r) => r.path === f && r.exists), 'not listed/exists');
    const after = await invoke('recent_remove', { path: f });
    assert(!after.some((r) => r.path === f), 'still present');
    return { kind: added[0].kind, count: listed.length };
  });
  await check('write_text_atomic + read_text', async () => {
    const text = '﻿hello é中\n';
    const w = await invoke('write_text_atomic', { path: W('atomic.txt'), text });
    const r = await invoke('read_text', { path: W('atomic.txt') });
    assert(r.text === text.slice(1), 'BOM not stripped / text differs');
    assert(r.sha256 === w.sha256, 'sha differs');
    return { size: r.size, sha256: r.sha256 };
  });
  await check('write_with_backup x3 + conflict + list_backups', async () => {
    const f = W('doc.funscript');
    await invoke('write_text_atomic', { path: f, text: 'foreign' });
    const a = await invoke('write_with_backup', { path: f, text: 'v1' });
    assert(a.first_backup && !a.rolling_backup, '1st: expected first_backup only');
    const b = await invoke('write_with_backup', { path: f, text: 'v2' });
    assert(b.rolling_backup && !b.first_backup, '2nd: expected rolling_backup');
    const c = await invoke('write_with_backup', { path: f, text: 'v3', expectedSha256: b.sha256 });
    assert(c.rolling_backup, '3rd: expected rolling_backup');
    const conflict = await expectCode('conflict', invoke('write_with_backup', { path: f, text: 'v4', expectedSha256: 'deadbeef' }));
    assert((await invoke('read_text', { path: f })).text === 'v3', 'conflict wrote anyway');
    const same = await invoke('write_with_backup', { path: f, text: 'v3' });
    assert(same.unchanged === true, 'expected unchanged');
    const backups = await invoke('list_backups', { path: f });
    assert(backups.some((x) => x.kind === 'first') && backups.some((x) => x.kind === 'rolling'), 'backup kinds');
    return { first: a.first_backup, rolling: [b.rolling_backup, c.rolling_backup], conflict, backups: backups.length };
  });
  await check('list_dir stem/ext + file_stat', async () => {
    for (const n of ['clip.funscript', 'clip.roll.funscript', 'clip2.funscript', 'clip.txt'])
      await invoke('write_text_atomic', { path: W(n), text: '{}' });
    const l = await invoke('list_dir', { dir: workDir, stem: 'clip', ext: '.funscript' });
    const names = l.map((e) => e.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['clip.funscript', 'clip.roll.funscript']), 'got ' + names);
    const all = await invoke('list_dir', { dir: workDir });
    const st = await invoke('file_stat', { path: W('clip.funscript') });
    assert(st.exists && st.is_file && !st.is_dir && st.size === 2, 'stat file');
    const miss = await invoke('file_stat', { path: W('nope.bin') });
    assert(miss.exists === false, 'stat missing should not exist');
    return { filtered: names, total: all.length };
  });
  await check('autosave write x3 / list / clear', async () => {
    const session = crypto.randomUUID();
    let last;
    for (let i = 0; i < 3; i++) last = await invoke('autosave_write', { session, title: 'harness', content: `{"n":${i}}`, keep: 2 });
    const list = await invoke('autosave_list');
    const c = list.find((x) => x.session === session);
    assert(c, 'candidate missing');
    assert(c.snapshots.length === 2, 'keep=2 not honoured: ' + c.snapshots.length);
    assert((await invoke('read_text', { path: c.snapshots[0].path })).text === '{"n":2}', 'newest snapshot content');
    await invoke('autosave_clear', { id: c.id });
    assert(!(await invoke('autosave_list')).some((x) => x.id === c.id), 'not cleared');
    return { id: c.id, unsaved_work: c.unsaved_work, saved: last.saved_ms };
  });

  await check('media_tools', async () => {
    const t = await invoke('media_tools');
    assert(t.ffmpeg && t.ffprobe, 'ffmpeg/ffprobe missing');
    return t;
  });
  await check('media_probe', async () => {
    const p = await invoke('media_probe', { path: video });
    assert(p.video && p.duration_ms > 0, 'no video/duration');
    return { duration_ms: p.duration_ms, has_audio: p.has_audio, webview_playable: p.webview_playable, video: p.video };
  });

  const framesRun = async () => {
    const p = await invoke('media_probe', { path: video });
    const j = job('media_frame_times', { path: video });
    const buf = await j.promise;
    assert(buf instanceof ArrayBuffer && buf.byteLength % 8 === 0, 'not a Float64 buffer');
    const t = new Float64Array(buf);
    for (let i = 1; i < t.length; i++) assert(t[i] > t[i - 1], 'not strictly ascending at ' + i);
    assert(Math.abs(t.length - p.video.frame_count) <= 1, `count ${t.length} vs probe ${p.video.frame_count}`);
    return { count: t.length, first: t[0], last: t[t.length - 1], fps_rational: p.video.fps_rational, progressEvents: progress(j.events).length };
  };
  await check('media_frame_times (cold)', framesRun);
  await check('media_frame_times (cached)', framesRun);

  const peaksRun = async () => {
    const j = job('waveform_peaks', { path: video });
    const buf = await j.promise;
    assert(buf instanceof ArrayBuffer, 'not an ArrayBuffer: ' + Object.prototype.toString.call(buf));
    const pk = parsePeaks(buf);
    const pr = progress(j.events);
    return { bytes: buf.byteLength, progressEvents: pr.length, lastFraction: pr.at(-1)?.ev.fraction, levels: pk.levels.map((l) => l.count), durationMs: pk.durationMs, bucketMs0: pk.levels[0].bucketMs };
  };
  await check('waveform_peaks (cold or warm)', peaksRun);
  await check('waveform_peaks (cached repeat)', peaksRun);

  await check('thumbnail_strip + sheet decode', async () => {
    const s = t0();
    const j = job('thumbnail_strip', { path: video, height: 90 });
    strip = await j.promise;
    const total = t0() - s;
    const sheets = j.events.filter((e) => e.ev.kind === 'sheet');
    assert(strip.levels.length > 0 && strip.levels.at(-1).sheets.length > 0, 'no sheets');
    const first = sheets[0];
    const img = new Image();
    img.src = convertFileSrc(strip.levels.at(-1).sheets[0]);
    await img.decode();
    assert(img.naturalWidth > 0, 'image did not decode');
    return {
      firstSheetMs: first ? first.t - s : null, totalMs: total, sheetEvents: sheets.length,
      levels: strip.levels.map((l) => ({ count: l.count, sheets: l.sheets.length })),
      tile: [strip.tile_w, strip.tile_h], grid: [strip.columns, strip.rows],
      image: [img.naturalWidth, img.naturalHeight],
    };
  });

  await check('extract_frame png', async () => {
    const b = await invoke('extract_frame', { path: video, timeMs: 1000, format: 'png' });
    assert(b instanceof ArrayBuffer, 'not ArrayBuffer');
    assert(bytes(b, 4).join() === '137,80,78,71', 'PNG signature');
    return { bytes: b.byteLength };
  });
  await check('extract_frame jpeg maxWidth', async () => {
    const b = await invoke('extract_frame', { path: video, timeMs: 1000, format: 'jpeg', maxWidth: 320 });
    assert(bytes(b, 2).join() === '255,216', 'JPEG signature');
    return { bytes: b.byteLength };
  });
  await check('save_frame', async () => {
    const dest = W('frame.png');
    const w = await invoke('save_frame', { path: video, timeMs: 500, dest });
    const st = await invoke('file_stat', { path: dest });
    assert(st.exists && st.size === w.size && w.size > 0, 'file not written');
    return w;
  });

  await check('file_fingerprint', async () => {
    fp = await invoke('file_fingerprint', { path: video });
    assert(/^q1-\d+-[0-9a-f]{32}$/.test(fp.fingerprint), 'format: ' + fp.fingerprint);
    return fp;
  });
  await check('file_sha256 with progress', async () => {
    const j = job('file_sha256', { path: video });
    const h = await j.promise;
    assert(/^[0-9a-f]{64}$/.test(h), 'hash format');
    const pr = progress(j.events);
    assert(pr.length > 0 && pr.at(-1).ev.fraction === 1, 'final progress 1');
    return { sha256: h, progressEvents: pr.length, stage: pr[0].ev.stage };
  });
  await check('relink_search (dirname(video), depth 0)', async () => {
    const r = await invoke('relink_search', { dir: dirOf(video), fingerprint: fp.fingerprint, maxDepth: 0 });
    const norm = (p) => p.replace(/\\/g, '/').replace(/^\/\/\?\//, '').toLowerCase();
    assert(r.some((p) => norm(p) === norm(video)), 'video not found in ' + JSON.stringify(r));
    return r;
  });

  await check('job cancel (thumbnail_strip count 400)', async () => {
    const j = job('thumbnail_strip', { path: videoNoAudio || video, height: 120, count: 400 });
    let settled = false;
    j.promise.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 300));
    const was = settled;
    const cancelled = await invoke('job_cancel', { job: j.id });
    assert(!was, 'job finished before the 300 ms cancel; cannot test');
    assert(cancelled === true, 'job_cancel returned ' + cancelled);
    return await expectCode('cancelled', j.promise);
  });
  if (videoNoAudio) await check('waveform_peaks on videoNoAudio -> no_audio', async () =>
    expectCode('no_audio', job('waveform_peaks', { path: videoNoAudio }).promise));

  await check('media_cache_info', async () => {
    const c = await invoke('media_cache_info');
    assert(c.bytes > 0 && c.entries > 0, 'cache empty');
    return c;
  });
  await check('close_guard true/false', async () => {
    await invoke('close_guard', { armed: true });
    await invoke('close_guard', { armed: false });
  });
  // CSP: the front end's vendored planner compiles WebAssembly ('wasm-unsafe-eval'); plain eval must stay blocked.
  if (cfg.kineticModule) await check('kinetic wasm loads under CSP', async () => {
    const m = await import(cfg.kineticModule);
    const v = await m.loadKinetic();
    assert(typeof v === 'string' && v.length > 0, `loadKinetic -> ${v}: ${m.kineticError?.()?.message}`);
    return { version: v };
  });
  await check('CSP still blocks eval', async () => {
    let blocked = false;
    try { new Function('return 1')(); } catch { blocked = true; }
    assert(blocked, 'new Function() ran: CSP allows unsafe-eval');
    return { blocked };
  });
  await check('open_path refuses x.exe', async () => {
    await invoke('write_text_atomic', { path: W('x.exe'), text: 'not a program' });
    return expectCode('refused', invoke('open_path', { path: W('x.exe') }));
  });
}

(async () => {
  let cfg;
  try {
    const paths = await invoke('launch_paths');
    const cfgPath = paths.find((p) => p.toLowerCase().endsWith('.json'));
    if (!cfgPath) throw new Error('no .json config in launch paths: ' + JSON.stringify(paths));
    cfg = JSON.parse((await invoke('read_text', { path: cfgPath })).text);
    await run(cfg);
    // The test driver launches a second instance with this path; the running one must receive it.
    if (cfg.secondInstanceProbe) await check('single instance forwards paths', () => new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('no open-paths event in 30 s')), 30000);
      window.__TAURI__.event.listen('pawscript://open-paths', (e) => { clearTimeout(timer); res(e.payload); });
    }));
    // The driver sends WM_CLOSE (CloseMainWindow) while the guard is armed: the window must stay and report it.
    if (cfg.closeGuardProbe) await check('close guard holds a real close', async () => {
      await invoke('close_guard', { armed: true });
      await window.__TAURI__.window.getCurrentWindow().setTitle('harness: waiting for close');
      const got = await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('no close-requested event in 30 s')), 30000);
        window.__TAURI__.event.listen('pawscript://close-requested', () => { clearTimeout(timer); res(true); });
      });
      await new Promise((r) => setTimeout(r, 500)); // still alive after the close was held
      return { closeRequested: got, stillRunning: true };
    });
  } catch (e) {
    results.push({ name: 'harness', ok: false, ms: 0, detail: e && e.code ? { code: e.code, message: e.message } : { message: String(e && e.stack || e) } });
    show(results.at(-1));
  }
  const failed = results.filter((r) => !r.ok).length;
  $('status').textContent = `done: ${results.length - failed}/${results.length} passed`;
  if (cfg?.report) {
    try { await invoke('write_text_atomic', { path: cfg.report, text: JSON.stringify(results, null, 2) }); } catch (e) { $('status').textContent += ' (report write failed)'; }
  }
  await invoke('window_close_now').catch(() => {});
})();
