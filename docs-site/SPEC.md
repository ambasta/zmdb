# Documentation product journey — frozen specification

> Status: **FROZEN** by GitHub sub-issue #713. Later issue-scoped changes implement the registry and generated sections; #686 adds one supported `generated-client` page and executable packed samples,
> #701 adds nine framework-native guides over that client, and #729 publishes the policy-generated architecture and executable governance workflows.

## 1. Purpose and boundary

The documentation presents one zmdb product. Package names are useful installation and dependency boundaries, but they are not separate reader journeys.

`navigation-plan.mjs` owns page order. `pages.mjs` derives the live ten-group registry from it, expanding the historical GraphQL position to the twelve existing permanently wontfix pages.

This specification freezes:

- the ten top-level groups and the canonical owner of every page;
- the GraphQL consolidation and redirect policy;
- which package and integration facts are generated and where they come from;
- the structured framework-integration record.

The original #713 freeze did **not** rewrite page prose, implement navigation, generate content, compile samples, or emit redirect files. #686 owns the generated-client prose and sample proof. #701
owns the Client Applications overview, nine framework guides, support metadata, catalog ownership, and packed compilation of every canonical framework example.

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

At that measured baseline, the renderer:

1. recognizes an opening only when the line starts at column zero with at least three backticks;
2. treats everything after the first three backticks as the highlighting language;
3. closes at the next line that merely starts with three backticks, regardless of opening length;
4. never parses sample metadata, invokes TypeScript, executes code or checks public imports.

At that baseline, the three indented samples rendered as prose and the two four-backtick samples acquired a literal `` `ts `` language class and closed at the nested three-backtick text.

The renderer uses `fences.mjs` for CommonMark-style fence boundaries and strips any info-string metadata from rendered code.

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
- The twelve `web-graphql*` slugs remain live, unchanged pages.
- `graphql` remains only a planning placeholder for those pages; `package-reference`, the #686 `generated-client` page, and the nine #701 framework guides are the implemented canonical additions.
- The live page count and statuses are measured from the registry and recorded in §2.1; the dated #713 target is historical.
- No GraphQL redirect artifacts are emitted.
- `PAGE_META` owns title, status and optional note. NAV owns group and order; `group` is derived from NAV and is not hand-written a second time in `PAGE_META`.
- A missing, duplicate, unregistered or orphaned slug is a build and verification failure.
- Page status does not change merely because the page moved. All twelve retained GraphQL pages remain `wontfix`.

The reading order is intentional: install the product, build with it, learn schema/ORM and contracts, compose the server and clients, select databases, operate the application, opt into integrations,
then use reference material.

The ten group names and every non-GraphQL page position are live. The `graphql` planning position expands to the twelve existing `web-graphql*` pages in `LEGACY_REDIRECTS` order. #718 is closed
wontfix, so the existing pages remain unchanged and no canonical replacement or redirect set is promised. The current registry also includes the generated-client, framework, tooling and
runtime-foundation guides; §2.1 records its measured inventory.

## 4. GraphQL remains outside the migration

`LEGACY_REDIRECTS` is a historical name retained by the frozen navigation data. Its keys now provide only the stable order in which the twelve existing GraphQL pages occupy the `graphql` planning
position.

Under the current decision:

- all twelve `web-graphql*` source pages, slugs, navigation entries, search records, coverage mappings, and sample classifications remain unchanged;
- no `graphql.md` page or redirect HTML is generated;
- no internal link is rewritten solely for consolidation; and
- GraphQL support remains not planned and creates no implementation, compatibility, migration, or deprecation promise.

## 5. Generated content ownership

Generated sections use paired, literal markers:

```text
<!-- generated: product-catalog package-reference -->
<!-- /generated: product-catalog package-reference -->

<!-- generated: integrations framework-integrations -->
<!-- /generated: integrations framework-integrations -->

<!-- generated: architecture policy-graph -->
<!-- /generated: architecture policy-graph -->
```

Rules:

- Authored prose may exist outside a marker pair. The generator replaces only bytes between the pair.
- A missing, duplicated, nested or reversed marker is an error.
- Generated output ends with one newline, uses stable sorting and is byte-identical on a second run.
- Check mode compares expected bytes without modifying the working tree.
- Generated output is never accepted as its own source of truth.

### 5.1 Package reference

`docs-site/content/package-reference.md` is generated from two authorities:

1. `scripts/product/catalog.mjs` owns official product membership, package directory, product role, facade visibility, optionality, documentation owner and external-consumer owner.
2. `<catalog directory>/package.json` owns npm name, version, description, exports, dependencies, peer ranges and optional metadata, engines, license and repository metadata.

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
  readonly peers?: readonly string[];
  readonly docs: string;
  readonly evidence: readonly string[];
}
```

Status semantics:

- `built-in`: shipped through the default `@zmdb/core` product surface with no additional integration package.
- `optional`: shipped by the named official package; every framework library is a declared peer of that package.
- `documented`: a tested recipe over public APIs exists, but no official dedicated package exists.
- `not-planned`: this documentation release claims no official integration; `docs` explains the unavailability and supported alternative.

Status is release-scoped shipped truth, not a forecast. An open roadmap issue does not upgrade a row, and `not-planned` does not by itself close or contradict future implementation work.

Additional invariants:

- `package` is non-null for `built-in`, `optional` and `documented`; it is null for `not-planned`.
- `peers` is a non-empty, duplicate-free list permitted only for `optional`; every name must match that package's manifest. A peer may be required or optional according to the package contract.
- `docs` is one canonical slug, not a URL.
- `evidence` is non-empty, repository-relative, exists at generation time and names tests, fixtures, public source or an unavailability specification that substantiates the row.
- An issue, draft or roadmap entry is not support evidence. The matrix reports shipped truth only.
- Prose mentions do not cause a row to be inferred.
- React, Angular, Vue, Svelte, Solid, React Native, Next.js, Nuxt and SvelteKit each have exactly one row. Until implementation evidence exists, a row must not claim `built-in` or `optional`.

### 5.3 Client Applications support and samples

`docs-site/client-applications.mjs` owns the release-scoped CSR, SSR, hydration, cancellation, native-lifecycle, canonical-example, and packed-test facts for the nine official client integrations.
Package names and guide slugs are read from `docs-site/integrations.mjs`; package-reference ownership is read from `scripts/product/catalog.mjs`.

Every guide has the same eight sections: Install, Provide, Query, Mutate, Cancellation, Errors, SSR, and Testing. Its canonical TypeScript fence names one checked-in
`fixtures/client-adapters/docs/*.ts` source. `client-applications-docs.spec.ts` rejects prose/source drift, compares every support row with the #700 conformance metadata, proves recipe-only
integrations have no package, rejects duplicated URL/authentication/validation implementation, and compiles all nine examples together against packed `@zmdb/client` and adapter tarballs.

### 5.4 Executable architecture views

`ARCHITECTURE.md` and `docs-site/content/architecture.md` carry the same `architecture policy-graph` generated region. Its authorities are:

1. `scripts/product/catalog.mjs` for admitted package identity and npm name;
2. `scripts/architecture/policy.mjs` for zone, canonical ring, direct workspace dependencies, ordinary runtime allowances, tooling selectors, optional peers and their exact selectors; and
3. the admitted manifests for optional-peer ranges.

The generated view contains every admitted package exactly once, the complete direct workspace graph, measured package/edge/ring bounds, and every non-empty runtime/tooling/optional-peer assignment.
Rows are ordered by ring and npm name. Package ids are mapped through the catalog rather than synthesized from directories.

The docs checker requires `ARCHITECTURE.md` to link the package/dependency workflow in `CONTRIBUTING.md` and retain its regeneration, architecture-zone and generated-doc commands. The architecture
guide and `PUBLISHING.md` retain their executable release commands. The checker rejects the former hand-maintained dependency spine, the stale twenty-nine-package claim, an
independently-versionable-package claim, and a copied publish loop in release documentation. Graph output may change only by changing the catalog, policy or admitted manifests and regenerating with
`node docs-site/generated.mjs`.

## 6. Documentation samples

Documentation samples use ordinary fenced code blocks. Keep examples concise, use public package exports, and verify behavior with the package tests that own the API when a documentation change alters
an executable contract. The docs renderer handles CommonMark-style fence boundaries and syntax highlighting.

## 7. Required verification

The documentation build and focused renderer tests cover these behaviors:

- the site emits its landing page, documentation, benchmark dashboard and OpenAPI artifacts;
- malformed or missing benchmark inputs render an explicit unavailable state;
- search indexing, ranking and snippets work and escape page content; and
- theme, offline search and keyboard interaction remain functional.

The contributor workflow is [CONTRIBUTING.md](../CONTRIBUTING.md#documentation-changes). Run `yarn build:docs` to emit the site, including its OpenAPI artifact. Run
`yarn vitest run --project unit docs-site/build.spec.ts docs-site/shell.spec.ts` for focused build and renderer behavior.
