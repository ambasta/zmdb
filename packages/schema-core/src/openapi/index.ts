// JSON Schema / OpenAPI generation — implementation.
// #64 toJsonSchema scalar/enum/nullable (+ tag mapping and variant/aggregation
// logic that the shared golden suite exercises). Build-time, no reflection.
import type { CoreSchema, ColumnMeta } from '../index.ts';

export type Variant = 'entity' | 'create' | 'update' | 'get' | 'list' | 'search';

export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

function scalarSchema(col: ColumnMeta): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (col.type) {
    case 'serial':
    case 'integer':
      base = { type: 'integer' };
      break;
    case 'bigint':
      base = { type: 'integer', format: 'int64' };
      break;
    case 'numeric':
      base = { type: 'number' };
      break;
    case 'text':
    case 'varchar':
      base = { type: 'string' };
      if (col.flags.length !== undefined) base.maxLength = col.flags.length;
      break;
    case 'boolean':
      base = { type: 'boolean' };
      break;
    case 'timestamp':
      base = { type: 'string', format: 'date-time' };
      break;
    case 'jsonEnum':
      base = { type: 'string', enum: [...(col.flags.enum ?? [])] };
      break;
    case 'json':
    default:
      base = {};
      break;
  }

  // Validation-tag → JSON Schema keyword mapping.
  for (const rule of col.validation ?? []) {
    switch (rule.kind) {
      case 'minimum':
      case 'Minimum':
        base.minimum = rule.value ?? (rule as { args?: unknown[] }).args?.[0];
        break;
      case 'maximum':
      case 'Maximum':
        base.maximum = rule.value ?? (rule as { args?: unknown[] }).args?.[0];
        break;
      case 'minLength':
      case 'MinLength':
        base.minLength = rule.value ?? (rule as { args?: unknown[] }).args?.[0];
        break;
      case 'maxLength':
      case 'MaxLength':
        base.maxLength = rule.value ?? (rule as { args?: unknown[] }).args?.[0];
        break;
      case 'pattern':
      case 'Pattern':
        base.pattern = rule.value ?? (rule as { args?: unknown[] }).args?.[0];
        break;
      default:
        break;
    }
  }

  // Nullable → type union with null.
  if (col.flags.nullable && typeof base.type === 'string') {
    base.type = [base.type, 'null'];
  }
  return base;
}

export function toJsonSchema(schema: CoreSchema<string>, variant: Variant = 'entity'): JsonSchemaObject {
  const isResponse = variant === 'entity' || variant === 'get' || variant === 'list' || variant === 'search';
  const entries = Object.entries(schema.columns)
    // Sensitive columns are omitted from response variants; create/update keep them (and omit autoIncrement).
    .filter(([, col]) => (isResponse ? col.flags.sensitive !== true : col.flags.autoIncrement !== true))
    .toSorted(([a], [b]) => a.localeCompare(b));

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, col] of entries) {
    properties[name] = scalarSchema(col);
    if (variant === 'update') continue; // all optional
    const optional = col.flags.hasDefault === true || col.flags.nullable === true;
    if (isResponse) {
      if (!col.flags.nullable) required.push(name);
    } else if (!optional) {
      required.push(name);
    }
  }

  return { type: 'object', properties, required: required.toSorted() };
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
