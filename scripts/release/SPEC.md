# Lockstep release governance

Status: implemented by issue #728.

This directory owns release planning and release preparation for the complete zmdb package train. It does not own package membership, npm identity, workspace dependency policy, package metadata,
registry state, tags, publication or release notes:

- `scripts/product/catalog.mjs` is the sole package-membership and npm-identity authority.
- `scripts/architecture/policy.mjs` is the sole workspace-edge and publish-order authority.
- catalog package manifests own the one committed train version and internal `workspace:^` declarations.
- root `CHANGELOG.md` is the sole release-note authority.

No release helper, workflow or documentation example may repeat the catalog package list or maintain a handwritten publish order.

## 1. Read-only release plan

`plan.mjs` exports exactly this public boundary:

```ts
export function releasePlan(root: string): {
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly changelogEntry: string;
};
```

The function:

1. loads exactly the catalog members below `root`;
2. requires one valid SemVer byte-identical across every catalog manifest;
3. returns `packages` as catalog npm names in catalog-id order;
4. derives `publishOrder` from the architecture-policy dependency graph by calling the canonical deterministic topological-order boundary, then maps those ids to npm names;
5. requires the current version to have one unique, non-empty root changelog section; and
6. returns that section's Markdown body byte-for-byte, excluding its version heading and surrounding blank lines.

The returned object and arrays are deeply read-only. Repeated calls against unchanged files are deeply equal and produce byte-identical JSON. Planning performs no write, network request, registry
lookup, build, tag, package, publication or environment mutation.

The command:

```bash
node scripts/release/plan.mjs --json
```

prints the public plan as one deterministic JSON document. `--publish-tsv` prints one `<repository-relative-directory>\t<npm-name>` row per `publishOrder` entry for shell consumers. The directory
lookup comes from the catalog; it is never inferred from an npm name.

## 2. One project changelog

The repository carries exactly one release changelog at `CHANGELOG.md`. Catalog package directories must not carry an independent `CHANGELOG.md`.

Its machine-checkable shape is:

```md
# Changelog

## [Unreleased]

### Changed

- **product:** describe the pending user-visible change

## [1.0.0-alpha.5] - 2026-09-06

### Fixed

- **repository:** describe the released user-visible fix
```

Rules:

- `# Changelog` is the sole level-one heading.
- `## [Unreleased]` exists exactly once and precedes every released section.
- a released heading is exactly `## [<SemVer>] - <YYYY-MM-DD>` and each version appears once;
- released sections are in descending SemVer order;
- allowed category headings are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`;
- a release section has at least one non-empty `- ` bullet below one of those categories;
- every bullet starts with `**<catalog-id>:**` or `**product:**`; and
- `Unreleased` may be empty only after a successful whole-train bump.

The current package version must have one non-empty released section before a release plan is valid. Pending `Unreleased` notes do not authorize publication.

## 3. Safe whole-train bump

The only supported preparation command is:

```bash
node scripts/release/bump.mjs <version>
```

It:

1. refuses an invalid SemVer, an unsupported prerelease channel, a version that is not greater than the current version, an existing changelog version, empty `Unreleased` notes or an invalid changelog
   owner/category;
2. computes the complete catalog file set before writing;
3. moves the exact non-empty `Unreleased` body under `## [<version>] - <UTC-date>`;
4. restores one empty `## [Unreleased]` section;
5. updates `version` and `publishConfig.tag` in every catalog manifest while preserving all other fields;
6. leaves committed internal workspace ranges as `workspace:^`;
7. runs `yarn install --mode=update-lockfile` at the supplied root; and
8. re-runs the read-only plan before reporting success.

The command never creates a commit or tag and never builds, packs, publishes or contacts npm. Manifest and changelog writes are atomic per file. If any write, Yarn invocation or final validation
fails, every touched manifest, `CHANGELOG.md` and `yarn.lock` is restored byte-for-byte before the command exits non-zero.

## 4. Release verification

`.github/scripts/verify-release-governance.mjs` validates the plan and all release consumers. Diagnostics are sorted and use these stable codes:

| Code                        | Violation                                                           |
| --------------------------- | ------------------------------------------------------------------- |
| `RELEASE_VERSION_DRIFT`     | catalog manifests do not carry one valid version                    |
| `RELEASE_CHANGELOG_MISSING` | the common version lacks one unique non-empty changelog section     |
| `RELEASE_CHANGELOG_OWNER`   | a release bullet names neither a catalog id nor `product`           |
| `RELEASE_CHANGELOG_FORMAT`  | changelog headings, categories, order or bullets violate this SPEC  |
| `RELEASE_TAG_MISMATCH`      | a real-publish tag is not exactly `v<common-version>`               |
| `RELEASE_MEMBERSHIP_DRIFT`  | a release consumer repeats, omits or invents catalog membership     |
| `RELEASE_ORDER_DRIFT`       | a release consumer disagrees with policy-derived topological order  |
| `RELEASE_PARTIAL_TRAIN`     | a workflow or helper selects only part of the lockstep train        |
| `RELEASE_WORKSPACE_RANGE`   | a committed or publish-time internal range is not the required form |
| `RELEASE_EXISTING_MISMATCH` | a retry finds the same version with different packed bytes          |

Without a tag, the verifier checks the complete local plan and release consumers. `--tag vX.Y.Z` additionally enforces the exact tag/version match. A real publish workflow must pass its triggering
tag; a manual dry run must not invent one.

The verifier also proves that:

- publish-manifest generation, packed-install verification, dist repointing, dist-tag maintenance and the publish workflow consume catalog-derived records;
- the workflow consumes the plan's topological TSV rather than a shell package list;
- every plan member appears exactly once in both `packages` and `publishOrder`; and
- package manifests written for publication use the common plan version when replacing `workspace:^`.

## 5. Publish workflow

Manual workflow dispatch is dry-run only. A real publish is triggered only by an exact `v*` tag and stops before build or packaging if release governance fails.

The workflow:

1. verifies tag, version, changelog, membership and order;
2. builds in architecture-compatible topological order;
3. runs packed external installation and import/type conformance;
4. repoints manifests only in the checked-out CI working tree;
5. iterates `node scripts/release/plan.mjs --publish-tsv`;
6. runs `npm pack --dry-run` for manual dispatch or compares local and registry integrity before publishing or skipping each exact version; and
7. stops at the first failed package.

Dry-run publication does not mutate source files outside the disposable CI/repoint stage and does not mutate npm, GitHub, tags or package versions.

## 6. Executable contract

The implementation keeps these exact test titles:

- `rejects a release version absent from CHANGELOG.md`;
- `rejects a tag that disagrees with package versions`;
- `derives topological publish order from the package graph`; and
- `produces the same release plan twice`.

Additional executable tests cover valid planning, changelog ownership and ordering, whole-train bump success, Yarn failure rollback, generated publish membership and workflow consumption.
`yarn verify:release-governance` runs the live verifier and its mutation self-tests; `yarn verify:publish` remains the packed-consumer proof.
