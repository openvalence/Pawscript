// health.js -- the status bar's one health slot (paw-wfd2.3, the OpenValence health rule): a degradation the user should
// know about is one line, a fact and one action, the most urgent first; hysteresis keeps a condition from flapping. Pure
// (test/health.test.mjs). Conditions come from features/*/health.js ({id, pri, read(app) -> {text, tone?, tip?, action?} | null}).
export const SHOW_MS = 800;    // active this long before it shows ('bad': at once)
export const HIDE_MS = 2500;   // inactive this long before it goes

/** active: [{id, pri, tone, text, ...}] now; seen: Map id -> {on, off, c} (kept between calls, mutated); now: ms.
 *  -> {shown: the conditions to show, most urgent (lowest pri) first, next: ms until the answer may change, or null}. */
export function healthStep(active, seen, now, { show = SHOW_MS, hide = HIDE_MS } = {}) {
  const ids = new Set(active.map((c) => c.id));
  for (const c of active) {
    const s = seen.get(c.id);
    if (!s) seen.set(c.id, { on: now, off: null, c });
    else Object.assign(s, { off: null, c, on: s.off != null && now - s.off >= hide ? now : s.on });
  }
  for (const [id, s] of seen) if (!ids.has(id) && s.off == null) s.off = now;
  const shown = [];
  let next = null;
  const soon = (ms) => { if (ms > 0 && (next == null || ms < next)) next = ms; };
  for (const [id, s] of seen) {
    if (s.off != null) {
      const left = hide - (now - s.off);
      if (left <= 0) { seen.delete(id); continue; }
      if (s.c.shown) { shown.push(s.c); soon(left); }
      continue;
    }
    const wait = s.c.tone === 'bad' ? 0 : show - (now - s.on);
    if (wait <= 0) { s.c.shown = true; shown.push(s.c); } else soon(wait);
  }
  shown.sort((a, b) => (a.pri ?? 50) - (b.pri ?? 50));
  return { shown, next };
}
