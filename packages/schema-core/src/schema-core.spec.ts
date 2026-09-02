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

import { schemaOf, ValidationError, type ValidationIssue } from './index.ts';

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
