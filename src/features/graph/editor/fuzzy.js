// fuzzy.js -- the node search's matcher: ranks catalogue items by title, aliases, group, param labels and help,
// with recent picks and favourites boosted. Pure (test/graph-editor-fuzzy.test.mjs).
//
// Item = { key, title, group?, aliases?: string[], params?: string[], help?, ... }. Every query token must
// match some field; the item's score is the sum of each token's best field score times the field weight.

const W = { title: 4, aliases: 3, group: 1.5, params: 1.2, help: 0.6 };

/**
 * Score one token against one text: 0 = no match. A prefix of the text scores highest, then the start of a
 * word, then a contiguous substring, then a subsequence (gaps cost). Case-insensitive.
 */
export function tokenScore(tok, text) {
  if (!tok || !text) return 0;
  const t = text.toLowerCase();
  if (t === tok) return 12;
  if (t.startsWith(tok)) return 10 - Math.min(3, (t.length - tok.length) / 10);
  const at = t.indexOf(tok);
  if (at > 0 && /[^a-z0-9]/.test(t[at - 1])) return 8;
  // camelCase / dotted word starts: 'rmr' matches 'removeMicroReversals' via initials
  const initials = initialsOf(text);
  if (tok.length >= 2 && initials.startsWith(tok)) return 7;
  if (at > 0) return 6;
  // subsequence
  let i = 0, gaps = 0, last = -1;
  for (let j = 0; j < t.length && i < tok.length; j++) {
    if (t[j] === tok[i]) { if (last >= 0 && j !== last + 1) gaps++; last = j; i++; }
  }
  if (i < tok.length || tok.length < 2) return 0;
  return Math.max(0.5, 4 - gaps * 0.8);
}

/** 'removeMicroReversals' -> 'rmr', 'edit.capSpeed' -> 'ecs', 'Remap depth' -> 'rd'. */
export function initialsOf(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], p = s[i - 1];
    if (/[A-Za-z0-9]/.test(c) && (i === 0 || /[^A-Za-z0-9]/.test(p) || (/[A-Z]/.test(c) && /[a-z]/.test(p)))) out += c.toLowerCase();
  }
  return out;
}

const fieldTexts = (it) => ({
  title: [it.title, it.key].filter(Boolean),
  aliases: it.aliases || [],
  group: it.group ? [it.group] : [],
  params: it.params || [],
  help: it.help ? it.help.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 2) : [],
});

/** Score an item against a query (0 = excluded). */
export function itemScore(query, it, cache) {
  const toks = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 1;
  const f = cache?.get(it) ?? fieldTexts(it);
  if (cache && !cache.has(it)) cache.set(it, f);
  let sum = 0;
  for (const tok of toks) {
    let best = 0;
    for (const [field, texts] of Object.entries(f)) {
      for (const s of texts) {
        let sc = tokenScore(tok, s);
        // help only counts on word prefixes (a subsequence in prose matches everything)
        if (field === 'help' && sc < 8) sc = 0;
        best = Math.max(best, sc * W[field]);
      }
    }
    if (!best) return 0;
    sum += best;
  }
  // the whole query against the title: typing a node's name must place that node, whatever its rivals'
  // aliases add up to token by token (one-token queries already get this from tokenScore)
  if (toks.length > 1) {
    const q = toks.join(' ');
    let bonus = 0;
    for (const s of f.title) {
      const t = s.toLowerCase().replace(/\s+/g, ' ');
      bonus = Math.max(bonus, t === q ? 40 : t.startsWith(q) ? 25 : t.includes(q) ? 10 : 0);
    }
    sum += bonus;
  }
  return sum;
}

/**
 * Rank items for a query. recent: keys most recent first; favs: Set or array of keys. An empty query keeps
 * catalogue order with favourites, then recent picks, first. Returns the items (not copies).
 */
export function rank(query, items, { recent = [], favs = [], limit = Infinity } = {}) {
  const fav = new Set(favs), rec = new Map(recent.map((k, i) => [k, i]));
  const boost = (it) => (fav.has(it.key) ? 6 : 0) + (rec.has(it.key) ? Math.max(0, 5 - rec.get(it.key) * 0.5) : 0);
  const cache = new Map();
  const q = String(query || '').trim();
  const scored = [];
  items.forEach((it, i) => {
    const s = q ? itemScore(q, it, cache) : 1;
    if (s > 0) scored.push({ it, s: (q ? s : 0) + boost(it), i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.it);
}

/** Character ranges of `text` matched by the query's tokens, for <mark> highlighting: [[from, to), ...]. */
export function highlights(query, text) {
  const t = String(text).toLowerCase(), out = [];
  for (const tok of String(query).toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = t.indexOf(tok);
    if (at >= 0) out.push([at, at + tok.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
