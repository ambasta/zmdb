import type Anthropic from '@anthropic-ai/sdk';
import type { ChatDriver } from '@zmdb/ai/chat';

import type { anthropicDriver, AnthropicDriverOptions, AnthropicMessagesClient } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type CreateMessage = AnthropicMessagesClient['messages']['create'];

export type _DriverReturnIsProviderNeutral = Expect<Equal<ReturnType<typeof anthropicDriver>, ChatDriver>>;
export type _RequestUsesRealSdkType = Expect<
  Equal<Parameters<CreateMessage>[0], Anthropic.MessageCreateParamsNonStreaming>
>;
export type _ResponseUsesRealSdkType = Expect<Equal<ReturnType<CreateMessage>, PromiseLike<Anthropic.Message>>>;
export type _OptionsRemainExact = Expect<
  Equal<
    AnthropicDriverOptions,
    {
      readonly client: AnthropicMessagesClient;
      readonly model: string;
      readonly maxOutputTokens: number;
    }
  >
>;
