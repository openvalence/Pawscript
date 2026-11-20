import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axisOk, axisInfo, axisParams, axisTool } from '../src/features/tracking/axis.js';

const P = (key, def, choices = null) => ({ key, label: key, type: choices ? 'choice' : 'float', default: def, min: null, max: null, choices });
const POINTS = [P('primary', 'auto', ['auto', 'centroid_auto', 'proj', 'proj_cam', 'dist01']), P('axis', 'auto', ['auto', 'vertical', 'horizontal', 'custom']),
  P('axis_x0', 0.5), P('axis_y0', 0.3), P('axis_x1', 0.5), P('axis_y1', 0.7), P('pipe_invert', false, null)];
const LK = [P('axis', 'vertical', ['vertical', 'horizontal', 'auto']), { ...P('pipe_invert', false), type: 'bool' }];
const A = { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.65 };

test('axisOk / axisInfo', () => {
  assert.ok(axisOk(A));
  assert.ok(!axisOk({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }));
  assert.ok(!axisOk({ x0: -0.1, y0: 0.5, x1: 0.5, y1: 0.5 }));
  assert.ok(!axisOk(null));
  const i = axisInfo({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.7 }, 16 / 9); assert.equal(i.angle, -90); assert.ok(Math.abs(i.length - 0.5) < 1e-9);
  assert.equal(axisInfo({ x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5 }, 1).angle, 0);
});

test('axisParams: point trackers get the custom arrow and proj', () => {
  assert.deepEqual(axisParams(POINTS, 'custom', A), { axis: 'custom', axis_x0: 0.4, axis_y0: 0.4, axis_x1: 0.6, axis_y1: 0.65, primary: 'proj' });
  // a primary the user picked stays
  assert.equal(axisParams(POINTS, 'custom', A, { primary: 'dist01' }).primary, undefined);
  assert.deepEqual(axisParams(POINTS, 'vertical', A), { axis: 'vertical' });
  assert.deepEqual(axisParams(POINTS, 'custom', null), {}, 'custom without an arrow: tracker default');
  assert.deepEqual(axisParams(POINTS, '', A), {}, 'no mode: tracker default');
});

test('axisParams: no axis param -> nothing; lk_box maps the arrow to vertical / horizontal with direction', () => {
  assert.deepEqual(axisParams([P('freq', 1)], 'custom', A), {});
  assert.deepEqual(axisParams(LK, 'custom', { x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 }), { axis: 'vertical' }, 'pointing down: up = higher already right');
  assert.deepEqual(axisParams(LK, 'custom', { x0: 0.5, y0: 0.8, x1: 0.5, y1: 0.2 }), { axis: 'vertical', pipe_invert: true });
  assert.deepEqual(axisParams(LK, 'custom', { x0: 0.5, y0: 0.8, x1: 0.5, y1: 0.2 }, { pipe_invert: true }), { axis: 'vertical', pipe_invert: false });
  assert.deepEqual(axisParams(LK, 'custom', { x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5 }), { axis: 'horizontal', pipe_invert: true });
  assert.deepEqual(axisParams(LK, 'custom', { x0: 0.8, y0: 0.5, x1: 0.2, y1: 0.5 }), { axis: 'horizontal' });
  assert.deepEqual(axisParams(LK, 'auto', null), { axis: 'auto' });
});

test('axisTool: drag, two clicks, end drag, cancel', () => {
  let axis = null, dones = 0;
  const map = (x, y) => [x * 1000, y * 1000];   // 1000 px square stage
  const tool = axisTool({ get: () => axis, set: (a) => (axis = a), done: () => dones++, map: () => map });
  const p = (nx, ny) => ({ nx, ny, x: nx * 1000, y: ny * 1000 });
  // press-drag-release
  assert.ok(tool.down(p(0.2, 0.2), { button: 0 }));
  tool.move(p(0.5, 0.6)); tool.up(p(0.5, 0.6));
  assert.deepEqual(axis, { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.6 }); assert.equal(dones, 1);
  // drag the in end
  tool.down(p(0.505, 0.6), { button: 0 }); tool.move(p(0.7, 0.7)); tool.up(p(0.7, 0.7));
  assert.deepEqual(axis, { x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.7 });
  // two clicks (away from the ends)
  tool.down(p(0.1, 0.9), { button: 0 }); tool.up(p(0.1, 0.9));
  assert.deepEqual(tool.state().pend, [0.1, 0.9]);
  tool.down(p(0.9, 0.1), { button: 0 }); tool.up(p(0.9, 0.1));
  assert.deepEqual(axis, { x0: 0.1, y0: 0.9, x1: 0.9, y1: 0.1 });
  // Esc while drawing restores the committed arrow
  tool.down(p(0.3, 0.3), { button: 0 }); tool.move(p(0.4, 0.5));
  assert.deepEqual(tool.state().axis, { x0: 0.3, y0: 0.3, x1: 0.4, y1: 0.5 });
  assert.equal(tool.cancel(), true);
  tool.up(p(0.4, 0.5));
  assert.deepEqual(axis, { x0: 0.1, y0: 0.9, x1: 0.9, y1: 0.1 });
  assert.equal(tool.cancel(), false, 'nothing to cancel');
  // not editable: refuses
  const off = axisTool({ get: () => null, set: () => {}, editable: () => false });
  assert.equal(off.down(p(0.5, 0.5), { button: 0 }), false);
});
