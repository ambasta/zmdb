// JSON Schema / OpenAPI generation — API stubs (red phase). Impl in #64–#67.
import type { CoreSchema } from '../index.ts';

const NOT_IMPL = 'not implemented';

export type Variant = 'entity' | 'create' | 'update';

// Minimal JSON Schema object shape (draft 2020-12 subset we emit).
export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

export function toJsonSchema(
  _schema: CoreSchema<string>,
  _variant: Variant = 'entity',
): JsonSchemaObject {
  throw new Error(NOT_IMPL);
}

export function toOpenApiComponents(
  _schemas: readonly CoreSchema<string>[],
): { schemas: Record<string, JsonSchemaObject> } {
  throw new Error(NOT_IMPL);
}
