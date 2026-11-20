// drop.js -- paw-cdot: files dropped on the Models list (Settings > Models, the first-start screen) are model files the
// user brings, not videos to open: within a row, for that row's model; elsewhere on the list, by their names.
import { importFiles } from './store.svelte.js';

/** payload: Tauri's drag-drop {paths, position (physical pixels)} -> true when the list took the drop. */
export function dropOnModels(app, { paths, position } = {}) {
  if (typeof document === 'undefined' || !position || !paths?.length || !app) return false;
  const r = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(position.x / r, position.y / r);
  if (!el?.closest?.('[data-models-drop]')) return false;
  importFiles(app, paths, el.closest('[data-model-id]')?.dataset.modelId || null);
  return true;
}
