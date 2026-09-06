# @zmdb/ai-anthropic

`@zmdb/ai-anthropic` adapts the provider-neutral `@zmdb/ai/chat` contract to an injected Anthropic Messages API client. It translates messages, tools, tool results, thinking blocks, and responses
without reading credentials, constructing a client, or making a request during import.

## Install

```bash
npm add @zmdb/ai-anthropic@alpha @anthropic-ai/sdk@0.124.0
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. The adapter depends on `@zmdb/ai`; the Anthropic SDK is an optional peer so
> importing the adapter does not resolve or instantiate it.

## Usage

```ts
import Anthropic from '@anthropic-ai/sdk';
import { anthropicDriver } from '@zmdb/ai-anthropic';

const driver = anthropicDriver({
  client: new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] }),
  model: 'claude-opus-5',
  maxOutputTokens: 1024,
});
```

The caller owns credential loading, client construction, retries, model selection, and persistence. See the project documentation for the bounded `@zmdb/ai/chat` loop.

## Entry point

- `@zmdb/ai-anthropic` — `anthropicDriver`, `AnthropicDriverOptions`, and `AnthropicMessagesClient`.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
