// `transformCode`: the half of the transformer that needs no compiler.
//
// One form survives here — `validate(tags.X(…), value)` — because it carries its own rule
// at the call site, so no type has to be resolved to inline it. Everything spelled with a
// type argument moved to `transformFile`, which asks the checker.
//
// That move is the point of this file as much as the tag rules are. There used to be a
// hand-rolled type parser in here, and `f70186c6` is what it cost: it read `string[]` as
// `string` and `number | string` as `number`, so a call got a check that answers a
// different question than the one asked, in a build that reported no problem. The tests
// below hold it to the stronger rule that replaced it — this function does not read type
// arguments at all — and to the scanner-level contracts that always mattered: an
// identifier is not a substring, and code inside a comment or a string is not code.

import { describe, expect, it } from 'vitest';

import { zmdbAot, transformTypeChecks } from './plugin/index.ts';
import { transformCode } from './transformer.ts';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('tag rules', () => {
  it.each([
    ['const ok = validate(tags.Minimum(10), input.price);', 'typeof input.price === "number" && input.price >= 10'],
    ['const ok = validate(tags.Maximum(10), input.price);', 'typeof input.price === "number" && input.price <= 10'],
    [
      'const ok = validate(tags.MaxLength(100), input.bio);',
      'typeof input.bio === "string" && input.bio.length <= 100',
    ],
    ['const ok = validate(tags.MinLength(2), input.bio);', 'typeof input.bio === "string" && input.bio.length >= 2'],
    ['const ok = validate(tags.Enum("a","b"), input.role);', 'input.role === "a" || input.role === "b"'],
  ])('inlines %s', (source, expected) => {
    const out = transformCode(source);
    expect(norm(out)).toContain(expected);
    expect(out).not.toContain('validate(tags.');
  });

  it('is the same function the plugin uses when it has no project', () => {
    const source = 'const ok = validate(tags.MaxLength(100), input.bio);';
    expect(transformTypeChecks(source)).toBe(transformCode(source));
    expect(zmdbAot().transform(source, '/app/src/user.ts')?.code).toBe(transformCode(source));
  });
});

describe('type arguments', () => {
  // These all used to be inlined by a text parser. Every one of them is now left for the
  // checker-driven path, which either understands the type exactly or names a refusal.
  it.each([
    'const a = is<{ n: number }>(input);',
    'const b = is<string[]>(x);',
    'const c = is<number | string>(x);',
    'const d = is<Map<string, number>>(val);',
    'const e = assert<{ role: string }>(input.auth);',
    'const f = equals<{ flag: boolean }>(input.data);',
    'const g = assertEquals<User>(input);',
    'const h = random<User>();',
  ])('leaves %s to the checker', source => {
    expect(transformCode(source)).toBe(source);
  });

  it('skips a `validate` call that has a type argument', () => {
    // `validate<T>(x)` and `validate(rule, x)` are different calls that happen to share a
    // name. Only the second one is readable without types.
    const source = 'const b = validate<{ user: { name: string } }>(data);';
    expect(transformCode(source)).toBe(source);
  });
});

describe('the scanner', () => {
  it('leaves code without validator calls byte-for-byte alone', () => {
    const plain = 'const a = 1 + 2; console.log(a);';
    expect(transformCode(plain)).toBe(plain);
    expect(zmdbAot().transform(plain, '/app/src/plain.ts')).toBeNull();
  });

  it('matches whole identifiers, not substrings', () => {
    const shadowed = 'const myValidate = customValidate(tags.Minimum(0), x); const axis = axis<{ a: number }>(y);';
    expect(transformCode(shadowed)).toBe(shadowed);
  });

  it('ignores calls inside comments', () => {
    const source = `
      // const x = validate(tags.Minimum(5), z);
      /* const y = validate(tags.Minimum(5), z); */
      // validate(tags.MaxLength(10), s);
    `;
    expect(transformCode(source)).toBe(source);
  });

  it('ignores calls inside string and template literals', () => {
    const source = `
      const s1 = "validate(tags.Minimum(5), y)";
      const s2 = 'validate(tags.Minimum(5), y)';
      const s3 = \`validate(tags.MaxLength(10), str)\`;
    `;
    expect(transformCode(source)).toBe(source);
  });

  it('does not throw on constructs it has no opinion about', () => {
    const source = 'const result = unknownFunction<number>(x); const custom = customValidate(tags.Minimum(1), y);';
    expect(transformCode(source)).toBe(source);
  });

  it('scans faster than a megabyte a second', () => {
    // Every module in a build goes through this whether or not it contains a call, so the
    // cost of finding nothing is the cost that matters.
    const sample = `
      // comment validate(tags.Minimum(1), x)
      const a = "string with validate(tags.Minimum(1), x)";
      const ok1 = validate(tags.Minimum(10), input.price);
      const ok2 = is<{ name: string; age: number }>(input.user);
      const ok3 = assert<{ role: string }>(input.auth);
      const ok4 = validate(tags.Pattern("^[a-z]+$"), input.str);
      const ok5 = equals<{ flag: boolean }>(input.data);
    `.repeat(50);

    const iterations = 100;
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) transformCode(sample);
    const seconds = (performance.now() - start) / 1000;
    const megabytes = (sample.length * iterations) / (1024 * 1024);
    expect(megabytes / seconds).toBeGreaterThan(1);
  });
});
