import { describe, it, expect } from 'vitest';

import { transformCode, transformSource } from './index.ts';
import { transformTypeChecks, zmdbAot } from './plugin/index.ts';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('Unified Single-Pass AOT Transformer Engine', () => {
  it('transforms tag rule validate() and generic type checks (is<T>, assert<T>) in a single pass', () => {
    const src = `
      const okRule = validate(tags.Minimum(10), input.price);
      const okIs = is<{ name: string; age: number }>(input.user);
      const valAssert = assert<{ role: string }>(input.auth);
    `;
    const out = transformCode(src);
    const n = norm(out);

    // Verify tag rule inlining
    expect(n).toContain('typeof input.price === "number" && input.price >= 10');
    expect(out).not.toContain('validate(tags.Minimum');

    // Verify is<T> inlining
    expect(n).toContain(
      'typeof input.user === "object" && input.user !== null && typeof input.user.name === "string" && typeof input.user.age === "number"',
    );
    expect(out).not.toContain('is<');

    // Verify assert<T> inlining
    expect(n).toContain('typeof input.auth === "object" && input.auth !== null && typeof input.auth.role === "string"');
    expect(n).toContain('throw new Error("assertion failed")');
    expect(out).not.toContain('assert<');
  });

  it('maintains backwards compatibility for transformSource, transformTypeChecks, and zmdbAot', () => {
    const srcTag = 'const ok = validate(tags.MaxLength(100), input.bio);';
    const srcType = 'const ok = is<{ flag: boolean }>(input);';

    expect(norm(transformSource(srcTag))).toContain('typeof input.bio === "string" && input.bio.length <= 100');
    expect(norm(transformSource(srcType))).toContain('typeof input.flag === "boolean"');

    expect(norm(transformTypeChecks(srcTag))).toContain('typeof input.bio === "string" && input.bio.length <= 100');
    expect(norm(transformTypeChecks(srcType))).toContain('typeof input.flag === "boolean"');

    const plugin = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };

    const pluginOutTag = plugin.transform(srcTag, '/app/src/user.ts');
    expect(pluginOutTag).not.toBeNull();
    expect(norm(pluginOutTag!.code)).toContain('typeof input.bio === "string"');

    const pluginOutType = plugin.transform(srcType, '/app/src/user.ts');
    expect(pluginOutType).not.toBeNull();
    expect(norm(pluginOutType!.code)).toContain('typeof input.flag === "boolean"');
  });

  it('leaves code without validator calls completely untouched', () => {
    const plain = 'const a = 1 + 2; console.log(a);';
    expect(transformCode(plain)).toBe(plain);
    expect(transformSource(plain)).toBe(plain);
    expect(transformTypeChecks(plain)).toBe(plain);

    const plugin = zmdbAot() as { transform: (code: string, id: string) => { code: string } | null };
    expect(plugin.transform(plain, '/app/src/plain.ts')).toBeNull();
  });

  it('respects identifier boundary checks and does not match substrings', () => {
    const shadowed = 'const myValidate = customValidate(tags.Minimum(0), x); const axis = axis<{ a: number }>(y);';
    expect(transformCode(shadowed)).toBe(shadowed);
  });

  it('ignores calls inside single-line and multi-line comments', () => {
    const codeWithComments = `
      // const x = is<string>(val);
      /* const y = validate(tags.Minimum(5), z); */
      // validate(tags.MaxLength(10), s);
    `;
    expect(transformCode(codeWithComments)).toBe(codeWithComments);
  });

  it('ignores calls inside string literals', () => {
    const codeWithStrings = `
      const s1 = "validate(tags.Minimum(5), y)";
      const s2 = 'is<string>(x)';
      const s3 = \`validate(tags.MaxLength(10), str)\`;
    `;
    expect(transformCode(codeWithStrings)).toBe(codeWithStrings);
  });

  it('handles nested generic type arguments correctly without crashing or mis-transforming', () => {
    const codeWithNestedGenerics = `
      const a = is<Map<string, number>>(val);
      const b = validate<{ user: { name: string } }>(data);
    `;
    const transformed = transformCode(codeWithNestedGenerics);
    expect(transformed).toContain('is<Map<string, number>>(val)');
    expect(norm(transformed)).toContain('typeof data.user === "object"');
  });

  it('leaves a type it cannot fully parse alone rather than inlining a partial read of it', () => {
    // The type parser understands primitives and inline object literals. It used
    // to stop at the first thing it recognised and ignore the rest, so `string[]`
    // was inlined as `typeof x === "string"` and `number | string` as
    // `typeof x === "number"` — checks that answer a different question than the
    // one the caller asked. Now an unconsumed remainder aborts the parse and the
    // call goes to the runtime path.
    for (const src of [
      'const a = is<string[]>(x);',
      'const b = is<number | string>(x);',
      'const c = is<{ role: "admin" | "user" }>(x);',
      'const d = assert<boolean[]>(x);',
    ]) {
      expect(transformCode(src)).toBe(src);
    }
  });

  it('safely handles unknown constructs and unmapped target identifiers without throwing', () => {
    const unknownSrc = 'const result = unknownFunction<number>(x); const custom = customValidate(tags.Minimum(1), y);';
    expect(transformCode(unknownSrc)).toBe(unknownSrc);
  });

  it('measures transformation throughput for single-pass AST token scanner', () => {
    const sampleCode = `
      // comment validate(tags.Minimum(1), x)
      const a = "string with validate(tags.Minimum(1), x)";
      const ok1 = validate(tags.Minimum(10), input.price);
      const ok2 = is<{ name: string; age: number }>(input.user);
      const ok3 = assert<{ role: string }>(input.auth);
      const ok4 = validate(tags.Pattern("^[a-z]+$"), input.str);
      const ok5 = equals<{ flag: boolean }>(input.data);
    `.repeat(50);

    const start = performance.now();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      transformCode(sampleCode);
    }
    const elapsed = performance.now() - start;
    const totalBytes = sampleCode.length * iterations;
    const megabytes = totalBytes / (1024 * 1024);
    const seconds = elapsed / 1000;
    const mbPerSec = megabytes / seconds;

    expect(elapsed).toBeGreaterThan(0);
    expect(mbPerSec).toBeGreaterThan(1); // Ensure high-throughput scanning (>1 MB/s)
  });
});
