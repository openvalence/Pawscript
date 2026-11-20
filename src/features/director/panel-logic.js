// panel-logic.js -- the pure half of the Director panel: one-line value summaries, trace grouping, the footer counts,
// the ask-card choices (each a ready, valid value) and the exported markdown. No DOM (test/director-panel.test.mjs).
import { KINDS as GEN_KINDS } from '../../lib/gen/recipes.js';

export const ORDER = ['camera', 'climax', 'story', 'roi', 'track', 'direction', 'depth', 'verify'];
export const BADGE = { rules: 'R', vlm: 'V', 'rules+vlm': 'RV', agent: 'A', user: 'U', replay: '↺', default: '–' };
export const badgeOf = (brain) => BADGE[brain] ?? (String(brain || '').startsWith('vlm') ? 'V' : String(brain || '?')[0].toUpperCase());
const s1 = (ms) => (ms / 1000).toFixed(1);
const span = (a, b) => `${s1(a)}–${s1(b)} s`;
export const scopeLabel = (sc) => (!sc || sc.scene == null ? 'Video' : `Scene ${sc.scene + 1}`);

/** "track · keep run21 dist01" */
export function summary(kind, v) {
  if (!v) return `${kind} · –`;
  switch (kind) {
    case 'camera': return `camera · ${v.mode}${v.p95Px != null ? ` ${(+v.p95Px).toFixed(1)} px` : ''}${v.mode === 'rides' && v.phaseMs != null ? ` · ${v.phaseMs} ms phase` : ''}`;
    case 'climax': return v.window ? `orgasm · ${span(v.window.t0, v.window.t1)}${v.afterglowTo ? ` · afterglow to ${s1(v.afterglowTo)} s` : ''}` : 'orgasm · none';
    case 'story': return `story · ${(v.segments || []).map((s) => s.kind + (s.visible === false ? ' (off)' : '')).join(', ')}`;
    case 'roi': return v.none && !v.probes?.length ? `roi · none (${v.none})` : `roi · ${(v.probes || []).map((p) => p.tracker + (p.role === 'reference' ? ' (ref)' : '')).join(', ')}`;
    case 'track': return v.keep ? `track · keep ${v.keep}${v.channel ? ' ' + v.channel : ''}${v.agree?.length ? ` · agrees ${v.agree.join(', ')}` : ''}` : `track · none${v.fallback ? ' → ' + v.fallback.recipe : ''}`;
    case 'direction': return `direction · ${v.sign > 0 ? '+1 as tracked' : v.sign < 0 ? '−1 mirrored' : "can't tell"}${v.pairs?.length ? ` · ${v.pairs.length} pair${v.pairs.length > 1 ? 's' : ''}` : ''}`;
    case 'depth': return `depth · ${v.lo}–${v.hi} · ${(+v.intensity).toFixed(2)}`;
    case 'verify': return v.verdict === 'ok' ? `verify · ok${v.checks?.length ? ` ${v.checks.filter((c) => c.ok).length}/${v.checks.length}` : ''}` : `verify · redo ${v.redo}`;
    default: return kind;
  }
}

/** Records -> [{key, label, rows}] by scene (the video first), rows in decision order then time. */
export function groups(records) {
  const by = new Map();
  for (const r of records) {
    const k = r.scope?.scene ?? -1;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([k, rows]) => ({
    key: k, label: k < 0 ? 'Video' : `Scene ${k + 1}`,
    rows: rows.sort((a, b) => (a.scope?.t0 ?? 0) - (b.scope?.t0 ?? 0) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)),
  }));
}

/** "24 decisions · 17 R · 3 V · 2 A · 2 U · 1 redo · 2 provisional" */
export function footer(records) {
  if (!records.length) return 'No decisions yet';
  const n = new Map();
  for (const r of records) { const b = badgeOf(r.brain); n.set(b, (n.get(b) || 0) + 1); }
  const redo = records.filter((r) => r.attempt > 0).length, prov = records.filter((r) => r.provisional).length;
  return [`${records.length} decision${records.length === 1 ? '' : 's'}`, ...['R', 'RV', 'V', 'A', 'U', '↺', '–'].filter((b) => n.get(b)).map((b) => `${n.get(b)} ${b}`),
    ...(redo ? [`${redo} redo${redo > 1 ? 's' : ''}`] : []), ...(prov ? [`${prov} provisional`] : [])].join(' · ');
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const CAMERA_VALID = { static: ['single', 'relative', 'rate'], rides: ['relative', 'rate'], move: ['rate'], sway: ['rate'] };
const STORY_KINDS = ['penetration', 'oral', 'knotting', 'foreplay', 'offscreen', 'climax', 'orgasm', 'afterglow', 'idle', 'outro', 'fade-in'];

/** The answers a user card offers for a request: [{id, label, key, value}] (value valid for the request), plus the
 *  blind pair for direction / verify ({pair: [{label, t}], ...}). prov = the provisional value. */
export function cardChoices(req, prov) {
  const sc = req.scope || {};
  switch (req.kind) {
    case 'camera': return { choices: ['static', 'rides', 'move', 'sway'].map((m, k) => ({ id: m, key: String(k + 1), label: { static: 'Static', rides: 'Rides the strokes', move: 'Moves (pan / zoom)', sway: 'Sways' }[m],
      value: { mode: m, p95Px: prov?.p95Px ?? 0, rateHz: prov?.rateHz ?? null, phaseMs: prov?.phaseMs ?? null, moveSpans: m === 'move' ? (prov?.moveSpans || []) : [], valid: CAMERA_VALID[m] } })) };
    case 'climax': return { choices: [
      ...(prov?.window ? [{ id: 'keep', key: '1', label: `Yes, ${span(prov.window.t0, prov.window.t1)}`, value: prov }] : []),
      { id: 'none', key: prov?.window ? '2' : '1', label: 'No orgasm', value: { window: null, afterglowTo: null } }] };
    case 'story': return { choices: STORY_KINDS.map((k, i) => ({ id: k, key: i < 9 ? String(i + 1) : i === 9 ? '0' : null, label: GEN_KINDS[k]?.label || k,
      value: { segments: [{ t0: sc.t0, t1: sc.t1, kind: k, visible: k !== 'offscreen', action: ['idle', 'outro', 'fade-in'].includes(k) ? 'stops' : 'continues', intensity: 1, name: k }] } })) };
    case 'roi': return { choices: [
      ...(prov?.probes?.length ? [{ id: 'keep', key: '1', label: `Track ${prov.probes.map((p) => p.tracker).join(', ')}`, value: prov }] : []),
      { id: 'none', key: prov?.probes?.length ? '2' : '1', label: 'Nothing to track (off-screen)', value: { probes: [], none: 'offscreen' } }] };
    case 'track': {
      const ids = req.facts?.runs?.length ? req.facts.runs.filter((r) => r.role !== 'reference').map((r) => r.id) : [...new Set([prov?.keep, ...(prov?.agree || []), ...Object.keys(prov?.reject || {})].filter(Boolean))];
      const kind = req.facts?.segment?.kind;
      return { choices: [...ids.map((id, k) => ({ id, key: String(k + 1), label: `Keep ${id}`, value: { keep: id, agree: [], reject: {} } })),
        { id: 'none', key: '0', label: 'None: use the recipe', value: { keep: null, agree: [], reject: {}, fallback: { recipe: kind === 'offscreen' ? 'penetration-strokes' : GEN_KINDS[kind]?.recipe || 'strokes', params: {} } } }] };
    }
    case 'direction': {
      const p = req.facts?.pickPairs?.[0];
      if (!p) return { choices: [{ id: 'plus', key: '1', label: 'As tracked', value: { sign: 1, pairs: [] } }, { id: 'minus', key: '2', label: 'Mirrored', value: { sign: -1, pairs: [] } }] };
      // blind: A/B in an order fixed per decision, no positions shown; the app knows which is the run's low end
      const swap = hash(req.id) % 2 === 1, A = swap ? p.b : p.a, B = swap ? p.a : p.b;
      const val = (deep, shallow) => ({ sign: deep.pos < shallow.pos ? 1 : -1, pairs: [{ deep: deep.at, shallow: shallow.at }] });
      return { pair: [{ label: 'A', t: A.at }, { label: 'B', t: B.at }], choices: [{ id: 'A', key: 'ArrowLeft', label: 'A is deeper', value: val(A, B) }, { id: 'B', key: 'ArrowRight', label: 'B is deeper', value: val(B, A) }] };
    }
    case 'verify': {
      const checks = prov?.checks || req.facts?.checks || [], f = req.frames || [];
      return { pair: f.length >= 2 ? [{ label: 'A', t: f[0].t }, { label: 'B', t: f[1].t }] : null, choices: [
        { id: 'ok', key: '1', label: 'Looks right', value: { verdict: 'ok', checks, note: 'checked by you' } },
        { id: 'direction', key: '2', label: 'Wrong direction', value: { verdict: 'redo', redo: 'direction', checks, note: 'you: wrong direction' } },
        { id: 'track', key: '3', label: 'Follows the wrong thing', value: { verdict: 'redo', redo: 'track', checks, note: 'you: wrong run' } }] };
    }
    default: return { choices: [] };
  }
}

/** DIRECTOR-TRACE-N.md: the decisions as tables, the way trace 2 was written. */
export function traceMarkdown(media, records, sum = summary) {
  const out = [`# Director trace (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`, '', `Video \`${media?.path || '?'}\`${media?.durationMs ? ` (${s1(media.durationMs)} s)` : ''}. ${footer(records)}.`, ''];
  for (const kind of ORDER) {
    const rows = records.filter((r) => r.kind === kind).sort((a, b) => (a.scope?.t0 ?? 0) - (b.scope?.t0 ?? 0));
    if (!rows.length) continue;
    out.push(`## ${kind}`, '', '| scope | decision | conf | brain | status | why |', '|---|---|---|---|---|---|');
    for (const r of rows) out.push(`| ${r.id.slice(kind.length + 1)} ${r.scope ? span(r.scope.t0, r.scope.t1) : ''} | ${sum(kind, r.value).replace(/^[a-z]+ · /, '')} | ${(+r.conf || 0).toFixed(2)}${r.calibrated ? '' : ' uncal.'} | ${r.brain} | ${r.status}${r.attempt ? ` (redo ${r.attempt})` : ''} | ${String(r.rationale || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
    out.push('');
  }
  return out.join('\n');
}
