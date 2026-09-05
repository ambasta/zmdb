import {
  CLIENT_RUNTIME_ABI,
  createClientRuntime,
  type CallOptions,
  type ClientOptions,
  type ClientResponseError,
  type GeneratedOperation,
} from '@zmdb/client';
import type { FetchLike } from '@zmdb/client/transport';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;
type Extends<Left, Right> = Left extends Right ? true : false;

interface Input {
  readonly path: { readonly id: string };
}

interface Result {
  readonly id: string;
}

declare const operation: GeneratedOperation<Input, Result>;
declare const options: ClientOptions;
declare const fetch: FetchLike;

const runtime = createClientRuntime(options);
export const result: Promise<Result> = runtime.call(operation, { path: { id: 'one' } });
export const abi: 1 = CLIENT_RUNTIME_ABI;
export const fetchImplementation: typeof globalThis.fetch = fetch;

type OperationInput = Parameters<typeof operation.prepare>[0];
type RuntimeOptions = NonNullable<Parameters<typeof runtime.call<Input, Result>>[2]>;
type Documented = ClientResponseError<404, { readonly code: string }>;

export type _operation_input_is_preserved = Expect<Equal<OperationInput, Input>>;
export type _call_options_include_signal = Expect<Equal<RuntimeOptions['signal'], AbortSignal | undefined>>;
export type _call_options_include_version = Expect<Equal<RuntimeOptions['version'], string | undefined>>;
export type _documented_error_keeps_status = Expect<Equal<Documented['status'], 404>>;
export type _ordinary_call_options_fit_runtime_options = Expect<Extends<CallOptions, RuntimeOptions>>;
