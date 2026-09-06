import type { CoreSchema } from '@zmdb/schema-core';
import {
  jsonSchemaForColumn,
  jsonSchemaFromShape,
  shapeOfVariant,
  type JsonSchemaObject,
  type ShapeIR,
} from '@zmdb/schema-core/ir';

import { ToolSpecRefusalError, type ToolProvider, type ToolSpecRefusal } from './http/types.js';

export type { ToolProvider, ToolSpecRefusal };
export { ToolSpecRefusalError };

export interface ToolOptions {
  readonly description?: string;
}

export type ToolSchema = CoreSchema<string>;

export interface ToolSpec {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonSchemaObject;
}

export interface StrictJsonSchemaObject extends JsonSchemaObject {
  readonly additionalProperties: false;
}

export interface GeminiSchemaObject extends JsonSchemaObject {}

export interface ToolSpecFor {
  readonly openai: {
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly parameters: JsonSchemaObject;
    };
  };
  readonly 'openai-strict': {
    readonly type: 'function';
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly strict: true;
      readonly parameters: StrictJsonSchemaObject;
    };
  };
  readonly anthropic: {
    readonly name: string;
    readonly description?: string;
    readonly input_schema: JsonSchemaObject;
  };
  readonly gemini: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: GeminiSchemaObject;
  };
  readonly 'json-schema': ToolSpec;
}

export interface ToolDialect {
  readonly allowedKeywords: ReadonlySet<string>;
  readonly maxProperties?: number;
  readonly source: string;
  readonly verifiedOn: '2026-09-04';
}

const COMMON_KEYWORDS = [
  'type',
  'format',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'items',
  'minItems',
  'maxItems',
  'properties',
  'required',
  'anyOf',
  'additionalProperties',
] as const;

/**
 * Provider constraints are data rather than branches scattered through the emitter.
 *
 * The cap is deliberately below every provider's moving request-size ceiling. It is a
 * build-time guard against producing a tool definition large enough to be rejected after
 * deployment, not a promise that a provider will accept every document below it.
 */
export const TOOL_DIALECTS: Readonly<Record<ToolProvider, ToolDialect>> = {
  openai: {
    allowedKeywords: new Set<string>(COMMON_KEYWORDS),
    maxProperties: 1_024,
    source: 'https://platform.openai.com/docs/guides/structured-outputs',
    verifiedOn: '2026-09-04',
  },
  'openai-strict': {
    allowedKeywords: new Set<string>(COMMON_KEYWORDS),
    maxProperties: 1_024,
    source: 'https://platform.openai.com/docs/guides/structured-outputs',
    verifiedOn: '2026-09-04',
  },
  anthropic: {
    allowedKeywords: new Set<string>(COMMON_KEYWORDS),
    maxProperties: 1_024,
    source: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use',
    verifiedOn: '2026-09-04',
  },
  gemini: {
    allowedKeywords: new Set<string>([...COMMON_KEYWORDS, 'nullable']),
    maxProperties: 1_024,
    source: 'https://ai.google.dev/api/caching#Schema',
    verifiedOn: '2026-09-04',
  },
  'json-schema': {
    allowedKeywords: new Set<string>(COMMON_KEYWORDS),
    source: 'https://json-schema.org/draft/2020-12/json-schema-core.html',
    verifiedOn: '2026-09-04',
  },
};

type AnyToolSpec = ToolSpecFor[ToolProvider];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isToolSchema(value: unknown): value is ToolSchema {
  if (!isRecord(value)) return false;
  const ir = value['ir'];
  return isRecord(ir) && Array.isArray(ir['columns']);
}

function descriptionPart(description: string | undefined): { readonly description: string } | object {
  return description ? { description } : {};
}

function refusal(provider: ToolProvider, path: string, construct: string, reason: string, suggestion: string): never {
  throw new ToolSpecRefusalError({ provider, path, construct, reason, suggestion });
}

function joinPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}.${child}`;
}

function nullableType(value: unknown): unknown {
  if (typeof value === 'string') return value === 'null' ? value : [value, 'null'];
  if (!Array.isArray(value)) return value;
  return value.includes('null') ? [...value] : [...value, 'null'];
}

function requiredNames(value: Record<string, unknown>): ReadonlySet<string> {
  const required = value['required'];
  if (!Array.isArray(required)) return new Set();
  return new Set(required.filter(name => typeof name === 'string'));
}

function propertiesOf(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const properties = value['properties'];
  return isRecord(properties) ? properties : undefined;
}

function translateNode(
  provider: 'openai-strict' | 'gemini',
  value: Record<string, unknown>,
  path: string,
  optional: boolean,
): Record<string, unknown> {
  if (Object.keys(value).length === 0) {
    refusal(
      provider,
      path,
      'untyped json',
      'the provider requires a type for every tool property, but this column emits no type',
      'declare the payload with WireAs<W>, or omit the column from the tool',
    );
  }

  const dialect = TOOL_DIALECTS[provider];
  for (const keyword of Object.keys(value)) {
    if (!dialect.allowedKeywords.has(keyword)) {
      refusal(
        provider,
        path,
        `unsupported keyword ${keyword}`,
        `${provider} cannot express the emitted ${keyword} keyword without changing its meaning`,
        'declare a provider-compatible wire shape, or omit the column from the tool',
      );
    }
  }

  const result: Record<string, unknown> = {};
  const nested = propertiesOf(value);
  const nestedRequired = requiredNames(value);

  for (const [keyword, raw] of Object.entries(value)) {
    if (provider === 'openai-strict' && keyword === 'format' && raw === 'int64') continue;

    if (keyword === 'properties' && nested !== undefined) {
      const properties: Record<string, unknown> = {};
      for (const name of Object.keys(nested).toSorted()) {
        const child = nested[name];
        if (!isRecord(child)) {
          refusal(
            provider,
            joinPath(path, name),
            'non-object property schema',
            'the emitted property schema is not an object',
            'declare the property with a JSON-Schema-compatible wire type',
          );
        }
        properties[name] = translateNode(provider, child, joinPath(path, name), !nestedRequired.has(name));
      }
      result[keyword] = properties;
      continue;
    }

    if (keyword === 'items' && isRecord(raw)) {
      result[keyword] = translateNode(provider, raw, `${path}[]`, false);
      continue;
    }

    if (keyword === 'anyOf' && Array.isArray(raw)) {
      result[keyword] = raw.map((member, index) => {
        if (!isRecord(member)) {
          refusal(
            provider,
            `${path}|${String(index)}`,
            'non-object union member',
            'the emitted union member is not a schema object',
            'declare every union member with a provider-compatible wire type',
          );
        }
        return translateNode(provider, member, `${path}|${String(index)}`, false);
      });
      continue;
    }

    if (keyword === 'required' && nested !== undefined && provider === 'openai-strict') {
      result[keyword] = Object.keys(nested).toSorted();
      continue;
    }

    if (keyword === 'type' && provider === 'gemini' && Array.isArray(raw)) {
      const nonNull = raw.filter(item => item !== 'null');
      if (nonNull.length !== 1 || !raw.includes('null')) {
        refusal(
          provider,
          path,
          'type union',
          'Gemini cannot express this type array without changing the accepted values',
          'declare a single nullable wire type, or omit the column from the tool',
        );
      }
      result[keyword] = nonNull[0];
      result['nullable'] = true;
      continue;
    }

    result[keyword] = raw;
  }

  if (provider === 'openai-strict') {
    if (optional) result['type'] = nullableType(result['type']);
    if (nested !== undefined) result['additionalProperties'] = false;
  }
  return result;
}

function visibleShape(shape: ShapeIR): ShapeIR {
  return shape
    .filter(entry => !entry.column.sensitive)
    .toSorted((left, right) => left.column.name.localeCompare(right.column.name));
}

function propertyCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + propertyCount(item), 0);
  if (!isRecord(value)) return 0;
  const properties = propertiesOf(value);
  let count = properties === undefined ? 0 : Object.keys(properties).length;
  for (const item of Object.values(value)) count += propertyCount(item);
  return count;
}

function enforceShape(provider: ToolProvider, shape: ShapeIR, document: JsonSchemaObject): void {
  if (shape.length === 0 && provider !== 'json-schema') {
    refusal(
      provider,
      '',
      'empty create schema',
      'the create variant has no visible properties',
      'drop the tool, or unmark a Sensitive column that the model is allowed to supply',
    );
  }
  const maximum = TOOL_DIALECTS[provider].maxProperties;
  const count = propertyCount(document);
  if (maximum !== undefined && count > maximum) {
    refusal(
      provider,
      '',
      `property limit ${String(maximum)}`,
      `the tool contains ${String(count)} properties, above the provider cap of ${String(maximum)}`,
      'split the operation into smaller tools',
    );
  }
}

/**
 * The provider's parameter document, directly from the declaration IR.
 *
 * This is exported for the AOT emitter. Applications should call {@link toolFor}; exposing
 * the pure step keeps runtime and build-time output byte-identical without a second walker.
 */
export function toolSchemaForProvider(provider: ToolProvider, shape: ShapeIR): JsonSchemaObject {
  const visible = visibleShape(shape);
  const generic = jsonSchemaFromShape(visible);
  enforceShape(provider, visible, generic);

  if (provider !== 'openai-strict' && provider !== 'gemini') return generic;

  const properties: Record<string, unknown> = {};
  for (const { column, optional } of visible) {
    properties[column.name] = translateNode(provider, jsonSchemaForColumn(column), column.name, optional);
  }

  if (provider === 'openai-strict') {
    const strict: StrictJsonSchemaObject = {
      type: 'object',
      properties,
      required: visible.map(entry => entry.column.name),
      additionalProperties: false,
    };
    return strict;
  }

  return {
    type: 'object',
    properties,
    required: generic.required,
  };
}

export function frameTool(
  provider: ToolProvider,
  name: string,
  parameters: JsonSchemaObject,
  options: ToolOptions = {},
): AnyToolSpec {
  const described = descriptionPart(options.description);
  switch (provider) {
    case 'openai':
      return { type: 'function', function: { name, ...described, parameters } };
    case 'openai-strict':
      return {
        type: 'function',
        function: {
          name,
          ...described,
          strict: true,
          parameters: {
            ...parameters,
            additionalProperties: false,
          },
        },
      };
    case 'anthropic':
      return { name, ...described, input_schema: parameters };
    case 'gemini':
      return { name, ...described, parameters };
    case 'json-schema':
      return { name, ...described, parameters };
  }
}

export function toolFor<_T>(provider: 'openai', name: string, options?: ToolOptions): ToolSpecFor['openai'];
export function toolFor<_T>(
  provider: 'openai-strict',
  name: string,
  options?: ToolOptions,
): ToolSpecFor['openai-strict'];
export function toolFor<_T>(provider: 'anthropic', name: string, options?: ToolOptions): ToolSpecFor['anthropic'];
export function toolFor<_T>(provider: 'gemini', name: string, options?: ToolOptions): ToolSpecFor['gemini'];
export function toolFor<_T>(provider: 'json-schema', name: string, options?: ToolOptions): ToolSpecFor['json-schema'];
export function toolFor<_T, P extends ToolProvider>(provider: P, name: string, options?: ToolOptions): ToolSpecFor[P];
export function toolFor(
  provider: 'openai',
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor['openai'];
export function toolFor(
  provider: 'openai-strict',
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor['openai-strict'];
export function toolFor(
  provider: 'anthropic',
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor['anthropic'];
export function toolFor(
  provider: 'gemini',
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor['gemini'];
export function toolFor(
  provider: 'json-schema',
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor['json-schema'];
export function toolFor<P extends ToolProvider>(
  provider: P,
  name: string,
  schema: ToolSchema,
  options?: ToolOptions,
): ToolSpecFor[P];
export function toolFor(
  provider: ToolProvider,
  name: string,
  schemaOrOptions?: ToolSchema | ToolOptions,
  options: ToolOptions = {},
): AnyToolSpec {
  if (!isToolSchema(schemaOrOptions)) {
    throw new Error(
      'toolFor<T>() was not replaced at build time. It is compiled away by @zmdb/compiler ' +
        '(the unplugin, Metro adapter, or project compiler), which did not run over this file — a type argument cannot ' +
        'be read at runtime, so there is nothing to fall back to.',
    );
  }
  const parameters = toolSchemaForProvider(provider, shapeOfVariant(schemaOrOptions.ir, 'create'));
  return frameTool(provider, name, parameters, options);
}
