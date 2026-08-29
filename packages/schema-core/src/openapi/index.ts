// JSON Schema / OpenAPI generation — implementation.
// #64 toJsonSchema scalar/enum/nullable (+ tag mapping and variant/aggregation
// logic that the shared golden suite exercises). Build-time, no reflection.
import type { CoreSchema, ColumnMeta } from '../index.ts';

export type Variant = 'entity' | 'create' | 'update';

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

export function toJsonSchema(
  schema: CoreSchema<string>,
  variant: Variant = 'entity',
): JsonSchemaObject {
  const entries = Object.entries(schema.columns)
    // create/update omit auto-increment columns.
    .filter(([, col]) => (variant === 'entity' ? true : col.flags.autoIncrement !== true))
    .sort(([a], [b]) => a.localeCompare(b));

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, col] of entries) {
    properties[name] = scalarSchema(col);
    if (variant === 'update') continue; // all optional
    const optional = col.flags.hasDefault === true || col.flags.nullable === true;
    if (variant === 'entity') {
      if (!col.flags.nullable) required.push(name);
    } else if (!optional) {
      required.push(name);
    }
  }

  return { type: 'object', properties, required: required.sort() };
}

function pascalCase(table: string): string {
  const singular = table.endsWith('s') ? table.slice(0, -1) : table;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
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

export function toOpenApiComponents(
  schemas: readonly CoreSchema<string>[],
): { schemas: Record<string, JsonSchemaObject> } {
  const out: Record<string, JsonSchemaObject> = {};
  for (const s of [...schemas].sort((a, b) => a.table.localeCompare(b.table))) {
    out[pascalCase(s.table)] = toJsonSchema(s, 'entity');
  }
  return { schemas: out };
}
