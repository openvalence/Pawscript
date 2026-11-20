// Status-bar item (needs a shell plug-in point: src/features/*/status.js -> {id, order, component}, receiving {app}).
import AssistChip from './AssistChip.svelte';
export default { id: 'assist', order: 50, component: AssistChip };
