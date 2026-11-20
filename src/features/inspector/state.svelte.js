// Shared inspector state (one per window): remembered tool params, favourites, scope, last transform, quick
// actions, snippets. Persisted through app.settings. Panels and commands both go through this object.
import { OPS, opById } from './catalog.js';
import { coerceParams, defaultsFor, parseSnippets, makeSnippet, newId, SCOPES } from './logic.js';
import { applyTransform } from './actions.js';

/** Default quick actions (ids from the edit-lib catalogue). Keys are Alt-chords: free in the outline's shortcut map. */
export const DEFAULT_QUICK = [
  { id: 'invert', label: 'Invert', opId: 'invert', params: {}, keys: ['Alt+I'] },
  { id: 'simplify', label: 'Simplify', opId: 'simplify', params: {}, keys: ['Alt+S'] },
  { id: 'extremes', label: 'Extremes only', opId: 'keepExtremes', params: {}, keys: ['Alt+E'] },
  { id: 'limit', label: 'Limit speed', opId: 'capSpeed', params: {}, keys: ['Alt+L'] },
  { id: 'scale-up', label: 'Scale +10%', opId: 'scale', params: { factor: 1.1 }, keys: ['Alt+='] },
  { id: 'scale-down', label: 'Scale -10%', opId: 'scale', params: { factor: 0.9 }, keys: ['Alt+-'] },
  { id: 'shift-back', label: 'Shift -1 frame', opId: 'nudgeTime', params: { frames: -1 }, keys: ['Alt+['] },
  { id: 'shift-fwd', label: 'Shift +1 frame', opId: 'nudgeTime', params: { frames: 1 }, keys: ['Alt+]'] },
  { id: 'smooth', label: 'Smooth', opId: 'smooth', params: {}, keys: [] },
  { id: 'humanise', label: 'Humanise', opId: 'humanise', params: {}, keys: [] },
];

class Inspector {
  app = null;
  openId = $state('');            // tool currently expanded in the tools panel
  values = $state({});            // opId -> params the user explicitly set (remembered)
  scope = $state('selection');
  favs = $state([]);
  last = $state(null);            // {opId, params, scope, label}
  quick = $state([]);             // user-configurable quick actions [{id,label,opId,params,keys}]
  snippets = $state([]);
  previewOn = $state(true);
  query = $state('');

  init(app) {
    if (this.app === app) return this;
    this.app = app;
    const g = (k, d) => app.settings?.get?.(k, d) ?? d;
    this.values = g('inspector.params', {});
    this.favs = g('inspector.favorites', []);
    const sc = g('inspector.scope', 'selection');
    this.scope = SCOPES.some((s) => s.id === sc) ? sc : 'selection';   // a stored 'chapter' (paw-1w0x: gone) is the selection again, never the whole axis
    this.last = g('inspector.last', null);
    this.previewOn = g('inspector.preview', true);
    this.quick = g('inspector.quick', null) ?? DEFAULT_QUICK.map((q) => ({ ...q }));
    this.snippets = parseSnippets(g('inspector.snippets', []));
    return this;
  }
  save(key, v) { this.app?.settings?.set?.(key, $state.snapshot(v)); }

  // ---- tool parameters ----
  /** Defaults that follow the live app: the playhead param, the real frame length, the device speed limit. */
  dynamic(op) {
    const a = this.app, d = {};
    for (const p of op.params ?? []) {
      if (p.key === 'frameMs' && p.default > 0 && a.player?.frameMs) d.frameMs = Math.round(a.player.frameMs * 1000) / 1000;
      if (p.key === 'maxSpeed' && a.settings?.get?.('device.maxSpeed')) d.maxSpeed = a.settings.get('device.maxSpeed');
    }
    if (op.playhead) d[op.playhead] = Math.round(a.player?.timeMs ?? 0);
    return d;
  }
  /** Effective params: catalogue defaults < live defaults < what the user explicitly set (remembered). */
  paramsFor(op) { return coerceParams(op, { ...this.dynamic(op), ...this.values[op.id] }); }
  setParam(op, key, v) { this.values = { ...this.values, [op.id]: { ...this.values[op.id], [key]: v } }; }
  unsetParam(op, key) { const { [key]: _, ...r } = this.values[op.id] ?? {}; this.values = { ...this.values, [op.id]: r }; this.commitParams(); }
  isExplicit(op, key) { return this.values[op.id]?.[key] !== undefined; }
  commitParams() { this.save('inspector.params', this.values); }
  reset(op) { const { [op.id]: _, ...rest } = this.values; this.values = rest; this.commitParams(); return defaultsFor(op); }

  setScope(s) { this.scope = s; this.save('inspector.scope', s); }
  setPreviewOn(b) { this.previewOn = b; this.save('inspector.preview', b); }
  toggleFav(id) { this.favs = this.favs.includes(id) ? this.favs.filter((x) => x !== id) : [...this.favs, id]; this.save('inspector.favorites', this.favs); }
  /** Open a tool's form in the Transform panel (asks the shell to show the panel when it can). */
  open(id) { this.openId = id; this.query = ''; this.app?.showPanel?.('inspector.tools'); }

  /** Apply op with `params` over `scope`, remember it as "last", toast failures. */
  run(op, params = this.paramsFor(op), scope = this.scope, label) {
    const res = applyTransform(this.app, op, params, scope, label);
    if (res.ok && res.changed) {
      this.last = { opId: op.id, params: { ...params }, scope, label: label ?? op.title };
      this.save('inspector.last', this.last);
    }
    if (!res.ok || !res.changed) this.app.toast?.(res.message, res.ok ? 'info' : 'warn');
    return res;
  }
  repeatLast() {
    const l = this.last, op = l && opById(l.opId);
    if (!op) { this.app.toast?.('Nothing to repeat yet', 'info'); return null; }
    return this.run(op, l.params, l.scope, l.label);
  }

  // ---- quick actions ----
  quickOp(q) { return opById(q.opId); }
  runQuick(q) {
    const op = this.quickOp(q);
    if (!op) { this.app.toast?.(`No tool for "${q.label}"`, 'warn'); return null; }
    // remembered/live params for this op, overridden by what the quick action pins (eg factor 1.1)
    return this.run(op, { ...this.paramsFor(op), ...q.params }, this.scope, q.label);
  }
  setQuick(list) { this.quick = list; this.save('inspector.quick', list); }
  addQuick(op, params, label) { this.setQuick([...this.quick, { id: newId('q'), label: label ?? op.title, opId: op.id, params: { ...params }, keys: [] }]); }
  removeQuick(id) { this.setQuick(this.quick.filter((q) => q.id !== id)); }
  resetQuick() { this.setQuick(DEFAULT_QUICK.map((q) => ({ ...q }))); }

  // ---- snippets ----
  setSnippets(list) { this.snippets = list; this.save('inspector.snippets', list); }
  addSnippet(actions, name) {
    const s = makeSnippet(actions, name);
    if (s) this.setSnippets([s, ...this.snippets]);
    return s;
  }
}

export const inspector = new Inspector();
export { OPS };
