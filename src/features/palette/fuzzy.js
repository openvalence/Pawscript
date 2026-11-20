// fuzzy.js -- the palette's matcher. Pure (test/palette-fuzzy.test.mjs).
//
// score(word, text) -> {score, hits} | null, case-insensitive, in three tiers that never overlap:
//   300..399  contiguous   'pla' in 'Play / pause'   (word start, earlier, shorter text score higher)
//   200..299  word starts  'zi' -> 'Zoom In', 'plpa' -> 'PLay / PAuse' (runs that each begin a word)
//     1..199  scattered    any in-order subsequence
// match(query, fields) splits the query on spaces; every word must match one of the fields (the first field
// is preferred on ties). rank() orders items by score, ties by recency, then by their original order.

const alnum = /[\p{L}\p{N}]/u;
const lower = /\p{Ll}/u, upper = /\p{Lu}/u;
/** Does a word begin at text[i]? Start, after a non-alphanumeric, or a camelCase hump ('stepBack'). */
export function isWordStart(text, i) {
  if (i === 0) return true;
  const p = text[i - 1], c = text[i];
  return !alnum.test(p) || (lower.test(p) && upper.test(c));
}

const clamp = (q) => Math.max(0, Math.min(99, q));

export function score(word, text) {
  const q = String(word).toLowerCase(), t = String(text ?? '').toLowerCase(), m = q.length, n = t.length;
  if (!m) return { score: 0, hits: [] };
  if (m > n) return null;

  // 1. contiguous: the best occurrence
  let best = null;
  for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + 1)) {
    const s = 300 + clamp(55 + (isWordStart(text, i) ? 25 : 0) + (i === 0 ? 10 : 0) + (m === n ? 9 : 0) - Math.min(i, 25) - Math.min(n - m, 40) * 0.4);
    if (!best || s > best.score) best = { score: s, hits: Array.from({ length: m }, (_, k) => i + k) };
  }
  if (best) return best;

  // 2. word starts: runs of matched characters, each run beginning a word. Memoised backtracking, O(m*n).
  const hits = [], dead = new Set();
  const go = (j, from, cont) => {
    if (j === m) return true;
    const key = j * (n + 1) * 2 + from * 2 + (cont ? 1 : 0);
    if (dead.has(key)) return false;
    if (cont && t[from] === q[j]) { hits.push(from); if (go(j + 1, from + 1, true)) return true; hits.pop(); }
    for (let i = from; i < n; i++) {
      if (t[i] === q[j] && isWordStart(text, i) && !(cont && i === from)) { hits.push(i); if (go(j + 1, i + 1, true)) return true; hits.pop(); }
    }
    dead.add(key);
    return false;
  };
  if (go(0, 0, false)) {
    let runs = 1;
    for (let k = 1; k < m; k++) if (hits[k] !== hits[k - 1] + 1) runs++;
    return { score: 200 + clamp(70 + (hits[0] === 0 ? 15 : 0) - (runs - 1) * 4 - Math.min(n - m, 40) * 0.4), hits };
  }

  // 3. scattered: leftmost in-order subsequence
  const sc = [];
  for (let i = 0, j = 0; i < n && j < m; i++) if (t[i] === q[j]) { sc.push(i); j++; }
  if (sc.length < m) return null;
  let bonus = 0;
  for (let k = 0; k < m; k++) {
    if (isWordStart(text, sc[k])) bonus += 6;
    if (k && sc[k] === sc[k - 1] + 1) bonus += 4;
  }
  return { score: 1 + Math.max(0, Math.min(198, 100 + bonus - (sc[m - 1] - sc[0] - m + 1) - sc[0] * 0.5)), hits: sc };
}

/** query 'edit und' against fields ['Undo', 'Edit', 'edit.undo'] -> {score, hits: [[...], [...], [...]]} | null. */
export function match(query, fields) {
  const words = String(query).trim().split(/\s+/).filter(Boolean);
  const hits = fields.map(() => new Set());
  if (!words.length) return { score: 0, hits: fields.map(() => []) };
  let total = 0;
  for (const w of words) {
    let best = null, bi = -1;
    fields.forEach((f, i) => {
      if (!f) return;
      const r = score(w, f);
      if (r && (!best || r.score - i * 0.5 > best.score - bi * 0.5)) { best = r; bi = i; }
    });
    if (!best) return null;
    total += best.score - bi * 0.5;
    for (const h of best.hits) hits[bi].add(h);
  }
  return { score: total / words.length, hits: hits.map((s) => [...s].sort((a, b) => a - b)) };
}

/**
 * Filter and order items for a query. fields(item) -> [text, ...]; recent: ids, most recent first; id(item); boost(item):
 * points added to the score for the order only (paw-m3b6: the palette's context).
 * -> [{item, score, hits}] best first; equal (rounded) scores go to the more recently used, then keep input order.
 */
export function rank(items, query, { fields, recent = [], id = (x) => x.id, boost = () => 0 } = {}) {
  const rec = new Map(recent.map((r, i) => [r, i]));
  const out = [];
  items.forEach((item, order) => {
    const r = match(query, fields(item));
    if (r) out.push({ item, score: r.score, key: Math.round(r.score + boost(item)), hits: r.hits, order, rec: rec.get(id(item)) ?? Infinity });
  });
  out.sort((a, b) => b.key - a.key || a.rec - b.rec || a.order - b.order);
  return out.map(({ item, score, hits }) => ({ item, score, hits }));
}

/** 'Play' + hits [0, 1] -> [{t:'Pl', on:true}, {t:'ay', on:false}] for highlighting. */
export function segments(text, hits = []) {
  const on = new Set(hits), out = [];
  for (let i = 0; i < text.length; i++) {
    const h = on.has(i);
    if (out.length && out[out.length - 1].on === h) out[out.length - 1].t += text[i];
    else out.push({ t: text[i], on: h });
  }
  return out;
}
