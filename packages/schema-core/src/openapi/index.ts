// JSON Schema / OpenAPI generation — implementation.
// #64 toJsonSchema scalar/enum/nullable (+ tag mapping and variant/aggregation
// logic that the shared golden suite exercises). Build-time, no reflection.
//
// The scalar/variant walk used to live here as `scalarSchema` — one of the four
// independent walkers over column metadata catalogued in `PLAN-type-first.md` §1.
// It now delegates to `../ir`, so a schema value and a tagged type cannot produce
// different documents: both become `SchemaIR` first, and the emitter is a pure
// function of that (REQ-TF-7). What is left in this file is the OpenAPI framing —
// components, list/search envelopes, naming — which is genuinely its own concern.
import type { CoreSchema } from '../index.ts';
import { irFromSchema, jsonSchemaFromIR, type JsonSchemaObject, type Variant } from '../ir/index.ts';

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
/** The document for a schema value and a named variant. Deleted with `defineSchema`. */
export function toJsonSchema(schema: CoreSchema<string>, variant?: Variant): JsonSchemaObject;
export function toJsonSchema(schema?: CoreSchema<string>, variant: Variant = 'entity'): JsonSchemaObject {
  if (!schema) {
    throw new Error(
      'toJsonSchema<T>() was not replaced at build time. It is compiled away by the zmdb transform ' +
        '(the unplugin, or `zmdb-codegen`), which did not run over this file — a type argument cannot ' +
        'be read at runtime, so there is nothing to fall back to.',
    );
  }
  return jsonSchemaFromIR(irFromSchema(schema), variant);
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

function pascalCase(table: string): string {
  return table
    .split(/[-_]+/)
    .map(word => singularizeWord(word))
    .map(word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join('');
}

// #66 — DTO-aware generation + relation $refs.
// Relations are emitted only for the `entity` (response) variant, never for
// create/update input bodies. to-one → $ref; to-many → array of $ref.
interface RelationLike {
  readonly cardinality: 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
  readonly target: string;
}
export function toJsonSchemaWithRelations(
  schema: CoreSchema<string>,
  relations: Record<string, RelationLike>,
  variant: Variant = 'entity',
): JsonSchemaObject {
  const base = toJsonSchema(schema, variant);
  if (variant !== 'entity') return base; // input bodies exclude relations
  const properties: Record<string, unknown> = { ...base.properties };
  for (const [name, rel] of Object.entries(relations)) {
    const ref = { $ref: `#/components/schemas/${pascalCase(rel.target)}` };
    const toMany = rel.cardinality === 'one-to-many' || rel.cardinality === 'many-to-many';
    properties[name] = toMany ? { type: 'array', items: ref } : ref;
  }
  return { type: 'object', properties, required: base.required };
}

export function toOpenApiComponents(schemas: readonly CoreSchema<string>[]): {
  schemas: Record<string, JsonSchemaObject>;
} {
  const out: Record<string, JsonSchemaObject> = {};
  for (const s of [...schemas].toSorted((a, b) => a.table.localeCompare(b.table))) {
    out[pascalCase(s.table)] = toJsonSchema(s, 'entity');
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
