// dev/cdp-connect.mjs -- the only way dev scripts attach to a running Pawscript over CDP. Refuses unless it is
// provably YOUR test instance (several agents and the owner may run instances with DevTools ports open):
//   CDP_PORT        the debugging port your instance was started with (dev/test-app.mjs prints it; no default)
//   CDP_EXPECT_URL  the page URL of your instance (your preview port)
//   CDP_TEST_ID     the id stamped into your build (VITE_TEST_ID -> window.__pawscriptTestId)
import { chromium } from 'playwright';

export async function connectTestApp() {
  const { CDP_PORT: port, CDP_EXPECT_URL: url, CDP_TEST_ID: id } = process.env;
  if (!port || !url || !id) { console.error('refusing: set CDP_PORT, CDP_EXPECT_URL and CDP_TEST_ID (node dev/test-app.mjs start prints them)'); process.exit(2); }
  if (String(port) === '9333') { console.error('refusing: 9333 is the shared default debugging port; start your own instance with dev/test-app.mjs'); process.exit(2); }
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const pages = b.contexts().flatMap((c) => c.pages()).filter((p) => p.url().startsWith(url));
  const page = pages.length === 1 ? pages[0] : null;
  const ok = page && (await page.evaluate(() => window.__pawscriptTestId).catch(() => null)) === id;
  if (!ok) {
    console.error(`refusing: port ${port} is not test instance ${id} at ${url} (pages: ${b.contexts().flatMap((c) => c.pages()).map((p) => p.url()).join(', ') || 'none'})`);
    await b.close().catch(() => {});
    process.exit(2);
  }
  return { browser: b, page };
}
