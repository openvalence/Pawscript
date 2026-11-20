// md.js -- the little Markdown the guide's quick start uses, as data for a Svelte template (no HTML strings, nothing
// fetched): # / ## / ### headings, paragraphs, - and 1. lists, `code`, **bold**, [text](link) shown as its text. HTML
// comments are dropped; tables and anything else stay plain text. Pure (test/onboard-steps.test.mjs).

/** 'a `T` b **c**' -> [{t: 'a '}, {code: 'T'}, {t: ' b '}, {b: 'c'}] */
export function inline(s) {
  const out = [];
  let at = 0;
  for (const m of s.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g)) {
    if (m.index > at) out.push({ t: s.slice(at, m.index) });
    out.push(m[1] != null ? { code: m[1] } : m[2] != null ? { b: m[2] } : { t: m[3] });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: s.slice(at) });
  return out;
}

/** -> [{type: 'h1' | 'h2' | 'h3' | 'p', text: inline[]} | {type: 'ul' | 'ol', items: inline[][]}] */
export function parseMd(src = '') {
  const blocks = [];
  let para = null, list = null;
  const flush = () => { if (para) blocks.push({ type: 'p', text: inline(para.join(' ')) }); para = null; };
  for (const raw of String(src).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); list = null; continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); list = null; blocks.push({ type: 'h' + m[1].length, text: inline(m[2]) }); continue; }
    if ((m = line.match(/^(?:([-*])|(\d+)\.)\s+(.*)$/))) {
      flush();
      const type = m[1] ? 'ul' : 'ol';
      if (!list || list.type !== type) blocks.push((list = { type, items: [], raw: [] }));
      list.raw.push(m[3]);
      list.items.push(inline(m[3]));
      continue;
    }
    if (list && /^\s/.test(raw)) { const k = list.raw.length - 1; list.raw[k] += ' ' + line; list.items[k] = inline(list.raw[k]); continue; }
    list = null;
    (para ||= []).push(line);
  }
  flush();
  return blocks.map(({ raw, ...b }) => b);
}
