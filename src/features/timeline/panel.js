// panel.js -- the timeline's panels (the shell accepts an array).
import PlanPanel from './PlanPanel.svelte';
import InspectorPanel from './InspectorPanel.svelte';
import RowsPanel from './RowsPanel.svelte';

export default [
  // first in the right dock: the body for what is selected in the timeline (layout DEFAULT_BY_MODE opens on it)
  { id: 'timeline.inspector', title: 'Inspector', icon: 'sliders', dock: 'right', order: 1, modes: ['track', 'scenes', 'refine'], component: InspectorPanel },
  { id: 'timeline.plan', title: 'Plan', icon: 'layers', dock: 'right', order: 20, modes: ['refine', 'track'], component: PlanPanel },
  // paw-1w0x: no Chapters panel. paw-idb5: the bottom tray's first tab, every tab: the timeline rows to hide / show
  { id: 'timeline.rows', title: 'Rows', icon: 'list', dock: 'bottom', order: 1, component: RowsPanel },
];
