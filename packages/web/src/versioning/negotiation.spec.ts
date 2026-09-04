import { describe, expect, it } from 'vitest';

import { bodyText, createRouter, type Router } from '../pipeline/index.js';
import { Controller, Get } from '../routing/index.js';

// Version negotiation. Tests freeze for the epic "OpenAPI security schemes and API versioning"
// (#572 / spec freeze #573); the frozen text is `./SPEC.md`, and the list this file answers is its §8.
// The document representation is `../openapi/versioned-documents.spec.ts`; the compile-time half of
// §8 item 1 is `./versioning.type-test.ts`.
//
// **Most of §8 cannot be asserted at this freeze, and the reason is structural rather than an
// omission.** `./index.ts` does not exist — this directory holds only `SPEC.md` — and a `.spec.ts`
// that imports a module which is not there does not produce a failing test, it produces a file that
// never collects, which is a broken suite and not a freeze. The #409 convention also rules out the
// two ways round that: `declare`ing `Version` would make every assertion below a claim about a stub,
// and a dynamic `import()` of a missing specifier laundered through a variable would hide the
// specifier from the compiler, so nothing would check the types on the day the module lands.
//
// What that leaves out, and what has to be written by #576 in the same commit that adds the module:
//
//   - §8 items 3 (the `400` and `406` statuses and their `supported` bodies), 4 (`Accept` q-values,
//     including `q=0`), 6 (`@VersionNeutral()` answering an undeclared version), 7
//     (method-over-class precedence) and 8 (`@Version('1', '2')` expanding to two paths). Every one
//     needs a route that *declares* a version, and `@Version` is the only way to declare one.
//   - §8 item 10, the performance assertion. It needs N versions of M routes, so it needs the
//     decorator too.
//   - §8 item 9's second half: `@Version` on a route with no strategy configured is a registration
//     error. Same reason.
//
// What is here is the two claims reachable through `createRouter`, which does exist: the registration
// error that makes "serves every version" and "nobody thought about it" different inputs (§6), and
// the behaviour of an unconfigured router, which is the thing the whole epic must not change.

/** §2: the strategy, given to the router at construction and not per registration. */
type FrozenVersionStrategy =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'header'; readonly name: string; readonly default: string }
  | { readonly kind: 'media-type'; readonly key: string; readonly default: string };

/**
 * §2's `createRouter(options?: { versioning?: VersionStrategy })`.
 *
 * No cast and no `as`: a zero-parameter function is assignable to a one-optional-parameter type, so
 * the widening is carried by an annotation on the real exported function. The annotation is the whole
 * boundary for this file, and it disappears when `createRouter` takes the option for real.
 */
const versionedRouter: (options?: { readonly versioning?: FrozenVersionStrategy }) => Router = createRouter;

// The arrangement `docs-site/content/web-versioning.md` recommends today: the version is in the
// controller's own prefix, and neither controller declares a version to the framework.
@Controller('/v1/posts')
class PostsV1 {
  @Get('')
  list() {
    return ['v1'];
  }
}

@Controller('/v2/posts')
class PostsV2 {
  @Get('')
  list() {
    return ['v2'];
  }
}

describe('version negotiation (frozen: versioning/SPEC.md 4-7)', () => {
  // §8 item 5, and the adversarial case for this half of the epic. Once a strategy is configured a
  // route must say something, because `versionsOf` returning `undefined` and "serves every version"
  // must not be the same text — the exact parallel of `../openapi/SPEC.md` §S4's strict security.
  //
  // A fresh router inside the arrow rather than one shared between the two assertions: `register`
  // pushes into the bucket without checking for a route it already holds, so a second call on one
  // router could throw about a duplicate and let the second assertion pass for the wrong reason.
  //
  // actual today, on the first assertion:
  //   names the controller: expected [Function register] to throw an error
  // — the `versioning` option is accepted and dropped on the floor, `PostsV1` registers happily, and
  // a probe run of the same router then answered `GET /v1/posts` with `accept-version: 9` as
  // `200 ["v1"]`. That is the permissive failure this test exists to make impossible: a client asking
  // for a version the server has never heard of gets version 1's body and a success status.
  it.fails('refuses to register a route that declares no version under a configured strategy', () => {
    const register = () =>
      versionedRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } }).register(new PostsV1());
    expect(register, 'names the controller').toThrow(/PostsV1/);
    expect(register, 'names the handler').toThrow(/\blist\b/);
  });

  // Green: §8 item 9's first half, §4's `path` row and §5's `path` row at once. With no `versioning`
  // configured there is no version code in `handle` at all, and an unknown version is an unknown
  // path — the 404 the ordinary two-key table already returns. This is the assertion that #576 breaks
  // if it adds a resolver that runs whether or not a strategy is configured, which is the cost
  // `tests/api-coverage/mapping.mjs:154` refuses to pay and §1 promises not to.
  //
  // The body is asserted exactly, not just the status: §5 gives the `400` and `406` a `supported`
  // list and deliberately withholds one from the `404`, because a body enumerating which versions of
  // which paths exist is a route-table oracle. A shared "unsupported version" body would leak it
  // from the one status that must stay uniform.
  it('routes on method and path alone when no strategy is configured', async () => {
    const router = createRouter();
    router.register(new PostsV1());
    router.register(new PostsV2());
    const unversioned = await router.handle({ method: 'GET', path: '/posts', headers: {} });
    const unknown = await router.handle({ method: 'GET', path: '/v9/posts', headers: {} });
    const known = await router.handle({ method: 'GET', path: '/v1/posts', headers: {} });
    expect(`${unversioned.status} ${unknown.status} ${known.status} ${await bodyText(known)}`).toBe(
      '404 404 200 ["v1"]',
    );
    expect(await bodyText(unknown), 'the 404 says nothing about which versions exist').toBe(
      '{"error":"no route for GET /v9/posts"}',
    );
  });

  // Green: §4's header and media-type rows say a request naming no version resolves to `default`, and
  // an unconfigured router has no default to resolve to. A version-naming header on an unconfigured
  // router is therefore an ordinary header — read by nothing, changing nothing — and it stays that
  // way, because §8 item 9 makes a silent behaviour change the one outcome worse than a refusal.
  it('ignores a version header when no strategy is configured', async () => {
    const router = createRouter();
    router.register(new PostsV1());
    const withHeader = await router.handle({
      method: 'GET',
      path: '/v1/posts',
      headers: { 'accept-version': '2', accept: 'application/json;version=2' },
    });
    expect(`${withHeader.status} ${await bodyText(withHeader)}`).toBe('200 ["v1"]');
  });
});
