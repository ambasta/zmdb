// What is left of this file after the builder DSL was deleted.
//
// It used to be three describes over `serial()`, the eight modifiers and `defineSchema` — about
// 150 lines asserting that `integer()` returned `{ type: 'integer', flags: { nullable: false } }`
// and that `notNull(nullable(text()))` was the same object as `text().notNull()`. All of it went
// with the functions.
//
// One of those tests was load-bearing rather than mechanical: `defineSchema` threw a
// `SchemaError`, synchronously, when a column map had no primary key in it. That rule now lives
// where the table is declared — `Reflector.schemaIR` refuses a `Table<'name'>` with no
// `PrimaryKey` column, so it is a build error instead of a constructor throw, and
// `aot-validator/src/reflect/reflect.spec.ts` is where it is covered. `SchemaError` itself is
// gone: nothing threw it once `defineSchema` did not.

import { describe, it, expect } from 'vitest';

import {
  claimsValidationIssues,
  isRecord,
  schemaOf,
  validationIssuesOf,
  ValidationError,
  type ValidationIssue,
} from './index.js';
import { jsonSchemaForColumn, type ColumnIR } from './ir/index.js';

describe('schemaOf<T>()', () => {
  it('throws when the build transform did not run', () => {
    // The same bargain `toJsonSchema<T>()` makes. The schema is a function of a type
    // argument, and type arguments are gone at runtime, so the only alternatives are to
    // return an empty schema — which would compile SQL against a table with no columns —
    // or to say plainly that the build skipped a step.
    expect(() => schemaOf()).toThrow(/was not replaced at build time/);
  });
});

describe('ValidationError and ValidationIssue contract', () => {
  it('instantiates ValidationError with canonical issues', () => {
    const issue: ValidationIssue = {
      path: 'input.age',
      message: 'invalid value for "age"',
      expected: 'number',
      value: 'twenty',
    };
    const err = new ValidationError('validation failed', [issue]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('validation failed');
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]).toEqual(issue);
  });
});

describe('reading issues off a thrown value', () => {
  // What the HTTP adapters do with `catch (error: unknown)`. The two functions are separate on
  // purpose: the first decides whether this is a validation failure at all — which is what
  // picks 400 over 500 — and the second decides what of it is fit to put in the body.
  const issue: ValidationIssue = { path: 'input.age', message: 'expected number' };

  it('recognises a validation failure by what it carries, not by its class', () => {
    // Structural because a caller's own validator throws its own type. zod's `ZodError` and
    // io-ts's are `issues`-carrying objects that are not `ValidationError`, and an adapter that
    // asked `instanceof` would answer 500 for a request that was simply malformed.
    expect(claimsValidationIssues(new ValidationError('failed', [issue]))).toBe(true);
    expect(claimsValidationIssues({ issues: [issue] })).toBe(true);
    expect(claimsValidationIssues({ name: 'ZodError', issues: [] })).toBe(true);
    expect(claimsValidationIssues(new Error('boom'))).toBe(false);
    expect(claimsValidationIssues('boom')).toBe(false);
    expect(claimsValidationIssues(null)).toBe(false);
    expect(claimsValidationIssues(undefined)).toBe(false);
  });

  it('returns the issues that are actually issues, and drops the half-formed ones', () => {
    expect(validationIssuesOf(new ValidationError('failed', [issue]))).toEqual([issue]);
    // Every entry is checked rather than trusted: these are about to be serialized into a
    // response a client reads, and an `issues` that held strings used to be sent as though it
    // were the list. An entry missing a `path` or a `message` cannot be rendered, so it goes.
    expect(validationIssuesOf({ issues: [issue, 'not an issue', null, { path: 'x' }, { message: 'y' }] })).toEqual([
      issue,
    ]);
  });

  it('separates "not validation" from "validation, and it said nothing"', () => {
    // The distinction the two return values carry. `undefined` means the adapter should not
    // treat this as a 400 at all; `[]` means it should, and has no field-level detail to add.
    expect(validationIssuesOf(new ValidationError('failed', []))).toEqual([]);
    expect(validationIssuesOf({ issues: 'nope' })).toBeUndefined();
    expect(validationIssuesOf(new Error('boom'))).toBeUndefined();
    expect(validationIssuesOf(null)).toBeUndefined();

    // So the two functions can disagree, and the pair of answers is the useful thing: an error
    // that claims to be about validation and has nothing checkable in it is still a 400.
    const claimsButEmpty = { issues: ['not an issue'] };
    expect(claimsValidationIssues(claimsButEmpty)).toBe(true);
    expect(validationIssuesOf(claimsButEmpty)).toEqual([]);
  });
});

describe('isRecord', () => {
  it('is true for exactly the values a keyed read is safe on', () => {
    // The alternative to this predicate is `as Record<string, unknown>` at every boundary that
    // reads a property off an `unknown`, which ARCHITECTURE §2.1 forbids on the public surface.
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(new ValidationError('failed', []))).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    // An array is indexable and is not a record: `value.length` is not a field of a row, and
    // treating a JSON array body as an object is how an empty update used to be accepted.
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('a')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(() => 1)).toBe(false);
  });

  it('narrows, so the read after it needs no assertion', () => {
    const body: unknown = { age: 'twenty' };
    expect(isRecord(body) ? body.age : 'not a record').toBe('twenty');
  });
});

// Extension-type JSON Schema tests freeze (#424), against `./ir/SPEC.md` §4.3.
// The local widening reaches the real `jsonSchemaForColumn` at one boundary;
// the declaration-side app types are compile-only contracts in `json.type-test.ts`.
interface FrozenExtensionType {
  readonly extension: string;
  readonly name: string;
  readonly args?: readonly (string | number)[];
}

type FrozenExtensionColumn = Omit<ColumnIR, 'sql'> & {
  readonly sql: ColumnIR['sql'] | FrozenExtensionType;
};

const embeddingColumn: FrozenExtensionColumn = {
  name: 'embedding',
  sql: { extension: 'vector', name: 'vector', args: [1536] },
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
};

describe('extension-backed derived schema (frozen: ir/SPEC.md 4.3)', () => {
  // Actual at 24289df8: the closed SqlType switch has no matching arm and
  // returns an empty schema object.
  it.fails('derives number[] with the dimension as minItems and maxItems in JSON Schema', () => {
    expect(jsonSchemaForColumn(embeddingColumn as unknown as ColumnIR)).toEqual({
      type: 'array',
      items: { type: 'number' },
      minItems: 1536,
      maxItems: 1536,
    });
  });
});
