# Package architecture and dependency governance — specification

> **Status:** current architecture and dependency contract. The composed query implementation is [governance.mjs](./governance.mjs); the contributor workflow is
> [CONTRIBUTING.md](../../CONTRIBUTING.md). Historical baselines and the native cutover are preserved in [ADR 0001](../../docs/adr/0001-architecture-and-native-graph-history.md).

## 1. Authority and scope

The product catalog frozen in [`scripts/product/SPEC.md`](../product/SPEC.md) is the sole authority for official package membership, npm identity and product role. Architecture policy adds constraints
to those members; it does not discover packages from `packages/*`, a workspace glob, a publish array or a workflow loop.

The original measured baseline is preserved in [ADR 0001](../../docs/adr/0001-architecture-and-native-graph-history.md).

Roadmap-only package directories that contain a `SPEC.md` but no manifest are not catalog members and receive no policy row.

`loadArchitecture(root)` enumerates current manifests and their direct non-dev workspace and peer declarations from the product catalog. Release-policy validation checks the required peer projection.

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

The checked-in `policy.mjs` carries no release-group field. `scripts/release/policy.mjs` owns release classification and compatibility ranges without changing architecture membership, dependency
direction, rings, or reachability.

### 2.1 Read-only discovery and graph API

[`index.mjs`](./index.mjs) exposes the reusable boundary consumed by later verifiers and release planning:

- `loadArchitecture(root)` imports that root's `PRODUCT_CATALOG` and `PACKAGE_POLICY`, rejects missing, stale or directory-mismatched policy rows, and resolves exactly those catalog directories to
  manifests while producing the one workspace-manifest inventory shared by specialised consumers;
- `loadArchitectureSync(root)` is the synchronous compatibility form used by model-equivalence tests; release and verifier consumers use the composed asynchronous governance snapshot;
- `policyMembershipDiagnostics(catalog, policy)` performs the same membership check without filesystem access;
- `lookupPackage(architecture, identity)` finds a package by catalog id, npm name, repository-relative directory or resolved directory;
- `lookupExport(architecture, specifier)` resolves an exact public package specifier to its manifest selector and source target;
- `createDependencyGraph(architecture)` returns catalog ids mapped to the policy's allowed direct workspace dependencies; and
- `topologicalOrder(graph)` returns dependency-first catalog ids with catalog id as the deterministic tie-breaker and rejects a cycle rather than returning a partial order.

The model enumerates `packages/*` exactly once to validate that no manifest exists outside the catalog and to expose non-members to specialised ownership checks; that enumeration never creates
membership. Policy is never inferred from manifests or imports. The architecture layer does not interpret versions, changelog content, tags, credentials or publication state. The release query maps
the returned ids to catalog npm names and combines that order with separate release authorities.

## 3. Zones, rings and dependency direction

Zones are ordered from inward to outward:

| Rank | Zone          | Responsibility                                                          |
| ---: | ------------- | ----------------------------------------------------------------------- |
|    0 | `foundation`  | dependency-light schema, IR, query and protocol primitives              |
|    1 | `runtime`     | reusable product runtime built on foundation contracts                  |
|    2 | `application` | application composition and framework runtime                           |
|    3 | `integration` | technology-selected database, transport, provider or framework adapters |
|    4 | `tooling`     | build, code-generation, CLI and development packages                    |
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

## 4. Current policy records

The foundation dependency contract is: `schema` and `sql` have no dependencies, `validator` depends only on `schema`, and `orm` depends exactly on `schema`, `sql`, and `validator`. The complete
current rows are owned by `scripts/architecture/policy.mjs` and `scripts/product/catalog.mjs`. Adding, removing or renaming a catalog member requires those catalog and policy key sets to change
atomically.

The recorded pre-cutover object is preserved verbatim in [ADR 0001](../../docs/adr/0001-architecture-and-native-graph-history.md).

Ordinary-runtime dependency allowances are empty except for Next's official `server-only` boundary marker. Other current third-party dependency entries are tooling-only:

- `@zmdb/migrations#./declarations` reaches `oxfmt` only through declaration emission; the query compiler and root, runner, and embedded migration entries do not; and
- `zmdb#./cli` and `bin:zmdb` reach `esbuild` and `oxfmt` for scaffolding, embedding and application loading.

`@zmdb/react`, `@zmdb/react-native`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, `@zmdb/solid`, `@zmdb/nuxt`, `@zmdb/sveltekit`, `@zmdb/otel`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`,
`@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, and `@zmdb/jobs-postgres` reach their required peers under §5.4, so they do not use an ordinary-runtime dependency allowance. `@zmdb/next` reaches
its required Next, React, and React DOM peers under the same rule; its sole ordinary-runtime allowance is `server-only@0.0.1`, the official executable server/client boundary marker loaded by
`./server`.

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

An optional peer must not also appear in `dependencies` or `optionalDependencies`. An optional workspace peer assigned to one tooling selector is governed here rather than becoming a canonical
package-DAG edge; all unassigned entries remain forbidden. An undeclared peer import is an ordinary undeclared-dependency violation, not an implicit new exemption.

A technology-selected catalog package in the `integration` zone or a compiler/build package in the `tooling` zone may instead declare one or more required peers. Required peers omit optional metadata,
are not listed in `optionalPeerEntries`, and may be reached by that package's assigned runtime or tooling exports. This is permitted only when the catalog optionality matches the package zone and a
packed fixture proves the peer range. Foundation, runtime, application and facade packages cannot make an external technology peer required.

## 6. Manifest metadata and release-policy handoff

Every catalog directory contains `package.json`, `README.md`, `LICENSE`, root `SPEC.md`, `tsconfig.json` and `tsconfig.build.json`. The manifest must satisfy all of these:

- `name` equals catalog `npmName`, and `repository.directory` equals both catalog and policy `directory`;
- `version` is valid SemVer and agrees with release policy: core versions are byte-identical, while integration and tooling versions are independently owned;
- `description` is non-empty; `keywords` is a sorted non-empty unique array containing `zmdb`;
- `homepage` is `https://github.com/ambasta/zmdb#readme`;
- `bugs.url` is `https://github.com/ambasta/zmdb/issues`;
- `license` is `GPL-3.0-or-later`, `author` is `zmdb contributors`, and `repository` is the canonical git URL plus directory;
- `type` is `module`; `sideEffects` is `false` or a sorted package-local allowlist of measured `./src/*.ts` side-effect files; and `engines.node` does not admit a version below 26;
- committed `files` is exactly `src`, `README.md`, `LICENSE`; the publish transform adds `dist`;
- `exports` is non-empty, explicit and wildcard-free; every committed target is a package-local existing `./src/*.ts` file;
- every `bin` target is package-local, exists, has a Node shebang and is named by a policy selector;
- `publishConfig.access` is `public`, and its channel agrees with that package's version;
- `scripts.build` invokes the canonical package build and `scripts.test` runs Vitest; and
- dependency, peer and dev-dependency sections are sorted and contain no duplicate ownership or stale entry; the optional package-specific `zmdb` extension, when present, is a sorted non-empty
  string-valued record.

Manifest range form is derived by joining architecture edges with release policy:

- a core-to-core production edge uses exactly `workspace:^`;
- an ordinary edge crossing release units uses `workspace:<explicit-range>`, where the suffix equals the matching release-policy compatibility range;
- an independently versioned integration or tooling package that imports core declares the core package as a peer at the explicit compatibility range and as a `workspace:^` development dependency for
  local qualification; and
- every third-party peer range, optionality flag, exact floor, tested-version set, and packed evidence case agrees with release policy.

The publish transform writes the exact common core version for same-core prerelease edges and `^<core-version>` for same-core stable edges. For a crossing edge it removes only the `workspace:`
protocol and preserves the explicit range. Published manifests omit development dependencies, point exports and bins at existing `dist` `.js`/`.d.ts` files, repoint any side-effect allowlist to `dist`
`.js`, and preserve package-owned metadata.

Architecture policy carries no release-group field. The complete group inventory, compatibility ranges, prerelease behavior, changelog identity, tag form, retry rules, and publication units are
normative in [`scripts/release/SPEC.md`](../release/SPEC.md) and executable through `scripts/release/policy.mjs` plus the snapshot-backed release model.

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

[`verify-architecture-zones.mjs`](../../.github/scripts/verify-architecture-zones.mjs) implements this boundary. It receives package resolution records from `loadGovernanceSnapshot({ root })`, starts
at every manifest export and executable, counts type-only imports, ignores import-shaped text inside comments and string/template literals, and follows relative modules only while they remain inside
the consumer package. `yarn verify:architecture-zones` is a thin focused wrapper over the same snapshot query used by `yarn verify:governance`.

### 7.2 `verify-runtime-reachability`

Inputs: policy entry selectors, export/bin targets, runtime-mode imports, emitted declaration references, manifests and peer metadata.

Violations: tooling leaks, peer leaks, undeclared packages, dev-only production imports, missing optional metadata and stale tooling/runtime/peer exemptions.

Remediation: move the import behind its assigned entry, split the integration/tooling package, declare and test the peer at the correct owner, or remove the stale exemption. Broadening an entry list
is valid only with a reviewed architecture-policy change and measured packed-consumer need.

[`verify-runtime-reachability.mjs`](../../.github/scripts/verify-runtime-reachability.mjs) implements this boundary. `yarn verify:runtime-reachability` runs the committed tree and nine self-test
mutations, and CI invokes that package script directly. `verify:exports` delegates policy checks to the same implementation; `verify:devtools-boundary` is a compatibility command rather than a second
ownership list.

### 7.3 `verify-package-metadata`

Inputs: catalog, architecture policy, release policy, committed manifests and required package files.

Violations: any missing, malformed, inconsistent or stale field; missing files; broken export/bin targets; wrong same-core or cross-unit range; core version drift; independent-package version
ownership drift; or incomplete peer-floor metadata.

Remediation: make the manifest agree with catalog, architecture, and release policy and regenerate it through the canonical metadata path. Never edit generated publish manifests as the source of
truth.

### 7.4 `verify-release-governance`

Inputs: read-only release plan, catalog membership, architecture DAG, release policy, selected release target, authoritative manifest versions and ranges, root changelog, lockfile, compatibility
cases, and optional triggering tag.

Violations: membership/order duplication or drift, unclassified packages, core version drift, unrelated independent-package movement, range/floor/evidence drift, absent or invalid target changelog
section, tag mismatch, invalid release-unit selection, and non-deterministic plans.

Remediation: prepare exactly one core or independent release target, repair its changelog section, regenerate the lockfile and compatibility cases, create the exact target tag, or consume the release
plan instead of a handwritten loop.

The checked-in `verify-release-governance.mjs` implements selected core or independent release units, validates release-policy projections, and rejects unrelated version movement. Issue #747 froze the
target failures before this implementation.

## 8. Stable diagnostic codes and exact remediation

| Code                          | Required measured subject                                        | Required remediation text/action                                                 |
| ----------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ARCH_POLICY_MISSING`         | catalog id and npm name with no row                              | add the row under that catalog id                                                |
| `ARCH_POLICY_STALE`           | row key absent from the catalog                                  | delete it or admit the package in the catalog in the same change                 |
| `ARCH_DIRECTORY_MISMATCH`     | catalog, policy and manifest directories                         | make all three equal to the real repository-relative directory                   |
| `ARCH_CYCLE`                  | complete shortest `a -> b -> ... -> a` cycle                     | remove or reverse an ownership edge; do not raise rings                          |
| `ARCH_EDGE_FORBIDDEN`         | consumer, dependency and source import                           | use an existing inward public contract or review manifest and policy together    |
| `ARCH_EDGE_UNDECLARED`        | import path with no production manifest edge                     | add the intended direct dependency and policy id, or remove the import           |
| `ARCH_EDGE_STALE`             | policy/manifest edge unused by production source                 | remove the stale edge from both authorities                                      |
| `ARCH_ZONE_DIRECTION`         | consumer and dependency zones                                    | move ownership inward or introduce an explicit lower-layer contract              |
| `ARCH_RING_INVALID`           | declared and calculated canonical ring                           | set the canonical ring after fixing all edges                                    |
| `ARCH_PRIVATE_IMPORT`         | full private cross-package import path                           | publish/use the owning package's public export                                   |
| `ARCH_TOOLING_LEAK`           | runtime entry and shortest path to the tooling sink              | move the sink behind a tooling entry or split the tool owner                     |
| `ARCH_PEER_LEAK`              | peer, unassigned entry and shortest path                         | route through an assigned integration entry or move it to an integration package |
| `ARCH_DEPENDENCY_UNDECLARED`  | external specifier and shortest import path                      | declare it at the correct manifest boundary or remove the import                 |
| `ARCH_EXEMPTION_STALE`        | unused runtime dependency, tooling selector or peer assignment   | remove the exemption                                                             |
| `PACKAGE_METADATA_INVALID`    | package, field and measured value                                | restore the exact schema value or required file                                  |
| `PACKAGE_PEER_METADATA`       | peer range/meta/dev-fixture mismatch                             | align the declaration and prove the range with the real peer                     |
| `PACKAGE_VERSION_DRIFT`       | distinct core versions and owning package ids                    | run one core-train bump; do not move an independent package                      |
| `PACKAGE_WORKSPACE_RANGE`     | package, dependency, release units and measured range            | use the same-core or explicit cross-unit range from release policy               |
| `RELEASE_GROUP_MISSING`       | public package and absent or duplicate release row               | classify the catalog id exactly once in release policy                           |
| `RELEASE_COMPATIBILITY_DRIFT` | package, dependency/peer, policy range, floor and manifest range | align the manifest with the measured compatibility policy                        |
| `RELEASE_EVIDENCE_MISSING`    | package, exact floor/current version and expected matrix case    | add a clean packed-consumer case for that exact version                          |
| `RELEASE_UNRELATED_CHANGE`    | selected release id and unrelated changed package/version        | restrict the plan to core or the one selected independent package                |
| `RELEASE_CHANGELOG_MISSING`   | release id, version and changelog path                           | add one non-empty exact release-unit section                                     |
| `RELEASE_CHANGELOG_FORMAT`    | malformed heading, category, ordering or bullet                  | restore the one-project changelog shape                                          |
| `RELEASE_CHANGELOG_OWNER`     | version and unknown release-note owner                           | use the owning catalog id or `product`                                           |
| `RELEASE_TAG_MISMATCH`        | triggering tag, release id and version                           | use `core-v<version>` or `<catalog-id>-v<version>` exactly                       |
| `RELEASE_MEMBERSHIP_DRIFT`    | missing, duplicate or handwritten release member                 | consume the product catalog                                                      |
| `RELEASE_ORDER_DRIFT`         | expected and measured publish order                              | consume the policy-derived topological order                                     |
| `RELEASE_EXISTING_MISMATCH`   | package/version and local versus registry integrity              | stop and investigate the immutable registry conflict                             |

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
  scripts/release/policy.mjs
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
- `rejects versions that differ across the core train`;
- `accepts an integration version change without moving unrelated core packages`;
- `rejects a peer range below its packed-consumer floor`;
- `rejects a publishable package missing from release policy`;
- `rejects an optional peer without optional metadata`;
- `rejects a release version absent from CHANGELOG.md`;
- `rejects a tag that disagrees with package versions`;
- `derives topological publish order from the package graph`; and
- `produces the same release plan twice`.

#725 retires the three expected failures for cycles, forbidden policy edges and workspace imports absent from the manifest, and adds executable stale-edge, non-canonical-ring and private-import
coverage. #726 retires the tooling- and optional-peer-reachability expected failures, adds executable stale-exemption coverage and wires the generic command into CI. #727 retires the
incomplete-metadata and lockstep-version expected failures and adds executable optional-peer metadata coverage. #728 retires the two original release expected failures and adds deterministic
whole-catalog release plans, rollback-safe bumps, and the original release CI command. #746 supersedes that release shape; #747 freezes the group, independent-version, and packed-floor failures, #749
implements the structural release model, and #750 completes packed compatibility qualification.

## 10. Explicit refusals

This architecture refuses:

- a second package-membership array or a manually maintained publish order;
- inferring policy from the current imports and thereby legalising a defect;
- an unclassified public package, duplicate release membership, or private package in public release policy;
- a core package version, changelog, or tag moving independently from the core train;
- an integration or tooling release that moves an unrelated package;
- an advertised compatibility range without exact packed floor and current-version evidence;
- a cycle hidden by dynamic import, type-only import, peer dependency or inflated ring;
- a private cross-package source import even when TypeScript path mapping resolves it;
- runtime access to TypeScript, esbuild, oxfmt, REPL/devtools or an unassigned optional peer;
- a broad package-root peer exemption when one integration entry is sufficient;
- optional peer metadata without real range/conformance evidence;
- fixture tests that read the live repository or pass because setup is missing;
- a verifier that writes, fetches registry state or silently skips unreadable inputs;
- changing `allowImportingTsExtensions` from `false`; and
- relative `.ts` source imports or a build-time declaration rewrite that compensates for them.

## 11. One composed governance model

`GovernanceSnapshot` is a read-only composition of independent authorities. It is not a new authority and must not absorb, infer or rewrite any of them.

| Governance fact                                            | Sole authority                                                                                    | Snapshot treatment                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Official package membership, npm identity and product role | `scripts/product/catalog.mjs`                                                                     | Validate and index each catalog row exactly once                                                 |
| Zones, rings, allowed edges and entry reachability policy  | `scripts/architecture/policy.mjs`                                                                 | Validate against catalog membership; never infer from observed imports                           |
| Published surfaces, declared dependencies and versions     | Each admitted package's `package.json`                                                            | Read below the supplied root and preserve the manifest's ownership                               |
| Release notes                                              | Root `CHANGELOG.md`                                                                               | Parse through the release model                                                                  |
| Release order and train membership projection              | Catalog membership plus the policy DAG, composed by `scripts/release/model.mjs`                   | Return the deterministic dependency-first projection                                             |
| Temporary accepted findings                                | Structured records in `scripts/architecture/exceptions.mjs`                                       | Validate ownership, scope, measured ceiling and removal condition before classifying any finding |
| Issue hierarchy, dependencies and state                    | Native GitHub parent/sub-issue and blocked-by relationships plus issue state supplied by a caller | Validate and index the supplied complete snapshot; never read labels or issue-body prose         |
| Generated architecture and documentation views             | The authorities above                                                                             | Rendered projection only; generated bytes can never be loaded as input                           |
| `blocked` labels and `(blocked by #…)` prose               | None                                                                                              | Temporary display projections only; omitted from the API and forbidden as actionability input    |

The model exposes exactly one public loading boundary:

```ts
export type IssueState = 'OPEN' | 'CLOSED';

export interface NativeIssue {
  readonly number: number;
  readonly state: IssueState;
  readonly parent: number | null;
  readonly subIssues: readonly number[];
  readonly blockedBy: readonly number[];
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly isSubIssue?: boolean;
}

export interface NativeRelationshipSnapshot {
  readonly repository: 'ambasta/zmdb';
  readonly capturedAt: string;
  readonly complete: true;
  readonly issues: readonly NativeIssue[];
}

export function readGitHubNativeRelationshipSnapshot(input: { readonly repository: 'ambasta/zmdb' }): Promise<NativeRelationshipSnapshot>;

export function computeActionability(snapshot: NativeRelationshipSnapshot): {
  readonly actionable: readonly number[];
  readonly blocked: readonly number[];
};

export function renderActionabilityReport(snapshot: NativeRelationshipSnapshot): string;

export interface GovernanceInput {
  readonly root: string;
  readonly relationships?: NativeRelationshipSnapshot;
}

export interface GovernancePackage {
  readonly id: string;
  readonly directory: string;
  readonly npmName: string;
  readonly catalog: ProductPackage;
  readonly policy: PackagePolicy;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface GovernanceRelease {
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly changelogEntry: string;
}

export interface GovernanceFinding {
  readonly id: string;
  readonly code: string;
  readonly scope: GovernanceScope;
  readonly message: string;
  readonly remediation: string;
  readonly disposition: 'active' | 'excepted';
  readonly exceptionId?: string;
}

export interface GovernanceSnapshot {
  readonly root: string;
  readonly packages: readonly GovernancePackage[];
  readonly packageGraph: ReadonlyMap<string, readonly string[]>;
  readonly release: GovernanceRelease;
  readonly exceptions: readonly GovernanceException[];
  readonly issues: ReadonlyMap<number, NativeIssue> | null;
  readonly findings: readonly GovernanceFinding[];
}

export function loadGovernanceSnapshot(input: GovernanceInput): Promise<GovernanceSnapshot>;
```

The executable aggregate entry point is `yarn verify:governance`. It loads this snapshot once, runs every domain query against the injected catalog, policy, and manifest records, prints all ordered
findings, and keeps the focused `verify:*` commands available as compatibility entry points.

Local-only consumers may omit `relationships`, in which case `issues` is `null`. Asking for issue actionability without a complete relationship snapshot is `GOV_RELATIONSHIPS_REQUIRED`; absence is
never interpreted as an empty graph or an unblocked issue. The network adapter is outside this pure boundary. It paginates the open issue collection, uses `sub_issues_summary.total` and
`issue_dependencies_summary.total_blocked_by` to read only relationship-bearing child and blocker endpoints, merges their complete rows before validation so closed referenced children and blockers
retain state and title, normalises the result to `NativeRelationshipSnapshot`, fails closed on any partial response or disagreement and then calls this loader. Recorded sources without those relevance
flags remain exhaustive so pagination fixtures exercise every endpoint.

The returned object, nested arrays, records and maps are deeply read-only. Module evaluation and snapshot construction perform no write, GitHub mutation, registry lookup, credential access or
subprocess launch. Filesystem and relationship inputs are explicit. Optional labels are display metadata and never affect actionability; issue bodies and rendered checklists are absent from the input
type.

### 11.1 Stable findings

A finding id is `<CODE>/<scope-kind>/<canonical-scope>`. It is derived from the rule and structured subject, not a message, array index, line number or traversal order. `canonical-scope` uses catalog
ids, manifest selectors, repository-relative POSIX paths, directed `consumer->dependency` edges or issue numbers as appropriate. Scope components are percent-encoded before joining, so the mapping is
unambiguous.

Findings sort by `code`, canonical scope and `id`. Existing diagnostic prose remains compatible, but prose is not identity. Focused commands may retain their current prefixes and summaries while
returning the same ordered finding ids as the aggregate model.

The package-script names `verify:product-catalog`, `verify:architecture-zones`, `verify:runtime-reachability`, `verify:package-metadata`, `verify:release-governance`, `verify:exports`,
`verify:devtools-boundary`, `verify:docs-generated`, `verify:build-budget` and `verify:publish` remain callable through #737. During that period they are thin compatibility entry points over the
snapshot or a domain-specific query that consumes it. Renaming or deleting one after #737 requires a separate issue and must not be bundled into graph consolidation.

## 12. Consumer ownership and migration inventory

The inventory below is exhaustive for the governance cleanup frozen by #732. A path can retain a domain-specific rule, but it must not retain a second package inventory, manifest loader, import graph,
release order, exception parser or actionability algorithm.

| Current consumer or helper                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Current role and required migration                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/architecture/index.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Current catalog/policy/manifest composition. #734 extends this boundary into `GovernanceSnapshot`; existing lookup and graph helpers become queries over that snapshot.                                                                                                                                                                                                                                                                     |
| `.github/scripts/verify-architecture-zones.mjs`, `.github/scripts/verify-runtime-reachability.mjs`, `.github/scripts/verify-package-metadata.mjs`                                                                                                                                                                                                                                                                                                                                    | Primary architecture verifiers. #734 removes their duplicate discovery and parsing while preserving every rule, CLI flag, exit code and finding.                                                                                                                                                                                                                                                                                            |
| `.github/scripts/verify-exports.mjs`, `.github/scripts/verify-devtools-boundary.mjs`, `.github/scripts/verify-config-contract.mjs`, `.github/scripts/verify-database-boundaries.mjs`, `.github/scripts/verify-http-client-boundary.mjs`, `.github/scripts/verify-operator-boundary.mjs`, `.github/scripts/verify-runtime-foundation.mjs`, `.github/scripts/verify-server-boundaries.mjs`, `.github/scripts/verify-tooling-boundaries.mjs`, `.github/scripts/verify-build-budget.mjs` | Specialised gates. Their domain assertions remain independent, but package identity, manifests, exports, ownership paths and shared import-graph facts come from the snapshot. Compatibility wrappers must not retain copied policy.                                                                                                                                                                                                        |
| `.github/scripts/verify-product-catalog.mjs`, `.github/scripts/verify-product-facade.mjs`, `packages/zmdb/src/product-surface.spec.ts`, `packages/zmdb/src/architecture-governance.spec.ts`, `packages/cli/src/cli-boundary.spec.ts`, `packages/zmdb/src/client-integrations/adapter-qualification.spec.ts`                                                                                                                                                                          | Catalog/facade verification and executable ownership evidence. They query catalog and snapshot facts; they do not recreate membership from `packages/*`.                                                                                                                                                                                                                                                                                    |
| `scripts/release/model.mjs`, `scripts/release/plan.mjs`, `scripts/release/bump.mjs`, `.github/scripts/verify-release-governance.mjs`                                                                                                                                                                                                                                                                                                                                                 | Release composition, planning, preparation and verification. #734 preserves the separate release authorities while replacing repeated architecture reads with the snapshot.                                                                                                                                                                                                                                                                 |
| `.github/scripts/lib/publish-manifest.mjs`, `.github/scripts/repoint-dist.mjs`, `.github/scripts/publish-package.mjs`, `.github/scripts/set-latest-tag.mjs`, `.github/scripts/verify-publish.mjs`, `.github/workflows/publish.yml`                                                                                                                                                                                                                                                   | Release consumers. They retain publication duties but consume snapshot-derived train membership, version and order. No path may add a package list or publish order.                                                                                                                                                                                                                                                                        |
| `docs-site/integrations.mjs`, `docs-site/generated.mjs`, `.github/scripts/verify-docs-generated.mjs`, `docs-site/generated-content.spec.ts`                                                                                                                                                                                                                                                                                                                                          | `integrations.mjs` remains the authored framework-support authority. The generator composes it with snapshot package/manifest facts; #734 moves governance reads to the snapshot and byte comparison remains read-only.                                                                                                                                                                                                                     |
| `ARCHITECTURE.md`, `docs-site/content/architecture.md`, `docs-site/content/package-reference.md`, `docs-site/content/framework-integrations.md`                                                                                                                                                                                                                                                                                                                                      | Generated or authored projections. They are outputs, never model inputs. Marker-owned regions remain byte-stable projections.                                                                                                                                                                                                                                                                                                               |
| `scripts/architecture/exceptions.mjs`, consumed through `GovernanceSnapshot.exceptions` by `.github/scripts/verify-database-boundaries.mjs`, `verify-runtime-foundation.mjs`, `verify-server-boundaries.mjs` and `verify-tooling-boundaries.mjs`                                                                                                                                                                                                                                     | #735 accounts for all 81 opaque entries at the exact `958a67ff` base: 0 database, 78 runtime-foundation, 0 server and 3 tooling records. #675 had already removed every database finding and #628 had removed every runtime tooling violation; the three opaque JSON baselines and the two now-empty/generated tooling violation sets are deleted after executable parity. `BASELINE_BIN_OWNERS` remains positive policy, not an exception. |
| `scripts/roadmap/check.mjs` and `scripts/roadmap/epics/*.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                        | Authored filing plan. `blockedBy` keys may remain as pre-filing input that is resolved into native links, but they are never post-filing issue state or actionability.                                                                                                                                                                                                                                                                      |
| `scripts/roadmap/file-issues.mjs` and `scripts/roadmap/render.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                   | Create native parent/blocked-by links and plain task checkboxes. They do not add a blocked label or render blocker suffixes.                                                                                                                                                                                                                                                                                                                |
| `zmdb-handover/tools/unblocked.mjs`, `unblocked2.mjs`, `close-sub.mjs`                                                                                                                                                                                                                                                                                                                                                                                                               | Operational helpers read the paginated native snapshot. Closing a child ticks only earned task rows and may close a completed native parent; it does not synchronize labels or blocker prose.                                                                                                                                                                                                                                               |
| Deleted `zmdb-handover/tools/sync-blocks.mjs`, `sync-labels.mjs`, `stale-blocks.mjs`                                                                                                                                                                                                                                                                                                                                                                                                 | No remaining consumer. They were projection authorities and are removed by #736 rather than retained as compatibility paths.                                                                                                                                                                                                                                                                                                                |
| `.github/scripts/file-web-epics.mjs`, `.github/scripts/file-umbrella-epic.mjs`, `.github/scripts/file-dx-epics.mjs`                                                                                                                                                                                                                                                                                                                                                                  | Archived compatibility paths that fail with a pointer to the canonical filer; they contain no GitHub writer and cannot recreate labels or blocker prose.                                                                                                                                                                                                                                                                                    |
| `zmdb-handover/HANDOVER.md`, `zmdb-handover/PROMPT.md` and any operator prompt that recommends a `blocked` label filter or body parser                                                                                                                                                                                                                                                                                                                                               | Operational documentation projections. #736 updates them in the same cutover so the deleted representation is not recreated manually.                                                                                                                                                                                                                                                                                                       |

`#733` freezes a parity test for every row above. `#734`, `#735` and `#736` perform the implementation migrations; #733 must not delete or rewrite a current consumer.

## 13. Structured exceptions

`scripts/architecture/exceptions.mjs` exports one deeply frozen, deterministically sorted `GOVERNANCE_EXCEPTIONS` array:

```ts
export type GovernanceScope =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'entry'; readonly packageId: string; readonly selector: string }
  | { readonly kind: 'edge'; readonly consumer: string; readonly dependency: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'issue'; readonly issue: number };

export interface GovernanceException {
  readonly id: `GEX-${string}`;
  readonly findingId: string;
  readonly scope: GovernanceScope;
  readonly rationale: string;
  readonly introduced: {
    readonly issue: number;
    readonly commit: string;
    readonly evidence: readonly string[];
  };
  readonly ownerIssue: number;
  readonly ceiling: {
    readonly metric: 'finding-count';
    readonly maximum: number;
  };
  readonly removeWhen:
    | { readonly kind: 'finding-absent' }
    | { readonly kind: 'count-at-most'; readonly maximum: number }
    | { readonly kind: 'path-absent'; readonly path: string }
    | { readonly kind: 'edge-absent'; readonly consumer: string; readonly dependency: string };
}
```

`id`, `findingId` plus canonical `scope`, and each evidence path are unique. Scopes use exact structured values; globs, regular expressions, prefixes and prose-only identities are invalid. Evidence is
repository-relative and must exist, except that a GitHub issue URL is represented by its numeric `introduced.issue` rather than copied text. `commit` is a full Git object id that contains the
introducing or first-measured evidence.

For each record the verifier computes the raw findings in its exact scope before applying the exception:

1. `ownerIssue` must exist and be open in a complete native relationship snapshot.
2. The raw count must be positive and exactly equal to `ceiling.maximum`.
3. A larger count is unaccepted new debt and fails with the new finding ids.
4. A smaller positive count fails with an instruction to lower the ceiling in the same change.
5. Zero findings or a true `removeWhen` condition fails with an instruction to delete the exception.
6. A closed owner with a live finding fails; reopening or changing the owner is an explicit governance decision, never automatic.
7. One raw finding can match at most one exception. An exception cannot suppress a different code, package, entry, edge or path.

Reports retain both raw and classified findings. An excepted finding is not erased; it is emitted with `disposition: 'excepted'` and its exception id. No exception changes package membership, policy,
release state or issue actionability.

The #735 implementation contains 81 live records with a total measured occurrence ceiling of 265: 0/0 database records/occurrences, 78/262 runtime-foundation, 0/0 server, and 3/3 tooling. Issue #675
had already removed every database finding, so its closed issue owns no live exception. Issue #628 had removed every runtime tooling violation before this migration; the three remaining generated
private-source findings are owned by #640 and #638. Every opaque entry present at the exact implementation base is therefore accounted for without recreating retired debt:

```bash
node scripts/architecture/exceptions.mjs --migration-report
```

The aggregate governance loader publishes this registry as `GovernanceSnapshot.exceptions`, runs the four specialised raw-finding queries with the snapshot's existing architecture records, and retains
all accepted findings as `disposition: 'excepted'`. Focused commands consume the same snapshot adapter without network access and remain responsible for raw scope/count parity. Routine
`yarn verify:governance` additionally requires `--relationships <path>` naming #734's complete native relationship snapshot; omission fails with `GOV_EXCEPTION_RELATIONSHIPS_REQUIRED`.
`scripts/roadmap/native-relationships.mjs --json` is the live read adapter used locally and by CI with read-only issue permission. The aggregate verifier reads owner states from
`GovernanceSnapshot.issues` and fails closed for missing or closed owners without itself fetching GitHub, rebuilding package or issue graphs, or accepting a checked-in owner-state copy as current
authority. The operational add/lower/remove procedure is documented in [`EXCEPTIONS.md`](./EXCEPTIONS.md).

## 14. Native issue relationship semantics

Only GitHub's native parent/sub-issue links, native direct blocked-by links and issue state determine tracker structure and actionability.

- `parent` expresses ownership, not dependency. A tracked sub-issue has exactly one native parent; an epic may have any number of native children.
- `subIssues` and child `parent` must agree. A missing issue, duplicate number, contradictory parent, omitted pagination page or one-sided relationship is an invalid snapshot.
- `blockedBy` contains direct blockers only. Cross-epic and multiple blockers are valid. Transitive edges are not copied into the direct set.
- An open issue is actionable exactly when every direct native blocker is closed. A closed issue is complete, not actionable. Parent state, issue number order, labels, milestones, assignees and body
  prose do not alter that result.
- A missing referenced blocker is an error, never presumed closed. A direct self-edge or any dependency cycle is an error; cycle diagnostics report the deterministic shortest cycle.
- Closing one blocker can change only issues that directly or transitively depend on that blocker through the native graph. The computation itself performs no mutation.
- Optional `title`, `labels` and `isSubIssue` metadata may be preserved for operator display and scoping, but changing labels or body prose produces zero change in the computed result. Repository
  writers do not emit blocker projections.

The generic read adapter paginates every collection exposed by an unscoped fixture source. The live GitHub source paginates open issues, then reads a parent/sub-issue collection only when
`sub_issues_summary.total > 0` and a blocked-by collection only when `issue_dependencies_summary.total_blocked_by > 0`. The total counter deliberately includes closed blockers so the native edge is
preserved after it stops blocking work. Endpoint rows are normalised and merged into the issue map before validation, so a just-closed child remains available to a parent-completion caller and closed
blockers remain explicit. It preserves issue numbers, states and optional display metadata, removes duplicate API rows only when their bytes agree, and rejects disagreement or an open referenced issue
missing from the top-level pagination. A fixture may contain recorded API responses, but production actionability never reads a checked-in snapshot as current GitHub state.

The dated native-graph audit and backfill measurements are preserved in [ADR 0001](../../docs/adr/0001-architecture-and-native-graph-history.md). Current actionability always comes from a fresh native
read through [native-relationships.mjs](../roadmap/native-relationships.mjs).

## 15. Current native workflow

The native relationship cutover is complete. Contributor operations use the [current native workflow](../../CONTRIBUTING.md#native-issue-workflow) and the semantics in §14. Labels, body suffixes,
checked-in snapshots and retired projection readers are not actionability authorities. The completed parity and removal checklist is preserved in
[ADR 0001](../../docs/adr/0001-architecture-and-native-graph-history.md).

## 16. Current contracts and ADR history

Normative requirements live in the nearest `SPEC.md`. `ARCHITECTURE.md` is the current system overview and hosts generated projections, but a generated table or summary cannot override its source
SPEC. ADRs preserve decisions and superseded evidence; they never define the current contract by themselves.

The [ADR index](../../docs/adr/index.md) links immutable records named `docs/adr/NNNN-short-title.md`. Every ADR has:

- `Status`: `accepted`, `superseded` or `rejected`;
- decision date and owning issue;
- context and the decision as made at that time;
- measured evidence, including source commit and former SPEC heading/anchor when text moved;
- consequences;
- `Current contract` links to the normative SPEC sections; and
- `Superseded by` links when status is `superseded`.

Migration of a historical SPEC section is lossless:

1. Identify sentences that describe a superseded design, migration sequence, dated baseline or reason for an old choice.
2. Move that material to one ADR while preserving issue, date, commit, measurements and the original heading.
3. Replace the old section with the present-tense current contract, rejection rules and one ADR link.
4. Keep every current public API, invariant, owner and failure rule in a SPEC even when an ADR explains why it exists.
5. Verify links and reject duplicated current inventories or requirements copied back into ADRs.

When an ADR and a current SPEC disagree, the SPEC governs; mark the ADR superseded and link its current replacement. Historical prose cannot reopen an exception, restore a removed label projection or
authorise a package/release edge. Review the moved text and its links as part of the documentation change; this boundary adds no separate audit gate.

## 17. Selected-capability installed graph (#753)

Product selection is catalog metadata; dependency legality remains architecture policy; the installed graph is resolved from packed manifests. No one source substitutes for the other two.

The section number intentionally follows the governance contract frozen in current §§11–16 by #732 and refined by #733/#736. The #753 policy follows those sections and does not duplicate or replace
them.

### 17.1 Successor policy rows

After #755/#756, these are the exact affected rows:

```ts
jobs: {
  directory: 'packages/jobs',
  zone: 'application',
  ring: 6,
  allowedWorkspaceDependencies: ['app'],
  allowedRuntimeDependencies: [],
  optionalPeerEntries: {},
  toolingEntries: [],
},
'jobs-sqlite': {
  directory: 'packages/jobs-sqlite',
  zone: 'integration',
  ring: 7,
  allowedWorkspaceDependencies: ['jobs', 'sqlite'],
  allowedRuntimeDependencies: [],
  optionalPeerEntries: {},
  toolingEntries: [],
},
'jobs-postgres': {
  directory: 'packages/jobs-postgres',
  zone: 'integration',
  ring: 7,
  allowedWorkspaceDependencies: ['jobs', 'postgres'],
  allowedRuntimeDependencies: [],
  optionalPeerEntries: {},
  toolingEntries: [],
},
```

The `zmdb` row retains its current default package edges and contains no jobs id. `jobs-sqlite` is admitted only when its manifest and product-catalog row land in the same implementation change.
`jobs-postgres` keeps required-peer handling under §5.4 for `pg@^8.23.0`; it does not put `pg` in `allowedRuntimeDependencies` or `optionalPeerEntries`. Release-group and compatibility fields are
absent from these successor architecture rows; `scripts/release/SPEC.md` and the #749 release-policy projection own them.

The following edges are forbidden regardless of ring arithmetic:

```text
zmdb -> jobs | jobs-sqlite | jobs-postgres
jobs -> sqlite | postgres | migrations | query-compiler | repository
jobs-sqlite -> postgres | jobs-postgres
jobs-postgres -> sqlite | jobs-sqlite
```

Runtime imports of `pg` from `jobs` or `jobs-sqlite`, a private workspace source import, and any provider import from a `zmdb` facade entry are equivalent violations.

### 17.2 Installed-closure algorithm

`verify-selection-graph` operates on packed tarballs installed in a fresh directory with no workspace links or inherited root `devDependencies`:

1. Read the journey root from the product catalog and install its tarball plus only the peer packages named by that fixture.
2. Starting at the installed root manifest, follow `dependencies` and `optionalDependencies` recursively by resolved package identity.
3. Follow a peer only when the clean consumer manifest declares it; record missing required peers separately.
4. Map installed official packages back to catalog rows by exact npm name. Classify non-catalog transitive packages as `private` unless reachability policy marks their owning entry development-only.
5. Compare every catalog package in the closure with its `optionality` record and compare every direct official edge with architecture policy.
6. Print sorted installed package names, direct edges, catalog closure, external closure, peers, and the shortest path for every forbidden package.

The verifier never accepts workspace `package.json` inspection as installed proof, never uses Yarn hoisting as an edge, never counts the root consumer package, and cleans tarballs, install state,
caches, and databases on both success and failure.

### 17.3 Exact budgets

The current app closure makes the target budgets:

| Journey                            |                        Direct official edges | Official installed closure | Required selection assertions                                                                 |
| ---------------------------------- | -------------------------------------------: | -------------------------: | --------------------------------------------------------------------------------------------- |
| default `zmdb`                     |                             manifest-derived |                         11 | no `capability: jobs`, no jobs provider, no `pg`                                              |
| portable `@zmdb/jobs`              |                                            1 |                          6 | exactly `jobs -> app`; no provider, external runtime dependency, optional dependency, or peer |
| `@zmdb/jobs-sqlite`                |                                            2 |                          9 | exactly one jobs provider; no PostgreSQL package or peer                                      |
| `@zmdb/jobs-postgres` before peers |                                            2 |                          9 | exactly one jobs provider; no SQLite jobs provider                                            |
| PostgreSQL consumer                | preceding closure plus explicit peer closure |           metadata-derived | consumer declares `pg@^8.23.0`; installed version satisfies it                                |

The official counts are review budgets frozen from metadata. The verifier also compares exact identities and paths, so replacing one forbidden package with another cannot pass by preserving a count.
External peer transitives are reported by name but are not a fixed count because the peer's own compatible release may change them.

### 17.4 Diagnostics and tests

Stable diagnostics are:

| Code                          | Meaning                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `SELECTION_DEFAULT_LEAK`      | selected jobs capability/provider is reachable from `zmdb`                                       |
| `SELECTION_PROVIDER_LEAK`     | portable jobs reaches any concrete provider or provider peer                                     |
| `SELECTION_PROVIDER_MISMATCH` | a provider does not point to its catalog capability owner or reaches another provider technology |
| `SELECTION_BUDGET_DRIFT`      | direct-edge or official-closure count differs from metadata                                      |
| `SELECTION_PEER_MISSING`      | a required provider peer is absent or outside its declared range                                 |
| `SELECTION_FACADE_FORBIDDEN`  | `zmdb/jobs*` exists or a default facade reaches jobs                                             |

Issue #754 freezes clean packed fixtures for default, jobs-only, SQLite jobs, and PostgreSQL jobs plus negative mutations for each diagnostic. A missing provider is proved by portable import success
followed by explicit queue/worker construction requiring a `JobStore`; it is not proved by manufacturing a module-resolution error inside core.
