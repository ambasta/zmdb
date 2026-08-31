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
- Packages are built to conventional ESM `.js` + `.d.ts` (tsup) and the manifests
  are repointed to `dist` before publish (see the build steps).

## One-time setup (you, on npmjs.com)

1. **Create the org** (once): `npm org create zmdb`.
2. **Configure a Trusted Publisher for each package.** On npmjs.com → your
   package → **Settings → Trusted Publisher → GitHub Actions**, enter:
   - **Organization or user:** `ambasta`
   - **Repository:** `zmdb`
   - **Workflow filename:** `publish.yml` _(filename only, with the extension)_
   - **Environment name:** _(leave blank)_
   - **Allowed actions:** `npm publish`

   > ⚠️ **First publish of a brand-new package name.** npm only lets you add a
   > Trusted Publisher to a package that **already exists**. For the very first
   > `1.0.0-alpha.0` of each new `@zmdb/*` name you must do **one** initial publish to
   > create the package, then attach the trusted publisher for all future
   > releases. Two options for that first publish:
   >
   > - **Locally, once, with your logged-in account** (you said you're logged in):
   >   ```bash
   >   for p in schema-core query-compiler aot-validator repository; do
   >     ( cd "packages/$p" && yarn build ); done
   >   node .github/scripts/repoint-dist.mjs
   >   for p in schema-core query-compiler aot-validator repository; do
   >     ( cd "packages/$p" && COREPACK_ENABLE_PROJECT_SPEC=0 npm publish --access public --tag alpha )
   >   done
   >   git checkout packages/*/package.json   # restore dev state
   >   ```
   >   (publish in that order so dependents resolve; you'll get a normal 2FA/OTP
   >   prompt — that's fine for a manual publish).
   > - **Or** temporarily use a short-lived token for just the first CI run, then
   >   switch to OIDC. The token path is discouraged, so prefer the manual first
   >   publish above.
   >
   > After each name exists once, add its Trusted Publisher and **all subsequent
   > releases go through OIDC with no token**.

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
  The workflow installs → tests → builds `dist` (dependency order) → repoints
  manifests → `npm publish` each via OIDC. No secrets involved.

## What ends up in each tarball

```
packages/<pkg>/dist/
  index.js        index.d.ts
  <subpath>.js    <subpath>.d.ts   # one pair per exports entry
README.md
LICENSE
```

`exports` map each subpath to `{ types, import }`; `files` is
`['dist','README.md','LICENSE']`; cross-package deps become the exact prerelease `1.0.0-alpha.0`
ranges (`aot-validator` → schema-core; `repository` → schema-core + query-compiler).

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

1. Bump the version in all four `packages/*/package.json` (and `VERSION` in
   `prepare-publish.mjs`), commit.
2. Tag and push:
   ```bash
   git tag v1.0.0-alpha.N && git push origin v1.0.0-alpha.N
   ```
   The `publish.yml` workflow builds → repoints → publishes each package via
   OIDC under the `alpha` tag, with automatic provenance. (A tag push always
   publishes; a manual `workflow_dispatch` defaults to a dry run.)

> **dist-tags policy (automated):** CI publishes each release under its _channel_
> tag derived from the version — `alpha` / `beta` / `rc`, or `latest` for a
> stable version. After publishing, `set-latest-tag.mjs` repoints **`latest`** to
> the highest-precedence published version: **stable > rc > beta > alpha** (and
> newest within a channel). So while only alphas exist, `latest` tracks the newest
> alpha; the moment a stable `1.0.0` is published, `latest` moves to it.
