// node dev/pulse-check.mjs [port] [shot.png]  -- spurts from contractions (paw-ol3) on dev/tracking.html?video=1: the
// Groups tool's pulse glyph (an anus is a pulse group by default, balls toggles on, one undo step each), then detect
// cumshots on the orgasm-tagged scene: what it says it uses, the request (groups with pulse flags, pulse_range = the
// orgasm span), the proposals with their evidence in the tip, and the pulse signal as a lane channel on the run.
import { chromium } from 'playwright';
const port = process.argv[2] || '5200', shot = process.argv[3] || 'pulse-check.png';
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
let errors = 0, fails = 0;
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms = 150) => p.waitForTimeout(ms);
await p.goto(`http://localhost:${port}/dev/tracking.html?video=1`);
await wait(1500);
const circ = (cx, cy, r) => Array.from({ length: 12 }, (_, k) => [+(cx + r * Math.cos(k / 2)).toFixed(4), +(cy + r * Math.sin(k / 2) * 1.7).toFixed(4)]);
await ev((polys) => {
  const H = window.H;
  // the orgasm span is an Orgasm modifier now (timeline/mods.js spansOf; cum.svelte.js reads app.doc.fx), not a scene tag
  H.app.doc.fx = [{ id: 'o1', kind: 'orgasm', t0: 30000, t1: 40000, params: {} }];
  H.app.doc.scenes = [{ start_ms: 0, end_ms: 20000 }, { start_ms: 20000, end_ms: 60027, groups: [
    { name: 'c2_anus', who: 'c2', part: 'anus', poly: polys[0], t_ms: 30000, pinned: true, source: 'user' },
    { name: 'c1_balls', who: 'c1', part: 'balls', poly: polys[1], t_ms: 30000, pinned: true, source: 'user' },
    { name: 'c1_penis', who: 'c1', part: 'penis', poly: polys[2], t_ms: 30000, pinned: true, source: 'user' }] }];
  H.tr.selectTracker('fake.pinned'); H.app.player.seek(30000);
}, [circ(0.55, 0.55, 0.03), circ(0.42, 0.62, 0.05), circ(0.4, 0.45, 0.04)]);
await wait(400);
await p.keyboard.press('Tab'); await wait(400);
await p.click('[data-testid="groups-list-open"]'); await wait(300);   // 6543984 (paw-i5qx): the groups list is a popover on the bar
const chip = (name) => p.locator('[data-testid="groups-list"] .grp', { hasText: name });
const pulseBtn = (name) => chip(name).locator('button.pulse');
ok(await ev(() => window.H.groups.on) && (await chip('Top anus').count()) === 1, 'the Groups tool lists Top anus');
ok(await pulseBtn('Top anus').getAttribute('aria-pressed') === 'true', 'an anus is a pulse group by default: its glyph is on');
ok(await pulseBtn('Bottom balls').getAttribute('aria-pressed') === 'false' && (await pulseBtn('Bottom penis').count()) === 1, 'balls / penis offer the glyph, off');
// 6543984 (paw-i5qx): no Arm palette; the parts are offered by the assign picker's body figure
await ev(() => window.H.groups.openPicker(0)); await wait(200);
ok((await p.locator('[data-testid="groups-picker"] [data-drop-part="anus"]').count()) === 1, 'anus is offered by the assign picker');
await ev(() => window.H.groups.closePicker()); await wait(200);
if (!(await p.locator('[data-testid="groups-list"]').count())) { await p.click('[data-testid="groups-list-open"]'); await wait(300); }
const look = async (name) => pulseBtn(name).evaluate((e) => { const s = getComputedStyle(e); return { op: +s.opacity, color: s.color, w: e.getBoundingClientRect().width, svg: !!e.querySelector('svg') }; });
const on = await look('Top anus'), offL = await look('Bottom balls');
ok(on.svg && on.w > 8 && on.op === 1 && offL.op < 0.6, `painted: the glyph is drawn (${on.w.toFixed(0)} px), on full, off faint (opacity ${on.op} / ${offL.op})`);
ok(!(await pulseBtn('Top anus').getAttribute('title')), 'no native title on the glyph');
await pulseBtn('Bottom balls').click(); await wait();
ok(await pulseBtn('Bottom balls').getAttribute('aria-pressed') === 'true' && await ev(() => window.H.groups.groups.find((g) => g.name === 'c1_balls')?.pulse === true), 'clicking the balls glyph makes it a pulse group');
ok(await ev(() => window.H.app.history.undoLabel === 'Groups: pulse c1_balls'), 'one undo step: ' + await ev(() => window.H.app.history.undoLabel));
await p.mouse.move(10, 10); await wait();
await chip('Top anus').screenshot({ path: shot.replace(/\.png$/, '-chip.png') });
await p.locator('[data-testid="groups-list"]').screenshot({ path: shot.replace(/\.png$/, '-list.png') });
await p.keyboard.press('Escape'); await wait(); await p.keyboard.press('Tab'); await wait(300);
// a run under the scene (the pulse lane lands on it), then detect cumshots
await ev(() => window.H.tr.trackRange({ tracker: 'fake.pinned', range: { t0: 20000, t1: 60027 }, roi: { kind: 'box', x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }));
for (let k = 0; k < 40 && await ev(() => window.H.app.tasks.length); k++) await wait(250);
ok(await ev(() => window.H.tr.runs.length) > 0, 'a fake run covers the scene');
const uses = await ev(async () => { const m = await import('/src/features/timeline/cum.svelte.js'); const u = m.cumUses(window.H.app, { index: 1 }); return { text: u.text, range: u.plan.range, why: m.cumWhy(window.H.app, { index: 1 }) }; });
ok(uses.text === 'uses anus (Top), balls (Bottom) · SAM on 24 s', `detect says what it will use: "${uses.text}"`);
ok(uses.why.enabled, 'detect is on: ' + (uses.why.reason || 'enabled'));
await ev(async () => { const m = await import('/src/features/timeline/cum.svelte.js'); await m.detectCum(window.H.app, { index: 1 }); });
await wait(400);
const req = await ev(() => window.H.FAKE.requests.filter((r) => r.cmd === 'cum').at(-1));
ok(req && JSON.stringify(req.pulse_range) === '[30000,40000]' && req.start_ms === 20000 && req.end_ms === 60027, 'the request: the scene, pulse_range = the orgasm span ' + JSON.stringify(req?.pulse_range));
ok(JSON.stringify(req?.groups?.map((g) => [g.name, g.pulse])) === '[["c2_anus",true],["c1_balls",true],["c1_penis",false]]', 'groups with their pulse flags: ' + JSON.stringify(req?.groups?.map((g) => [g.name, g.pulse])));
const cum = await ev(() => window.H.app.doc.scenes[1].cum);
ok(cum?.length === 5 && cum[0].why?.[0]?.cue === 'anus (Top)', `proposals kept with their evidence, one per frame (${cum?.length}): ${JSON.stringify(cum?.[0])}`);
const tip = await ev(async () => { const m = await import('/src/lib/cum.js'); return m.cumTipText(window.H.app.doc.scenes[1].cum[0]); });
ok(/evidence: anus \(Top\) contraction 0\.70 · new fluid 0\.30/.test(tip), 'the tip shows the evidence: ' + tip.replace(/\n/g, ' | '));
const lane = await ev(async () => { const rc = await import('/src/lib/runs-channel.js'); const g = window.H.app.doc.ghosts.find((x) => x.visible && x.source?.kind === 'tracker'), r = window.H.tr.run(g.id); return { has: Object.keys(r.channels || {}).filter((c) => c.endsWith('_pulse')), chips: rc.pickerChannels(r).filter((c) => /anus|balls/.test(c)) }; });
ok(lane.has.includes('sem_c2_anus_pulse') && lane.has.includes('sem_c1_balls_pulse'), 'the pulse signals are run channels: ' + lane.has.join(', '));
ok(lane.chips.includes('sem_c2_anus_pulse'), 'and the anus chip offers its pulse as a lane: ' + lane.chips.join(', '));
const toast = await ev(() => [...document.querySelectorAll('.k-toast, [role=status], [role=alert]')].map((e) => e.textContent).join(' | '));
ok(/proposed cumshot/.test(toast) && /anus \(Top\) 5 contractions/.test(toast), 'the toast says what it found: ' + toast.slice(0, 200));
await p.screenshot({ path: shot });
ok(errors === 0, 'no console errors');
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
