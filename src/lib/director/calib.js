// calib.js -- brain confidence -> calibrated confidence (README §5). table = calib.json {[brain]:{[kind]:{a,b,n,ci95}}},
// Platt scaling fitted leave-one-clip-out by trackers/eval/director_eval.py. A missing entry passes raw through.

const clip = (p) => Math.min(1 - 1e-4, Math.max(1e-4, Number.isFinite(p) ? p : 0));

export function calibrate(table, brain, kind, raw) {
  const e = table?.[brain]?.[kind];
  if (!e || !Number.isFinite(e.a) || !Number.isFinite(e.b)) return { conf: Number.isFinite(raw) ? raw : 0, n: 0, calibrated: false };
  const p = clip(raw), z = e.a * Math.log(p / (1 - p)) + e.b;
  return { conf: 1 / (1 + Math.exp(-z)), n: e.n ?? 0, calibrated: true };
}
