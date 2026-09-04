# @zmdb/aot-validator

`@zmdb/aot-validator` generates validation and serialization code during the
build. It supports full and shallow checks, assertions, structured validation
errors, equality, random values, JSON, transforms, and protobuf without shipping
a runtime schema parser.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript
schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/aot-validator@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under
> `./dist`.

## Entry points

- Runtime APIs: `@zmdb/aot-validator`, `/advanced`, `/emit`, `/errors`,
  `/serialization`, `/utilities`, `/protobuf/wire`
- Build tooling: `/plugin`, `/reflect`, `/testing`, `/codegen`, `/transformer`,
  `/unplugin`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
