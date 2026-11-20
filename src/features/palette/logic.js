// logic.js -- pure helpers for the palette, the help overlay and the keybinding editor (test/palette-logic.test.mjs).

import { conflicts as findConflicts, fmtKeys } from '../../app/keymap.js';
import { modeOf } from '../../app/modes.js';
import { leaves } from '../../app/areas.js';
import { HERE, placeOf } from './here.js';
import { rank } from './fuzzy.js';

/** Top-bar menu order; commands with another menu follow in first-seen order, those without one go to 'Other'. */
export const MENUS = ['File', 'Edit', 'Play', 'View', 'Track', 'Review', 'Help'];

/**
 * Commands -> [{menu, items}] in menu order. Inside a menu, items of one `group` are kept together (groups in
 * first-seen order, items in registration order), so a divider can go between groups.
 */
export function groupByMenu(list) {
  const by = new Map();
  for (const c of list) {
    const m = c.menu || 'Other';
    if (!by.has(m)) by.set(m, []);
    by.get(m).push(c);
  }
  const rank = (m) => (MENUS.includes(m) ? MENUS.indexOf(m) : m === 'Other' ? 1e9 : MENUS.length);
  return [...by].sort(([a], [b]) => rank(a) - rank(b)).map(([menu, items]) => {
    const groups = [...new Set(items.map((c) => c.group || ''))];
    return { menu, items: groups.flatMap((g) => items.filter((c) => (c.group || '') === g)) };
  });
}

/** What the palette matches a command against: title, menu, id, then its aliases (paw-hyof: 'checkpoint' -> Commits). */
export const commandFields = (c) => [c.title, c.menu, c.id, (c.aliases || []).join(' ')];

// ---- paw-m3b6: contextual ranking, settings and panels as results (test/palette-context.test.mjs) ----

/** Where the palette was opened: place (the stage tab, or 'home'), the focused timeline row, the kind of area under the
 *  pointer ('video' | 'timeline' | the shown panel's id), the active pointer tool. Reads the app, changes nothing. */
export function paletteContext(app, row = null) {
  let area = null;
  try {
    const L = app.layout, leaf = L?.hover ? leaves(L.tree).find((l) => l.id === L.hover) : null;
    area = leaf ? leaf.kind || L.active(leaf)?.id || null : null;
  } catch { /* no layout (the project page): no area */ }
  return { place: placeOf(app), row: row || null, area, tool: app.player?.overlays?.tool || null };
}

// which id segments / features belong to a tab, a timeline row, an area: derived from ids, not tagged per command
const MODE_WORDS = { home: ['tabs', 'file'], scenes: ['scene', 'shot', 'acts', 'key'], track: ['track', 'tracking'], refine: ['lanes', 'edit'], review: ['review'] };
const ROW_WORDS = { scenes: ['scene', 'shot', 'acts', 'key', 'loops', 'transitions'], fx: ['fx', 'mod', 'cum'], ruler: ['zoom'], tracking: ['tracking', 'track'] };
const AREA_WORDS = { timeline: ['timeline', 'lanes'], video: ['video', 'tracking'] };
const hereIds = (place) => new Set((HERE[place] || []).flatMap(([ids]) => (typeof ids === 'string' || Array.isArray(ids) ? [ids].flat() : [])));

/** A command's lift from where the palette was opened, 0..12 (a fuzzy tier is 100 wide: context orders near-equal matches,
 *  it never lifts a worse match over a better one): in HERE for this tab, of the focused row, of the active tool, of the area
 *  under the pointer, of this tab's feature. */
export function contextBoost(c, ctx, here = hereIds(ctx?.place)) {
  if (!ctx || !c.id) return 0;
  const seg = new Set([...c.id.split('.'), c.source || '']), any = (ws) => ws.some((w) => seg.has(w));
  const areaWord = ctx.area ? String(ctx.area).split('.')[0] : null;
  let b = 0;
  if (here.has(c.id)) b += 6;
  if (ctx.row && any(ROW_WORDS[ctx.row] || [ctx.row])) b += 6;
  if (ctx.tool && c.id.startsWith(ctx.tool)) b += 6;
  if (areaWord && any(AREA_WORDS[areaWord] || [areaWord])) b += 3;
  if (any(MODE_WORDS[ctx.place] || [])) b += 3;
  return Math.min(b, 12);
}

/** A setting's value as the palette shows it: On / Off, the choice's label, the number with its unit. */
export function valueText(e, v) {
  if (e.private) return v == null ? 'Not set' : 'Set';
  if (e.type === 'boolean') return v === true ? 'On' : 'Off';
  const o = e.options?.find((x) => x.value === v);
  if (o) return String(o.label);
  if (v == null || v === '') return 'Not set';
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return 'Set';
  return `${v}${e.unit ? ' ' + e.unit : ''}`;
}
/** The settings the palette lists (the panel's rows without Show advanced): entries = schemaEntries(), get(key). */
export const settingItems = (entries, get) => entries.filter((e) => !e.internal).map((e) => ({ kind: 'setting', id: 'setting:' + e.key, key: e.key, label: e.label, toggle: e.type === 'boolean' && !e.readonly, title: `Setting: ${e.label} (${valueText(e, get(e.key))})`, doc: e.doc || '' }));
/** The dock panels the palette lists: app.panels. */
export const panelItems = (panels) => panels.map((p) => ({ kind: 'panel', id: 'panel:' + p.id, panel: p.id, title: `Panel: ${p.title || p.id}`, icon: p.icon }));
const itemFields = (x) => (x.kind === 'setting' ? [x.title, 'Settings', x.key, x.doc] : x.kind === 'panel' ? [x.title, 'Panel', x.panel] : commandFields(x));

/** The palette's results for a typed query: commands (list() rows), then settings and panels, by fuzzy score; near-equal
 *  matches go to the enabled command, then to what fits ctx; a setting or panel stays under a command of the same score. */
export function rankResults(items, text, { recent = [], ctx = null } = {}) {
  const here = hereIds(ctx?.place);
  const boost = (x) => (x.kind ? -12 : contextBoost(x, ctx, here) - (x.enabled === false ? 10 : 0));
  return rank(items, text, { fields: itemFields, recent, boost });
}

/**
 * The palette's prefix modes: '>' commands (the default), ':' go to a time (paw-qbvj: no '@', bookmarks have no UI).
 * -> {mode: 'commands'|'time', text}
 */
export function splitMode(query) {
  const q = String(query);
  const m = { '>': 'commands', ':': 'time' }[q.trimStart()[0]];
  return m ? { mode: m, text: q.trimStart().slice(1).trim() } : { mode: 'commands', text: q.trim() };
}

/**
 * A typed time -> {ms, rel} or null. rel: 0 absolute, +1 / -1 relative to the playhead.
 * '1:23.5' '1:02:03' (h:m:s) '83s' '83' (seconds) '500ms' '2m' '1h' '+5' '-1.5s'
 */
export function parseTime(s) {
  const m = /^([+-])?\s*(.*)$/.exec(String(s).trim().toLowerCase());
  const rel = m[1] === '-' ? -1 : m[1] === '+' ? 1 : 0, body = m[2];
  let r = /^(?:(\d+):)?(\d+):(\d+(?:\.\d*)?)$/.exec(body);
  if (r) return { ms: Math.round(((+r[1] || 0) * 3600 + +r[2] * 60 + +r[3]) * 1000), rel };
  r = /^(\d+(?:\.\d*)?|\.\d+)\s*(ms|s|sec|m|min|h)?$/.exec(body);
  if (!r) return null;
  const mult = { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000 }[r[2] || 's'];
  return { ms: Math.round(+r[1] * mult), rel };
}

/** Where a parsed time lands: clamped to [0, durationMs]. */
export function resolveTime({ ms, rel }, nowMs, durationMs) {
  const t = rel ? nowMs + rel * ms : ms;
  return Math.max(0, Math.min(durationMs, Math.round(t)));
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * A command's keys after replacing binding i with `keys` (i === current.length appends; keys null/'' removes
 * binding i). Duplicates drop. Returns null when the result is the defaults again (= reset, not an override).
 */
export function nextKeys(current, defaults, i, keys) {
  const out = [...current];
  if (keys) out.splice(i, 1, keys);
  else out.splice(i, 1);
  const uniq = [...new Set(out)];
  return sameSet(uniq, defaults) ? null : uniq;
}

/** app.commands.conflicts() -> Map id -> [conflict] (each conflict listed under every id it involves). */
export function conflictsById(list) {
  const m = new Map();
  for (const c of list) for (const id of new Set(c.ids)) {
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(c);
  }
  return m;
}

/**
 * One line about conflict c, from the point of view of command `id` (whose effective keys are `mine`).
 * title(id) -> display title.
 */
export function describeConflict(c, id, mine, title = (x) => x) {
  const others = [...new Set(c.ids.filter((x) => x !== id))].map(title).join(', ');
  if (c.kind === 'same') return `${fmtKeys(c.keys)} is also bound to ${others}`;
  if (c.kind === 'shared') return `${fmtKeys(c.keys)} is shared with ${others} (each only when it applies; the first that applies runs)`;
  if (mine.includes(c.keys)) return `${fmtKeys(c.keys)} waits for a second key: ${fmtKeys(c.longer)} is ${others}`;
  return `${fmtKeys(c.longer)} starts with ${fmtKeys(c.keys)}, which is ${others}`;
}

/**
 * Conflicts a candidate binding would cause: bindings [[id, keys], ...] with command `id`'s binding at
 * `slot` (its index among that command's keys; -1 = a new one) replaced by `keys`. Only the conflicts that
 * involve the candidate are returned.
 */
export function previewConflicts(bindings, id, slot, keys) {
  let k = 0;
  const next = bindings.filter(([bid]) => bid !== id || k++ !== slot);
  next.push([id, keys]);
  return findConflicts(next).filter((c) => c.ids.includes(id) && (c.keys === keys || c.longer === keys));
}

// ---- the Quick menu (quick.js): one list of command ids per stage tab, and 'home' for the project page ----
// Stored as settings 'quick.lists' = {scenes: [ids], track: [...], refine, review, home}. An id the registry does not know (a
// feature that did not load, a removed command) is kept where it is but never shown; an edit keeps it, after the known ones.

/** Which list applies: the project page has its own; a stage tab its mode (an old or unknown mode as modes.js reads it). */
export const quickKey = (home, mode) => (home ? 'home' : modeOf(mode));

/** The stored ids of list `key`: strings only, each once; a missing or malformed list is empty. */
export function quickIds(lists, key) {
  const l = lists && typeof lists === 'object' ? lists[key] : null;
  return Array.isArray(l) ? [...new Set(l.filter((x) => typeof x === 'string' && x))] : [];
}

/** lists with list `key` edited: f(the ids `known` admits) -> new ids; unknown ids stay, after them. -> a new lists object. */
export function quickEdit(lists, key, known, f) {
  const ids = quickIds(lists, key), seen = ids.filter(known);
  return { ...(lists && typeof lists === 'object' && !Array.isArray(lists) ? lists : {}), [key]: [...f(seen), ...ids.filter((x) => !known(x))] };
}
export const quickAdd = (ids, id) => (ids.includes(id) ? ids : [...ids, id]);
export const quickRemove = (ids, id) => ids.filter((x) => x !== id);
/** id one place up (d -1) or down (+1); at an end, or not in the list: unchanged. */
export function quickMove(ids, id, d) {
  const i = ids.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const o = [...ids];
  [o[i], o[j]] = [o[j], o[i]];
  return o;
}
