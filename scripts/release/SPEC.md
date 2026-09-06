# Release groups and compatibility guarantees

> **Status:** target contract frozen by issue #746 on 2026-09-06 and extended by issues #674 and #628 to classify the admitted `@zmdb/singlestore` and `@zmdb/compiler` packages. Issues #747–#750
> implement and qualify this contract. The checked-in release scripts still enforce the current 38-package lockstep train until those implementation issues land. This specification does not authorize
> a partial release with the current tooling.

This directory owns release-group classification, version movement, internal package ranges, third-party compatibility floors, changelog identity, release tags, and release planning. It does not own
product membership, npm identity, dependency direction, package exports, registry state, credentials, or publication side effects.

- `scripts/product/catalog.mjs` remains the sole authority for public package membership and npm identity.
- `scripts/architecture/policy.mjs` remains the sole authority for direct workspace edges, zones, rings, tooling selectors, and peer reachability.
- the future `scripts/release/policy.mjs` is the sole authority for release-group classification and compatibility ranges.
- package manifests are checked projections of those authorities, not another policy source.
- root `CHANGELOG.md` remains the sole release-note file.

No workflow, documentation generator, compatibility fixture, or publish helper may carry another handwritten package inventory.

Issue #732's `GovernanceSnapshot` exposes this release projection to other read-only consumers without changing ownership: the product catalog and architecture policy retain membership and dependency
authority, the target release policy owns group and compatibility decisions, current manifests remain the authoritative implementation projection until #749, and `CHANGELOG.md` still owns release
notes. Native issue relationships and architecture exceptions cannot alter a release plan.

## 1. Measured baseline and evidence boundary

The baseline contains:

- 38 public catalog packages, all currently at `1.0.0-alpha.4`;
- 74 direct non-development workspace edges: 20 within the cohesive core and 54 crossing release units;
- 36 peer entries: 33 third-party peers and three internal optional peers;
- six private root workspaces;
- six `packages/*` roadmap directories with no manifest; and
- one implemented release model that currently requires all 38 public packages to move together.

The release groups below are a policy decision over that measured inventory. Existing common versions are evidence of the starting state, not justification for keeping every package lockstep.

Compatibility evidence has a stricter meaning:

1. build every selected zmdb package to its publish form;
2. pack it into a tarball;
3. create a temporary project outside the repository;
4. install only those tarballs plus exact declared peer versions through a package manager;
5. resolve imports from that project's `node_modules`;
6. typecheck representative public usage with no `paths` mapping; and
7. execute representative runtime behavior where the package has runtime behavior.

A workspace symlink, root hoisting, a `workspace:` alias, source-mode Vitest, or a successful monorepo typecheck is not compatibility evidence.

For the disputed Vercel floor, the #746 probe packed `@zmdb/query-compiler`, `@zmdb/schema-core`, `@zmdb/ai`, and `@zmdb/ai-vercel`, installed those four tarballs with exact `ai@7.0.93`, `zod@4.5.4`,
`typescript@7.0.2`, and `@types/node@26.4.1` through npm 12.0.2 on Node 26.8.1. It resolved both `ai` and `@zmdb/ai-vercel` from the temporary consumer's `node_modules`. Strict usage with
`exactOptionalPropertyTypes: true` and the documented `skipLibCheck: true` typechecked; runtime reported adapter version `1.0.0-alpha.4`, AI SDK version `7.0.93`, keys `description`, `execute`, and
`inputSchema`, and result `packed-7.0.93`.

The earlier `skipLibCheck: false` attempt reached errors inside `@ai-sdk/provider-utils` declarations, including a missing `Buffer` ambient and `exactOptionalPropertyTypes`-incompatible generic
constraints. The successful proof therefore matches the documented consumer configuration; it is not a claim that the upstream declaration graph is clean under `skipLibCheck: false`. Neither result
justifies advertising an older floor. The supported and tested zmdb floor is **AI SDK 7.0.93**.

## 2. Machine-readable authority

Issue #749 adds `scripts/release/policy.mjs` with this public shape:

```ts
export type ReleaseGroup = 'core' | 'integration' | 'tooling';

export interface CompatibilityRange {
  /** Exact semver range written to the published manifest. */
  readonly range: string;
  /** Lowest exact version promised by that range. */
  readonly floor: string;
  /** Exact versions installed by the packed-consumer matrix. Includes floor. */
  readonly tested: readonly string[];
  /** Repository-relative packed-consumer fixture or generated matrix case. */
  readonly evidence: string;
}

export interface ReleasePackagePolicy {
  readonly group: ReleaseGroup;
  /**
   * One entry for every architecture edge that crosses release units.
   * Same-core edges are derived and do not appear here.
   */
  readonly internalCompatibility: Readonly<Record<string, CompatibilityRange>>;
  /** One entry for every third-party peer in the package manifest. */
  readonly peers: Readonly<Record<string, CompatibilityRange>>;
}

export const RELEASE_PACKAGE_POLICY: Readonly<Record<string, ReleasePackagePolicy>>;
```

Record keys and `internalCompatibility` keys are product-catalog ids. Peer keys are exact npm names. Arrays and record keys are deterministic, duplicate-free, and deeply read-only. Module evaluation
performs no filesystem write, network request, subprocess launch, package import, or environment mutation.

The key set of `RELEASE_PACKAGE_POLICY` must equal the public product-catalog key set. The release loader rejects a missing row, an extra row, a private manifest row, a directory mismatch, a
compatibility entry without an architecture edge, and a crossing architecture edge without one compatibility entry.

Private classification is manifest-owned rather than copied into the public policy: the repository root and every root workspace manifest with `"private": true` are in the `private` group and are
never accepted by `RELEASE_PACKAGE_POLICY`. A package is publishable only when it is a public catalog member, has `private !== true`, and has `publishConfig.access: "public"`.

## 3. Complete current inventory

The current public inventory is classified exactly once:

| Catalog id           | npm package                | Release group | Existing external-consumer evidence         |
| -------------------- | -------------------------- | ------------- | ------------------------------------------- |
| `ai`                 | `@zmdb/ai`                 | integration   | `yarn verify:publish`                       |
| `ai-anthropic`       | `@zmdb/ai-anthropic`       | integration   | `yarn verify:publish`                       |
| `ai-langchain`       | `@zmdb/ai-langchain`       | integration   | `fixtures/llm-adapters`                     |
| `ai-vercel`          | `@zmdb/ai-vercel`          | integration   | `fixtures/llm-adapters` plus the #746 probe |
| `angular`            | `@zmdb/angular`            | integration   | `fixtures/client-adapters`                  |
| `aot-validator`      | `@zmdb/aot-validator`      | core          | `yarn verify:publish`                       |
| `app`                | `@zmdb/app`                | core          | `yarn verify:publish`                       |
| `client`             | `@zmdb/client`             | integration   | `fixtures/consumer-http-client`             |
| `cockroach`          | `@zmdb/cockroach`          | integration   | `fixtures/database-cockroach`               |
| `compiler`           | `@zmdb/compiler`           | tooling       | `fixtures/consumer-compiler`                |
| `jobs`               | `@zmdb/jobs`               | core          | `fixtures/consumer-server-core`             |
| `jobs-postgres`      | `@zmdb/jobs-postgres`      | integration   | `fixtures/consumer-server-integrations`     |
| `mcp`                | `@zmdb/mcp`                | integration   | `fixtures/consumer-mcp`                     |
| `migrations`         | `@zmdb/migrations`         | tooling       | `yarn verify:publish`                       |
| `mssql`              | `@zmdb/mssql`              | integration   | `fixtures/database-mssql`                   |
| `mysql`              | `@zmdb/mysql`              | integration   | `fixtures/database-mysql`                   |
| `next`               | `@zmdb/next`               | integration   | `fixtures/next-app-router`                  |
| `nuxt`               | `@zmdb/nuxt`               | integration   | `fixtures/client-adapters/nuxt`             |
| `otel`               | `@zmdb/otel`               | integration   | `fixtures/consumer-server-integrations`     |
| `postgres`           | `@zmdb/postgres`           | integration   | `fixtures/database-postgres`                |
| `protobuf`           | `@zmdb/protobuf`           | integration   | `yarn verify:publish`                       |
| `query-compiler`     | `@zmdb/query-compiler`     | core          | `yarn verify:publish`                       |
| `react`              | `@zmdb/react`              | integration   | `fixtures/client-adapters`                  |
| `react-native`       | `@zmdb/react-native`       | integration   | `fixtures/client-adapters`                  |
| `repository`         | `@zmdb/repository`         | core          | `yarn verify:publish`                       |
| `schema-core`        | `@zmdb/schema-core`        | core          | `yarn verify:publish`                       |
| `singlestore`        | `@zmdb/singlestore`        | integration   | `fixtures/database-singlestore`             |
| `solid`              | `@zmdb/solid`              | integration   | `fixtures/client-adapters`                  |
| `sqlite`             | `@zmdb/sqlite`             | integration   | `fixtures/database-sqlite`                  |
| `svelte`             | `@zmdb/svelte`             | integration   | `fixtures/client-adapters`                  |
| `sveltekit`          | `@zmdb/sveltekit`          | integration   | `fixtures/client-adapters/sveltekit-packed` |
| `transport-grpc`     | `@zmdb/transport-grpc`     | integration   | `fixtures/consumer-server-integrations`     |
| `transport-nats`     | `@zmdb/transport-nats`     | integration   | `fixtures/consumer-server-integrations`     |
| `transport-rabbitmq` | `@zmdb/transport-rabbitmq` | integration   | `fixtures/consumer-server-integrations`     |
| `transport-redis`    | `@zmdb/transport-redis`    | integration   | `fixtures/consumer-server-integrations`     |
| `vue`                | `@zmdb/vue`                | integration   | `fixtures/client-adapters/vue`              |
| `web`                | `@zmdb/web`                | core          | `yarn verify:publish`                       |
| `zmdb`               | `zmdb`                     | core          | `fixtures/consumer-product`                 |

Counts are therefore eight core packages, 28 independently versioned integrations, and two independently versioned tooling packages.

The six private root workspaces are:

| Manifest                                | Package name                    |
| --------------------------------------- | ------------------------------- |
| `package.json`                          | `zmdb-monorepo`                 |
| `benchmarks/package.json`               | `@zmdb/benchmarks`              |
| `fixtures/client-adapters/package.json` | `@zmdb-fixture/client-adapters` |
| `fixtures/consumer-metro/package.json`  | `@zmdb-fixture/consumer-metro`  |
| `fixtures/llm-adapters/package.json`    | `@zmdb-fixture/llm-adapters`    |
| `fixtures/next-app-router/package.json` | `@zmdb-fixture/next-app-router` |

Nested fixture manifests are test assets outside the root workspace set and are already `private: true`; they are not release candidates. `packages/cli`, `packages/orm`, `packages/schema`,
`packages/jobs-sqlite`, `packages/sql`, and `packages/validator` have no manifest and are not packages. Adding a public manifest to any `packages/*` directory makes classification mandatory in the
same change.

## 4. Version ownership and movement

### 4.1 Cohesive core

The eight core packages carry one byte-identical SemVer and move together:

`@zmdb/query-compiler`, `@zmdb/schema-core`, `@zmdb/aot-validator`, `@zmdb/repository`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/web`, and `zmdb`.

A release that changes any core package releases all eight, even when seven tarballs are byte-identical apart from metadata. This preserves one coherent product version and makes the umbrella version
sufficient to identify every core contract.

Core-to-core source ranges remain exactly `workspace:^`. The publish transform writes:

- the exact common version while the core version is a prerelease; and
- `^<core-version>` for a stable core release.

No core package may carry a different version, an explicit cross-core range, or an independent changelog entry.

### 4.2 Integrations

Each integration package is its own release unit. Releasing one integration does not change a core, tooling, or unrelated integration version.

An integration's direct core imports are required core peers, not bundled copies:

- `peerDependencies` carries the exact range from `internalCompatibility`;
- `devDependencies` uses `workspace:^` only to test against the checked-out core;
- the peer is optional only when importing and using the integration without that core package is a real supported mode; and
- the packed matrix installs the exact floor and current supported core versions explicitly.

An integration-to-integration runtime edge stays an ordinary dependency unless the architecture contract requires caller ownership. Its source range is `workspace:<explicit-range>`, where the suffix
is exactly the range in `internalCompatibility`. Publication removes only the `workspace:` protocol and preserves that range byte-for-byte.

### 4.3 Tooling

`@zmdb/migrations` and `@zmdb/compiler` are public tooling release units with independent versions. Either may release without a core, integration, or unrelated tooling bump. Migrations' direct
query-compiler relationship is a required core peer with an explicit compatibility range and an exact workspace development dependency. Compiler's direct aot-validator, query-compiler, and schema-core
relationships are required core peers under the same rule; its AI relationship is an explicit cross-unit dependency.

No benchmark, fixture, generated project, repository script, or root workspace is publishable tooling. Those remain private.

### 4.4 Cross-unit ranges

Every architecture edge crossing release units has one explicit `internalCompatibility` entry. At this alpha baseline, every such entry has:

```ts
{
  range: '1.0.0-alpha.4',
  floor: '1.0.0-alpha.4',
  tested: ['1.0.0-alpha.4'],
}
```

Prerelease ranges do not admit an untested future prerelease. When `1.0.0-alpha.5` is proven compatible, the owning package may widen to an explicit union such as `1.0.0-alpha.4 || 1.0.0-alpha.5`; it
may not use `^1.0.0-alpha.4` as a shortcut for versions the matrix never installed.

After a stable release, a range may span compatible releases within one major, for example `>=1.2.0 <2.0.0`, when the packed matrix installs the floor and current supported version and the upstream
release unit follows SemVer. A range never crosses the next breaking major.

Core packages that intentionally depend on an independently versioned integration or tooling package use the same explicit cross-unit range rule. A newer compatible integration may publish without
moving core; core changes only when its declared compatible range must change.

### 4.5 Version transitions and npm channels

Each release unit owns one monotonically increasing SemVer. A core release chooses one version for all eight core packages; an independent release changes only its selected package version. Stable
major, minor, and patch choice follows the breaking/additive/fix rules in §6 across the selected unit. The core uses the highest required impact among all changes included in that release.

The only prerelease identifiers are `alpha.<non-negative integer>`, `beta.<non-negative integer>`, and `rc.<non-negative integer>`. A version must compare greater than that unit's previous version.
Promotion may move `alpha` to `beta`, `beta` to `rc`, or a prerelease to its stable base; a new breaking or feature line may start at `alpha.0`. Tooling does not infer a next version or silently
change the requested channel.

Publication uses the version's first prerelease identifier as its npm dist-tag: `alpha`, `beta`, or `rc`. A stable version uses `latest`. A prerelease is never published under `latest`, and a stable
release never rewrites an older channel tag as a side effect.

## 5. Third-party peer floors

A peer range is a support promise, not a package-manager suggestion. Its lower bound equals the exact tested floor. A package cannot advertise a lower version merely because its types happen to
compile in the workspace.

Except for the directly qualified Vercel row, the frozen ranges below use the exact versions pinned by current development or consumer fixtures as their deliberate target floor. A pin, workspace test,
or compile-only fixture identifies the version to test; it does not prove support. Issue #750 must install every exact floor from packed zmdb tarballs in a clean consumer before the release policy is
qualified. Issue #749 projects these frozen targets into policy and manifests; if a #750 packed case fails, its advertised range and floor must be corrected before #750 closes. Issue #746 changes no
manifest.

| Package                    | Third-party peer(s): frozen range; exact floor/current matrix version                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@zmdb/ai-anthropic`       | `@anthropic-ai/sdk@0.124.0`; `0.124.0`                                                                                                                              |
| `@zmdb/ai-langchain`       | `@langchain/core@^1.2.9`; `1.2.9`                                                                                                                                   |
| `@zmdb/ai-vercel`          | `ai@^7.0.93`; `7.0.93`                                                                                                                                              |
| `@zmdb/angular`            | `@angular/core@>=22.1.5 <23.0.0`; `22.1.5`; `rxjs@>=7.8.2 <8.0.0`; `7.8.2`                                                                                          |
| `@zmdb/compiler`           | `metro@>=0.87.0 <0.88.0`; `0.87.0`; `metro-babel-transformer@>=0.87.0 <0.88.0`; `0.87.0`; `oxlint@>=1.81.0 <1.82.0`; `1.81.0`; `typescript@>=7.0.2 <8.0.0`; `7.0.2` |
| `@zmdb/jobs-postgres`      | `pg@^8.23.0`; `8.23.0`                                                                                                                                              |
| `@zmdb/mssql`              | `mssql@^12.7.0`; `12.7.0`                                                                                                                                           |
| `@zmdb/mysql`              | `mysql2@^3.24.3`; `3.24.3`                                                                                                                                          |
| `@zmdb/next`               | `next@>=16.3.4 <17.0.0`; `16.3.4`; `react@>=19.2.8 <20.0.0`; `19.2.8`; `react-dom@>=19.2.8 <20.0.0`; `19.2.8`                                                       |
| `@zmdb/nuxt`               | `nuxt@>=4.5.2 <5.0.0`; `4.5.2`; `vue@>=3.5.42 <4.0.0`; `3.5.42`                                                                                                     |
| `@zmdb/otel`               | `@opentelemetry/api@^1.9.1`; `1.9.1`                                                                                                                                |
| `@zmdb/postgres`           | `pg@^8.23.0`; `8.23.0`                                                                                                                                              |
| `@zmdb/react`              | `react@>=19.2.8 <20.0.0`; `19.2.8`                                                                                                                                  |
| `@zmdb/react-native`       | `react@>=19.2.8 <20.0.0`; `19.2.8`; `react-native@>=0.87.1 <0.88.0`; `0.87.1`                                                                                       |
| `@zmdb/singlestore`        | `mysql2@^3.24.3`; `3.24.3`                                                                                                                                          |
| `@zmdb/solid`              | `solid-js@>=1.9.15 <2.0.0`; `1.9.15`                                                                                                                                |
| `@zmdb/svelte`             | `svelte@>=5.57.0 <6.0.0`; `5.57.0`                                                                                                                                  |
| `@zmdb/sveltekit`          | `@sveltejs/kit@>=2.70.3 <3.0.0`; `2.70.3`; `svelte@>=5.57.0 <6.0.0`; `5.57.0`                                                                                       |
| `@zmdb/transport-grpc`     | `@grpc/grpc-js@^1.14.4`; `1.14.4`                                                                                                                                   |
| `@zmdb/transport-nats`     | `@nats-io/transport-node@^3.4.0`; `3.4.0`                                                                                                                           |
| `@zmdb/transport-rabbitmq` | `amqplib@^2.0.1`; `2.0.1`                                                                                                                                           |
| `@zmdb/transport-redis`    | `redis@^6.2.1`; `6.2.1`                                                                                                                                             |
| `@zmdb/vue`                | `vue@>=3.5.42 <4.0.0`; `3.5.42`                                                                                                                                     |
| `@zmdb/web`                | `typescript@>=7.0.2 <8.0.0`; `7.0.2`                                                                                                                                |

Packages absent from the table have no third-party peer. `zmdb` additionally has internal optional peers on `@zmdb/mssql` and `@zmdb/postgres`; their measured current manifest ranges are both
`workspace:^`. Target-state compatibility policy requires both peers to use the explicit cross-unit alpha range `1.0.0-alpha.4` until a wider range is proven, with manifest projection owned by #749.

`tested` contains exact versions, never tags such as `latest`, ranges, workspace aliases, or npm aliases. The floor is always present in `tested`. A current-version case may equal the floor; if it
differs, both exact versions are installed in separate consumers.

## 6. Raising floors, deprecation, and breaking changes

### 6.1 Floor changes

Raising a core or third-party peer floor removes a previously supported installation and is therefore breaking:

- a stable integration or tooling package takes a major version;
- the stable core takes a major version when one of its own supported runtime, Node, TypeScript, or integration floors rises;
- a prerelease package increments its prerelease version and carries an explicit `BREAKING:` note; and
- the new exact floor must pass the packed matrix before the manifest range changes.

Widening an upper bound without dropping any supported version is non-breaking but still requires packed proof at the newly admitted current version.

### 6.2 Deprecation announcement and lifetime

A deprecation is announced in all of:

1. the owning release's root `CHANGELOG.md` `Deprecated` section;
2. the owning package README;
3. the relevant user documentation page; and
4. `@deprecated` JSDoc for a TypeScript API when applicable.

Stable APIs and peer ranges remain supported through the rest of their current major and for at least 90 days after announcement. Removal occurs only in the next major. During alpha, beta, or rc, a
deprecated API or range remains supported for at least one subsequent published prerelease and 30 days; the announcement names the earliest removal version.

A known exploitable vulnerability or upstream end-of-life may shorten the window. The `Security` changelog entry must name the reason, affected range, replacement floor, and migration path.

### 6.3 What is breaking

The following are breaking changes:

- removing or renaming a public export, type member, executable, or documented behavior;
- changing accepted input, output, error, lifecycle, or side-effect semantics incompatibly;
- raising Node, TypeScript, core, integration, tooling, or third-party peer floors;
- making an optional peer required;
- changing an integration's caller-owned resource or package-install requirement;
- moving a public package into or out of the core train;
- changing a stable core package version independently; or
- narrowing any published dependency or peer range so an installation previously inside the range is rejected.

Bug fixes that make behavior conform to an already frozen contract are patch changes, even when a consumer relied on the defect.

## 7. Changelog, tag, plan, and publication identity

The repository keeps one root changelog. Each released section identifies one release unit:

```md
# Changelog

## [Unreleased]

### Changed

- **product:** describe pending cross-cutting work

## [core@1.4.3] - 2026-09-06

### Fixed

- **repository:** describe the core fix

## [ai-vercel@1.3.1] - 2026-09-05

### Fixed

- **ai-vercel:** describe the integration fix
```

Release ids are `core` or one independent catalog id. A core section may use any core catalog id or `product` as a bullet owner. An independent section may use only its own catalog id. One release
operation consumes exactly one non-empty released section.

`Unreleased` remains one section, partitioned by bullet owner:

- `product` and every core catalog id belong to release id `core`;
- an integration or tooling catalog id belongs to that same independent release id; and
- an unknown owner is invalid rather than assigned heuristically.

Preparing a release selects the target's bullets from every allowed category, preserves their relative order, writes them under the exact `<release-id>@<version>` heading, and leaves all unrelated
bullets under `Unreleased` in their original categories and order. Empty categories are removed; the `Unreleased` heading remains exactly once. A target with no owned `Unreleased` bullet fails without
changing any file. Two sections may not repeat the same release id and version.

Tags are:

- `core-v<version>` for the core train; and
- `<catalog-id>-v<version>` for one integration or tooling package.

The future read-only plan boundary is:

```ts
export type ReleaseTarget = { readonly kind: 'core'; readonly version: string } | { readonly kind: 'package'; readonly id: string; readonly version: string };

export function releasePlan(
  root: string,
  target: ReleaseTarget,
): {
  readonly releaseId: string;
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly manifestChanges: readonly {
    readonly package: string;
    readonly version: string;
    readonly ranges: Readonly<Record<string, string>>;
  }[];
  readonly compatibilityCases: readonly string[];
  readonly changelogEntry: string;
};
```

A core plan contains all eight core packages exactly once in architecture-derived dependency order. An independent plan contains exactly the selected package. It may also update compatibility ranges
in that selected package; it never changes unrelated versions. Planning is deterministic and read-only.

Publication stops at the first failure. Retrying the same release tag skips an already published package only when the registry integrity is byte-identical. A retry never changes a version, range,
changelog body, package set, or tag.

## 8. Required examples

### 8.1 Core patch

`core@1.4.2` to `core@1.4.3` updates the version in all eight core manifests. Same-core published ranges become `^1.4.3`. No integration or tooling package version changes. A core package's explicit
range on an independent package changes only when the compatibility policy requires it.

### 8.2 Core breaking change

`core@1.4.3` to `core@2.0.0` moves all eight core packages together. Every independent package with a core peer is checked against `2.0.0`; it releases only when its range or code must change.
Unqualified integration ranges do not widen automatically.

### 8.3 Integration-only release

`@zmdb/ai-vercel@1.3.0` to `1.3.1` publishes only `@zmdb/ai-vercel`. The core remains `1.4.3`, `@zmdb/ai` retains its own version, and unrelated integrations do not receive metadata-only bumps.

### 8.4 Peer-floor raise

Changing the supported AI SDK floor from `7.0.93` to `8.1.0` first installs exact `ai@8.1.0` in a packed external consumer. The policy range changes from `^7.0.93` to `^8.1.0`, the changelog marks the
removal of AI SDK 7 support, and stable `@zmdb/ai-vercel` takes a major version. No core version changes.

### 8.5 Prerelease

`core@2.0.0-beta.1` to `core@2.0.0-beta.2` moves all eight core packages and writes exact same-core publish ranges `2.0.0-beta.2`. Independent packages stay unchanged. A package that has proved both
beta versions may explicitly widen its compatibility range; no caret prerelease range claims untested future betas.

## 9. Verification contract and implementation boundary

Issues #747–#750 must make these failures deterministic and actionable:

- a public `packages/*/package.json` has no catalog or release-policy row;
- a catalog package is missing, duplicated, private, or classified into an unknown group;
- a private root workspace appears in public release policy;
- core versions differ;
- a same-core or cross-unit internal range has the wrong form;
- a crossing architecture edge lacks compatibility policy or policy names no real edge;
- a peer range starts below its exact tested floor;
- a floor or current tested version lacks a clean packed-consumer case;
- a compatibility consumer resolves a workspace, root dependency, alias, or undeclared package;
- a prerelease range admits an untested future prerelease;
- a release plan changes an unrelated package version;
- a tag, changelog release id, plan, and manifest version disagree; or
- an unclassified publishable package is added later.

The verifier reports the package, policy row, observed manifest value, evidence case, and exact expected correction. Temporary projects and package-manager caches are removed on both success and
failure.

Issue #746 deliberately does not:

- add `scripts/release/policy.mjs`;
- change release, publish, or verification scripts;
- alter a package version, dependency, peer range, compatibility fixture, or lockfile entry;
- publish, tag, commit, or mutate GitHub; or
- claim that the current lockstep automation can already execute this target contract.
