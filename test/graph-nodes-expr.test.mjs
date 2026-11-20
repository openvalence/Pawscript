// sig.expr grammar: precedence, functions, NaN rules, errors with columns, and no eval/Function anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExpr, checkExpr, EXPR_FUNCS } from '../src/lib/graph/nodes/expr.js';

const ev = (src, V = {}) => parseExpr(src).fn({ a: NaN, b: NaN, c: NaN, d: NaN, t: 0, s: 0, ...V });
const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-12, `${x} vs ${y}`);

test('numbers, precedence and associativity', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('2 ^ 3 ^ 2'), 512);       // right-associative
  assert.equal(ev('-2 ^ 2'), -4);           // unary minus binds looser than ^
  assert.equal(ev('2 ^ -1'), 0.5);
  assert.equal(ev('10 - 4 - 3'), 3);        // left-associative
  assert.equal(ev('7 % 4'), 3);
  assert.equal(ev('1.5e2 + .5'), 150.5);
  assert.equal(ev('--3'), 3);
  assert.equal(ev('+4'), 4);
});

test('variables and constants', () => {
  assert.equal(ev('a + b * c - d', { a: 1, b: 2, c: 3, d: 4 }), 3);
  assert.equal(ev('t / 1000 - s', { t: 2500, s: 2.5 }), 0);
  near(ev('pi'), Math.PI); near(ev('tau'), 2 * Math.PI); near(ev('e'), Math.E);
  assert.deepEqual([...parseExpr('a + sin(c) + t').vars].sort(), ['a', 'c', 't']);
});

test('comparisons, logic and the conditional give 0/1', () => {
  assert.equal(ev('3 > 2'), 1); assert.equal(ev('3 < 2'), 0); assert.equal(ev('2 <= 2'), 1); assert.equal(ev('2 >= 3'), 0);
  assert.equal(ev('2 == 2'), 1); assert.equal(ev('2 != 2'), 0);
  assert.equal(ev('1 && 0'), 0); assert.equal(ev('1 || 0'), 1); assert.equal(ev('!0'), 1); assert.equal(ev('!5'), 0);
  assert.equal(ev('a > 50 ? 100 : 0', { a: 60 }), 100);
  assert.equal(ev('a > 50 ? 100 : a > 20 ? 50 : 0', { a: 30 }), 50); // nested, right-associative
  assert.equal(ev('1 + 1 > 1 && 2 < 3'), 1); // comparison binds tighter than &&
});

test('functions', () => {
  near(ev('sin(pi / 2)'), 1); near(ev('cos(0)'), 1); near(ev('tan(0)'), 0);
  assert.equal(ev('abs(-3)'), 3); assert.equal(ev('min(3, 1, 2)'), 1); assert.equal(ev('max(3, 1, 2)'), 3);
  assert.equal(ev('clamp(120, 0, 100)'), 100); assert.equal(ev('mix(0, 100, 0.25)'), 25);
  assert.equal(ev('pow(2, 10)'), 1024); near(ev('exp(0)'), 1); near(ev('log(e)'), 1); assert.equal(ev('sqrt(81)'), 9);
  assert.equal(ev('floor(2.7)'), 2); assert.equal(ev('ceil(2.1)'), 3); assert.equal(ev('round(2.5)'), 3); assert.equal(ev('sign(-4)'), -1);
  near(ev('fract(2.25)'), 0.25); assert.equal(ev('smoothstep(0, 1, 0.5)'), 0.5); assert.equal(ev('smoothstep(0, 1, 2)'), 1);
  assert.equal(ev('tri(0)'), -1); assert.equal(ev('tri(0.5)'), 1); assert.equal(ev('tri(0.25)'), 0);
  assert.equal(ev('saw(0)'), -1); near(ev('saw(0.75)'), 0.5);
  assert.equal(ev('sqr(0.25)'), 1); assert.equal(ev('sqr(0.75)'), -1);
  for (const name of Object.keys(EXPR_FUNCS)) assert.equal(checkExpr(`${name}(${Array(Array.isArray(EXPR_FUNCS[name][0]) ? 2 : EXPR_FUNCS[name][0]).fill('1').join(', ')})`), '', name);
});

test('NaN in gives NaN out, except isnan and nz', () => {
  assert.ok(Number.isNaN(ev('a + 1')));
  assert.ok(Number.isNaN(ev('a > 1')));
  assert.ok(Number.isNaN(ev('a ? 1 : 2')));
  assert.ok(Number.isNaN(ev('!a')));
  assert.ok(Number.isNaN(ev('max(a, 1)')));
  assert.equal(ev('isnan(a)'), 1); assert.equal(ev('isnan(1)'), 0);
  assert.equal(ev('nz(a, 7)'), 7); assert.equal(ev('nz(3, 7)'), 3);
  assert.ok(Number.isNaN(ev('1 / 0')), 'division by zero is NaN, never Infinity');
  assert.ok(Number.isNaN(ev('log(0)')));
  assert.ok(Number.isNaN(ev('sqrt(-1)')));
});

test('errors name the column', () => {
  const err = (src) => { try { parseExpr(src); return ''; } catch (e) { return e.message; } };
  assert.match(err(''), /col 1: empty/);
  assert.match(err('1 +'), /col 4: unexpected end/);
  assert.match(err('a $ b'), /col 3: unexpected character "\$"/);
  assert.match(err('foo(1)'), /col 1: unknown function "foo"/);
  assert.match(err('2 * x'), /col 5: unknown name "x"/);
  assert.match(err('sin(1, 2)'), /col 1: sin\(\) takes 1 argument, got 2/);
  assert.match(err('(1 + 2'), /col 7: expected "\)"/);
  assert.match(err('1 2'), /col 3: unexpected "2"/);
  assert.match(err('a ? 1'), /expected ":"/);
  assert.match(err('sin'), /"sin" is a function/);
  assert.equal(checkExpr('a * 2'), '');
  assert.match(checkExpr('a *'), /^col 4/);
});

test('the parser never reaches for eval or Function', () => {
  const src = readFileSync(new URL('../src/lib/graph/nodes/expr.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\beval\s*\(/.test(src) && !/\bFunction\s*\(/.test(src) && !/new\s+Function/.test(src));
  assert.throws(() => parseExpr('constructor'), /unknown name/);
  assert.throws(() => parseExpr('toString(1)'), /unknown function/);
  assert.throws(() => parseExpr('__proto__'), /unknown name/);
  assert.throws(() => parseExpr('a.b'), /unexpected character/);
});
