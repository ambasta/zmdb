# Publishing zmdb to npm (Trusted Publishing / OIDC)

> **Prerelease.** The current train is `1.0.0-alpha.*`. The workflow publishes a version under `latest` when it becomes the highest policy-precedence release (`stable > rc > beta > alpha`); otherwise
> it uses its channel tag. Use an exact version for a deterministic prerelease install. Bump the prerelease (`alpha.1`, `alpha.2`, … then `beta.0`, then `1.0.0`) as it matures.

The `@zmdb/*` packages publish from GitHub Actions using **Trusted Publishing (OIDC)** — **no npm token**. GitHub Actions proves its identity to npm with a short-lived OIDC credential, so there is no
long-lived secret to leak, rotate, or 2FA-bypass. Publishes from a public repo also get automatic **provenance**.

> **Do not create an automation token.** npm itself recommends Trusted Publishing over tokens for CI. There is no `NPM_TOKEN` secret in this setup.

## Current executable release governance

Issue #749 implements the release-group contract frozen in [`scripts/release/SPEC.md`](./scripts/release/SPEC.md): eight core packages move as one cohesive unit, 28 integrations and two tooling
packages have independent versions, and every cross-unit or third-party compatibility range comes from one release-policy authority. Issue #750 still owns the complete packed compatibility-matrix
qualification; the structural policy, manifest projections, target plans, preparation, tags, and publish selection are executable now.

### Authorities and release plan

The implementation has five sources with non-overlapping ownership:

1. `scripts/product/catalog.mjs` owns release membership and npm identity only.
2. `scripts/architecture/policy.mjs` owns dependency constraints and therefore publish order.
3. `scripts/release/policy.mjs` owns release groups and compatibility promises.
4. `packages/*/package.json` are checked projections of versions and dependency ranges.
5. Root `CHANGELOG.md` owns release content.

No workflow, publish helper or documentation loop may maintain another package list or order. The read-only API is:

```ts
const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
if (snapshot.queries.release === null) throw new Error('governance snapshot has no release model');
const plan = createReleasePlan(snapshot.queries.release, {
  kind: 'core',
  version: '1.0.0-alpha.5',
});
```

`packages` contains the eight core npm names or the one selected independent npm name. `publishOrder` contains the same selection exactly once in deterministic dependency-first order. `changelogEntry`
is the exact Markdown body of the matching `<release-id>@<version>` section. The model and plan are pure queries over the validated snapshot and perform no write, network request, registry lookup,
build, tag or publish.

### Admit a package to the current train

Admission is atomic. A new publishable package is not official, policy-governed, or releasable until one change supplies all of these:

1. the package manifest, public exports, README, license and external-consumer evidence;
2. one product-catalog row with the package directory, npm name, role, optionality, docs owner and consumer proof;
3. one same-id architecture-policy row with the exact direct workspace dependencies, canonical ring, tooling selectors and optional-peer selectors;
4. one same-id release-policy row with the release group, every cross-unit range, and every external peer floor;
5. `workspace:^` for same-core edges, explicit release-policy ranges for crossing edges, and matching optional-peer metadata;
6. a root `CHANGELOG.md` bullet owned by that catalog id; and
7. regenerated catalog, architecture, and release-policy documentation.

Do not add the package to a publish loop, array, package-count sentence or copied graph. Regenerate and run the admission gates:

```bash
node docs-site/generated.mjs
yarn verify:governance
yarn verify:product-catalog
yarn verify:architecture-zones
yarn verify:runtime-reachability
yarn verify:package-metadata
yarn verify:release-governance
yarn verify:docs-generated
```

The current release plan admits the package automatically only after the catalog, architecture policy, release policy, and manifest agree. `yarn verify:architecture-zones` rejects missing, extra,
upward, cyclic, private or non-canonical edges; `yarn verify:runtime-reachability` rejects tooling and optional-peer leakage per public entry; and `yarn verify:package-metadata` rejects current
release/version/range drift.

### Current version and manifest rules

- The eight core packages share one valid SemVer version. Each integration and tooling package owns its independent version.
- Every committed dependency, optional dependency or peer dependency on another catalog package creates an architecture edge or selected optional-peer edge. Same-core dependencies use `workspace:^`;
  every crossing edge uses the explicit release-policy compatibility range and may use a development dependency only to qualify a required peer locally.
- The publish manifest replaces a same-core workspace range with the exact core version for a prerelease and `^<core version>` for a stable release. For a crossing edge it removes only the
  `workspace:` protocol and preserves the policy range.
- `publishConfig.access` is `public`. A prerelease channel is `alpha`, `beta` or `rc`; a stable release uses `latest`. The existing highest-precedence `latest` decision remains a publication concern,
  not a product-catalog field.
- The lockfile is regenerated after a bump and must agree with every committed workspace range before release governance passes.

### One project changelog

The repository has exactly one release changelog, `CHANGELOG.md`; catalog packages do not carry independent changelogs. Its machine-checkable shape is:

```md
# Changelog

## [Unreleased]

### Changed

- **product:** describe the pending user-visible change

## [core@1.0.0-alpha.5] - 2026-09-06

### Fixed

- **repository:** describe the released user-visible fix
```

`Unreleased` exists exactly once and precedes all versions. A released heading is exactly `## [<release-id>@<SemVer>] - <YYYY-MM-DD>`, appears once, and sections for each release id are newest first.
Allowed category headings are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`; a release has at least one non-empty bullet owned by that release unit. `product` is also valid for
the core unit. The requested release id and version must have a non-empty section; an `Unreleased` section alone does not authorize publication.

### Release preparation, tag and publish order

Choose one release id and version. Use `core` for the cohesive train or an integration/tooling catalog id such as `angular`:

```bash
RELEASE_ID=core
RELEASE_VERSION=1.0.0-alpha.5
RELEASE_TAG="$RELEASE_ID-v$RELEASE_VERSION"

node scripts/release/bump.mjs "$RELEASE_ID" "$RELEASE_VERSION"
yarn verify:governance
yarn verify:architecture-zones
yarn verify:runtime-reachability
yarn verify:package-metadata
yarn verify:release-governance
node .github/scripts/verify-release-governance.mjs --tag "$RELEASE_TAG"
yarn verify:publish
node scripts/release/plan.mjs --release "$RELEASE_ID" --version "$RELEASE_VERSION" --json
node scripts/release/plan.mjs --release "$RELEASE_ID" --version "$RELEASE_VERSION" --publish-tsv
```

The final release flow is:

1. Write and review non-empty `Unreleased` notes, set `RELEASE_ID` and `RELEASE_VERSION`, and run the commands above. The bump validates the transition, moves only notes owned by that unit under a
   dated heading, preserves unrelated notes under `Unreleased`, updates the selected package or eight core manifests atomically, and refreshes the lockfile. It does not create a commit or tag and does
   not publish.
2. Run the complete ordinary repository gate. A manual workflow dispatch is the publication dry run and is read-only outside its disposable package staging area.
3. Commit the selected release unit and create exactly `<release-id>-v<version>` at that commit:

   ```bash
   git tag "$RELEASE_ID-v$RELEASE_VERSION"
   git push origin "$RELEASE_ID-v$RELEASE_VERSION"
   ```

4. CI recomputes the plan, rejects any tag/version/changelog disagreement before build or packaging, verifies every package, and publishes in `publishOrder`.

Publication stops at the first failure. A retry uses the same tag and version, verifies the registry copy of any package already published in the interrupted unit, skips only a byte-identical existing
version, and resumes the remaining topological suffix. It never changes the selected unit. The release is complete only when every planned npm name reports the selected version.

### Exact release violations

Release verification reports every problem in deterministic package/path order and exits non-zero:

| Code                         | Violation                                                               | Required remediation                                                        |
| ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `RELEASE_CORE_VERSION_DRIFT` | Core manifests do not carry one version                                 | Run the core release bump; never move one core package alone                |
| `RELEASE_INTERNAL_RANGE`     | A same-core or crossing internal range disagrees with release policy    | Restore the policy-derived range and regenerate the publish manifest        |
| `RELEASE_PEER_FLOOR`         | A peer range, floor, tested set, or evidence path disagrees with policy | Correct the policy or manifest from measured packed-consumer evidence       |
| `RELEASE_CHANGELOG_MISSING`  | The selected release id and version have no non-empty changelog section | Move reviewed, unit-owned `Unreleased` notes into the exact release heading |
| `RELEASE_CHANGELOG_OWNER`    | A bullet is not owned by the selected release unit                      | Use an owner assigned to that unit; `product` is reserved for core          |
| `RELEASE_TAG_MISMATCH`       | A real-publish tag disagrees with `<release-id>-v<version>`             | Create the exact tag at the verified release commit                         |
| `RELEASE_MEMBERSHIP_DRIFT`   | A release consumer repeats or omits catalog membership                  | Read membership from the product catalog                                    |
| `RELEASE_ORDER_DRIFT`        | A publish consumer disagrees with the policy-derived topological order  | Consume the snapshot-backed release plan's `publishOrder`                   |
| `RELEASE_PARTIAL_TRAIN`      | A core plan selects fewer than all eight core packages                  | Prepare the complete core unit or one independent package                   |
| `RELEASE_EXISTING_MISMATCH`  | A retry finds the same version with different packed bytes              | Stop; investigate the immutable registry conflict rather than overwriting   |

## Requirements (already handled in the workflow)

- **npm CLI ≥ 11.5.1** and **Node ≥ 22.14.0** — the workflow upgrades npm.
- **`permissions: id-token: write`** on the job — set.
- **GitHub-hosted runner** (`ubuntu-latest`) — OIDC does not work on self-hosted.
- **`registry-url: https://registry.npmjs.org`** on `setup-node` — set.
- **`package.json` `repository.url` must exactly match the GitHub repo** — it is `git+https://github.com/ambasta/zmdb.git` for every package.
- Packages are built to conventional ESM `.js` + `.d.ts` and the manifests are repointed to `dist` before publish (see the build steps).
- The publish job provides PostgreSQL, NATS, RabbitMQ, Redis, and strict `utf8mb4` MySQL services. `yarn verify:server-integrations` requires the first four URLs, while `yarn verify:mysql-live`
  requires MySQL and runs the packed `@zmdb/mysql` consumer; neither lane may silently skip.

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
   > RELEASE_ID=angular
   > RELEASE_VERSION=1.0.0-alpha.5
   > RELEASE_TAG="$RELEASE_ID-v$RELEASE_VERSION"
   > node scripts/release/plan.mjs --tag "$RELEASE_TAG" --json > /tmp/zmdb-release-plan.json
   > node scripts/release/plan.mjs --tag "$RELEASE_TAG" --publish-tsv > /tmp/zmdb-publish-order.tsv
   > node .github/scripts/repoint-dist.mjs --tag "$RELEASE_TAG"
   > VER=$(node -e "const fs=require('node:fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" /tmp/zmdb-release-plan.json)
   >
   > while IFS=$'\t' read -r directory package_name; do
   >   node .github/scripts/publish-package.mjs \
   >     --directory "$directory" \
   >     --package "$package_name" \
   >     --version "$VER" \
   >     --tag alpha \
   >     --pack-destination /tmp/zmdb-release-tarballs
   > done < /tmp/zmdb-publish-order.tsv
   > ```
   >
   > The order matches the package dependency graph. npm may ask for a normal two-factor authentication code. Once every name exists, configure its Trusted Publisher; later releases use OIDC and need
   > no npm token.

3. **(Recommended) Lock it down**: once trusted publishing works, in each package's **Settings → Publishing access** choose **“Require two-factor authentication and disallow tokens.”** Trusted
   publishing keeps working (it uses OIDC, not tokens).

## Releasing after trusted publishers are configured

Use the release-preparation commands above. In the Actions tab, _Publish @zmdb packages to npm_ → _Run workflow_ is always a dry run: it builds, verifies, executes every optional server integration
and the packed MySQL vertical against their live peers, repoints only the disposable checkout and runs `npm pack --dry-run`. Only the exact pushed `<release-id>-v<version>` tag starts a real publish.
The workflow uses the derived plan and OIDC; it embeds neither a package inventory nor an npm token.

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
  instead. `yarn build` therefore consumes the canonical architecture and release dependency DAG through `scripts/build-workspaces.mjs`; manifest dependency sections are release-policy projections and
  are not a second authority for build order.
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

> **dist-tag policy:** before publishing, CI compares the new version with those already on npm. If the new version has the highest precedence (stable > rc > beta > alpha), it is published under
> `latest`; otherwise it uses its channel tag. npm's OIDC permission covers `npm publish`, but not a later `npm dist-tag` command.
