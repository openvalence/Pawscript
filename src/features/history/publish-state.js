// publish-state.js -- "v3 published · 14 edits since" (paw-up1r stage 2): the published version and the undo steps made
// after it (the applied ones: undoing back to the published state counts none). Pure over app.project / app.history.

/** -> {version, edits, adopted, text} | {version: 0, text: 'Not published'} | null (no document / nothing to publish) */
export function publishState(app) {
  const P = app?.project, pub = P?.published;
  if (!P?.hasDoc) return null;
  if (!pub) return Object.values(app.doc.axes || {}).some((s) => s?.length) ? { version: 0, edits: 0, text: 'Not published' } : null;
  const edits = (app.history.entries || []).filter((e) => e.applied && e.time > pub.at).length;
  return { version: pub.version, edits, adopted: !!pub.adopted, text: `v${pub.version} published${edits ? ` · ${edits} edit${edits === 1 ? '' : 's'} since` : ''}` };
}
