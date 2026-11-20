// Right-hand inspector panels (discovered by the shell via import.meta.glob('features/*/panel.js')).
import SelectionPanel from './SelectionPanel.svelte';
import ToolsPanel from './ToolsPanel.svelte';
import QuickPanel from './QuickPanel.svelte';
import HistoryPanel from './HistoryPanel.svelte';
import SnippetsPanel from './SnippetsPanel.svelte';

export default [
  { id: 'inspector.quick', title: 'Quick actions', icon: 'bolt', dock: 'right', order: 5, modes: ['refine'], component: QuickPanel },
  { id: 'inspector.selection', title: 'Points', icon: 'sliders', dock: 'right', order: 10, modes: ['refine', 'track', 'review'], component: SelectionPanel },
  { id: 'inspector.tools', title: 'Transform', icon: 'wand', dock: 'right', order: 20, modes: ['refine', 'review'], component: ToolsPanel },
  { id: 'inspector.snippets', title: 'Snippets', icon: 'bookmark', dock: 'right', order: 30, modes: ['refine'], component: SnippetsPanel },
  { id: 'inspector.history', title: 'History', icon: 'history', dock: 'right', order: 40, modes: ['scenes', 'track', 'refine', 'review'], component: HistoryPanel },
];
