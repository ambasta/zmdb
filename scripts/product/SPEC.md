# Product catalog — specification

The canonical module [catalog.mjs](./catalog.mjs) owns read-only product membership and presentation metadata. Consumers derive their inventories from that source under the rules below.

## 1. Authority and exclusions

The catalog is the sole authority for whether a workspace package is an official part of the zmdb product and how that package appears through the product facade. Directory enumeration, publish
scripts, docs, and fixtures may validate catalog rows against the repository, but they do not infer a second membership list.

The catalog does not contain or mutate:

- package versions or dependency ranges;
- changelog entries or release notes;
- npm tags or publication credentials;
- publish order or dependency-ring policy;
- release-group, compatibility, deprecation, or partial-release decisions.

Architecture policy owns dependency direction and publish order. The release-group and compatibility contract frozen by #746 is owned by `scripts/release/SPEC.md`; `scripts/release/policy.mjs`
attaches exactly one release row to each catalog id and rejects a missing or stale row. Issue #749 implements that authority and the target-scoped release model; packed compatibility qualification
remains owned by #750.

Issue #732's `GovernanceSnapshot` composes this catalog without absorbing it: package membership, npm identity, product role, facade ownership, optionality, docs ownership and consumer evidence remain
catalog facts, and no architecture, release, exception or issue-relationship consumer may recreate them.

## 2. Canonical record

Every row has exactly these product fields:

```ts
export interface ProductPackage {
  /** Stable catalog key, unique across time and independent of npm scope. */
  readonly id: string;
  /** Repository-relative package directory; it must contain package.json. */
  readonly directory: `packages/${string}`;
  /** Exact package.json name. */
  readonly npmName: string;
  /** Unique user-facing responsibility, such as schema, sql, validator, orm, web, or product. */
  readonly role: string;
  /** Exact root symbols and zmdb subpaths delegated to this package. */
  readonly facade: {
    readonly root: readonly string[];
    readonly subpaths: readonly `zmdb/${string}`[];
  };
  /** Whether one-install users always receive it or choose the technology explicitly. */
  readonly optionality: { readonly kind: 'required' } | { readonly kind: 'tooling' } | { readonly kind: 'integration'; readonly technology: string };
  /** Docs slug whose generated package section owns the role and install guidance. */
  readonly docsOwner: string;
  /** Packed external proof, or a machine-checked reason why no fixture is appropriate. */
  readonly consumer: { readonly fixture: `fixtures/${string}` } | { readonly reason: string };
}
```

`id`, `directory`, `npmName`, and `role` are unique. Root symbols and subpaths are globally unique across all `facade` records. Empty arrays are explicit: `facade: { root: [], subpaths: [] }` means an
official package has no direct facade exposure, not that its metadata was forgotten.

`optionality` describes the product journey, not npm's manifest syntax:

- `required` is part of the normal application journey. Generated installation guidance uses the one-product facade only when its current manifest actually installs that package; an independently
  landed package extraction is documented with its direct install until the facade dependency lands.
- `tooling` is product-owned but may only be reached through an explicit build/CLI/migration subpath or executable.
- `integration` is selected only when the consumer chooses that technology. Its external dependencies must remain confined to its assigned entry point.

The catalog is deeply read-only, deterministic, and import-side-effect free. It does not read the filesystem at module evaluation and exposes no mutator. Consumers that need manifest data receive the
repository root explicitly.

## 3. Current package membership

The [catalog](./catalog.mjs) accounts for every manifest-backed package exactly once. Publication derives its dependency-first sequence from [architecture policy](../architecture/policy.mjs); the
catalog owns membership rather than release order.

The rows in `catalog.mjs` assign `docsOwner` and `consumer`, so later package additions or renames are one catalog edit plus the consumers that verify it. A planned package is not catalogued until its
package manifest exists; roadmap names are not published facts.

The earlier measured table and admission history are preserved in [ADR 0004](../../docs/adr/0004-package-and-product-baselines.md). They are review evidence, not a second canonical membership list.

## 4. Required consumers

The following surfaces consume the catalog directly:

1. **Facade ownership verifier/generator** — checks every root symbol and `zmdb/*` subpath has exactly one owner, and that `packages/zmdb` delegates rather than implements it.
2. **Package reference generator** — emits role, install mode, facade exposure, docs link, and manifest-derived package name/version into `docs-site/content/package-reference.md`.
3. **Support/integration matrix generator** — combines catalog optionality with each integration's authoritative support record; it does not hand-copy package names.
4. **Packed-consumer inventory** — discovers each package's fixture or verifies its explicit no-fixture reason.
5. **Architecture policy** — `scripts/architecture/policy.mjs` attaches exactly one zone/ring policy row to each catalog member, while `scripts/architecture/index.mjs` rejects missing or stale rows
   without recreating membership.
6. **Release governance** — release policy attaches exactly one group and compatibility row to every catalog id. The release model reads catalog membership only; versions, changelog, tags,
   graph-derived order, ranges, compatibility evidence, and publish actions remain outside the catalog.

Generated consumers compare bytes in tests and write only when their explicit generation command is run. Verification is read-only and fails on drift.

## 5. Rejection rules

`verify-product-catalog` must reject:

- a package manifest under `packages/` with no row, or a row whose directory or manifest no longer exists;
- a name mismatch between `npmName` and `package.json`;
- duplicate `id`, `npmName`, `role`, root symbol, or facade subpath ownership;
- a facade export with no catalog owner or a catalog exposure missing from the actual facade;
- an empty/missing docs owner, or a docs owner absent from the page registry;
- a package with neither a real external fixture nor a non-empty reason;
- an integration marked `required`, or an optional external dependency reachable outside its assigned integration entry point;
- version, changelog, tag, publish-order, credential, or mutation fields in a catalog row;
- a handwritten product-package table in the facade docs, package reference, support matrix, or packed-consumer inventory.

## 6. Frozen tests

#619 uses these exact test titles:

- `derives every official package role and facade exposure from one product catalog`
- `rejects a facade export whose owning package or visibility is absent from the catalog`
- `rejects a package-reference or integration row that disagrees with the catalog`
- `assigns every official package an external consumer or an explicit catalog reason`

#622 adds implementation-level tests for stale rows, duplicate roles, generated bytes, fixture discovery, and the read-only release-governance seam.
