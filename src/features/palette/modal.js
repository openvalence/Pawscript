import Palette from './Palette.svelte';
import Help from './Help.svelte';
import KeysModal from './KeysModal.svelte';
import QuickHost from './QuickHost.svelte';

export default [
  { id: 'palette', component: Palette },
  { id: 'palette.help', component: Help },
  { id: 'palette.keys', component: KeysModal },
  { id: 'palette.quick', component: QuickHost },   // the Quick menu's right-click entries (quick.js)
];
