// Safe expression language for `sig.expr` (DESIGN §7 "Signal"). A recursive-descent parser that compiles to a
// closure tree: never eval / Function. NaN in gives NaN out (except isnan / nz, which exist to handle it).
//
//   expr    := ternary
//   ternary := or ('?' expr ':' expr)?
//   or      := and ('||' and)*
//   and     := cmp ('&&' cmp)*
//   cmp     := add (('<' | '<=' | '>' | '>=' | '==' | '!=') add)?
//   add     := mul (('+' | '-') mul)*
//   mul     := unary (('*' | '/' | '%') unary)*
//   unary   := ('-' | '+' | '!') unary | pow
//   pow     := atom ('^' unary)?                   right-associative, binds tighter than unary minus on its left: -2^2 = -4
//   atom    := number | name | name '(' args ')' | '(' expr ')'
//
// Variables: a b c d (inputs), t (ms), s (seconds). Constants: pi tau e.
// Booleans are 0/1; a NaN condition gives NaN.

export const EXPR_VARS = ['a', 'b', 'c', 'd', 't', 's'];
const CONSTS = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };
const fract = (x) => x - Math.floor(x);
const nanIf = (x) => (Number.isFinite(x) ? x : NaN);

/** name -> [arity (array = allowed counts), fn] */
export const EXPR_FUNCS = {
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], abs: [1, Math.abs],
  min: [[2, 3, 4, 5, 6, 7, 8], Math.min], max: [[2, 3, 4, 5, 6, 7, 8], Math.max],
  clamp: [3, (x, lo, hi) => Math.min(hi, Math.max(lo, x))],
  mix: [3, (x, y, w) => x + (y - x) * w],
  pow: [2, Math.pow], exp: [1, Math.exp], log: [1, Math.log], sqrt: [1, Math.sqrt],
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round], sign: [1, Math.sign], fract: [1, fract],
  smoothstep: [3, (e0, e1, x) => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); }],
  tri: [1, (x) => { const f = fract(x); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; }],   // period 1, -1..1, -1 at 0
  saw: [1, (x) => 2 * fract(x) - 1],
  sqr: [1, (x) => (x !== x ? NaN : fract(x) < 0.5 ? 1 : -1)],
  isnan: [1, (x) => (x !== x ? 1 : 0)],
  nz: [2, (x, d) => (x === x ? x : d)],
};

class ExprError extends Error {}
const fail = (col, msg) => { throw new ExprError(`col ${col}: ${msg}`); };

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const col = i + 1;
    const m = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
    if (m) { toks.push({ k: 'num', v: Number(m[1]), col }); i += m[1].length; continue; }
    const w = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (w) { toks.push({ k: 'name', v: w[0], col }); i += w[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { toks.push({ k: 'op', v: two, col }); i += 2; continue; }
    if ('+-*/%^()<>!?:,'.includes(c)) { toks.push({ k: 'op', v: c, col }); i++; continue; }
    fail(col, `unexpected character "${c}"`);
  }
  toks.push({ k: 'end', v: '', col: src.length + 1 });
  return toks;
}

/**
 * Parse an expression. -> { fn(vars) -> number, vars: Set<string> (variables used) }.
 * Throws Error('col N: message') on a syntax error, an unknown name or a wrong argument count.
 */
export function parseExpr(src) {
  if (typeof src !== 'string' || !src.trim()) throw new ExprError('col 1: empty expression');
  const toks = tokenize(src), used = new Set();
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const isOp = (v) => toks[p].k === 'op' && toks[p].v === v;
  const expect = (v) => { if (!isOp(v)) fail(peek().col, `expected "${v}"${peek().k === 'end' ? ' before the end' : ` but found "${peek().v}"`}`); p++; };

  const expr = () => ternary();
  function ternary() {
    const c = or();
    if (!isOp('?')) return c;
    p++;
    const x = expr(); expect(':'); const y = expr();
    return (V) => { const k = c(V); return k !== k ? NaN : k ? x(V) : y(V); };
  }
  function or() {
    let l = and();
    while (isOp('||')) { p++; const a = l, b = and(); l = (V) => { const x = a(V), y = b(V); return x !== x || y !== y ? NaN : x || y ? 1 : 0; }; }
    return l;
  }
  function and() {
    let l = cmp();
    while (isOp('&&')) { p++; const a = l, b = cmp(); l = (V) => { const x = a(V), y = b(V); return x !== x || y !== y ? NaN : x && y ? 1 : 0; }; }
    return l;
  }
  const CMP = { '<': (x, y) => x < y, '<=': (x, y) => x <= y, '>': (x, y) => x > y, '>=': (x, y) => x >= y, '==': (x, y) => x === y, '!=': (x, y) => x !== y };
  function cmp() {
    const l = add();
    const t = peek();
    if (t.k === 'op' && CMP[t.v]) {
      p++;
      const r = add(), f = CMP[t.v];
      return (V) => { const x = l(V), y = r(V); return x !== x || y !== y ? NaN : f(x, y) ? 1 : 0; };
    }
    return l;
  }
  function add() {
    let l = mul();
    for (;;) {
      if (isOp('+')) { p++; const a = l, b = mul(); l = (V) => a(V) + b(V); }
      else if (isOp('-')) { p++; const a = l, b = mul(); l = (V) => a(V) - b(V); }
      else return l;
    }
  }
  function mul() {
    let l = unary();
    for (;;) {
      if (isOp('*')) { p++; const a = l, b = unary(); l = (V) => a(V) * b(V); }
      else if (isOp('/')) { p++; const a = l, b = unary(); l = (V) => nanIf(a(V) / b(V)); }
      else if (isOp('%')) { p++; const a = l, b = unary(); l = (V) => nanIf(a(V) % b(V)); }
      else return l;
    }
  }
  function unary() {
    if (isOp('-')) { p++; const a = unary(); return (V) => -a(V); }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('!')) { p++; const a = unary(); return (V) => { const x = a(V); return x !== x ? NaN : x ? 0 : 1; }; }
    return pow();
  }
  function pow() {
    const base = atom();
    if (!isOp('^')) return base;
    p++;
    const e = unary();
    return (V) => nanIf(Math.pow(base(V), e(V)));
  }
  function atom() {
    const t = next();
    if (t.k === 'num') { const v = t.v; return () => v; }
    if (t.k === 'op' && t.v === '(') { const x = expr(); expect(')'); return x; }
    if (t.k === 'name') {
      if (isOp('(')) {
        const f = Object.hasOwn(EXPR_FUNCS, t.v) ? EXPR_FUNCS[t.v] : null; // own keys only: no 'constructor', 'toString'
        if (!f) fail(t.col, `unknown function "${t.v}"`);
        p++;
        const args = [];
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()); } }
        expect(')');
        const ok = Array.isArray(f[0]) ? f[0].includes(args.length) : f[0] === args.length;
        if (!ok) fail(t.col, `${t.v}() takes ${Array.isArray(f[0]) ? `${f[0][0]} or more` : f[0]} argument${f[0] === 1 ? '' : 's'}, got ${args.length}`);
        const fn = f[1];
        if (args.length === 1) { const [x] = args; return (V) => fn(x(V)); }
        if (args.length === 2) { const [x, y] = args; return (V) => fn(x(V), y(V)); }
        if (args.length === 3) { const [x, y, z] = args; return (V) => fn(x(V), y(V), z(V)); }
        return (V) => fn(...args.map((a) => a(V)));
      }
      if (Object.hasOwn(CONSTS, t.v)) { const v = CONSTS[t.v]; return () => v; }
      if (EXPR_VARS.includes(t.v)) { used.add(t.v); const k = t.v; return (V) => V[k]; }
      if (Object.hasOwn(EXPR_FUNCS, t.v)) fail(t.col, `"${t.v}" is a function: write ${t.v}(…)`);
      fail(t.col, `unknown name "${t.v}" (variables: ${EXPR_VARS.join(' ')}; constants: pi tau e)`);
    }
    fail(t.col, t.k === 'end' ? 'unexpected end of expression' : `unexpected "${t.v}"`);
  }

  const root = expr();
  if (peek().k !== 'end') fail(peek().col, `unexpected "${peek().v}"`);
  return { fn: (V) => nanIf(root(V)), vars: used };
}

/** '' when `src` parses, else the error message (for the inspector's live check). */
export function checkExpr(src) {
  try { parseExpr(src); return ''; } catch (e) { return e.message; }
}
