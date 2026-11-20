import TrackerPanel from './TrackerPanel.svelte';
import ScenesPanel from './ScenesPanel.svelte';

export default [
  { id: 'tracking', title: 'Tracking', icon: 'crosshair', dock: 'left', order: 10, modes: ['track'], component: TrackerPanel },
  // the Scenes tab's own panel (paw-ef73.1; it sat after Tracking in Track mode before): detect / describe / loop, the scene
  // list with tags and run status, the scene options
  { id: 'tracking.scenes', title: 'Actions', icon: 'film', dock: 'left', order: 11, modes: ['scenes'], component: ScenesPanel },
];
