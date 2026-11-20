import DirectorPanel from './DirectorPanel.svelte';
import { peekDirector } from './director.svelte.js';
export default { id: 'director', title: 'Director', icon: 'wand', dock: 'right', order: 16, modes: ['track', 'refine', 'review'], component: DirectorPanel,
  badge: (app) => peekDirector(app)?.queue.length || '' };
