// node dev/fix-drive.mjs [outDir]  -- drives dev/fix.html headless (own vite on :5720, Edge with CDP on :5920, the fake
// sidecar, never the app's ports): key conflicts, every fix by its key, outside points untouched, one undo step each,
// regenerate splitting the plan, re-track through the tracking feature, and a screenshot of the panel.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || '.';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'error', server: { port: 5720, strictPort: true, hmr: false, watch: null } });
await server.listen();
const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--remote-debugging-port=5920'] });
let fails = 0;
try {
  const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
  p.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  p.on('pageerror', (e) => { fails++; console.log('[pageerror]', e.message); });
  await p.goto('http://localhost:5720/dev/fix.html');
  await p.waitForFunction(() => window.H?.app);
  await p.waitForTimeout(600);
  const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
  const ev = (f, a) => p.evaluate(f, a);
  const key = async (k) => { await ev(() => document.activeElement?.blur()); await p.keyboard.press(k); await p.waitForTimeout(150); };
  // state of the active axis around a range: entries, outside points (JSON), inside points
  const snap = (r) => ev((r) => { const s = H.app.doc.axes[H.app.doc.activeAxis]; return { n: H.app.history.entries.length, idx: H.app.history.index, out: JSON.stringify(s.filter((a) => a.at < r.t0 || a.at > r.t1)), ins: s.filter((a) => a.at >= r.t0 && a.at <= r.t1), all: JSON.stringify(s), plan: JSON.stringify(H.app.doc.plan) }; }, r);
  const setRange = (r) => ev((r) => { H.app.doc.range = r; }, r);

  const conf = await ev(() => H.app.commands.conflicts({ all: true }).filter((c) => c.ids.some((id) => id.startsWith('fix.'))));
  ok(!conf.length, 'no key shared with fix.* ' + JSON.stringify(conf));
  console.log('fix keys:', JSON.stringify(await ev(() => H.app.commands.list({ enabled: false }).filter((c) => c.id.startsWith('fix.')).map((c) => c.id + '=' + c.keys.join('/')))));

  // flip by key: one entry, inside inverted, outside untouched, undo restores everything
  const R = { t0: 30000, t1: 34000 };
  await setRange(R);
  let a = await snap(R);
  await key('Alt+Shift+F');
  let z = await snap(R);
  ok(z.idx === a.idx + 1 && z.out === a.out, `flip: one undo entry (${a.idx} -> ${z.idx}), outside untouched`);
  ok(z.ins.length > 3 && z.ins.every((x) => a.ins.some((y) => y.at === x.at && y.pos === 100 - x.pos)), 'flip: every point in the range mirrored');
  await key('Control+z');
  ok((await snap(R)).all === a.all, 'flip: one Ctrl+Z restores the script');

  // scale through its dialog (key, type, Enter)
  await key('Alt+Shift+D');
  await p.waitForSelector('dialog[open] input');
  await p.fill('dialog[open] input', '0.5');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  z = await snap(R);
  ok(z.idx === a.idx + 1 && z.out === a.out, 'scale (dialog): one entry, outside untouched');
  ok(z.ins.slice(2, -2).every((x) => { const y = a.ins.find((q) => q.at === x.at); return y && Math.abs(x.pos - (100 + (y.pos - 100) * 0.5)) <= 0.5; }), 'scale: depth halved about the out end');
  await key('Control+z');

  // retime by args: inner points move, the seam points keep their times
  await ev(() => H.app.commands.run('fix.retime', { dt: 40 }));
  z = await snap(R);
  ok(z.out === a.out && z.ins[0].at === a.ins[0].at && z.ins.at(-1).at === a.ins.at(-1).at && z.ins[1].at === a.ins[1].at + 40, 'retime +40 ms: inner shifted, seams kept');
  await key('Control+z');

  // regenerate over the plan segment (sample plan pl1 at 21000..25200): split, one entry, undo reverts plan + script
  const P = { t0: 22000, t1: 24000 };
  await setRange(P);
  a = await snap(P);
  await key('Alt+Shift+G');   // the panel is in view: runs with its recipe
  z = await snap(P);
  const plan = JSON.parse(z.plan);
  ok(z.idx === a.idx + 1 && z.out === a.out && z.ins.length > 2, `regenerate in plan: one entry, outside untouched, ${z.ins.length} points inside`);
  ok(plan.length === 3 && plan[1].t0 === 22000 && plan[1].t1 === 24000 && plan[0].t1 === 22000 && plan[2].t0 === 24000, 'regenerate: plan carved ' + plan.map((s) => `${s.id}:${s.t0}-${s.t1}:${s.recipe}`).join(' '));
  await key('Control+z');
  z = await snap(P);
  ok(z.all === a.all && z.plan === a.plan, 'regenerate: one Ctrl+Z restores script and plan');
  const N = { t0: 40000, t1: 44000 };
  await setRange(N); a = await snap(N);
  await ev(() => H.app.commands.run('fix.regenerate', { recipe: 'tease' }));
  z = await snap(N);
  ok(z.idx === a.idx + 1 && z.out === a.out && z.plan === a.plan, 'regenerate without a plan segment: straight into the span, plan untouched');
  await key('Control+z');

  // the panel lists the span, its source and problems
  await setRange(R);
  await p.waitForTimeout(200);
  const txt = await p.locator('.fx').innerText();
  ok(/0:30\.000/.test(txt) && /Re-track/.test(txt) && /Retime/.test(txt), 'panel shows the range and the five fixes');
  await p.locator('.fx').screenshot({ path: `${out}/fix-panel.png` });

  // re-track: first press = Track mode, waiting for a region; a box set by code (a painted part's bounds in the app); second press tracks only the range and splices
  a = await snap(R);
  await key('Alt+Shift+T');
  await p.waitForTimeout(300);
  ok(await ev(() => H.app.mode === 'track'), 're-track step 1: Track mode, waiting for a region');
  await ev(async () => { const m = await import('/src/features/tracking/tracking.svelte.js'); m.trackingFor(H.app).roi = { kind: 'box', x: 0.3, y: 0.3, w: 0.3, h: 0.4 }; });
  await key('Alt+Shift+T');
  await p.waitForFunction(() => H.app.history.entries.at(-1)?.label?.startsWith('Fix: re-track') || H.app.mode !== 'track', null, { timeout: 30000 });
  await p.waitForTimeout(200);
  z = await snap(R);
  const last = await ev(() => ({ label: H.app.history.entries.at(-1)?.label, ghosts: H.app.doc.ghosts.filter((g) => g.source?.tag === 'fix').length, mode: H.app.mode, req: H.FAKE.requests.filter((r) => r.cmd === 'track').map((r) => [r.start_ms, r.end_ms]) }));
  ok(last.label?.startsWith('Fix: re-track') && z.idx === a.idx + 1 && z.out === a.out, `re-track: "${last.label}", one entry, outside untouched`);
  ok(last.ghosts === 1 && last.mode === 'refine', `re-track: run kept as a ghost (${last.ghosts}), back in ${last.mode} mode; tracked ${JSON.stringify(last.req)}`);
  await key('Control+z');
  ok((await snap(R)).all === a.all, 're-track: one Ctrl+Z restores the script');
  await p.screenshot({ path: `${out}/fix-app.png` });
} finally {
  await b.close();
  await server.close();
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
