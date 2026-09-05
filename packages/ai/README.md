# @zmdb/ai

`@zmdb/ai` provides provider-neutral tool documents, parsing, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools. Choosing a provider dialect changes a document shape; it
does not install an SDK or make a network request.

It is part of [zmdb](https://github.com/ambasta/zmdb). During the extraction migration, the root, chat, HTTP, and compiler entry points explicitly forward to the existing schema-core implementation.
The dependency direction is `@zmdb/ai` → `@zmdb/schema-core`; schema-core never imports this package.

## Install

```bash
npm add @zmdb/ai@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Tool documents and parsing: `@zmdb/ai`
- Bounded provider-neutral chat loop: `@zmdb/ai/chat`
- Build-time provider document compiler: `@zmdb/ai/compiler`
- OpenAPI-derived tools and allowlisted callers: `@zmdb/ai/http`
- Shared invocation machinery for integrations: `@zmdb/ai/tool-runtime`

The only runtime dependency is `@zmdb/schema-core`. This package has no external dependency or peer dependency, and does not export Anthropic, LangChain, Vercel AI SDK, or MCP integrations.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
