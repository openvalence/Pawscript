// logic.js -- the Settings panel's model, generated from the settings schema (app/settings.svelte.js) so it can never
// drift: which rows show, how each renders, what changed, export / import / reset all, and the few settings whose change
// has to be pushed somewhere (the look, the media cache, the tracker). Pure but for applySetting (test/settings-panel.test.mjs).
import { SCHEMA, GROUPS, schemaEntries } from '../../app/settings.svelte.js';
import { applyLook } from '../../app/core-commands.js';
import { listProfiles } from '../../lib/analyze/profiles.js';
import { peekTracking } from '../tracking/tracking.svelte.js';
import { sheet } from './sheet.svelte.js';

const J = JSON.stringify;
export const FILE_KIND = 'pawscript.settings/1';

/** Does the setting differ from its default (the value the app uses, so a stored value that does not fit counts as unchanged)? */
export const isChanged = (settings, key) => !SCHEMA[key]?.auto && J(settings.get(key) ?? null) !== J(SCHEMA[key]?.default ?? null);

/** Choices that come from the running app, not the schema: the device profiles (built in + yours, with their speed limit) and
 *  the trackers the tracker listed. -> [{value, label}] | null */
export function dynamicOptions(app, key) {
  if (key === 'review.profile') return listProfiles(app.settings.get('review.profiles') || []).map((p) => ({ value: p.id, label: `${p.name} · ${p.maxSpeed}/s` }));
  if (key === 'tracking.lastTracker') {
    const cur = app.settings.get(key), list = (peekTracking(app)?.trackers || []).map((t) => ({ value: t.id, label: t.name || t.id }));
    return [{ value: '', label: 'Default' }, ...list, ...(cur && !list.some((o) => o.value === cur) ? [{ value: cur, label: cur }] : [])];
  }
  return null;
}

/** The control a row renders: 'switch' | 'segmented' | 'select' | 'number' | 'text' | 'folder' | 'folders' | 'readonly'. */
export function controlOf(e, options = e.options) {
  if (e.readonly) return 'readonly';
  if (options) return options.length <= 3 && options.reduce((n, o) => n + String(o.label).length, 0) <= 24 ? 'segmented' : 'select';   // a long segmented one takes its own line (the panel's .wide)
  if (e.type === 'boolean') return 'switch';
  if (e.type === 'number') return 'number';
  if (e.type === 'string') return e.folder ? 'folder' : 'text';
  if (e.type === 'array' && e.folder) return 'folders';
  return 'readonly';   // an object or list held as state: shown as a summary, with its reset
}

/** The rows to show: preferences (internal ones only with advanced on) whose label, doc or key holds the query. */
export function visibleEntries({ query = '', advanced = false, entries = schemaEntries() } = {}) {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => (advanced || !e.internal) && (!q || [e.label, e.doc, e.key].some((s) => String(s || '').toLowerCase().includes(q))));
}
/** entries -> [{group, items}] in GROUPS order, empty groups left out. */
export const grouped = (entries) => GROUPS.map((group) => ({ group, items: entries.filter((e) => e.group === group) })).filter((g) => g.items.length);
/** paw-cdot: `group` in its GROUPS place even with no rows (a group whose body is its own list, Models), when `show`. */
export function withGroup(groups, group, show) {
  if (!show || groups.some((g) => g.group === group)) return groups;
  const at = GROUPS.indexOf(group), i = groups.findIndex((g) => GROUPS.indexOf(g.group) > at);
  const out = [...groups];
  out.splice(i < 0 ? out.length : i, 0, { group, items: [] });
  return out;
}

/** A held value as one short line (the read-only rows). */
export function summary(v) {
  if (v == null) return 'Not set';
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'Empty';
  if (typeof v === 'object') { const n = Object.keys(v).length; return n ? `${n} entr${n === 1 ? 'y' : 'ies'}` : 'Empty'; }
  return String(v);
}

/** The settings file's text: every stored key (unknown ones too: a newer build's survive a round trip). */
export const exportText = (settings) => J({ kind: FILE_KIND, values: settings.values }, null, 2) + '\n';
/** A settings file's text -> {values, skipped: [key]}: what fits the schema (a key it does not list is kept as is). Throws
 *  on text that is not a settings file. */
export function parseImport(text, settings) {
  const o = JSON.parse(text);
  const vals = o && typeof o === 'object' && !Array.isArray(o) ? (o.kind === FILE_KIND && o.values && typeof o.values === 'object' ? o.values : o) : null;
  if (!vals || Array.isArray(vals)) throw new Error('not a settings file');
  const values = {}, skipped = [];
  for (const [k, v] of Object.entries(vals)) (settings.accepts(k, v) ? (values[k] = v) : skipped.push(k));
  return { values, skipped };
}
/** What Reset all clears: the stored preferences (internal state, layout, recent lists and keys the schema does not list stay). */
export const resettable = (settings) => Object.keys(settings.values).filter((k) => SCHEMA[k] && !SCHEMA[k].internal && !SCHEMA[k].auto);

/** Push a changed setting where it is held outside the settings (the panel, import and Reset all call it; the commands that
 *  already write these keys apply them themselves). */
export function applySetting(app, key) {
  const v = app.settings.get(key);
  if (key === 'ui.theme' || key === 'ui.density') applyLook(app);
  else if (key === 'media.cacheGb') app.player?.setCacheLimit?.(v);
  else if (key === 'video.scrubCache' && v) app.player?.buildScrubCache?.();
  else if (key === 'tracking.lastTracker' || key === 'tracking.model' || key === 'tracking.boxPoints') peekTracking(app)?.applyPrefs?.(key);
}

/** The Settings panel opened at a setting's row (paw-m3b6: the palette's "Setting: …" row, a Prop's Show in Settings, a Quick menu
 *  row): searched to its label, Show advanced on for an internal one; with no document open, over the Projects page. */
export function openSettingAt(app, key) {
  sheet.find = { key, app };
  if (app.tabs?.home && !app.tabs.hidden) { sheet.open = true; return; }
  if (app.tabs?.home && app.tabs.hidden) app.tabs.show(app.tabId);
  app.showPanel('settings');
}
/** A boolean setting flipped (palette, Quick menu), said in a quiet toast. -> the new value */
export function toggleSetting(app, key) {
  const on = app.settings.get(key) !== true;
  app.settings.set(key, on);
  applySetting(app, key);
  app.toast?.(`${SCHEMA[key]?.label || key}: ${on ? 'on' : 'off'}`, 'quiet');
  return on;
}
