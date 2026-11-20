// first-start.js -- paw-cdot: main.js asks this after the setup screen and before the app. The screen (FirstStart.svelte)
// owns the window when the runtime has to be downloaded, or on a first start whose needed models are missing (asked once:
// models.setupDone); it reloads the page when done, so the app always starts on a settled folder.
import { mount } from 'svelte';
import { Settings } from '../../app/settings.svelte.js';
import { models, refresh, needsRuntime } from './store.svelte.js';
import FirstStart from './FirstStart.svelte';

/** true: the app may start now; false: the screen owns the window. */
export async function firstStartDone({ backend, storage }, target = document.getElementById('app')) {
  const app = { backend, settings: new Settings(storage) };
  try {
    if (!(await refresh(app)) || !models.info) return true;
  } catch { return true; }
  const runtime = needsRuntime(app);
  if (!runtime && (models.info.fake || models.ready || app.settings.get('models.setupDone'))) return true;
  document.body.classList.add('kit-root');
  target.replaceChildren();
  mount(FirstStart, { target, props: { app, runtime } });
  return false;
}
