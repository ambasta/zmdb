// @zmdb/web — OpenAPI 3.1 generation (epic #302, spec ./SPEC.md). Deterministic,
// build/boot-time, reflection-free: reads getRoutes + optional per-route schemas.
// No `as` on the consumer surface.

import type { JsonSchemaObject } from '@zmdb/schema-core/ir';

import '../polyfill.js';
import type { Guard, SecurityAwareGuard } from '../middleware/index.js';
import { resolveGuards } from '../pipeline/guards.js';
import type { GuardRegistry, RouteOptions, SecurityRequirement } from '../pipeline/index.js';
import { getRoutes, isPublic } from '../routing/index.js';

export type { SecurityAwareGuard } from '../middleware/index.js';
export type { GuardRegistry, SecurityRequirement } from '../pipeline/index.js';

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

/** Per-route request/response schemas, from `toJsonSchema` in either spelling. */
export interface RouteSchemas {
  readonly body?: JsonSchema;
  readonly response?: JsonSchema;
}

export interface OAuthFlow {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}

export interface ImplicitFlow extends OAuthFlow {
  readonly authorizationUrl: string;
}

export interface PasswordFlow extends OAuthFlow {
  readonly tokenUrl: string;
}

export interface ClientCredentialsFlow extends OAuthFlow {
  readonly tokenUrl: string;
}

export interface AuthorizationCodeFlow extends OAuthFlow {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
}

interface AllFlows {
  readonly implicit?: ImplicitFlow;
  readonly password?: PasswordFlow;
  readonly clientCredentials?: ClientCredentialsFlow;
  readonly authorizationCode?: AuthorizationCodeFlow;
}

/** At least one OAuth2 flow, with the fields OpenAPI 3.1 requires for that flow. */
export type OAuthFlows =
  | (AllFlows & { readonly implicit: ImplicitFlow })
  | (AllFlows & { readonly password: PasswordFlow })
  | (AllFlows & { readonly clientCredentials: ClientCredentialsFlow })
  | (AllFlows & { readonly authorizationCode: AuthorizationCodeFlow });

/** The five OpenAPI 3.1 security scheme types (HTTP is split by scheme). */
export type SecurityScheme =
  | {
      readonly type: 'http';
      readonly scheme: 'bearer';
      readonly bearerFormat?: string;
      readonly description?: string;
    }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'oauth2'; readonly flows: OAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };

/** Options for `toOpenApi`. */
export interface OpenApiOptions {
  readonly info?: { readonly title: string; readonly version: string };
  readonly schemas?: Readonly<Record<string, RouteSchemas>>;
  readonly securitySchemes?: Readonly<Record<string, SecurityScheme>>;
  readonly routes?: Readonly<Record<string, Readonly<Record<string, RouteOptions>>>>;
  readonly guardRegistry?: GuardRegistry;
  readonly strictSecurity?: boolean;
}

interface OpenApiParameter {
  readonly name: string;
  readonly in: 'path';
  readonly required: true;
  readonly schema: { readonly type: 'string' };
}

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
  const securitySchemes = options.securitySchemes ?? {};
  const strictSecurity =
    (options.routes !== undefined || options.guardRegistry !== undefined) && (options.strictSecurity ?? true);
  const paths: Record<string, PathItem> = {};

  // Collect routes across controllers, then emit in a stable order.
  const collected: {
    controllerName: string;
    handlerName: string;
    openapiPath: string;
    method: string;
    operationId: string;
    params: string[];
    publicRoute: boolean;
    routePath: string;
  }[] = [];
  for (const controller of controllers) {
    const cls = toClass(controller);
    if (cls === undefined) {
      continue;
    }
    for (const route of getRoutes(cls)) {
      const { openapiPath, params } = toOpenApiPath(route.path);
      const method = route.method.toLowerCase();
      collected.push({
        controllerName: cls.name,
        handlerName: route.handlerName,
        openapiPath,
        method,
        operationId: operationIdForRoute(method, route.path),
        params,
        publicRoute: isPublic(cls, route.handlerName),
        routePath: route.path,
      });
    }
  }
  collected.sort((a, b) =>
    a.openapiPath === b.openapiPath ? a.method.localeCompare(b.method) : a.openapiPath.localeCompare(b.openapiPath),
  );

  const operationIds = new Set<string>();
  const routeKeys = new Set<string>();
  for (const entry of collected) {
    const routeKey = `${entry.method} ${entry.openapiPath}`;
    if (routeKeys.has(routeKey) || operationIds.has(entry.operationId)) {
      throw new Error(`@zmdb/web: duplicate OpenAPI operationId ${entry.operationId} for ${routeKey}`);
    }
    routeKeys.add(routeKey);
    operationIds.add(entry.operationId);
    const item = paths[entry.openapiPath] ?? {};
    const operation: OpenApiOperation = {
      operationId: entry.operationId,
      responses: { '200': { description: 'OK' } },
    };
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
    const routeOptions = options.routes?.[entry.controllerName]?.[entry.handlerName];
    const security = securityFor(
      routeOptions,
      options.guardRegistry,
      securitySchemes,
      strictSecurity,
      entry.publicRoute,
      entry.controllerName,
      entry.handlerName,
    );
    if (security !== undefined) {
      operation.security = security;
    }
    if (routeOptions?.deprecated === true) {
      operation.deprecated = true;
    }
    item[entry.method] = operation;
    paths[entry.openapiPath] = item;
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
