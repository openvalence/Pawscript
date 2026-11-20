// agent-io.js -- the app's half of the external agent (contract README §7). The request/answer transport (req/ and
// ans/ files, CDP pending/answer) is BRAINS' agent brain (brains/agent.js); here are the rest of the mailbox
// (session.json, facts.json, trace.jsonl, README §7.2) and the Tools of the `need` loop with the per-run budget
// (README §7.1), which brains reach as ctx.tools.run(call, {reqId, round}).
// Folders are not created (app.backend has no mkdir: see the report); a failed write shows as D.mailboxError.
import { pickPairs } from '../assist/model.js';
import { overlayAt } from '../../lib/runs.js';
import { rawScript, seriesOf, cameraSeries } from './runner.js';
import { firstLine } from '../draft/logic.js';
import { scriptOf as axisScript } from '../../lib/script-of.js';   // paw-x7w7: baked + live

/** Decision id -> mailbox file stem (the agent brain's rule: ':' is not allowed in Windows file names). */
export const fileOf = (id) => String(id).replace(/[^\w@.-]/g, '_');
const camelTiles = (tiles = []) => tiles.map((t) => ({ t: t.t_ms, x: t.x, y: t.y, w: t.w, h: t.h, label: t.label }));

export function makeMailbox(D) {
  let lines = [];
  const root = () => (D.settings.agentRoot && D.session ? `${D.settings.agentRoot.replace(/[\\/]+$/, '')}/${D.session}` : null);
  async function write(rel, text) {
    const r = root();
    if (!r) return false;
    try { await D.app.backend.writeText(`${r}/${rel}`, text); D.mailboxError = ''; return true; } catch (e) { D.mailboxError = `${rel}: ${firstLine(e)}`; return false; }
  }
  return {
    root,
    /** session.json (+ facts.json when known). status: running | paused | done | stopped. */
    async session(status) {
      if (!root()) return;
      const m = D.app.doc.media || {};
      await write('session.json', JSON.stringify({ schema: 'pawscript.director/1', session: D.session, status, heartbeat_ms: Date.now(),
        video: { path: m.path || '', name: m.name || '', dur_ms: m.durationMs || 0, fps: m.fps || 0, w: m.width || 0, h: m.height || 0 },
        conventions: { pos: '0=deepest,100=out' }, protocol: 'tools/director-agent/README.md' }, null, 1));
      if (D.facts) await write('facts.json', JSON.stringify(D.facts));
    },
    /** trace.jsonl mirror, one TraceRecord per line (rewritten whole: the backend has no append). */
    trace(records) { if (!root() || !records.length) return; lines = [...lines, ...records.map((r) => JSON.stringify(r))].slice(-2000); write('trace.jsonl', lines.join('\n') + '\n'); },
    reset() { lines = []; },
  };
}

/** Tools for the agent's need loop (README §7.1). run 'script' = the generated stroke axis (verify pairs). */
export function makeTools(D) {
  let n = 0;
  const call = (req) => D.service.call(req);
  const over = (k, c = 1) => D.budget && D.budget.used[k] + c > D.budget[k];
  const video = () => D.app.doc.media?.path || '';
  const scriptOf = (run) => (run === 'script' ? axisScript(D.app, 'stroke') : rawScript(D, run));
  async function images(reqId, round, what, jobs, extra = {}) {
    if (!jobs.length) return { evidence: [], result: { error: 'nothing to show' } };
    if (over('images', jobs.length)) return { evidence: [], result: { error: 'budget' } };
    const r0 = D.mailbox.root(), dir = `req/${fileOf(reqId)}`;
    const named = jobs.map((j) => ({ ...j, dest: r0 ? `${r0}/${dir}/r${round}-${++n}.jpg` : null }));
    const r = await call({ cmd: 'frames', video: video(), jobs: named });
    if (r.error || r.cancelled) return { evidence: [], result: { error: r.error || 'cancelled' } };
    const imgs = r.result?.images || [];
    if (D.budget) D.budget.used.images += imgs.length;
    return {
      evidence: imgs.map((im, k) => ({ id: `e${++n}`, type: 'image', what: `${what}${imgs.length > 1 ? ` ${k + 1}/${imgs.length}` : ''}`, ...(im.dest ? { path: im.dest.slice(r0.length + 1) } : {}),
        ...(im.b64 || extra.order ? { data: { ...(im.b64 ? { b64: im.b64 } : {}), ...(extra.order ? { order: extra.order[k] } : {}) } } : {}), tiles: camelTiles(im.tiles), source: 'frames' })),
      result: { images: imgs.length },
    };
  }
  const stats = (what, data) => ({ evidence: [{ id: `e${++n}`, type: 'stats', what, data, source: 'tools' }], result: { ok: true } });
  return {
    async run(c, { reqId, round = 0 } = {}) {
      switch (c.tool) {
        case 'frames': {
          const step = c.stepMs || 500, times = c.times || Array.from({ length: Math.max(1, Math.floor((c.t1 - c.t0) / step)) }, (_, k) => Math.round(c.t0 + k * step));
          return images(reqId, round, `frames ${times.length}`, [{ times_ms: times, crop: c.crop ?? null, grid: c.grid ?? null, cols: c.cols || 4, height: c.height || 240, labels: 'time', quality: 85 }]);
        }
        case 'pairs': {
          const pp = pickPairs(scriptOf(c.run), c.t0, c.t1, { k: c.k || 3, frameMs: 1000 / (D.app.doc.media?.fps || 30) });
          const order = pp.map((p) => (Math.random() < 0.5 ? { A: p.a.at, B: p.b.at } : { A: p.b.at, B: p.a.at }));   // blind: the app keeps which is which
          return images(reqId, round, `blind pair (${c.run})`, order.map((o) => ({ times_ms: [o.A, o.B], cols: 2, height: 240, labels: 'AB', tile_labels: ['A', 'B'], quality: 85 })), { order });
        }
        case 'overlay': {
          const fr = D.runOf(c.run)?.frames;
          const ov = (c.times || []).map((t) => { const o = fr && overlayAt(fr, t); return { t_ms: t, points: o?.points || [], boxes: o?.boxes || [] }; });
          return images(reqId, round, `overlay of ${c.run}`, (c.times || []).length ? [{ times_ms: c.times, overlay: ov, cols: 4, height: 240, labels: 'time', quality: 85 }] : []);
        }
        case 'track': {
          if (over('tracks')) return { evidence: [], result: { error: 'budget' } };
          const t = Date.now(), params = c.params || {}, tag = 'director:' + D.L.digest({ tracker: c.tracker, roi: c.roi ?? null, params, t0: c.t0, t1: c.t1 });
          const r = await D.api.trackRange({ tracker: c.tracker, range: { t0: c.t0, t1: c.t1 }, roi: c.roi, params, tag });
          if (r.error || r.cancelled) return { evidence: [], result: { error: r.error || 'cancelled' } };
          if (D.budget) { D.budget.used.tracks++; D.budget.used.gpuS += (Date.now() - t) / 1000; }
          return { ...stats(`track ${r.run.id} (${c.tracker})`, { runId: r.run.id, tag, role: c.role || 'subject', part: c.part || '' }), result: { runId: r.run.id } };
        }
        case 'compare': {
          const scenes = D.app.doc.scenes || [], i = Math.max(0, scenes.findIndex((s) => s.start_ms <= c.t0 && c.t0 < s.end_ms));
          const series = (c.runs || []).map((id) => ({ id, role: 'subject', tracker: '', channel: c.channels?.[id] || 'primary', ...seriesOf(D, { runId: id, channel: c.channels?.[id] }) }));
          const r = await call({ cmd: 'motion.compare', t0: c.t0, t1: c.t1, loop_period_ms: D.facts?.scenes?.[i]?.loop?.periodMs ?? null, match_ms: 120, series, camera: cameraSeries(D, i) });
          return r.error ? { evidence: [], result: { error: r.error } } : stats(`compare ${(c.runs || []).join(', ')}`, r.result);
        }
        case 'camera': {
          const r = await call({ cmd: 'motion.stats', video: video(), ranges: [{ start_ms: c.t0, end_ms: c.t1 }], params: { width: 320, fps: 15, grid: 8, border: 0.12, boxes: c.boxes ?? null } });
          return r.error ? { evidence: [], result: { error: r.error } } : stats(`camera ${c.t0}-${c.t1}`, r.result?.ranges?.[0]?.camera ?? null);
        }
        case 'channel': D.setChannel(c.run, c.channel); return { evidence: [{ id: `e${++n}`, type: 'text', what: `${c.run} channel = ${c.channel}`, source: 'tools' }], result: { ok: true } };
        default: return { evidence: [], result: { error: 'unknown tool ' + c.tool } };
      }
    },
  };
}
