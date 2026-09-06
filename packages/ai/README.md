# @zmdb/ai

`@zmdb/ai` provides provider-neutral tool documents, parsing, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools. Choosing a provider dialect changes a document shape; it
does not install an SDK or make a network request.

It is part of [zmdb](https://github.com/ambasta/zmdb). The root, chat, HTTP, compiler, and tool-runtime entry points are physically owned by this package. The dependency direction is `@zmdb/ai` →
`@zmdb/schema-core`; schema-core never imports or re-exports this package.

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

## Optional integrations

- Anthropic chat driver: `npm add @zmdb/ai-anthropic@alpha @anthropic-ai/sdk@0.124.0`
- LangChain tool adapter: `npm add @zmdb/ai-langchain@alpha @langchain/core@^1.2.9`
- Vercel AI SDK tool adapter: `npm add @zmdb/ai-vercel@alpha ai@^7.0.93`
- MCP client and server cores: `npm add @zmdb/mcp@alpha`

The three SDK/framework packages declare their external dependency as an optional peer. Applications that install only `@zmdb/ai` or `@zmdb/mcp` do not install an Anthropic, LangChain, Vercel AI, or
MCP SDK.

## Migrating from schema-core

There are no compatibility aliases in `@zmdb/schema-core`. Replace every removed subpath from that package directly:

| Removed schema-core subpath | Final import                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/llm`                      | `@zmdb/ai` for tool APIs; `@zmdb/schema-core/openapi` for `toJsonSchema`; use the explicit chat, HTTP, and MCP entries below for former star exports |
| `/llm/chat`                 | `@zmdb/ai/chat`; `anthropicDriver` and its types move to `@zmdb/ai-anthropic`                                                                        |
| `/llm/http`                 | `@zmdb/ai/http`                                                                                                                                      |
| `/llm/langchain`            | `@zmdb/ai-langchain`                                                                                                                                 |
| `/llm/ai-sdk`               | `@zmdb/ai-vercel`                                                                                                                                    |
| `/llm/mcp`                  | `@zmdb/mcp`                                                                                                                                          |

## Documentation

Full docs: **https://ambasta.github.io/zmdb/docs/llm-strategy.html**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
