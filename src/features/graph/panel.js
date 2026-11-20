// The graph editor as a workspace panel (discovered by the shell via import.meta.glob('features/*/panel.js')).
// Bottom dock (the largest); its Maximise button covers the workspace, Esc restores. The editor UI loads on first
// open (LazyPanel.svelte), so it stays out of the startup chunk.
import LazyPanel from './LazyPanel.svelte';

export default { id: 'graph', title: 'Graph', icon: 'layers', dock: 'bottom', order: 50, modes: ['refine', 'track'], component: LazyPanel };
