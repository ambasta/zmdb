// Type-level contract for the response body union shipped by #567.

import type { Equal, Expect } from '@zmdb/schema-core';

import type { ResponseBody, WebResponse } from './index.js';

type TextBody = { readonly kind: 'text'; readonly value: string };
type BytesBody = { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> };
type StreamValue = ReadableStream<Uint8Array<ArrayBuffer>>;
type StreamBody = {
  readonly kind: 'stream';
  readonly value: StreamValue;
  readonly length: number | undefined;
};
type ExpectedBody = TextBody | BytesBody | StreamBody;
type ExpectedValue = string | Uint8Array<ArrayBuffer> | StreamValue;

export type _Tags = Expect<Equal<ResponseBody['kind'], 'text' | 'bytes' | 'stream'>>;
export type _Values = Expect<Equal<ResponseBody['value'], ExpectedValue>>;
export type _Union = Expect<Equal<ResponseBody, ExpectedBody>>;
export type _Status = Expect<Equal<WebResponse['status'], number>>;
export type _Headers = Expect<Equal<WebResponse['headers'], Readonly<Record<string, string>>>>;
export type _Body = Expect<Equal<WebResponse['body'], ResponseBody>>;

type Required_<T, K extends keyof T> = {} extends Pick<T, K> ? false : true;
type OptionalLengthArm = { readonly kind: 'stream'; readonly value: StreamValue; readonly length?: number };
export type _LengthRequired = Expect<Equal<Required_<StreamBody, 'length'>, true>>;
export type _LengthOptionalWitness = Expect<Equal<Required_<OptionalLengthArm, 'length'>, false>>;

declare const sharedBacked: Uint8Array<ArrayBufferLike>;
// @ts-expect-error TS2345 — SharedArrayBuffer-backed views are not valid BodyInit.
export const _BodyInitRejectsSharedBacking = new Response(sharedBacked);
