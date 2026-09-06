import { splitTopLevelComma, splitArgs, transformCode } from '@zmdb/compiler/transform';
import { describe, it, expect } from 'vitest';

import { parseExpression, evaluateAst, emitAstJs } from './ast.js';
import { coerce, refine, transform } from './index.js';

describe('Strict Coercion Guards (coerce.number)', () => {
  it('coerces valid numeric numbers and strings', () => {
    expect(coerce.number(42)).toBe(42);
    expect(coerce.number('42')).toBe(42);
    expect(coerce.number('3.14')).toBe(3.14);
    expect(coerce.number('-100')).toBe(-100);
    expect(coerce.number('  15.5  ')).toBe(15.5);
  });

  it('throws TypeError for boolean inputs', () => {
    expect(() => coerce.number(true)).toThrow(TypeError);
    expect(() => coerce.number(false)).toThrow(TypeError);
  });

  it('throws TypeError for null and undefined', () => {
    expect(() => coerce.number(null)).toThrow(TypeError);
    expect(() => coerce.number(undefined)).toThrow(TypeError);
  });

  it('throws TypeError for empty or whitespace-only strings', () => {
    expect(() => coerce.number('')).toThrow(TypeError);
    expect(() => coerce.number('   ')).toThrow(TypeError);
    expect(() => coerce.number('\t\n')).toThrow(TypeError);
  });

  it('throws TypeError for array inputs', () => {
    expect(() => coerce.number([])).toThrow(TypeError);
    expect(() => coerce.number([42])).toThrow(TypeError);
    expect(() => coerce.number(['a', 'b'])).toThrow(TypeError);
  });

  it('throws TypeError for object inputs and NaN', () => {
    expect(() => coerce.number({})).toThrow(TypeError);
    expect(() => coerce.number({ val: 42 })).toThrow(TypeError);
    expect(() => coerce.number(NaN)).toThrow(TypeError);
  });
});

describe('Lexical Expression Tokenization (Expression Splitter)', () => {
  it('correctly splits top-level commas with nested object literals', () => {
    const [rule, expr] = splitTopLevelComma('tags.Minimum(0), { key1: 1, key2: 2 }');
    expect(rule).toBe('tags.Minimum(0)');
    expect(expr).toBe('{ key1: 1, key2: 2 }');
  });

  it('preserves string literals containing commas without improper splitting', () => {
    const [rule, expr] = splitTopLevelComma('tags.Pattern("a,b,c"), input.val');
    expect(rule).toBe('tags.Pattern("a,b,c")');
    expect(expr).toBe('input.val');
  });

  it('splits enum arguments containing string commas correctly', () => {
    const args = splitArgs('"a,b", "c,d"');
    expect(args).toEqual(['"a,b"', '"c,d"']);
  });

  it('transforms validate calls containing complex object literals and string commas', () => {
    const src = 'const ok = validate(tags.Pattern("a,b"), { foo: "bar,baz", num: 1 });';
    const out = transformCode(src);
    expect(out).toContain('typeof { foo: "bar,baz", num: 1 } === "string"');
    expect(out).toContain('/a,b/.test({ foo: "bar,baz", num: 1 })');
  });
});

describe('Static AST Execution for Refinements & Transforms (CSP Enforcement)', () => {
  it('executes parsed expression ASTs statically without dynamic code evaluation', () => {
    const ast = parseExpression('typeof v === "number" && v >= 0');
    expect(evaluateAst(ast, { v: 10 })).toBe(true);
    expect(evaluateAst(ast, { v: -5 })).toBe(false);
    expect(evaluateAst(ast, { v: 'string' })).toBe(false);
  });

  it('executes transform expressions statically without dynamic code evaluation', () => {
    const ast1 = parseExpression('v * 2');
    expect(evaluateAst(ast1, { v: 21 })).toBe(42);
  });

  it('rejects string sources for refine and transform', () => {
    expect(() => refine('v >= 0' as unknown as (v: unknown) => boolean, 'msg')).toThrow(TypeError);
    expect(() => transform('v * 2' as unknown as (v: unknown) => unknown)).toThrow(TypeError);
  });

  it('throws SyntaxError on invalid operators or unknown characters', () => {
    expect(() => parseExpression('v ??? 5')).toThrow(SyntaxError);
    expect(() => parseExpression('v ==== 5')).toThrow(SyntaxError);
    expect(() => parseExpression('v &&& 5')).toThrow(SyntaxError);
    expect(() => parseExpression('v ||| 5')).toThrow(SyntaxError);
    expect(() => parseExpression('v @ 5')).toThrow(SyntaxError);
    expect(() => parseExpression('v # 5')).toThrow(SyntaxError);
  });

  it('throws SyntaxError on malformed expressions, missing colons, or missing delimiters', () => {
    expect(() => parseExpression('v +')).toThrow(SyntaxError);
    expect(() => parseExpression('v ===')).toThrow(SyntaxError);
    expect(() => parseExpression('v ? 1')).toThrow(SyntaxError);
    expect(() => parseExpression('{ a 1 }')).toThrow(SyntaxError);
    expect(() => parseExpression('{ a: 1')).toThrow(SyntaxError);
    expect(() => parseExpression('[1, 2')).toThrow(SyntaxError);
    expect(() => parseExpression('(1 + 2')).toThrow(SyntaxError);
    expect(() => parseExpression('v.')).toThrow(SyntaxError);
    expect(() => parseExpression('"unclosed string')).toThrow(SyntaxError);
    expect(() => parseExpression('/* unterminated comment')).toThrow(SyntaxError);
  });

  it('rejects forbidden properties (constructor, __proto__, prototype) and prevents eval reaching', () => {
    const malicious = 'Object.constructor("return process.env")()';
    const ast = parseExpression(malicious);

    expect(() => evaluateAst(ast, {})).toThrow(/Access to forbidden property 'constructor' is not allowed/);
    expect(() => emitAstJs(ast, 'v')).toThrow(/Access to forbidden property 'constructor' is not allowed/);

    expect(() => evaluateAst(parseExpression('({}).constructor'), {})).toThrow(/constructor/);
    expect(() => evaluateAst(parseExpression('v.__proto__'), { v: {} })).toThrow(/__proto__/);
    expect(() => evaluateAst(parseExpression('Array.prototype'), {})).toThrow(/prototype/);
    expect(() => evaluateAst(parseExpression('{ constructor: 123 }'), {})).toThrow(/constructor/);

    expect(() => emitAstJs(parseExpression('v.__proto__'), 'v')).toThrow(/__proto__/);
    expect(() => emitAstJs(parseExpression('Array.prototype'), 'v')).toThrow(/prototype/);
  });

  it('rejects backtick template literals with a SyntaxError', () => {
    expect(() => parseExpression('`hello ${v}`')).toThrow(SyntaxError);
    expect(() => parseExpression('`plain`')).toThrow(SyntaxError);
  });

  it('correctly handles \\xXX, \\uXXXX, and \\u{HEX} escapes and rejects invalid hex escapes', () => {
    const ast1 = parseExpression('"\\x41"');
    expect(evaluateAst(ast1, {})).toBe('A');

    const ast2 = parseExpression('"\\u0041"');
    expect(evaluateAst(ast2, {})).toBe('A');

    const ast3 = parseExpression('"\\u{41}"');
    expect(evaluateAst(ast3, {})).toBe('A');

    expect(() => parseExpression('"\\xZZ"')).toThrow(SyntaxError);
    expect(() => parseExpression('"\\u123"')).toThrow(SyntaxError);
    expect(() => parseExpression('"\\u{110000}"')).toThrow(SyntaxError);
  });
});
