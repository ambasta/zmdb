# Publishing zmdb to npm

This document is the exact runbook for **reserving** or **publishing** the
`@zmdb/*` package names on npm. The package metadata is already publish-ready
(`.github/scripts/prepare-publish.mjs` set version, description, license,
repository, `publishConfig.access=public`, per-package README + LICENSE +
`.npmignore`). What remains **requires your npm identity and cannot be done from
the build environment.**

## Current status (checked against the registry)

| name | availability |
|------|--------------|
| `@zmdb/schema-core` | ✅ available (unregistered) |
| `@zmdb/query-compiler` | ✅ available |
| `@zmdb/aot-validator` | ✅ available |
| `@zmdb/repository` | ✅ available |
| `zmdb` (unscoped) | ✅ available |
| `@zmdb` org/scope | ❌ does not exist yet — must be created |

## What you must provide

1. **An npm account** with **2FA enabled** (recommended for publishing).
2. **The `@zmdb` scope.** Scoped names require you to own the scope:
   - Create a **free org**: `npm org create zmdb` (then the scope is `@zmdb`), **or**
   - Publish under your **user scope** instead (`@your-username/*`) — if so, tell me
     and I'll rename the packages.
3. **Authentication** for the publish step, one of:
   - **Interactive**: run `npm login` yourself, then publish (you'll enter an OTP), **or**
   - **Automation token** (CI-friendly, no OTP prompt): npmjs.com → *Access Tokens*
     → *Generate* → **Automation** (or Granular with publish scope). Put it in
     `~/.npmrc` locally or as a GitHub Actions secret `NPM_TOKEN`.

## Caveat: what actually ships today

The packages export raw **`./src/*.ts`** (TypeScript 7, ESM-only) with **no build
step**. Consumers therefore need a TS7/ESM toolchain — this is fine for the
zmdb monorepo's own use but is not a conventional `dist/.js + .d.ts` package.

Choose one:

- **(A) Reserve / block the names now** — publish the current `0.1.0` (or a
  `0.0.1` placeholder) so nobody else can take them. Fastest path to secure the
  names; iterate on a real build later.
- **(B) Full, conventional package** — add a compile step that emits `dist/*.js`
  + `*.d.ts` and repoint `exports`/`files` at `dist`. More work; ask me and I'll
  wire up the build (tsc/tsup) + update the metadata.

## Path A — reserve the names (manual, ~2 min)

```bash
# 1. one-time: create the scope/org and log in
npm org create zmdb            # skip if the @zmdb org already exists
npm login                      # or configure an automation token in ~/.npmrc

# 2. publish each package (public scoped). Run from the repo root.
npm publish -w @zmdb/schema-core   --access public
npm publish -w @zmdb/query-compiler --access public
npm publish -w @zmdb/aot-validator  --access public
npm publish -w @zmdb/repository     --access public
```

> This project pins **yarn** via `packageManager`, which makes the `npm` CLI
> refuse to run inside the repo. Either run the publish commands from a shell
> where that is unset, use `COREPACK_ENABLE_STRICT=0`/`npm_config_user_agent`
> workarounds, or publish per-package from within each `packages/<name>` dir:
>
> ```bash
> cd packages/schema-core && npm publish --access public && cd -
> ```

Dry-run first to see exactly what would be uploaded (no auth needed):

```bash
cd packages/schema-core && npm pack --dry-run && cd -
```

## Path A via CI (recommended, no local secrets)

A GitHub Actions workflow is provided at `.github/workflows/publish.yml`. It is
**gated on the `NPM_TOKEN` secret** and only runs on a manual dispatch or a
`v*` tag, so it never fires accidentally.

1. Add the secret: GitHub repo → *Settings* → *Secrets and variables* →
   *Actions* → **New repository secret** → name `NPM_TOKEN`, value = your npm
   automation token.
2. Ensure the `@zmdb` org exists (one-time, from your machine: `npm org create zmdb`).
3. Trigger it: push a tag `git tag v0.1.0 && git push --tags`, or run the
   workflow manually from the Actions tab.

## Path B — full build before publish

Ask and I will:

1. Add `tsup` (or `tsc`) to emit `dist/index.js` + `dist/index.d.ts` per entry point.
2. Repoint `exports` to `dist` (with a `types` condition) and set `files: ['dist']`.
3. Add a `prepublishOnly` build step so `npm publish` always ships fresh output.

## Verifying after publish

```bash
npm view @zmdb/schema-core version
npm view @zmdb/repository dist.tarball
```
