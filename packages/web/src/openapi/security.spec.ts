import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';

import type { Guard } from '../middleware/index.js';
import { createRouter, type GuardRegistry, type RouteOptions } from '../pipeline/index.js';
import { Controller, Delete, Get, Post, Public, isPublic } from '../routing/index.js';
import {
  toOpenApi,
  type OpenApiDocument,
  type OpenApiOptions,
  type SecurityAwareGuard,
  type SecurityRequirement,
  type SecurityScheme,
} from './index.js';

// Guard-derived security in the generated document. Tests freeze for the epic "OpenAPI security
// schemes and API versioning" (#572 / spec freeze #573); the frozen text is `./SPEC.md`
// `## Amendments (security schemes and versioning, #573)` §S1-§S8, and the list this file answers is
// §S9 items 1, 3, 4, 6, 7, 8, 11 and 12.
//
// The load-bearing titles are unchanged from the tests freeze because
// `tests/api-coverage/mapping.mjs` can cite them by exact text.
//
// The adversarial cases are first on purpose. §S9 items 6 and 7 are the two ways this feature fails
// *permissively* — a document that says nothing about a protected route, and a document that
// understates what a route requires - and a permissive failure is the one nobody notices. Note what
// the recorded pre-#575 actuals say that every one of the options below was
// accepted and silently ignored, so an application adopting the frozen surface
// early got a document that described none of its security and no error saying so.
//
// Three of §S9's claims are **not expressible at this freeze** and are not silently missing:
//
//   - Item 5 in full, and S3's fourth table row (`@Public()` emits `security: []`). `Public` and
//     `isPublic` do not exist, and a `.spec.ts` that names a missing export of an existing ESM module
//     fails to *link* - the whole file stops collecting, which is not an expected failure but a
//     broken suite. `./security.type-test.ts` holds their signatures instead; the behavioural half,
//     including "`isPublic` reads the decorated route and not its sibling", has to be written by the
//     slice that adds the decorator.
//   - §S9 items 9 and 10 for the header and media-type strategies: see
//     `./versioned-documents.spec.ts`, which also records why the frozen `OpenApiOptions` cannot
//     reach them.
//   - The order of keys *inside* a requirement object (§S9 item 12). S3 fixes the order of scopes
//     ("union, sorted, deduplicated") and says nothing about the order of scheme keys, so the
//     determinism test below pins that two generations agree and the two-scheme test uses `toEqual`,
//     which is key-order-blind. Pinning an order the spec does not state would freeze a coin flip.

// ---------------------------------------------------------------------------
// The implemented surface
// ---------------------------------------------------------------------------
//
/** §S3: a guard that describes what it enforces. */
type AwareGuard = SecurityAwareGuard;

/** §S2. */
type FrozenRequirement = SecurityRequirement;

/** §S2 and §S8: the per-handler record `router.register` accepts. */
type FrozenRouteOptions = RouteOptions;

/** §S2: `toOpenApi`'s options. */
type FrozenOptions = OpenApiOptions;

/** §S1 and §S8: the document, whose operations gain `security` and `deprecated`. */
interface FrozenOperation {
  readonly security?: readonly FrozenRequirement[];
  readonly deprecated?: true;
}

type FrozenDocument = Omit<OpenApiDocument, 'paths'> & {
  readonly paths: Readonly<Record<string, Readonly<Record<string, FrozenOperation>>>>;
  readonly components?: { readonly securitySchemes: Readonly<Record<string, unknown>> };
};

@Controller('/posts')
class PostsController {
  @Get('')
  list() {
    return [];
  }

  @Post('')
  create() {
    return {};
  }

  @Get('/:id')
  read() {
    return {};
  }

  @Delete('/:id')
  remove() {
    return {};
  }
}

const CONTROLLERS = [PostsController];
const INFO = { title: 'Posts API', version: '1.0.0' };

/**
 * One declaration per 3.1 scheme type, and per OAuth2 flow with `refreshUrl` present and absent -
 * §S9 item 1's whole list, in one record, because the claim is that the record round-trips.
 */
const SCHEMES: Readonly<Record<string, SecurityScheme>> = {
  apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
  authorizationCodeFlow: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://id.example.test/authorize',
        tokenUrl: 'https://id.example.test/token',
        scopes: { 'posts:read': 'read posts', 'posts:write': 'write posts' },
      },
    },
  },
  authorizationCodeFlowRefreshable: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://id.example.test/authorize',
        tokenUrl: 'https://id.example.test/token',
        refreshUrl: 'https://id.example.test/refresh',
        scopes: {},
      },
    },
  },
  basicAuth: { type: 'http', scheme: 'basic', description: 'operators only' },
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  clientCredentialsFlow: {
    type: 'oauth2',
    flows: { clientCredentials: { tokenUrl: 'https://id.example.test/token', scopes: {} } },
  },
  clientCredentialsFlowRefreshable: {
    type: 'oauth2',
    flows: {
      clientCredentials: {
        tokenUrl: 'https://id.example.test/token',
        refreshUrl: 'https://id.example.test/refresh',
        scopes: {},
      },
    },
  },
  implicitFlow: {
    type: 'oauth2',
    flows: { implicit: { authorizationUrl: 'https://id.example.test/authorize', scopes: {} } },
  },
  implicitFlowRefreshable: {
    type: 'oauth2',
    flows: {
      implicit: {
        authorizationUrl: 'https://id.example.test/authorize',
        refreshUrl: 'https://id.example.test/refresh',
        scopes: { 'posts:read': 'read posts' },
      },
    },
  },
  mesh: { type: 'mutualTLS', description: 'client certificate terminated by the mesh' },
  oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://id.example.test/.well-known/openid-configuration' },
  passwordFlow: { type: 'oauth2', flows: { password: { tokenUrl: 'https://id.example.test/token', scopes: {} } } },
  passwordFlowRefreshable: {
    type: 'oauth2',
    flows: {
      password: {
        tokenUrl: 'https://id.example.test/token',
        refreshUrl: 'https://id.example.test/refresh',
        scopes: {},
      },
    },
  },
};

// A guard whose scopes are computed rather than written, which is the runtime half of §S9 item 2's
// third claim: `enforces.scopes` is required, so a guard reading its scopes out of configuration
// constructs without a cast. An optional `scopes?` under `exactOptionalPropertyTypes` could not be
// filled from a `readonly string[] | undefined` at all.
const configuredScopes: readonly string[] = ['posts:write', ''].filter(scope => scope.length > 0);

const auth: AwareGuard = { canActivate: () => true, enforces: { scheme: 'bearerAuth', scopes: [] } };
const fromConfig: AwareGuard = {
  canActivate: () => true,
  enforces: { scheme: 'bearerAuth', scopes: configuredScopes },
};
const requireRead: AwareGuard = {
  canActivate: () => true,
  enforces: { scheme: 'bearerAuth', scopes: ['posts:read'] },
};
const requireWrite: AwareGuard = {
  canActivate: () => true,
  enforces: { scheme: 'bearerAuth', scopes: ['posts:write'] },
};
const byApiKey: AwareGuard = { canActivate: () => true, enforces: { scheme: 'apiKey', scopes: [] } };
const misdeclared: AwareGuard = { canActivate: () => true, enforces: { scheme: 'ghostAuth', scopes: [] } };

/** §S5's first case: a third-party guard that is a `Guard` and can never be a `SecurityAwareGuard`. */
const legacy: Guard = { canActivate: () => true };

@Controller('/status')
class StatusController {
  @Public()
  @Get('/live')
  live() {
    return { ok: true };
  }

  @Get('/private')
  privateStatus() {
    return { ok: true };
  }
}

class InheritedStatusController extends StatusController {}

class PrivateStatusOverrideController extends StatusController {
  @Get('/live')
  override live() {
    return { ok: true };
  }
}

class PublicStatusOverrideController extends StatusController {
  @Public()
  @Get('/live')
  override live() {
    return { ok: true };
  }
}

@Controller('/levels')
class GuardLevelsController {
  @Get('/private')
  privateRoute() {
    return { ok: true };
  }

  @Public()
  @Get('/public')
  publicRoute() {
    return { ok: true };
  }
}

/**
 * The generated document, as JSON.
 *
 * boundary: `components` and an operation's `security` are the keys §S1-§S8 add, and today's
 * `OpenApiDocument` has neither, so every claim below is made against the *serialised* document -
 * which is what a document is and what a client generator reads - rather than through a cast naming
 * the whole future shape. This is the only place in the file an untyped value is narrowed.
 */
function documentOf(options: FrozenOptions): FrozenDocument {
  return JSON.parse(JSON.stringify(toOpenApi(CONTROLLERS, options)));
}

/**
 * What the document states about one operation's security, or that it states nothing.
 *
 * `'security' in operation` and not `?? []`: §S4 and §S6 turn on the difference between an empty
 * requirement array, which says "no authentication required", and an absent key, which says
 * nothing at all and is read as public by every generator. A helper that collapsed the two would
 * make the tests below unable to see the failure this epic exists to prevent.
 */
function securityOf(options: FrozenOptions, path: string, method: string): string {
  const operation = documentOf(options).paths[path]?.[method];
  if (operation === undefined) {
    return `no operation at ${method} ${path}`;
  }
  return 'security' in operation ? JSON.stringify(operation.security) : 'no security key';
}

async function validateOpenApi(document: OpenApiDocument): Promise<void> {
  const validator = new Validator();
  // boundary: the validator accepts an open JSON record; serialisation proves
  // this public document contains only JSON data without asserting its type.
  const json: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  const result = await validator.validate(json);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  expect(validator.version).toBe('3.1');
}

/** Every handler declared, so that under strictness the only thing an error can be about is the one under test. */
const GUARDED: Readonly<Record<string, FrozenRouteOptions>> = {
  list: { guards: [auth] },
  create: { guards: [auth] },
  read: { guards: [auth] },
  remove: { guards: [auth] },
};

function strictOptions(routes: Readonly<Record<string, FrozenRouteOptions>>): FrozenOptions {
  return {
    info: INFO,
    securitySchemes: SCHEMES,
    routes: { PostsController: { ...GUARDED, ...routes } },
    strictSecurity: true,
  };
}

/**
 * `strictSecurity: false` for the derivation tests, so that a route this test says nothing about
 * cannot make generation throw for a reason the test is not about. The default is `true` (§S4) and
 * items 6 and 7 exercise it directly.
 */
function laxOptions(routes: Readonly<Record<string, FrozenRouteOptions>>): FrozenOptions {
  return { info: INFO, securitySchemes: SCHEMES, routes: { PostsController: routes }, strictSecurity: false };
}

/** A configuration that is valid under strictness with every §S1-§S8 feature present. */
const fullyConfigured: FrozenOptions = strictOptions({
  list: { guards: [fromConfig, requireRead] },
  create: { guards: [auth, byApiKey], deprecated: true },
  read: { guards: [legacy], security: [{ mesh: [] }] },
  remove: { guards: [auth], security: [{ bearerAuth: ['posts:write'], mesh: [] }] },
});

describe('guard-derived security (frozen: openapi/SPEC.md S1-S8)', () => {
  // §S9 item 6, second row, and the one the epic exists for. "Forgot a guard" and "meant it to be
  // public" are the same document text, so the freeze is that they are not the same *input*: with
  // strictness on, a handler with no guards and no `@Public()` stops generation, and the message
  // names the controller and the handler so the fix is one line away rather than a search.
  //
  // pre-#575 actual, on the first assertion:
  //   names the controller: expected [Function generate] to throw an error
  // - `strictSecurity: true` is accepted and ignored, and generation returns a document in which
  // `create` is indistinguishable from a route somebody decided to publish.
  it('refuses to generate a route with neither guards nor a public marker', () => {
    const generate = () => toOpenApi(CONTROLLERS, strictOptions({ create: {} }));
    expect(generate, 'names the controller').toThrow(/PostsController/);
    expect(generate, 'names the handler').toThrow(/\bcreate\b/);
    expect(
      () => toOpenApi(CONTROLLERS, strictOptions({ create: { security: [] } })),
      'an empty override is not a substitute for @Public()',
    ).toThrow();
    expect(
      () => toOpenApi(CONTROLLERS, strictOptions({ create: { security: [{ mesh: [] }] } })),
      'documentation-only protection is not a route guard',
    ).toThrow();
  });

  // §S9 item 6, first row. A third-party guard is a `Guard` and nothing can be added to it, so the
  // route is protected and the document would say nothing about it. §S5 gives the way out - an
  // explicit `security` - and the error is what makes somebody take it.
  //
  // The message is not asserted beyond throwing: §S4's table requires the controller and handler
  // names for the second row only, and asserting a message the frozen text does not fix would
  // freeze an invention.
  //
  // pre-#575 actual: expected [Function] to throw an error
  it('refuses to generate a guarded route whose guards cannot declare', () => {
    expect(() => toOpenApi(CONTROLLERS, strictOptions({ read: { guards: [legacy] } }))).toThrow();
  });

  // §S9 item 7, first clause, at scheme granularity: the explicit override may overstate what a
  // route requires and must never understate it. Dropping `apiKey` here would generate a client
  // that sends a bearer token and gets a 403 it cannot explain.
  //
  // pre-#575 actual: expected [Function] to throw an error
  it('refuses an explicit requirement that omits a scheme its guards enforce', () => {
    const routes = { list: { guards: [auth, byApiKey], security: [{ bearerAuth: [] }] } };
    expect(() => toOpenApi(CONTROLLERS, strictOptions(routes))).toThrow();
  });

  // §S9 item 7, first clause, at scope granularity - the half that is easy to implement and easy to
  // forget, because the scheme names match and only the arrays differ. `[]` against a guard
  // enforcing `posts:write` is a document that tells a client its read-only token is enough.
  //
  // pre-#575 actual: expected [Function] to throw an error
  it('refuses an explicit requirement that drops a scope its guards enforce', () => {
    const routes = { list: { guards: [requireWrite], security: [{ bearerAuth: [] }] } };
    expect(() => toOpenApi(CONTROLLERS, strictOptions(routes))).toThrow();
  });

  // §S9 item 7, third clause. A scheme name is a `string` and not a `keyof` (§S3's rejected list),
  // which puts the whole weight of catching a typo on generation. `bearerAuth` is present so this
  // is not also a subset violation: the only defect is the name.
  //
  // pre-#575 actual: expected [Function] to throw an error
  it('refuses an explicit requirement naming a scheme that was never declared', () => {
    const routes = { list: { guards: [auth], security: [{ bearerAuth: [], ghostAuth: [] }] } };
    expect(() => toOpenApi(CONTROLLERS, strictOptions(routes))).toThrow();
  });

  // The same claim from the guard's side (§S3: "a name with no matching declaration is a generation
  // error"), which is where the typo actually gets written - a guard is authored once, in another
  // file, and its `enforces.scheme` is a bare string nothing else checks.
  //
  // pre-#575 actual: expected [Function] to throw an error
  it('refuses a guard enforcing a scheme that was never declared', () => {
    expect(() => toOpenApi(CONTROLLERS, strictOptions({ list: { guards: [misdeclared] } }))).toThrow();
  });

  // §S9 item 7, second clause. A superset is legitimate - a mesh presenting a client certificate is
  // enforced somewhere the framework cannot see - and the override is what the operation states.
  //
  // pre-#575 actual: no security key
  it('accepts an explicit requirement that adds a scheme the framework cannot see', () => {
    const routes = { list: { guards: [auth], security: [{ bearerAuth: [], mesh: [] }] } };
    expect(securityOf(strictOptions(routes), '/posts', 'get')).toBe('[{"bearerAuth":[],"mesh":[]}]');
  });

  // §S9 item 4, first row of §S3's table. One guard, one requirement object, `[]` for no scopes -
  // OpenAPI's no-scopes form is an empty array and not an absent key.
  //
  // pre-#575 actual: no security key
  it('derives one requirement object from a single declaring guard', () => {
    expect(securityOf(laxOptions({ list: { guards: [auth] } }), '/posts', 'get')).toBe('[{"bearerAuth":[]}]');
  });

  // §S9 item 4, second row, and the reason the union is sorted: `{ bearerAuth: ['a'], bearerAuth:
  // ['b'] }` is not a thing, a route behind two guards on one scheme requires both scopes, and an
  // order derived from the guard array would make the document depend on how the array was written.
  // `posts:write` arrives from `configuredScopes`, unsorted relative to `posts:read`.
  //
  // pre-#575 actual: no security key
  it('merges two guards on one scheme into a sorted union of their scopes', () => {
    const routes = { list: { guards: [fromConfig, requireRead] } };
    expect(securityOf(laxOptions(routes), '/posts', 'get')).toBe('[{"bearerAuth":["posts:read","posts:write"]}]');
  });

  // The same rule's deduplication half. Two guards enforcing the same scope is the normal case when
  // one is a coarse authentication guard and the other a fine-grained one, and a document listing
  // `posts:write` twice is invalid against the 3.1 schema, not merely untidy.
  //
  // pre-#575 actual: no security key
  it('lists a scope two guards both enforce exactly once', () => {
    const routes = { list: { guards: [requireWrite, fromConfig] } };
    expect(securityOf(laxOptions(routes), '/posts', 'get')).toBe('[{"bearerAuth":["posts:write"]}]');
  });

  // §S9 item 4, third row, and §S3's rejected OR spelling. `runChain` throws on the first guard that
  // returns false, so every guard must pass; several schemes in *one* requirement object is
  // OpenAPI's AND, and several objects in the array is its OR. Emitting two objects here would tell
  // a generated client that either credential alone is enough - a document that understates
  // enforcement, which is the failure this epic exists to prevent.
  //
  // `toEqual` and a length assertion rather than a string: the claim is one object containing both
  // schemes, and §S3 fixes the order of scopes but not of scheme keys (see the header).
  //
  // pre-#575 actual: expected undefined to deeply equal [ { bearerAuth: [], apiKey: [] } ]
  it('emits one requirement object for two schemes rather than one object each', () => {
    const routes = { list: { guards: [auth, byApiKey] } };
    const security = documentOf(laxOptions(routes)).paths['/posts']?.get?.security;
    expect(security).toEqual([{ bearerAuth: [], apiKey: [] }]);
    expect(security).toHaveLength(1);
  });

  // §S9 item 1. A declaration round-trips into `components.securitySchemes` unchanged, for every 3.1
  // scheme type and every OAuth2 flow with and without `refreshUrl`. `toStrictEqual`, so a scheme
  // that arrives with an extra key or a dropped `refreshUrl` is a failure and not a near miss.
  //
  // pre-#575 actual: expected undefined to strictly equal { securitySchemes: { …(13) } }
  // - there is no `components` key at all.
  it('round-trips every declared scheme into components.securitySchemes', () => {
    const options: FrozenOptions = { info: INFO, securitySchemes: SCHEMES, strictSecurity: false };
    expect(documentOf(options).components).toStrictEqual({ securitySchemes: SCHEMES });
  });

  it('reads the public marker from only the decorated route', () => {
    expect(isPublic(StatusController, 'live')).toBe(true);
    expect(isPublic(StatusController, 'privateStatus')).toBe(false);
    expect(isPublic(InheritedStatusController, 'live')).toBe(true);
    expect(isPublic(PrivateStatusOverrideController, 'live')).toBe(false);
    expect(isPublic(PublicStatusOverrideController, 'live')).toBe(true);
  });

  it('emits an empty security requirement for a public route', () => {
    const routes = { StatusController: { privateStatus: { guards: [auth] } } };
    const doc = toOpenApi([StatusController], { info: INFO, routes, securitySchemes: SCHEMES });
    expect(doc.paths['/status/live']?.get?.security).toEqual([]);
    expect(doc.paths['/status/private']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(() =>
      toOpenApi([StatusController], {
        info: INFO,
        routes: { StatusController: { live: { guards: [auth] }, privateStatus: { guards: [auth] } } },
        securitySchemes: SCHEMES,
      }),
    ).toThrow(/@Public/);
  });

  it('uses the same guard record for request enforcement and document derivation', async () => {
    let calls = 0;
    const denying: SecurityAwareGuard = {
      canActivate: () => {
        calls += 1;
        return false;
      },
      enforces: { scheme: 'bearerAuth', scopes: ['posts:read'] },
    };
    const routeOptions = { privateStatus: { guards: [denying] } } satisfies Record<string, RouteOptions>;
    const router = createRouter();
    router.register(new StatusController(), routeOptions);

    const response = await router.handle({ method: 'GET', path: '/status/private', headers: {} });
    expect(response.status).toBe(403);
    expect(calls).toBe(1);

    const doc = toOpenApi([StatusController], {
      info: INFO,
      routes: { StatusController: routeOptions },
      securitySchemes: SCHEMES,
    });
    expect(doc.paths['/status/private']?.get?.security).toEqual([{ bearerAuth: ['posts:read'] }]);
  });

  it('derives and runs app, controller, and route guards from the same registries', async () => {
    const calls: string[] = [];
    const tracked = (name: string, scheme: string, scopes: readonly string[]): SecurityAwareGuard => ({
      canActivate: () => {
        calls.push(name);
        return true;
      },
      enforces: { scheme, scopes },
    });
    const appGuard = tracked('app', 'authorizationCodeFlow', ['posts:read']);
    const controllerGuard = tracked('controller', 'apiKey', []);
    const routeGuard = tracked('route', 'authorizationCodeFlow', ['posts:write']);
    const guardRegistry = {
      app: [appGuard],
      controllers: { GuardLevelsController: [controllerGuard] },
    } satisfies GuardRegistry;
    const routeOptions = {
      privateRoute: { guards: [routeGuard] },
    } satisfies Record<string, RouteOptions>;

    const router = createRouter({ guardRegistry });
    router.register(new GuardLevelsController(), routeOptions);
    const privateResponse = await router.handle({ method: 'GET', path: '/levels/private', headers: {} });
    expect(privateResponse.status).toBe(200);
    expect(calls).toEqual(['app', 'controller', 'route']);

    calls.length = 0;
    const publicResponse = await router.handle({ method: 'GET', path: '/levels/public', headers: {} });
    expect(publicResponse.status).toBe(200);
    expect(calls, '@Public() bypasses inherited app/controller guards').toEqual([]);
    expect(() => {
      const conflicting = createRouter({ guardRegistry });
      conflicting.register(new GuardLevelsController(), { publicRoute: { guards: [routeGuard] } });
    }).toThrow(/@Public/);
    expect(() => {
      const conflicting = createRouter({ guardRegistry });
      conflicting.register(new GuardLevelsController(), {
        publicRoute: { security: [{ authorizationCodeFlow: [] }] },
      });
    }).toThrow(/@Public/);

    const document = toOpenApi([GuardLevelsController], {
      info: INFO,
      guardRegistry,
      routes: { GuardLevelsController: routeOptions },
      securitySchemes: SCHEMES,
    });
    expect(document.paths['/levels/private']?.get?.security).toEqual([
      { apiKey: [], authorizationCodeFlow: ['posts:read', 'posts:write'] },
    ]);
    expect(document.paths['/levels/public']?.get?.security).toEqual([]);

    const inheritedDocument = toOpenApi([GuardLevelsController], {
      info: INFO,
      guardRegistry,
      securitySchemes: SCHEMES,
    });
    expect(inheritedDocument.paths['/levels/private']?.get?.security).toEqual([
      { apiKey: [], authorizationCodeFlow: ['posts:read'] },
    ]);
    expect(inheritedDocument.paths['/levels/public']?.get?.security).toEqual([]);

    expect(() =>
      toOpenApi([GuardLevelsController], {
        info: INFO,
        guardRegistry,
        routes: {
          GuardLevelsController: {
            privateRoute: {
              guards: [routeGuard],
              security: [{ authorizationCodeFlow: ['posts:read', 'posts:write'] }],
            },
          },
        },
        securitySchemes: SCHEMES,
      }),
    ).toThrow(/apiKey/);
    await validateOpenApi(document);
    await validateOpenApi(inheritedDocument);
  });

  it('validates generated security documents against the OpenAPI 3.1 schema', async () => {
    await validateOpenApi(toOpenApi(CONTROLLERS, fullyConfigured));
    await validateOpenApi(
      toOpenApi([StatusController], {
        info: INFO,
        routes: { StatusController: { privateStatus: { guards: [auth] } } },
        securitySchemes: SCHEMES,
      }),
    );
  });

  // §S9 item 11. `deprecated: true` on the operation it was declared for and on nothing else - not
  // on the sibling operation sharing the path item, and not on the path item, which in 3.1 has no
  // such field. The `get,post` prefix is what catches a `deprecated` written one level up.
  //
  // pre-#575 actual: get,post | get=absent post=absent
  it('marks the deprecated operation and nothing else on its path', () => {
    const options = laxOptions({ list: {}, create: { deprecated: true } });
    const item = documentOf(options).paths['/posts'];
    const marks = Object.entries(item ?? {})
      .map(
        ([method, operation]) =>
          `${method}=${'deprecated' in operation ? JSON.stringify(operation.deprecated) : 'absent'}`,
      )
      .join(' ');
    expect(`${Object.keys(item ?? {}).join(',')} | ${marks}`).toBe('get,post | get=absent post=true');
  });

  // Green: the amendment is additive (§S9 item 3). Passing the new options unset must produce the
  // document today's callers already get, byte for byte - `components` is emitted only when a scheme
  // is declared, and `openapi.spec.ts`, `generated-schemas.spec.ts`, the benchmark harness and every
  // documented example call `toOpenApi` with neither `routes`, `guardRegistry` nor
  // `securitySchemes`. This is the assertion that breaks if strictness is applied to a call that has
  // not opted in at all.
  it('generates the pre-amendment document when the new options are absent', () => {
    const widened: FrozenOptions = { info: INFO };
    expect(JSON.stringify(toOpenApi(CONTROLLERS, widened))).toBe(
      JSON.stringify(toOpenApi(CONTROLLERS, { info: INFO })),
    );
    expect(Object.keys(documentOf(widened))).toEqual(['openapi', 'info', 'paths']);
  });

  // Green, and the most valuable green here: §S4 is explicit that the `strictSecurity: false`
  // opt-out produces a *silent* document and not a false one. An implementation that emitted
  // `security: []` for an undeclared route while making the two red tests above pass would be
  // claiming, in machine-readable form, that a route nobody has thought about needs no
  // authentication. An absent key is a gap; `[]` is a lie.
  it('says nothing about an undeclared route when strict security is off', () => {
    const options = laxOptions({ create: {}, read: { guards: [legacy] } });
    expect(securityOf(options, '/posts', 'post'), 'no guards at all').toBe('no security key');
    expect(securityOf(options, '/posts/{id}', 'get'), 'guards that cannot declare').toBe('no security key');
  });

  // Green: §S9 item 8 and §S6. There is no top-level `security` and no option to supply one, because
  // a document-level default plus per-operation overrides makes "inherits the default" and "nobody
  // wrote anything" the same absent key. It holds today for want of the feature; it has to still hold
  // with every part of the feature configured, and the conventional arrangement - which
  // `docs-site/content/web-openapi-security.md`'s workaround section still shows - is exactly the one
  // that breaks it.
  it('never states security at the top level of the document', () => {
    expect(Object.keys(documentOf(fullyConfigured))).not.toContain('security');
  });

  // Green: §S9 item 12. Determinism is already a frozen invariant of this generator ("paths and
  // methods emitted in a stable (sorted) order") and every part of the amendment adds a place to
  // lose it - a `Set` of scopes iterated in insertion order, a scheme record walked with
  // `Object.keys` of a merged object, a requirement object built from a guard array. Two generations
  // of one input, compared as bytes, is the assertion that survives all of it.
  it('generates the same bytes twice from one fully configured input', () => {
    const first = JSON.stringify(toOpenApi(CONTROLLERS, fullyConfigured));
    expect(JSON.stringify(toOpenApi(CONTROLLERS, fullyConfigured))).toBe(first);
  });
});
