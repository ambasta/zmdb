import { afterAll, describe, expect, it } from 'vitest';

import { buildValue, decode, descriptor, encode, openProtoProject } from './__testing__/fixture.js';

// Tests freeze for #478. The normative mapping is `../emit/SPEC.md` §7b and
// `@zmdb/schema-core/ir`'s SPEC §4.5. Descriptor/reflection assertions owned by
// #479 are green. #480's encoder-only assertions are green; decoder-only and
// mixed round-trip assertions remain `it.fails` until #481 replaces that call.
//
// Byte vectors marked "protoc 34.2" were generated from
// `./__fixtures__/reference.proto`; the canonical 150 vector is also the example
// in https://protobuf.dev/programming-guides/encoding/.

const project = openProtoProject();

afterAll(() => project.close());

const ALL_SCALARS_SOURCE = `{
  defaultDouble: 1.5,
  int32: -2147483648,
  int64: -9223372036854775808n,
  uint32: 4294967295,
  uint64: 18446744073709551615n,
  sint32: -2147483648,
  sint64: -9007199254740993n,
  fixed32: 4294967295,
  fixed64: 9007199254740993n,
  sfixed32: -2147483648,
  sfixed64: -9007199254740993n,
  float: 1.5,
  double: -2.25,
  bool: true,
  string: "zmdb"
}`;

const ALL_SCALARS_BYTES = Uint8Array.from([
  0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f, 0x10, 0x80, 0x80, 0x80, 0x80, 0xf8, 0xff, 0xff, 0xff, 0xff,
  0x01, 0x18, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0x20, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x28,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x30, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x38, 0x81, 0x80,
  0x80, 0x80, 0x80, 0x80, 0x80, 0x20, 0x45, 0xff, 0xff, 0xff, 0xff, 0x49, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x00, 0x55, 0x00, 0x00, 0x00, 0x80, 0x59, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xdf, 0xff, 0x65, 0x00, 0x00, 0xc0,
  0x3f, 0x69, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xc0, 0x70, 0x01, 0x7a, 0x04, 0x7a, 0x6d, 0x64, 0x62,
]);

function refusal(source: string, expected: readonly RegExp[]): void {
  const result = project.transform(source);
  expect(result.changed).toBe(false);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  const rendered = result.diagnostics
    .map(diagnostic => `${diagnostic.path}\n${diagnostic.reason}\n${diagnostic.source ?? ''}`)
    .join('\n');
  for (const pattern of expected) expect(rendered).toMatch(pattern);
}

describe('protobuf specification vectors', () => {
  it('encodes a varint field to the bytes the specification gives', () => {
    const { value } = encode(project, 'CanonicalInt32', '{ value: 150 }');
    expect(value).toEqual(Uint8Array.from([0x08, 0x96, 0x01]));
  });

  it('zigzags a negative sint32', () => {
    const { value } = encode(project, 'CanonicalSint32', '{ value: -1 }');
    // protoc 34.2: field tag 08, then zigzag(-1) = 01.
    expect(value).toEqual(Uint8Array.from([0x08, 0x01]));
  });

  it('defaults an untagged number to double', () => {
    const { value } = encode(project, 'DefaultDouble', '{ value: 1.5 }');
    // protoc 34.2: fixed64 wire type and IEEE-754 little-endian payload.
    expect(value).toEqual(Uint8Array.from([0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f]));
  });

  it('does not let a SQL integer tag imply protobuf int32', () => {
    const { value } = encode(project, 'SqlInteger', '{ value: 1.5 }');
    expect(value).toEqual(Uint8Array.from([0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f]));
  });

  // These are a pair. The same empty wire message means an explicitly written
  // required zero and no required field at all under proto3 implicit presence.
  it('omits a required field holding its zero value', () => {
    const { value } = encode(project, 'RequiredInt32', '{ value: 0 }');
    expect(value).toEqual(new Uint8Array());
  });

  it.fails('decodes an absent required field to its zero value', () => {
    const { value } = decode<{ value: number }>(project, 'RequiredInt32', []);
    expect(value).toEqual({ value: 0 });
  });

  it.fails('distinguishes an explicit optional zero from an absent optional', () => {
    const absentBytes = encode(project, 'OptionalInt32', '{}').value;
    const presentBytes = encode(project, 'OptionalInt32', '{ value: 0 }').value;
    expect(absentBytes).toEqual(new Uint8Array());
    // protoc 34.2: proto3 optional carries explicit presence, even for zero.
    expect(presentBytes).toEqual(Uint8Array.from([0x08, 0x00]));

    const absent = decode<{ value?: number }>(project, 'OptionalInt32', absentBytes).value;
    const present = decode<{ value?: number }>(project, 'OptionalInt32', presentBytes).value;
    expect(Object.hasOwn(absent, 'value')).toBe(false);
    expect(present).toEqual({ value: 0 });
  });

  it.fails('maps an absent required nullable field to null', () => {
    const absentBytes = encode(project, 'NullableInt32', '{ value: null }').value;
    const zeroBytes = encode(project, 'NullableInt32', '{ value: 0 }').value;
    expect(absentBytes).toEqual(new Uint8Array());
    expect(zeroBytes).toEqual(Uint8Array.from([0x08, 0x00]));
    expect(decode(project, 'NullableInt32', absentBytes).value).toEqual({ value: null });
    expect(decode(project, 'NullableInt32', zeroBytes).value).toEqual({ value: 0 });
  });

  it.fails('round-trips every emitted scalar without losing 64-bit precision', () => {
    const bytes = encode(project, 'AllScalars', ALL_SCALARS_SOURCE).value;
    // protoc 34.2 over `AllScalarsReference`: this makes the scalar matrix an
    // interoperability test rather than a self-consistent round trip.
    expect(bytes).toEqual(ALL_SCALARS_BYTES);
    const { value } = decode<{
      defaultDouble: number;
      int32: number;
      int64: bigint;
      uint32: number;
      uint64: bigint;
      sint32: number;
      sint64: bigint;
      fixed32: number;
      fixed64: bigint;
      sfixed32: number;
      sfixed64: bigint;
      float: number;
      double: number;
      bool: boolean;
      string: string;
    }>(project, 'AllScalars', bytes);
    expect(value).toEqual({
      defaultDouble: 1.5,
      int32: -2147483648,
      int64: -9223372036854775808n,
      uint32: 4294967295,
      uint64: 18446744073709551615n,
      sint32: -2147483648,
      sint64: -9007199254740993n,
      fixed32: 4294967295,
      fixed64: 9007199254740993n,
      sfixed32: -2147483648,
      sfixed64: -9007199254740993n,
      float: 1.5,
      double: -2.25,
      bool: true,
      string: 'zmdb',
    });
  });

  it.fails('fills every absent scalar field with its protobuf zero value', () => {
    expect(decode(project, 'AllScalars', []).value).toEqual({
      defaultDouble: 0,
      int32: 0,
      int64: 0n,
      uint32: 0,
      uint64: 0n,
      sint32: 0,
      sint64: 0n,
      fixed32: 0,
      fixed64: 0n,
      sfixed32: 0,
      sfixed64: 0n,
      float: 0,
      double: 0,
      bool: false,
      string: '',
    });
  });

  it.fails('decodes every 64-bit field to bigint even when the value is small', () => {
    const { value } = decode<{ value: bigint }>(project, 'SmallInt64', [0x08, 0x01]);
    expect(value).toEqual({ value: 1n });
    expect(typeof value.value).toBe('bigint');
  });

  it('packs a repeated numeric field', () => {
    const { value } = encode(project, 'PackedInt32', '{ values: [1, 2, 150] }');
    // protoc 34.2: one length-delimited packed payload.
    expect(value).toEqual(Uint8Array.from([0x0a, 0x04, 0x01, 0x02, 0x96, 0x01]));
  });

  it.fails('packs repeated bool and enum fields', () => {
    expect(encode(project, 'PackedBool', '{ values: [true, false, true] }').value).toEqual(
      Uint8Array.from([0x0a, 0x03, 0x01, 0x00, 0x01]),
    );
    const enumBytes = encode(project, 'PackedState', '{ values: ["active", "paused"] }').value;
    expect(enumBytes).toEqual(Uint8Array.from([0x0a, 0x02, 0x01, 0x02]));
    expect(decode(project, 'PackedState', enumBytes).value).toEqual({ values: ['active', 'paused'] });
  });

  it('leaves repeated strings unpacked', () => {
    const { value } = encode(project, 'RepeatedStrings', '{ values: ["a", "bc"] }');
    // protoc 34.2: each string has its own field tag and length.
    expect(value).toEqual(Uint8Array.from([0x0a, 0x01, 0x61, 0x0a, 0x02, 0x62, 0x63]));
  });

  it.fails('round-trips a nested message using the reference bytes', () => {
    const bytes = encode(project, 'NestedEnvelope', '{ value: { value: 150 } }').value;
    // protoc 34.2 and the protobuf encoding guide's embedded-message rule.
    expect(bytes).toEqual(Uint8Array.from([0x1a, 0x03, 0x08, 0x96, 0x01]));
    expect(decode(project, 'NestedEnvelope', bytes).value).toEqual({ value: { value: 150 } });
  });

  it.fails('leaves repeated messages unpacked and preserves their order', () => {
    const bytes = encode(project, 'RepeatedNested', '{ values: [{ value: 1 }, { value: 2 }] }').value;
    expect(bytes).toEqual(Uint8Array.from([0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x02]));
    expect(decode(project, 'RepeatedNested', bytes).value).toEqual({
      values: [{ value: 1 }, { value: 2 }],
    });
  });

  it.fails('decodes an absent repeated field to an empty array', () => {
    expect(decode(project, 'PackedInt32', []).value).toEqual({ values: [] });
    expect(decode(project, 'RepeatedStrings', []).value).toEqual({ values: [] });
    expect(decode(project, 'RepeatedNested', []).value).toEqual({ values: [] });
  });

  it.fails('maps Date through google.protobuf.Timestamp', () => {
    const instant = '2020-01-02T03:04:05.006Z';
    const bytes = encode(project, 'TimestampMessage', `{ at: new Date("${instant}") }`).value;
    // protoc 34.2: seconds=1577934245, nanos=6000000.
    expect(bytes).toEqual(
      Uint8Array.from([0x0a, 0x0b, 0x08, 0xa5, 0xbb, 0xb5, 0xf0, 0x05, 0x10, 0x80, 0x9b, 0xee, 0x02]),
    );
    expect(decode(project, 'TimestampMessage', bytes).value).toEqual({ at: new Date(instant) });
  });
});

describe('encoder boundaries from #480', () => {
  it('emits direct property access without a runtime descriptor walk', () => {
    const { code } = encode(project, 'CanonicalInt32', '{ value: 150 }');
    expect(code).toMatch(/_v\.value/);
    expect(code).not.toMatch(/descriptor|Object\.entries|Reflect\./);
  });

  it('encodes the frozen scalar matrix, including exact 64-bit extrema', () => {
    expect(encode(project, 'AllScalars', ALL_SCALARS_SOURCE).value).toEqual(ALL_SCALARS_BYTES);
  });

  it('writes explicit optional and nullable zero presence while omitting absence', () => {
    expect(encode(project, 'OptionalInt32', '{}').value).toEqual(new Uint8Array());
    expect(encode(project, 'OptionalInt32', '{ value: 0 }').value).toEqual(Uint8Array.from([0x08, 0x00]));
    expect(encode(project, 'NullableInt32', '{ value: null }').value).toEqual(new Uint8Array());
    expect(encode(project, 'NullableInt32', '{ value: 0 }').value).toEqual(Uint8Array.from([0x08, 0x00]));
  });

  it('packs repeated bool and enum fields', () => {
    expect(encode(project, 'PackedBool', '{ values: [true, false, true] }').value).toEqual(
      Uint8Array.from([0x0a, 0x03, 0x01, 0x00, 0x01]),
    );
    expect(encode(project, 'PackedState', '{ values: ["active", "paused"] }').value).toEqual(
      Uint8Array.from([0x0a, 0x02, 0x01, 0x02]),
    );
  });

  it('encodes nested, repeated nested and Timestamp fields', () => {
    expect(encode(project, 'NestedEnvelope', '{ value: { value: 150 } }').value).toEqual(
      Uint8Array.from([0x1a, 0x03, 0x08, 0x96, 0x01]),
    );
    expect(encode(project, 'RepeatedNested', '{ values: [{ value: 1 }, { value: 2 }] }').value).toEqual(
      Uint8Array.from([0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x02]),
    );
    expect(encode(project, 'TimestampMessage', '{ at: new Date("2020-01-02T03:04:05.006Z") }').value).toEqual(
      Uint8Array.from([0x0a, 0x0b, 0x08, 0xa5, 0xbb, 0xb5, 0xf0, 0x05, 0x10, 0x80, 0x9b, 0xee, 0x02]),
    );
  });

  it('orders encoded fields by field number rather than declaration order', () => {
    const { value } = encode(project, 'OutOfOrderFields', '{ later: 3, first: 1 }');
    expect(value).toEqual(Uint8Array.from([0x08, 0x01, 0x18, 0x03]));
  });

  it('encodes a nested message longer than 127 bytes', () => {
    const { value } = encode(project, 'LongNestedEnvelope', '{ value: { text: "x".repeat(128) } }');
    // Inner message: 0a 80 01 + 128 bytes = 131; outer length is therefore 83 01.
    expect(value).toHaveLength(134);
    expect(value.slice(0, 6)).toEqual(Uint8Array.from([0x1a, 0x83, 0x01, 0x0a, 0x80, 0x01]));
    expect(value.slice(6)).toEqual(new Uint8Array(128).fill(0x78));
  });

  it('returns an exactly-sized Uint8Array', () => {
    const { value } = encode(project, 'CanonicalInt32', '{ value: 150 }');
    expect(value).toBeInstanceOf(Uint8Array);
    expect(value.byteOffset).toBe(0);
    expect(value.byteLength).toBe(3);
    expect(value.buffer.byteLength).toBe(value.byteLength);
  });
});

describe('decoder boundaries from #481', () => {
  it.fails('decodes fields presented out of order', () => {
    const { value } = decode(project, 'TwoFields', [0x12, 0x01, 0x78, 0x08, 0x07]);
    expect(value).toEqual({ first: 7, second: 'x' });
  });

  it.fails('decodes an unpacked repeated field that our encoder would pack', () => {
    const { value } = decode(project, 'PackedInt32', [0x08, 0x01, 0x08, 0x02, 0x08, 0x96, 0x01]);
    expect(value).toEqual({ values: [1, 2, 150] });
  });

  it.fails('concatenates repeated values across packed occurrences', () => {
    const { value } = decode(project, 'PackedInt32', [0x0a, 0x02, 0x01, 0x02, 0x0a, 0x03, 0x03, 0x96, 0x01]);
    expect(value).toEqual({ values: [1, 2, 3, 150] });
  });

  it.fails('takes the last value when a scalar field repeats', () => {
    const { value } = decode(project, 'RequiredInt32', [0x08, 0x01, 0x08, 0x02]);
    expect(value).toEqual({ value: 2 });
  });

  it.fails('skips an unknown field of every non-group wire type', () => {
    const unknowns = [
      [0x10, 0x96, 0x01],
      [0x11, 1, 2, 3, 4, 5, 6, 7, 8],
      [0x12, 0x03, 9, 8, 7],
      [0x15, 1, 2, 3, 4],
    ];
    for (const unknown of unknowns) {
      expect(decode(project, 'RequiredInt32', [...unknown, 0x08, 0x07]).value).toEqual({ value: 7 });
    }
  });

  it.fails('discards unknown fields across a decode and re-encode', () => {
    const { value } = buildValue<Uint8Array>(
      project,
      'protoEncode<RequiredInt32>(protoDecode<RequiredInt32>(new Uint8Array([0x08, 0x07, 0x10, 0x96, 0x01])))',
    );
    expect(value).toEqual(Uint8Array.from([0x08, 0x07]));
  });

  it.fails('rejects a length prefix larger than the remaining input without allocating', () => {
    const { check } = project.build('const check = (input) => protoDecode<TextMessage>(input);\n');
    expect(() => check(Uint8Array.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x07]))).toThrow(
      /length|remaining|offset|truncat/i,
    );
  });

  it.fails('rejects every mid-field truncation of a valid length-delimited message', () => {
    const { check } = project.build('const check = (input) => protoDecode<TextMessage>(input);\n');
    const valid = Uint8Array.from([0x0a, 0x03, 0x61, 0x62, 0x63]);
    // Prefix 0 is deliberately excluded: the frozen presence rule makes an empty
    // message valid and decodes this required string to "".
    for (let length = 1; length < valid.length; length += 1) {
      expect(() => check(valid.subarray(0, length)), `prefix length ${length}`).toThrow(
        /length|remaining|offset|truncat|varint/i,
      );
    }
  });

  it.fails('refuses a deprecated group field with a clear error', () => {
    const { check } = project.build('const check = (input) => protoDecode<RequiredInt32>(input);\n');
    // Unknown field 2, start-group/end-group wire types.
    expect(() => check(Uint8Array.from([0x13, 0x14, 0x08, 0x07]))).toThrow(/group|wire type 3/i);
  });

  it.fails('rejects zero and unknown enum numbers naming the field and enum', () => {
    const { check } = project.build('const check = (input) => protoDecode<InteropMessage>(input);\n');
    for (const number of [0, 99]) {
      let message = '';
      try {
        check(Uint8Array.from([0x20, number]));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/state/i);
      expect(message).toMatch(/enum|InteropState|State/);
    }
  });
});

describe('descriptor and reflection refusals', () => {
  it('carries protobuf field numbers and scalar choices through TypeIR', () => {
    const node = project.ir('InteropMessage');
    expect(node.kind).toBe('object');
    if (node.kind !== 'object') return;

    const protoOf = (type: (typeof node.properties)[number]['type']): string | undefined => {
      if (type.kind === 'scalar') return type.proto;
      if (type.kind === 'array' && type.element.kind === 'scalar') return type.element.proto;
      return undefined;
    };
    expect(node.properties.map(property => [property.name, property.protoField, protoOf(property.type)])).toEqual([
      ['id', 1, 'int32'],
      ['name', 2, undefined],
      ['deltas', 3, 'sint32'],
      ['state', 4, undefined],
      ['marker', 5, 'int32'],
    ]);
  });

  it('refuses a message with a missing field number, naming the property', () => {
    refusal('const check = () => protoDescriptor<MissingFieldNumber>();', [
      /MissingFieldNumber/,
      /value/,
      /field number/i,
    ]);
  });

  it('refuses duplicate field numbers, naming both properties', () => {
    refusal('const check = () => protoDescriptor<DuplicateFieldNumbers>();', [
      /DuplicateFieldNumbers/,
      /first/,
      /second/,
      /\b1\b/,
    ]);
  });

  it('refuses field number zero', () => {
    refusal('const check = () => protoDescriptor<ZeroFieldNumber>();', [
      /ZeroFieldNumber/,
      /value/,
      /\b0\b/,
      /1|range/i,
    ]);
  });

  it('refuses a negative field number', () => {
    refusal('const check = () => protoDescriptor<NegativeFieldNumber>();', [
      /NegativeFieldNumber/,
      /value/,
      /-1/,
      /1|range/i,
    ]);
  });

  it('refuses a field number above the protobuf maximum', () => {
    refusal('const check = () => protoDescriptor<TooLargeFieldNumber>();', [
      /TooLargeFieldNumber/,
      /value/,
      /536870912/,
      /536870911|range/i,
    ]);
  });

  it('refuses a reserved field number', () => {
    refusal('const check = () => protoDescriptor<ReservedFieldNumber>();', [
      /ReservedFieldNumber/,
      /value/,
      /19000/,
      /reserved/i,
    ]);
  });

  it('refuses an untagged bigint because its signedness is unknown', () => {
    refusal('const check = () => protoEncode<UntaggedBigint>({ value: 1n });', [
      /UntaggedBigint/,
      /value/,
      /bigint/i,
      /Proto|width|signed/i,
    ]);
  });

  it('refuses a number tagged as a 64-bit integer', () => {
    refusal('const check = () => protoEncode<NumberAsInt64>({ value: 1 });', [
      /NumberAsInt64/,
      /value/,
      /int64/,
      /number|bigint|range/i,
    ]);
  });

  it('refuses bytes because reflection cannot carry Uint8Array', () => {
    refusal('const check = () => protoEncode<BytesMessage>({ value: new Uint8Array([1]) });', [
      /BytesMessage/,
      /value/,
      /Uint8Array|typed array/i,
    ]);
  });

  it('refuses scalar mappings that cannot produce an honest descriptor', () => {
    refusal('const check = () => protoDescriptor<UntaggedBigint>();', [
      /UntaggedBigint/,
      /value/,
      /bigint/i,
      /Proto|width|signed/i,
    ]);
    refusal('const check = () => protoDescriptor<NumberAsInt64>();', [
      /NumberAsInt64/,
      /value/,
      /int64/,
      /number|bigint|range/i,
    ]);
    refusal('const check = () => protoDescriptor<BytesMessage>();', [
      /BytesMessage/,
      /value/,
      /Uint8Array|typed array/i,
    ]);
  });

  it('refuses an optional nullable field because it has three source states', () => {
    refusal('const check = () => protoDescriptor<OptionalNullableInt32>();', [
      /OptionalNullableInt32/,
      /value/,
      /optional/i,
      /null/i,
      /three|3|states/i,
    ]);
  });

  it('refuses a nested array instead of inventing a wrapper message', () => {
    refusal('const check = () => protoDescriptor<NestedArrayMessage>();', [
      /NestedArrayMessage/,
      /values/,
      /nested array|repeated.*repeated|wrapper/i,
    ]);
  });

  it('refuses a map because reflection cannot read its index signature', () => {
    refusal('const check = () => protoDescriptor<MapMessage>();', [/MapMessage/, /values/, /index signature|Record/i]);
  });

  it('refuses a discriminated union because oneof arms have no field-number tags', () => {
    refusal('const check = () => protoDescriptor<Payment>();', [/Payment/, /oneof|union/i, /field number|tag/i]);
  });

  it('accepts the same field number in independently numbered nested messages', () => {
    const { value } = descriptor(project, 'CollidingNestedNames');
    expect(value).toContain('left');
    expect(value).toContain('right');
  });
});
