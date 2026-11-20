// Review-mode panels. `badge(app)` is an optional count/label for the panel tab (additive to the panel contract).
import ProblemsPanel from './ProblemsPanel.svelte';
import StatsPanel from './StatsPanel.svelte';
import ComparePanel from './ComparePanel.svelte';
import DevicePanel from './DevicePanel.svelte';
import { getReview } from './state.svelte.js';

export default [
  { id: 'review.problems', title: 'Problems', dock: 'right', order: 20, modes: ['review'], component: ProblemsPanel,
    badge: (app) => { const c = getReview(app).counts.total; return c || ''; } },
  { id: 'review.stats', title: 'Statistics', dock: 'right', order: 21, modes: ['review'], component: StatsPanel },
  { id: 'review.compare', title: 'Compare', dock: 'right', order: 22, modes: ['review'], component: ComparePanel },
  { id: 'review.device', title: 'Device and heatmap', dock: 'right', order: 23, modes: ['review'], component: DevicePanel },
];
