// The graph's probe as a timeline row (P on a node shows its output here, aligned with the lanes).
import ProbeLane from './ProbeLane.svelte';

export default { id: 'graph.probe', title: 'Probe', order: 47, height: 64, modes: ['track', 'refine', 'review'], component: ProbeLane };
