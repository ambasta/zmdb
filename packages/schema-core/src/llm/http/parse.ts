import type { JsonSchemaObject } from '../../openapi/index.js';
import type { ToolSpec } from '../index.js';
import {
  ToolSpecRefusalError,
  type OpenApiOperationIdentity,
  type OpenApiToolRequest,
  type OpenApiToolsOptions,
  type ToolProvider,
} from './types.js';

const METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const NAME = /^[A-Za-z0-9_-]+$/;

export interface CompiledOpenApiTool {
  readonly spec: ToolSpec;
  readonly request: OpenApiToolRequest;
  readonly argumentSchemas: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(provider: ToolProvider, path: string, construct: string, reason: string, suggestion: string): never {
  throw new ToolSpecRefusalError({ provider, path, construct, reason, suggestion });
}

function operationPath(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function pointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolvePointer(
  document: unknown,
  reference: string,
  provider: ToolProvider,
  path: string,
  stack: ReadonlySet<string>,
): unknown {
  if (!reference.startsWith('#/')) {
    refuse(
      provider,
      path,
      '$ref',
      `external reference ${reference} is not fetched`,
      'bundle the referenced schema into this document before generation',
    );
  }
  if (stack.has(reference)) {
    refuse(
      provider,
      path,
      '$ref cycle',
      `reference cycle includes ${reference}`,
      'replace the recursive shape with a bounded, non-recursive tool argument',
    );
  }

  let current = document;
  for (const encoded of reference.slice(2).split('/')) {
    const segment = pointerSegment(encoded);
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      refuse(
        provider,
        path,
        '$ref',
        `reference ${reference} does not resolve within the document`,
        'add the referenced component or remove the operation',
      );
    }
    current = current[segment];
  }

  const next = new Set(stack);
  next.add(reference);
  return inlineReferences(current, document, provider, path, next);
}

function inlineReferences(
  value: unknown,
  document: unknown,
  provider: ToolProvider,
  path: string,
  stack: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => inlineReferences(item, document, provider, path, stack));
  }
  if (!isRecord(value)) return value;

  const reference = value['$ref'];
  if (reference !== undefined) {
    if (typeof reference !== 'string') {
      refuse(provider, path, '$ref', 'the reference is not a string', 'use an in-document JSON Pointer');
    }
    const siblings = Object.keys(value).filter(key => key !== '$ref');
    if (siblings.length > 0) {
      refuse(
        provider,
        path,
        '$ref siblings',
        `reference ${reference} also declares ${siblings.join(', ')}`,
        'inline the schema and apply those keywords directly',
      );
    }
    return resolvePointer(document, reference, provider, path, stack);
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    result[key] = inlineReferences(value[key], document, provider, path, stack);
  }
  return result;
}

function schemaArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function validateSchema(
  schema: unknown,
  provider: ToolProvider,
  path: string,
  location: string,
): Record<string, unknown> {
  if (!isRecord(schema)) {
    refuse(provider, path, location, 'the schema is not an object', 'replace it with an OpenAPI schema object');
  }

  for (const construct of ['allOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'patternProperties']) {
    if (schema[construct] !== undefined) {
      refuse(
        provider,
        path,
        construct,
        `${construct} is not representable by the generated TypeScript argument`,
        'publish a concrete object shape for this tool operation',
      );
    }
  }

  if (schema['additionalProperties'] !== undefined && schema['additionalProperties'] !== false) {
    refuse(
      provider,
      path,
      'additionalProperties',
      'an open-ended property map cannot be compiled by the existing validator emitter',
      'declare the accepted properties explicitly',
    );
  }

  if (provider === 'gemini' && (schema['oneOf'] !== undefined || schema['anyOf'] !== undefined)) {
    refuse(
      provider,
      path,
      'oneOf/anyOf',
      'Gemini tool schemas do not accept this union spelling',
      'split the operation into tools with concrete argument shapes',
    );
  }

  if (provider === 'openai-strict' && Object.keys(schema).length === 0) {
    refuse(
      provider,
      path,
      'untyped schema',
      'OpenAI strict tools require a type for every property',
      'replace the unconstrained value with a concrete schema',
    );
  }

  for (const union of ['oneOf', 'anyOf']) {
    const members = schemaArray(schema[union]);
    if (schema[union] !== undefined && (members === undefined || members.length === 0)) {
      refuse(provider, path, union, `${union} must contain schemas`, 'declare at least one concrete union member');
    }
    for (const member of members ?? []) validateSchema(member, provider, path, `${location}.${union}`);
  }

  const properties = schema['properties'];
  if (properties !== undefined) {
    if (!isRecord(properties)) {
      refuse(provider, path, 'properties', 'properties is not an object', 'declare a named schema per property');
    }
    for (const [name, property] of Object.entries(properties)) {
      validateSchema(property, provider, path, `${location}.${name}`);
    }
  }

  const items = schema['items'];
  if (items !== undefined) validateSchema(items, provider, path, `${location}.items`);

  return schema;
}

function schemaFor(
  value: unknown,
  document: unknown,
  provider: ToolProvider,
  path: string,
  location: string,
): Record<string, unknown> {
  return validateSchema(inlineReferences(value, document, provider, path), provider, path, location);
}

interface UrlShapes {
  readonly array: boolean;
  readonly scalar: boolean;
}

function mergeUrlShapes(shapes: readonly UrlShapes[]): UrlShapes | undefined {
  if (shapes.length === 0) return undefined;
  return {
    array: shapes.some(shape => shape.array),
    scalar: shapes.some(shape => shape.scalar),
  };
}

function urlShapes(schema: Record<string, unknown>): UrlShapes | undefined {
  const values = schema['enum'];
  if (Array.isArray(values) && values.length > 0) {
    return values.every(
      value => value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
    )
      ? { array: false, scalar: true }
      : undefined;
  }

  for (const union of ['oneOf', 'anyOf'] as const) {
    const members = schema[union];
    if (Array.isArray(members)) {
      const shapes: UrlShapes[] = [];
      for (const member of members) {
        if (!isRecord(member)) return undefined;
        const shape = urlShapes(member);
        if (shape === undefined) return undefined;
        shapes.push(shape);
      }
      return mergeUrlShapes(shapes);
    }
  }

  const type = schema['type'];
  if (Array.isArray(type)) {
    const shapes: UrlShapes[] = [];
    for (const member of type) {
      const shape = urlShapes({ ...schema, type: member });
      if (shape === undefined) return undefined;
      shapes.push(shape);
    }
    return mergeUrlShapes(shapes);
  }
  if (type === 'array') {
    const items = schema['items'];
    if (!isRecord(items)) return undefined;
    const itemShapes = urlShapes(items);
    return itemShapes?.scalar === true && itemShapes.array === false ? { array: true, scalar: false } : undefined;
  }
  return type === 'string' || type === 'integer' || type === 'number' || type === 'boolean' || type === 'null'
    ? { array: false, scalar: true }
    : undefined;
}

function validateUrlSchema(
  schema: Record<string, unknown>,
  location: 'path' | 'query',
  name: string,
  provider: ToolProvider,
  path: string,
): void {
  const shapes = urlShapes(schema);
  const supported =
    shapes !== undefined &&
    (location === 'path' ? shapes.scalar && shapes.array === false : shapes.scalar || shapes.array);
  if (supported) return;
  refuse(
    provider,
    path,
    `${location} parameter schema`,
    `${location} parameter ${name} is not a URL-safe ${location === 'path' ? 'scalar' : 'scalar or scalar array'}`,
    `declare ${name} as a string, number, boolean${location === 'query' ? ' or an array of those values' : ''}`,
  );
}

function requiredNames(schema: Record<string, unknown>, provider: ToolProvider, path: string): ReadonlySet<string> {
  const required = schema['required'];
  if (required === undefined) return new Set();
  if (!Array.isArray(required) || required.some(name => typeof name !== 'string')) {
    refuse(provider, path, 'required', 'required is not a string array', 'list required property names as strings');
  }
  return new Set(required);
}

function objectProperties(
  schema: Record<string, unknown>,
  provider: ToolProvider,
  path: string,
): Record<string, unknown> {
  const type = schema['type'];
  const properties = schema['properties'];
  if (type !== 'object' && properties === undefined) {
    refuse(
      provider,
      path,
      'requestBody',
      'a JSON request body cannot be flattened because it is not an object',
      'wrap the body fields in an object schema',
    );
  }
  if (properties === undefined) return {};
  if (!isRecord(properties)) {
    refuse(provider, path, 'properties', 'request body properties is not an object', 'declare named body properties');
  }
  return properties;
}

function operationIdOf(
  operation: Record<string, unknown>,
  method: string,
  path: string,
  provider: ToolProvider,
): string {
  const value = operation['operationId'];
  const where = operationPath(method, path);
  if (typeof value !== 'string' || value.length === 0) {
    refuse(
      provider,
      where,
      'operationId',
      `operation ${where} has no operationId`,
      'add a stable operationId before generating tools',
    );
  }
  if (value.length > 64 || !NAME.test(value)) {
    refuse(
      provider,
      where,
      'operationId',
      `operationId ${value} must match ${NAME.source} and be at most 64 characters`,
      'rename the operation with letters, digits, underscores or hyphens',
    );
  }
  return value;
}

function parameterList(
  value: unknown,
  document: unknown,
  provider: ToolProvider,
  path: string,
): readonly Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    refuse(provider, path, 'parameters', 'parameters is not an array', 'declare OpenAPI parameter objects');
  }
  return value.map(item => {
    const resolved = inlineReferences(item, document, provider, path);
    if (!isRecord(resolved)) {
      refuse(provider, path, 'parameter', 'a parameter is not an object', 'declare a named OpenAPI parameter');
    }
    return resolved;
  });
}

function mergedParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  document: unknown,
  provider: ToolProvider,
  path: string,
): readonly Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const parameter of [
    ...parameterList(pathItem['parameters'], document, provider, path),
    ...parameterList(operation['parameters'], document, provider, path),
  ]) {
    const name = parameter['name'];
    const location = parameter['in'];
    if (typeof name !== 'string' || typeof location !== 'string') {
      refuse(
        provider,
        path,
        'parameter',
        'a parameter has no string name or location',
        'name the parameter and its in',
      );
    }
    merged.set(`${location}:${name}`, parameter);
  }
  return [...merged.values()];
}

function addArgument(
  properties: Record<string, unknown>,
  required: Set<string>,
  name: string,
  schema: Record<string, unknown>,
  isRequired: boolean,
  provider: ToolProvider,
  path: string,
): void {
  if (Object.hasOwn(properties, name)) {
    refuse(
      provider,
      path,
      'argument name collision',
      `more than one path, query or body value is named ${name}`,
      'rename one field in the OpenAPI document',
    );
  }
  properties[name] = schema;
  if (isRequired) required.add(name);
}

function requestBody(
  operation: Record<string, unknown>,
  document: unknown,
  provider: ToolProvider,
  path: string,
): { readonly properties: Record<string, unknown>; readonly required: ReadonlySet<string>; readonly present: boolean } {
  const raw = operation['requestBody'];
  if (raw === undefined) return { properties: {}, required: new Set(), present: false };
  const resolved = inlineReferences(raw, document, provider, path);
  if (!isRecord(resolved) || !isRecord(resolved['content'])) {
    refuse(provider, path, 'requestBody', 'requestBody has no content map', 'declare an application/json body');
  }
  const content = resolved['content'];
  const json = content['application/json'];
  if (json === undefined) {
    const media = Object.keys(content).join(', ') || 'no media type';
    refuse(
      provider,
      path,
      'requestBody media type',
      `request body uses ${media}, not application/json`,
      'publish an application/json schema for this operation',
    );
  }
  if (!isRecord(json) || json['schema'] === undefined) {
    refuse(provider, path, 'requestBody schema', 'application/json has no schema', 'declare the JSON body schema');
  }
  const schema = schemaFor(json['schema'], document, provider, path, 'requestBody');
  return {
    properties: objectProperties(schema, provider, path),
    required: requiredNames(schema, provider, path),
    present: true,
  };
}

function pathParameterNames(path: string): readonly string[] {
  return [...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1] ?? '');
}

function validatePath(path: string, provider: ToolProvider): void {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    refuse(
      provider,
      path,
      'operation path',
      'an OpenAPI operation path must start with / and contain no query or fragment',
      'move query values into in:query parameters and publish an absolute path template',
    );
  }
  const withoutPlaceholders = path.replaceAll(/\{[^{}]+\}/g, '');
  if (withoutPlaceholders.includes('{') || withoutPlaceholders.includes('}')) {
    refuse(
      provider,
      path,
      'path placeholder',
      'the operation path contains an unmatched or empty placeholder',
      'use a named placeholder such as {projectId}',
    );
  }
  if (path.split('/').some(segment => segment === '.' || segment === '..')) {
    refuse(
      provider,
      path,
      'operation path',
      'the operation path contains a URL dot segment',
      'publish the canonical path without . or .. segments',
    );
  }
}

function compileOperation(
  document: unknown,
  path: string,
  method: string,
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  options: OpenApiToolsOptions,
  provider: ToolProvider,
): CompiledOpenApiTool | undefined {
  const operationId = operationIdOf(operation, method, path, provider);
  const identity: OpenApiOperationIdentity = { method, path, operationId };
  if (options.include !== undefined && !options.include(identity)) return undefined;

  const where = `${operationId} (${operationPath(method, path)})`;
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  const pathParameters: string[] = [];
  const queryParameters: string[] = [];

  for (const parameter of mergedParameters(pathItem, operation, document, provider, where)) {
    const name = parameter['name'];
    const location = parameter['in'];
    if (typeof name !== 'string' || typeof location !== 'string') continue;
    if (location === 'header' || location === 'cookie') continue;
    if (location !== 'path' && location !== 'query') {
      refuse(
        provider,
        where,
        'parameter location',
        `parameter ${name} uses unsupported location ${location}`,
        'use a path or query parameter; supply credentials through caller-owned headers',
      );
    }
    if (parameter['schema'] === undefined) {
      refuse(provider, where, 'parameter schema', `parameter ${name} has no schema`, 'declare its scalar schema');
    }
    const schema = schemaFor(parameter['schema'], document, provider, where, `parameter ${name}`);
    validateUrlSchema(schema, location, name, provider, where);
    if (location === 'path') {
      if (parameter['required'] !== true) {
        refuse(provider, where, 'path parameter', `path parameter ${name} is not required`, 'mark it required');
      }
      pathParameters.push(name);
      addArgument(properties, required, name, schema, true, provider, where);
    } else {
      queryParameters.push(name);
      addArgument(properties, required, name, schema, parameter['required'] === true, provider, where);
    }
  }

  const placeholders = pathParameterNames(path);
  for (const name of placeholders) {
    if (!pathParameters.includes(name)) {
      refuse(
        provider,
        where,
        'path parameter',
        `path placeholder ${name} has no matching parameter schema`,
        'declare a required in:path parameter with that name',
      );
    }
  }
  for (const name of pathParameters) {
    if (!placeholders.includes(name)) {
      refuse(
        provider,
        where,
        'path parameter',
        `path parameter ${name} has no {${name}} placeholder`,
        'remove it or add the matching placeholder',
      );
    }
  }

  const body = requestBody(operation, document, provider, where);
  const bodyParameters: string[] = [];
  for (const name of Object.keys(body.properties).toSorted()) {
    const schema = body.properties[name];
    if (!isRecord(schema)) {
      refuse(provider, where, `requestBody.${name}`, 'the property schema is not an object', 'declare its schema');
    }
    bodyParameters.push(name);
    addArgument(properties, required, name, schema, body.required.has(name), provider, where);
  }

  const sortedProperties: Record<string, unknown> = {};
  for (const name of Object.keys(properties).toSorted()) sortedProperties[name] = properties[name];
  const parameters: JsonSchemaObject = {
    type: 'object',
    properties: sortedProperties,
    required: [...required].toSorted(),
  };
  const description =
    typeof operation['summary'] === 'string'
      ? operation['summary']
      : typeof operation['description'] === 'string'
        ? operation['description']
        : undefined;
  const spec: ToolSpec =
    description === undefined ? { name: operationId, parameters } : { name: operationId, description, parameters };
  return {
    spec,
    request: {
      method: method.toUpperCase(),
      path,
      pathParameters: pathParameters.toSorted(),
      queryParameters: queryParameters.toSorted(),
      bodyParameters,
      hasBody: body.present,
    },
    argumentSchemas: sortedProperties,
    required: parameters.required,
  };
}

export function compileOpenApiTools(
  document: unknown,
  options: OpenApiToolsOptions = {},
): readonly CompiledOpenApiTool[] {
  const provider = options.provider ?? 'json-schema';
  if (!isRecord(document) || !isRecord(document['paths'])) {
    refuse(provider, 'document', 'paths', 'the OpenAPI document has no paths object', 'pass an OpenAPI document');
  }

  const result: CompiledOpenApiTool[] = [];
  const names = new Set<string>();
  for (const path of Object.keys(document['paths']).toSorted()) {
    validatePath(path, provider);
    const pathItem = document['paths'][path];
    if (!isRecord(pathItem)) {
      refuse(provider, path, 'path item', 'the path item is not an object', 'declare operations under this path');
    }
    if (pathItem['$ref'] !== undefined) {
      refuse(
        provider,
        path,
        'path item $ref',
        'a referenced path item hides operation identity before generation',
        'inline the path item; schema and parameter references remain supported',
      );
    }
    for (const method of Object.keys(pathItem)
      .filter(key => METHODS.has(key.toLowerCase()))
      .toSorted()) {
      const rawOperation = pathItem[method];
      if (!isRecord(rawOperation)) {
        refuse(provider, operationPath(method, path), 'operation', 'the operation is not an object', 'declare it');
      }
      const compiled = compileOperation(
        document,
        path,
        method.toLowerCase(),
        pathItem,
        rawOperation,
        options,
        provider,
      );
      if (compiled === undefined) continue;
      if (names.has(compiled.spec.name)) {
        refuse(
          provider,
          operationPath(method, path),
          'operationId collision',
          `operationId ${compiled.spec.name} appears more than once`,
          'give every operation a distinct operationId',
        );
      }
      names.add(compiled.spec.name);
      result.push(compiled);
    }
  }
  return result;
}

export function toolsFromOpenApi(document: unknown, options: OpenApiToolsOptions = {}): readonly ToolSpec[] {
  return compileOpenApiTools(document, options).map(tool => tool.spec);
}
