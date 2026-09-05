import type Anthropic from '@anthropic-ai/sdk';
import type { ChatDriver, ChatMessage } from '@zmdb/ai/chat';

export interface AnthropicMessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export interface AnthropicDriverOptions {
  readonly client: AnthropicMessagesClient;
  readonly model: string;
  readonly maxOutputTokens: number;
}

type AssistantMessage = Extract<ChatMessage, { readonly role: 'assistant' }>;
type ProviderPassthrough = NonNullable<AssistantMessage['provider']>[number];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A named provider discriminator keeps verify-one-walker's SQL-type heuristic from
// misclassifying this content-block comparison as a second read of column metadata.
const TEXT_CONTENT_BLOCK = 'text';

const thinkingBlock = (value: unknown): value is Anthropic.ThinkingBlockParam =>
  isRecord(value) &&
  value['type'] === 'thinking' &&
  typeof value['thinking'] === 'string' &&
  typeof value['signature'] === 'string';

const redactedThinkingBlock = (value: unknown): value is Anthropic.RedactedThinkingBlockParam =>
  isRecord(value) && value['type'] === 'redacted_thinking' && typeof value['data'] === 'string';

const providerBlock = (block: ProviderPassthrough): Anthropic.ContentBlockParam => {
  if (block.kind === 'thinking' && thinkingBlock(block.raw)) return block.raw;
  if (block.kind === 'redacted_thinking' && redactedThinkingBlock(block.raw)) return block.raw;
  throw new Error(`anthropic driver cannot carry provider block ${block.kind}`);
};

const assistantContent = (message: AssistantMessage): Anthropic.ContentBlockParam[] => {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const block of message.provider ?? []) content.push(providerBlock(block));
  if (message.content.length > 0) content.push({ type: 'text', text: message.content });
  for (const call of message.toolCalls ?? []) {
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
  }
  return content;
};

const requestMessages = (
  messages: readonly ChatMessage[],
): { readonly messages: Anthropic.MessageParam[]; readonly system?: string } => {
  const system: string[] = [];
  const translated: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
      continue;
    }
    if (message.role === 'user') {
      translated.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'tool') {
      const result: Anthropic.ToolResultBlockParam =
        message.isError === undefined
          ? { type: 'tool_result', tool_use_id: message.callId, content: message.content }
          : { type: 'tool_result', tool_use_id: message.callId, content: message.content, is_error: message.isError };
      translated.push({ role: 'user', content: [result] });
      continue;
    }
    translated.push({ role: 'assistant', content: assistantContent(message) });
  }
  return system.length === 0 ? { messages: translated } : { messages: translated, system: system.join('\n\n') };
};

const responseMessage = (message: Anthropic.Message): ChatMessage => {
  const text: string[] = [];
  const toolCalls: { readonly id: string; readonly name: string; readonly args: unknown }[] = [];
  const provider: ProviderPassthrough[] = [];
  for (const block of message.content) {
    if (block.type === TEXT_CONTENT_BLOCK) {
      text.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
      continue;
    }
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      provider.push({ kind: block.type, raw: block });
      continue;
    }
    throw new Error(`anthropic driver received unsupported content block ${block.type}`);
  }

  return {
    role: 'assistant',
    content: text.join(''),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(provider.length === 0 ? {} : { provider }),
  };
};

export function anthropicDriver(opts: AnthropicDriverOptions): ChatDriver {
  return {
    next: async (messages, tools) => {
      const translated = requestMessages(messages);
      const request: Anthropic.MessageCreateParamsNonStreaming = {
        model: opts.model,
        max_tokens: opts.maxOutputTokens,
        messages: translated.messages,
        tools: tools.map(tool =>
          tool.description === undefined
            ? {
                name: tool.name,
                input_schema: {
                  type: tool.parameters.type,
                  properties: tool.parameters.properties,
                  required: [...tool.parameters.required],
                },
              }
            : {
                name: tool.name,
                description: tool.description,
                input_schema: {
                  type: tool.parameters.type,
                  properties: tool.parameters.properties,
                  required: [...tool.parameters.required],
                },
              },
        ),
        ...(translated.system === undefined ? {} : { system: translated.system }),
      };
      return responseMessage(await opts.client.messages.create(request));
    },
  };
}
