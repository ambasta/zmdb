import { FixtureProject } from '../../emit/__testing__/project.js';

/**
 * The frozen public vocabulary is repeated locally on purpose.
 *
 * The tests-freeze must compile before `@zmdb/schema-core/tags` and
 * `@zmdb/aot-validator` export these names. The real exports are pinned separately by
 * compile-only tests; these declarations let the behavior tests reach the transformer
 * and fail at the absent protobuf call site rather than fail the whole TypeScript
 * project with TS2305.
 */
export const PROTO_DECLARATIONS = String.raw`
  const zmdbProtoField: unique symbol;
  const zmdbProtoScalar: unique symbol;
  const zmdbSqlType: unique symbol;

  type ProtoScalar =
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

  type ProtoField<N extends number> = { readonly [zmdbProtoField]?: N };
  type Proto<K extends ProtoScalar> = { readonly [zmdbProtoScalar]?: K };
  type Sql<K extends string> = { readonly [zmdbSqlType]?: K };

  function protoEncode<T>(value: T): Uint8Array;
  function protoDecode<T>(bytes: Uint8Array): T;
  function protoDescriptor<T>(): string;

  interface CanonicalInt32 {
    value: number & Proto<'int32'> & ProtoField<1>;
  }

  interface CanonicalSint32 {
    value: number & Proto<'sint32'> & ProtoField<1>;
  }

  interface DefaultDouble {
    value: number & ProtoField<1>;
  }

  interface SqlInteger {
    value: number & Sql<'integer'> & ProtoField<1>;
  }

  interface RequiredInt32 {
    value: number & Proto<'int32'> & ProtoField<1>;
  }

  interface OptionalInt32 {
    value?: number & Proto<'int32'> & ProtoField<1>;
  }

  interface NullableInt32 {
    value: (number & Proto<'int32'> & ProtoField<1>) | null;
  }

  interface OptionalNullableInt32 {
    value?: (number & Proto<'int32'> & ProtoField<1>) | null;
  }

  interface SmallInt64 {
    value: bigint & Proto<'int64'> & ProtoField<1>;
  }

  interface AllScalars {
    defaultDouble: number & ProtoField<1>;
    int32: number & Proto<'int32'> & ProtoField<2>;
    int64: bigint & Proto<'int64'> & ProtoField<3>;
    uint32: number & Proto<'uint32'> & ProtoField<4>;
    uint64: bigint & Proto<'uint64'> & ProtoField<5>;
    sint32: number & Proto<'sint32'> & ProtoField<6>;
    sint64: bigint & Proto<'sint64'> & ProtoField<7>;
    fixed32: number & Proto<'fixed32'> & ProtoField<8>;
    fixed64: bigint & Proto<'fixed64'> & ProtoField<9>;
    sfixed32: number & Proto<'sfixed32'> & ProtoField<10>;
    sfixed64: bigint & Proto<'sfixed64'> & ProtoField<11>;
    float: number & Proto<'float'> & ProtoField<12>;
    double: number & Proto<'double'> & ProtoField<13>;
    bool: boolean & Proto<'bool'> & ProtoField<14>;
    string: string & Proto<'string'> & ProtoField<15>;
  }

  interface PackedInt32 {
    values: (number & Proto<'int32'>)[] & ProtoField<1>;
  }

  interface PackedBool {
    values: boolean[] & ProtoField<1>;
  }

  interface PackedState {
    values: InteropState[] & ProtoField<1>;
  }

  interface RepeatedStrings {
    values: string[] & ProtoField<1>;
  }

  interface NestedValue {
    value: number & Proto<'int32'> & ProtoField<1>;
  }

  interface NestedEnvelope {
    value: NestedValue & ProtoField<3>;
  }

  interface RepeatedNested {
    values: NestedValue[] & ProtoField<1>;
  }

  interface LongNestedValue {
    text: string & ProtoField<1>;
  }

  interface LongNestedEnvelope {
    value: LongNestedValue & ProtoField<3>;
  }

  type InteropState = 'active' | 'paused';

  interface InteropMessage {
    id: number & Proto<'int32'> & ProtoField<1>;
    name: string & ProtoField<2>;
    deltas: (number & Proto<'sint32'>)[] & ProtoField<3>;
    state: InteropState & ProtoField<4>;
    marker?: number & Proto<'int32'> & ProtoField<5>;
  }

  interface TimestampMessage {
    at: Date & ProtoField<1>;
  }

  interface TwoFields {
    first: number & Proto<'int32'> & ProtoField<1>;
    second: string & ProtoField<2>;
  }

  interface TextMessage {
    value: string & ProtoField<1>;
  }

  interface OutOfOrderFields {
    later: number & Proto<'int32'> & ProtoField<3>;
    first: number & Proto<'int32'> & ProtoField<1>;
  }

  interface MissingFieldNumber {
    value: number & Proto<'int32'>;
  }

  interface DuplicateFieldNumbers {
    first: number & Proto<'int32'> & ProtoField<1>;
    second: number & Proto<'int32'> & ProtoField<1>;
  }

  interface ZeroFieldNumber {
    value: number & Proto<'int32'> & ProtoField<0>;
  }

  interface NegativeFieldNumber {
    value: number & Proto<'int32'> & ProtoField<-1>;
  }

  interface TooLargeFieldNumber {
    value: number & Proto<'int32'> & ProtoField<536870912>;
  }

  interface ReservedFieldNumber {
    value: number & Proto<'int32'> & ProtoField<19000>;
  }

  interface UntaggedBigint {
    value: bigint & ProtoField<1>;
  }

  interface NumberAsInt64 {
    value: number & Proto<'int64'> & ProtoField<1>;
  }

  interface BytesMessage {
    value: Uint8Array & Proto<'bytes'> & ProtoField<1>;
  }

  interface NestedArrayMessage {
    values: (number & Proto<'int32'>)[][] & ProtoField<1>;
  }

  interface MapMessage {
    values: Record<string, number & Proto<'int32'>> & ProtoField<1>;
  }

  interface CardPayment {
    kind: 'card' & ProtoField<1>;
    last4: string & ProtoField<2>;
  }

  interface CashPayment {
    kind: 'cash' & ProtoField<1>;
    received: boolean & ProtoField<2>;
  }

  type Payment = CardPayment | CashPayment;

  interface DescriptorOrder {
    third: number & Proto<'int32'> & ProtoField<3>;
    first: number & Proto<'int32'> & ProtoField<1>;
  }

  namespace LeftScope {
    interface Shared {
      left: number & Proto<'int32'> & ProtoField<1>;
    }
  }

  namespace RightScope {
    interface Shared {
      right: string & ProtoField<1>;
    }
  }

  interface CollidingNestedNames {
    left: LeftScope.Shared & ProtoField<1>;
    right: RightScope.Shared & ProtoField<2>;
  }
`;

export function openProtoProject(): FixtureProject {
  return FixtureProject.open({ declarations: PROTO_DECLARATIONS });
}

export interface BuiltValue<T> {
  readonly code: string;
  readonly value: T;
}

export function buildValue<T>(project: FixtureProject, expression: string): BuiltValue<T> {
  const { code, check } = project.build(`const check = () => ${expression};\n`);
  return { code, value: check(undefined) as T };
}

export function encode(project: FixtureProject, type: string, value: string): BuiltValue<Uint8Array> {
  const built = buildValue<unknown>(project, `protoEncode<${type}>(${value})`);
  if (!(built.value instanceof Uint8Array)) {
    throw new TypeError(`protoEncode<${type}> returned ${Object.prototype.toString.call(built.value)}`);
  }
  return { code: built.code, value: built.value };
}

export function decode<T>(project: FixtureProject, type: string, bytes: Uint8Array | readonly number[]): BuiltValue<T> {
  const values = Array.from(bytes).join(', ');
  return buildValue<T>(project, `protoDecode<${type}>(new Uint8Array([${values}]))`);
}

export function descriptor(project: FixtureProject, type: string): BuiltValue<string> {
  const built = buildValue<unknown>(project, `protoDescriptor<${type}>()`);
  if (typeof built.value !== 'string') {
    throw new TypeError(`protoDescriptor<${type}> returned ${typeof built.value}`);
  }
  return { code: built.code, value: built.value };
}
