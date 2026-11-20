// The Settings panel (features/settings/SettingsPanel.svelte): every tab, right dock, after the others.
import SettingsPanel from './SettingsPanel.svelte';
export default { id: 'settings', title: 'Settings', icon: 'settings', dock: 'right', order: 90, component: SettingsPanel };
