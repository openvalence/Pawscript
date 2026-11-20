// Numeric "go to" / "set" dialogs. Each is a command; the form is a tiny modal mounted straight on document.body,
// so it works whether or not any inspector panel is visible.
import { mount, unmount } from 'svelte';
import FormDialog from './FormDialog.svelte';
import { fmtTime, parseTime } from './logic.js';
import { applyBatch } from './actions.js';

let current = null;
export function openDialog(spec) {
  current?.(true);
  const host = document.createElement('div');
  document.body.appendChild(host);
  let inst = null;
  // unmount after the kit Dialog's exit transition (--t-move); `now` when a new dialog replaces this one
  const close = (now = false) => {
    if (!inst) return;
    const i = inst; inst = null; if (current === close) current = null;
    const done = () => { unmount(i); host.remove(); };
    if (now) done(); else setTimeout(done, 400);
  };
  inst = mount(FormDialog, { target: host, props: { ...spec, onclose: () => close() } });
  current = close;
  return close;
}

const fpsOf = (app) => 1000 / (app.player?.frameMs || 1000 / 30);
const time = (app, label, value, extra = {}) => ({ label, value: fmtTime(value), hint: 'm:ss.mmm · 83456 · 2.5s · f120', kind: 'time', parse: (s) => parseTime(s, { fps: fpsOf(app), base: app.player?.timeMs ?? 0 }), ...extra });
const selAts = (app) => { const d = app.doc; return d.selection?.axis === d.activeAxis ? [...d.selection.ats] : []; };

export const DIALOGS = {
  goto: (app) => openDialog({
    title: 'Go to time or frame', ok: 'Go', note: 'Prefix + or − for a jump relative to the playhead.',
    fields: [{ ...time(app, 'Time / frame', app.player?.timeMs ?? 0), key: 't' }],
    onsubmit: ({ t }) => { app.player.seek(Math.max(0, Math.min(app.durationMs ?? Infinity, t))); },
  }),
  range: (app) => {
    const r = app.doc.range, ats = selAts(app).sort((a, b) => a - b);
    const d0 = r?.t0 ?? ats[0] ?? app.player?.timeMs ?? 0, d1 = r?.t1 ?? ats[ats.length - 1] ?? d0 + 1000;
    openDialog({
      title: 'Set range start / end', ok: 'Set range',
      fields: [{ ...time(app, 'Start', d0), key: 't0' }, { ...time(app, 'End', d1), key: 't1' }],
      onsubmit: ({ t0, t1 }) => { if (t0 === t1) return 'Start and end are the same'; app.doc.range = { t0: Math.min(t0, t1), t1: Math.max(t0, t1) }; },
    });
  },
  setPos: (app) => {
    if (!selAts(app).length && !app.doc.range) return app.toast?.('Select points first', 'info');
    openDialog({ title: 'Set position of selection', ok: 'Set', note: '0 = deepest, 100 = out. Applies to the selection (or points in the range).',
      fields: [{ key: 'v', label: 'Position', value: '50', kind: 'position', hint: '0 – 100', parse: (s) => parseFloat(s) }],
      onsubmit: ({ v }) => { if (v < 0 || v > 100) return 'Position must be between 0 and 100'; applyBatch(app, 'set', v); } });
  },
  shift: (app) => {
    if (!selAts(app).length && !app.doc.range) return app.toast?.('Select points first', 'info');
    openDialog({ title: 'Shift selection in time', ok: 'Shift', note: 'Milliseconds, or frames like f3 / −f3.',
      fields: [{ key: 'ms', label: 'Shift', value: '0', kind: 'time', hint: '+250 · -33 · f2',
        parse: (s) => { const t = String(s).trim(), neg = /^[-−]/.test(t); const v = parseTime(t.replace(/^[-+−]/, ''), { fps: fpsOf(app) }); return neg ? -v : v; } }],
      onsubmit: ({ ms }) => { applyBatch(app, 'shift', ms); } });
  },
};

/** Shift the selected points so the first one lands on the playhead. */
export function moveSelectionToPlayhead(app) {
  const ats = selAts(app).sort((a, b) => a - b);
  if (!ats.length) return app.toast?.('Select points first', 'info');
  const d = Math.round(app.player.timeMs) - ats[0];
  if (!d) return;
  applyBatch(app, 'shift', d);
}

/** Make the range cover exactly the selected points. */
export function rangeFromSelection(app) {
  const ats = selAts(app).sort((a, b) => a - b);
  if (ats.length < 2) return app.toast?.('Select at least two points', 'info');
  app.doc.range = { t0: ats[0], t1: ats[ats.length - 1] };
}

/** Set the range start or end to the playhead. */
export function setRangeEdgeToPlayhead(app, edge) {
  const t = Math.round(app.player.timeMs), r = app.doc.range;
  if (!r) return;
  app.doc.range = edge === 'start' ? { t0: Math.min(t, r.t1 - 1), t1: r.t1 } : { t0: r.t0, t1: Math.max(t, r.t0 + 1) };
}
