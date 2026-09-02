// Phase 7a's gate: REQ-TF-10, as an equality against a value the SQL suite already trusts.
//
// `schemaOf<User>()` is compiled away to a frozen object literal. The claim is that the
// literal is the *same* schema value the `defineSchema` twin would have produced, and the
// comparison is made against `schemaFromIR(irFromSchema(users))` on purpose: that exact
// expression is what `packages/repository/src/generated-schema.spec.ts` proves compiles
// byte-identical DDL and byte-identical CRUD to `users` itself, in all three dialects. So
// this file closes a chain rather than starting a new corpus — emitted literal ≡ generated
// value ≡ authored value, and every SQL test in the repo covers the tagged front-end.
//
// The fixture is transformed and then *run*, so what is asserted is the object the bundle
// ships, not an intermediate the emitter happened to hold.

import { readFileSync } from 'node:fs';

import type { CoreSchema } from '@zmdb/schema-core';
import { irFromSchema, schemaFromIR } from '@zmdb/schema-core/ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transformFile } from '../transformer.ts';
import { memberships, users } from './__fixtures__/equivalence-schemas.ts';
import { ReflectSession } from './session.ts';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
const FILE = `${FIXTURES}schema-values.ts`;
const REFUSALS = `${FIXTURES}schema-values-refusals.ts`;

let session: ReflectSession;
/** label → the schema value the *emitted module* handed to `schema()`. */
const schemas = new Map<string, CoreSchema<string>>();
let emitted = '';

/** Strip what `new Function` cannot take: module syntax and type-only lines. */
function evaluate(code: string, collect: (label: string, value: CoreSchema<string>) => void): void {
  const body = code
    .replace(/^import\b[^;]*;\s*$/gm, '')
    .replace(/^declare\b.*$/gm, '')
    .replace(/^interface[\s\S]*?^}$/gm, '');
  const run = new Function('schema', body) as (fn: typeof collect) => void;
  run(collect);
}

beforeAll(() => {
  session = ReflectSession.open({ project: PROJECT });

  for (const file of [FILE, REFUSALS]) {
    const diagnostics = session.diagnostics(file);
    if (diagnostics.length > 0) {
      throw new Error(`${file} has ${diagnostics.length} semantic diagnostic(s): ${JSON.stringify(diagnostics[0])}`);
    }
  }

  const result = transformFile(FILE, readFileSync(FILE, 'utf8'), { session });
  if (result.diagnostics.length > 0) {
    throw new Error(`the transform refused a site: ${JSON.stringify(result.diagnostics)}`);
  }
  if (!result.changed) throw new Error('the transform left schema-values.ts unchanged');
  emitted = result.code;

  evaluate(emitted, (label, value) => schemas.set(label, value));
});

afterAll(() => session?.close());

function generated(label: string): CoreSchema<string> {
  const value = schemas.get(label);
  expect(value, `the emitted module produced no schema for ${label}`).toBeDefined();
  return value as CoreSchema<string>;
}

describe('schemaOf<T>() vs defineSchema (REQ-TF-10)', () => {
  for (const [label, authored] of [
    ['users', users],
    ['memberships', memberships],
  ] as const) {
    it(`${label} is the schema value its twin generates`, () => {
      expect(generated(label)).toEqual(schemaFromIR(irFromSchema(authored)));
    });

    it(`${label} round-trips to the twin's IR`, () => {
      // The stronger reading of the same claim, and the one that fails informatively:
      // `irFromSchema` is where a difference in a flag, a rule or a foreign key surfaces
      // as a difference in a named field rather than in a diff of two nested objects.
      expect(irFromSchema(generated(label))).toEqual(irFromSchema(authored));
    });

    it(`${label} agrees on the table name and the primary key`, () => {
      expect(generated(label).table).toBe(authored.table);
      expect(generated(label).primaryKey).toEqual(authored.primaryKey);
      expect(Object.keys(generated(label).columns)).toEqual(Object.keys(authored.columns));
    });
  }

  it('covers every schema the fixture emits', () => {
    expect([...schemas.keys()].toSorted()).toEqual(['memberships', 'users', 'users:again']);
  });
});

describe('what the emitted module contains', () => {
  it('leaves no call to schemaOf behind', () => {
    // The whole reason `schemaOf` throws when it is reached: after the transform it never
    // is. The only mention left is an import nothing uses, which is what lets a bundler
    // drop `@zmdb/schema-core` from a build that only declared tables.
    const code = emitted
      .split('\n')
      .map(line => line.trim())
      .filter(line => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
    expect(code.filter(line => line.includes('schemaOf'))).toEqual(["import { schemaOf } from '@zmdb/schema-core';"]);
  });

  it('hoists one frozen constant per distinct schema and shares it', () => {
    const distinct = new Set([...schemas.values()].map(value => JSON.stringify(value)));
    const constants = emitted.match(/Schema\d+ = /g) ?? [];
    expect(constants.length).toBe(distinct.size);
    expect(generated('users')).toBe(generated('users:again'));
  });

  it('freezes the schema all the way down', () => {
    // A schema value is read by every query the repository compiles, so a shared mutable
    // one is a way for one call site to change another's SQL.
    const value = generated('users');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.columns)).toBe(true);
    expect(Object.isFrozen(value.primaryKey)).toBe(true);
    const email = value.columns.email;
    expect(email).toBeDefined();
    expect(Object.isFrozen(email)).toBe(true);
    expect(Object.isFrozen(email?.flags)).toBe(true);
    // The deepest thing in a schema value, and the reason the helper recurses instead of
    // calling `Object.freeze` once.
    expect(Object.isFrozen(email?.validation)).toBe(true);
  });

  it('carries the sensitive flag', () => {
    // Unlike a JSON Schema document, a schema value keeps its sensitive columns — it is
    // never published, and the repository needs the column to redact it (REQ-TF-6).
    expect(generated('users').columns.passwordHash?.flags.sensitive).toBe(true);
  });
});

describe('a type with no table name (REQ-TF-8)', () => {
  it('is refused by name, and the call is left alone', () => {
    const source = readFileSync(REFUSALS, 'utf8');
    const result = transformFile(REFUSALS, source, { session });

    expect(result.diagnostics.map(d => d.reason)).toContain(
      "no Table<'name'> tag; the table name cannot be guessed from the type name",
    );
    expect(result.diagnostics[0]?.callee).toBe('schemaOf');
    // Not rewritten, so the build fails loudly at the diagnostic rather than quietly
    // shipping a schema for a table called `Untagged`.
    expect(result.code).toContain('schemaOf<Untagged>()');
  });
});
