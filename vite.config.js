import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// paw-frhy / paw-0tas: the build's commit and date (About, Copy bug report, the undo history's stamp)
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: new URL('.', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || commit; } catch { /* no git: a source copy */ }
const build = { commit, date: new Date().toISOString().slice(0, 10) };

export default defineConfig({
  plugins: [svelte()],
  define: { __PAWSCRIPT_VERSION__: JSON.stringify(version), __PAWSCRIPT_BUILD__: JSON.stringify(build) },   // lib/provenance.js: the version a written funscript names, the build
  build: {
    target: 'es2022',   // top-level await (src/app/plugins.js loads each feature on its own); WebView2 is evergreen Chromium
    minify: 'esbuild',
    // kit components are side-effect free (their CSS is not): lets unused kit modules drop out of the bundle
    rollupOptions: { treeshake: { moduleSideEffects: (id) => !id.includes('/src/ui/kit/') || /\.css($|\?)|type=style|\/kit\/index\.js$/.test(id) } },
  },
  server: {
    port: 5173,
    strictPort: true,
    // src-tauri/target is cargo's build dir; trackers/ is the Python sidecar (venv, models).
    watch: { ignored: ['**/src-tauri/**', '**/trackers/**', '**/target*/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
});
