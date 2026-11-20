// trace.js -- decisions -> trace records (the project block's `records`, the replay cache) and the trace-2 JSON shape
// both ways (README §6). Pure; records never hold images.
import { KINDS, scopeId, clock } from './decisions.js';
import { stable } from './digest.js';

export const STAGE_OF = { camera: 'survey.base_and_camera', climax: 'story.climax', story: 'story.plan', roi: 'tracking.runs',
  track: 'tracking.compare', direction: 'direction', depth: 'depth', verify: 'verify' };
const PROVISIONAL = new Set(['provisional', 'queued', 'fallback', 'abstain']);

/** One-line summary of a request's facts (for the record and the panel). */
export function factsLine(req) {
  const f = req.facts ?? {}, sc = f.scene, cam = f.camera ?? sc?.camera, bits = [];
  if (req.scope) bits.push(`${clock(req.scope.t0)}–${clock(req.scope.t1)}`);
  if (sc?.describe) bits.push('tags ' + (sc.describe.acts?.slice(0, 3).join(',') || 'none'));
  if (sc && !sc.describe) bits.push('no describe');
  if (sc?.loop?.periodMs) bits.push(`loop ${sc.loop.periodMs} ms prom ${sc.loop.prominence}`);
  if (cam) bits.push(`cam ${cam.mode} ${cam.p95Px} px`);
  if (f.climax?.window) bits.push(`climax ${clock(f.climax.window.t0)}–${clock(f.climax.window.t1)}`);
  if (f.segment) bits.push(`seg ${f.segment.kind}`);
  if (f.keep) bits.push(`keep ${f.keep}`);
  if (f.runs?.length) bits.push('runs ' + f.runs.map((r) => `${r.id} ${r.tracker}/${r.channel} ${r.turnsPerS}/s`).join('; '));
  if (f.candidates?.length) bits.push(`${f.candidates.length} candidates`);
  if (f.pickPairs?.length) bits.push(`${f.pickPairs.length} pairs`);
  if (f.checks?.length) bits.push('checks ' + f.checks.map((c) => `${c.id}${c.value === null ? '-' : c.ok ? '+' : 'x'}`).join(' '));
  return bits.join(' · ');
}

const trim = (rec, depth = 2) => ({ ...rec, supersedes: depth > 1 && rec.supersedes ? trim(rec.supersedes, depth - 1) : null });

/** Decision -> TraceRecord. An unchanged replay returns `prev` itself; anything else supersedes it (2 levels kept). */
export function toRecord(d, { session, applied = null, prev = null } = {}) {
  if (prev && prev.digest === d.digest && prev.brain === d.brain && stable(prev.value) === stable(d.value)) return prev;
  const r = d.req;
  return {
    id: r.id, session, kind: r.kind, scope: r.scope, attempt: r.attempt ?? 0, digest: d.digest, question: r.question ?? '',
    inputs: { deps: r.deps ?? [], frames: r.frames ?? [], facts: factsLine(r) },
    chain: d.chain ?? [], brain: d.brain, value: d.value, conf: d.conf, calibrated: !!d.calibrated, status: d.status,
    provisional: PROVISIONAL.has(d.status), rationale: d.rationale ?? '', tools: d.tools ?? [], applied: applied ?? null,
    supersedes: prev ? trim(prev) : null, verifiedBy: null, at: Date.now(), ms: d.ms ?? 0,
  };
}

const order = (r) => [KINDS.indexOf(r.kind), r.scope?.t0 ?? 0];
/** Records -> {video, trace:[{stage, inputs, decision, rationale, confidence, time_ms}]} (DIRECTOR-TRACE-N.json shape). */
export function toTrace2(video, records) {
  const list = [...records].sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || (a.id < b.id ? -1 : 1); });
  return {
    video,
    trace: list.map((r) => {
      const sc = scopeId(r.kind, r.scope);
      return {
        stage: STAGE_OF[r.kind] + (sc === 'v' ? '' : '.' + sc),
        inputs: { id: r.id, brain: r.brain, status: r.status, calibrated: r.calibrated, facts: r.inputs?.facts ?? '', deps: r.inputs?.deps ?? [],
          frames: r.inputs?.frames ?? [], chain: r.chain ?? [], tools: (r.tools ?? []).map((t) => t.call) },
        decision: r.value, rationale: r.rationale ?? '', confidence: r.conf ?? 0, time_ms: r.ms ?? 0,
      };
    }),
  };
}

// ---- trace-2 JSON -> replay answers ----
const sec = (x) => Math.round(parseFloat(x) * 1000);
const VALID = { static: ['single', 'relative', 'rate'], rides: ['relative', 'rate'], move: ['relative', 'rate'], sway: ['relative', 'rate'] };
function cameraFromText(t) {
  const mode = /static/i.test(t) ? 'static' : /push-in|zoom|pan\b|camera move/i.test(t) ? 'move' : /sway/i.test(t) ? 'sway' : /bump|rides/i.test(t) ? 'rides' : null;
  if (!mode) return null;
  const px = t.match(/(\d+(?:\.\d+)?)\s*px/i), sp = [...t.matchAll(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*s\b/g)].map((m) => [sec(m[1]), sec(m[2])]);
  const rate = t.match(/(\d+(?:\.\d+)?)\s*turns\/s/);
  return { mode, p95Px: px ? +px[1] : 0, rateHz: mode === 'rides' && rate ? Math.round((+rate[1] / 2) * 100) / 100 : null, phaseMs: null, moveSpans: mode === 'move' ? sp : [], valid: VALID[mode] };
}
const runIds = (x) => [...new Set(String(Array.isArray(x) ? x.join(' ') : x ?? '').match(/run\d+/g) ?? [])];
const CHANNEL = /\b(dist01|proj|area|len_over_width|centroid_x|centroid_y)\b/;

/** A trace-2 JSON (written by toTrace2, or the hand-written DIRECTOR-TRACE-2.json) -> replay answers by decision id.
 *  Hand traces yield scene-level ids (`track:s0`, `direction:s1`) and `story:v` (the whole plan); the replay brain
 *  matches those to span ids and slices story:v per scene. */
export function fromTrace2(json) {
  const replay = {}, warnings = [], put = (id, value, e) => { replay[id] ??= { value, rationale: e.rationale ?? '', conf: e.confidence ?? 1 }; };
  for (const e of json?.trace ?? []) {
    const d = e.decision, st = String(e.stage ?? '');
    if (e.inputs?.id && d !== undefined) { put(e.inputs.id, d, e); continue; }
    try {
      if (st === 'survey.base_and_camera') { for (const [k, t] of Object.entries(d ?? {})) { const c = /^s\d+$/.test(k) && cameraFromText(String(t)); if (c) put(`camera:${k}`, c, e); } continue; }
      if (st === 'story.climax' && Array.isArray(d?.climax)) { put('climax:v', { window: { t0: d.climax[0], t1: d.climax[1] }, afterglowTo: d.afterglow?.[1] ?? null }, e); continue; }
      if (st === 'story.plan' && Array.isArray(e.inputs?.rows)) {
        put('story:v', { segments: e.inputs.rows.map((r) => ({ t0: r.start_ms, t1: r.end_ms, kind: r.kind, visible: r.kind !== 'offscreen', action: ['idle', 'outro', 'fade-in'].includes(r.kind) ? 'stops' : 'continues',
          intensity: r.intensity ?? 1, ...(r.recipe ? { recipe: r.recipe } : {}), ...(r.params ? { params: r.params } : {}), name: r.name ?? r.kind })) }, e);
        continue;
      }
      let m = st.match(/^tracking\.compare\.(s\d+)$/);
      if (m && d) {
        const keep = runIds(d.keep)[0] ?? null, reject = Object.fromEntries((d.reject ?? []).flatMap((t) => runIds(t).map((id) => [id, String(t)])));
        put(`track:${m[1]}`, { keep, ...(String(d.keep).match(CHANNEL) ? { channel: String(d.keep).match(CHANNEL)[1] } : {}), agree: runIds(d.agree), reject }, e);
        continue;
      }
      m = st.match(/^tracking\.scene(\d+)$/);
      if (m && d) {
        const t = String(d.kind ?? ''), rate = t.match(/rate (\d+(?:\.\d+)?)/), recipe = t.match(/recipe ([\w-]+)/);
        put(`track:s${m[1]}`, { keep: null, agree: [], reject: Object.fromEntries((d.reject ?? []).flatMap((x) => runIds(x).map((id) => [id, String(x)]))),
          fallback: { recipe: recipe?.[1] ?? 'penetration-strokes', params: rate ? { rate: +rate[1] } : {} } }, e);
        continue;
      }
      if (st === 'direction' && d) { for (const [k, t] of Object.entries(d)) { if (!/^s\d+$/.test(k)) continue; const s = String(t).match(/sign ([+-]?1)/); put(`direction:${k}`, { sign: s ? +s[1] : 0, pairs: [] }, e); } continue; }
      if (st === 'depth' && d) {
        for (const [k, t] of Object.entries(d)) {
          const s = k.match(/^(s\d+)/), lo = String(t).match(/lo (\d+)/), hi = String(t).match(/hi (\d+)/), it = String(t).match(/intensity (\d(?:\.\d+)?)/);
          if (s && lo && hi) put(`depth:${s[1]}`, { lo: +lo[1], hi: +hi[1], intensity: it ? +it[1] : 1 }, e);
        }
        continue;
      }
      warnings.push(`stage "${st}": not a decision, skipped`);
    } catch (err) { warnings.push(`stage "${st}": ${err.message}`); }
  }
  return { replay, warnings };
}
