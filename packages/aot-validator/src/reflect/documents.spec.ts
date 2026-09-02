// Phase 6's gate: REQ-TF-7, as an equality rather than as a resemblance.
//
// `__fixtures__/documents.ts` asks for a JSON Schema document by type — `toJsonSchema<
// CreateDTO<User>>()` — and `__fixtures__/equivalence-schemas.ts` asks for the same
// document by schema value and variant name. This spec transforms the first, runs the
// emitted module, and compares what it produced against what the second produces.
//
// The comparison is on `JSON.stringify`, not `toEqual`: a document is published, so key
// order is part of it, and `toEqual` would pass on two objects that serialise to
// different bytes. Both sides go through `jsonSchemaFromShape`, so the sort that makes
// them agree lives in one place — this test is here to catch the day someone gives the
// tagged path a second generator, not to police a fragile ordering.

import { readFileSync } from 'node:fs';

import type { JsonSchemaObject } from '@zmdb/schema-core/ir';
import { toJsonSchema, type Variant } from '@zmdb/schema-core/openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { transformFile } from '../transformer.ts';
import { memberships, users } from './__fixtures__/equivalence-schemas.ts';
import { ReflectSession } from './session.ts';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const PROJECT = `${FIXTURES}tsconfig.json`;
const FILE = `${FIXTURES}documents.ts`;

let session: ReflectSession;
/** label → the document the *emitted module* handed to `document()`. */
const documents = new Map<string, JsonSchemaObject>();
let emitted = '';

beforeAll(() => {
  session = ReflectSession.open({ project: PROJECT });

  const diagnostics = session.diagnostics(FILE);
  if (diagnostics.length > 0) {
    throw new Error(`documents.ts has ${diagnostics.length} semantic diagnostic(s): ${JSON.stringify(diagnostics[0])}`);
  }

  const source = readFileSync(FILE, 'utf8');
  const result = transformFile(FILE, source, { session });
  if (result.diagnostics.length > 0) {
    throw new Error(`the transform refused a site: ${JSON.stringify(result.diagnostics)}`);
  }
  if (!result.changed) throw new Error('the transform left documents.ts unchanged');
  emitted = result.code;

  // The transform rewrites text and does not compile it, so the output is still
  // TypeScript. Two line kinds have to come out before `new Function` will take it: the
  // imports, because there is no module scope, and the `declare`, because it is a type.
  // Everything else in the fixture is a call, and every call was rewritten — had one been
  // left behind this would throw a `ReferenceError` and the test would say so.
  const body = emitted.replace(/^import\b[^;]*;\s*$/gm, '').replace(/^declare\b.*$/gm, '');
  const run = new Function('document', body) as (fn: (label: string, doc: JsonSchemaObject) => void) => void;
  run((label, doc) => documents.set(label, doc));
});

afterAll(() => session?.close());

function generated(label: string): JsonSchemaObject {
  const document = documents.get(label);
  expect(document, `the emitted module produced no document for ${label}`).toBeDefined();
  return document as JsonSchemaObject;
}

/** label → the schema value and variant that must produce the identical document. */
const PAIRS: readonly (readonly [string, { readonly table: string }, Variant])[] = [
  ['users:entity', users, 'entity'],
  ['users:create', users, 'create'],
  ['users:update', users, 'update'],
  // `ReadDTO<User>` drops the sensitive column from the type; the `entity` variant keeps
  // it and the emitter drops it. Same document, by two different routes to REQ-TF-6.
  ['users:read', users, 'entity'],
  ['memberships:entity', memberships, 'entity'],
  ['memberships:create', memberships, 'create'],
  ['memberships:update', memberships, 'update'],
  ['memberships:read', memberships, 'entity'],
];

describe('toJsonSchema<T> vs toJsonSchema(schema, variant) (REQ-TF-7)', () => {
  for (const [label, schema, variant] of PAIRS) {
    it(`${label} is byte-identical to the ${variant} variant of ${schema.table}`, () => {
      const expected = toJsonSchema(schema as never, variant);
      expect(JSON.stringify(generated(label))).toBe(JSON.stringify(expected));
    });
  }

  it('covers every document the fixture emits', () => {
    // A `toJsonSchema<T>()` added to the fixture and forgotten here would otherwise be
    // transformed, evaluated and never looked at.
    expect([...documents.keys()].toSorted()).toEqual(
      [...PAIRS.map(([label]) => label), 'users:entity:again', 'users:projection'].toSorted(),
    );
  });

  it('describes a projection no variant name can ask for', () => {
    expect(generated('users:projection')).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string', maxLength: 255, pattern: '^\\S+@\\S+$' },
        id: { type: 'integer' },
      },
      required: ['email', 'id'],
    });
  });
});

describe('what the emitted module contains (REQ-TF-6)', () => {
  it('never names a sensitive column, in any document or anywhere in the output', () => {
    for (const [label, document] of documents) {
      expect(Object.keys(document.properties), label).not.toContain('passwordHash');
    }
    // Including the hoisted literals and the comments: a `Sensitive` column name in a
    // published document is the failure this requirement exists to prevent, and the
    // whole file is what gets published.
    expect(emitted).not.toContain('passwordHash');
  });

  it('leaves no call to toJsonSchema behind', () => {
    // The document is data by the time the bundle exists. Every call site is now a
    // reference to a hoisted literal, so the only mention left outside the comments is an
    // import nothing uses — which is what lets a bundler drop `@zmdb/schema-core` entirely.
    const code = emitted
      .split('\n')
      .map(line => line.trim())
      .filter(line => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
    expect(code.filter(line => line.includes('toJsonSchema'))).toEqual([
      "import { toJsonSchema } from '@zmdb/schema-core/openapi';",
    ]);
  });

  it('hoists one frozen constant per distinct document and shares it', () => {
    const distinct = new Set([...documents.values()].map(document => JSON.stringify(document)));
    const constants = emitted.match(/JsonSchema\d+ = /g) ?? [];
    expect(constants.length).toBe(distinct.size);
    // Sharing is what makes freezing load-bearing rather than tidy: these three labels
    // are the *same object*, so one consumer mutating it would be visible to the others.
    expect(generated('users:entity')).toBe(generated('users:entity:again'));
    expect(generated('users:entity')).toBe(generated('users:read'));
  });

  it('freezes the document all the way down', () => {
    const document = generated('users:entity');
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.properties)).toBe(true);
    expect(Object.isFrozen(document.required)).toBe(true);
    expect(Object.isFrozen(document.properties.role)).toBe(true);
    // The `enum` array inside a property is the deepest thing in a document, and the
    // reason the helper recurses instead of calling `Object.freeze` once.
    expect(Object.isFrozen((document.properties.role as { enum: string[] }).enum)).toBe(true);
  });
});
