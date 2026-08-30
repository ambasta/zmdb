# @zmdb/web

Stage-3 decorator web framework for the zmdb ecosystem: controllers, typed request context, compile-time DI and domain state machines — zero reflect-metadata, zero runtime reflection.

Part of **[zmdb](https://github.com/ambasta/zmdb)** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

```bash
npm add @zmdb/web@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Uses **Stage 3** standard decorators
> (`experimentalDecorators: false`) and the well-known `Symbol.metadata` — no
> `reflect-metadata`. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

`@zmdb/web`

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
