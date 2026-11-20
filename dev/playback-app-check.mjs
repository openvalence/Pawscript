// dev/playback-app-check.mjs -- the embedded device server in YOUR test instance (node dev/test-app.mjs start ...,
// then the CDP_* env it prints): bp_start, a short scan, the device list, a refused command, StopAll, shutdown.
// Sends no motion: the only position command goes to a device index that does not exist.
//   node dev/playback-app-check.mjs [out.png]
import { connectTestApp } from './cdp-connect.mjs';

const { browser, page } = await connectTestApp();
const ev = (f, a) => page.evaluate(f, a);
try {
  await page.waitForFunction(() => window.app?.playback, null, { timeout: 20000 });
  console.log('bridge:', await ev(() => app.playback.bridgeKind));
  await ev(() => app.playback.connect());
  console.log('after connect:', await ev(() => ({ status: app.playback.status, error: app.playback.error, scanning: app.playback.scanning })));
  await page.waitForTimeout(4000);
  console.log('devices:', JSON.stringify(await ev(() => app.playback.devices)));
  console.log('bp_devices:', JSON.stringify(await ev(() => window.__TAURI_INTERNALS__.invoke('bp_devices'))));
  console.log('bp_linear to index 99:', await ev(() => window.__TAURI_INTERNALS__.invoke('bp_linear', { index: 99, feature: 0, position: 0, ms: 100 }).then(() => 'accepted?!', (e) => 'refused: ' + e)));
  console.log('bp_stop_all:', await ev(() => window.__TAURI_INTERNALS__.invoke('bp_stop_all').then(() => 'ok', (e) => 'error: ' + e)));
  await ev(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === 'Device'); t?.click(); });
  await page.waitForTimeout(300);
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
  await ev(() => app.playback.disconnect());
  console.log('after disconnect:', await ev(() => ({ status: app.playback.status, devices: app.playback.devices.length })));
  console.log('bp_stop_all with the server down:', await ev(() => window.__TAURI_INTERNALS__.invoke('bp_stop_all').then(() => 'ok', (e) => 'error: ' + e)));
} finally {
  await browser.close();
}
