# Publishing zmdb to npm (Trusted Publishing / OIDC)

> **Prerelease.** The prepared first beta is `1.0.0-beta.1`. The workflow publishes a version under `latest` when it becomes the highest policy-precedence release (`stable > rc > beta > alpha`);
> otherwise it uses its channel tag. Use an exact version for a deterministic prerelease install. Increment the beta number for subsequent beta releases.

The `@zmdb/*` packages publish from GitHub Actions using **Trusted Publishing (OIDC)** — **no npm token**. GitHub Actions proves its identity to npm with a short-lived OIDC credential, so there is no
long-lived secret to leak, rotate, or 2FA-bypass. Publishes from a public repo also get automatic **provenance**.

> **Do not create an automation token.** npm itself recommends Trusted Publishing over tokens for CI. There is no `NPM_TOKEN` secret in this setup.

## Release model

The release-group contract in [`scripts/release/SPEC.md`](./scripts/release/SPEC.md) defines one core train and independently versioned integration and tooling packages. The generated
[package reference](./docs-site/content/package-reference.md) lists every current package's release unit, supported internal ranges and external peers directly from the catalog and release policy.

### Authorities and release plan

The implementation has five sources with non-overlapping ownership:

1. `scripts/product/catalog.mjs` owns release membership and npm identity only.
2. Package manifests own dependency edges and therefore publish order.
3. `scripts/release/policy.mjs` owns release groups and compatibility promises.
4. `packages/*/package.json` are checked projections of versions and dependency ranges.
5. Root `CHANGELOG.md` owns release content.

No workflow, publish helper or documentation loop may maintain another package list or order. The read-only API is:

```ts
const architecture = await loadArchitecture(root);
const model = releaseModel(root, { architecture });
const plan = createReleasePlan(model, {
  kind: 'core',
  version: '1.0.0-alpha.5',
});
```

`packages` contains the eight core npm names or the one selected independent npm name. `publishOrder` contains the same selection exactly once in deterministic dependency-first order. `changelogEntry`
is the exact Markdown body of the matching `<release-id>@<version>` section. The model and plan are pure queries over the package manifests and release records and perform no write, network request,
registry lookup, build, tag or publish.

### Selecting versions and upgrading

Start an application with the product, for example `yarn add zmdb@1.0.0-beta.1`. Select an integration only when the application uses it. Independent versioning lets an integration release without
forcing a core release; it does not mean every integration version works with every core version. Its published peer and dependency ranges must admit the installed core and SDK versions.

Read the generated [package reference](./docs-site/content/package-reference.md) for membership and the [release policy](./scripts/release/policy.mjs) for these distinct promises:

| Field      | Meaning                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `range`    | Versions the package manager is allowed to install.                                                         |
| `floor`    | The exact lowest supported version that the installed consumer must exercise.                               |
| `tested`   | Explicit versions selected for consumer qualification; this is not a claim about the newest version on npm. |
| `evidence` | The owning consumer program or verifier for the compatibility promise.                                      |

For example, `@zmdb/ai-vercel` declares `ai` range `^7.0.93`, floor `7.0.93`, and tested input `7.0.93`. Framework-specific integration tests exercise the selected SDK version. A wider dependency
range alone is not evidence that its lower bound works. Historical pre-extraction versions in the AI specification are dated inputs, not current supported floors.

| Change                   | Application upgrade                                                                                           | Maintainer preparation                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Core release             | Upgrade `zmdb`; applications selecting core packages directly move those packages to the same core version.   | Run `bump.mjs core <version>` and publish the entire policy-selected core unit.                                                         |
| Integration-only release | Upgrade the selected integration while retaining core when its declared range still admits that core version. | Run `bump.mjs <catalog-id> <version>`; unrelated versions remain unchanged.                                                             |
| Peer-floor raise         | Upgrade the selected SDK to the new floor before selecting the integration release that requires it.          | Change its policy and manifest together, run the affected installed consumer and below-floor case, then release that integration.       |
| Prerelease               | Use exact prerelease versions, including selected integrations' admitted core versions.                       | Use an `alpha`, `beta` or `rc` version and the exact `<release-id>-v<version>` tag.                                                     |
| Removed API              | Update imports and configuration to the current public contract in the same application change.               | Record the removal and update consumers; do not retain deprecated overloads, aliases, forwarding packages or historical-format readers. |

The changelog parser accepts a `Deprecated` category for release communication. It does not authorize a second compatibility implementation. The current source and public exports remain the sole
supported contract.

### Inspecting and qualifying compatibility

These commands inspect the current release and planned consumer cases without publishing or executing the matrix:

```bash
node scripts/release/plan.mjs --json
node scripts/release/plan.mjs --publish-tsv
node --input-type=module -e 'import { releaseCompatibilityPlan } from "./.github/scripts/verify-release-compatibility.mjs"; console.log(releaseCompatibilityPlan().map(item => item.id).join("\n"))'
```

The release plan contains the selected npm names, version, changelog entry and dependency-ordered publication list. The compatibility plan names supported inputs, below-floor refusals, one independent
integration release and an incompatible core selection. It is a plan, not a passing test report.

Run `yarn verify:publish` to build the packages, install their tarballs in one temporary consumer, import their public entries and typecheck their declarations. Package-local integration tests
exercise framework and database behavior.

The combined smoke uses `--legacy-peer-deps` because independent frameworks declare conflicting optional TypeScript peer ranges. Framework-specific consumers check supported application
configurations.

## [Unreleased]

### Changed

- **product:** describe the pending user-visible change

## [core@1.0.0-alpha.5] - 2026-09-06

### Fixed

- **repository:** describe the released user-visible fix

````

`Unreleased` exists exactly once and precedes all versions. A released heading is exactly `## [<release-id>@<SemVer>] - <YYYY-MM-DD>`, appears once, and sections for each release id are newest first.
Allowed category headings are `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed` and `Security`; a release has at least one non-empty bullet owned by that release unit. `product` is also valid for
the core unit. The requested release id and version must have a non-empty section; an `Unreleased` section alone does not authorize publication.

### Release preparation, tag and publish order

Choose one release id and version. Use `core` for the cohesive train or an integration/tooling catalog id such as `angular`:

```bash
RELEASE_ID=core
RELEASE_VERSION=1.0.0-beta.2
RELEASE_TAG="$RELEASE_ID-v$RELEASE_VERSION"

node scripts/release/bump.mjs "$RELEASE_ID" "$RELEASE_VERSION"
yarn verify:publish
node scripts/release/plan.mjs --release "$RELEASE_ID" --version "$RELEASE_VERSION" --json
node scripts/release/plan.mjs --release "$RELEASE_ID" --version "$RELEASE_VERSION" --publish-tsv
````

The final release flow is:

1. Write and review non-empty `Unreleased` notes, set `RELEASE_ID` and `RELEASE_VERSION`, and run the commands above. The bump validates the transition, moves only notes owned by that unit under a
   dated heading, preserves unrelated notes under `Unreleased`, updates the selected package or eight core manifests atomically, and refreshes the lockfile. It does not create a commit or tag and does
   not publish.
2. Push the prepared commit and wait for its CI run to pass. A manual workflow dispatch builds real tarballs for inspection without publishing or changing source manifests.
3. After CI passes, create `<release-id>-v<version>` at the prepared commit:

   ```bash
   git tag "$RELEASE_ID-v$RELEASE_VERSION"
   git push origin "$RELEASE_ID-v$RELEASE_VERSION"
   ```

4. The publish workflow requires successful CI on that exact commit, recomputes the plan, rejects any tag/version/changelog disagreement, builds packages, and publishes in `publishOrder`.

A coordinated catalog release uses `v<version>` after every package and compatibility range has been prepared together. It requires a non-empty changelog section for every release unit. Use
`--tag v<version>` to inspect that combined plan, or select `all` in the manual workflow dispatch.

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
- Packages are built to conventional ESM `.js` + `.d.ts`. The publisher writes transformed manifests into disposable package staging, then packs those directories.
- CI owns the unit, packed-consumer and live database/broker checks. The publish workflow reuses successful CI for the tagged commit.

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
   > Run that first publish from the prepared commit after CI passes, while logged in to an npm account with permission for the package names. The publisher stages transformed manifests without
   > changing the source tree.
   >
   > ```bash
   > yarn install --immutable
   > yarn build
   > yarn verify:publish
   > RELEASE_VERSION=1.0.0-beta.1
   > RELEASE_TAG="v$RELEASE_VERSION"
   > node scripts/release/plan.mjs --tag "$RELEASE_TAG" --json > /tmp/zmdb-release-plan.json
   > node scripts/release/plan.mjs --tag "$RELEASE_TAG" --publish-tsv > /tmp/zmdb-publish-order.tsv
   > VER=$(node -e "const fs=require('node:fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" /tmp/zmdb-release-plan.json)
   >
   > while IFS=$'\t' read -r directory package_name; do
   >   node .github/scripts/publish-package.mjs \
   >     --directory "$directory" \
   >     --package "$package_name" \
   >     --version "$VER" \
   >     --tag beta \
   >     --pack-destination /tmp/zmdb-release-tarballs
   > done < /tmp/zmdb-publish-order.tsv
   > ```
   >
   > The order matches the package dependency graph. npm may ask for a normal two-factor authentication code. Once every name exists, configure its Trusted Publisher; later releases use OIDC and need
   > no npm token.

3. **(Recommended) Lock it down**: once trusted publishing works, in each package's **Settings → Publishing access** choose **“Require two-factor authentication and disallow tokens.”** Trusted
   publishing keeps working (it uses OIDC, not tokens).

## Releasing after trusted publishers are configured

Use the release-preparation commands above. In the Actions tab, _Publish @zmdb packages to npm_ → _Run workflow_ builds and packs the selected release, retaining real `.tgz` artifacts for inspection.
It does not publish. A pushed `<release-id>-v<version>` tag publishes that unit; `v<version>` publishes the coordinated catalog. The workflow uses the derived plan and OIDC; it embeds neither a
package inventory nor an npm token.

## What ends up in each tarball

```
packages/<pkg>/dist/            # mirrors src, one file at a time
  index.js  index.d.ts  index.js.map  index.d.ts.map
  <dir>/index.js  <dir>/index.d.ts   …
packages/<pkg>/src/             # the TypeScript both maps point at
README.md
LICENSE
```

`exports` selects emitted JavaScript and declarations, retaining declared framework conditions and the compiler Metro entry's synchronous `require` condition. Staging contains only `dist`, `src`,
`README.md`, `LICENSE`, the transformed manifest and `.npmignore`. The staged manifest omits the redundant `files` allowlist so npm applies the package ignore rules. Same-core workspace dependencies
become exact versions for prereleases; crossing ranges remain policy-owned. Package `.npmignore` files exclude specs, type tests, and `SPEC.md`.

## How the build works, and why not tsup

`scripts/build-package.mjs` runs `tsc -p tsconfig.build.json` without post-processing import specifiers. Sources already use NodeNext `.js` relative specifiers, so both emitted JavaScript and
declarations name the built files correctly while `allowImportingTsExtensions` remains `false`.

The project previously used tsup. Its declaration step relies on `rollup-plugin-dts`, which expects `ts.sys` and `ts.createProgram` from the `typescript` package. TypeScript 7 does not expose that
API, so declaration generation failed before reading a source file.

The direct `tsc` build also produces the mirrored layout expected by the publish manifest transform. The publish manifest can therefore derive every `dist` subpath from the committed source manifest
instead of maintaining a second entry-point table.

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
npm view @zmdb/schema version
npm view @zmdb/orm dependencies
# provenance badge should appear on the package page (public repo + public pkg)
```

## Troubleshooting (from npm's docs)

- **ENEEDAUTH / "Unable to authenticate"** → the Trusted Publisher's workflow filename must match `publish.yml` exactly (case-sensitive, with extension), the repo/owner must match, and
  `id-token: write` must be present.
- **repository.url mismatch** → publishing via OIDC requires `package.json` `repository.url` to match the GitHub repo exactly (it does here).
- Provenance is **not** generated for private repos (n/a — this repo is public).

> **dist-tag policy:** before publishing, CI compares the new version with those already on npm. If the new version has the highest precedence (stable > rc > beta > alpha), it is published under
> `latest`; otherwise it uses its channel tag. npm's OIDC permission covers `npm publish`, but not a later `npm dist-tag` command.
