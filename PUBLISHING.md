# Publishing zmdb to npm (Trusted Publishing / OIDC)

> **Prerelease.** The current train is `1.0.0-alpha.*`. The workflow publishes a version under `latest` when it becomes the highest policy-precedence release (`stable > rc > beta > alpha`); otherwise
> it uses its channel tag. Use an exact version for a deterministic prerelease install. Bump the prerelease (`alpha.1`, `alpha.2`, … then `beta.0`, then `1.0.0`) as it matures.

The `@zmdb/*` packages publish from GitHub Actions using **Trusted Publishing (OIDC)** — **no npm token**. GitHub Actions proves its identity to npm with a short-lived OIDC credential, so there is no
long-lived secret to leak, rotate, or 2FA-bypass. Publishes from a public repo also get automatic **provenance**.

> **Do not create an automation token.** npm itself recommends Trusted Publishing over tokens for CI. There is no `NPM_TOKEN` secret in this setup.

## Frozen lockstep governance target (#722)

This section is the normative target for epic #721. The current workflow still repeats twenty-eight package names in release scripts and has no root `CHANGELOG.md` or release-plan module; #728
implements this contract and removes those repetitions.

### Authorities and release plan

Four sources have non-overlapping ownership:

1. `scripts/product/catalog.mjs` owns release membership and npm identity only.
2. `scripts/architecture/policy.mjs` owns dependency constraints and therefore publish order.
3. `packages/*/package.json` own the one current version and committed dependency ranges.
4. Root `CHANGELOG.md` owns release content.

No workflow, publish helper or documentation loop may maintain another package list or order. The read-only API is:

```ts
export function releasePlan(root: string): {
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly changelogEntry: string;
};
```

`packages` contains every catalog npm name in catalog-id order. `publishOrder` contains the same names exactly once in deterministic topological order, with dependencies before consumers and catalog
id as the tie-breaker. `changelogEntry` is the exact Markdown body of the matching version section. The function performs no write, network request, registry lookup, build, tag or publish.

### Lockstep version and manifest rules

- Every catalog package has one identical valid SemVer version. Independent package versions, partial trains and compatibility exceptions are refused.
- Every committed dependency, optional dependency or peer dependency on another catalog package creates a policy edge. Committed `dependencies` and `optionalDependencies` use exactly `workspace:^`; a
  production import cannot rely on a dev dependency.
- The publish manifest replaces a workspace range with the exact common version for a prerelease and `^<common version>` for a stable release. It never derives the version from one arbitrarily
  selected package.
- `publishConfig.access` is `public`. A prerelease channel is `alpha`, `beta` or `rc`; a stable release uses `latest`. The existing highest-precedence `latest` decision remains a publication concern,
  not a product-catalog field.
- The lockfile is regenerated after a bump and must agree with every committed workspace range before a release plan is valid.

### One project changelog

The repository has exactly one release changelog, `CHANGELOG.md`; catalog packages do not carry independent changelogs. Its machine-checkable shape is:

```md
# Changelog

## [Unreleased]

### Changed

- **product:** describe the pending user-visible change

## [1.0.0-alpha.5] - 2026-09-05

### Fixed

- **repository:** describe the released user-visible fix
```

`Unreleased` exists exactly once and precedes all versions. A released heading is exactly `## [<SemVer>] - <YYYY-MM-DD>`, appears once, and version sections are newest first. Allowed category headings
are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`; a release has at least one non-empty bullet under one of them. A bullet begins with a catalog id or `product` in bold, so a
package rename is checked against the catalog while cross-cutting work has one explicit owner. The version requested for publication must have a non-empty section; an `Unreleased` section alone does
not authorize publication.

### Release preparation, tag and publish order

The final release flow is:

1. Write and review non-empty `Unreleased` notes.
2. Run `node scripts/release/bump.mjs <version>`. It validates the version transition, moves the pending notes under a dated version heading, restores an empty `Unreleased` section, updates every
   catalog manifest atomically and runs Yarn to update the lockfile. It does not create a commit or tag and does not publish.
3. Run all architecture, metadata, release and packed-publication gates. A dry run is read-only outside its temporary package staging area.
4. Commit the complete train and create exactly `v<version>` at that commit. A real publish is tag-triggered; manual dispatch remains dry-run only.
5. Recompute the release plan in CI, reject any tag/version/changelog disagreement, build and verify every package, then publish in `publishOrder`.

Publication stops at the first failure. A retry uses the same tag and version, verifies the registry copy of any package already published in the interrupted train, skips only a byte-identical
existing version, and resumes the remaining topological suffix. It never bumps or retags a subset. The train is complete only when every planned npm name reports the common version.

### Exact release violations

Release verification reports every problem in deterministic package/path order and exits non-zero:

| Code                        | Violation                                                              | Required remediation                                                              |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `RELEASE_VERSION_DRIFT`     | Catalog manifests do not carry one version                             | Run the release bump for the whole train; never edit one package alone            |
| `RELEASE_WORKSPACE_RANGE`   | A committed or publish-time internal range has the wrong form          | Restore `workspace:^`, or regenerate the publish manifest from the common version |
| `RELEASE_CHANGELOG_MISSING` | The common version has no unique non-empty root changelog section      | Move reviewed `Unreleased` notes into the exact version heading                   |
| `RELEASE_CHANGELOG_OWNER`   | A bullet names neither a catalog id nor `product`                      | Use the owning catalog id or the explicit cross-cutting owner                     |
| `RELEASE_TAG_MISMATCH`      | A real-publish tag is not exactly `v<common version>`                  | Create the exact tag at the verified release commit                               |
| `RELEASE_MEMBERSHIP_DRIFT`  | A release consumer repeats or omits catalog membership                 | Read membership from the product catalog                                          |
| `RELEASE_ORDER_DRIFT`       | A publish consumer disagrees with the policy-derived topological order | Consume `releasePlan(root).publishOrder`                                          |
| `RELEASE_PARTIAL_TRAIN`     | A plan, tag or retry selects only part of the catalog                  | Resume or prepare the complete lockstep train                                     |
| `RELEASE_EXISTING_MISMATCH` | A retry finds the same version with different packed bytes             | Stop; investigate the immutable registry conflict rather than overwriting         |

## Requirements (already handled in the workflow)

- **npm CLI ≥ 11.5.1** and **Node ≥ 22.14.0** — the workflow upgrades npm.
- **`permissions: id-token: write`** on the job — set.
- **GitHub-hosted runner** (`ubuntu-latest`) — OIDC does not work on self-hosted.
- **`registry-url: https://registry.npmjs.org`** on `setup-node` — set.
- **`package.json` `repository.url` must exactly match the GitHub repo** — it is `git+https://github.com/ambasta/zmdb.git` for every package.
- Packages are built to conventional ESM `.js` + `.d.ts` and the manifests are repointed to `dist` before publish (see the build steps).
- The publish job provides PostgreSQL, NATS, RabbitMQ, and Redis services. `yarn verify:server-integrations` requires all four URLs and fails the release if any installed optional integration skips or
  cannot execute its public API.

## One-time setup (you, on npmjs.com)

1. **Create the org** (once): `npm org create zmdb`.
2. **Configure a Trusted Publisher for each package.** On npmjs.com → your package → **Settings → Trusted Publisher → GitHub Actions**, enter:
   - **Organization or user:** `ambasta`
   - **Repository:** `zmdb`
   - **Workflow filename:** `publish.yml` _(filename only, with the extension)_
   - **Environment name:** _(leave blank)_
   - **Allowed actions:** `npm publish`

   > [!IMPORTANT] npm only lets you configure a Trusted Publisher after a package exists. A new package therefore needs one manual publish before OIDC can take over.
   >
   > Run that first publish from a clean temporary worktree while logged in to npm. `repoint-dist.mjs` rewrites the package manifests for publication, so a disposable worktree keeps those changes away
   > from normal development.
   >
   > ```bash
   > yarn install --immutable
   > yarn build
   > yarn verify:publish
   > node .github/scripts/repoint-dist.mjs
   >
   > packages=(
   >   client react angular vue svelte next query-compiler schema-core ai ai-anthropic ai-langchain ai-vercel
   >   mcp protobuf aot-validator repository sqlite app jobs jobs-postgres otel transport-grpc transport-nats transport-rabbitmq transport-redis web zmdb
   > )
   > for p in "${packages[@]}"; do
   >   (cd "packages/$p" && COREPACK_ENABLE_PROJECT_SPEC=0 npm publish --access public --tag alpha)
   > done
   > ```
   >
   > The order matches the package dependency graph. npm may ask for a normal two-factor authentication code. Once every name exists, configure its Trusted Publisher; later releases use OIDC and need
   > no npm token.

3. **(Recommended) Lock it down**: once trusted publishing works, in each package's **Settings → Publishing access** choose **“Require two-factor authentication and disallow tokens.”** Trusted
   publishing keeps working (it uses OIDC, not tokens).

## Releasing (after trusted publishers are configured)

- **Dry run** (recommended): Actions tab → _Publish @zmdb packages to npm_ → Run workflow → leave `dry_run = true`. Builds, installs and executes every optional server integration against its live
  peer, then runs `npm pack --dry-run` for each package.
- **Real publish**: run with `dry_run = false`, or push a tag:
  ```bash
  git tag v1.0.0-alpha.0 && git push --tags
  ```
  The workflow installs → tests → builds `dist` (topological) → verifies the packed packages install and load → executes the seven installed optional server consumers against their required peers →
  repoints manifests → `npm publish` each via OIDC. No secrets involved.

## What ends up in each tarball

```
packages/<pkg>/dist/            # mirrors src, one file at a time
  index.js  index.d.ts  index.js.map  index.d.ts.map
  <dir>/index.js  <dir>/index.d.ts   …
packages/<pkg>/src/             # the TypeScript both maps point at
README.md
LICENSE
```

`exports` maps each subpath to `{ types, import }`, and `files` contains `dist`, `src`, `README.md`, and `LICENSE`. Workspace dependencies become exact version ranges for prereleases. Package
`.npmignore` files exclude specs, type tests, and `SPEC.md`.

## How the build works, and why not tsup

`scripts/build-package.mjs` runs `tsc -p tsconfig.build.json` without post-processing import specifiers. Sources already use NodeNext `.js` relative specifiers, so both emitted JavaScript and
declarations name the built files correctly while `allowImportingTsExtensions` remains `false`.

The project previously used tsup. Its declaration step relies on `rollup-plugin-dts`, which expects `ts.sys` and `ts.createProgram` from the `typescript` package. TypeScript 7 does not expose that
API, so declaration generation failed before reading a source file.

The direct `tsc` build also produces the mirrored layout expected by `repoint-dist.mjs`. The publish manifest can therefore derive every `dist` subpath from the committed source manifest instead of
maintaining a second entry-point table.

Two things about emit are not obvious:

- **`tsconfig.build.json` is a separate project from `tsconfig.json`.** The checking config resolves `@zmdb/*` to sibling _sources_, so an edit in one package is a compile error in its dependents
  straight away. Emit cannot use those paths: a sibling `.ts` reached that way becomes an input file outside `rootDir`, which is TS6059. So the build config points at the sibling's `dist/*.d.ts`
  instead — and `yarn build` has to be topological, which `workspaces foreach -A -t` gives it.
- **`exports` cannot stay on `./src/*.ts`.** It resolves and imports perfectly in the workspace, because `node_modules/@zmdb/*` is a symlink and Node follows the realpath out of `node_modules`.
  Installed for real it fails: `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The same goes for `bin`. `yarn verify:publish` is the gate for this: it packs, installs into a throwaway project, and
  imports and typechecks every published subpath from outside the repo.

## Verify after publish

```bash
npm view @zmdb/schema-core version
npm view @zmdb/repository dependencies
# provenance badge should appear on the package page (public repo + public pkg)
```

## Troubleshooting (from npm's docs)

- **ENEEDAUTH / "Unable to authenticate"** → the Trusted Publisher's workflow filename must match `publish.yml` exactly (case-sensitive, with extension), the repo/owner must match, and
  `id-token: write` must be present.
- **repository.url mismatch** → publishing via OIDC requires `package.json` `repository.url` to match the GitHub repo exactly (it does here).
- Provenance is **not** generated for private repos (n/a — this repo is public).

## Cutting a release (current flow; superseded by #728)

Future releases are fully automated via CI OIDC — no token, no manual build:

1. Bump the version in all twenty-eight published `packages/*/package.json` files (and `VERSION` in `prepare-publish.mjs`), commit.
2. Tag and push:
   ```bash
   git tag v1.0.0-alpha.N && git push origin v1.0.0-alpha.N
   ```
   The `publish.yml` workflow builds → verifies → repoints → publishes each package via OIDC under the `alpha` tag, with automatic provenance. (A tag push always publishes; a manual
   `workflow_dispatch` defaults to a dry run.)

> **dist-tag policy:** before publishing, CI compares the new version with those already on npm. If the new version has the highest precedence (stable > rc > beta > alpha), it is published under
> `latest`; otherwise it uses its channel tag. npm's OIDC permission covers `npm publish`, but not a later `npm dist-tag` command.
