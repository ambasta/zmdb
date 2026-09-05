# Documentation product journey — frozen specification

> Status: **FROZEN** for GitHub sub-issue #713. This issue changes no navigation, generated prose, sample compiler or redirects. Issues #714–#719 implement and verify this contract.

## 1. Purpose and boundary

The documentation presents one zmdb product. Package names are useful installation and dependency boundaries, but they are not separate reader journeys.

`navigation-plan.mjs` is the machine-readable target. Until #715 lands, `pages.mjs` remains the live 26-group registry and this file must not be imported by the site build as a compatibility shim.

This specification freezes:

- the ten top-level groups and the canonical owner of every page;
- the GraphQL consolidation and redirect policy;
- which package and integration facts are generated and where they come from;
- the structured framework-integration record;
- the metadata and verification semantics of TypeScript documentation samples.

It does **not** rewrite page prose, implement the ten-group navigation, generate content, compile samples, or emit redirect files.

## 2. Measured baseline

Measured on 2026-09-05 against commit `94164c53`:

| Surface                         | Measured result                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Registry                        | 276 pages, 26 groups, 276 unique NAV entries, no duplicate, missing or orphaned slug                                  |
| Statuses                        | 261 `supported`, 2 `todo`, 13 `wontfix`                                                                               |
| GraphQL                         | 12 pages, all `wontfix`; the thirteenth `wontfix` page is `web-templates`                                             |
| Backtick code fences            | 1,679 fences across the 276 Markdown files                                                                            |
| TypeScript / TSX fences         | 1,354 total: 1,353 `ts` and 1 `tsx`, across 266 pages                                                                 |
| Old column-zero scan            | 1,349 exact three-backtick `ts` / `tsx` fences across 265 pages                                                       |
| Difference from the old scan    | three indented fences in `schema-first.md` and two four-backtick fences in `goodies.md` and `llm-function-calling.md` |
| GraphQL TypeScript / TSX fences | 68; these belong to redirect-source pages and are not retained                                                        |
| Build                           | `yarn build:docs` succeeds and reports 276 pages; it highlights fences but does not classify, compile or run them     |
| Focused docs tests              | `docs-site/build.spec.ts` and `docs-site/shell.spec.ts`: 2 files, 24 tests passed                                     |
| Upstream documentation coverage | 396 upstream pages accounted for; 382 map to zmdb pages and 14 are argued against                                     |

The 1,349 figure is therefore not the corpus size. It is the subset recognized by a simple column-zero, three-backtick scan. The sample parser must implement fence semantics rather than preserve that
scanner bug.

The current renderer:

1. recognizes an opening only when the line starts at column zero with at least three backticks;
2. treats everything after the first three backticks as the highlighting language;
3. closes at the next line that merely starts with three backticks, regardless of opening length;
4. never parses sample metadata, invokes TypeScript, executes code or checks public imports.

Consequently, the three indented samples render as prose and the two four-backtick samples acquire a literal `` `ts `` language class and close at the nested three-backtick text. A green docs build is
not sample correctness evidence.

## 3. The ten-group product journey

The exact group names, order and page order are `PRODUCT_JOURNEY` in `navigation-plan.mjs`:

1. Start
2. Build an application
3. Schema and ORM
4. Validation and contracts
5. Server framework
6. Client applications
7. Databases
8. Operations and deployment
9. Ecosystem integrations
10. Reference

The plan has these invariants:

- Every canonical slug occurs exactly once.
- Every current non-GraphQL slug remains unchanged.
- The twelve `web-graphql*` slugs are redirect artifacts, not canonical pages.
- `graphql` and `package-reference` are the only new canonical slugs in this epic.
- The target has 264 retained current pages plus two new pages: **266 canonical pages**.
- Redirect artifacts do not appear in NAV, `PAGE_META`, search, previous/next order or page counts.
- `PAGE_META` owns title, status and optional note. NAV owns group and order. After #715, `group` is derived from NAV and is not hand-written a second time in `PAGE_META`.
- A missing, duplicate, unregistered or orphaned slug is a build and verification failure.
- Page status does not change merely because the page moved. The only status consolidation is twelve GraphQL `wontfix` pages becoming one canonical `graphql` `wontfix` page.

The reading order is intentional: install the product, build with it, learn schema/ORM and contracts, compose the server and clients, select databases, operate the application, opt into integrations,
then use reference material.

Implementation is staged across the independent children. #715 applies the ten group names and every non-GraphQL page position, but it does not perform #718's GraphQL consolidation. Until #718 lands,
the `graphql` position expands to the twelve existing `web-graphql*` pages in `LEGACY_REDIRECTS` order. The temporary live registry therefore remains 277 pages, with the same statuses, content slugs
and output filenames; #718 alone replaces those twelve entries with one canonical page and redirect artifacts.

## 4. GraphQL consolidation and redirects

`LEGACY_REDIRECTS` in `navigation-plan.mjs` is exhaustive. Every listed source resolves to `graphql`.

The canonical `graphql` page:

- remains `wontfix`;
- states that an official GraphQL vertical is not planned;
- preserves the architectural rationale and points to supported HTTP, OpenAPI, generated-client, gateway and SSE alternatives;
- creates no implementation, compatibility or deprecation promise.

For each legacy slug, #718 emits `site/docs/<legacy>.html` as a redirect artifact containing:

- a canonical link to `./graphql.html`;
- an immediate HTML refresh for script-free and `file://` use;
- `location.replace` that preserves the original query string and fragment;
- a visible fallback link;
- `noindex`.

Internal Markdown links, upstream coverage mappings and search records point directly to `graphql`. Redirect sources are never treated as content pages and cannot be a sample-compilation input.

## 5. Generated content ownership

Generated sections use paired, literal markers:

```text
<!-- generated: product-catalog package-reference -->
<!-- /generated: product-catalog package-reference -->

<!-- generated: integrations framework-integrations -->
<!-- /generated: integrations framework-integrations -->
```

Rules:

- Authored prose may exist outside a marker pair. The generator replaces only bytes between the pair.
- A missing, duplicated, nested or reversed marker is an error.
- Generated output ends with one newline, uses stable sorting and is byte-identical on a second run.
- Check mode compares expected bytes without modifying the working tree.
- Generated output is never accepted as its own source of truth.

### 5.1 Package reference

`docs-site/content/package-reference.md` is generated from two authorities:

1. `scripts/product/catalog.mjs`, supplied by #622, owns official product membership, package directory, product role, facade visibility, optionality, documentation owner and external-consumer owner.
2. `<catalog directory>/package.json` owns npm name, version, description, exports, dependencies, optional peers, engines, license and repository metadata.

The root workspace glob is not official-product membership: it also includes benchmarks and fixtures. The generator rejects an official catalog row without a matching manifest, an unregistered public
package, a stale row, or disagreement between catalog directory/name and manifest directory/name.

Installation commands are derived from package name and catalog optionality. They are not authored in a third table. Versions, export lists, peer ranges and engines are never inferred from README
prose or runtime source.

### 5.2 Framework integration matrix

`docs-site/integrations.mjs`, introduced by #716, is the one authored record set. The generator checks its package claims against the product catalog and manifests, its docs slugs against the
canonical page plan, and every evidence path against the repository.

```ts
export type IntegrationStatus = 'built-in' | 'optional' | 'documented' | 'not-planned';

export interface IntegrationRecord {
  readonly capability: string;
  readonly package: string | null;
  readonly status: IntegrationStatus;
  readonly peer?: string;
  readonly docs: string;
  readonly evidence: readonly string[];
}
```

Status semantics:

- `built-in`: shipped through the default `zmdb` product surface with no additional integration package.
- `optional`: shipped by the named official package; any framework library is its declared optional peer.
- `documented`: a tested recipe over public APIs exists, but no official dedicated package exists.
- `not-planned`: this documentation release claims no official integration; `docs` explains the unavailability and supported alternative.

Status is release-scoped shipped truth, not a forecast. An open roadmap issue does not upgrade a row, and `not-planned` does not by itself close or contradict future implementation work.

Additional invariants:

- `package` is non-null for `built-in`, `optional` and `documented`; it is null for `not-planned`.
- `peer` is permitted only for `optional` and must match that package's manifest.
- `docs` is one canonical slug, not a URL.
- `evidence` is non-empty, repository-relative, exists at generation time and names tests, fixtures, public source or an unavailability specification that substantiates the row.
- An issue, draft or roadmap entry is not support evidence. The matrix reports shipped truth only.
- Prose mentions do not cause a row to be inferred.
- React, Angular, Vue, Svelte, Solid, React Native, Next.js, Nuxt and SvelteKit each have exactly one row. Until implementation evidence exists, a row must not claim `built-in` or `optional`.

## 6. Documentation sample contract

### 6.1 Fence parsing and metadata syntax

The parser accepts CommonMark-style backtick fences with zero to three leading spaces and an opening delimiter of three or more backticks. A closing delimiter has at least the opening length and no
info string. This is required for the five live fences the current renderer mishandles.

Every retained `ts`, `typescript` or `tsx` fence carries one JSON metadata object after the language:

````text
```ts {"mode":"compile","id":"quick-start-schema"}
```
````

The JSON is one line, contains no comments or trailing comma, and is decoded without a shell-like or ad-hoc token grammar.

```ts
export type DocSampleMode = 'compile' | 'expect-error' | 'illustrative';
export type DocSampleEnvironment = 'node' | 'browser' | 'react-native';

export interface DocSampleMeta {
  readonly mode: DocSampleMode;
  readonly id: string;
  readonly file?: string;
  readonly group?: string;
  readonly reason?: string;
  readonly diagnostics?: readonly string[];
  readonly run?: boolean;
  readonly environment?: DocSampleEnvironment;
}
```

`id` and `group` use lower-case kebab case. An `id` is unique within its page, making `<slug>:<id>` the stable repository identity. `file` is a relative POSIX path with no empty, absolute, `.` or `..`
segment.

### 6.2 `compile`

- The sample must typecheck with no diagnostics under the repository's strict TypeScript baseline.
- It resolves official packages through packed/public exports, never workspace path aliases or `packages/*/src`.
- No JavaScript runs by default.
- `diagnostics` and `reason` are forbidden.
- `run: true` is explicit opt-in after a successful compile. `environment` is then required.
- Runtime samples execute in a fresh temporary consumer with bounded time and output. Network, databases, credentials and other external state require an issue-owned fixture; they are never silently
  mocked or contacted.

### 6.3 `expect-error`

- Compilation must fail.
- `diagnostics` is required and non-empty. Each entry is either a TypeScript code such as `TS2345` or an exact diagnostic substring.
- Every declared diagnostic must occur and every emitted error must be accounted for.
- A sample that unexpectedly compiles fails verification.
- `run` and `reason` are forbidden.

### 6.4 `illustrative`

- The sample is deliberately incomplete or depends on context that cannot form a truthful standalone program.
- `reason` is required and must explain the missing context; labels such as “example only” are insufficient.
- `diagnostics` and `run` are forbidden.
- Illustrative samples are reported separately and cannot support a compatibility, platform or API claim.

### 6.5 Multi-file examples

- Fences on the same page with the same `group` form one temporary project.
- Every member has a unique `file`, and `file` is mandatory when `group` is present.
- All members use the same `mode` and `environment`.
- Relative imports may resolve only within the group. Package imports still resolve through public, packed exports.
- The group compiles once. For `expect-error`, the union of declared diagnostics must exactly account for the group diagnostics.
- A fence without `group` is a single-file project; omitted `file` defaults to `index.ts` or `index.tsx` according to the fence language.

### 6.6 Classification scope

All TypeScript/TSX fences on canonical pages must be classified. The 68 fences in the twelve GraphQL redirect sources are excluded because those pages are deleted, not retained. New canonical prose is
classified in the issue that introduces it.

The sample verifier reports, at minimum:

- total typed fences and pages;
- counts by mode and environment;
- illustrative reasons;
- compiled groups and files;
- expected and unexpected diagnostics;
- private-source import violations.

The docs renderer and sample verifier share one fence parser. A fence cannot render as code while being invisible to verification, or be verified while rendering as prose.

## 7. Required verification

The implementation children add exact tests for these frozen statements:

- every canonical page belongs to exactly one of the ten groups;
- all current non-GraphQL slugs remain stable;
- all twelve legacy GraphQL slugs redirect to `graphql`;
- package and integration output is deterministic and sourced as specified;
- every retained typed fence is classified;
- compile samples compile, expected-error samples fail for their declared diagnostics, and illustrative samples carry a reason.

For this specification-only issue, acceptance is:

- `yarn validate:spec`;
- `yarn build:docs`;
- `npx vitest run docs-site/build.spec.ts docs-site/shell.spec.ts`;
- `yarn verify:docs-coverage --summary`;
- a structural probe proving the navigation plan has ten groups, 266 unique canonical slugs, 12 redirect sources, no retained GraphQL source slug, and exactly the two declared additions.
