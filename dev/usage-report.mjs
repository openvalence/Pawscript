// dev/usage-report.mjs -- friction report from the usage log (src/app/usage.svelte.js). Plain node, no deps.
//   node dev/usage-report.mjs [file.jsonl | folder | ring.json ...]
// No argument: every usage-*.jsonl in %LOCALAPPDATA%\app.pawscript (the app's data_dir). A folder: its usage-*.jsonl.
// A .json file: a localStorage 'usage.log' ring export ([{t, kind, detail}], from the devtools or Help › Usage report).
//
// Event kinds (k): a command id (no colon: src key|palette|menu|button|code, focus, mode) · edit:commit {label, paths}
// (a new undo step) · edit:undo / edit:redo {label} · fx:add / fx:remove {id, kind, mode, ms} · fx:edit {.., what, n}
// · scenes:tag {scene, tag, cat, on} · tracking:runStart {tracker, t0, t1, params (diff from defaults)} ·
// tracking:runEnd {tracker, run, ms, picked, candidates | cancelled | error} · tracking:accept / tracking:discard {run}
// · tracking:setChannel {run, from, to, sidecar} (primary override) · tracking:planOpen {track, skip, done, skipped}
// · tracking:retrack · settings:set {key, from, to, n} · ui:toast {level, text} · ui:panel {dock, id} · ui:dock · ui:area {op: dock|move|swap|split|join|close|max|unmax} ·
// ui:mode · ui:dialogOpen / ui:dialog {name, ms} · play:play / play:pause {at} · play:seek {from, to, n, ms} ·
// play:loop · view:zoom {from, to, n} · project:open / project:save {file} · app:start / app:close / app:error ·
// app:heartbeat {active, playing, mode} (every 60 s) · older feature notes (timeline:..., tracking:track, ...).
// paw-r73w: ui:ctl {c: control, s: surface panel | panel.adjust | panel.fusion | row | chips | pop.scene|shot|tracker} ·
// ui:window {w, h, dpr} · chips:firstAction {chip, ms, c (null = closed with none)} · tracking:sourcePick {via: row |
// override | panel | video | code, range, to} · tracking:carrier {baseline, knots, was | envelope} · tracking:padPin {on}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** JSONL text -> records (bad lines skipped). */
export function parse(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r?.k) out.push(r); } catch { /* a torn line */ } }
  return out;
}
/** A ring export [{t, kind, detail}] -> records (session 'ring'). */
export function fromRing(list) {
  return (Array.isArray(list) ? list : []).filter((e) => e?.kind).map((e) => {
    let d = {};
    if (e.detail != null) { try { const v = JSON.parse(e.detail); d = v && typeof v === 'object' && !Array.isArray(v) ? v : { d: e.detail }; } catch { d = { d: e.detail }; } }
    return { t: new Date(e.t).toISOString(), s: 'ring', k: e.kind, ...d };
  });
}

const isCmd = (k) => !k.includes(':');
const isUndoCmd = (k) => /(^|\.)(undo|redo)$/i.test(k);
const ms = (r) => Date.parse(r.t);
const top = (m, n = 15) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const inc = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-');
const sec = (x) => (x / 1000).toFixed(1) + ' s';
const table = (rows, head) => {
  const all = [head, ...rows].map((r) => r.map((c) => String(c ?? '')));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => '  ' + r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ')).join('\n');
};
const norm = (s) => String(s || '').replace(/\d+(\.\d+)?/g, '#').slice(0, 100);

/** records -> the report text. */
export function report(records) {
  const recs = [...records].filter((r) => r?.k && r.t).sort((a, b) => ms(a) - ms(b));
  const bySession = new Map();
  for (const r of recs) { if (!bySession.has(r.s)) bySession.set(r.s, []); bySession.get(r.s).push(r); }
  const out = [];
  const section = (title, body) => out.push(`\n== ${title}\n${body || '  (none)'}`);

  // sessions: active minutes from heartbeats (else minutes holding an event)
  const sess = [...bySession].map(([s, l]) => {
    const beats = l.filter((r) => r.k === 'app:heartbeat');
    const active = beats.length ? beats.filter((r) => r.active).length : new Set(l.map((r) => Math.floor(ms(r) / 60000))).size;
    return [s, l[0].t.slice(0, 16).replace('T', ' '), Math.round((ms(l.at(-1)) - ms(l[0])) / 60000), active, beats.length ? beats.length - active : '-', l.length];
  });
  section(`Sessions (${recs.length} events)`, table(sess, ['session', 'start', 'min', 'active min', 'idle min', 'events']));

  // commands by count, with how they were started
  const cmds = recs.filter((r) => isCmd(r.k)), cmdN = new Map(), src = new Map();
  for (const r of cmds) { inc(cmdN, r.k); if (!src.has(r.k)) src.set(r.k, new Map()); inc(src.get(r.k), r.src || '?'); }
  section('Commands by count', table(top(cmdN, 30).map(([k, n]) => [k, n, [...src.get(k)].map(([s, c]) => `${s} ${c}`).join(', ')]), ['command', 'n', 'via']));

  // undo: what got undone (history labels) and which command was followed by an undo within 10 s
  const undone = new Map(), undoAfter = new Map();
  let undos = 0, emptyUndos = 0;
  for (const l of bySession.values()) {
    let lastCmd = null;
    for (const r of l) {
      if (isCmd(r.k) && !isUndoCmd(r.k)) lastCmd = r;
      if (r.k !== 'edit:undo') continue;
      undos++;
      if (r.label == null) { emptyUndos++; continue; }
      inc(undone, r.label);
      if (lastCmd && ms(r) - ms(lastCmd) <= 10000) { inc(undoAfter, lastCmd.k); lastCmd = null; }
    }
  }
  section(`Undo (${undos} undos, ${emptyUndos} with nothing to undo)`,
    (undone.size ? '  undone (history label):\n' + table(top(undone).map(([k, n]) => [k, n]), ['label', 'n']) + '\n' : '') +
    (undoAfter.size ? '  command -> undo within 10 s (ranked by rate):\n' + table([...undoAfter].map(([k, n]) => [k, n, cmdN.get(k) || 0, pct(n, cmdN.get(k))]).sort((a, b) => parseInt(b[3]) - parseInt(a[3]) || b[1] - a[1]).slice(0, 15), ['command', 'undone', 'runs', 'rate']) : ''));

  // tracker runs
  const tr = new Map(), T = (id) => { if (!tr.has(id)) tr.set(id, { start: 0, ok: 0, cancel: 0, err: 0, accept: 0, discard: 0, rerun: 0, override: 0, wait: [], ms: [] }); return tr.get(id); };
  for (const l of bySession.values()) {
    const ranges = [], ended = new Map(), runTracker = new Map();
    for (const r of l) {
      if (r.k === 'tracking:runStart') {
        const x = T(r.tracker); x.start++;
        const len = r.t1 - r.t0;
        if (ranges.some((q) => Math.min(q.t1, r.t1) - Math.max(q.t0, r.t0) >= 0.5 * Math.min(len, q.t1 - q.t0))) x.rerun++;
        ranges.push({ t0: r.t0, t1: r.t1 });
      } else if (r.k === 'tracking:runEnd') {
        const x = T(r.tracker);
        if (r.cancelled) x.cancel++; else if (r.error) x.err++; else { x.ok++; x.ms.push(r.ms); ended.set(r.run, ms(r)); runTracker.set(r.run, r.tracker); }
      } else if (r.k === 'tracking:accept' || r.k === 'tracking:discard') {
        const x = T(runTracker.get(r.run) || r.tracker || '?');
        if (r.k === 'tracking:accept') { x.accept++; if (ended.has(r.run)) x.wait.push(ms(r) - ended.get(r.run)); } else x.discard++;
      } else if (r.k === 'tracking:setChannel') T(runTracker.get(r.run) || r.tracker || '?').override++;
    }
  }
  const mean = (a) => (a.length ? sec(a.reduce((s, x) => s + x, 0) / a.length) : '-');
  section('Tracker runs', table([...tr].map(([id, x]) => [id, x.start, x.ok, x.cancel, x.err, x.rerun, x.accept, x.discard, x.override, mean(x.ms), mean(x.wait)]),
    ['tracker', 'started', 'done', 'cancel', 'error', 're-run', 'accept', 'discard', 'override', 'mean run', 'finish->accept']));
  const plans = recs.filter((r) => r.k === 'tracking:planOpen'), skips = new Map();
  for (const p of plans) for (const s of String(p.skipped || '').split(' | ').filter(Boolean)) inc(skips, norm(s));
  if (plans.length) section(`Track plan opened ${plans.length}x: what it skipped`, table(top(skips, 10), ['item', 'n']));

  // effects: created vs deleted within 60 s
  const fx = new Map(), F = (k) => { if (!fx.has(k)) fx.set(k, { add: 0, quick: 0, remove: 0, edit: 0 }); return fx.get(k); }, added = new Map();
  for (const r of recs) {
    if (r.k === 'fx:add') { F(r.kind).add++; added.set(r.id, ms(r)); }
    else if (r.k === 'fx:remove') { const x = F(r.kind); x.remove++; if (added.has(r.id) && ms(r) - added.get(r.id) <= 60000) x.quick++; }
    else if (r.k === 'fx:edit') F(r.kind).edit += r.n || 1;
  }
  section('Effects', table([...fx].map(([k, x]) => [k, x.add, x.remove, x.quick, pct(x.quick, x.add), x.edit]), ['kind', 'added', 'removed', 'removed <60s', 'rate', 'edits']));

  const tags = new Map();
  for (const r of recs.filter((r) => r.k === 'scenes:tag')) inc(tags, `${r.on ? '+' : '-'} ${r.cat || '?'}/${r.tag}`);
  section('Scene tags', table(top(tags), ['tag', 'n']));

  const toasts = new Map();
  for (const r of recs) if (r.k === 'ui:toast' || r.k === 'app:error') inc(toasts, `${r.k === 'app:error' ? 'ERROR' : r.level}: ${norm(r.text)}`);
  section('Top toasts / errors (digits as #)', table(top(toasts, 20), ['toast', 'n']));

  // panels by dwell: a dock shows a panel until the next switch on that dock, a mode switch, or the session end
  const dwell = new Map(), dlg = new Map();
  for (const l of bySession.values()) {
    const cur = new Map(), end = ms(l.at(-1));
    const close = (dock, t) => { const c = cur.get(dock); if (c) { inc(dwell, `${c.mode || '?'} ${dock}/${c.id}`, t - c.t); cur.delete(dock); } };
    for (const r of l) {
      if (r.k === 'ui:panel') { close(r.dock, ms(r)); cur.set(r.dock, { id: r.id, mode: r.mode, t: ms(r) }); }
      else if (r.k === 'ui:mode') for (const d of [...cur.keys()]) close(d, ms(r));
      else if (r.k === 'ui:dialog') { const x = dlg.get(r.name) || { n: 0, ms: 0 }; x.n++; x.ms += r.ms || 0; dlg.set(r.name, x); }
    }
    for (const d of [...cur.keys()]) close(d, end);
  }
  section('Panels by dwell (after a tab switch)', table(top(dwell).map(([k, v]) => [k, Math.round(v / 60000) + ' min']), ['mode dock/panel', 'dwell']));
  section('Dialogs', table([...dlg].sort((a, b) => b[1].n - a[1].n).map(([k, x]) => [k, x.n, sec(x.ms / x.n)]), ['dialog', 'n', 'mean open']));

  const set = new Map();
  for (const r of recs.filter((r) => r.k === 'settings:set')) inc(set, r.key);
  section('Settings changed', table(top(set), ['key', 'n']));

  const play = ['play:play', 'play:seek', 'play:loop', 'view:zoom'].map((k) => { const l = recs.filter((r) => r.k === k); return [k, l.length, l.reduce((s, r) => s + (r.n || 1), 0)]; });
  section('Playback / view', table(play, ['kind', 'events', 'raw calls']));

  // sequences: consecutive commands (same session, under 60 s apart)
  const bi = new Map();
  for (const l of bySession.values()) {
    let prev = null;
    for (const r of l) if (isCmd(r.k)) { if (prev && ms(r) - ms(prev) < 60000) inc(bi, `${prev.k} -> ${r.k}`); prev = r; }
  }
  section('Top command sequences', table(top(bi), ['a -> b', 'n']));

  const other = new Map();
  for (const r of recs) if (!isCmd(r.k)) inc(other, r.k);
  section('All note kinds', table(top(other, 60), ['kind', 'n']));
  return out.join('\n').trimStart() + '\n';
}

/** Paths (files / folders) -> records. */
export function load(paths) {
  const files = paths.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => /^usage-.*\.jsonl$/.test(f)).sort().map((f) => path.join(p, f)) : [p]));
  return files.flatMap((f) => (f.endsWith('.json') ? fromRing(JSON.parse(fs.readFileSync(f, 'utf8'))) : parse(fs.readFileSync(f, 'utf8'))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args = process.argv.slice(2);
  if (!args.length) {
    const dir = path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '', '.local', 'share'), 'app.pawscript');
    if (!fs.existsSync(dir)) { console.error('no log folder at ' + dir + '; pass files or folders'); process.exit(1); }
    args = [dir];
  }
  process.stdout.write(report(load(args)));
}
