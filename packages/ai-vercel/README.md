# @zmdb/ai-vercel

`@zmdb/ai-vercel` adapts a provider-neutral zmdb tool document to the Vercel AI SDK's branded `inputSchema` contract. The application supplies its installed SDK's `jsonSchema` factory, so this package
neither imports the SDK at runtime nor fabricates its schema brand with a cast.

## Install

```bash
yarn add @zmdb/ai @zmdb/ai-vercel ai@^7.0.83
```

> **Prerelease** (`1.0.0-alpha.4`, configured for the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. The peer range is tested against its lower bound, `7.0.83`, and the current
> repository version, `7.0.92`.

## Usage

```ts
import { jsonSchema, tool } from 'ai';
import { aiSdkTool } from '@zmdb/ai-vercel';

const createUser = tool(
  aiSdkTool('create_user', users, {
    jsonSchema,
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: async dto => ({ email: dto.email }),
  }),
);
```

`validate` runs before `execute`. Validation failures become bounded, value-free tool-result text that a model can correct; handler and infrastructure errors still throw.

## Public API

- `aiSdkTool`
- `AiSdkToolFields`
- `AiSdkToolOptions`
- `ToolAdapterOptions`

The package depends only on `@zmdb/ai`. `ai` is an optional peer because the package returns a structural tool object and receives the branded factory from the caller.

## Non-goals

This package does not own model clients, provider packages, streaming UI state, persistence, `useChat`, or a runtime schema library.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
