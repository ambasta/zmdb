// @zmdb/web — migration-only route/path-schema OpenAPI 3.1 collector (spec ./SPEC.md).
// New contract collection produces HttpContractIR through @zmdb/web/contract/compiler;
// #683 replaces this deterministic, reflection-free legacy emitter.

import type { JsonSchemaObject } from '@zmdb/schema-core/ir';

import '../polyfill.js';
import type { SecurityRequirement, SecurityScheme } from '../contract/index.js';
import type { Guard, SecurityAwareGuard } from '../middleware/index.js';
import { resolveGuards } from '../pipeline/guards.js';
import type { GuardRegistry, RouteOptions } from '../pipeline/index.js';
import { getRoutes, isPublic } from '../routing/index.js';
import { versionsOf, type VersionStrategy } from '../versioning/index.js';
import { jsonMediaTypeForVersion, pathForVersion } from '../versioning/runtime.js';

export type { SecurityAwareGuard } from '../middleware/index.js';
export type {
  AuthorizationCodeFlow,
  ClientCredentialsFlow,
  ImplicitFlow,
  OAuthFlow,
  OAuthFlows,
  PasswordFlow,
  SecurityRequirement,
  SecurityScheme,
} from '../contract/index.js';
export type { GuardRegistry } from '../pipeline/index.js';

/**
 * A JSON Schema document.
 *
 * The union is not redundant. `JsonSchemaObject` is what `toJsonSchema<CreateDTO<User>>()`
 * leaves behind — an interface, and an interface has no implicit index signature, so it is
 * *not* assignable to the open record no matter what it contains. Naming both is what lets
 * a generated document be handed to `toOpenApi` without a cast at the boundary; the open
 * record stays for a hand-written one.
 */
export type JsonSchema = JsonSchemaObject | Readonly<Record<string, unknown>>;

/** @deprecated Migration-only path-keyed schemas. Use `HttpContractIR` for new collection. */
export interface RouteSchemas {
  readonly body?: JsonSchema;
  readonly response?: JsonSchema;
}

/** @deprecated Migration-only path-keyed schemas. Use `HttpContractIR` for new collection. */
export type VersionSchemas = Readonly<Record<string, Readonly<Record<string, RouteSchemas>>>>;

/** Options for `toOpenApi`. */
export interface OpenApiOptions {
  readonly info?: { readonly title: string; readonly version: string };
  /** @deprecated Migration-only path-keyed schemas. #683 replaces this with `HttpContractIR`. */
  readonly schemas?: Readonly<Record<string, RouteSchemas>>;
  readonly versioning?: VersionStrategy;
  /** @deprecated Migration-only path-keyed schemas. #683 replaces this with `HttpContractIR`. */
  readonly versionSchemas?: VersionSchemas;
  readonly securitySchemes?: Readonly<Record<string, SecurityScheme>>;
  readonly routes?: Readonly<Record<string, Readonly<Record<string, RouteOptions>>>>;
  readonly guardRegistry?: GuardRegistry;
  readonly strictSecurity?: boolean;
}

interface OpenApiPathParameter {
  readonly name: string;
  readonly in: 'path';
  readonly required: true;
  readonly schema: { readonly type: 'string' };
}

interface OpenApiHeaderParameter {
  readonly name: string;
  readonly in: 'header';
  readonly required: false;
  readonly schema: { readonly enum: readonly string[]; readonly default: string };
}

type OpenApiParameter = OpenApiPathParameter | OpenApiHeaderParameter;

interface OpenApiOperation {
  operationId: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: JsonSchema }> }>;
  security?: readonly SecurityRequirement[];
  deprecated?: true;
}

type PathItem = Record<string, OpenApiOperation>;

export interface OpenApiDocument {
  readonly openapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly paths: Record<string, PathItem>;
  readonly components?: { readonly securitySchemes: Readonly<Record<string, SecurityScheme>> };
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
  // boundary: `.constructor` is typed `Function`, which carries no construct
  // signature. The `typeof ctor === 'function'` guard above plus the fact that it
  // came off an instance make it a constructor; `getRoutes` only ever reads its
  // `Symbol.metadata`, never calls it.
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

/** Stable tool/client name derived only from the route's public method and path. */
export function operationIdForRoute(method: string, path: string): string {
  const suffix = path.replaceAll(/[/:{}]+/g, '_').replaceAll(/^_+|_+$/g, '');
  return suffix === '' ? method.toLowerCase() : `${method.toLowerCase()}_${suffix}`;
}

function isSecurityAware(guard: Guard): guard is SecurityAwareGuard {
  if (!('enforces' in guard)) {
    return false;
  }
  const enforcement = guard.enforces;
  return (
    typeof enforcement === 'object' &&
    enforcement !== null &&
    'scheme' in enforcement &&
    typeof enforcement.scheme === 'string' &&
    'scopes' in enforcement &&
    Array.isArray(enforcement.scopes) &&
    enforcement.scopes.every((scope: unknown) => typeof scope === 'string')
  );
}

function derivedRequirement(guards: readonly SecurityAwareGuard[]): SecurityRequirement {
  const byScheme = new Map<string, Set<string>>();
  for (const guard of guards) {
    const scopes = byScheme.get(guard.enforces.scheme) ?? new Set<string>();
    for (const scope of guard.enforces.scopes) {
      scopes.add(scope);
    }
    byScheme.set(guard.enforces.scheme, scopes);
  }
  return Object.fromEntries(
    [...byScheme.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([scheme, scopes]) => [scheme, [...scopes].toSorted()]),
  );
}

function locationOf(controllerName: string, handlerName: string): string {
  return `${controllerName}.${handlerName}`;
}

function securityError(controllerName: string, handlerName: string, problem: string): Error {
  return new Error(
    `OpenAPI security error at ${locationOf(controllerName, handlerName)}: ${problem}. ` +
      'Add a guard, declare its enforces property (or provide RouteOptions.security for a legacy guard), ' +
      'declare each referenced scheme in OpenApiOptions.securitySchemes, or mark the handler @Public().',
  );
}

function assertDeclaredSchemes(
  security: readonly SecurityRequirement[],
  schemes: Readonly<Record<string, SecurityScheme>>,
  controllerName: string,
  handlerName: string,
): void {
  for (const requirement of security) {
    for (const scheme of Object.keys(requirement)) {
      if (!(scheme in schemes)) {
        throw securityError(controllerName, handlerName, `security scheme "${scheme}" is not declared`);
      }
    }
  }
}

function requirementIncludes(available: readonly string[] | undefined, required: readonly string[]): boolean {
  return available !== undefined && required.every(scope => available.includes(scope));
}

function assertOverrideIsSuperset(
  security: readonly SecurityRequirement[],
  derived: SecurityRequirement,
  controllerName: string,
  handlerName: string,
): void {
  for (const requirement of security) {
    for (const [scheme, scopes] of Object.entries(derived)) {
      if (!requirementIncludes(requirement[scheme], scopes)) {
        throw securityError(
          controllerName,
          handlerName,
          `explicit security omits scheme "${scheme}" or one of its enforced scopes`,
        );
      }
    }
  }
}

function securityFor(
  options: RouteOptions | undefined,
  registry: GuardRegistry | undefined,
  schemes: Readonly<Record<string, SecurityScheme>>,
  strict: boolean,
  publicRoute: boolean,
  controllerName: string,
  handlerName: string,
): readonly SecurityRequirement[] | undefined {
  const routeGuards = options?.guards ?? [];
  const explicit = options?.security;

  if (publicRoute) {
    if (routeGuards.length > 0 || (explicit !== undefined && explicit.length > 0)) {
      throw securityError(controllerName, handlerName, 'an @Public() route cannot also declare protection');
    }
    return [];
  }

  const guards = resolveGuards(registry, controllerName, routeGuards);

  if (strict && guards.length === 0) {
    throw securityError(controllerName, handlerName, 'the route has neither guards nor a public marker');
  }

  const aware = guards.filter(isSecurityAware);
  const derived = derivedRequirement(aware);
  const hasDerived = Object.keys(derived).length > 0;

  if (explicit !== undefined) {
    assertDeclaredSchemes(explicit, schemes, controllerName, handlerName);
    assertOverrideIsSuperset(explicit, derived, controllerName, handlerName);
    if (guards.length > 0 && explicit.length === 0) {
      throw securityError(controllerName, handlerName, 'a guarded route cannot be declared public');
    }
    return explicit;
  }

  if (strict && guards.length !== aware.length) {
    throw securityError(controllerName, handlerName, 'one or more guards do not declare what they enforce');
  }

  if (hasDerived) {
    const security = [derived];
    assertDeclaredSchemes(security, schemes, controllerName, handlerName);
    return security;
  }

  return undefined;
}

interface CollectedRoute {
  readonly controllerName: string;
  readonly handlerName: string;
  readonly openapiPath: string;
  readonly method: string;
  readonly params: string[];
  readonly publicRoute: boolean;
  readonly routePath: string;
  readonly schemaPath: string;
  readonly versions: readonly string[] | 'neutral' | undefined;
  readonly order: number;
}

interface RouteTraits {
  readonly security: readonly SecurityRequirement[] | undefined;
  readonly deprecated: true | undefined;
}

interface VersionSchemaEntry {
  readonly version: string;
  readonly route: CollectedRoute;
  readonly schemas: RouteSchemas | undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameDocumentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameDocumentValue(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && sameDocumentValue(left[key], right[key]))
  );
}

function versioningError(route: CollectedRoute, problem: string): Error {
  return new Error(
    `OpenAPI versioning error at ${locationOf(route.controllerName, route.handlerName)}: ${problem}. ` +
      'Use path versioning when versions need different operation shapes.',
  );
}

function routeTraits(
  route: CollectedRoute,
  options: OpenApiOptions,
  securitySchemes: Readonly<Record<string, SecurityScheme>>,
  strictSecurity: boolean,
): RouteTraits {
  const routeOptions = options.routes?.[route.controllerName]?.[route.handlerName];
  return {
    security: securityFor(
      routeOptions,
      options.guardRegistry,
      securitySchemes,
      strictSecurity,
      route.publicRoute,
      route.controllerName,
      route.handlerName,
    ),
    deprecated: routeOptions?.deprecated,
  };
}

function operationFor(route: CollectedRoute, schemas: RouteSchemas | undefined, traits: RouteTraits): OpenApiOperation {
  const operation: OpenApiOperation = {
    operationId: operationIdForRoute(route.method, route.schemaPath),
    responses: { '200': { description: 'OK' } },
  };
  if (route.params.length > 0) {
    operation.parameters = route.params.map(name => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
  }
  if (schemas?.body !== undefined) {
    operation.requestBody = { content: { 'application/json': { schema: schemas.body } } };
  }
  if (schemas?.response !== undefined) {
    operation.responses = {
      '200': { description: 'OK', content: { 'application/json': { schema: schemas.response } } },
    };
  }
  if (traits.security !== undefined) {
    operation.security = traits.security;
  }
  if (traits.deprecated === true) {
    operation.deprecated = true;
  }
  return operation;
}

function versionSchemasFor(routes: readonly CollectedRoute[], options: OpenApiOptions): readonly VersionSchemaEntry[] {
  const entries: VersionSchemaEntry[] = [];
  const claimed = new Set<string>();
  for (const route of routes) {
    if (route.versions === undefined || route.versions === 'neutral') {
      continue;
    }
    for (const version of route.versions) {
      if (claimed.has(version)) {
        throw versioningError(route, `version "${version}" is declared more than once for this method and path`);
      }
      claimed.add(version);
      entries.push({
        version,
        route,
        schemas: options.versionSchemas?.[route.routePath]?.[version] ?? options.schemas?.[route.schemaPath],
      });
    }
  }
  return entries;
}

function sharedTraits(
  routes: readonly CollectedRoute[],
  options: OpenApiOptions,
  securitySchemes: Readonly<Record<string, SecurityScheme>>,
  strictSecurity: boolean,
): RouteTraits {
  const firstRoute = routes[0];
  if (firstRoute === undefined) {
    return { security: undefined, deprecated: undefined };
  }
  const first = routeTraits(firstRoute, options, securitySchemes, strictSecurity);
  for (let index = 1; index < routes.length; index += 1) {
    const route = routes[index];
    if (route === undefined) {
      continue;
    }
    const next = routeTraits(route, options, securitySchemes, strictSecurity);
    if (!sameDocumentValue(first, next)) {
      throw versioningError(
        route,
        'versions have different security or deprecation metadata, which one OpenAPI operation cannot represent',
      );
    }
  }
  return first;
}

function headerOperation(
  routes: readonly CollectedRoute[],
  strategy: Extract<VersionStrategy, { readonly kind: 'header' }>,
  options: OpenApiOptions,
  securitySchemes: Readonly<Record<string, SecurityScheme>>,
  strictSecurity: boolean,
): OpenApiOperation {
  const versionEntries = versionSchemasFor(routes, options);
  const first = versionEntries[0];
  if (first === undefined) {
    throw versioningError(routes[0] ?? emptyCollectedRoute(), 'the operation declares no versions');
  }
  if (!versionEntries.some(entry => entry.version === strategy.default)) {
    throw versioningError(
      first.route,
      `configured default "${strategy.default}" is not served by this operation, so its version header cannot be optional`,
    );
  }
  for (let index = 1; index < versionEntries.length; index += 1) {
    const next = versionEntries[index];
    if (next !== undefined && !sameDocumentValue(first.schemas, next.schemas)) {
      throw versioningError(next.route, 'header-versioned request or response schemas differ across versions');
    }
  }
  const operation = operationFor(
    first.route,
    first.schemas,
    sharedTraits(routes, options, securitySchemes, strictSecurity),
  );
  operation.parameters = [
    ...(operation.parameters ?? []),
    {
      name: strategy.name,
      in: 'header',
      required: false,
      schema: { enum: versionEntries.map(entry => entry.version), default: strategy.default },
    },
  ];
  return operation;
}

function mediaTypeOperation(
  routes: readonly CollectedRoute[],
  strategy: Extract<VersionStrategy, { readonly kind: 'media-type' }>,
  options: OpenApiOptions,
  securitySchemes: Readonly<Record<string, SecurityScheme>>,
  strictSecurity: boolean,
): OpenApiOperation {
  const versionEntries = versionSchemasFor(routes, options);
  const first = versionEntries[0];
  if (first === undefined) {
    throw versioningError(routes[0] ?? emptyCollectedRoute(), 'the operation declares no versions');
  }
  for (let index = 1; index < versionEntries.length; index += 1) {
    const next = versionEntries[index];
    if (next !== undefined && !sameDocumentValue(first.schemas?.body, next.schemas?.body)) {
      throw versioningError(
        next.route,
        'media-type versioning reads Accept rather than Content-Type, so request schemas must be identical',
      );
    }
  }

  const operation = operationFor(
    first.route,
    first.schemas?.body === undefined ? undefined : { body: first.schemas.body },
    sharedTraits(routes, options, securitySchemes, strictSecurity),
  );
  const hasResponseSchema = versionEntries.some(entry => entry.schemas?.response !== undefined);
  if (hasResponseSchema) {
    const content: Record<string, { schema: JsonSchema }> = {};
    for (const entry of versionEntries) {
      if (entry.schemas?.response === undefined) {
        throw versioningError(
          entry.route,
          'a media-type operation supplies a response schema for only some of its versions',
        );
      }
      content[jsonMediaTypeForVersion(strategy.key, entry.version)] = { schema: entry.schemas.response };
    }
    operation.responses = { '200': { description: 'OK', content } };
  }
  return operation;
}

function emptyCollectedRoute(): CollectedRoute {
  return {
    controllerName: '<unknown>',
    handlerName: '<unknown>',
    openapiPath: '/',
    method: 'get',
    params: [],
    publicRoute: false,
    routePath: '/',
    schemaPath: '/',
    versions: undefined,
    order: -1,
  };
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
  const securitySchemes = options.securitySchemes ?? {};
  const strictSecurity =
    (options.routes !== undefined || options.guardRegistry !== undefined) && (options.strictSecurity ?? true);
  const paths: Record<string, PathItem> = {};
  const collected: CollectedRoute[] = [];
  let order = 0;

  for (const controller of controllers) {
    const cls = toClass(controller);
    if (cls === undefined) {
      continue;
    }
    for (const route of getRoutes(cls)) {
      const declaration = versionsOf(cls, route.handlerName);
      const publicRoute = isPublic(cls, route.handlerName);
      const method = route.method.toLowerCase();

      if (options.versioning === undefined) {
        if (declaration !== undefined && declaration !== 'neutral') {
          throw new Error(
            `OpenAPI versioning error at ${locationOf(cls.name, route.handlerName)}: ` +
              '@Version() requires OpenApiOptions.versioning',
          );
        }
        const { openapiPath, params } = toOpenApiPath(route.path);
        collected.push({
          controllerName: cls.name,
          handlerName: route.handlerName,
          openapiPath,
          method,
          params,
          publicRoute,
          routePath: route.path,
          schemaPath: route.path,
          versions: declaration,
          order,
        });
        order += 1;
        continue;
      }

      if (declaration === undefined) {
        throw new Error(
          `OpenAPI versioning error at ${locationOf(cls.name, route.handlerName)}: ` +
            'declare @Version(...) or @VersionNeutral()',
        );
      }

      if (options.versioning.kind === 'path' && declaration !== 'neutral') {
        for (const version of declaration) {
          const expandedPath = pathForVersion(options.versioning.prefix, version, route.path);
          const { openapiPath, params } = toOpenApiPath(expandedPath);
          collected.push({
            controllerName: cls.name,
            handlerName: route.handlerName,
            openapiPath,
            method,
            params,
            publicRoute,
            routePath: route.path,
            schemaPath: expandedPath,
            versions: undefined,
            order,
          });
          order += 1;
        }
        continue;
      }

      const { openapiPath, params } = toOpenApiPath(route.path);
      collected.push({
        controllerName: cls.name,
        handlerName: route.handlerName,
        openapiPath,
        method,
        params,
        publicRoute,
        routePath: route.path,
        schemaPath: route.path,
        versions: declaration,
        order,
      });
      order += 1;
    }
  }

  collected.sort((left, right) => {
    if (left.openapiPath !== right.openapiPath) {
      return left.openapiPath.localeCompare(right.openapiPath);
    }
    if (left.method !== right.method) {
      return left.method.localeCompare(right.method);
    }
    return left.order - right.order;
  });

  const operationIds = new Set<string>();
  for (let index = 0; index < collected.length;) {
    const first = collected[index];
    if (first === undefined) {
      break;
    }
    const group: CollectedRoute[] = [first];
    index += 1;
    while (
      index < collected.length &&
      collected[index]?.openapiPath === first.openapiPath &&
      collected[index]?.method === first.method
    ) {
      const next = collected[index];
      if (next !== undefined) {
        group.push(next);
      }
      index += 1;
    }

    const versioning = options.versioning;
    let operation: OpenApiOperation;
    if (versioning?.kind === 'header' || versioning?.kind === 'media-type') {
      const neutral = group.find(route => route.versions === 'neutral');
      if (neutral !== undefined) {
        if (group.length > 1) {
          throw versioningError(
            neutral,
            'neutral and version-specific handlers share one method and path, whose runtime shadowing one operation cannot express',
          );
        }
        operation = operationFor(
          neutral,
          options.schemas?.[neutral.schemaPath],
          routeTraits(neutral, options, securitySchemes, strictSecurity),
        );
      } else {
        operation =
          versioning.kind === 'header'
            ? headerOperation(group, versioning, options, securitySchemes, strictSecurity)
            : mediaTypeOperation(group, versioning, options, securitySchemes, strictSecurity);
      }
    } else {
      if (group.length > 1) {
        const operationId = operationIdForRoute(first.method, first.schemaPath);
        throw new Error(
          `@zmdb/web: duplicate OpenAPI operationId ${operationId} for ${first.method} ${first.openapiPath}`,
        );
      }
      operation = operationFor(
        first,
        options.schemas?.[first.schemaPath],
        routeTraits(first, options, securitySchemes, strictSecurity),
      );
    }

    if (operationIds.has(operation.operationId)) {
      throw new Error(
        `@zmdb/web: duplicate OpenAPI operationId ${operation.operationId} for ${first.method} ${first.openapiPath}`,
      );
    }
    operationIds.add(operation.operationId);
    const item = paths[first.openapiPath] ?? {};
    item[first.method] = operation;
    paths[first.openapiPath] = item;
  }

  if (Object.keys(securitySchemes).length === 0) {
    return { openapi: '3.1.0', info, paths };
  }
  return { openapi: '3.1.0', info, paths, components: { securitySchemes } };
}

/** A tiny handler that serves a prebuilt document (e.g. at /openapi.json). */
export function serveOpenApi(doc: OpenApiDocument): () => OpenApiDocument {
  return () => doc;
}
