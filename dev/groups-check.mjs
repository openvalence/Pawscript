// node dev/groups-check.mjs [port] [shot.png] [dpr]  -- the Groups tool (paw-kkb, characters paw-emy, paint first /
// assign after paw-1mo) on dev/tracking.html?video=1 (the real overlay layer). The tool never moves the playhead:
// Tab opens on the frame on screen (a shot's first frame after a hard cut stamps inside that shot), painting, undo and
// closing leave the time alone, off the groups' frame it offers go there / move them here. The brush ring is on the
// cursor canvas at the pointer, its middle circle where the painted edge lands. Paint three blobs without choosing
// anything (three unassigned groups; a stroke starting on one adds to it; Ctrl+drag makes a new one on top), assign all
// three with the keyboard (Assign all, type, Enter), drag a palette label onto a group (reassign) and a group's label
// onto another (they trade), Shift erases, Alt+click picks, G / S move / scale, X deletes, patches split, Suggest runs
// on the frame on screen, Track sends only assigned groups (with who / part / side), warns about the unassigned ones
// and closes the tool. Vite on the given port (default 5200).
import { chromium } from 'playwright';
const port = process.argv[2] || '5200', shot = process.argv[3] || 'groups-check.png', dpr = +(process.argv[4] || 1);
const b = await chromium.launch({ channel: 'msedge', headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: dpr });
let errors = 0;
p.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console]', m.text()); } });
p.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message); });
await p.goto(`http://localhost:${port}/dev/tracking.html?video=1`);
await p.waitForTimeout(1500);
let fails = 0;
const ok = (c, msg) => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const ev = (f, a) => p.evaluate(f, a);
const wait = (ms = 120) => p.waitForTimeout(ms);
const png = (tag) => shot.replace(/\.png$/, `-${tag}.png`);
const time = () => ev(() => window.H.app.player.timeMs);
const groups = () => ev(() => window.H.groups.groups.map((g) => ({ name: g.name, who: g.who, part: g.part, side: g.side, t: g.t_ms, poly: g.poly, off: g.off })));
const names = async () => (await groups()).map((g) => g.name);
// scene 1 [0, 10010.01); scene 2: a shot [10010.01, 20020.02) and, after a HARD cut (joined, no camera split), a shot
// [20020.02, 40040.04) (two takes); scene 3 the rest. Float cut times like a real cut list.
await ev(() => { const H = window.H; H.app.doc.scenes = [{ start_ms: 0, end_ms: 10010.01 }, { start_ms: 10010.01, end_ms: 20020.02 }, { start_ms: 20020.02, end_ms: 40040.04, join: true }, { start_ms: 40040.04, end_ms: 60027 }]; H.tr.selectTracker('fake.pinned'); H.app.player.seek(20020.02); });
await wait(400);
const t0 = await time();
const gWin = await ev(() => window.H.app.commands.winner('G'));
await p.keyboard.press('g'); await wait(300);
ok(!(await ev(() => window.H.groups.on)), `G with the tool closed does not open it (G is move, always: it goes to ${gWin || 'nothing'})`);
await p.keyboard.press('Escape'); await wait(200);   // whatever G started (a grab of selected points) is cancelled
await p.keyboard.press('Tab');
await wait(300);
ok(await ev(() => window.H.groups.on) && Math.abs((await time()) - t0) < 0.5, `Tab opens the tool where the playhead is (time ${t0.toFixed(2)} -> ${(await time()).toFixed(2)}: not moved)`);
ok(await ev(() => window.H.groups.scene === 2 && window.H.groups.onFrame), 'on the first frame of the shot after the hard cut, the tool is on that shot');
ok(await p.locator('[data-testid="groups-tools"]').isVisible() && await ev(() => window.H.app.player.overlays.tool === 'tracking.groups'), 'the toolbar shows and the tool owns the pointer');
const box = await ev(() => { const r = document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const at = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
// the brush ring: on the cursor canvas, at the pointer, radius = the brush (where the stroke's edge lands)
const ringPx = (x, y) => ev(([x, y]) => {
  const cv = document.querySelector('canvas.gcursor'), r = cv.getBoundingClientRect(), d = cv.width / r.width;
  const R = window.H.groups.radius * document.querySelector('[data-testid="video-stage"] video').getBoundingClientRect().height;
  const g = cv.getContext('2d'), a = (px, py) => g.getImageData(Math.round((px - r.left) * d), Math.round((py - r.top) * d), 1, 1).data[3];
  let on = 0;
  for (let k = 0; k < 16; k++) { const t = (k / 16) * 2 * Math.PI; if (a(x + R * Math.cos(t), y + R * Math.sin(t)) > 0) on++; }
  return { on, mid: a(x + R * 0.5, y), R };
}, [x, y]);
await p.mouse.move(...at(0.7, 0.62)); await p.mouse.move(...at(0.72, 0.64)); await wait();
const ring = await ringPx(...at(0.72, 0.64));
ok(ring.on >= 14 && ring.mid === 0, `hover: the brush ring at the pointer (${ring.on}/16 on its circle, r ${ring.R.toFixed(1)} px, empty between rings)`);
await p.keyboard.press(']'); await wait();
const ring2 = await ringPx(...at(0.72, 0.64));
await p.mouse.wheel(0, 200); await wait();
const ring3 = await ringPx(...at(0.72, 0.64));
ok(ring2.R > ring.R && ring2.on >= 14 && ring3.R < ring2.R && ring3.on >= 14, `] grows it, the wheel shrinks it, live (r ${ring.R.toFixed(1)} -> ${ring2.R.toFixed(1)} -> ${ring3.R.toFixed(1)} px)`);
await p.keyboard.press('[');
// paint first: three blobs, nothing chosen
const blob = async (x, y, mods = []) => { for (const m of mods) await p.keyboard.down(m); await p.mouse.move(...at(x, y)); await p.mouse.down(); for (let k = 1; k <= 6; k++) await p.mouse.move(...at(x + 0.01 * k, y + 0.012 * k)); await p.mouse.up(); for (const m of mods) await p.keyboard.up(m); await wait(80); };
await blob(0.45, 0.5); await blob(0.62, 0.42); await blob(0.8, 0.68);   // (clear of the toolbar in the top-left corner)
let gs = await groups();
ok(gs.length === 3 && gs.every((g) => /^unassigned_\d$/.test(g.name) && !g.who), 'three strokes, nothing chosen: three unassigned groups ' + gs.map((g) => g.name).join(', '));
ok(gs.every((g) => g.t === 20021), `stamped on the frame on screen, inside the shot after the cut (t_ms ${gs[0].t}, the shot starts 20020.02)`);
ok(await ev(() => window.H.app.history.undoLabel === 'Groups: paint unassigned_3'), 'one undo step per stroke');
const r1 = (await groups())[0].poly;
await blob(0.46, 0.52);
ok((await groups()).length === 3 && JSON.stringify((await groups())[0].poly) !== JSON.stringify(r1), 'a stroke starting on a group adds to it (still three)');
await blob(0.46, 0.53, ['Control']);
ok((await groups()).length === 4, 'Ctrl+drag on top of a group makes a new one');
await ev(() => window.H.app.undo());
ok((await groups()).length === 3 && Math.abs((await time()) - t0) < 0.5, 'undo takes it back; the playhead stays');
// the single click: a whole disc, the brush's size
await ev(() => window.H.app.undo());   // (the "adds to it" stroke)
// assign all, keyboard only
await p.mouse.move(...at(0.05, 0.9)); await wait();
await p.click('[data-testid="groups-list-open"]'); await wait(300);   // 6543984 (paw-i5qx): Assign all sits in the list popover
await p.getByRole('button', { name: 'Assign all' }).click(); await wait();
ok(await p.locator('[data-testid="groups-picker"]').isVisible(), 'Assign all opens the picker on the first unassigned group');
await p.mouse.move(...at(0.05, 0.95)); await wait();
await p.screenshot({ path: png('picker') });
await p.keyboard.type('pe'); await p.keyboard.press('Enter'); await wait();
await p.keyboard.press('2'); await p.keyboard.type('hi'); await p.keyboard.press('Enter'); await wait();
await p.keyboard.type('lh'); await p.keyboard.press('Enter'); await wait();
gs = await groups();
ok(gs.map((g) => g.name).join() === 'c1_penis,c2_hips,c2_hand_l' && gs[2].side === 'l' && !(await p.locator('[data-testid="groups-picker"]').count()), 'pe Enter, 2 hi Enter, lh Enter: Bottom penis, Top hips, Top L hand; the pass ends: ' + gs.map((g) => g.name).join(', '));
ok(await ev(() => window.H.app.history.undoLabel?.startsWith('Groups: assign')), 'each assignment one undo step');
await p.screenshot({ path: png('assigned') });
// drag a part label onto a group: the Bottom tail onto Top L hand. 6543984 (paw-i5qx): no palette; the label comes off the
// assign picker's figure (opened on Bottom penis, left of the target so it does not cover it; its own group left alone)
await p.mouse.click(...at(0.45, 0.5), { button: 'right' }); await wait();
await p.getByRole('button', { name: 'Bottom', exact: true }).click(); await wait();
// a point of a figure region no other region covers (hit boxes overlap: the tail's the forearm's)
const partPt = (part, side = '') => ev(([part, side]) => { const r = document.querySelector(`[data-testid="body-figure"] [data-drop-part="${part}"]${side ? `[data-drop-side="${side}"]` : ''} rect.hit`).getBoundingClientRect();
  for (let fy = 0.1; fy < 1; fy += 0.1) for (let fx = 0.1; fx < 1; fx += 0.1) { const x = r.x + fx * r.width, y = r.y + fy * r.height, e = document.elementFromPoint(x, y)?.closest('[data-drop-part]'); if (e?.dataset.dropPart === part && (e.dataset.dropSide || '') === side) return [x, y]; }
  return null; }, [part, side]);
const [tx, ty] = await partPt('tail'), tb = { x: tx - 1, y: ty - 1, width: 2, height: 2 };
await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await p.mouse.down();
await p.mouse.move(tb.x + 40, tb.y + 30, { steps: 3 });
await p.mouse.move(...at(0.835, 0.72), { steps: 8 }); await wait();
ok(await ev(() => !!document.querySelector('.gghost')) , 'dragging a label: a ghost follows the pointer');
await p.screenshot({ path: png('drag') });
await p.mouse.up(); await wait();
ok((await names()).join() === 'c1_penis,c2_hips,c1_tail', 'dropped on Top L hand: it is Bottom tail now (one step) ' + (await names()).join(', '));
if (await p.locator('[data-testid="groups-picker"]').count()) { await p.keyboard.press('Escape'); await wait(); }
// drag a group's row in the list onto another group on the video: they trade (paw-c1m1: the labels are drawn inside the parts,
// no handles; the list row is the way to trade)
await p.click('[data-testid="groups-list-open"]'); await wait(300);
const rb = await p.locator('button.pick', { hasText: 'penis' }).first().boundingBox();
await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await p.mouse.down(); await p.mouse.move(rb.x + rb.width / 2 + 20, rb.y + rb.height / 2, { steps: 4 }); await p.mouse.move(...at(0.645, 0.46), { steps: 8 }); await wait(); await p.mouse.up(); await wait();
ok((await names()).join() === 'c2_hips,c1_penis,c1_tail', 'Bottom penis\'s list row dropped on Top hips: they trade ' + (await names()).join(', '));
if (await p.locator('button.pick').count()) { await p.click('[data-testid="groups-list-open"]'); await wait(300); }   // (the list closed again)
await ev(() => window.H.app.undo());
ok((await names()).join() === 'c1_penis,c2_hips,c1_tail', 'undo trades back');
// 6543984 (paw-i5qx): no palette to arm a part; balls painted first and assigned in the picker (arming is tested below, on its
// list row)
await blob(0.55, 0.8);
await p.mouse.click(...at(0.575, 0.835), { button: 'right' }); await wait();
await p.getByRole('button', { name: 'Bottom', exact: true }).click(); await wait();
await p.locator('[data-testid="groups-picker"] input').fill('ba'); await p.keyboard.press('Enter'); await wait();
ok((await names()).includes('c1_balls'), 'a new stroke, then the picker (Bottom, ba Enter): Bottom balls');
// Shift erases the group under the pointer
const before = (await groups()).find((g) => g.name === 'c1_tail').poly;
await blob(0.83, 0.7, ['Shift']);
const after = (await groups()).find((g) => g.name === 'c1_tail');
ok(after && JSON.stringify(after.poly) !== JSON.stringify(before), 'Shift erases the group under the pointer');
// Alt+click picks; G moves it; S scales it; X deletes it
await p.keyboard.down('Alt'); await p.mouse.click(...at(0.47, 0.53)); await p.keyboard.up('Alt'); await wait();
ok(await ev(() => window.H.groups.activeGroup?.name === 'c1_penis'), 'Alt+click picks the group under the pointer');
const px0 = (await groups()).find((g) => g.name === 'c1_penis').poly.reduce((s, q) => s + q[0], 0);
await p.mouse.move(...at(0.47, 0.53)); await p.keyboard.press('g'); await p.mouse.move(...at(0.52, 0.53), { steps: 5 }); await wait(100); await p.mouse.click(...at(0.52, 0.53)); await wait();
const pen = (await groups()).find((g) => g.name === 'c1_penis');
ok(pen && pen.poly.reduce((s, q) => s + q[0], 0) / pen.poly.length - px0 / pen.poly.length > 0.03 && await ev(() => window.H.groups.on), 'G grabs the active group, a click drops it moved (the tool stays open)');
await p.mouse.move(...at(0.52, 0.53)); await p.keyboard.press('s'); await p.mouse.move(...at(0.53, 0.53), { steps: 5 }); await wait(100); await p.keyboard.press('Enter'); await wait();
ok(await ev(() => window.H.app.history.undoLabel === 'Groups: scale c1_penis'), 'S scales it, Enter keeps it (one step)');
await p.keyboard.press('x'); await wait();
ok(!(await names()).includes('c1_penis') && await ev(() => !window.H.tr.axisOn), 'X deletes the active group (not the axis tool)');
await ev(() => window.H.app.undo());
// patches: a group painted in two places tracks the largest; split makes two groups
// 6543984 (paw-i5qx): Shift+click on its list row arms it (the next strokes paint into it wherever they start); the chip beside the bar disarms
if (!(await p.locator('[data-testid="groups-list"]').count())) { await p.click('[data-testid="groups-list-open"]'); await wait(300); }
await p.locator('[data-testid="groups-list"] .grp', { hasText: 'Bottom balls' }).locator('button.pick').click({ modifiers: ['Shift'] }); await wait();
ok(await ev(() => window.H.groups.armed && window.H.groups.activeGroup?.name === 'c1_balls'), 'Shift+click on its list row arms Bottom balls');
await p.keyboard.press('Escape'); await wait();   // the popover
await blob(0.1, 0.85);
ok((await names()).filter((n) => n.startsWith('c1_balls')).length === 1, 'an armed stroke far from it paints into that group');
await p.click('[data-testid="groups-armed"]'); await wait();
ok(await ev(() => !window.H.groups.armed), 'the armed chip disarms (paint first again)');
// 6543984 (paw-i5qx): the patches note lives in the notes card beside the bar (its button on the bar)
if (!(await p.locator('[data-testid="groups-patches"]').count())) { await p.click('[data-testid="groups-notes"]'); await wait(); }
ok(await p.locator('[data-testid="groups-patches"]').isVisible(), 'a second patch apart: the notes say only the largest is tracked');
await p.locator('[data-testid="groups-patches"]').getByRole('button', { name: 'Split', exact: true }).click(); await wait();   // 6543984: the button reads "Split"
ok((await names()).filter((n) => n.startsWith('c1_balls')).length === 2, 'Split into groups: c1_balls and c1_balls2 ' + (await names()).join(', '));
// right click on a group: the picker there; Esc closes it
await p.mouse.click(...at(0.645, 0.46), { button: 'right' }); await wait();
ok(await p.locator('[data-testid="groups-picker"]').isVisible(), 'right click on a group opens the picker');
await p.keyboard.press('Escape'); await wait();
ok(!(await p.locator('[data-testid="groups-picker"]').count()) && await ev(() => window.H.groups.on), 'Esc closes the picker (the tool stays)');
// the picker is a rig picker (paw-h8c): the character's body, click a part; genitals in a chip row under it
const figAt = async (vx, vy) => { const r = await p.locator('[data-testid="body-figure"] svg').boundingBox(); return [r.x + vx * r.width / 236, r.y + vy * r.height / 120]; };
await p.mouse.click(...at(0.645, 0.46), { button: 'right' }); await wait();
ok(await p.locator('[data-testid="body-figure"] g.rg.cur[data-drop-part="hips"]').count() === 1 && await p.locator('[data-testid="body-figure"] button.chip[data-drop-part="penis"]').count() === 1,
  'the picker shows the body: the group\'s own part (hips) marked, penis a chip under the figure');
const t9 = await time();
// the Groups tool's Space never plays (it scrubs; the owner's one exception to Space = play / pause): in the picker's filter it types
await ev(() => { window.__typed = ''; document.querySelector('[data-testid="groups-picker"] input').addEventListener('input', (e) => { window.__typed += e.data ?? '?'; }); });
await p.keyboard.press('Space'); await wait(400);
const played = await ev(() => window.H.app.player.playing);
ok(!played && await ev(() => window.__typed === ' ') && (await p.locator('[data-testid="groups-picker"]').count()) === 1, `Space with the picker open: typed into its filter, no play (playing ${played}, typed ${JSON.stringify(await ev(() => window.__typed))})`);
await p.keyboard.press('Backspace'); await wait(150);
await ev((t) => window.H.app.player.seek(t), t9); await wait(300);
if (!(await p.locator('[data-testid="groups-picker"]').count())) { await p.mouse.click(...at(0.645, 0.46), { button: 'right' }); await wait(); }
ok(await p.locator('[data-testid="body-figure"] button.chip.has').count() === 0 && await p.locator('[data-testid="body-figure"] g.rg.has').count() === 0, 'Top has nothing else in this shot: nothing filled');
await p.getByRole('button', { name: 'Bottom', exact: true }).click(); await wait();
ok(await p.locator('[data-testid="body-figure"] button.chip.has[data-drop-part="penis"]').count() === 1 && await p.locator('[data-testid="body-figure"] g.rg.has[data-drop-part="tail"]').count() === 1, 'Bottom: its penis and tail are filled (assigned in this shot)');
await p.getByRole('button', { name: 'Top', exact: true }).click(); await wait();
await p.mouse.click(...await figAt(118, 20)); await wait();
ok((await names()).includes('c2_head') && !(await names()).includes('c2_hips') && !(await p.locator('[data-testid="groups-picker"]').count()), 'a click on the figure\'s head: Top head, the picker closes ' + (await names()).join(', '));
await ev(() => window.H.app.undo());
// it moves by its title and stays there
await p.mouse.click(...at(0.645, 0.46), { button: 'right' }); await wait();
const pk0 = await p.locator('[data-testid="groups-picker"]').boundingBox(), ttl = await p.locator('[data-testid="groups-picker"] .what').boundingBox();
await p.mouse.move(ttl.x + 8, ttl.y + 6); await p.mouse.down(); await p.mouse.move(ttl.x - 60, ttl.y - 80, { steps: 6 }); await p.mouse.up(); await wait();
const pk1 = await p.locator('[data-testid="groups-picker"]').boundingBox();
await p.keyboard.press('Escape'); await wait();
await p.mouse.click(...at(0.3, 0.75), { button: 'right' }); await p.mouse.click(...at(0.645, 0.46), { button: 'right' }); await wait();
const pk2 = await p.locator('[data-testid="groups-picker"]').boundingBox();
ok(Math.abs(pk1.x - (pk0.x - 68)) < 3 && Math.abs(pk1.y - (pk0.y - 86)) < 3 && Math.abs(pk2.x - pk1.x) < 2 && Math.abs(pk2.y - pk1.y) < 2 && await ev(() => Array.isArray(window.H.app.settings.get('tracking.groups.pickerAt'))),
  `dragging its title moves the picker; reopened it comes back there (${pk0.x | 0},${pk0.y | 0} -> ${pk1.x | 0},${pk1.y | 0} -> ${pk2.x | 0},${pk2.y | 0})`);
// a part dragged off the figure onto a group on the video assigns that group
const cen = await ev(() => { const g = window.H.groups.groups.find((x) => x.name === 'c1_penis'); return [g.poly.reduce((s, q) => s + q[0], 0) / g.poly.length, g.poly.reduce((s, q) => s + q[1], 0) / g.poly.length]; });
const rh = await partPt('hand', 'r');   // (the figure's own geometry, figure.js: no fixed coordinates)
await p.mouse.move(...rh); await p.mouse.down(); await p.mouse.move(rh[0] - 20, rh[1] + 10, { steps: 3 }); await p.mouse.move(...at(...cen), { steps: 8 }); await wait();
ok(await ev(() => !!document.querySelector('.gghost')), 'dragging a part off the figure: the ghost follows');
await p.mouse.up(); await wait();
ok((await names()).includes('c2_hand_r') && !(await names()).includes('c1_penis') && (await names()).includes('c2_hips'), 'dropped on Bottom penis: it is Top R hand now (the picker\'s own group untouched) ' + (await names()).join(', '));
await ev(() => window.H.app.undo());
await p.locator('[data-testid="groups-picker"] .what').dblclick(); await wait();
ok(await ev(() => window.H.app.settings.get('tracking.groups.pickerAt', null) === null), 'double-clicking its title: back next to the pointer');
await p.keyboard.press('Escape'); await wait();
// off the groups' frame: notice, go there / move them here; nothing seeks by itself
await ev(() => window.H.app.player.seek(25000)); await wait(300);
// paw-o74b / 6543984: elsewhere in the take painting seeds groups on this frame; the notes card (opened by itself) says so and
// where the groups are (Go there / Move here)
const card = p.locator('[data-testid="groups-notes-card"]');
ok(await card.locator('[data-testid="groups-add-here"], [data-testid="groups-frame"]').first().isVisible() && (await card.getByRole('button', { name: 'Go there' }).count()) > 0 && Math.abs((await time()) - 25000) < 40,
  'elsewhere in the take: the notes card says where painting goes and offers Go there / Move here (no jump): ' + (await card.innerText().catch(() => '')).replace(/\s+/g, ' '));
await p.mouse.move(...at(0.5, 0.5)); await wait();
await p.screenshot({ path: png('offframe') });
await card.getByRole('button', { name: 'Move here' }).first().click(); await wait();
gs = await groups();
ok(gs.every((g) => Math.abs(g.t - 25000) < 40) && await ev(() => window.H.groups.onFrame), 'Move them here: the take\'s groups on this frame (one step)');
await ev(() => window.H.app.undo()); await wait();
await card.getByRole('button', { name: 'Go there' }).first().click(); await wait(300);
ok(Math.abs((await time()) - 20020) < 40, 'Go there: the playhead to the groups\' frame (the only seek, on a click)');
// Suggest: on the frame on screen
await p.keyboard.press('1');
await p.getByRole('button', { name: 'Suggest' }).click(); await wait(400);
ok(await ev(() => window.H.FAKE.requests.at(-1).cmd === 'suggest_groups' && window.H.FAKE.requests.at(-1).t_ms === 20021 && !('start_ms' in window.H.FAKE.requests.at(-1))), 'Suggest asks for the frame on screen, never "auto"');
await blob(0.06, 0.45);   // one more, left unassigned (clear of the toolbar and the suggested body)
await p.click('[data-testid="groups-list-open"]'); await wait(300);   // 6543984: the unassigned fold is in the list popover
ok(await ev(() => window.H.groups.unassigned.length === 1) && await p.locator('[data-testid="groups-unassigned"]').isVisible(), 'one more stroke left unassigned: the toolbar offers Assign all');
await p.keyboard.press('Escape'); await wait();   // the popover
// 6543984 (paw-i5qx): the corner-parked toolbar (drag its title, it snaps) is gone: a slim bar on the stage's left edge, no
// grip; its geometry is dev/groups-dock-check.mjs's (real window)
const tBefore = await time();
await p.mouse.move(...at(0.5, 0.6)); await wait();
await p.screenshot({ path: png('open') });
// Track: closes the tool, warns about the unassigned group, sends the assigned ones only
await ev(() => { window.H.app.doc.range = { t0: 10010.01, t1: 40040 }; window.H.tr.clearRoi(); });
await ev(() => window.H.tr.track());
await wait(900);
const req = await ev(() => window.H.FAKE.requests.filter((r) => r.cmd === 'track').at(-1));
ok(await ev(() => !window.H.groups.on), 'a track job starting closes the Groups tool');
ok(await ev(() => [...document.querySelectorAll('.k-toast, [role=status], [role=alert]')].some((e) => /not assigned/.test(e.textContent))), 'and warns: a group not assigned is not tracked');
ok(req?.groups?.length > 0 && req.groups.every((g) => g.who && !/^unassigned/.test(g.name) && !('mask' in g) && Math.abs(g.t_ms - 20021) < 2) && req.groups.some((g) => g.side === 'l' || g.part === 'balls'),
  'Track sends the assigned groups only, with who / part / side: ' + JSON.stringify(req?.groups?.map((g) => [g.name, g.who, g.part, g.side ?? null])));
ok(Math.abs(tBefore - 20020) < 40, 'the tool itself never moved the playhead');
await p.screenshot({ path: shot });
ok(errors === 0, 'no console errors');
await b.close();
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
