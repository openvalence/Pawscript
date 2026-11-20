// The shared store the timeline overview / status bar read. Import it, or listen to the window event.
//
//   import { reviewMarkers } from '../review/markers.svelte.js'
//   reviewMarkers.items    [{ id, axis, t0, t1, severity: 'error'|'warn'|'info', kind }]   non-ignored problems, sorted by t0
//                          (all axes in scope; filter on `axis === app.doc.activeAxis` for the active lane)
//   reviewMarkers.counts   { total, error, warn, info }                                     for badges and the status bar
//   reviewMarkers.diff     [{ id, t0, t1, what: 'extra'|'missing'|'differs' }]              compare view: where script and ghost disagree
//   reviewMarkers.selectedId  id of the problem last jumped to (highlight it)
//
// Every change also dispatches `window` CustomEvent 'pawscript:review' with detail { items, counts, diff, selectedId }.
class ReviewMarkers {
  items = $state.raw([]);
  counts = $state.raw({ total: 0, error: 0, warn: 0, info: 0 });
  diff = $state.raw([]);
  selectedId = $state(null);

  set(patch) {
    for (const k of Object.keys(patch)) this[k] = patch[k];
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pawscript:review', { detail: { items: this.items, counts: this.counts, diff: this.diff, selectedId: this.selectedId } }));
    }
  }
}

export const reviewMarkers = new ReviewMarkers();
