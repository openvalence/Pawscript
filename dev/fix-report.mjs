// dev/fix-report.mjs -- the fix log as a document an agent reads (paw-dze): where the owner had to do X to fix Y.
// Plain node, no deps.
//   node dev/fix-report.mjs [data dir | file ...] [--since YYYY-MM-DD] [--project <id or video name part>] [--json]
// No path: %LOCALAPPDATA%\app.pawscript (the app's data_dir). Reads usage-*.jsonl (raw events and the live fix log's
// facts), fixes.jsonl (episodes the app closed) and feedback.jsonl (notes). Sessions from before the fix log existed
// are replayed from their raw events (labels of undo steps, tracker notes; scene numbers unknown there, positions from
// the playhead). Kinds and fields: docs/fix-log.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Detector, Grouper, projectId, mmss, clip } from '../src/app/fixlog.js';
import { parseNotes } from '../src/features/feedback/feedback.js';

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
const lines = (text) => String(text).split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const FACT = /^(fix|auto|ok):/;

/** Paths -> {usage: records, episodes, notes}. */
export function load(paths) {
  const out = { usage: [], episodes: [], notes: [] };
  const files = paths.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => /^(usage-.*|fixes|feedback)\.jsonl$/.test(f)).sort().map((f) => path.join(p, f)) : [p]));
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8'), b = path.basename(f);
    if (b.startsWith('fixes')) out.episodes.push(...lines(text).filter((r) => r.kind === 'episode'));
    else if (b.startsWith('feedback')) out.notes.push(...parseNotes(text));
    else out.usage.push(...lines(text).filter((r) => r.k && r.t));
  }
  return out;
}

/** Usage records of sessions without fixes.jsonl episodes -> episodes (live facts regrouped, older sessions replayed). */
export function episodesFrom(usage, have = new Set()) {
  const bySession = new Map();
  for (const r of [...usage].sort((a, b) => ms(a.t) - ms(b.t))) { if (have.has(r.s)) continue; if (!bySession.has(r.s)) bySession.set(r.s, []); bySession.get(r.s).push(r); }
  const out = [];
  for (const [s, recs] of bySession) {
    const g = new Grouper({ onClose: (e) => out.push({ ...e, replayed: !recs.some((r) => FACT.test(r.k)) || undefined }) });
    if (recs.some((r) => FACT.test(r.k))) {
      for (const r of recs) {
        if (!FACT.test(r.k)) continue;
        const { t, k, ...rest } = r, f = { ...rest, t: ms(t), s, kind: k };
        if (k === 'fix:strokes.pointsSummary') Object.assign(f, { kind: 'fix:strokes.points', key: 'accept' + r.accept, points: rest, t0: r.t0, t1: r.t1, n: undefined });
        g.add(f);
      }
    } else {
      const det = new Detector();
      let project = '', video = '', at = null;
      for (const r of recs) {
        const t = ms(r.t);
        if (r.k === 'project:open') { g.closeAll(); video = r.file || ''; project = video ? projectId({ name: video }) : ''; at = null; continue; }
        if (r.k === 'play:seek' && Number.isFinite(r.to)) at = r.to;
        if ((r.k === 'play:pause' || r.k === 'play:play') && Number.isFinite(r.at)) at = r.at;
        for (const f of det.see({ ...r, t })) {
          if (f.kind === 'auto:describe') continue;   // a scene index: no scene list to place it in
          f.project = project; if (video) f.video = video;
          if (f.t0 == null && f.scope !== 'video' && at != null) f.at = Math.round(at);
          g.add(f);
        }
      }
    }
    g.closeAll();
  }
  return out;
}

// the automatic step a fix area corrects (for fixes made in an episode that has no automatic output of its own)
const HOME = { 'structure.cut': 'shots.detect', 'structure.merge': 'shots.detect', 'structure.split': 'shots.detect', 'structure.take': 'shots.detect',
  'structure.tag': 'describe', 'structure.offscreen': 'describe', 'finish.*': 'finish.autorange', 'spurts.hand': 'spurts.detect', 'spurts.drop': 'spurts.place',
  'spurts.move': 'spurts.place', 'seed.dropFill': 'seed.repeat', 'seed.*': 'seed.suggest', 'signal.*': 'track.run', 'track.*': 'track.run', 'strokes.points': 'strokes.accept', 'strokes.acceptUndone': 'strokes.accept',
  'strokes.detail': 'strokes.accept', 'strokes.simplify': 'strokes.accept', 'fx.knotting': 'fx.knotting' };
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const step = (k) => k.slice(k.indexOf(':') + 1);
const where = (e) => `${e.video ? clip(e.video, 40) : e.project || '?'}${e.scene != null ? ' S' + e.scene : e.t0 != null ? ' @' + mmss((e.t0 + e.t1) / 2) : ''}`;

/** {usage, episodes, notes} -> the report model (what --json prints). opts: {since, project}. */
export function analyse({ usage = [], episodes = [], notes = [] }, { since = '', project = '' } = {}) {
  const have = new Set(episodes.map((e) => e.s));
  let eps = [...episodes, ...episodesFrom(usage, have)];
  const keep = (r) => (!since || String(r.t) >= since) && (!project || r.project === project || String(r.video || '').toLowerCase().includes(project.toLowerCase()));
  eps = eps.filter(keep).sort((a, b) => ms(a.t) - ms(b.t));
  notes = notes.filter(keep);
  // a fix in an episode without an automatic output corrects the latest earlier output of its home step in that session
  // and video (a cut moved long after Detect scenes); that output then counts as changed
  const outs = new Map(), touched = new Set(), sk = (e) => `${e.s}|${e.project}`;
  for (const e of eps) for (const a of e.auto || []) { if (!outs.has(sk(e))) outs.set(sk(e), []); outs.get(sk(e)).push({ step: a.step, t: ms(a.t), e }); }
  // in the episode: the latest output before the fix of its home step, else the latest before it, else the first
  const anchorOf = (e, x) => {
    const home = HOME[step(x.kind)] || HOME[step(x.kind).split('.')[0] + '.*'], tx = ms(x.t || e.t);
    if (e.auto?.length) { const before = e.auto.filter((a) => ms(a.t) <= tx); return (before.filter((a) => a.step === home).at(-1) || before.at(-1) || e.auto[0]).step; }
    const near = (o) => o.e.t0 == null || e.t0 == null || (o.e.t1 > e.t0 && o.e.t0 < e.t1);   // the same video span (or a whole-video output)
    const o = home && (outs.get(sk(e)) || []).filter((a) => a.step === home && a.t <= tx && near(a)).at(-1);
    if (o) { touched.add(o.e); return home; }
    return '(no automatic step)';
  };
  // (1) problems: automatic step -> what the owner did; an episode's cost shared by its fixes by their action counts
  const rows = new Map();
  for (const e of eps) {
    for (const x of e.fixes || []) {
      const anchor = anchorOf(e, x), k = `${anchor} -> ${step(x.kind)}`;
      if (!rows.has(k)) rows.set(k, { auto: anchor, fix: step(x.kind), episodes: 0, actions: 0, costs: [], where: new Set() });
      const r = rows.get(k), share = e.cost?.n ? (e.cost.s * (x.n || 1)) / e.cost.n : 0;
      r.episodes++; r.actions += x.n || 1; r.costs.push(share); r.where.add(where(e));
    }
  }
  const problems = [...rows.values()].map((r) => ({ auto: r.auto, fix: r.fix, episodes: r.episodes, actions: r.actions, totalS: Math.round(r.costs.reduce((s, x) => s + x, 0)), medianS: Math.round(median(r.costs)), where: [...r.where] }));
  // (4) retry chains (one fix kind repeated on one target with different values) and quick undos
  const retries = [], undos = new Map();
  for (const e of eps) for (const x of e.fixes || []) {
    if (x.kind === 'fix:generic.undo') { undos.set(x.key || x.manual?.label, (undos.get(x.key || x.manual?.label) || 0) + (x.n || 1)); continue; }
    const tos = (x.chain || []).filter((m) => m && 'to' in m).map((m) => JSON.stringify(m.to));
    if ((x.n || 1) >= 2 && (new Set(tos).size >= 2 || x.kind === 'fix:track.retrack')) retries.push({ where: where(e), t: e.t, kind: x.kind, n: x.n, chain: x.chain });
  }
  // (5) automatic outputs left as they were: episodes with the step and no fix
  const succ = new Map(), oks = new Map();
  for (const e of eps) {
    for (const st of new Set((e.auto || []).map((a) => a.step))) { const s = succ.get(st) || { step: st, episodes: 0, untouched: 0 }; s.episodes++; if (!(e.fixes || []).length && !touched.has(e)) s.untouched++; succ.set(st, s); }
    for (const o of e.ok || []) oks.set(o.step, (oks.get(o.step) || 0) + (o.n || 1));
  }
  return { episodes: eps, notes, problems, retries, undos: [...undos].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    success: [...succ.values()].map((s) => ({ ...s, rate: s.episodes ? Math.round((100 * s.untouched) / s.episodes) : 0 })).sort((a, b) => b.episodes - a.episodes), confirmed: Object.fromEntries(oks) };
}

const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '(none)');
const hhmm = (t) => String(t).slice(0, 16).replace('T', ' ');
const noteLine = (n) => `> note${n.tone && n.tone !== 'note' ? ` [${n.tone}]` : ''} ${hhmm(n.t)} at ${mmss(n.at)}${n.scene != null ? ` S${n.scene} shot ${n.shot}` : ''}` +
  `${n.run ? ` · run ${n.run.id} ${n.run.tracker} ${n.run.source}${n.run.pair ? ` (${n.run.pair.a} vs ${n.run.pair.b})` : ''}${n.run.direction && n.run.direction !== 'both' ? ' ' + n.run.direction : ''}` : ''}` +
  ` · ${n.mode}${n.tool ? '/' + n.tool : ''}${n.focus ? ' · ' + n.focus : ''}${n.sel?.points ? ` · ${n.sel.points} points selected` : ''}${n.sel?.shots?.length ? ` · shots ${n.sel.shots.join(',')}` : ''}: ${n.text}` +
  `${n.recent?.length ? `\n>   before: ${n.recent.slice(-6).map((r) => r.k).join(', ')}` : ''}`;

/** The model -> markdown. */
export function markdown(m) {
  const out = [`# Fix log: ${m.episodes.length} episodes, ${m.notes.length} notes`];
  const wh = (p) => p.where.slice(0, 4).join(', ') + (p.where.length > 4 ? ` +${p.where.length - 4}` : '');
  const prow = (p) => [`${p.auto} -> ${p.fix}`, p.episodes, p.actions, p.totalS, p.medianS, wh(p)];
  const head = ['automatic step -> what the owner did', 'episodes', 'actions', 'total s', 'median s', 'where'];
  out.push('\n## 1. Top problems by manual cost', table(head, [...m.problems].sort((a, b) => b.totalS - a.totalS || b.episodes - a.episodes).slice(0, 15).map(prow)));
  out.push('\n## 1b. Top problems by frequency', table(head, [...m.problems].sort((a, b) => b.episodes - a.episodes || b.totalS - a.totalS).slice(0, 15).map(prow)));
  out.push('\n## 2. Per video and scene (episodes and notes, in the order they happened)');
  const projects = new Map();
  for (const e of m.episodes) { const k = e.video || e.project || '(no video)'; if (!projects.has(k)) projects.set(k, []); projects.get(k).push({ t: e.t, scene: e.whole ? -1 : e.scene ?? null, line: `- ${hhmm(e.t)} ${e.replayed ? '(replayed) ' : ''}${e.text}` }); }
  for (const n of m.notes) { const k = n.video || n.project || '(no video)'; if (!projects.has(k)) projects.set(k, []); projects.get(k).push({ t: n.t, scene: n.scene ?? null, line: noteLine(n) }); }
  for (const [p, items] of projects) {
    out.push(`\n### ${p}`);
    const scenes = new Map();
    for (const it of items.sort((a, b) => ms(a.t) - ms(b.t))) { const k = it.scene; if (!scenes.has(k)) scenes.set(k, []); scenes.get(k).push(it.line); }
    for (const [s, ls] of [...scenes].sort((a, b) => (a[0] ?? 1e9) - (b[0] ?? 1e9))) out.push(s === -1 ? '**whole video**' : s == null ? '**scene unknown**' : `**S${s}**`, ...ls);
  }
  out.push('\n## 3. Feedback notes', m.notes.length ? m.notes.map(noteLine).join('\n') : '(none)');
  const val = (c) => (c && 'to' in c ? clip(c.to, 40) : c && Object.keys(c).length ? Object.entries(c).map(([k, v]) => `${k} ${clip(v, 50)}`).join(', ') : 'same');
  out.push('\n## 4. Retry chains (one target, one kind, different values)', m.retries.length ? m.retries.map((r) => `- ${hhmm(r.t)} ${r.where}: ${step(r.kind)} ${r.n}x: ${r.chain.map(val).join(' -> ')}`).join('\n') : '(none)');
  out.push('\nUndone within 10 s:', m.undos.length ? m.undos.slice(0, 15).map((u) => `- ${u.n}x ${u.label}`).join('\n') : '(none)');
  out.push('\n## 5. Automatic outputs left as they were', table(['step', 'episodes', 'untouched', 'rate'], m.success.map((s) => [s.step, s.episodes, s.untouched, s.rate + '%'])));
  if (Object.keys(m.confirmed).length) out.push('Confirmed as is: ' + Object.entries(m.confirmed).map(([k, n]) => `${k} ${n}x`).join(', '));
  return out.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); if (i < 0) return ''; const v = args[i + 1]; args.splice(i, 2); return v || ''; };
  const json = args.includes('--json'); if (json) args.splice(args.indexOf('--json'), 1);
  const since = opt('since'), project = opt('project');
  let paths = args;
  if (!paths.length) {
    const dir = path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '', '.local', 'share'), 'app.pawscript');
    if (!fs.existsSync(dir)) { console.error('no data folder at ' + dir + '; pass a folder or files'); process.exit(1); }
    paths = [dir];
  }
  const m = analyse(load(paths), { since, project });
  process.stdout.write(json ? JSON.stringify({ ...m, episodes: m.episodes.map(({ items: _i, ...e }) => e) }, null, 1) + '\n' : markdown(m));   // eslint-disable-line no-unused-vars
}
