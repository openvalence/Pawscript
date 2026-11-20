import TrackingLane from './TrackingLane.svelte';

// right under the Range bars (timeline 31.5), above Audio and the axis lanes. 181 px = 110 + what paw-idb5 freed at the bottom
// (the folded dock's rail 24, the hidden-rows strip 20, the Chapters row 26 + its splitter 1: app/layout.svelte.js FREED)
// paw-unuy: not on the Track tab: there the stroke lane is the tracker lane (lanes/LaneStack.svelte wraps it in TrackingLane), so
// this row is the Refine / Review tabs' only (hidden there by default; the bottom tray's Rows tab shows it)
export default { id: 'tracking', title: 'Tracker', order: 31.75, height: 181, modes: ['refine', 'review'], component: TrackingLane };
