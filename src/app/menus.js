// menus.js -- the top-bar menu model from the command registry. Pure (test/app-menus.test.mjs).
//
// Each menu keeps it short: the shell's own commands and the everyday sections of the core editors (lanes, video:
// clipboard, selection, stepping, zoom) sit at the top level, ordered by section (Undo/Redo first in Edit, Open/Save
// first in File); the editors' other sections get one submenu each (Points, Nudge, ...), every other feature ONE
// submenu named after it (its sections become separators, or nested submenus when it has many). A menu named after
// a feature (Review) lists that feature at the top level. Track has its own layout (TRACK below). Everything stays in the palette.

export const MENU_ORDER = ['File', 'Edit', 'Play', 'View', 'Track', 'Review', 'Help'];
const SHELL = new Set(['project', 'app']);
const EDITORS = new Set(['lanes', 'video']);   // the core editors: their everyday sections are top level, the rest one submenu per section
const TOP_GROUPS = new Set(['open', 'save', 'close', 'history', 'clip', 'select', 'range', 'step', 'jump', 'rate', 'loop', 'zoom', 'mode', 'layout']);
const HOME = { Track: 'tracking', Review: 'review' };   // the feature a menu belongs to
// top-level sections in this order (others keep registration order after them)
const GROUP_ORDER = ['open', 'save', 'close', 'history', 'clip', 'select', 'points', 'nudge', 'transform', 'ghost', 'record', 'drag',
  'nav', 'range', 'axis', 'step', 'jump', 'rate', 'loop', 'shuttle', 'audio', 'zoom', 'mode', 'layout', 'lane', 'lanes', 'snap', 'video', 'theme', 'density', 'preview', 'about'];
const NEST_OVER = 16;   // a feature submenu with more items nests its sections
const NAMES = { timeline: 'Timeline', inspector: 'Inspector', palette: 'Keyboard', review: 'Review', tracking: 'Tracking', graph: 'Graph', assist: 'Assist', draft: 'Draft' };

// paw-u6s5: the Track menu by what you are doing (it had 66 entries at its top level): the everyday commands at the top, then
// one submenu per job; every other Track command (the rarely used, the diagnostic, other features' submenus) under Advanced.
// A Track command added later and not listed here lands in Advanced. Ids only: titles, keys and the palette are the registry's.
const TRACK_TOP = ['track.gridFrame', 'track.run', 'track.plan', 'track.cancel', 'tracking.groups', 'track.flipAtPlayhead', 'tracking.bake'];
const TRACK_SUBS = [
  ['Groups', ['tracking.groupsSuggest', 'tracking.groupsCopyFrom', 'tracking.groupsSwap', 'tracking.groupsCircle', 'tracking.groupsGrow',
    'tracking.groupsKnot', 'tracking.groupsGrowFill', 'tracking.groupsAutoFill', 'tracking.groupsLabels', 'tracking.groupsFill', 'tracking.groupsDepth', 'tracking.groupsPulse']],
  ['Direction and anchors', ['tracking.axisDraw', 'tracking.axisClear', 'track.flipToEnd', 'track.flipRange', 'track.flipRun', 'tracking.flipAxis',
    'tracking.anchorIn', 'tracking.anchorOut', 'tracking.anchorMid', 'tracking.shaftOut', 'tracking.shaftHilt',
    'assist.open', 'assist.regenerate', 'assist.reapply', 'assist.orientGhosts', 'assist.clearDecisions']],
  ['Runs, ranges and scenes', ['track.full', 'track.beside', 'track.forward', 'track.backward', 'track.both', 'tracking.retrack',
    'track.signalOverride', 'tracking.fillFromLink', 'tracking.fillDismiss', 'tracking.fillDetach', 'tracking.deriveAxes', 'tracking.addAxisLanes',
    'track.detectScenes', 'track.describeAll', 'track.describeRanges', 'track.loopScene', 'track.searchLoops', 'track.rangeToScene']],
  ['Bake and export', ['tracking.bakeRun', 'tracking.bakeAll', 'tracking.unbake', 'track.export', 'track.simplifyDetail', 'track.simplifyAccept']],
];
// in the menus of a dev build only (import.meta.env.DEV; the palette lists them everywhere): the scorecard's truth marks and
// the parked Director
export const DEV_ONLY = (c) => /^tracking\.shaft(Mark\.|Scorecard$)/.test(c.id) || c.source === 'director';

const title = (s) => NAMES[s] || (s ? s[0].toUpperCase() + s.slice(1) : 'Other');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
/** 'Plan: split segment' inside the Timeline submenu reads 'Split segment'. */
export const stripPrefix = (t) => { const m = /^[A-Z][\w ]{1,18}: (.+)$/.exec(t); return m ? cap(m[1]) : t; };

function withSeparators(cmds, toItem, label = (c) => c.title) {
  const items = [];
  let group;
  for (const c of cmds) {
    if (items.length && c.group !== group) items.push({ separator: true });
    group = c.group;
    items.push(toItem(c, label(c)));
  }
  return items;
}

/**
 * list: app.commands.list() rows; toItem(cmd, label) -> kit MenuItem. -> [{label, items}] in MENU_ORDER.
 */
export function menuModel(list, toItem, { dev = false } = {}) {
  const by = new Map();
  list.forEach((c, i) => {
    if (c.hidden || !c.menu || (!dev && DEV_ONLY(c))) return;
    if (!by.has(c.menu)) by.set(c.menu, []);
    by.get(c.menu).push({ ...c, i });
  });
  const names = [...by.keys()].sort((a, b) => ((MENU_ORDER.indexOf(a) + 1 || 99) - (MENU_ORDER.indexOf(b) + 1 || 99)));
  return names.map((name) => {
    const cmds = by.get(name);
    if (name === 'Track') return { label: name, items: trackMenu(cmds, toItem) };
    const top = name === 'Help' ? () => true : (c) => SHELL.has(c.source) || c.source === HOME[name] || (EDITORS.has(c.source) && TOP_GROUPS.has(c.group));
    const rank = (g) => { if (!g) return -1; const k = GROUP_ORDER.indexOf(g); return k < 0 ? GROUP_ORDER.length : k; };   // ungrouped (Play / pause) first
    const head = cmds.filter(top).sort((a, b) => rank(a.group) - rank(b.group) || a.i - b.i);
    const items = withSeparators(head, toItem);
    const feats = new Map();   // submenu label -> commands: an editor's other sections by section, any other feature by name
    for (const c of cmds) if (!top(c)) { const k = EDITORS.has(c.source) ? cap(c.group || c.source) : title(c.source); if (!feats.has(k)) feats.set(k, []); feats.get(k).push(c); }
    const loose = [...feats.values()].filter((fc) => fc.length <= 2).flat();   // a submenu of one or two is noise: inline them
    if (loose.length && items.length) items.push({ separator: true });
    items.push(...loose.map((c) => toItem(c, c.title)));
    if (items.length && [...feats.values()].some((fc) => fc.length > 2)) items.push({ separator: true });
    for (const [src, fc] of feats) {
      if (fc.length <= 2) continue;
      let sub;
      if (fc.length > NEST_OVER) {
        const groups = new Map();
        for (const c of fc) { const g = c.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
        sub = [];
        for (const [g, gc] of groups) {
          if (!g || gc.length < 3) sub.push(...gc.map((c) => toItem(c, stripPrefix(c.title))));
          else sub.push({ label: cap(g), items: gc.map((c) => toItem(c, stripPrefix(c.title))) });
        }
      } else sub = withSeparators(fc, toItem, (c) => stripPrefix(c.title));
      items.push({ label: src, items: sub });
    }
    return { label: name, items };
  });
}

/** The Track menu (TRACK_TOP, TRACK_SUBS, then Advanced: the rest, each other feature of three or more its own submenu). */
function trackMenu(cmds, toItem) {
  const byId = new Map(cmds.map((c) => [c.id, c])), used = new Set();
  const take = (ids) => ids.map((id) => byId.get(id)).filter((c) => c && !used.has(c.id) && used.add(c.id));
  const items = take(TRACK_TOP).map((c) => toItem(c, c.title));
  const subs = TRACK_SUBS.map(([label, ids]) => [label, take(ids)]);
  const rest = cmds.filter((c) => !used.has(c.id)), feats = new Map();
  for (const c of rest) if (c.source !== 'tracking') { if (!feats.has(c.source)) feats.set(c.source, []); feats.get(c.source).push(c); }
  const own = rest.filter((c) => c.source === 'tracking' || feats.get(c.source).length < 3);
  const adv = withSeparators(own, toItem, (c) => c.title);
  for (const [src, fc] of feats) if (fc.length >= 3) adv.push({ label: title(src), items: withSeparators(fc, toItem, (c) => stripPrefix(c.title)) });
  subs.push(['Advanced', null]);
  if (items.length) items.push({ separator: true });
  for (const [label, sc] of subs) {
    const sub = sc ? withSeparators(sc, toItem, (c) => (c.title.startsWith(label + ': ') ? stripPrefix(c.title) : c.title)) : adv;
    if (sub.length) items.push({ label, items: sub });
  }
  return items;
}
