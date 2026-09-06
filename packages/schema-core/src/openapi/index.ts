// JSON Schema / OpenAPI generation — implementation.
// #64 toJsonSchema scalar/enum/nullable (+ tag mapping and variant/aggregation
// logic that the shared golden suite exercises). Build-time, no reflection.
//
// The scalar/variant walk used to live here as `scalarSchema` — one of the four
// independent walkers over column metadata catalogued in `PLAN-type-first.md` §1.
// It now delegates to `../ir`, so naming a variant and naming a derived type cannot
// produce different documents: both are read off the same `SchemaIR`, and the emitter is
// a pure function of it (REQ-TF-7). What is left in this file is the OpenAPI framing —
// components, list/search envelopes, naming — which is genuinely its own concern.
import { singularPascalCase } from '@zmdb/query-compiler/naming';

import type { CoreSchema } from '../index.js';
import { jsonSchemaFromIR, type JsonSchemaObject, type Variant } from '../ir/index.js';

export type { JsonSchemaObject, Variant };

/**
 * The document for a type, computed at build time (REQ-TF-7).
 *
 * `toJsonSchema<ReadDTO<User>>()` is replaced by the document itself — an object
 * literal, frozen, with no schema value and no reflection left in the bundle. The
 * variant is the type argument rather than a string, so `toJsonSchema<CreateDTO<User>>()`
 * is the create body and `toJsonSchema<Pick<Entity<User>, 'id' | 'email'>>()` is a
 * projection nothing in the string-variant vocabulary could express.
 *
 * Untransformed it throws, and that is the design (plan D4). There is no honest
 * fallback: the document is a function of a type, types do not exist at runtime, and the
 * alternatives are to return something wrong or to ask the caller to hand over the very
 * thing the call exists to compute. A build that skipped the transform should fail
 * loudly at the first call, not serve a plausible document.
 */
// oxlint-disable-next-line no-unused-vars -- `T` is the whole input; it has nowhere else to appear
export function toJsonSchema<T>(): JsonSchemaObject;
/** The document for a schema value and a named variant. */
export function toJsonSchema(schema: CoreSchema<string>, variant?: Variant): JsonSchemaObject;
export function toJsonSchema(schema?: CoreSchema<string>, variant: Variant = 'entity'): JsonSchemaObject {
  if (!schema) {
    throw new Error(
      'toJsonSchema<T>() was not replaced at build time. It is compiled away by @zmdb/compiler ' +
        '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
        'be read at runtime, so there is nothing to fall back to.',
    );
  }
  return jsonSchemaFromIR(schema.ir, variant);
}

/**
 * The `components.schemas` key for a table, and the target of every `$ref` that points at
 * it: singularized, then PascalCase. `user_addresses` → `UserAddress`.
 *
 * Exported because it is the only way to write a `$ref` by hand that resolves against a
 * document this module produced, and because it is the whole subject of
 * `singularization.spec.ts` — which used to reach it by declaring twenty schemas whose only
 * distinguishing feature was the table name.
 */
export function componentName(table: string): string {
  return singularPascalCase(table);
}

/**
 * The entity schema with a `$ref` per relation: a to-one refs the target component, a to-many
 * is an array of them.
 *
 * Relations reach the `entity` (response) variant only. A create or update body is columns,
 * and a `$ref` to a whole entity in one would say the client may post a nested graph, which
 * no write path here accepts.
 *
 * There used to be a second parameter — a `Record<string, RelationLike>` naming each relation
 * and its target table — because a schema value carried no relations for this to read. It
 * carries them now, on `schema.ir`, so a document generated from a set of schemas can no
 * longer disagree with the tables about which relations exist. The kinds are the IR's
 * (`oneToMany`, not `one-to-many`).
 */
export function toJsonSchemaWithRelations(schema: CoreSchema<string>, variant: Variant = 'entity'): JsonSchemaObject {
  const base = toJsonSchema(schema, variant);
  if (variant !== 'entity') return base; // input bodies exclude relations
  const properties: Record<string, unknown> = { ...base.properties };
  for (const rel of schema.ir.relations) {
    const ref = { $ref: `#/components/schemas/${componentName(rel.target)}` };
    const toMany = rel.relation === 'oneToMany' || rel.relation === 'manyToMany';
    properties[rel.name] = toMany ? { type: 'array', items: ref } : ref;
  }
  return { type: 'object', properties, required: base.required };
}

export function toOpenApiComponents(schemas: readonly CoreSchema<string>[]): {
  schemas: Record<string, JsonSchemaObject>;
} {
  const out: Record<string, JsonSchemaObject> = {};
  for (const s of [...schemas].toSorted((a, b) => a.ir.table.localeCompare(b.ir.table))) {
    out[componentName(s.ir.table)] = toJsonSchema(s, 'entity');
  }
  return { schemas: out };
}

// #175 — read-variant envelopes. list wraps the entity in a paged envelope;
// search adds an optional _score to each item. Build-time, deterministic.
export interface EnvelopeSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}
export function toListSchema(schema: CoreSchema<string>): EnvelopeSchema {
  const entity = toJsonSchema(schema, 'entity');
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: entity },
      total: { type: 'integer' },
      hasMore: { type: 'boolean' },
      cursor: { type: 'string' },
    },
    required: ['hasMore', 'items'],
  };
}
export function toSearchSchema(schema: CoreSchema<string>): EnvelopeSchema {
  const entity = toJsonSchema(schema, 'entity');
  const hit = {
    type: 'object',
    properties: { ...entity.properties, _score: { type: 'number' } },
    required: entity.required,
  };
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: hit },
      total: { type: 'integer' },
      hasMore: { type: 'boolean' },
      cursor: { type: 'string' },
    },
    required: ['hasMore', 'items'],
  };
}
