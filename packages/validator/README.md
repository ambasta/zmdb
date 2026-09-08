# @zmdb/validator

`@zmdb/validator` is zmdb's compiler-free validation and serialization runtime. Generated application code calls this package's errors and helpers; it does not load TypeScript, filesystem tooling,
build plugins, Metro, or lint hosts.

Part of **[zmdb](https://github.com/ambasta/zmdb)**. The TypeScript front end, reflection, emitters, project compilation, and host adapters live in `@zmdb/compiler`.

## Install

```bash
yarn add @zmdb/validator@1.0.0-beta.1
```

> **Prerelease** (`1.0.0-beta.1`). Requires **Node.js 26+** and is **ESM-only**.

## Entry points

- `@zmdb/validator`
- `@zmdb/validator/advanced`
- `@zmdb/validator/errors`
- `@zmdb/validator/serialization`

For build-time reflection and AOT compilation:

```bash
yarn add --dev @zmdb/compiler@1.0.0-beta.1 typescript@^7
```

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
