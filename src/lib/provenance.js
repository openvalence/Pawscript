// provenance.js -- where a funscript came from (paw-xn04). Pure.
//
// Written: every .funscript the app writes carries `metadata.pawscript` = {app: 'Pawscript', version, written (ISO),
// project (the .pawproj's file name, no folder), how, hash, from?}; players ignore unknown metadata keys. The common
// tool fields other editors write (metadata.creator_software / creator_software_version, seen on the owner's scripts
// beside metadata.creator / title / tags / chapters / license) are set to Pawscript: the file is ours now. The
// owner's or an imported script's `creator` is never touched; an imported script's own tool / creator is kept in
// `from`. `hash` covers the actions as written, so an edit by another tool shows as a mismatch.
// A rewrite with the same actions keeps the block as it was (same text: the write is skipped, `written` = when the
// actions last changed).

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/* global __PAWSCRIPT_VERSION__ */
export const APP_VERSION = typeof __PAWSCRIPT_VERSION__ === 'string' ? __PAWSCRIPT_VERSION__ : '0';
/* global __PAWSCRIPT_BUILD__ */
/** The build (vite.config.js): {commit, date}; {commit: 'dev'} outside a vite build (node tests). */
export const APP_BUILD = typeof __PAWSCRIPT_BUILD__ === 'object' && __PAWSCRIPT_BUILD__ ? __PAWSCRIPT_BUILD__ : { commit: 'dev', date: '' };
const APP = 'Pawscript';

/** The actions array of a funscript object (funlib 2.0 keeps the stroke under channels.stroke). */
const actionsOf = (raw) => (Array.isArray(raw?.actions) ? raw.actions : Array.isArray(raw?.channels?.stroke?.actions) ? raw.channels.stroke.actions : []);

/** FNV-1a 32 over "at:pos," of the actions as they are in the file -> 8 hex. */
export function actionsHash(actions) {
  let h = 0x811c9dc5;
  for (const a of actions || []) {
    const s = `${a?.at}:${a?.pos},`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Who a file says made it, from its standard fields: {tool?, version?, creator?} | null. */
function foreignOf(md) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const tool = str(md.creator_software), version = str(md.creator_software_version), creator = str(md.creator) || str(md.author);
  if (!tool && !creator) return null;
  return { ...(tool ? { tool } : {}), ...(version ? { version } : {}), ...(creator ? { creator } : {}) };
}

/**
 * The funscript object with our block in metadata. raw: the object about to be written (serializeFunscript).
 * opts: {version, project (file name), how ({tracked?, imported?, modifiers?}), now (Date)}.
 */
export function stamp(raw, { version = APP_VERSION, project = null, how = null, now = new Date(), publish = null } = {}) {
  const md = isObj(raw.metadata) ? raw.metadata : {}, prev = isObj(md.pawscript) && md.pawscript.app === APP ? md.pawscript : null;
  const hash = actionsHash(actionsOf(raw));
  if (!publish && prev && prev.hash === hash && (prev.project ?? null) === (project ?? null) && md.creator_software === APP) return raw;
  const tool = md.creator_software === APP ? null : foreignOf(md);
  const from = prev?.from || tool || undefined;
  // paw-up1r stage 2: a Publish adds {version (the published version, 1, 2, ...), commit (its history entry), date, build}
  const block = { app: APP, version, written: now.toISOString(), ...(project ? { project } : {}), ...(how && Object.keys(how).length ? { how } : {}), hash, ...(from ? { from } : {}), ...(publish ? { publish } : {}) };
  return { ...raw, metadata: { ...md, creator_software: APP, creator_software_version: version, pawscript: block } };
}

/**
 * Where a funscript came from: {kind: 'pawscript' | 'changed' | 'foreign' | 'unknown', version?, written?, project?,
 * from?, tool?, creator?, by?}. raw: the parsed JSON object (parseFunscript().raw).
 */
export function readProvenance(raw) {
  const md = isObj(raw?.metadata) ? raw.metadata : {}, p = isObj(md.pawscript) && md.pawscript.app === APP ? md.pawscript : null;
  if (p) {
    const by = typeof md.creator_software === 'string' && md.creator_software !== APP ? md.creator_software : null;
    const same = p.hash === actionsHash(actionsOf(raw)) && !by;
    return { kind: same ? 'pawscript' : 'changed', version: p.version ?? null, written: p.written ?? null, project: p.project ?? null, from: p.from ?? null, how: p.how ?? null, publish: p.publish ?? null, ...(by ? { by } : {}) };
  }
  const f = foreignOf(md);
  return f ? { kind: 'foreign', ...f } : { kind: 'unknown' };
}

const day = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
const who = (f) => (f.tool ? `From ${f.tool}${f.version ? ' ' + f.version : ''}${f.creator ? `, by ${f.creator}` : ''}` : `By ${f.creator}`);

/** One line for a person. ctx.project: the open project's file name ("from this project" when it matches). */
export function originText(info, { project = null } = {}) {
  if (!info) return '';
  if (info.kind === 'pawscript') {
    const from = info.project ? (project && info.project.toLowerCase() === project.toLowerCase() ? ' from this project' : ` from ${info.project}`) : '';
    return `${info.publish?.version ? `Published v${info.publish.version} by` : 'Written by'} Pawscript ${info.version || ''}${info.written ? ' on ' + day(info.written) : ''}${from}`.replace(/\s+/g, ' ');
  }
  if (info.kind === 'changed') return `Written by Pawscript, changed outside since${info.by ? ` (last saved by ${info.by})` : ''}`;
  if (info.kind === 'foreign') return who(info);
  return 'Unknown origin';
}
/** Short label for a card: Pawscript | Pawscript (edited elsewhere since) | the other tool / creator | unknown origin. */
export function originLabel(info) {
  if (!info) return '';
  if (info.kind === 'pawscript') return 'Pawscript';
  if (info.kind === 'changed') return 'Pawscript (edited elsewhere since)';
  if (info.kind === 'foreign') return info.tool || info.creator;
  return 'unknown origin';
}

/**
 * What the project knows about how an axis's points came to be (the base points, before Autorange / effects):
 *   tracked   share equal (at and pos) to a point of a tracker run of this axis (Accept writes the run's own points)
 *   imported  share equal to a point of the reference copy of the script the project opened (its pinned ghost)
 *   modifiers the kinds of the live (not muted) effects on top
 * A share that cannot be known (no run / no reference copy) is left out. Hand-placed points are not told apart from
 * generated ones or fills, so there is no `hand`.
 */
export function howOf({ base = [], ghosts = [], axis = 'stroke', fx = [] } = {}) {
  const key = (p) => p.at * 128 + p.pos;
  const of = (kinds) => { const s = new Set(); for (const g of ghosts || []) if (kinds.includes(g?.source?.kind) && (g.axis ?? 'stroke') === axis) for (const p of g.script || []) s.add(key(p)); return s; };
  const run = of(['tracker', 'axes']), ref = of(['reference']), out = {}, n = base.length;
  const share = (k) => Math.round((k / n) * 1000) / 1000;
  if (n && run.size) out.tracked = share(base.filter((p) => run.has(key(p))).length);
  if (n && ref.size) out.imported = share(base.filter((p) => !run.has(key(p)) && ref.has(key(p))).length);
  const mods = [...new Set((fx || []).filter((e) => e && !e.muted && e.kind).map((e) => e.kind))];
  if (mods.length) out.modifiers = mods;
  return out;
}
