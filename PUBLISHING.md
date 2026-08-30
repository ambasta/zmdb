# Publishing zmdb to npm

Runbook for publishing the `@zmdb/*` packages as **conventional npm packages**
(`.js` + `.d.ts`) via **GitHub CI**. All the build + metadata plumbing is done;
what remains is your one-time npm setup and triggering the workflow.

## Current status (checked against the registry)

| name | availability |
|------|--------------|
| `@zmdb/schema-core` | ✅ available |
| `@zmdb/query-compiler` | ✅ available |
| `@zmdb/aot-validator` | ✅ available |
| `@zmdb/repository` | ✅ available |

## How the packages are built

The source uses **`.ts` import extensions** and cross-package `@zmdb/*` imports,
so each package is bundled to conventional **ESM `.js` + `.d.ts`** with
[`tsup`](https://tsup.egoist.dev) before publishing:

- `packages/<pkg>/tsup.config.ts` lists every entry point (one per `exports`
  subpath), emits ESM `.js` + `.d.ts`, and keeps `@zmdb/*` **external**.
- The committed `package.json` keeps `exports` on `./src` so local dev + `vitest`
  resolve TypeScript source directly.
- A CI step (`.github/scripts/repoint-dist.mjs`) flips
  `exports`/`main`/`types`/`files` to `dist` and rewrites `workspace:^` deps to
  `^<version>` immediately before publish.

Consumers therefore receive built JavaScript + type declarations — no TS-source
requirement.

## One-time setup (you)

1. **Create the `@zmdb` org** on npm (once): `npm org create zmdb`.
2. **Add the token secret**: npmjs.com → *Access Tokens* → generate an
   **Automation** token → GitHub repo *Settings → Secrets and variables →
   Actions → New repository secret* → name **`NPM_TOKEN`**, value = the token.

## Publish via CI

The workflow is `.github/workflows/publish.yml`. It installs, tests, builds
`dist` for all four packages (dependency order), repoints the manifests to
`dist`, then publishes each with `NPM_TOKEN`. It is **gated** (manual dispatch or
`v*` tag) and defaults to a **dry run**.

- **Dry run first** (recommended): Actions tab → *Publish @zmdb packages to npm*
  → *Run workflow* → leave `dry_run = true`. Builds + `npm pack --dry-run`s each
  package so you can inspect the tarball contents without publishing.
- **Real publish**: run the workflow with `dry_run = false`, **or** push a
  version tag:
  ```bash
  git tag v0.1.0 && git push --tags
  ```

Packages are published in dependency order (schema-core → query-compiler →
aot-validator → repository) so dependents resolve on the registry.

## What ends up in each tarball

```
packages/<pkg>/dist/
  index.js        index.d.ts
  <subpath>.js    <subpath>.d.ts   # one pair per exports entry
README.md
LICENSE
```
- `exports` map each subpath to `{ types, import }`.
- `files` = `['dist', 'README.md', 'LICENSE']` (source/specs/tests are excluded).
- Cross-package deps are concrete `^0.1.0` ranges (`aot-validator` → schema-core;
  `repository` → schema-core + query-compiler).

## Local build / dry-run (optional)

```bash
# build every package (dependency order)
for p in schema-core query-compiler aot-validator repository; do
  yarn workspace "@zmdb/$p" build
done

# flip manifests to the publish shape, then inspect a tarball
node .github/scripts/repoint-dist.mjs
cd packages/schema-core && npm pack --dry-run && cd -

# restore the dev-state manifests afterwards
git checkout packages/*/package.json
```

> `repoint-dist.mjs` mutates the committed `package.json` to the publish shape —
> run it only in CI or a throwaway checkout, then restore with the `git checkout`
> above. (This repo pins yarn via `packageManager`; the CI runner uses the
> npm registry `.npmrc` that `setup-node` writes with your token.)

## Verify after publish

```bash
npm view @zmdb/schema-core version
npm view @zmdb/repository dependencies
npm view @zmdb/schema-core exports
```
