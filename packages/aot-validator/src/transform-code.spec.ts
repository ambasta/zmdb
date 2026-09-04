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

import { zmdbAot, transformTypeChecks } from './plugin/index.js';
import { CALLEES, Rewriter, transformCode } from './transformer.js';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('tag rules', () => {
  it.each([
    ['const ok = validate(tags.Min(10), input.price);', 'typeof input.price === "number" && input.price >= 10'],
    ['const ok = validate(tags.Max(10), input.price);', 'typeof input.price === "number" && input.price <= 10'],
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
    const shadowed = 'const myValidate = customValidate(tags.Min(0), x); const axis = axis<{ a: number }>(y);';
    expect(transformCode(shadowed)).toBe(shadowed);
  });

  it('ignores calls inside comments', () => {
    const source = `
      // const x = validate(tags.Min(5), z);
      /* const y = validate(tags.Min(5), z); */
      // validate(tags.MaxLength(10), s);
    `;
    expect(transformCode(source)).toBe(source);
  });

  it('ignores calls inside string and template literals', () => {
    const source = `
      const s1 = "validate(tags.Min(5), y)";
      const s2 = 'validate(tags.Min(5), y)';
      const s3 = \`validate(tags.MaxLength(10), str)\`;
    `;
    expect(transformCode(source)).toBe(source);
  });

  it('does not throw on constructs it has no opinion about', () => {
    const source = 'const result = unknownFunction<number>(x); const custom = customValidate(tags.Min(1), y);';
    expect(transformCode(source)).toBe(source);
  });

  it('scans faster than a megabyte a second', () => {
    // Every module in a build goes through this whether or not it contains a call, so the
    // cost of finding nothing is the cost that matters.
    const sample = `
      // comment validate(tags.Min(1), x)
      const a = "string with validate(tags.Min(1), x)";
      const ok1 = validate(tags.Min(10), input.price);
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

describe('CALLEES', () => {
  it('names every transformed call, and every one of them is a function somebody can call', async () => {
    // The list is matched by identifier text, so a typo in it is not a type error anywhere:
    // `assertEqual` would simply never match, the call would stay a runtime walk, and the
    // build would report success. Resolving each name against the module that exports it is
    // what turns that back into a failure.
    expect([...CALLEES].toSorted()).toEqual([
      'assert',
      'assertEquals',
      'equals',
      'is',
      'protoDescriptor',
      'random',
      'schemaOf',
      'toJsonSchema',
      'validate',
    ]);

    const utilities = await import('./utilities/index.js');
    const validator = await import('./index.js');
    const core = await import('@zmdb/schema-core');
    const openapi = await import('@zmdb/schema-core/openapi');
    const surface: Record<string, unknown> = { ...openapi, ...core, ...utilities, ...validator };
    for (const callee of CALLEES) {
      expect(typeof surface[callee], `${callee} is in CALLEES but nothing exports it`).toBe('function');
    }
  });
});

describe('Rewriter', () => {
  // `transformFile` hands the emitter offsets the compiler produced, which are coordinates in
  // the *original* text, and then edits the buffer under them. Every test here is about that
  // one hazard: an offset stays meaningful after the text it points past has changed length.
  it('reads a span in original coordinates after an edit further along', () => {
    const rewriter = new Rewriter('const a = f(1); const b = g(2);');
    rewriter.replace(28, 29, '222222');
    expect(rewriter.slice(10, 14)).toBe('f(1)');
    expect(rewriter.text).toBe('const a = f(1); const b = g(222222);');
  });

  it('applies independent edits given in descending order', () => {
    const rewriter = new Rewriter('a(1) + b(2) + c(3)');
    rewriter.replace(14, 18, 'C');
    rewriter.replace(7, 11, 'B');
    rewriter.replace(0, 4, 'A');
    expect(rewriter.text).toBe('A + B + C');
  });

  it('folds a nested edit into the one that contains it, rather than counting it twice', () => {
    // The case that makes this a class instead of two string concatenations: an inner call is
    // rewritten first, then the outer call is rewritten from text that already contains the
    // inner result. A naive shift table would add the inner delta a second time and cut the
    // buffer four characters short of where the outer span now ends.
    const rewriter = new Rewriter('const ok = outer(inner(x));');
    rewriter.replace(17, 25, 'INNERRESULT');
    expect(rewriter.slice(11, 26)).toBe('outer(INNERRESULT)');
    rewriter.replace(11, 26, `(${rewriter.slice(11, 26)})`);
    expect(rewriter.text).toBe('const ok = (outer(INNERRESULT));');
  });

  it('leaves text it was never asked to change exactly as it was given', () => {
    // Offsets rather than a printed AST is a deliberate choice, and this is the property it
    // buys: comments, blank lines and formatting are not the transformer's to normalise.
    const source = '// keep me\n\nconst  a   =  1;\n';
    const rewriter = new Rewriter(source);
    expect(rewriter.text).toBe(source);
    expect(rewriter.slice(0, source.length)).toBe(source);
  });
});
