# Publishing zmdb to npm (Trusted Publishing / OIDC)

> **Prerelease.** The first releases are published as **`1.0.0-alpha.0`** under
> the **`alpha`** dist-tag (not `latest`), so `npm install @zmdb/x` won't pull a
> prerelease by default. Users opt in with `npm install @zmdb/x@alpha`. Bump the
> prerelease (`alpha.1`, `alpha.2`, … then `beta.0`, then `1.0.0`) as it matures.

The `@zmdb/*` packages publish from GitHub Actions using **Trusted Publishing
(OIDC)** — **no npm token**. GitHub Actions proves its identity to npm with a
short-lived OIDC credential, so there is no long-lived secret to leak, rotate, or
2FA-bypass. Publishes from a public repo also get automatic **provenance**.

> **Do not create an automation token.** npm itself recommends Trusted Publishing
> over tokens for CI. There is no `NPM_TOKEN` secret in this setup.

## Requirements (already handled in the workflow)

- **npm CLI ≥ 11.5.1** and **Node ≥ 22.14.0** — the workflow upgrades npm.
- **`permissions: id-token: write`** on the job — set.
- **GitHub-hosted runner** (`ubuntu-latest`) — OIDC does not work on self-hosted.
- **`registry-url: https://registry.npmjs.org`** on `setup-node` — set.
- **`package.json` `repository.url` must exactly match the GitHub repo** — it is
  `git+https://github.com/ambasta/zmdb.git` for every package.
- Packages are built to conventional ESM `.js` + `.d.ts` and the manifests are
  repointed to `dist` before publish (see the build steps).

## One-time setup (you, on npmjs.com)

1. **Create the org** (once): `npm org create zmdb`.
2. **Configure a Trusted Publisher for each package.** On npmjs.com → your
   package → **Settings → Trusted Publisher → GitHub Actions**, enter:
   - **Organization or user:** `ambasta`
   - **Repository:** `zmdb`
   - **Workflow filename:** `publish.yml` _(filename only, with the extension)_
   - **Environment name:** _(leave blank)_
   - **Allowed actions:** `npm publish`

   > [!IMPORTANT]
   > npm only lets you configure a Trusted Publisher after a package exists. A
   > new package therefore needs one manual publish before OIDC can take over.
   >
   > Run that first publish from a clean temporary worktree while logged in to
   > npm. `repoint-dist.mjs` rewrites the package manifests for publication, so a
   > disposable worktree keeps those changes away from normal development.
   >
   > ```bash
   > yarn install --immutable
   > yarn build
   > yarn verify:publish
   > node .github/scripts/repoint-dist.mjs
   >
   > for p in query-compiler schema-core aot-validator repository web zmdb; do
   >   ( cd "packages/$p" && COREPACK_ENABLE_PROJECT_SPEC=0 npm publish --access public --tag alpha )
   > done
   > ```
   >
   > The order matches the package dependency graph. npm may ask for a normal
   > two-factor authentication code. Once every name exists, configure its
   > Trusted Publisher; later releases use OIDC and need no npm token.

3. **(Recommended) Lock it down**: once trusted publishing works, in each
   package's **Settings → Publishing access** choose **“Require two-factor
   authentication and disallow tokens.”** Trusted publishing keeps working (it
   uses OIDC, not tokens).

## Releasing (after trusted publishers are configured)

- **Dry run** (recommended): Actions tab → _Publish @zmdb packages to npm_ → Run
  workflow → leave `dry_run = true`. Builds + `npm pack --dry-run` each package.
- **Real publish**: run with `dry_run = false`, or push a tag:
  ```bash
  git tag v1.0.0-alpha.0 && git push --tags
  ```
  The workflow installs → tests → builds `dist` (topological) → verifies the packed
  packages install and load → repoints manifests → `npm publish` each via OIDC. No
  secrets involved.

## What ends up in each tarball

```
packages/<pkg>/dist/            # mirrors src, one file at a time
  index.js  index.d.ts  index.js.map  index.d.ts.map
  <dir>/index.js  <dir>/index.d.ts   …
packages/<pkg>/src/             # the TypeScript both maps point at
README.md
LICENSE
```

`exports` maps each subpath to `{ types, import }`, and `files` contains `dist`,
`src`, `README.md`, and `LICENSE`. Workspace dependencies become exact version
ranges for prereleases. Package `.npmignore` files exclude specs, type tests, and
`SPEC.md`.

## How the build works, and why not tsup

`scripts/build-package.mjs` runs `tsc -p tsconfig.build.json` and rewrites the
`.ts` specifiers left in declaration output.

The project previously used tsup. Its declaration step relies on
`rollup-plugin-dts`, which expects `ts.sys` and `ts.createProgram` from the
`typescript` package. TypeScript 7 does not expose that API, so declaration
generation failed before reading a source file.

The direct `tsc` build also produces the mirrored layout expected by
`repoint-dist.mjs`. The publish manifest can therefore derive every `dist`
subpath from the committed source manifest instead of maintaining a second
entry-point table.

Two things about emit are not obvious:

- **`tsconfig.build.json` is a separate project from `tsconfig.json`.** The checking config
  resolves `@zmdb/*` to sibling _sources_, so an edit in one package is a compile error in
  its dependents straight away. Emit cannot use those paths: a sibling `.ts` reached that
  way becomes an input file outside `rootDir`, which is TS6059. So the build config points
  at the sibling's `dist/*.d.ts` instead — and `yarn build` has to be topological, which
  `workspaces foreach -A -t` gives it.
- **`exports` cannot stay on `./src/*.ts`.** It resolves and imports perfectly in the
  workspace, because `node_modules/@zmdb/*` is a symlink and Node follows the realpath out
  of `node_modules`. Installed for real it fails:
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The same goes for `bin`.
  `yarn verify:publish` is the gate for this: it packs, installs into a throwaway
  project, and imports and typechecks every published subpath from outside the repo.

## Verify after publish

```bash
npm view @zmdb/schema-core version
npm view @zmdb/repository dependencies
# provenance badge should appear on the package page (public repo + public pkg)
```

## Troubleshooting (from npm's docs)

- **ENEEDAUTH / "Unable to authenticate"** → the Trusted Publisher's workflow
  filename must match `publish.yml` exactly (case-sensitive, with extension), the
  repo/owner must match, and `id-token: write` must be present.
- **repository.url mismatch** → publishing via OIDC requires `package.json`
  `repository.url` to match the GitHub repo exactly (it does here).
- Provenance is **not** generated for private repos (n/a — this repo is public).

## Cutting a release (proven flow)

Future releases are fully automated via CI OIDC — no token, no manual build:

1. Bump the version in all six `packages/*/package.json` files (and `VERSION` in
   `prepare-publish.mjs`), commit.
2. Tag and push:
   ```bash
   git tag v1.0.0-alpha.N && git push origin v1.0.0-alpha.N
   ```
   The `publish.yml` workflow builds → verifies → repoints → publishes each package
   via OIDC under the `alpha` tag, with automatic provenance. (A tag push always
   publishes; a manual `workflow_dispatch` defaults to a dry run.)

> **dist-tag policy:** before publishing, CI compares the new version with those
> already on npm. If the new version has the highest precedence
> (stable > rc > beta > alpha), it is published under `latest`; otherwise it uses
> its channel tag. npm's OIDC permission covers `npm publish`, but not a later
> `npm dist-tag` command.
