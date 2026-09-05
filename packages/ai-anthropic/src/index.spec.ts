import type Anthropic from '@anthropic-ai/sdk';
import type { ToolSpec } from '@zmdb/ai';
import { describe, expect, it } from 'vitest';

import { anthropicDriver, type AnthropicMessagesClient } from './index.js';

const tool: ToolSpec = {
  name: 'search_docs',
  description: 'Search documentation',
  parameters: {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
  },
};

const usage: Anthropic.Usage = {
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  inference_geo: null,
  input_tokens: 12,
  output_tokens: 7,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: 'standard',
};

describe('the optional Anthropic SDK driver', () => {
  it('translates the public chat surface through the real SDK request and response types', async () => {
    const carried: Anthropic.ThinkingBlock = {
      type: 'thinking',
      thinking: 'private reasoning',
      signature: 'opaque-signature',
    };
    const response: Anthropic.Message = {
      id: 'msg_1',
      container: null,
      content: [
        carried,
        { type: 'text', text: 'I need one result.', citations: null },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'search_docs',
          input: { q: 'bounded loops' },
          caller: { type: 'direct' },
        },
      ],
      model: 'claude-opus-5',
      role: 'assistant',
      stop_details: null,
      stop_reason: 'tool_use',
      stop_sequence: null,
      type: 'message',
      usage,
    };
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: AnthropicMessagesClient = {
      messages: {
        create: request => {
          requests.push(request);
          return Promise.resolve(response);
        },
      },
    };
    const driver = anthropicDriver({
      client,
      model: 'claude-opus-5',
      maxOutputTokens: 512,
    });

    const result = await driver.next(
      [
        { role: 'system', content: 'Stay concise.' },
        { role: 'user', content: 'Find the loop contract.' },
        {
          role: 'assistant',
          content: '',
          provider: [{ kind: 'thinking', raw: carried }],
          toolCalls: [{ id: 'toolu_0', name: 'search_docs', args: { q: 'tool registry' } }],
        },
        { role: 'tool', callId: 'toolu_0', content: 'found it' },
      ],
      [tool],
    );

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.system).toBe('Stay concise.');
    expect(request?.max_tokens).toBe(512);
    expect(request?.tools).toStrictEqual([
      {
        name: 'search_docs',
        description: 'Search documentation',
        input_schema: {
          type: tool.parameters.type,
          properties: tool.parameters.properties,
          required: [...tool.parameters.required],
        },
      },
    ]);
    expect(request?.messages[1]?.content).toStrictEqual([
      carried,
      { type: 'tool_use', id: 'toolu_0', name: 'search_docs', input: { q: 'tool registry' } },
    ]);
    expect(request?.messages[2]).toStrictEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'found it' }],
    });

    if (result.role !== 'assistant') throw new Error(`expected assistant response, got ${result.role}`);
    expect(result.content).toBe('I need one result.');
    expect(result.toolCalls).toStrictEqual([{ id: 'toolu_1', name: 'search_docs', args: { q: 'bounded loops' } }]);
    expect(result.provider?.[0]?.raw).toBe(carried);
  });

  it('refuses an opaque provider block it cannot round-trip instead of dropping it', async () => {
    let called = false;
    const client: AnthropicMessagesClient = {
      messages: {
        create: () => {
          called = true;
          throw new Error('must not call the SDK');
        },
      },
    };
    const driver = anthropicDriver({ client, model: 'claude-opus-5', maxOutputTokens: 128 });

    await expect(
      driver.next(
        [{ role: 'assistant', content: '', provider: [{ kind: 'future_block', raw: { type: 'future_block' } }] }],
        [],
      ),
    ).rejects.toThrowError('future_block');
    expect(called).toBe(false);
  });
});
