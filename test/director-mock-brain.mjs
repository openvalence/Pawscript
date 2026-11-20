// director-mock-brain.mjs -- a scripted brain for the director harness and node tests (contract README §4 Brain).
// It answers every kind from the request's facts the way trace 2 did, with direction from the fake world's truth.
//   makeMockBrain({ id: 'rules', unsure: ['direction'], redoOnce: ['track'], abstain: [] })
// unsure: kinds answered at raw 0.5 (below every tau: the decision goes on down the chain, to the user at the end)
// redoOnce: verify answers redo(<kind>) the first time per span (exercises the redo path)   abstain: kinds it skips
import { WORLD } from './director-fake-sidecar.mjs';
import { RECIPES, KINDS } from '../src/lib/gen/recipes.js';
import { probeId } from '../src/lib/director/decisions.js';

const RELATIVE = new Set(['dist01', 'area', 'len_over_width']);
const withId = (p, sc) => ({ ...p, id: probeId(p, sc.t0, sc.t1) });

const truthAt = (t) => (WORLD.scenes.find(([a, b]) => t >= a && t < b) || [])[5] ?? 1;

export function makeMockBrain({ id = 'rules', unsure = [], redoOnce = [], abstain = [], kinds = ['camera', 'climax', 'story', 'roi', 'track', 'direction', 'depth', 'verify'] } = {}) {
  const redone = new Set(), log = [];
  const ans = (r, value, raw, rationale) => ({ id: r.id, round: r.round, value, raw: unsure.includes(r.kind) ? 0.5 : raw, rationale });
  function one(r) {
    const f = r.facts || {}, sc = r.scope;
    switch (r.kind) {
      case 'camera': {
        const c = f.scene?.camera || { mode: 'static', p95Px: 0 };
        const valid = c.mode === 'rides' ? ['relative', 'rate'] : c.mode === 'static' ? ['single', 'relative', 'rate'] : ['rate'];
        return ans(r, { mode: c.mode, p95Px: c.p95Px ?? 0, rateHz: c.rateHz ?? null, phaseMs: c.phaseMs ?? null, moveSpans: c.moveSpans || [], valid }, 0.9, `motion.stats says ${c.mode} (${c.p95Px} px)`);
      }
      case 'climax': {
        const s = (f.scenes || []).find((x) => x.describe?.cumOnsetMs != null);
        if (!s) return ans(r, { window: null, afterglowTo: null }, 0.86, 'no cum onset in the tags');
        const on = s.describe.cumOnsetMs - s.t0 <= 1500 ? s.t0 : s.describe.cumOnsetMs;
        return ans(r, { window: { t0: on, t1: s.t1 }, afterglowTo: s.t1 }, 0.9, `cum onset ${s.describe.cumOnsetMs} ms, snapped to the cut at ${s.t0}`);
      }
      case 'story': {
        const s = f.scene, d = s?.describe, cam = f.camera?.mode, cl = f.climax?.window, last = (s?.seconds?.[0]?.creditsLike ?? 0) > 0.5;
        let kind = 'penetration', visible = true, why = 'penetration tags, periodic';
        if (!d?.acts?.length) { kind = last ? 'outro' : 'idle'; why = last ? 'credits' : 'black / title'; }
        else if (cl && cl.t0 <= s.t0 && cl.t1 >= s.t1) { kind = 'orgasm'; why = 'inside the orgasm window'; }
        else if (cam === 'move') { kind = 'offscreen'; visible = false; why = 'camera push-in, contact not visible'; }
        else if (d.knot) { kind = 'knotting'; why = 'knot tag'; }
        return ans(r, { segments: [{ t0: sc.t0, t1: sc.t1, kind, visible, action: visible ? 'unknown' : 'continues', intensity: 1, name: `${kind} · cam ${cam || '?'}` }] }, 0.85, why);
      }
      case 'roi': {
        const c = f.candidates?.[0], cam = f.camera?.mode;
        if (!c) return ans(r, { probes: [], none: cam === 'move' ? 'camera' : 'offscreen' }, 0.8, 'no moving part found');
        const subject = cam === 'rides' && c.pair
          ? { tracker: 'cotracker_points', roi: { kind: 'points', points: c.pair }, params: { primary: 'dist01' }, role: 'subject', part: 'two bodies', channel: 'dist01' }
          : { tracker: 'cotracker_points', roi: { kind: 'points', points: c.points }, params: { primary: 'proj', axis: 'custom', axis_x0: c.axis[0], axis_y0: c.axis[1], axis_x1: c.axis[2], axis_y1: c.axis[3] }, role: 'subject', part: 'hips' };
        const second = { tracker: 'sam2_mask', roi: { kind: 'box', ...c.box }, params: { primary: 'area' }, role: 'subject', part: 'second opinion', channel: 'area' };
        const ref = { tracker: 'lk_box', roi: { kind: 'box', x: 0, y: 0, w: 0.12, h: 0.12 }, params: {}, role: 'reference', part: 'background' };
        return ans(r, { probes: [subject, second, ref].map((p) => withId(p, sc)) }, 0.8, `propose candidate power ${c.power}`);
      }
      case 'track': {
        const runs = f.runs || [], subj = runs.filter((x) => x.role === 'subject'), reject = {};
        for (const x of runs) if (x.role === 'reference') reject[x.id] = 'reference';
        const valid = f.camera?.valid || ['single', 'relative', 'rate'], allowed = (x) => valid.includes(RELATIVE.has(x.channel) ? 'relative' : 'single');
        const ok = subj.filter((x) => !(x.cameraShare >= 0.8 && (x.cameraOffsetMs ?? 999) < 60) && allowed(x));
        for (const x of subj) if (!ok.includes(x)) reject[x.id] = allowed(x) ? `measures the camera (${x.cameraShare})` : `channel ${x.channel} not valid with this camera`;
        const keep = ok.sort((a, b) => a.halfCv - b.halfCv)[0] || null;
        const agree = keep ? ok.filter((x) => x !== keep && (f.pairs || []).some((p) => [p.a, p.b].includes(keep.id) && [p.a, p.b].includes(x.id) && p.match >= 0.75)).map((x) => x.id) : [];
        const kind = f.segment?.kind || 'penetration';
        if (!keep) return ans(r, { keep: null, agree: [], reject, fallback: { recipe: kind === 'offscreen' ? 'penetration-strokes' : KINDS[kind]?.recipe || 'strokes', params: {} } }, 0.8, 'every run measures the camera');
        return ans(r, { keep: keep.id, agree, reject }, agree.length ? 0.85 : 0.7, `${keep.id} half-cv ${keep.halfCv}${agree.length ? `, agrees with ${agree.join(', ')}` : ', no second opinion'}`);
      }
      case 'direction': {
        const s = truthAt(sc.t0), p = f.pickPairs?.[0];
        const pairs = p ? [(p.a.pos < p.b.pos) === (s > 0) ? { deep: p.a.at, shallow: p.b.at } : { deep: p.b.at, shallow: p.a.at }] : [];
        return ans(r, { sign: s, pairs }, 0.95, s > 0 ? 'low end is deep: as tracked' : 'low end is out: mirror it');
      }
      case 'depth': {
        const rp = RECIPES[f.segment?.recipe || KINDS[f.segment?.kind]?.recipe]?.params || {};
        return ans(r, { lo: rp.lo ?? 0, hi: rp.hi ?? 90, intensity: f.segment?.intensity ?? 1 }, 0.7, 'recipe defaults');
      }
      case 'verify': {
        const checks = f.checks || [], bad = checks.find((c) => !c.ok), key = sc.t0 + ':' + sc.scene;
        const forced = redoOnce.length && !redone.has(key);
        if (forced) redone.add(key);
        if (bad || forced) return ans(r, { verdict: 'redo', redo: forced ? redoOnce[0] : 'track', checks, note: forced ? 'forced redo (mock)' : `${bad.id} failed` }, 0.9, 'redo');
        return ans(r, { verdict: 'ok', checks, note: 'all checks pass' }, 0.9, `${checks.length} checks pass`);
      }
    }
    return { id: r.id, abstain: 'unknown kind' };
  }
  return {
    id, kinds, log,
    available: async () => true,
    async decide(reqs) { log.push(...reqs.map((r) => r.id)); return reqs.map((r) => (abstain.includes(r.kind) ? { id: r.id, abstain: 'mock abstains' } : one(r))); },
  };
}
