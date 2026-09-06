# @zmdb/aot-validator

`@zmdb/aot-validator` is zmdb's compiler-free validation and serialization runtime. Generated application code calls this package's errors and helpers; it does not load TypeScript, filesystem tooling,
build plugins, Metro, or lint hosts.

Part of **[zmdb](https://github.com/ambasta/zmdb)**. The TypeScript front end, reflection, emitters, project compilation, and host adapters live in `@zmdb/compiler`.

## Install

```bash
npm add @zmdb/aot-validator@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**.

## Entry points

- `@zmdb/aot-validator`
- `@zmdb/aot-validator/advanced`
- `@zmdb/aot-validator/errors`
- `@zmdb/aot-validator/serialization`
- `@zmdb/aot-validator/utilities`

For build-time reflection and AOT compilation:

```bash
npm add --save-dev @zmdb/compiler@alpha typescript@^7
```

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
