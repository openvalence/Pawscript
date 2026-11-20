// feedback.js -- feedback notes (paw-dze), the pure part: the tone prefix and reading feedback.jsonl back.
// feedback.jsonl (<app local data dir>): append-only, one JSON object per line. A note:
//   {t, s, k: 'note', id, tone: 'note'|'bug'|'confusing'|'like', text, project, video, at, frame, scene, shot, sel,
//    mode, tool, focus, run, zoom, recent, screenshot: null}
// A deletion: {t, k: 'delete', id}. Field reference: docs/fix-log.md.

/** A leading ! / ? / + is the note's tone (bug / confusing / like); none = a plain note. */
export const TONES = { '!': 'bug', '?': 'confusing', '+': 'like' };
export function parseNote(text) {
  const s = String(text ?? '').trim(), tone = TONES[s[0]];
  return tone ? { tone, text: s.slice(1).trim() } : { tone: 'note', text: s };
}
/** feedback.jsonl text -> the notes still there (deletions applied), oldest first. Torn lines are skipped. */
export function parseNotes(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r?.k === 'delete') out.delete(r.id);
    else if (r?.k === 'note' && r.id) out.set(r.id, r);
  }
  return [...out.values()];
}
/** A usage event {t, k, ...} -> a short {t, k, d} for a note's context (the 15 events before it). */
export function compactEvent(e) {
  const { t, k, s: _s, ...rest } = e || {};   // eslint-disable-line no-unused-vars
  const d = Object.keys(rest).length ? JSON.stringify(rest) : '';
  return { t: new Date(t).toISOString().slice(11, 23), k, ...(d ? { d: d.length > 100 ? d.slice(0, 100) + '…' : d } : {}) };
}
