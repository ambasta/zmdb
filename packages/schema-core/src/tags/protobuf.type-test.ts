// Compile-only freeze for `../ir/SPEC.md` §4.5.
//
// The public aliases do not exist yet, so the missing imports and their normalized
// shape assertions are paired `@ts-expect-error`s. The normalization deliberately
// ignores unique-symbol identity (a consumer cannot name the private symbol) while
// pinning everything observable: one symbol-keyed optional payload, no forgeable
// string/number key, and the exact literal payload.

import type { Equal, Expect } from '@zmdb/schema-core';
import type {
  // @ts-expect-error TS2305 — frozen by `../ir/SPEC.md` §4.5; not exported yet.
  Proto,
  // @ts-expect-error TS2305 — frozen by `../ir/SPEC.md` §4.5; not exported yet.
  ProtoField,
} from '@zmdb/schema-core/tags';

type FrozenProtoScalar =
  | 'int32'
  | 'int64'
  | 'uint32'
  | 'uint64'
  | 'sint32'
  | 'sint64'
  | 'fixed32'
  | 'fixed64'
  | 'sfixed32'
  | 'sfixed64'
  | 'float'
  | 'double'
  | 'bool'
  | 'string'
  | 'bytes';

type NormalizedTag<T> = {
  readonly keyIsSymbol: keyof T extends symbol ? true : false;
  readonly hasStringKey: Extract<keyof T, string> extends never ? false : true;
  readonly hasNumberKey: Extract<keyof T, number> extends never ? false : true;
  readonly optional: {} extends T ? true : false;
  readonly payload: Exclude<T[keyof T], undefined>;
};
type ExportedTag<T> = Extract<keyof T, string | number> extends never ? T : never;

interface FrozenFieldSeven {
  readonly keyIsSymbol: true;
  readonly hasStringKey: false;
  readonly hasNumberKey: false;
  readonly optional: true;
  readonly payload: 7;
}

interface FrozenScalarTags {
  readonly keyIsSymbol: true;
  readonly hasStringKey: false;
  readonly hasNumberKey: false;
  readonly optional: true;
  readonly payload: FrozenProtoScalar;
}

// @ts-expect-error TS2344 — `ProtoField` is an error type until the export lands.
export type _proto_field_shape = Expect<Equal<NormalizedTag<ProtoField<7>>, FrozenFieldSeven>>;

// Instantiating with the full union means omitting any frozen scalar from the real
// generic constraint is a compile error when the export lands.
// @ts-expect-error TS2344 — `Proto` is an error type until the export lands.
export type _proto_scalar_shape = Expect<Equal<NormalizedTag<Proto<FrozenProtoScalar>>, FrozenScalarTags>>;

// Weak tags erase under intersection: an ordinary value needs no symbol property.
type TaggedNumberNeedsNoMember = Equal<
  number extends number & ExportedTag<Proto<'int32'>> & ExportedTag<ProtoField<1>> ? true : false,
  true
>;
// @ts-expect-error TS2344 — the imported aliases are still error types.
export type _tagged_number_needs_no_runtime_member = Expect<TaggedNumberNeedsNoMember>;

// Green controls over a local spelling. These prove the normalization would notice
// the branded-string shape §4.5 explicitly rejects.
const localField: unique symbol = Symbol('local protobuf field');
const localScalar: unique symbol = Symbol('local protobuf scalar');
type LocalField<N extends number> = { readonly [localField]?: N };
type LocalProto<K extends FrozenProtoScalar> = { readonly [localScalar]?: K };
type ForgedField<N extends number> = { readonly __protoField?: N };

export type _technique_reads_field_payload = Expect<Equal<NormalizedTag<LocalField<7>>, FrozenFieldSeven>>;
export type _technique_reads_scalar_payload = Expect<
  Equal<NormalizedTag<LocalProto<FrozenProtoScalar>>, FrozenScalarTags>
>;
export type _technique_preserves_plain_values = Expect<
  Equal<number extends number & LocalProto<'int32'> & LocalField<1> ? true : false, true>
>;
export type _technique_rejects_forgeable_key = Expect<Equal<NormalizedTag<ForgedField<7>>['hasStringKey'], true>>;
export type _frozen_scalar_union_is_closed = Expect<
  Equal<
    FrozenProtoScalar,
    | 'int32'
    | 'int64'
    | 'uint32'
    | 'uint64'
    | 'sint32'
    | 'sint64'
    | 'fixed32'
    | 'fixed64'
    | 'sfixed32'
    | 'sfixed64'
    | 'float'
    | 'double'
    | 'bool'
    | 'string'
    | 'bytes'
  >
>;
