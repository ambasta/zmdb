// @zmdb/web — OpenAPI 3.1 generation (epic #302, spec ./SPEC.md). Deterministic,
// build/boot-time, reflection-free: reads getRoutes + optional per-route schemas.
// No `as` on the consumer surface.

import '../polyfill.ts';
import { getRoutes } from '../routing/index.ts';

/** A JSON Schema object (structural; matches @zmdb/schema-core's shape). */
export type JsonSchema = Record<string, unknown>;

/** Per-route request/response schemas (from schema-core's toJsonSchema). */
export interface RouteSchemas {
  readonly body?: JsonSchema;
  readonly response?: JsonSchema;
}

/** Options for `toOpenApi`. */
export interface OpenApiOptions {
  readonly info?: { readonly title: string; readonly version: string };
  readonly schemas?: Readonly<Record<string, RouteSchemas>>;
}

interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path';
  readonly required: true;
  readonly schema: { readonly type: 'string' };
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: JsonSchema }> }>;
}

type PathItem = Record<string, OpenApiOperation>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, PathItem>;
}

type ControllerClass = abstract new (...args: never[]) => unknown;

// Accept a controller class or instance; normalize to the class carrying metadata.
function toClass(controller: ControllerClass | object): ControllerClass | undefined {
  if (typeof controller === 'function') {
    // boundary: a controller class value; getRoutes reads its Symbol.metadata.
    return controller as ControllerClass;
  }
  const ctor = controller.constructor;
  if (typeof ctor !== 'function') {
    return undefined;
  }
  return ctor as ControllerClass;
}

// Convert a zmdb route path (/users/:id) to OpenAPI form (/users/{id}) and list
// its path params.
function toOpenApiPath(path: string): { openapiPath: string; params: string[] } {
  const params: string[] = [];
  const openapiPath = path.replace(/:([^/]+)/g, (_match, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { openapiPath, params };
}

/**
 * Generate an OpenAPI 3.1 document from controller routes (+ optional per-route
 * schemas). Deterministic: paths sorted, methods lowercased operation keys.
 */
export function toOpenApi(
  controllers: readonly (ControllerClass | object)[],
  options: OpenApiOptions = {},
): OpenApiDocument {
  const info = options.info ?? { title: '@zmdb/web API', version: '0.0.0' };
  const schemas = options.schemas ?? {};
  const paths: Record<string, PathItem> = {};

  // Collect routes across controllers, then emit in a stable order.
  const collected: { openapiPath: string; method: string; params: string[]; routePath: string }[] = [];
  for (const controller of controllers) {
    const cls = toClass(controller);
    if (cls === undefined) {
      continue;
    }
    for (const route of getRoutes(cls)) {
      const { openapiPath, params } = toOpenApiPath(route.path);
      collected.push({ openapiPath, method: route.method.toLowerCase(), params, routePath: route.path });
    }
  }
  collected.sort((a, b) =>
    a.openapiPath === b.openapiPath ? a.method.localeCompare(b.method) : a.openapiPath.localeCompare(b.openapiPath),
  );

  for (const entry of collected) {
    const item = paths[entry.openapiPath] ?? {};
    const operation: OpenApiOperation = { responses: { '200': { description: 'OK' } } };
    if (entry.params.length > 0) {
      operation.parameters = entry.params.map(name => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }
    const routeSchemas = schemas[entry.routePath];
    if (routeSchemas?.body !== undefined) {
      operation.requestBody = { content: { 'application/json': { schema: routeSchemas.body } } };
    }
    if (routeSchemas?.response !== undefined) {
      operation.responses = {
        '200': { description: 'OK', content: { 'application/json': { schema: routeSchemas.response } } },
      };
    }
    item[entry.method] = operation;
    paths[entry.openapiPath] = item;
  }

  return { openapi: '3.1.0', info, paths };
}

/** A tiny handler that serves a prebuilt document (e.g. at /openapi.json). */
export function serveOpenApi(doc: OpenApiDocument): () => OpenApiDocument {
  return () => doc;
}
