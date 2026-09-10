# @zmdb/ai

`@zmdb/ai` provides provider-neutral tool documents, parsing, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools. Choosing a provider dialect changes a document shape; it
does not install an SDK or make a network request.

It is part of [zmdb](https://github.com/ambasta/zmdb). The root, chat, HTTP, compiler, tool-runtime, and provider-adapter entry points are physically owned by this package. The dependency direction is
`@zmdb/ai` → `@zmdb/schema`; schema-core never imports or re-exports this package.

## Install

```bash
yarn add @zmdb/ai@1.0.0-beta.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Tool documents and parsing: `@zmdb/ai`
- Bounded provider-neutral chat loop: `@zmdb/ai/chat`
- Build-time provider document compiler: `@zmdb/ai/compiler`
- OpenAPI-derived tools and allowlisted callers: `@zmdb/ai/http`
- Shared invocation machinery for integrations: `@zmdb/ai/tool-runtime`

The only runtime dependency is `@zmdb/schema`, and no entry point above has an external dependency or peer dependency.

## Provider adapters

- Anthropic chat driver at `@zmdb/ai/anthropic`: `yarn add @zmdb/ai@1.0.0-beta.2 @anthropic-ai/sdk@0.124.0`
- LangChain tool adapter at `@zmdb/ai/langchain`: `yarn add @zmdb/ai@1.0.0-beta.2 @langchain/core@^1.2.9`
- Vercel AI SDK tool adapter at `@zmdb/ai/vercel`: `yarn add @zmdb/ai@1.0.0-beta.2 ai@^7.0.93`
- MCP client and server cores at `@zmdb/mcp`: `yarn add @zmdb/mcp@1.0.0-beta.2`

Each adapter is an entry point of this package rather than a separate package, and each declares its SDK an **optional** peer because only that entry point needs it. Installing `@zmdb/ai` therefore
installs no Anthropic, LangChain or Vercel AI SDK; add the peer beside the package only for the adapter you import. Installing `@zmdb/mcp` likewise installs no MCP SDK.

`@zmdb/ai/anthropic` adapts the provider-neutral `@zmdb/ai/chat` contract to an injected Anthropic Messages API client, translating messages, tools, tool results, and thinking blocks. It reads no
credential, constructs no client, and makes no request during import; the caller owns credentials, client construction, retries, model selection, and persistence.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicDriver } from '@zmdb/ai/anthropic';

const driver = anthropicDriver({
  client: new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] }),
  model: 'claude-opus-5',
  maxOutputTokens: 1024,
});
```

`@zmdb/ai/langchain` adapts a tool document to the structural fields accepted by LangChain's `DynamicStructuredTool`. It passes the generated JSON Schema straight through, runs a caller-owned
validator before the handler, and serializes results without introducing Zod or another runtime schema producer.

```ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { langchainTool } from '@zmdb/ai/langchain';

const createUser = new DynamicStructuredTool(
  langchainTool('create_user', users, {
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: dto => userRepo.create(dto),
  }),
);
```

`@zmdb/ai/vercel` adapts a tool document to the Vercel AI SDK's branded `inputSchema` contract. The application supplies its installed SDK's `jsonSchema` factory, so the adapter neither imports the
SDK at runtime nor fabricates its brand with a cast. The supported and tested peer floor is exact AI SDK `7.0.93`.

```ts
import { aiSdkTool } from '@zmdb/ai/vercel';
import { jsonSchema, tool } from 'ai';

const createUser = tool(
  aiSdkTool('create_user', users, {
    jsonSchema,
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: async dto => ({ email: dto.email }),
  }),
);
```

## Migrating from schema-core

There are no compatibility aliases in `@zmdb/schema`. Replace every removed subpath from that package directly:

| Removed schema-core subpath | Final import                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/llm`                      | `@zmdb/ai` for tool APIs; `@zmdb/schema/openapi` for `toJsonSchema`; use the explicit chat, HTTP, and MCP entries below for former star exports |
| `/llm/chat`                 | `@zmdb/ai/chat`; `anthropicDriver` and its types move to `@zmdb/ai/anthropic`                                                                   |
| `/llm/http`                 | `@zmdb/ai/http`                                                                                                                                 |
| `/llm/langchain`            | `@zmdb/ai/langchain`                                                                                                                            |
| `/llm/ai-sdk`               | `@zmdb/ai/vercel`                                                                                                                               |
| `/llm/mcp`                  | `@zmdb/mcp`                                                                                                                                     |

## Documentation

Full docs: **https://ambasta.github.io/zmdb/docs/llm-strategy.html**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).
