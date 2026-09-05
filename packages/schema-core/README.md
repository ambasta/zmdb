# @zmdb/schema-core

`@zmdb/schema-core` contains the schema tags and shared intermediate representation used throughout zmdb. It also derives entities and DTOs and builds relation and OpenAPI types. Provider-neutral AI
tools are now published from `@zmdb/ai`.

It is part of [zmdb](https://github.com/ambasta/zmdb), where one TypeScript schema drives validation, serialization, SQL, OpenAPI, and CRUD.

## Install

```bash
npm add @zmdb/schema-core@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Core schema APIs: `@zmdb/schema-core`
- Schema building blocks: `/tags`, `/ir`, `/derive`, `/dto`, `/naming`, `/relations`, `/openapi`, `/custom-types`

AI is not re-exported from schema-core. Provider-neutral tools ship from `@zmdb/ai`; Anthropic, LangChain, and Vercel integrations ship from their matching `@zmdb/ai-*` packages; MCP client and server
cores ship from `@zmdb/mcp`.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
