// viterbi.js -- per-step label scores -> one label path with a switching penalty, and the path -> spans (README §10).

/** logp T x K (log scores per step) -> best label per step; each label change costs switchPenalty. */
export function viterbi(logp, switchPenalty = 4) {
  const T = logp.length;
  if (!T) return [];
  const K = logp[0].length, back = [];
  let D = logp[0].slice();
  for (let t = 1; t < T; t++) {
    let bi = 0;
    for (let k = 1; k < K; k++) if (D[k] > D[bi]) bi = k;
    const move = D[bi] - switchPenalty, N = new Array(K), b = new Array(K);
    for (let k = 0; k < K; k++) {
      if (D[k] >= move) { N[k] = D[k] + logp[t][k]; b[k] = k; } else { N[k] = move + logp[t][k]; b[k] = bi; }
    }
    back.push(b);
    D = N;
  }
  let k = 0;
  for (let j = 1; j < K; j++) if (D[j] > D[k]) k = j;
  const path = [k];
  for (let t = T - 2; t >= 0; t--) path.push((k = back[t][k]));
  return path.reverse();
}

/** Labels (one per stepMs from t0) -> [{t0, t1, label}] runs; the last run ends at t1. */
export function segmentsFrom(labels, names, t0, stepMs, t1) {
  const out = [];
  labels.forEach((l, i) => {
    const a = t0 + i * stepMs, last = out[out.length - 1];
    if (a >= t1) return;
    if (last && last.label === names[l]) return;
    if (last) last.t1 = a;
    out.push({ t0: a, t1, label: names[l] });
  });
  return out;
}
