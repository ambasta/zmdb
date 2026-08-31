import { getEnumSet, getRegExp, tags, validate } from '@zmdb/aot-validator';
import { afterAll, describe, expect, it } from 'vitest';

import { evaluate, FixtureProject } from './emit/__testing__/project.js';
import { escapePattern } from './emit/index.js';
import { transformCode } from './transform/index.js';

// RED PHASE (#21 spec freeze): transformer golden fixtures + runtime fallback.
//
// `transformSource` is gone; `transformCode` is the same function under the name that says
// what it does. `escapePattern` moved to the emitter, which is the only thing that writes a
// regular expression into generated source.

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const shallowProject = FixtureProject.open({
  declarations: `
  function isShallow<T, D extends number = 1>(value: unknown): value is T;
`,
});
afterAll(() => shallowProject.close());

describe('shallow validation behaviour', () => {
  it('accepts a value whose nesting is malformed below the limit', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], and the source still
    // contains `isShallow`, so no callable JavaScript check exists yet.
    const result = shallowProject.transform('const check = (input) => isShallow<{ user: { id: number } }, 1>(input);');
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(evaluate(result.code)({ user: { id: 'not a number' } })).toBe(true);
  });

  it('still rejects a malformed top level', () => {
    // Measured at d34bfbaf: changed=false, diagnostics=[], and the source still
    // contains `isShallow`, so the top-level object check is absent too.
    const result = shallowProject.transform('const check = (input) => isShallow<{ user: { id: number } }, 1>(input);');
    expect(result.diagnostics).toEqual([]);
    expect(result.changed).toBe(true);
    expect(evaluate(result.code)({ user: 'not an object' })).toBe(false);
  });
});

describe('escapePattern helper', () => {
  it('escapes unescaped forward slashes', () => {
    expect(escapePattern('foo/bar')).toBe('foo\\/bar');
    expect(escapePattern('a/b/c')).toBe('a\\/b\\/c');
    expect(escapePattern('http://example.com')).toBe('http:\\/\\/example.com');
  });

  it('handles already escaped slashes correctly', () => {
    expect(escapePattern('a\\/b')).toBe('a\\/b');
  });

  it('escapes dangerous control characters and line terminators', () => {
    expect(escapePattern('line1\nline2')).toBe('line1\\nline2');
    expect(escapePattern('line1\rline2')).toBe('line1\\rline2');
  });

  it('prevents code injection via delimiters', () => {
    const dangerous = 'foo/i.test(x) || true; //';
    const escaped = escapePattern(dangerous);
    expect(escaped).toContain('\\/');
    expect(() => new Function('x', `return /${escaped}/.test(x)`)).not.toThrow();
  });
});

describe('transformer inlining (golden fixtures)', () => {
  it('fails transformation with a descriptive error on invalid pattern syntax', () => {
    const source = 'const ok = validate(tags.Pattern("+"), input);';
    expect(() => transformCode(source)).toThrow(/Invalid regular expression/);
  });

  it('emits monomorphic allocation-free inline JavaScript for a safe pattern', () => {
    const source = 'const ok = validate(tags.Pattern("^[a-z]+$"), input);';
    expect(transformCode(source)).toBe('const ok = (typeof input === "string" && /^[a-z]+$/.test(input));');
  });

  it('inlines Min', () => {
    const out = transformCode('const ok = validate(tags.Min(0), input.price);');
    expect(norm(out)).toContain('typeof input.price === "number" && input.price >= 0');
  });

  it('inlines MaxLength', () => {
    const out = transformCode('const ok = validate(tags.MaxLength(255), input.name);');
    expect(norm(out)).toContain('typeof input.name === "string" && input.name.length <= 255');
  });

  it('inlines Enum as OR chain', () => {
    const out = transformCode('const ok = validate(tags.Enum("a","b"), input.role);');
    expect(norm(out)).toContain('input.role === "a" || input.role === "b"');
  });

  it('inlines Pattern safely with escaped slashes and quotes', () => {
    const out = transformCode('const ok = validate(tags.Pattern("foo/bar"), input.path);');
    expect(norm(out)).toContain('typeof input.path === "string" && /foo\\/bar/.test(input.path)');
  });

  it('inlines Pattern containing double and single quotes', () => {
    const outDouble = transformCode('const ok = validate(tags.Pattern("foo\\"bar"), input.val);');
    expect(norm(outDouble)).toContain('/foo\\"bar/.test(input.val)');

    const outSingle = transformCode("const ok = validate(tags.Pattern('foo\\'bar'), input.val);");
    expect(norm(outSingle)).toContain("/foo\\'bar/.test(input.val)");
  });

  it('inlines Pattern containing template literal substitution using hoisted pattern-keyed regex cache', () => {
    const src = 'const ok = validate(tags.Pattern(`prefix_${id}_suffix`), input.val);';
    const out = transformCode(src);
    expect(norm(out)).toContain('const _regexCache = new Map();');
    expect(norm(out)).toContain('function _getRegExp(p)');
    expect(norm(out)).toContain('typeof input.val === "string" && _getRegExp(`prefix_${id}_suffix`).test(input.val)');
  });

  it('inlines Pattern dynamic variable expression using hoisted pattern-keyed regex cache', () => {
    const src = 'const ok = validate(tags.Pattern(myCustomPattern), input.val);';
    const out = transformCode(src);
    expect(norm(out)).toContain('const _regexCache = new Map();');
    expect(norm(out)).toContain('function _getRegExp(p)');
    expect(norm(out)).toContain('typeof input.val === "string" && _getRegExp(myCustomPattern).test(input.val)');
  });

  it('inlines Pattern backtick template literal when it contains no substitutions', () => {
    const src = 'const ok = validate(tags.Pattern(`^[a-z]+$`), input.val);';
    const out = transformCode(src);
    expect(norm(out)).toContain('typeof input.val === "string" && /^[a-z]+$/.test(input.val)');
  });

  it('leaves code without validate() calls unchanged', () => {
    const src = 'const x = 1 + 2;';
    expect(norm(transformCode(src))).toBe(norm(src));
  });

  it('emitted code contains no reference to validate(', () => {
    const out = transformCode('const ok = validate(tags.Min(0), input.price);');
    expect(out).not.toContain('validate(');
  });
});

describe('runtime-safety fallback and parity (pre-transform vs compiled)', () => {
  it('Min passes/fails correctly at runtime', () => {
    expect(validate(tags.Min(0), 5)).toBe(true);
    expect(validate(tags.Min(0), -1)).toBe(false);
  });

  it('Enum membership at runtime', () => {
    expect(validate(tags.Enum('a', 'b'), 'a')).toBe(true);
    expect(validate(tags.Enum('a', 'b'), 'c')).toBe(false);
  });

  it('reuses cached RegExp instance for pattern rules', () => {
    const patternRule = tags.Pattern('^[a-z]+$');
    expect(validate(patternRule, 'hello')).toBe(true);
    expect(validate(patternRule, '123')).toBe(false);
  });

  it('uses cached Set lookup for enum rules', () => {
    const enumRule = tags.Enum('alpha', 'beta', 'gamma');
    for (let i = 0; i < 100; i++) {
      expect(validate(enumRule, 'beta')).toBe(true);
      expect(validate(enumRule, 'delta')).toBe(false);
    }
  });

  it('getEnumSet builds one Set per rule, keyed on the rule that holds the values', () => {
    // The cache is a WeakMap on the argument array, not on its contents, which is what makes
    // it safe: a `Rule` is built once at the call site and reused, so the Set outlives the
    // call without an eviction policy and without keeping a dead rule alive. Two arrays with
    // the same members are two rules and get two Sets — cheap, and the alternative is
    // hashing the members on every lookup, which is the linear scan this exists to avoid.
    const rule = tags.Enum('alpha', 'beta', 'gamma');
    const set = getEnumSet(rule.args);
    expect(set).toBeInstanceOf(Set);
    expect([...set]).toEqual(['alpha', 'beta', 'gamma']);
    expect(getEnumSet(rule.args)).toBe(set);
    expect(getEnumSet(tags.Enum('alpha', 'beta', 'gamma').args)).not.toBe(set);

    // And it is the same answer the rule gives, because it is the answer the rule reads.
    for (const value of ['alpha', 'delta', '', 0, null, undefined]) {
      expect(set.has(value)).toBe(validate(rule, value));
    }
  });

  it('bounds RegExp cache with LRU eviction', () => {
    const firstRegexp = getRegExp('pattern_0');
    for (let i = 1; i <= 1005; i++) {
      getRegExp(`pattern_${i}`);
    }
    const newFirstRegexp = getRegExp('pattern_0');
    expect(newFirstRegexp).not.toBe(firstRegexp);
  });

  it('Pattern evaluation parity between runtime fallback and compiled inline checks', () => {
    const testCases = [
      { pattern: '^[^@]+@[^@]+\\.[^@]+$', inputs: ['user@example.com', 'invalid-email', 'a@b.c'] },
      { pattern: 'foo/bar', inputs: ['foo/bar', 'foobar', 'foo/bar/baz'] },
      { pattern: 'foo"bar', inputs: ['foo"bar', 'foobar'] },
      { pattern: "foo'bar", inputs: ["foo'bar", 'foobar'] },
      { pattern: 'http://example.com/api', inputs: ['http://example.com/api', 'http://example.com'] },
    ];

    for (const { pattern, inputs } of testCases) {
      const rule = tags.Pattern(pattern);
      const srcCode = `const ok = validate(tags.Pattern(${JSON.stringify(pattern)}), input.val); return ok;`;
      const compiledSrc = transformCode(srcCode);
      const compiledFn = new Function('input', compiledSrc);

      for (const val of inputs) {
        const runtimeRes = validate(rule, val);
        const compiledRes = Boolean(compiledFn({ val }));
        expect(compiledRes).toBe(runtimeRes);
      }
    }
  });

  it('keeps runtime and compiled pattern checks equal for long input', () => {
    const rule = tags.Pattern('^[a-z]+$');
    const long = 'a'.repeat(20_000);
    const compiled = new Function(
      'input',
      `return (${transformCode('validate(tags.Pattern("^[a-z]+$"), input)')});`,
    ) as (input: unknown) => boolean;

    expect(validate(rule, long)).toBe(compiled(long));
    expect(validate(rule, `${long}1`)).toBe(compiled(`${long}1`));
  });

  it('Pattern evaluation parity for dynamic patterns (variable and template literal)', () => {
    const myCustomPattern = '^[0-9]{3}-[0-9]{3}$';
    const id = 'abc';
    const testInputs = ['123-456', '123456', 'prefix_abc_suffix', 'prefix_xyz_suffix'];

    // Test dynamic variable pattern
    const srcVar = `
      const myCustomPattern = "${myCustomPattern}";
      const ok = validate(tags.Pattern(myCustomPattern), input.val);
      return ok;
    `;
    const compiledVarSrc = transformCode(srcVar);
    const compiledVarFn = new Function('input', compiledVarSrc);

    for (const val of testInputs) {
      const runtimeRes = validate(tags.Pattern(myCustomPattern), val);
      const compiledRes = Boolean(compiledVarFn({ val }));
      expect(compiledRes).toBe(runtimeRes);
    }

    // Test template literal substitution pattern
    const srcTpl = `
      const id = "${id}";
      const ok = validate(tags.Pattern(\`prefix_\${id}_suffix\`), input.val);
      return ok;
    `;
    const compiledTplSrc = transformCode(srcTpl);
    const compiledTplFn = new Function('input', compiledTplSrc);

    const patternStr = `prefix_${id}_suffix`;
    for (const val of testInputs) {
      const runtimeRes = validate(tags.Pattern(patternStr), val);
      const compiledRes = Boolean(compiledTplFn({ val }));
      expect(compiledRes).toBe(runtimeRes);
    }
  });

  it('Pattern evaluation parity when dynamic pattern substitutions change across iterations in a loop', () => {
    const src = `
      const results = [];
      for (const prefix of ['a', 'b', 'a']) {
        const ok = validate(tags.Pattern(\`^\${prefix}\\\\d+$\`), input.val);
        results.push(ok);
      }
      return results;
    `;
    const compiledSrc = transformCode(src);
    const compiledFn = new Function('input', compiledSrc);

    expect(compiledFn({ val: 'a123' })).toEqual([true, false, true]);
    expect(compiledFn({ val: 'b123' })).toEqual([false, true, false]);
  });

  it('Pattern evaluation parity when dynamic pattern variable is reassigned', () => {
    const src = `
      let pat = '^[a-z]+$';
      const res1 = validate(tags.Pattern(pat), input.val);
      pat = '^[0-9]+$';
      const res2 = validate(tags.Pattern(pat), input.val);
      return [res1, res2];
    `;
    const compiledSrc = transformCode(src);
    const compiledFn = new Function('input', compiledSrc);

    expect(compiledFn({ val: 'abc' })).toEqual([true, false]);
    expect(compiledFn({ val: '123' })).toEqual([false, true]);
  });

  it('Pattern evaluation parity when calling a single compiled validator multiple times with different pattern values', () => {
    const src = `
      const ok = validate(tags.Pattern(\`^\${input.prefix}_\\\\d+$\`), input.val);
      return ok;
    `;
    const compiledSrc = transformCode(src);
    const compiledFn = new Function('input', compiledSrc);

    expect(compiledFn({ prefix: 'alpha', val: 'alpha_123' })).toBe(true);
    expect(compiledFn({ prefix: 'alpha', val: 'beta_123' })).toBe(false);

    expect(compiledFn({ prefix: 'beta', val: 'beta_123' })).toBe(true);
    expect(compiledFn({ prefix: 'beta', val: 'alpha_123' })).toBe(false);
  });

  it('bounds emitted _regexCache with LRU eviction in compiled validator code', () => {
    const src = `
      const ok = validate(tags.Pattern(input.pat), input.val);
      return { ok, cacheSize: _regexCache.size };
    `;
    const compiledSrc = transformCode(src);
    const compiledFn = new Function('input', compiledSrc);

    for (let i = 0; i < 1005; i++) {
      compiledFn({ pat: `^pat_${i}$`, val: `pat_${i}` });
    }
    const res = compiledFn({ pat: '^pat_1004$', val: 'pat_1004' });
    expect(res.cacheSize).toBeLessThanOrEqual(1000);
  });
});
