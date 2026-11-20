// lane.js -- the lane editor as one timeline row: every axis lane stacked inside it (axes come and go with the document).
import LaneStack from './LaneStack.svelte';

export default { id: 'lanes', title: 'Lanes', order: 50, height: 'fill', modes: ['track', 'refine', 'review'], component: LaneStack };
