// row-controls.js -- which Tracker-row controls the selected run gets (paw-ef73.31). Pure (test/row-controls.test.mjs).
// A shot run: its signal source, Pair, what it is measured against, the fusion pad, baseline / envelope, its range
// overrides and the per-scene flip strip. A modifier's own run (run.mod, ghost kind 'modrun'): none of those (no shot,
// link or lane takes it); which modifier it belongs to, its measure, Correct its SAM mask here (SAM runs), Track again,
// Delete.
import { modMeasure, SAM } from '../timeline/mod-runs.js';

const SHOT = ['source', 'pair', 'against', 'pad', 'baseline', 'overrides', 'flips'];
/** The control ids the Tracker row shows for run. */
export function rowControls(run) {
  if (!run?.mod) return SHOT;
  return ['modifier', 'measure', ...(run.tracker === SAM ? ['correct'] : []), 'retrack', 'delete'];
}
/** A modifier run's measure in words: 'inside · shaft' | 'area · balls' | 'scale · penis' | 'no measure'. */
export function measureText(run) {
  const mm = modMeasure(run);
  return mm ? `${mm.label} · ${mm.ch.replace(/^sem_/, '').replace(/_(in|vis|scale)$/, '')}` : 'no measure';
}
