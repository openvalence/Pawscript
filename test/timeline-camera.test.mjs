// Camera tags (acts.js camera category, from the sidecar's scene.camera segments), camera splits (scene.split 'camera',
// continues true: the same shot) and what the tag wires: the default signal and the why line (runs-channel.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { tagsOf, sceneTags, sceneCamera, cameraKind, toggleTag, setTagStart, hasTag, TAG_CATEGORIES } from '../src/features/timeline/acts.js';
import { splitAt } from '../src/features/timeline/scenes.js';
import { tagItems } from '../src/features/timeline/quickbar.js';
import { cleanScenes } from '../src/app/project-logic.js';
import { trackCuts } from '../src/lib/protocol.js';
import { continuations, withProposals } from '../src/lib/scenes-continue.js';
import { stitchPoints, cameraDefault, cameraNote, decisionLines, segmentLines } from '../src/lib/runs-channel.js';

const seg = (t0, t1, kind, more = {}) => ({ t0, t1, kind, ...more });
const S = (camera, tags) => ({ start_ms: 0, end_ms: 4000, camera, ...(tags ? { tags } : {}) });

test('tagsOf / sceneTags: the camera kind covering most of the scene, with or without a describe', () => {
  const cam = [seg(0, 1000, 'static'), seg(1000, 4000, 'pan', { dir: 'left', amount: 0.4 })];
  assert.equal(cameraKind(cam), 'pan');
  assert.deepEqual(tagsOf(null, cam), ['pan']);
  assert.deepEqual(tagsOf({ tags: [{ tag: 'anal_penetration', score: 0.9 }] }, cam), ['anal', 'penetration', 'pan']);
  assert.deepEqual(sceneTags(S(cam)), ['pan']);
  assert.equal(sceneCamera(S([seg(0, 4000, 'orbit', { dir: 'right' })])), 'orbit');
  assert.equal(sceneCamera(S([seg(0, 4000, 'reciprocal')])), 'reciprocal');
  assert.equal(sceneCamera(S(undefined)), null, 'no detection: no camera tag');
  assert.equal(cameraKind([seg(0, 100, 'warp')]), null, 'unknown kinds are ignored');
});

test('camera is exclusive: the user\'s pick replaces the detected one, a second pick replaces the first, removal sticks', () => {
  const s = S([seg(0, 4000, 'static')]);
  const a = { ...s, tags: toggleTag(s, 'pan') };
  assert.deepEqual(sceneTags(a), ['pan']);
  const b = { ...a, tags: toggleTag(a, 'zoom') };
  assert.deepEqual(b.tags, ['zoom']);
  assert.deepEqual(sceneTags(b), ['zoom']);
  const off = { ...s, tags: toggleTag(s, 'static') };
  assert.deepEqual(off.tags, ['-static']);
  assert.equal(sceneCamera(off), null);
  assert.deepEqual(sceneTags({ ...b, camera: [seg(0, 4000, 'handheld')] }), ['zoom'], 'survives a re-detect');
  assert.equal(setTagStart(a, 'pan', 1000), a.tags, 'camera tags carry no span');
  const v = { ...s, tags: toggleTag({ ...s, tags: toggleTag(s, 'internal') }, 'orbit') };
  assert.ok(hasTag(v, 'internal') && hasTag(v, 'orbit'), 'view and camera are separate one-tag categories');
});

test('the vocabulary: a Camera category with turntable and rides-the-stroke, and its quick-bar / menu items', () => {
  const cat = TAG_CATEGORIES.find((c) => c.id === 'camera');
  assert.ok(cat.one);
  assert.deepEqual(cat.tags.map((t) => [t.id, t.label]), [['static', 'static'], ['reciprocal', 'rides the stroke'], ['pan', 'pan'], ['zoom', 'zoom'], ['orbit', 'turntable'], ['handheld', 'handheld'], ['pov', 'POV']]);
  for (const t of cat.tags) if (t.id !== 'static') assert.ok(t.icon, t.id + ' has a lane glyph');
  const got = [], items = tagItems(S([seg(0, 4000, 'orbit')]), (id) => got.push(id), ['camera']);
  assert.deepEqual(items.filter((x) => x.section).map((x) => x.section), ['Camera']);
  const tt = items.find((x) => x.label === 'turntable (detected)');
  assert.equal(tt.checked, true);
  items.find((x) => x.label === 'pan').run();
  assert.deepEqual(got, ['pan']);
});

test('camera splits: kept by the project loader, split stays with the first half, never a tracker cut, never a cutaway', () => {
  const doc = cleanScenes([
    { start_ms: 0, end_ms: 3000, camera: [seg(0, 3000, 'static')] },
    { start_ms: 3000, end_ms: 6000, continues: true, split: 'camera', camera: [seg(3000, 6000, 'pan', { dir: 'right', amount: 0.5 })] },
    { start_ms: 6000, end_ms: 9000, camera: [seg(6000, 9000, 'static')] },
  ]);
  // scenes contain shots (paw-2zy): the camera split is a shot of the same scene (join), the same take (split)
  assert.equal(doc[1].split, 'camera'); assert.equal(doc[1].join, true); assert.equal(doc[1].continues, undefined); assert.equal(sceneCamera(doc[1]), 'pan');
  assert.equal(doc[2].join, undefined, 'a hard cut with no tags: its own scene');
  const sp = splitAt(doc, 4500);
  assert.equal(sp[1].split, 'camera'); assert.equal(sp[1].join, true);
  assert.equal(sp[2].split, undefined, 'the new cut is the user\'s');
  assert.deepEqual(trackCuts('document', doc, 0, 9000).map((c) => [c.t_ms, c.kind]), [[3000, 'soft'], [6000, 'hard']], 'the tracker runs through a camera move (a soft cut: re-seed, own normalisation)');
  assert.deepEqual(continuations(doc), [], 'no member between: no bracket, no bridge');
  assert.equal(withProposals(doc, new Set())[1].continues, undefined, 'joined shots need no proposal');
  // a camera tag is not "a tag of the user's own": a cutaway proposal is still possible across such a scene
  const three = [{ start_ms: 0, end_ms: 1000 }, { start_ms: 1000, end_ms: 2000, tags: ['pan'] }, { start_ms: 2000, end_ms: 3000 }];
  assert.equal(withProposals(three, new Set([2000]))[2].continues, 'auto');
});

test('stitching carries the level across a camera split (same shot), not across a plain cut', () => {
  const strokes = (t0, t1, lo, hi) => { const o = []; for (let t = t0 + 250, k = 0; t < t1 - 40; t += 500, k++) o.push({ at: t, pos: k % 2 ? lo : hi }); return o; };
  const P = (...p) => { const a = p.flat(); return { at: Float64Array.from(a, (q) => q.at), pos: Float64Array.from(a, (q) => q.pos) }; };
  const run = { scenes: [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000 }], channels: {} };
  const pts = P(strokes(0, 5000, 10, 50), strokes(5000, 10000, 55, 95));
  const lvl = (p) => { const r = Array.from(p.at, (at, i) => ({ at, pos: p.pos[i] })).filter((q) => q.at >= 5300); return r.reduce((s, q) => s + q.pos, 0) / r.length; };
  const doc = (more) => [{ start_ms: 0, end_ms: 5000 }, { start_ms: 5000, end_ms: 10000, ...more }];
  assert.ok(Math.abs(lvl(stitchPoints(pts, run, [], {}, { scenes: doc({ continues: true, split: 'camera' }) }).points) - 30) < 5, 'carried');
  assert.ok(Math.abs(lvl(stitchPoints(pts, run, [], {}, { scenes: doc({}) }).points) - 75) < 5, 'a real cut keeps its centre');
});

test('cameraDefault: the signal a camera tag picks; cameraNote / decisionLines: the why line', () => {
  const ch = (v) => ({ t: Float64Array.from([0, 1000, 2000, 3000]), v: Float32Array.from(v) });
  const xy = (x) => ({ [x + '_x']: ch([0.4, 0.5, 0.4, 0.5]), [x + '_y']: ch([0.5, 0.5, 0.5, 0.5]) });
  const run = { channels: { proj: ch([0, 1, 0, 1]), proj_cam: ch([0, 1, 0, 1]), who_pair_proj: ch([0, 1, 0, 1]), g1_proj: ch([0, 1, 0, 1]), pair_proj: ch([0, 1, 0, 1]) } };
  for (const k of ['pan', 'zoom', 'handheld']) assert.equal(cameraDefault(k, run, 0, 4000), 'proj_cam', k);
  assert.equal(cameraDefault('orbit', run, 0, 4000), 'who_pair_proj', 'two characters: their relative motion (paw-57dw: never pair_proj / g1_proj)');
  const thin = { channels: { ...run.channels, who_pair_proj: ch([NaN, NaN, NaN, 1]) } };
  assert.equal(cameraDefault('orbit', thin, 0, 4000), null, 'no pair on half the scene, no painted parts: the sidecar\'s pick, never proj_cam');
  const painted = { channels: { ...thin.channels, ...xy('sem_c1_hips'), ...xy('sem_c2_hips') } };
  assert.equal(cameraDefault('orbit', painted, 0, 4000), 'fused', 'painted parts: their fusion');
  assert.equal(cameraDefault('reciprocal', run, 0, 4000), 'proj', 'rides the stroke: no camera removal');
  assert.equal(cameraDefault('static', run, 0, 4000), null);
  assert.equal(cameraDefault('pan', { channels: {} }, 0, 4000), null, 'a run without the channel: the sidecar\'s pick stays');
  assert.equal(cameraNote('orbit'), 'turntable: camera removal off (default signal Bottom ↔ Top, else fused)');
  assert.match(cameraNote('reciprocal'), /cam x \/ y are stroke candidates/);
  assert.equal(decisionLines({ camera: { cam_conf: 0.2, std: 0.1 } }, 'orbit')[0], cameraNote('orbit'));
  assert.equal(decisionLines({}, null).length, 0);
});

test('v4.9 soft-cut segments: one Why line each, the camera trend removed in the pan', () => {
  const segs = [{ t0: 0, t1: 4000, kind: 'static', detrend: null, share_before: 0.8 },
    { t0: 4000, t1: 10100, kind: 'pan', detrend: 'trend', why: 'camera pan', trend: 0.87, trend_px: 38, share_before: 0.12, share_after: 0.91 },
    { t0: 10100, t1: 12000, kind: 'static', detrend: 'cam', why: 'camera travel', trend: 0.42, share_before: 0.3, share_after: 0.8 }];
  assert.deepEqual(segmentLines(segs), [
    'segment 1 (0.0–4.0 s): static · strokes 0.8 of the range',
    'segment 2 (4.0–10.1 s): pan → camera trend removed 38 px (trend; strokes 0.12 → 0.91 of the range)',
    'segment 3 (10.1–12.0 s): static → camera trend removed 42 % of the scene range (camera path, the tracker saw the camera travel; strokes 0.3 → 0.8 of the range)']);
  assert.deepEqual(decisionLines({ segments: segs }).slice(-3), segmentLines(segs));
  assert.deepEqual(segmentLines(undefined), []);
});
