// The Machine panel: a 3D view of a thrust machine, the picked toy (its own mesh) and the hole, driven by the script.
import MachinePanel from './MachinePanel.svelte';

export default { id: 'machine.view', title: 'Machine', icon: 'machine', dock: 'right', order: 24, modes: ['track', 'refine', 'review'], component: MachinePanel };
