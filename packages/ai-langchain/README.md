# @zmdb/ai-langchain

`@zmdb/ai-langchain` adapts provider-neutral zmdb tool documents to the structural fields accepted by LangChain's `DynamicStructuredTool`. It passes the generated JSON Schema directly to LangChain,
runs a caller-owned validator before the handler, and serializes tool results without introducing Zod or another runtime schema producer.

## Install

```bash
npm add @zmdb/ai@alpha @zmdb/ai-langchain@alpha @langchain/core@^1.2.9
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. `@langchain/core` is an optional peer used by applications that construct a real
> LangChain tool.

## Usage

```ts
import { DynamicStructuredTool } from '@langchain/core/tools';
import { langchainTool } from '@zmdb/ai-langchain';

const createUser = new DynamicStructuredTool(
  langchainTool('create_user', users, {
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: dto => userRepo.create(dto),
  }),
);
```

The validator belongs in application code so the AOT transform can resolve its concrete type. The adapter passes zmdb's JSON Schema document through byte-for-byte; do not convert it through Zod.

The shipped adapter is physically owned by this package and depends at runtime only on `@zmdb/ai`; schema-core has no LangChain compatibility export.

## Documentation

Full docs: **https://ambasta.github.io/zmdb/docs/llm-langchain.html**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
