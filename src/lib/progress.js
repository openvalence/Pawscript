// progress.js -- one wording for a running sidecar job's progress (tracker panel, status bar, timeline, quick bar). Pure.
// The sidecar sends {done, total, stage?} at least once a second while frames move (PROTOCOL.md progress v4.1); the rate
// is an EMA over those events, restarted at a stage change, and the time left comes from it (else from the mean so far).

/** ms -> 'm:ss' (or 'h:mm:ss'). */
export function fmtLeft(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The rate EMA after a progress event: prev {done, t, rate (done per ms), stage} | null -> next. A new stage or done
 *  going back restarts it; an event with no new frames keeps the previous one (the next delta spans both). */
export function rateStep(prev, { done = 0, stage = '' } = {}, now = Date.now(), alpha = 0.3) {
  stage = stage || '';
  if (!prev || prev.stage !== stage || done < prev.done) return { done, t: now, rate: 0, stage };
  const dt = now - prev.t;
  if (dt <= 0 || done === prev.done) return prev;
  const r = (done - prev.done) / dt;
  return { done, t: now, stage, rate: prev.rate ? prev.rate + alpha * (r - prev.rate) : r };
}

// paw-iyl3: every stage after the last tracked frame has words (sidecar v4.41 frames / result; read = the app reading it)
// paw-mhme: and every stage before the first one (sidecar v4.43): the model load in its parts, the tagger, freeing VRAM
const STAGE_TEXT = { scenes: 'finding cuts', 'model load': 'loading the model', inference: 'tracking the scene', groups: 'motion groups',
  frames: 'sending the tracked frames', points: 'making points', shaft: 'shaft pass', result: 'sending the result', read: 'reading the result',
  starting: 'starting the tracker', freeing: 'freeing GPU memory', levels: 'adjusting levels', reading: 'reading frames',
  'model read': 'reading the model weights', 'model gpu': 'moving the model to the GPU', tagger: 'loading the tagger', labels: 'naming the groups',
  warming: 'warming up the GPU' };   // paw-vdb3.1: the card's one-time probe (MIOpen's cold start: 9-11 s on AMD)
/** paw-mhme: how long each label was on screen during a job. mark(stage) at every progress event (a stage change
 *  starts a new row; '' keeps the current one); text() at the end -> 'start 4.2 s, reading frames 3.1 s, ...' (summed
 *  per stage; 'start' = before the sidecar's first stage: the serve starting, the video opening). */
export function stageClock(now = Date.now()) {
  let cur = 'start', t = now;
  const spent = new Map(), add = (at) => { spent.set(cur, (spent.get(cur) || 0) + at - t); t = at; };
  return {
    mark(stage, at = Date.now()) { if (stage && stage !== cur) { add(at); cur = stage; } },
    text(at = Date.now()) { add(at); return [...spent].map(([k, ms]) => `${STAGE_TEXT[k] || k} ${(ms / 1000).toFixed(1)} s`).join(', '); },
  };
}

/** A job's done count as shown (bars, sweeps, percentages): never all of total, the job ends when its result is in (paw-iyl3). */
export const shownDone = (done, total) => Math.min(done, 0.99 * total);

/**
 * '43 % · 1:20 left' while frames move; before the first frame the sidecar's own line (lastLog: uv installing, waiting
 * for the GPU) or 'starting the tracker' ('waiting for the GPU' for describe); a stage without frame counts
 * (model load, inference, groups, points) names it after the percentage. A job over several ranges (describe all:
 * range = index, ranges = count) leads with 'scene 3/6' once frames move.
 */
export function progressText(p = {}) {
  const t = stepText(p), { done = 0, range = -1, ranges = 0 } = p;
  return ranges > 1 && range >= 0 && done ? `scene ${range + 1}/${ranges} · ${t}` : t;
}

function stepText({ done = 0, total = 0, startedAt = 0, now = Date.now(), lastLog = '', rate = 0, stage = '', busy = '' } = {}) {
  const st = STAGE_TEXT[stage];
  if (!total || !done) return st || lastLog || (busy === 'describe' ? 'waiting for the GPU' : 'starting the tracker');
  const pct = `${Math.min(99, Math.floor((100 * done) / total))} %`;   // 100 % only when the job is over (it then shows nothing)
  if (st) return `${pct} · ${st}`;
  if (done >= total) return `${pct} · finishing`;
  const left = rate > 0 ? (total - done) / rate : startedAt && now > startedAt ? ((now - startedAt) * (total - done)) / done : NaN;
  return Number.isFinite(left) ? `${pct} · ${fmtLeft(left)} left` : pct;
}
