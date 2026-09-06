# Package architecture and release governance — specification

> **Status:** target contract frozen by issue #722 for epic #721 and amended for the packages admitted by #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #691, #692, #693, #694,
> #695, #657, #658, #659, #660, #661, #697, #698, and the #710 AI ownership cutover. Issue #724 implements the canonical policy plus read-only discovery and graph APIs; #725 implements
> architecture-zone, ring and workspace-edge enforcement; and #727 implements package metadata and lockstep-manifest enforcement. #726 implements policy-driven runtime, tooling and optional-peer
> reachability; only the release verifier remains a later slice. The original measured baseline is commit `5adba11e` on 2026-09-05.

## 1. Authority, scope and measured baseline

The product catalog frozen in [`scripts/product/SPEC.md`](../product/SPEC.md) is the sole authority for official package membership, npm identity and product role. Architecture policy adds constraints
to those members; it does not discover packages from `packages/*`, a workspace glob, a publish array or a workflow loop.

At the measured baseline:

- exactly six directories under `packages/` contained publishable manifests;
- all six manifests carried `1.0.0-alpha.4`;
- their manifests contain 14 directed workspace dependency entries;
- the six manifests declare 11 optional peers in total;
- `@zmdb/query-compiler` declares `oxfmt`, while `zmdb` declares `esbuild` and `oxfmt`; measured source paths reach those third-party dependencies only from the tooling entries frozen below;
- `.github/scripts/lib/publish-manifest.mjs`, `.github/scripts/prepare-publish.mjs` and `.github/workflows/publish.yml` each repeat package membership, while `.github/scripts/set-latest-tag.mjs`
  carries a stale four-package subset;
- no root `CHANGELOG.md`, `scripts/release/plan.mjs` or `scripts/release/bump.mjs` exists; and
- `tsconfig.json` sets `allowImportingTsExtensions` to `false`.

These facts explain the starting state; they are not exemptions. Roadmap-only package directories that contain a `SPEC.md` but no manifest are not catalog members and receive no policy row.

Issues #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #691, #692, #693, #694, #695, #657, #658, #659, #660, and #661 add `@zmdb/protobuf`, `@zmdb/client`, `@zmdb/ai`, `@zmdb/app`,
`@zmdb/jobs`, `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, `@zmdb/ai-vercel`, `@zmdb/mcp`, `@zmdb/otel`, `@zmdb/sqlite`, `@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, `@zmdb/solid`,
`@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, and `@zmdb/jobs-postgres`; issue #697 adds `@zmdb/next`, and #698 adds `@zmdb/nuxt`. Issue #710
removed the temporary LangChain-to-schema-core edge. The current twenty-nine manifests keep `1.0.0-alpha.4`, declare 48 direct non-dev workspace edges, and declare 25 peer dependencies: 8 optional
peer entries plus 17 required peer entries confined to their selected integration packages.

## 2. Canonical policy API

The implementation in #724 exports exactly:

```ts
export interface PackagePolicy {
  readonly directory: string;
  readonly zone: 'foundation' | 'runtime' | 'integration' | 'tooling' | 'application' | 'facade';
  readonly ring: number;
  readonly allowedWorkspaceDependencies: readonly string[];
  readonly allowedRuntimeDependencies: readonly string[];
  readonly optionalPeerEntries: Readonly<Record<string, readonly string[]>>;
  readonly toolingEntries: readonly string[];
  readonly release: 'lockstep';
}

export const PACKAGE_POLICY: Readonly<Record<string, PackagePolicy>>;
```

The record key and every `allowedWorkspaceDependencies` value are stable product-catalog ids, not npm names or directories. `directory` must equal the matching catalog row byte-for-byte. This
apparently redundant field makes a moved package an explicit policy review while the catalog still owns membership.

`allowedRuntimeDependencies` contains exact non-workspace package names that ordinary runtime exports may reach. Node built-ins are not package names and are checked by their package-specific
contracts. A dependency reached only by a tooling entry is not placed in this array; it remains a declared manifest dependency and is classified by the reachability rules in §5.

`optionalPeerEntries` maps an exact optional peer name to the only public entry selectors allowed to refer to it at runtime or in published declarations. `toolingEntries` contains the selectors whose
purpose is build, generation, lint, CLI, benchmark, test support, inspection or development tooling.

Entry selectors are:

- a literal export-map key such as `.`, `./introspect` or `./microservices/grpc`; or
- `bin:<command>` for a manifest executable.

Selectors are unique and sorted. Every selector must resolve in the matching committed manifest. Wildcards, source paths and inferred directory prefixes are invalid selectors.

All arrays and record keys are deterministic, duplicate-free and deeply read-only. Module evaluation performs no filesystem write, network access, subprocess launch, package import or environment
mutation. Functions that inspect a repository receive its root explicitly.

### 2.1 Read-only discovery and graph API

[`index.mjs`](./index.mjs) exposes the reusable boundary consumed by later verifiers and release planning:

- `loadArchitecture(root)` imports that root's `PRODUCT_CATALOG` and `PACKAGE_POLICY`, rejects missing, stale or directory-mismatched policy rows, and resolves exactly those catalog directories to
  manifests;
- `policyMembershipDiagnostics(catalog, policy)` performs the same membership check without filesystem access;
- `lookupPackage(architecture, identity)` finds a package by catalog id, npm name, repository-relative directory or resolved directory;
- `lookupExport(architecture, specifier)` resolves an exact public package specifier to its manifest selector and source target;
- `createDependencyGraph(architecture)` returns catalog ids mapped to the policy's allowed direct workspace dependencies; and
- `topologicalOrder(graph)` returns dependency-first catalog ids with catalog id as the deterministic tie-breaker and rejects a cycle rather than returning a partial order.

The model never enumerates `packages/*` to create membership and never infers policy from manifests or imports. It does not read versions, changelog content, tags, credentials or publication state.
Issue #728 may map the returned ids to catalog npm names and combine that order with separate release authorities.

## 3. Zones, rings and dependency direction

Zones are ordered from inward to outward:

| Rank | Zone          | Responsibility                                                          |
| ---: | ------------- | ----------------------------------------------------------------------- |
|    0 | `foundation`  | dependency-light schema, IR, query and protocol primitives              |
|    1 | `runtime`     | reusable product runtime built on foundation contracts                  |
|    2 | `application` | application composition and framework runtime                           |
|    3 | `integration` | technology-selected database, transport, provider or framework adapters |
|    4 | `tooling`     | build, code-generation, migration, CLI and development packages         |
|    5 | `facade`      | the one-product composition surface; no other zone may depend on it     |

A direct workspace edge is valid only when all of these hold:

1. the dependency is a catalog member;
2. its catalog id appears in the consumer's `allowedWorkspaceDependencies`;
3. its zone rank is less than or equal to the consumer's zone rank;
4. its ring is strictly lower than the consumer's ring;
5. the consumer manifest declares the edge in `dependencies`, `optionalDependencies` or `peerDependencies`;
6. production source imports the dependency through a declared public export, never `packages/<name>/src`, another private path or a relative path that escapes the package; and
7. adding the edge leaves the complete catalog graph acyclic.

Production type-only imports count for package ownership and therefore require the same manifest and policy edge. Runtime reachability in §5 separately ignores imports erased from emitted JavaScript.
Test/spec/type-test imports do not create release graph edges, but they must use declared dev dependencies.

Rings are canonical minimal topological depth:

```text
ring(package with no direct workspace dependency) = 0
ring(other package) = 1 + max(ring(each direct workspace dependency))
```

An inflated ring is invalid even if every edge still points down. The verifier detects cycles before calculating rings and prints the complete shortest cycle with its repeated start node.

`allowedWorkspaceDependencies` must equal the manifest's direct non-dev catalog edges. A manifest edge absent from policy, a policy edge absent from the manifest, an imported edge absent from both,
and an allowed edge unused by production source are four distinct violations. Policy never silently expands itself from observed imports.

## 4. Complete policy rows for the current catalog

The following object is normative. It constrains the current twenty-nine catalog members, and the runtime-reachability gate verifies every present export and executable against it. Adding, removing or
renaming a catalog member requires the catalog and policy key sets to change atomically.

```ts
export const PACKAGE_POLICY = {
  client: {
    directory: 'packages/client',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./testing'],
    release: 'lockstep',
  },
  react: {
    directory: 'packages/react',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  angular: {
    directory: 'packages/angular',
    zone: 'integration',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  vue: {
    directory: 'packages/vue',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  svelte: {
    directory: 'packages/svelte',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  next: {
    directory: 'packages/next',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'react'],
    allowedRuntimeDependencies: ['server-only'],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  nuxt: {
    directory: 'packages/nuxt',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'vue'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  solid: {
    directory: 'packages/solid',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'query-compiler': {
    directory: 'packages/query-compiler',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./introspect'],
    release: 'lockstep',
  },
  'schema-core': {
    directory: 'packages/schema-core',
    zone: 'foundation',
    ring: 1,
    allowedWorkspaceDependencies: ['query-compiler'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  ai: {
    directory: 'packages/ai',
    zone: 'runtime',
    ring: 2,
    allowedWorkspaceDependencies: ['schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./compiler'],
    release: 'lockstep',
  },
  'ai-anthropic': {
    directory: 'packages/ai-anthropic',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@anthropic-ai/sdk': ['.'],
    },
    toolingEntries: [],
    release: 'lockstep',
  },
  'ai-langchain': {
    directory: 'packages/ai-langchain',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@langchain/core': ['.'],
    },
    toolingEntries: [],
    release: 'lockstep',
  },
  'ai-vercel': {
    directory: 'packages/ai-vercel',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      ai: ['.'],
    },
    toolingEntries: [],
    release: 'lockstep',
  },
  mcp: {
    directory: 'packages/mcp',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  protobuf: {
    directory: 'packages/protobuf',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'aot-validator': {
    directory: 'packages/aot-validator',
    zone: 'runtime',
    ring: 3,
    allowedWorkspaceDependencies: ['ai', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      metro: ['./metro'],
      'metro-babel-transformer': ['./metro'],
      oxlint: ['./lint'],
      typescript: ['./codegen', './metro', './plugin', './reflect', './testing', './transformer', './unplugin', 'bin:zmdb-codegen'],
    },
    toolingEntries: ['./codegen', './emit', './lint', './metro', './plugin', './reflect', './testing', './transformer', './unplugin', 'bin:zmdb-codegen'],
    release: 'lockstep',
  },
  repository: {
    directory: 'packages/repository',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  sqlite: {
    directory: 'packages/sqlite',
    zone: 'runtime',
    ring: 5,
    allowedWorkspaceDependencies: ['query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  app: {
    directory: 'packages/app',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'repository', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  otel: {
    directory: 'packages/otel',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  jobs: {
    directory: 'packages/jobs',
    zone: 'application',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'query-compiler', 'repository', 'sqlite'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'transport-grpc': {
    directory: 'packages/transport-grpc',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'protobuf'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'transport-nats': {
    directory: 'packages/transport-nats',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'transport-rabbitmq': {
    directory: 'packages/transport-rabbitmq',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'transport-redis': {
    directory: 'packages/transport-redis',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  'jobs-postgres': {
    directory: 'packages/jobs-postgres',
    zone: 'integration',
    ring: 7,
    allowedWorkspaceDependencies: ['jobs', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  web: {
    directory: 'packages/web',
    zone: 'application',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      typescript: ['./contract/compiler'],
    },
    toolingEntries: ['./bench', './contract/compiler', './devtools', './testing'],
    release: 'lockstep',
  },
  zmdb: {
    directory: 'packages/zmdb',
    zone: 'facade',
    ring: 7,
    allowedWorkspaceDependencies: ['app', 'aot-validator', 'query-compiler', 'repository', 'schema-core', 'sqlite', 'web'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./cli', './config', './unplugin', './web/contract/compiler', 'bin:zmdb'],
    release: 'lockstep',
  },
} as const;
```

Ordinary-runtime dependency allowances are empty except for Next's official `server-only` boundary marker. Other current third-party dependency entries are tooling-only:

- `@zmdb/query-compiler#./introspect` reaches `oxfmt` only through declaration emission; and
- `zmdb#./cli` and `bin:zmdb` reach `esbuild` and `oxfmt` for scaffolding, embedding and application loading.

`@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, `@zmdb/solid`, `@zmdb/nuxt`, `@zmdb/otel`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`,
`@zmdb/transport-redis`, and `@zmdb/jobs-postgres` reach their required peers under §5.4, so they do not use an ordinary-runtime dependency allowance. `@zmdb/next` reaches its required Next, React,
and React DOM peers under the same rule; its sole ordinary-runtime allowance is `server-only@0.0.1`, the official executable server/client boundary marker loaded by `./server`.

Every tooling selector carries an adjacent implementation comment explaining its purpose. A later package split moves the selector and dependency together; it does not leave a compatibility exemption
in the former owner.

The optional-peer assignments and required integration-peer rule are the enforced narrow boundaries. A broader barrel path is a reachability failure, not a reason to broaden the row.

## 5. Runtime, tooling and peer reachability

### 5.1 Graph modes

The shared import graph has two explicit modes:

- **ownership mode** follows static imports, re-exports, literal dynamic imports and production type-only imports across relative and workspace specifiers; and
- **runtime mode** follows only imports that survive emit, including literal dynamic imports.

Both modes resolve relative `.js` source specifiers to an existing `.js` file first and otherwise to the `.ts` sibling, matching `scripts/ts-specifier-hook.mjs`. Neither mode permits a relative `.ts`
specifier. `allowImportingTsExtensions` remains `false`; generated and emitted code also uses `.js` relative specifiers.

The walk starts independently at every committed export and executable. It follows workspace package exports but never guesses a private subpath. Diagnostics report the shortest path from the entry,
including the final external specifier.

### 5.2 Ordinary runtime entries

Every export or bin not listed in `toolingEntries` is an ordinary runtime entry. Its runtime closure may reach:

- declared Node built-ins permitted by the owning package contract;
- catalog packages named by `allowedWorkspaceDependencies`; and
- third-party dependencies named by `allowedRuntimeDependencies`.

It must not reach:

- `typescript`, `oxlint/plugins-dev`, `oxfmt`, `esbuild`, `node:repl`, a devtools entry target or another dependency used exclusively by tooling;
- the target or tool-tainted closure of a `toolingEntries` selector;
- an optional peer unless the entry appears in that peer's `optionalPeerEntries` list;
- an undeclared package;
- a private workspace source path; or
- a dependency available only through `devDependencies`.

A tool-tainted module is a module on a path from a tooling entry to a tooling-only external dependency, executable-only module, REPL/devtools module or another tooling entry target. Shared pure
utilities are not tainted merely because both a runtime and tooling entry use them.

Every `allowedRuntimeDependencies` item must be declared in `dependencies`, reached by at least one ordinary runtime entry and accompanied by an adjacent policy comment stating why the runtime cost is
accepted. An unused allowance is stale and fails.

### 5.3 Tooling entries

A tooling entry may reuse ordinary runtime modules and may reach a declared build/compiler dependency. That permission belongs only to the named selector; it does not make the package root or sibling
exports tooling-aware. A tooling selector is stale when it is absent from the manifest, reaches no tooling-only capability, or becomes an alias of an ordinary runtime entry.

`bin:<command>` is checked independently even when it resolves to the same file as an export, because removing either manifest surface is a public change. Tooling imports remain subject to workspace
edge, manifest declaration, optional-peer and private-source rules.

### 5.4 Optional and required peers

For every `optionalPeerEntries` key:

1. the manifest declares the same name in `peerDependencies`;
2. `peerDependenciesMeta[name].optional` is exactly `true`;
3. every selector exists and no unassigned entry reaches the peer in runtime code or exported declarations;
4. a real dev dependency or packed/type conformance fixture proves the supported peer range; and
5. the assignment is rejected as stale if no production declaration, runtime path or conformance fixture uses it.

An optional peer must not also appear in `dependencies` or `optionalDependencies`. An undeclared peer import is an ordinary undeclared-dependency violation, not an implicit new exemption.

A technology-selected catalog package in the `integration` zone may instead declare one or more required peers. Required peers omit optional metadata, are not listed in `optionalPeerEntries`, and may
be reached by that integration's runtime exports. This is permitted only when the product catalog marks the package as an integration for that technology and a packed fixture proves the peer range. A
foundation, runtime, application, tooling or facade package cannot make an external technology peer required.

## 6. Manifest and lockstep release contract

Every catalog directory contains `package.json`, `README.md`, `LICENSE`, root `SPEC.md`, `tsconfig.json` and `tsconfig.build.json`. The manifest must satisfy all of these:

- `name` equals catalog `npmName`, and `repository.directory` equals both catalog and policy `directory`;
- `version` is valid SemVer and byte-identical across the catalog;
- `description` is non-empty; `keywords` is a sorted non-empty unique array containing `zmdb`;
- `homepage` is `https://github.com/ambasta/zmdb#readme`;
- `bugs.url` is `https://github.com/ambasta/zmdb/issues`;
- `license` is `GPL-3.0-or-later`, `author` is `zmdb contributors`, and `repository` is the canonical git URL plus directory;
- `type` is `module`; `sideEffects` is `false` or a sorted package-local allowlist of measured `./src/*.ts` side-effect files; and `engines.node` does not admit a version below 26;
- committed `files` is exactly `src`, `README.md`, `LICENSE`; the publish transform adds `dist`;
- `exports` is non-empty, explicit and wildcard-free; every committed target is a package-local existing `./src/*.ts` file;
- every `bin` target is package-local, exists, has a Node shebang and is named by a policy selector;
- `publishConfig.access` is `public`, and its channel agrees with the common version;
- `scripts.build` invokes the canonical package build and `scripts.test` runs Vitest; and
- dependency, peer and dev-dependency sections are sorted and contain no duplicate ownership or stale entry; the optional package-specific `zmdb` extension, when present, is a sorted non-empty
  string-valued record.

Every direct production workspace edge uses `workspace:^` in the committed manifest. The publish transform uses the exact common version for a prerelease and `^<version>` for a stable release.
Published manifests omit dev dependencies, point exports and bins at existing `dist` `.js`/`.d.ts` files, repoint any side-effect allowlist to `dist` `.js`, and preserve the package's metadata.

Every policy row has `release: 'lockstep'`; no other value, missing value or package-specific release train exists. The complete changelog, release-plan, tag, retry and publication-order contract is
normative in [`PUBLISHING.md`](../../PUBLISHING.md).

## 7. Verifier boundaries

All verifiers:

- accept `--root <path>` and default to the repository root only when the flag is absent;
- resolve the catalog, policy, manifests, source, changelog and fixtures entirely below that root;
- are read-only, deterministic and offline;
- collect all independent violations before exiting;
- print repository-relative POSIX paths and stable catalog/npm identities;
- sort diagnostics by code, catalog id, entry and path;
- print one diagnostic per line as `[CODE] <subject>: <measured violation>. Remediation: <exact action>.`;
- exit 0 on success, 1 for contract violations and 2 for invalid CLI usage or an unreadable root; and
- never auto-expand policy or treat a missing file/service as a skip.

### 7.1 `verify-architecture-zones`

Inputs: product catalog, `PACKAGE_POLICY`, catalog manifests and ownership-mode production imports.

Violations: missing/stale rows, directory mismatch, forbidden/stale/undeclared edges, private imports, invalid zone direction, non-canonical ring and complete dependency cycles.

Remediation: remove or redirect the source import, declare the existing intended edge in both manifest and policy, or change catalog/policy ownership explicitly. The verifier never recommends merely
raising a ring to hide a cycle.

[`verify-architecture-zones.mjs`](../../.github/scripts/verify-architecture-zones.mjs) implements this boundary. It receives package resolution records from `loadArchitecture(root)`, starts at every
manifest export and executable, counts type-only imports, ignores import-shaped text inside comments and string/template literals, and follows relative modules only while they remain inside the
consumer package. `yarn verify:architecture-zones` runs the live repository root and CI invokes that package script directly.

### 7.2 `verify-runtime-reachability`

Inputs: policy entry selectors, export/bin targets, runtime-mode imports, emitted declaration references, manifests and peer metadata.

Violations: tooling leaks, peer leaks, undeclared packages, dev-only production imports, missing optional metadata and stale tooling/runtime/peer exemptions.

Remediation: move the import behind its assigned entry, split the integration/tooling package, declare and test the peer at the correct owner, or remove the stale exemption. Broadening an entry list
is valid only with a reviewed architecture-policy change and measured packed-consumer need.

[`verify-runtime-reachability.mjs`](../../.github/scripts/verify-runtime-reachability.mjs) implements this boundary. `yarn verify:runtime-reachability` runs the committed tree and nine self-test
mutations, and CI invokes that package script directly. `verify:exports` delegates policy checks to the same implementation; `verify:devtools-boundary` is a compatibility command rather than a second
ownership list.

### 7.3 `verify-package-metadata`

Inputs: catalog, policy, committed manifests and required package files.

Violations: any missing, malformed, inconsistent or stale field; missing files; broken export/bin targets; wrong internal range; version drift; incomplete peer metadata.

Remediation: make the manifest agree with catalog/policy and regenerate it through the canonical metadata path. Never edit generated publish manifests as the source of truth.

### 7.4 `verify-release-governance`

Inputs: read-only release plan, catalog membership, policy DAG, common manifest version, root changelog, lockfile and optional triggering tag.

Violations: membership/order duplication or drift, version/range drift, absent/invalid changelog section, tag mismatch, partial train and non-deterministic plans.

Remediation: use the whole-train bump, repair the root changelog, regenerate the lockfile, create the exact tag, or consume the release plan instead of a handwritten loop.

## 8. Stable diagnostic codes and exact remediation

| Code                         | Required measured subject                                      | Required remediation text/action                                                 |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ARCH_POLICY_MISSING`        | catalog id and npm name with no row                            | add the row under that catalog id                                                |
| `ARCH_POLICY_STALE`          | row key absent from the catalog                                | delete it or admit the package in the catalog in the same change                 |
| `ARCH_DIRECTORY_MISMATCH`    | catalog, policy and manifest directories                       | make all three equal to the real repository-relative directory                   |
| `ARCH_CYCLE`                 | complete shortest `a -> b -> ... -> a` cycle                   | remove or reverse an ownership edge; do not raise rings                          |
| `ARCH_EDGE_FORBIDDEN`        | consumer, dependency and source import                         | use an existing inward public contract or review manifest and policy together    |
| `ARCH_EDGE_UNDECLARED`       | import path with no production manifest edge                   | add the intended direct dependency and policy id, or remove the import           |
| `ARCH_EDGE_STALE`            | policy/manifest edge unused by production source               | remove the stale edge from both authorities                                      |
| `ARCH_ZONE_DIRECTION`        | consumer and dependency zones                                  | move ownership inward or introduce an explicit lower-layer contract              |
| `ARCH_RING_INVALID`          | declared and calculated canonical ring                         | set the canonical ring after fixing all edges                                    |
| `ARCH_PRIVATE_IMPORT`        | full private cross-package import path                         | publish/use the owning package's public export                                   |
| `ARCH_TOOLING_LEAK`          | runtime entry and shortest path to the tooling sink            | move the sink behind a tooling entry or split the tool owner                     |
| `ARCH_PEER_LEAK`             | peer, unassigned entry and shortest path                       | route through an assigned integration entry or move it to an integration package |
| `ARCH_DEPENDENCY_UNDECLARED` | external specifier and shortest import path                    | declare it at the correct manifest boundary or remove the import                 |
| `ARCH_EXEMPTION_STALE`       | unused runtime dependency, tooling selector or peer assignment | remove the exemption                                                             |
| `PACKAGE_METADATA_INVALID`   | package, field and measured value                              | restore the exact schema value or required file                                  |
| `PACKAGE_PEER_METADATA`      | peer range/meta/dev-fixture mismatch                           | align the declaration and prove the range with the real peer                     |
| `PACKAGE_VERSION_DRIFT`      | every distinct version and owning package ids                  | run one whole-train bump                                                         |
| `PACKAGE_WORKSPACE_RANGE`    | package, dependency and measured range                         | use `workspace:^` in source and regenerate the publish manifest                  |
| `RELEASE_CHANGELOG_MISSING`  | common version and changelog path                              | add one non-empty exact version section                                          |
| `RELEASE_TAG_MISMATCH`       | triggering tag and common version                              | tag the verified commit exactly `v<version>`                                     |
| `RELEASE_MEMBERSHIP_DRIFT`   | missing, duplicate or handwritten release member               | consume the product catalog                                                      |
| `RELEASE_ORDER_DRIFT`        | expected and measured publish order                            | consume the policy-derived topological order                                     |

Diagnostics include facts, not guesses. When several rules fail for one edge, the structural cause is reported before consequences: membership, declaration, zone/ring, cycle, then reachability.

## 9. Fixture-root testing

Every verifier and pure discovery/graph/release function operates against an arbitrary fixture root. A fixture root supplies only the minimal files needed for that contract:

```text
<root>/
  package.json
  packages/<fixture-package>/package.json
  packages/<fixture-package>/src/*.ts
  scripts/product/catalog.mjs
  scripts/architecture/policy.mjs
  CHANGELOG.md
```

No fixture imports the live repository catalog or policy by absolute/relative escape, reads the live lockfile, requires `node_modules`, contacts npm, or mutates its source. Relative `.js` imports in a
fixture resolve to `.ts` siblings exactly as production source does.

#723 creates `scripts/architecture/__fixtures__/valid`, `cycle`, `upward-edge`, `undeclared-package`, `tooling-leak`, `peer-leak`, `metadata-drift`, `version-drift` and `changelog-drift`. The valid
fixture exercises every schema field. Each invalid fixture is otherwise valid and isolates its named rule; a malformed setup cannot satisfy an expected failure.

The frozen test titles are:

- `accepts the canonical package graph fixture`;
- `rejects a workspace dependency cycle and prints the complete cycle`;
- `rejects an edge not named by the consumer policy`;
- `rejects a publishable package missing from policy`;
- `rejects a runtime export reaching a tooling module`;
- `rejects an optional peer reachable from an unassigned export`;
- `rejects a dependency absent from the manifest`;
- `rejects a stale tooling or peer exemption`;
- `rejects incomplete or inconsistent package metadata`;
- `rejects versions that differ across the lockstep train`;
- `rejects an optional peer without optional metadata`;
- `rejects a release version absent from CHANGELOG.md`;
- `rejects a tag that disagrees with package versions`; and
- `derives topological publish order from the package graph`.

#725 retires the three expected failures for cycles, forbidden policy edges and workspace imports absent from the manifest, and adds executable stale-edge, non-canonical-ring and private-import
coverage. #726 retires the tooling- and optional-peer-reachability expected failures, adds executable stale-exemption coverage and wires the generic command into CI. #727 retires the
incomplete-metadata and lockstep-version expected failures and adds executable optional-peer metadata coverage. #728 still owns the two release expected failures, deterministic release plans and the
remaining release CI command.

## 10. Explicit refusals

This architecture refuses:

- a second package-membership array or a manually maintained publish order;
- inferring policy from the current imports and thereby legalising a defect;
- package-specific versions, changelogs, tags or partial releases;
- a cycle hidden by dynamic import, type-only import, peer dependency or inflated ring;
- a private cross-package source import even when TypeScript path mapping resolves it;
- runtime access to TypeScript, esbuild, oxfmt, REPL/devtools or an unassigned optional peer;
- a broad package-root peer exemption when one integration entry is sufficient;
- optional peer metadata without real range/conformance evidence;
- fixture tests that read the live repository or pass because setup is missing;
- a verifier that writes, fetches registry state or silently skips unreadable inputs;
- changing `allowImportingTsExtensions` from `false`; and
- relative `.ts` source imports or a build-time declaration rewrite that compensates for them.
