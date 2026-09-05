// Phase 7a's gate: REQ-TF-10, as an equality between the emitter and the function it stands
// in for.
//
// `schemaOf<User>()` is compiled away to a frozen object literal, and the emitter gets there
// by a route of its own: it calls `schemaFromIR`, prints the result with `JSON.stringify`, and
// what ships is that *text*, re-parsed by whatever loads the bundle. So the claim worth
// testing is that the round trip through source text lands on the object `schemaFromIR`
// returns — a printer that dropped a field, reordered a key or turned an empty array into an
// absent one would produce a schema the query compiler reads differently.
//
// `@zmdb/aot-validator/testing` is the other side: it reflects the same interfaces and calls
// the same `schemaFromIR` in-process. Same input, same function, one of the two through a
// serialiser.
//
// The fixture is transformed and then *run*, so what is asserted is the object the bundle
// ships, not an intermediate the emitter happened to hold.

import { readFileSync } from 'node:fs';

import type { CoreSchema } from '@zmdb/schema-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { schemasFrom } from '../testing/index.js';
import { transformFile } from '../transformer.js';
import { ReflectSession } from './session.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
const FILE = `${FIXTURES}schema-values.ts`;
const REFUSALS = `${FIXTURES}schema-values-refusals.ts`;

/** The same two tables, reflected in-process rather than emitted. */
const { Membership: memberships, User: users } = schemasFrom(`${FIXTURES}tables.ts`, ['User', 'Membership'], {
  project: PROJECT,
});

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

describe('the emitted schema value vs schemaFromIR (REQ-TF-10)', () => {
  for (const [label, reflected] of [
    ['users', users],
    ['memberships', memberships],
  ] as const) {
    it(`${label} survives the trip through source text`, () => {
      expect(generated(label)).toEqual(reflected);
    });

    it(`${label} carries its IR, not just the projection of it`, () => {
      // The field the decoders, the wire codecs and the OpenAPI document read. Asserted on
      // its own as well as inside the whole-value comparison above, because it is the one
      // part a printer could plausibly drop — it is nested, it is the largest thing in the
      // literal, and nothing about the table's DDL would change if it went missing.
      expect(generated(label).ir).toEqual(reflected.ir);
      expect(generated(label).ir.table).toBe(label);
    });

    it(`${label} agrees on the table name and the primary key`, () => {
      expect(generated(label).table).toBe(reflected.table);
      expect(generated(label).primaryKey).toEqual(reflected.primaryKey);
      expect(Object.keys(generated(label).columns)).toEqual(Object.keys(reflected.columns));
    });
  }

  it('covers every schema the fixture emits', () => {
    expect([...schemas.keys()].toSorted()).toEqual(['memberships', 'users', 'users:again']);
  });

  it('carries resolved physical names through generated schema values', () => {
    const named = new Map<string, CoreSchema<string>>();
    const result = transformFile(FILE, readFileSync(FILE, 'utf8'), {
      session,
      reflect: {
        naming: {
          table: declared => `${declared}_physical`,
          column: property => (property === 'createdAt' ? 'created_at' : property),
        },
      },
    });
    expect(result.diagnostics).toEqual([]);
    evaluate(result.code, (label, value) => named.set(label, value));

    const generatedUsers = named.get('users');
    expect(generatedUsers).toBeDefined();
    expect(generatedUsers?.table).toBe('users_physical');
    expect(Object.keys(generatedUsers?.columns ?? {})).toContain('created_at');
    expect(generatedUsers?.ir.physicalTable).toBe('users_physical');
    expect(generatedUsers?.ir.columns.find(column => column.name === 'createdAt')?.physicalName).toBe('created_at');
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
    // And the IR, which is deeper still: an array of objects, each with an object inside it.
    expect(Object.isFrozen(value.ir)).toBe(true);
    expect(Object.isFrozen(value.ir.columns)).toBe(true);
    expect(Object.isFrozen(value.ir.columns[0])).toBe(true);
    expect(Object.isFrozen(value.ir.columns[0]?.constraints)).toBe(true);
  });

  it('carries the sensitive flag', () => {
    // Unlike a JSON Schema document, a schema value keeps its sensitive columns — it is
    // never published, and the repository needs the column to redact it (REQ-TF-6).
    expect(generated('users').columns.passwordHash?.flags.sensitive).toBe(true);
  });
});

describe('a declaration a table cannot be made of (REQ-TF-8)', () => {
  it('refuses a missing table name, and a missing primary key, and leaves both calls alone', () => {
    const source = readFileSync(REFUSALS, 'utf8');
    const result = transformFile(REFUSALS, source, { session });

    const reasons = result.diagnostics.map(d => d.reason);
    expect(reasons).toContain("no Table<'name'> tag; the table name cannot be guessed from the type name");
    // The rule `defineSchema` used to enforce with a synchronous `SchemaError`, moved to the
    // one place that reads a table declaration. Earlier than the constructor was, and it names
    // the table rather than the call.
    expect(reasons.find(reason => reason.includes('PrimaryKey'))).toContain('WHERE clause');
    expect(result.diagnostics.every(one => one.callee === 'schemaOf')).toBe(true);
    // Neither is rewritten, so the build fails loudly at the diagnostic rather than quietly
    // shipping a schema for a table called `Untagged` or one nothing can address a row in.
    expect(result.code).toContain('schemaOf<Untagged>()');
    expect(result.code).toContain('schemaOf<Ledger>()');
  });
});
