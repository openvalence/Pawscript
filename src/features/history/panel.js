// The project history (paw-up1r stage 2): commits, publishes and automatic checkpoints, beside the undo History panel.
import EntriesPanel from './EntriesPanel.svelte';
export default { id: 'history.entries', title: 'Commits', icon: 'history', dock: 'right', order: 41, modes: ['scenes', 'track', 'refine', 'review'], component: EntriesPanel };
