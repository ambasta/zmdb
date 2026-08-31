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
});
