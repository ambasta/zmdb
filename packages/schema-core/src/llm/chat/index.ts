import type { ToolSpec } from '../index.js';
import { invokeTool, toolErrorId } from '../tool-runtime.js';

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
      readonly provider?: readonly ProviderPassthrough[];
    }
  | { readonly role: 'tool'; readonly callId: string; readonly content: string; readonly isError?: boolean };

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

export interface ProviderPassthrough {
  readonly kind: string;
  readonly raw: unknown;
}

export interface ChatDriver {
  next(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<ChatMessage>;
}

type ToolHandler<T> = {
  bivarianceHack(input: T, identity?: unknown): unknown | PromiseLike<unknown>;
}['bivarianceHack'];

export interface ToolEntry<T> {
  readonly spec: ToolSpec;
  readonly validate: (args: unknown) => T;
  readonly handler: ToolHandler<T>;
  readonly effectful?: boolean;
}

export type ToolRegistry = Readonly<Record<string, ToolEntry<unknown>>>;

type ToolInputs = Readonly<Record<string, unknown>>;

interface LinkedToolEntry<T> {
  readonly spec: ToolSpec;
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T, identity?: unknown) => unknown | PromiseLike<unknown>;
  readonly effectful?: boolean;
}

type LinkedRegistry<I extends ToolInputs> = {
  readonly [K in keyof I]: LinkedToolEntry<I[K]>;
};

export function defineTools<const I extends ToolInputs, const R extends LinkedRegistry<I>>(
  tools: R & LinkedRegistry<I>,
): R {
  return tools;
}

export type HasEffectful<R> = {
  [K in keyof R]: R[K] extends { readonly effectful: false } ? never : K;
}[keyof R] extends never
  ? false
  : true;

export interface RunOptions {
  readonly maxTurns: number;
  readonly maxToolCallsPerTurn?: number;
  readonly approve?: (call: ToolCall) => Promise<boolean>;
}

export type RunOptionsFor<R extends Readonly<Record<string, unknown>>> =
  HasEffectful<R> extends true ? RunOptions & { readonly approve: (call: ToolCall) => Promise<boolean> } : RunOptions;

export interface RunResult {
  readonly messages: readonly ChatMessage[];
  readonly stop: 'complete' | 'max-turns' | 'max-tool-calls';
  readonly turns: number;
  readonly toolCalls: number;
  readonly budget: number;
  readonly declined: readonly ToolCall[];
  readonly errors: readonly {
    readonly callId: string;
    readonly name: string;
    readonly errorId: string;
    readonly error: unknown;
  }[];
}

interface RunState {
  readonly messages: ChatMessage[];
  readonly declined: ToolCall[];
  readonly errors: {
    readonly callId: string;
    readonly name: string;
    readonly errorId: string;
    readonly error: unknown;
  }[];
  turns: number;
  toolCalls: number;
}

const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 8;

const toolResult = (callId: string, content: string, isError?: boolean): ChatMessage =>
  isError === undefined ? { role: 'tool', callId, content } : { role: 'tool', callId, content, isError };

const finish = (state: RunState, stop: RunResult['stop'], budget: number): RunResult => ({
  messages: state.messages,
  stop,
  turns: state.turns,
  toolCalls: state.toolCalls,
  budget,
  declined: state.declined,
  errors: state.errors,
});

export async function run<const I extends ToolInputs, R extends LinkedRegistry<I>>(
  driver: ChatDriver,
  messages: readonly ChatMessage[],
  tools: R & LinkedRegistry<I>,
  opts: RunOptionsFor<R>,
): Promise<RunResult> {
  if (!Number.isSafeInteger(opts.maxTurns) || opts.maxTurns <= 0) {
    throw new RangeError('maxTurns must be a positive safe integer');
  }
  const maxToolCallsPerTurn = opts.maxToolCallsPerTurn ?? DEFAULT_MAX_TOOL_CALLS_PER_TURN;
  if (!Number.isSafeInteger(maxToolCallsPerTurn) || maxToolCallsPerTurn <= 0) {
    throw new RangeError('maxToolCallsPerTurn must be a positive safe integer');
  }

  const entries = Object.entries(tools);
  const firstEffectful = entries.find(([, entry]) => entry.effectful !== false);
  if (firstEffectful !== undefined && opts.approve === undefined) {
    throw new Error(`approve is required for effectful tool ${firstEffectful[0]}`);
  }

  const budget = opts.maxTurns * maxToolCallsPerTurn;
  const state: RunState = {
    messages: [...messages],
    declined: [],
    errors: [],
    turns: 0,
    toolCalls: 0,
  };
  const specs = entries.map(([, entry]) => entry.spec);

  while (state.turns < opts.maxTurns) {
    const answer = await driver.next(state.messages, specs);
    state.messages.push(answer);
    state.turns += 1;

    const calls = answer.role === 'assistant' ? (answer.toolCalls ?? []) : [];
    if (calls.length === 0) return finish(state, 'complete', budget);
    if (calls.length > maxToolCallsPerTurn) return finish(state, 'max-tool-calls', budget);

    for (const call of calls) {
      state.toolCalls += 1;
      const entry = Object.hasOwn(tools, call.name) ? tools[call.name] : undefined;
      if (entry === undefined) {
        state.messages.push(toolResult(call.id, `unknown tool ${call.name}`, true));
        continue;
      }

      if (entry.effectful !== false) {
        const approved = await opts.approve?.(call);
        if (approved !== true) {
          state.declined.push(call);
          state.messages.push(toolResult(call.id, 'declined by the operator', true));
          continue;
        }
      }

      const invocation = await invokeTool(entry, call.args);
      if (invocation.kind === 'validation-error') {
        const { content } = invocation;
        if (content !== undefined) {
          state.messages.push(toolResult(call.id, content, true));
          continue;
        }
        const id = toolErrorId();
        state.errors.push({ callId: call.id, name: call.name, errorId: id, error: invocation.error });
        state.messages.push(toolResult(call.id, `tool ${call.name} failed (${id})`, true));
        continue;
      }
      if (invocation.kind === 'handler-error') {
        const id = toolErrorId();
        state.errors.push({ callId: call.id, name: call.name, errorId: id, error: invocation.error });
        state.messages.push(toolResult(call.id, `tool ${call.name} failed (${id})`, true));
        continue;
      }
      state.messages.push(toolResult(call.id, invocation.content));
    }
  }

  return finish(state, 'max-turns', budget);
}

export { anthropicDriver } from './drivers/anthropic.js';
export type { AnthropicDriverOptions, AnthropicMessagesClient } from './drivers/anthropic.js';
