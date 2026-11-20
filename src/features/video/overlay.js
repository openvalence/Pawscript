import PosBar from './PosBar.svelte';
import Sr6View from './Sr6View.svelte';

// the position bar (paw-rtby): every tab. Ordered after the tracking overlays (20, 21) so its hit strip sits over their
// editing canvas: a press on the bar is the bar's while the ROI / pair tools idle (PosBar decides when it steps aside)
export default [
  { id: 'video-posbar', order: 30, component: PosBar },
  { id: 'video-sr6', order: 31, component: Sr6View },   // paw-jyde.2: the six-axis preview (a movable box), off by default
];
