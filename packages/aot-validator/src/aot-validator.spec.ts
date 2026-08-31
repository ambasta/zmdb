import { describe, it, expect } from 'vitest';

import { transformSource, validate, tags, escapePattern } from './index.ts';

// RED PHASE (#21 spec freeze): transformer golden fixtures + runtime fallback.

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

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
  it('inlines Minimum', () => {
    const out = transformSource('const ok = validate(tags.Minimum(0), input.price);');
    expect(norm(out)).toContain('typeof input.price === "number" && input.price >= 0');
  });

  it('inlines MaxLength', () => {
    const out = transformSource('const ok = validate(tags.MaxLength(255), input.name);');
    expect(norm(out)).toContain('typeof input.name === "string" && input.name.length <= 255');
  });

  it('inlines Enum as OR chain', () => {
    const out = transformSource('const ok = validate(tags.Enum("a","b"), input.role);');
    expect(norm(out)).toContain('input.role === "a" || input.role === "b"');
  });

  it('inlines Pattern safely with escaped slashes and quotes', () => {
    const out = transformSource('const ok = validate(tags.Pattern("foo/bar"), input.path);');
    expect(norm(out)).toContain('typeof input.path === "string" && /foo\\/bar/.test(input.path)');
  });

  it('inlines Pattern containing double and single quotes', () => {
    const outDouble = transformSource('const ok = validate(tags.Pattern("foo\\"bar"), input.val);');
    expect(norm(outDouble)).toContain('/foo\\"bar/.test(input.val)');

    const outSingle = transformSource("const ok = validate(tags.Pattern('foo\\'bar'), input.val);");
    expect(norm(outSingle)).toContain("/foo\\'bar/.test(input.val)");
  });

  it('inlines Pattern containing template literal substitution using new RegExp()', () => {
    const src = 'const ok = validate(tags.Pattern(`prefix_${id}_suffix`), input.val);';
    const out = transformSource(src);
    expect(norm(out)).toContain('typeof input.val === "string" && new RegExp(`prefix_${id}_suffix`).test(input.val)');
  });

  it('inlines Pattern dynamic variable expression using new RegExp()', () => {
    const src = 'const ok = validate(tags.Pattern(myCustomPattern), input.val);';
    const out = transformSource(src);
    expect(norm(out)).toContain('typeof input.val === "string" && new RegExp(myCustomPattern).test(input.val)');
  });

  it('inlines Pattern backtick template literal when it contains no substitutions', () => {
    const src = 'const ok = validate(tags.Pattern(`^[a-z]+$`), input.val);';
    const out = transformSource(src);
    expect(norm(out)).toContain('typeof input.val === "string" && /^[a-z]+$/.test(input.val)');
  });

  it('leaves code without validate() calls unchanged', () => {
    const src = 'const x = 1 + 2;';
    expect(norm(transformSource(src))).toBe(norm(src));
  });

  it('emitted code contains no reference to validate(', () => {
    const out = transformSource('const ok = validate(tags.Minimum(0), input.price);');
    expect(out).not.toContain('validate(');
  });
});

describe('runtime-safety fallback and parity (pre-transform vs compiled)', () => {
  it('Minimum passes/fails correctly at runtime', () => {
    expect(validate(tags.Minimum(0), 5)).toBe(true);
    expect(validate(tags.Minimum(0), -1)).toBe(false);
  });

  it('Enum membership at runtime', () => {
    expect(validate(tags.Enum('a', 'b'), 'a')).toBe(true);
    expect(validate(tags.Enum('a', 'b'), 'c')).toBe(false);
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
      const srcCode = `const ok = validate(tags.Pattern("${pattern}"), input.val); return ok;`;
      const compiledSrc = transformSource(srcCode);
      const compiledFn = new Function('input', compiledSrc);

      for (const val of inputs) {
        const runtimeRes = validate(rule, val);
        const compiledRes = Boolean(compiledFn({ val }));
        expect(compiledRes).toBe(runtimeRes);
      }
    }
  });
});
