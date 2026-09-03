import { describe, expect, it } from 'vitest';

import { Controller, Get } from '../routing/index.js';
import { toOpenApi, type OpenApiDocument } from './index.js';

// How a versioned API appears in the document. Tests freeze for the epic "OpenAPI security schemes
// and API versioning" (#572 / spec freeze #573); the frozen text is `./SPEC.md` §S7, plus
// `## operationId (frozen — epic "The agent runtime")`, and the list this file answers is §S9 items 9
// and 10. Resolution — where a version comes from and what an unknown one gets — is
// `../versioning/SPEC.md` and `../versioning/negotiation.spec.ts`.
//
// **Two of the three representations §S7 specifies cannot be reached from the frozen surface, and
// this file asserts neither.** §S7 requires header versioning to emit an `enum` parameter with a
// default, and media-type versioning to emit per-version `content` keys. Both need `toOpenApi` to
// know *which strategy* is configured, and the strategy is given to `createRouter` at construction
// (`../versioning/SPEC.md` §2) while §S2's frozen `OpenApiOptions` gains only `securitySchemes`,
// `routes` and `strictSecurity`. `versionsOf` can tell the generator which versions a route serves;
// nothing can tell it whether they live in the path, in a header or in a media type, and the three
// produce three different documents from the same metadata. Asserting the output here would mean
// inventing the option that carries the strategy, which is a spec change and not a test. §S9 item 10
// (header versioning with differing `RouteSchemas` throws) is unreachable for the same reason.
//
// What is left is the path strategy, which is the one §S7 recommends and the only one whose document
// representation is a function of the route table alone.

/** The `operationId` the frozen derivation produces, which today's generator does not emit. */
interface FrozenOperation {
  readonly operationId?: string;
}

type FrozenDocument = Omit<OpenApiDocument, 'paths'> & {
  readonly paths: Readonly<Record<string, Readonly<Record<string, FrozenOperation>>>>;
};

// The arrangement `docs-site/content/web-versioning.md` documents today and the one
// `../versioning/SPEC.md` §6 keeps working under a configured path strategy: the version is written
// into the controller's own prefix. After #576 the same two path items come from `@Version('1', '2')`
// on one controller, which is why every claim below is about the emitted paths and not about how
// they were declared.
@Controller('/v1/posts')
class PostsV1 {
  @Get('')
  list() {
    return ['v1'];
  }

  @Get('/:id')
  read() {
    return { version: '1' };
  }
}

@Controller('/v2/posts')
class PostsV2 {
  @Get('')
  list() {
    return ['v2'];
  }

  @Get('/:id')
  read() {
    return { version: '2' };
  }
}

const CONTROLLERS = [PostsV1, PostsV2];
const INFO = { title: 'Posts API', version: '1.0.0' };

/**
 * Every operation's `operationId`, or that it has none.
 *
 * boundary: `operationId` is frozen by the epic "The agent runtime" and is not on today's
 * `OpenApiOperation`, so the claim is made against the serialised document rather than through a cast
 * naming the whole future shape. `'absent'` rather than a `?? ''` default, because the failure being
 * frozen against is a tool name that quietly changes, and an empty string reads like a name.
 */
function operationIdsOf(controllers: readonly object[]): string {
  const doc: FrozenDocument = JSON.parse(JSON.stringify(toOpenApi(controllers, { info: INFO })));
  return Object.entries(doc.paths)
    .flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => `${method} ${path}=${operation.operationId ?? 'absent'}`),
    )
    .join(', ');
}

describe('versioned documents (frozen: openapi/SPEC.md S7)', () => {
  // §S9 item 9, first clause. Path versioning emits N path items and their `operationId`s "differ
  // automatically because the derivation above is path-derived" — so the claim is not that the
  // generator does something extra for versions, it is that the derived id is a function of the
  // expanded path and therefore distinct without anybody arranging it.
  //
  // This is the one assertion in #574 that does not retire with #575. `operationId` is frozen by a
  // different epic ("The agent runtime", `./SPEC.md` line 42), where it exists so
  // `toolsFromOpenApi` has a stable tool name; §S7 depends on it and cannot be finished before it.
  // The test is here because §S9 item 9 asks for it and because a version scheme that produces two
  // operations with the *same* id produces a tool list with a silently dropped tool.
  //
  // actual today:
  //   get /v1/posts=absent, get /v1/posts/{id}=absent, get /v2/posts=absent, get /v2/posts/{id}=absent
  // — no operation carries an `operationId` at all, so the ids are not merely colliding, they are
  // missing, and `toolsFromOpenApi` has nothing to name a tool with.
  it.fails('derives a distinct operationId for each version of a path-versioned route', () => {
    expect(operationIdsOf(CONTROLLERS)).toBe(
      [
        'get /v1/posts=get_v1_posts',
        'get /v1/posts/{id}=get_v1_posts_id',
        'get /v2/posts=get_v2_posts',
        'get /v2/posts/{id}=get_v2_posts_id',
      ].join(', '),
    );
  });

  // Green: §S7's "path versioning produces distinct paths … as separate path items". It holds today
  // because the versions are separate controllers, and it has to still hold when one controller's
  // `@Version('1', '2')` expands into these paths at registration. The failure it guards against is
  // an expansion that emits one path item per *route* and lists the versions inside it, which is the
  // shape header versioning needs and which would make a generated client for v1 able to call v2.
  it('emits one path item per version rather than one per route', () => {
    const doc = toOpenApi(CONTROLLERS, { info: INFO });
    expect(Object.keys(doc.paths)).toEqual(['/v1/posts', '/v1/posts/{id}', '/v2/posts', '/v2/posts/{id}']);
    expect(doc.paths['/v1/posts/{id}']?.get?.parameters, 'v1 has its own path parameter').toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(doc.paths['/v2/posts/{id}']?.get?.parameters, 'and so does v2').toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  // Green, and the load-bearing half of §S7's claim that "per-version schemas need no new mechanism
  // at all: the expanded paths are different keys". Two versions whose response shapes differ is
  // exactly the case §S7 refuses under header versioning and sends here, so a document in which both
  // versions share one schema would remove the reason path versioning is the recommendation. The
  // `schemas` map is keyed by route path, and after #576 the expanded paths are what it is keyed by.
  it('gives each version its own response schema from the path-keyed schema map', () => {
    const doc = toOpenApi(CONTROLLERS, {
      info: INFO,
      schemas: {
        '/v1/posts': { response: { type: 'array', items: { type: 'string' } } },
        '/v2/posts': { response: { type: 'object', properties: { posts: { type: 'array' } } } },
      },
    });
    const v1 = doc.paths['/v1/posts']?.get?.responses['200']?.content?.['application/json']?.schema;
    const v2 = doc.paths['/v2/posts']?.get?.responses['200']?.content?.['application/json']?.schema;
    expect(v1).toEqual({ type: 'array', items: { type: 'string' } });
    expect(v2).toEqual({ type: 'object', properties: { posts: { type: 'array' } } });
  });
});
