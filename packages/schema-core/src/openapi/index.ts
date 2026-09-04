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
      'toJsonSchema<T>() was not replaced at build time. It is compiled away by the zmdb transform ' +
        '(the unplugin, or `zmdb-codegen`), which did not run over this file — a type argument cannot ' +
        'be read at runtime, so there is nothing to fall back to.',
    );
  }
  return jsonSchemaFromIR(schema.ir, variant);
}

function singularizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  // 1. Invariant / already singular endings or specific singular words ending in 's'
  if (
    lower.endsWith('ss') ||
    lower.endsWith('us') ||
    lower.endsWith('is') ||
    lower.endsWith('as') ||
    lower.endsWith('os') ||
    lower === 'series' ||
    lower === 'species' ||
    lower === 'news' ||
    lower === 'lens'
  ) {
    return word;
  }

  // 2. Irregular plurals
  if (lower === 'people') return 'person';
  if (lower === 'children') return 'child';
  if (lower === 'men') return 'man';
  if (lower === 'women') return 'woman';
  if (lower === 'matrices') return 'matrix';
  if (lower === 'indices') return 'index';

  // 3. Plurals ending in -ies (preceded by consonant, e.g. categories -> category)
  if (/([^aeiou])ies$/i.test(word)) {
    return word.slice(0, -3) + 'y';
  }

  // 4. Plurals ending in -ves (e.g. shelves -> shelf, knives -> knife, wives -> wife, leaves -> leaf)
  if (/lves$/i.test(word)) {
    return word.slice(0, -4) + 'lf';
  }
  if (/(kn|w)ives$/i.test(word)) {
    return word.slice(0, -4) + 'ife';
  }
  if (/eaves$/i.test(word)) {
    return word.slice(0, -5) + 'eaf';
  }

  // 5. Plurals ending in -es after sibilants or special endings
  // e.g. addresses -> address, processes -> process, statuses -> status, aliases -> alias
  if (/sses$/i.test(word) || /statuses$/i.test(word) || /aliases$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (/ises$/i.test(word)) {
    return word.slice(0, -4) + 'is';
  }
  // e.g. boxes -> box, churches -> church, dishes -> dish, quizzes -> quiz
  if (/(xes|ches|shes|zzes)$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (/([aeiou])zes$/i.test(word)) {
    return word.slice(0, -1);
  }

  // 6. Generic trailing -s trimming (e.g. users -> user, orders -> order, houses -> house, cases -> case)
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }

  return word;
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
  return table
    .split(/[-_]+/)
    .map(word => singularizeWord(word))
    .map(word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join('');
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
  for (const s of [...schemas].toSorted((a, b) => a.table.localeCompare(b.table))) {
    out[componentName(s.table)] = toJsonSchema(s, 'entity');
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
