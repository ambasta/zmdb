// The round trip of `packages/schema-core/src/llm/http/SPEC.md` §5.3, asserted where both halves
// are reachable (#532, epic #530).
//
// WHY THIS FILE IS IN `@zmdb/web` AND NOT NEXT TO THE OTHER #532 SPECS. `../../../schema-core`'s
// `llm/http/SPEC.md` §7.7 asks for "the round trip of §5.3 against `toOpenApi([...controllers])`
// for the existing `openapi/__fixtures__/route-schemas.ts` controllers". `toOpenApi` is in this
// package and `toolsFromOpenApi` is in `@zmdb/schema-core`, and `ARCHITECTURE.md` §3.2 puts
// schema-core at the root of the dependency DAG — "It must never import a sibling". So the test
// runs on the side that may import the other: `packages/web/package.json` lists
// `@zmdb/schema-core` as a dependency, and this file imports `toolsFromOpenApi`'s frozen shape
// rather than `@zmdb/web` being imported into schema-core's tests.
//
// RED ON PURPOSE. `toolsFromOpenApi` does not exist: #534 writes it. Every assertion whose
// subject is unimplemented is `it.fails`, never `it.skip` — `.oxlintrc.json` sets
// `vitest/no-disabled-tests` to `error`, and a skipped test is invisible in the summary line
// where an expected-failing one is counted. When #534 lands, an `it.fails` that starts passing
// fails the suite with `Error: Expect test to fail`, so no marker outlives its gap. The frozen
// surface below is transcribed from the two SPEC.md files as `const`s and `type`s holding
// throwing implementations of their frozen signatures, so collection succeeds, the tests are
// counted, and a signature that drifts from the spec is a compile error rather than a comment.
//
// NO NETWORK. `llm/http/SPEC.md` §7.8 wants that structural rather than disciplinary: there is
// no `fetch` in this file, and the only document under test is one `toOpenApi` built from
// classes declared here.
import { readFileSync } from 'node:fs';

import { zmdbAot } from '@zmdb/aot-validator/plugin';
import type { ToolSpec } from '@zmdb/schema-core/llm';
import { beforeAll, describe, expect, it } from 'vitest';

import { Controller, Delete, Get, Post, Put, getRoutes } from '../routing/index.js';
import { toOpenApi, type RouteSchemas } from './index.js';

// ---------------------------------------------------------------------------
// FROZEN SURFACE — delete when `@zmdb/schema-core/llm/http` exists (#534)
// ---------------------------------------------------------------------------
//
// `packages/schema-core/package.json`'s `exports` map has no `./llm/http` entry — the subpaths
// are `.`, `./tags`, `./ir`, `./derive`, `./dto`, `./relations`, `./openapi`, `./custom-types`
// and `./llm`. So #534 has to add one, or re-export from `./llm`, before this import can be
// written at all. NOTES.md records it; `ToolSpec` above comes from `./llm`, which does exist.

/** `../../../schema-core/src/llm/SPEC.md` §5, verbatim. */
type ToolProvider = 'openai' | 'openai-strict' | 'anthropic' | 'gemini' | 'json-schema';

/** `../../../schema-core/src/llm/http/SPEC.md` §4, verbatim. */
interface OpenApiToolsOptions {
  readonly provider?: ToolProvider;
  readonly baseUrl: string;
  readonly include?: (op: { readonly method: string; readonly path: string; readonly operationId: string }) => boolean;
}

const toolsFromOpenApi: (doc: unknown, opts: OpenApiToolsOptions) => readonly ToolSpec[] = () => {
  throw new Error('#532 tests freeze: toolsFromOpenApi is unimplemented (schema-core llm/http SPEC §4)');
};

/**
 * ./SPEC.md's `operationId` section: "`RouteSchemas` gains an optional `operationId?: string` to
 * override it." It does not have one today, so the widening goes through exactly one boundary
 * function rather than through a cast at each call site. `FrozenRouteSchemas` is assignable to
 * `RouteSchemas` on its own — the extra property is optional and the argument is not a fresh
 * literal — so `withOperationIds` needs no `as` at all.
 */
type FrozenRouteSchemas = RouteSchemas & { readonly operationId?: string };

const withOperationIds = (
  schemas: Readonly<Record<string, FrozenRouteSchemas>>,
): Readonly<Record<string, RouteSchemas>> => schemas;
// --------------------------- end frozen surface ---------------------------

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const FILE = `${FIXTURES}route-schemas.ts`;
const BASE_URL = 'https://api.example.com';

/**
 * The fixture's own controllers, extended with the shapes §5.3 is about: a path with two methods
 * (so "a body's properties appear when and only when a `schemas` entry supplied them" has a GET
 * to be wrong about), a single path parameter, two path parameters, and `POST /users/:id/roles`
 * — which is `./SPEC.md`'s own worked example for the derived `operationId`, reproduced verbatim
 * so the one hard-coded name in this file is the spec's and not a guess.
 */
@Controller('/users')
class UsersController {
  @Get()
  list() {}
  @Post()
  create() {}
  @Get('/:id')
  get() {}
  @Post('/:id/roles')
  addRole() {}
  @Put('/:id/roles/:roleId')
  setRole() {}
  @Delete('/:id')
  remove() {}
}

/** A second controller on the same prefix, for the collision rule. Not in the main document. */
@Controller('/users')
class ShadowUsersController {
  @Get('/:id')
  getAgain() {}
}

let schemas: Readonly<Record<string, RouteSchemas>> = {};

beforeAll(() => {
  // The real plugin with its real throwing `onDiagnostic`, exactly as `generated-schemas.spec.ts`
  // runs it: the documents this round trip is about are the ones the build actually emits, not
  // literals written here that could agree with a wrong emitter.
  const plugin = zmdbAot({ project: `${FIXTURES}tsconfig.json`, cwd: FIXTURES });
  const result = plugin.transform(readFileSync(FILE, 'utf8'), FILE);
  plugin.buildEnd?.();
  if (!result) throw new Error('the plugin declined to transform the fixture');
  const body = result.code.replace(/^import\b[^;]*;\s*$/gm, '').replace(/^declare\b.*$/gm, '');
  const run = new Function('routes', body) as (fn: (s: Record<string, RouteSchemas>) => void) => void;
  run(collected => {
    schemas = collected;
  });
});

const document = (): ReturnType<typeof toOpenApi> =>
  toOpenApi([UsersController], { info: { title: 'Users', version: '1.0.0' }, schemas });

/**
 * ./SPEC.md's rule, applied to a route rather than looked up in a table: "the lowercased method,
 * then the path with `/` and `:` replaced by `_`, leading and trailing separators dropped".
 *
 * Two things the rule as written does not settle, both frozen here and both in NOTES.md. The
 * literal reading produces a *double* underscore for a path parameter — `/users/:id/roles` has a
 * `/` immediately followed by a `:` — and the spec's own example, `post_users_id_roles`, has one,
 * so runs are collapsed. And only the *method* is said to be lowercased, so `:roleId` keeps its
 * capital: `put_users_id_roles_roleId`, which `llm/http/SPEC.md` §4's `[A-Za-z0-9_-]` rule
 * permits. If #534 or #573 lowercases the path as well, the assertions below are where that
 * decision surfaces.
 */
const deriveOperationId = (method: string, path: string): string =>
  `${method.toLowerCase()}_${path.replaceAll(/[/:]+/g, '_').replaceAll(/^_+|_+$/g, '')}`;

/** The `:name` segments of a zmdb route path, in the order the path lists them. */
const pathParamsOf = (path: string): readonly string[] => [...path.matchAll(/:([^/]+)/g)].map(match => match[1] ?? '');

/** `operationId` is not on `OpenApiOperation` yet, so it is read without one `as`. */
const operationIdOf = (operation: unknown): unknown => Reflect.get(Object(operation), 'operationId');

/** Every operation in a document, paired with the OpenAPI path it sits under. */
const operationsOf = (doc: ReturnType<typeof toOpenApi>): readonly { path: string; method: string; op: unknown }[] =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({ path, method, op })),
  );

const byName = (specs: readonly ToolSpec[], name: string): ToolSpec | undefined =>
  specs.find(spec => spec.name === name);

const propertyNamesOf = (spec: ToolSpec | undefined): readonly string[] =>
  spec === undefined ? [] : Object.keys(spec.parameters.properties).toSorted();

describe('what toOpenApi already emits, and what the round trip therefore has to survive', () => {
  // A plain `it`, because it is true today and ./SPEC.md's amendment section says it stays true:
  // "a `schemas` map keyed by route path — so two methods on one path share one body schema …
  // the rest of that list stands."
  //
  // Current actual, measured 2026-09-04 — `toOpenApi([UsersController], { schemas })` gives
  // `/users` a `get` *and* a `post`, and both carry the identical `requestBody`:
  //   paths['/users'].get  = {"responses":{…},"requestBody":{"content":{"application/json":
  //     {"schema":{"type":"object","properties":{"createdAt":{"type":"string","format":
  //     "date-time"},"email":{"type":"string","maxLength":255}},"required":["email"]}}}}}
  //   paths['/users'].post = the same object, by identity.
  //
  // So zmdb's own document says a GET takes a JSON request body. That is not a curiosity: a tool
  // generated from it asks a model for `email` and `createdAt` in order to *list* users, and the
  // model will supply them. The `it.fails` for §5.3's third clause below is written against this,
  // rather than against the reading a reader would assume.
  it('gives a GET the same request body as the POST on its path, because schemas are keyed by path', () => {
    const doc = document();
    const get = doc.paths['/users']?.get;
    const post = doc.paths['/users']?.post;
    expect(get).toBeDefined();
    expect(post).toBeDefined();
    // The same object, not merely an equal one — `toOpenApi` reads one `RouteSchemas` per path.
    expect(get?.requestBody?.content['application/json']?.schema).toBe(schemas['/users']?.body);
    expect(post?.requestBody?.content['application/json']?.schema).toBe(schemas['/users']?.body);
    // And the sibling paths, which no `schemas` entry names, have no body at all.
    expect(doc.paths['/users/{id}']?.get?.requestBody).toBeUndefined();
    expect(doc.paths['/users/{id}/roles/{roleId}']?.put?.requestBody).toBeUndefined();
  });

  // The lossy shape `llm/http/SPEC.md` §5.3 is about, and it is already in the fixture:
  // `createdAt: Date & Sql<'timestamp'> & HasDefault` in `__fixtures__/entities.ts`.
  //
  // Current actual, measured 2026-09-04 — `schemas['/users'].body`:
  //   {"type":"object","properties":{"createdAt":{"type":"string","format":"date-time"},
  //    "email":{"type":"string","maxLength":255}},"required":["email"]}
  // and `schemas['/users'].response`:
  //   {"type":"object","properties":{"createdAt":{"type":"string","format":"date-time"},
  //    "email":{"type":"string","maxLength":255},"id":{"type":"integer"}},
  //    "required":["createdAt","email","id"]}
  //
  // A `Date` left as a string with a `format` annotation, and there is no way back: nothing in
  // the document says "a Node `Date`", and `../../../schema-core/src/llm/SPEC.md` §2's table
  // shows `format` is a keyword a provider may drop. That irreversibility is asserted rather
  // than described, by stripping `format` and finding a plain string.
  it('emits a Date column as an ISO string, and a defaulted column as not required', () => {
    const body = schemas['/users']?.body;
    expect(body).toStrictEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', maxLength: 255 },
      },
      // `HasDefault` is what makes a property optional in the document; `id` is absent entirely,
      // because `Serial` is omitted from a create payload rather than made optional.
      required: ['email'],
    });
    const createdAt = Reflect.get(Object(Reflect.get(Object(body), 'properties')), 'createdAt');
    expect(Reflect.get(Object(createdAt), 'type')).toBe('string');
    expect(Reflect.get(Object(createdAt), 'format')).toBe('date-time');
    // Drop the annotation and a timestamp is a string like any other — which is as much as any
    // consumer of the document, tool generator included, can recover.
    expect(Reflect.get(Object(createdAt), 'type')).toBe(
      Reflect.get(Object(Reflect.get(Object(body), 'properties')), 'email').type,
    );
  });

  // `passwordHash` is `Sensitive` in `__fixtures__/entities.ts`, and the document is the last
  // place it could leak before a tool spec is handed to a model provider. Asserted on the
  // serialized document rather than on a property list, so a description, an example or an
  // `enum` carrying the name fails too. True today, and it must stay true.
  it('keeps a sensitive column out of the generated document entirely', () => {
    expect(JSON.stringify(document())).not.toContain('passwordHash');
  });
});

describe("./SPEC.md's operationId section — the name a tool is stable across regenerations by", () => {
  // ./SPEC.md: "`toOpenApi` emits an `operationId` on every operation". It does not, and that is
  // the whole reason `llm/http/SPEC.md` §5 exists: step 8's "refuse operations with no
  // `operationId`" would refuse every operation in zmdb's own document.
  //
  // Current actual, measured 2026-09-04 — the keys present on each of the six operations:
  //   [["requestBody","responses"],["requestBody","responses"],["parameters","responses"],
  //    ["parameters","responses"],["parameters","responses"],["parameters","responses"]]
  // No `operationId` anywhere, so the derived-name comparison fails with `AssertionError:
  // expected [ undefined, undefined, …(4) ] to strictly equal [ Array(6) ]`, the expected side
  // being `["delete_users_id", "get_users", "get_users_id", "post_users", "post_users_id_roles",
  // "put_users_id_roles_roleId"]` and the received side six `undefined`s. The count assertion
  // above it passes, because the document does have one operation per route already.
  //
  // The expected names are re-derived from `getRoutes` rather than listed, per §7.7: "the tools
  // are compared to the routes, not to a snapshot, so a new route cannot pass by being added to
  // both sides". The one literal name asserted is ./SPEC.md's own worked example.
  it.fails('names every operation with a deterministic operationId derived from its route', () => {
    const routes = getRoutes(UsersController);
    const doc = document();
    const operations = operationsOf(doc);

    expect(operations).toHaveLength(routes.length);

    const expected = routes.map(route => deriveOperationId(route.method, route.path)).toSorted();
    const actual = operations.map(entry => operationIdOf(entry.op)).toSorted();
    expect(actual).toStrictEqual(expected);

    // ./SPEC.md, verbatim: "`POST /users/:id/roles` becomes `post_users_id_roles`". One
    // hard-coded name, and it is the spec's, which is also what anchors `deriveOperationId`
    // above — without it the re-derivation could be self-consistently wrong.
    expect(expected).toContain('post_users_id_roles');

    // Distinct, because `llm/http/SPEC.md` §4 refuses "two operations that produce the same tool
    // name" and a document that shipped a duplicate would be unusable rather than merely odd.
    expect(new Set(actual).size).toBe(actual.length);

    // And every name is one `llm/http/SPEC.md` §4's provider rule accepts, so a document that
    // passes here cannot fail on the other side of the round trip: `[A-Za-z0-9_-]`, at most 64
    // characters.
    for (const name of actual) {
      expect(typeof name).toBe('string');
      expect(String(name)).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(String(name).length).toBeLessThanOrEqual(64);
    }

    // Deterministic: ./SPEC.md calls it out alongside the path ordering, and a name derived from
    // a counter or a hash would pass every assertion above and still break a prompt cache.
    expect(operationsOf(document()).map(entry => operationIdOf(entry.op))).toStrictEqual(
      operations.map(entry => operationIdOf(entry.op)),
    );
  });

  // ./SPEC.md: "a collision throws at generation, because two routes with the same method and
  // path is already a routing bug." Today `toOpenApi` silently overwrites — `item[entry.method] =
  // operation` — so the second controller's route replaces the first's and the document is a
  // route short with no diagnostic.
  //
  // Current actual: `AssertionError: expected function to throw an error, but it didn't` — the
  // call returns a document, and `paths['/users/{id}'].get` is present exactly once, so the
  // second controller's route has been dropped without a diagnostic.
  it.fails('refuses two routes that derive the same operationId', () => {
    const generate = (): ReturnType<typeof toOpenApi> => toOpenApi([UsersController, ShadowUsersController]);

    // Error identity, not merely that it threw: the class, and the colliding name in the
    // message, because a generation-time refusal a reader cannot locate is a stack trace.
    expect(generate).toThrowError(Error);
    expect(generate).toThrowError(/get_users_id/);

    // And the two routes really do collide, which is asserted from `getRoutes` rather than
    // assumed — otherwise a change to either controller could make this test vacuous.
    const collidingNames = [...getRoutes(UsersController), ...getRoutes(ShadowUsersController)].map(route =>
      deriveOperationId(route.method, route.path),
    );
    expect(collidingNames.filter(name => name === 'get_users_id')).toHaveLength(2);
  });

  // ./SPEC.md: "`RouteSchemas` gains an optional `operationId?: string` to override it."
  //
  // A CONTRADICTION IN THE FROZEN SPEC, frozen as the weakest assertion compatible with every
  // sane resolution. `options.schemas` is keyed by **route path**, and ./SPEC.md's own amendment
  // list says that stays true — but `/users` has two operations, so a single `operationId`
  // override on that key applies to both, which produces exactly the duplicate the collision
  // rule throws on. The override is therefore unusable on any path with more than one method,
  // which is most of them.
  //
  // So what is asserted is: the override is honoured *somewhere*, and the document's names stay
  // distinct. Both must hold however #534 resolves the keying, and the resolution is what makes
  // the third assertion here decidable. NOTES.md records it as a spec bug for #534, not a
  // judgement this freeze can make.
  //
  // Current actual: `AssertionError: expected [ undefined, undefined ] to include 'create_user'`
  // — `/users` does have its two operations, and neither carries an `operationId` to override.
  it.fails('lets a route override its operationId without producing a duplicate', () => {
    const overridden = withOperationIds({ ...schemas, '/users': { ...schemas['/users'], operationId: 'create_user' } });
    const doc = toOpenApi([UsersController], { info: { title: 'Users', version: '1.0.0' }, schemas: overridden });
    const names = operationsOf(doc)
      .filter(entry => entry.path === '/users')
      .map(entry => operationIdOf(entry.op));

    expect(names).toHaveLength(2);
    expect(names).toContain('create_user');
    expect(new Set(operationsOf(doc).map(entry => operationIdOf(entry.op))).size).toBe(
      getRoutes(UsersController).length,
    );
  });
});

describe('schema-core llm/http SPEC.md §5.3 and §7.7 — the round trip against the controllers', () => {
  // §5.3, clause one: "every route becomes exactly one tool". Compared to `getRoutes`, per §7.7,
  // so adding a route to the controller and to an expected list cannot make it pass.
  //
  // Current actual: throws `Error: #532 tests freeze: toolsFromOpenApi is unimplemented
  // (schema-core llm/http SPEC §4)`.
  it.fails('gives every route in the document exactly one tool', () => {
    const routes = getRoutes(UsersController);
    const specs = toolsFromOpenApi(document(), { baseUrl: BASE_URL });

    expect(specs).toHaveLength(routes.length);
    expect(specs.map(spec => spec.name).toSorted()).toStrictEqual(
      routes.map(route => deriveOperationId(route.method, route.path)).toSorted(),
    );
    // One tool per route means no duplicate names, which is the same claim stated so that a
    // generator emitting two tools for one route and none for another cannot pass on count.
    expect(new Set(specs.map(spec => spec.name)).size).toBe(specs.length);
  });

  // §5.3, clause two: "path parameters become required string properties". Every parameter of
  // every route, read out of the route path, so a new path parameter is covered without this
  // test being edited.
  //
  // §5.3 also says why the type is not a bug: "`Ctx.params` is `Record<string, string>` at the
  // controller boundary too, so the tool and the handler agree." That is the round trip's answer
  // to the `Date` problem as well — `createdAt` reaches the handler as a string either way.
  //
  // Current actual: throws `Error: #532 tests freeze: toolsFromOpenApi is unimplemented
  // (schema-core llm/http SPEC §4)`.
  it.fails('makes every path parameter a required string property on its tool', () => {
    const specs = toolsFromOpenApi(document(), { baseUrl: BASE_URL });
    let asserted = 0;

    for (const route of getRoutes(UsersController)) {
      const spec = byName(specs, deriveOperationId(route.method, route.path));
      expect(spec, `no tool for ${route.method} ${route.path}`).toBeDefined();
      for (const param of pathParamsOf(route.path)) {
        expect(spec?.parameters.properties[param], `${route.path}: ${param}`).toStrictEqual({ type: 'string' });
        expect(spec?.parameters.required, `${route.path}: ${param}`).toContain(param);
        asserted += 1;
      }
    }

    // The controller has parameters to find, so a `pathParamsOf` that silently returned nothing
    // could not make the loop above vacuous. Four: `/users/{id}` twice, `/users/{id}/roles`, and
    // two on `/users/{id}/roles/{roleId}`.
    expect(asserted).toBe(5);
    // And the OpenAPI form of the name is not what a tool asks for: `{id}` is the document's
    // spelling of the property `id`.
    expect(JSON.stringify(specs)).not.toContain('{id}');
  });

  // §5.3, clause three: "a body's properties appear when and only when a `schemas` entry supplied
  // them". Both halves, and the "when" half is where the GET-with-a-body finding above lands —
  // the fixture supplies a body for the *path* `/users`, so both operations on it get the body's
  // properties, including the GET that lists users.
  //
  // This test freezes that as correct-for-now rather than papering over it, because the
  // alternative — a tool generator that second-guessed the document by dropping bodies from GETs
  // — would disagree with the document zmdb publishes to every other consumer.
  //
  // Current actual: throws `Error: #532 tests freeze: toolsFromOpenApi is unimplemented
  // (schema-core llm/http SPEC §4)`.
  it.fails("puts a body's properties on a tool when and only when a schemas entry supplied them", () => {
    const specs = toolsFromOpenApi(document(), { baseUrl: BASE_URL });

    // `/users` is the one key the fixture supplies, and it has two operations.
    expect(Object.keys(schemas)).toStrictEqual(['/users']);
    for (const name of ['get_users', 'post_users']) {
      const spec = byName(specs, name);
      expect(propertyNamesOf(spec), name).toStrictEqual(['createdAt', 'email']);
      // Flattened, per `llm/http/SPEC.md` §4 — no nested `body` object, which its §8 rejects as
      // "the only nesting in the system".
      expect(spec?.parameters.properties, name).not.toHaveProperty('body');
      // Required-ness comes from the document, not from the tool generator: `email` is required
      // and `createdAt` has a default, so it is not.
      expect(spec?.parameters.required, name).toStrictEqual(['email']);
    }

    // …and only when. No `schemas` entry names `/users/:id`, so its tools carry path parameters
    // and nothing else.
    expect(propertyNamesOf(byName(specs, 'get_users_id'))).toStrictEqual(['id']);
    expect(propertyNamesOf(byName(specs, 'delete_users_id'))).toStrictEqual(['id']);
    expect(propertyNamesOf(byName(specs, 'put_users_id_roles_roleId'))).toStrictEqual(['id', 'roleId']);
    // The 200 response schema is not a tool argument. `toOpenApi` puts `ReadDTO<User>` — which
    // has `id` — under `responses`, and a generator that read it would ask a model to invent the
    // primary key of a row it is creating.
    expect(propertyNamesOf(byName(specs, 'post_users'))).not.toContain('id');
  });

  // The issue's title, and §7.7's whole claim in one assertion: for every route, the tool's
  // property set is exactly the route's path parameters plus whatever body the `schemas` map
  // supplied for that route's path — both sides computed from the controller and the fixture, so
  // "a new route cannot pass by being added to both sides".
  //
  // Current actual: throws `Error: #532 tests freeze: toolsFromOpenApi is unimplemented
  // (schema-core llm/http SPEC §4)`.
  it.fails("round-trips zmdb's own generated document into tools whose argument types match the controllers", () => {
    const specs = toolsFromOpenApi(document(), { baseUrl: BASE_URL });

    for (const route of getRoutes(UsersController)) {
      const bodySchema = schemas[route.path]?.body;
      const bodyProperties = bodySchema === undefined ? [] : Object.keys(Reflect.get(bodySchema, 'properties') ?? {});
      const expected = [...pathParamsOf(route.path), ...bodyProperties].toSorted();

      const spec = byName(specs, deriveOperationId(route.method, route.path));
      expect(spec, `no tool for ${route.method} ${route.path}`).toBeDefined();
      expect(propertyNamesOf(spec), `${route.method} ${route.path}`).toStrictEqual(expected);

      // The property *schemas* round-trip too, not just the names — a tool whose `email` were a
      // number would satisfy the name comparison and still be wrong. Compared against the
      // emitted document rather than a literal, which is what makes this a round trip.
      for (const property of bodyProperties) {
        expect(spec?.parameters.properties[property], `${route.path}: ${property}`).toStrictEqual(
          Reflect.get(Object(Reflect.get(Object(bodySchema), 'properties')), property),
        );
      }
    }

    // The security direction, all the way through: `passwordHash` is `Sensitive`, so it is absent
    // from the document and must therefore be absent from every tool. Asserted on the serialized
    // specs, so a description or an example carrying it fails too.
    expect(JSON.stringify(specs)).not.toContain('passwordHash');

    // And the lossy direction, stated rather than implied: `createdAt` went in a `Date` and comes
    // out a string. The round trip recovers the document, not the TypeScript type — there is no
    // `Date` to recover, and `llm/http/SPEC.md` §5.3 is explicit that this is the answer and not
    // a defect.
    expect(byName(specs, 'post_users')?.parameters.properties['createdAt']).toStrictEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(JSON.stringify(specs)).not.toContain('timestamp');
  });
});
