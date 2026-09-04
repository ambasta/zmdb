// Compile-only public-surface freeze for `emit/SPEC.md` §7b.
//
// The paired directives follow the repository's existing missing-export pattern:
// TS2305 is expected while the entry point is absent, and the exact-signature
// assertion also fails because the imported name is an error type. Both directives
// become TS2578 the moment an implementation exports the exact function, forcing
// that slice to remove them rather than leaving this file permanently muted.

import type {
  // @ts-expect-error TS2305 — frozen by `emit/SPEC.md` §7b; not exported yet.
  protoDecode,
  protoDescriptor,
  // @ts-expect-error TS2305 — frozen by `emit/SPEC.md` §7b; not exported yet.
  protoEncode,
} from '@zmdb/aot-validator';
import type { Equal, Expect } from '@zmdb/schema-core';

type FrozenProtoEncode = <T>(value: T) => Uint8Array;
type FrozenProtoDecode = <T>(bytes: Uint8Array) => T;
type FrozenProtoDescriptor = <_T>() => string;
type ExportedFunction<T> = [keyof T] extends [never] ? T : never;

// @ts-expect-error TS2344 — `protoEncode` is an error type until the export lands.
export type _proto_encode_signature = Expect<Equal<ExportedFunction<typeof protoEncode>, FrozenProtoEncode>>;

// @ts-expect-error TS2344 — `protoDecode` is an error type until the export lands.
export type _proto_decode_signature = Expect<Equal<ExportedFunction<typeof protoDecode>, FrozenProtoDecode>>;

type ProtoDescriptorMatches = Equal<ExportedFunction<typeof protoDescriptor>, FrozenProtoDescriptor>;
export type _proto_descriptor_signature = Expect<ProtoDescriptorMatches>;

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only frozen surface`);
}

// Green controls over the local frozen surface. These pin the details that are easy
// to accidentally soften while making the missing-export rows pass: Uint8Array rather
// than Buffer, a generic return tied to T, and a zero-argument descriptor call.
const frozenEncode: FrozenProtoEncode = _value => unimplemented('protoEncode');
const frozenDecode: FrozenProtoDecode = _bytes => unimplemented('protoDecode');
const frozenDescriptor: FrozenProtoDescriptor = () => unimplemented('protoDescriptor');

interface Message {
  readonly id: number;
}

export type _encode_returns_uint8array = Expect<Equal<ReturnType<typeof frozenEncode<Message>>, Uint8Array>>;
export type _decode_returns_the_requested_type = Expect<Equal<ReturnType<typeof frozenDecode<Message>>, Message>>;
export type _descriptor_returns_string = Expect<Equal<ReturnType<typeof frozenDescriptor<Message>>, string>>;
export type _descriptor_has_no_value_parameter = Expect<Equal<Parameters<typeof frozenDescriptor<Message>>, []>>;
