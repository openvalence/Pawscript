import TrackingOverlay from './TrackingOverlay.svelte';
import GroupsOverlay from './GroupsOverlay.svelte';

export default [
  { id: 'tracking-roi', order: 20, modes: ['scenes', 'track'], component: TrackingOverlay },   // Scenes: only the describe tag boxes (Show)
  { id: 'tracking-groups', order: 21, modes: ['track'], component: GroupsOverlay },   // the Groups tool (Tab): brush masks -> polygons
];
