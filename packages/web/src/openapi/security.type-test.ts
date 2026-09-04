// The security surface, as types. Tests freeze for the epic "OpenAPI security schemes and API
// versioning" (#572 / spec freeze #573); the frozen text is `./SPEC.md`
// `## Amendments (security schemes and versioning, #573)` §S1-S8, and the list this file answers is
// §S9 item 2.
//
// `node scripts/typecheck.mjs` compiles this file, so a frozen claim written plainly is a build
// failure rather than a red test; `@ts-expect-error` over the claim is the `it.fails` of
// `./security.spec.ts`. Each directive absorbs today's errors on exactly one line and reports
// TS2578 the day the claim comes true, so #575 cannot land without editing this file.
//
// Two of §S9 item 2's three claims cannot be written the way it words them. "`bearerFormat` on the
// `basic` arm is rejected" and "an empty `OAuthFlows` is rejected" are claims that a literal becomes
// *illegal*, and a `@ts-expect-error` over a literal that is legal today reports TS2578 immediately -
// red on the way in, which is the one thing a tests freeze must not be. Both are carried positively
// instead, and twice over: once against the imported name (red today, retires with #575) and once
// against the frozen text held locally (green today, and that half is what checks that the *spec*
// rejects what it says it rejects).
//
// Why the frozen text is held locally at all: an unresolved import is an error type, an error type
// behaves like `any`, and `Extends<any, X>` is vacuously true. Every red claim here is therefore an
// `Equal` against a local alias rather than an `Extends` against the import - verified, the
// `Extends`-shaped versions of the flow and guard claims both reported TS2578 on the way in.
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { Guard } from '../middleware/index.js';
import type {
  createRouter,
  GuardRegistry as PipelineGuardRegistry,
  RouteOptions,
  RouterOptions,
} from '../pipeline/index.js';
import type { getRoutes, isPublic, Public } from '../routing/index.js';
// One import statement, not two: `import/no-duplicates` is an error in `.oxlintrc.json` and
// `respectEslintDisableDirectives` is false there, so a second `from './index.js'` is neither
// writable nor excusable - verified, oxlint reports it. It is also one *line*, because a directive
// over a wrapped specifier list is TS2578 while the TS2305s land on the inner lines, and `oxfmt`
// wraps at 120 - so this line is 113 characters on purpose and adding a name to it breaks the file.
//
// `toOpenApi` rather than `OpenApiDocument` and `OpenApiOptions`, which would not have fitted: the
// document and options claims below are indexed off the function's own signature, which is a
// stronger statement than the exported aliases anyway. `./security.spec.ts` imports both aliases
// with no directive, so a rename of either is still reported somewhere.
//
// One thing this import asserts that the frozen text does not fix: **where two of the four names
// live.** §S1's block is this module's, but §S3 writes `SecurityAwareGuard extends Guard` (which
// reads as `../middleware/index.ts`, beside `Guard`) and §S2 shows `SecurityRequirement` in the same
// block as `RouteOptions` (which reads as `../pipeline/index.ts`). Neither section names a file. This
// file claims all four are reachable from `@zmdb/web/openapi`, because they are the document's
// vocabulary and a re-export costs nothing; if #575 declares them elsewhere and does *not* re-export,
// the directive below stays satisfied by the remaining names and the two `Equal`s stay quietly
// `false`, so #575 must re-point this line rather than assume it. Reported as a spec gap.
//
import type {
  GuardRegistry,
  OAuthFlows,
  SecurityAwareGuard,
  SecurityRequirement,
  SecurityScheme,
  toOpenApi,
} from './index.js';

/** The document `toOpenApi` actually returns, and the options it actually accepts. */
type Doc = ReturnType<typeof toOpenApi>;
type Opts = NonNullable<Parameters<typeof toOpenApi>[1]>;

// ---------------------------------------------------------------------------
// S1 - the scheme union, against OpenAPI 3.1
// ---------------------------------------------------------------------------

interface FrozenOAuthFlow {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}
interface FrozenImplicitFlow extends FrozenOAuthFlow {
  readonly authorizationUrl: string;
}
interface FrozenPasswordFlow extends FrozenOAuthFlow {
  readonly tokenUrl: string;
}
interface FrozenClientCredentialsFlow extends FrozenOAuthFlow {
  readonly tokenUrl: string;
}
interface FrozenAuthorizationCodeFlow extends FrozenOAuthFlow {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
}

interface FrozenAllFlows {
  readonly implicit?: FrozenImplicitFlow;
  readonly password?: FrozenPasswordFlow;
  readonly clientCredentials?: FrozenClientCredentialsFlow;
  readonly authorizationCode?: FrozenAuthorizationCodeFlow;
}

/** §S1 verbatim: at least one flow, as a four-arm union. */
type FrozenOAuthFlows =
  | (FrozenAllFlows & { readonly implicit: FrozenImplicitFlow })
  | (FrozenAllFlows & { readonly password: FrozenPasswordFlow })
  | (FrozenAllFlows & { readonly clientCredentials: FrozenClientCredentialsFlow })
  | (FrozenAllFlows & { readonly authorizationCode: FrozenAuthorizationCodeFlow });

/** §S1 verbatim. Six arms for 3.1's five scheme types, because `http` is split in two. */
type FrozenSecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat?: string; readonly description?: string }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'oauth2'; readonly flows: FrozenOAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };

export type _SchemeShape = Expect<Equal<SecurityScheme, FrozenSecurityScheme>>;

export type _FlowsShape = Expect<Equal<OAuthFlows, FrozenOAuthFlows>>;

type FrozenBasicArm = Extract<FrozenSecurityScheme, { readonly scheme: 'basic' }>;
type FrozenBearerArm = Extract<FrozenSecurityScheme, { readonly scheme: 'bearer' }>;

// §S1.1, checked against the frozen text rather than against the implementation. The claim is that
// `{ type: 'http', scheme: 'basic', bearerFormat: 'JWT' }` does not compile, and a rejection cannot
// be pre-asserted; `bearerFormat` absent from the basic arm's keys is the same claim written
// positively. Green today, and here because merging the two `http` arms back together in #575 is a
// change that makes `_SchemeShape` red and this one red too, rather than waiting for a consumer to
// write the meaningless literal.
export type _BasicArmHasNoBearerFormat = Expect<Equal<keyof FrozenBasicArm, 'type' | 'scheme' | 'description'>>;

type FrozenBearerKeys = 'type' | 'scheme' | 'bearerFormat' | 'description';

export type _BearerArmHasBearerFormat = Expect<Equal<keyof FrozenBearerArm, FrozenBearerKeys>>;

/** What every arm of an "at least one flow" union has to satisfy. */
type AtLeastOneFlow =
  | { readonly implicit: object }
  | { readonly password: object }
  | { readonly clientCredentials: object }
  | { readonly authorizationCode: object };

// The other half of §S9 item 2: `flows: {}` describes nothing and is what a half-finished
// configuration looks like. Asserted against the frozen union, for the reason above - this is
// `false` the moment `OAuthFlows` is simplified to the all-optional `FrozenAllFlows`, which is the
// only shape that lets `{}` through.
export type _FrozenFlowsNeedOne = Expect<Extends<FrozenOAuthFlows, AtLeastOneFlow>>;

// `scopes` required on every flow, so `{ bearerAuth: [] }` has an array to be filled from. Not
// `| undefined`, which is what an optional `scopes?` reads as under `exactOptionalPropertyTypes`.
export type _FlowScopesRequired = Expect<Equal<FrozenImplicitFlow['scopes'], Readonly<Record<string, string>>>>;

/** §S1: `components` is optional and carries `securitySchemes` and nothing else. */
type FrozenComponents = { readonly securitySchemes: Readonly<Record<string, FrozenSecurityScheme>> };

// Optional, because §S1 emits it only when a scheme is declared - which is what keeps a document
// generated by today's callers byte-for-byte what it is now (`./security.spec.ts` asserts that half
// at runtime, where it is green).
//
export type _Components = Expect<Equal<Doc['components'], FrozenComponents | undefined>>;

type FrozenDocumentKeys = 'openapi' | 'info' | 'paths' | 'components';

// §S6, said positively. "No top-level `security`" is an absence, and an absence cannot be asserted,
// so the whole key set of the returned document is pinned instead: an option to supply a top-level
// `security`, or a key emitted by default, breaks this line.
//
export type _DocumentKeys = Expect<Equal<keyof Doc, FrozenDocumentKeys>>;

// ---------------------------------------------------------------------------
// S2 - where the derivation reads from
// ---------------------------------------------------------------------------

type FrozenRoutes = Readonly<Record<string, Readonly<Record<string, RouteOptions>>>>;
type FrozenOptionKeys = 'info' | 'schemas' | 'securitySchemes' | 'routes' | 'guardRegistry' | 'strictSecurity';

export type _OptionKeys = Expect<Equal<keyof Opts, FrozenOptionKeys>>;

// Keyed by controller name, then by handler name - the same two-level key `register` already uses
// one controller at a time, which is what lets an application write the record once and hand the
// same object to the router and to the generator. `RouteOptions` and not a parallel type: if #575
// introduces a second record shape for the generator, this line goes red, and it should.
//
export type _RoutesRecord = Expect<Equal<Opts['routes'], FrozenRoutes | undefined>>;

interface FrozenGuardRegistry {
  readonly app?: readonly Guard[];
  readonly controllers?: Readonly<Record<string, readonly Guard[]>>;
}

export type _GuardRegistryShape = Expect<Equal<GuardRegistry, FrozenGuardRegistry>>;

export type _PipelineGuardRegistryShape = Expect<Equal<PipelineGuardRegistry, FrozenGuardRegistry>>;

export type _OpenApiGuardRegistry = Expect<Equal<Opts['guardRegistry'], GuardRegistry | undefined>>;

export type _RouterGuardRegistry = Expect<Equal<RouterOptions['guardRegistry'], PipelineGuardRegistry | undefined>>;

type CreateRouterParameters = Parameters<typeof createRouter>;

export type _CreateRouterOption = Expect<Equal<CreateRouterParameters[0], RouterOptions | undefined>>;

export type _CreateRouterArity = Expect<Equal<CreateRouterParameters['length'], 0 | 1>>;

// `boolean | undefined`, not `true | undefined`: `false` is the meaningful value here, the exact
// opposite of `deprecated` below. The two are written near each other because spelling them the
// same way is the mistake that is available.
//
export type _StrictSecurity = Expect<Equal<Opts['strictSecurity'], boolean | undefined>>;

type FrozenSchemeRecord = Readonly<Record<string, FrozenSecurityScheme>>;

export type _SecuritySchemes = Expect<Equal<Opts['securitySchemes'], FrozenSchemeRecord | undefined>>;

type FrozenRouteOptionKeys = 'validateBody' | 'guards' | 'security' | 'deprecated';

export type _RouteOptionKeys = Expect<Equal<keyof RouteOptions, FrozenRouteOptionKeys>>;

// The guards the router runs are the guards the document reads - `readonly Guard[]`, the same type
// `runChain` already loops over, so renaming `Guard` breaks this line.
//
export type _Guards = Expect<Equal<RouteOptions['guards'], readonly Guard[] | undefined>>;

type FrozenSecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type _SecurityOverride = Expect<Equal<RouteOptions['security'], readonly SecurityRequirement[] | undefined>>;

export type _RequirementShape = Expect<Equal<SecurityRequirement, FrozenSecurityRequirement>>;

// `true | undefined` rather than `boolean | undefined`, so `deprecated: false` is not a way to write
// a key that means nothing (§S8).
//
export type _DeprecatedIsTrue = Expect<Equal<RouteOptions['deprecated'], true | undefined>>;

// ---------------------------------------------------------------------------
// S3 - `enforces`
// ---------------------------------------------------------------------------

/** §S3 verbatim. `scopes` required and possibly empty; `scheme` a plain string. */
interface FrozenSecurityAwareGuard extends Guard {
  readonly enforces: { readonly scheme: string; readonly scopes: readonly string[] };
}

export type _AwareGuardShape = Expect<Equal<SecurityAwareGuard, FrozenSecurityAwareGuard>>;

// The intersection that keeps this file's claims about a real type rather than about a shape nobody
// has: a security-aware guard is still a `Guard`, so renaming `canActivate` breaks this line. Green,
// and it is the assertion that fails if #575 makes `enforces` a parallel interface rather than an
// extension - which would let a guard be registered as aware without being runnable.
export type _FrozenAwareGuardIsAGuard = Expect<Extends<FrozenSecurityAwareGuard, Guard>>;

// §S9 item 2's third claim, positively. `readonly string[]` and not `readonly string[] | undefined`:
// an optional `scopes?` under `exactOptionalPropertyTypes` cannot be filled from a computed
// `readonly string[] | undefined`, and pinning the required element type says "required" and "of
// strings" on one line. `./security.spec.ts` builds a guard from a computed value, which is where
// "accepts" is actually exercised.
export type _FrozenScopesRequired = Expect<Equal<FrozenSecurityAwareGuard['enforces']['scopes'], readonly string[]>>;

// A plain `string` checked at generation, deliberately not a `keyof` of the scheme record - which
// would put that record's type into the signature of every guard, to catch a typo that generation
// already catches.
export type _FrozenSchemeIsAString = Expect<Equal<FrozenSecurityAwareGuard['enforces']['scheme'], string>>;

// ---------------------------------------------------------------------------
// S4 - `@Public()`, in its stage-3 spelling
// ---------------------------------------------------------------------------

/** §S4 verbatim. Not `MethodDecorator`: that is the pre-stage-3 type. */
type FrozenPublic = () => (target: (...args: never[]) => unknown, context: ClassMethodDecoratorContext) => void;

/**
 * §S4 names `isPublic(controller, handlerName)` and gives it no signature; this is what follows from
 * "lives beside `getRoutes`", whose first parameter it copies exactly.
 */
type FrozenIsPublic = (controller: abstract new (...args: never[]) => unknown, handlerName: string) => boolean;

// No directive on these two, against every other imported-name claim in this file, and the reason is
// a distinction tsc drew that I had not expected. An unresolved *type* import is an error type and
// `Equal<errorType, X>` is `false`, which is what makes the rest of this file red. An unresolved
// *value* name gives `typeof X === any` and `Equal<any, X>` came back `true` - verified, both lines
// reported TS2578 with a directive on them. So the existence claim is carried by the directive on
// the routing import, and these two bind the day the names land: a `Public` typed `MethodDecorator`
// makes the first line red without a consumer having to apply it, which matters because
// `MethodDecorator` fails as TS1241 plus TS1270 in the *consumer's* file and not in ours.
export type _PublicShape = Expect<Equal<typeof Public, FrozenPublic>>;

export type _IsPublicShape = Expect<Equal<typeof isPublic, FrozenIsPublic>>;

// The half that holds today, and the reason to write it: `Public` and `isPublic` are specified to sit
// beside `getRoutes` and to read the same `Symbol.metadata` record, so `getRoutes` keeping its
// parameter list is part of the claim above. No directive, and this line must never need one.
export type _GetRoutesUnchanged = Expect<
  Equal<Parameters<typeof getRoutes>, [controller: abstract new (...args: never[]) => unknown]>
>;
