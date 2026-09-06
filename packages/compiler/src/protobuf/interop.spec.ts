import { readFileSync } from 'node:fs';

import { Enum, parse } from 'protobufjs';
import { afterAll, describe, expect, it } from 'vitest';

import { decode, descriptor, encode, openProtoProject } from './__testing__/fixture.js';

// `protobufjs` is a dev-only oracle. Shipping it as a runtime dependency would
// defeat the AOT target: production code must execute the emitted codec, not walk a
// reference library's descriptor. `protoc` 34.2 was also used out of process while
// freezing the bytes below, so the fixed vector and the in-test implementation are
// independent witnesses.

const project = openProtoProject();
const referenceSource = readFileSync(new URL('./__fixtures__/reference.proto', import.meta.url), 'utf8');
const referenceRoot = parse(referenceSource).root;
const ReferenceInterop = referenceRoot.lookupType('zmdb.reference.InteropMessage');
const referenceValue = {
  id: 150,
  name: 'Ada',
  deltas: [-1, 0, 1],
  state: 1,
  marker: 0,
};
const referenceBytes = ReferenceInterop.encode(ReferenceInterop.fromObject(referenceValue)).finish();

afterAll(() => project.close());

describe('descriptor interop', () => {
  it('emits a .proto descriptor that a reference parser accepts', () => {
    const { value: source } = descriptor(project, 'InteropMessage');
    const root = parse(source).root;
    const message = root.lookupType('InteropMessage');
    expect(Object.fromEntries(Object.entries(message.fields).map(([name, field]) => [name, field.id]))).toEqual({
      id: 1,
      name: 2,
      deltas: 3,
      state: 4,
      marker: 5,
    });
  });

  it('orders fields by number in the descriptor', () => {
    const { value: source } = descriptor(project, 'DescriptorOrder');
    parse(source);
    const first = source.search(/\bfirst\s*=\s*1\s*;/);
    const third = source.search(/\bthird\s*=\s*3\s*;/);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(third).toBeGreaterThan(first);
  });

  it('names two colliding nested types distinctly and deterministically', () => {
    const first = descriptor(project, 'CollidingNestedNames').value;
    const second = descriptor(project, 'CollidingNestedNames').value;
    expect(second).toBe(first);

    const message = parse(first).root.lookupType('CollidingNestedNames');
    const left = message.fields.left?.resolve().resolvedType;
    const right = message.fields.right?.resolve().resolvedType;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left?.fullName).not.toBe(right?.fullName);
  });

  it('synthesises enum zero and numbers source members from one', () => {
    const { value: source } = descriptor(project, 'InteropMessage');
    const message = parse(source).root.lookupType('InteropMessage');
    const resolved = message.fields.state?.resolve().resolvedType;
    expect(resolved).toBeInstanceOf(Enum);
    if (!(resolved instanceof Enum)) throw new TypeError('state did not resolve to an enum');

    const entries = Object.entries(resolved.values);
    expect(entries.map(([, number]) => number)).toEqual([0, 1, 2]);
    expect(entries[0]?.[0]).toMatch(/_UNSPECIFIED$/);
  });

  it('imports google.protobuf.Timestamp for Date', () => {
    const { value: source } = descriptor(project, 'TimestampMessage');
    expect(source).toContain('import "google/protobuf/timestamp.proto";');
    expect(source).toMatch(/google\.protobuf\.Timestamp\s+at\s*=\s*1\s*;/);
    parse(source);
  });

  it('emits the frozen scalar, repeated, nested and presence spellings', () => {
    const scalarSource = descriptor(project, 'AllScalars').value;
    const scalars = parse(scalarSource).root.lookupType('AllScalars').fields;
    expect(Object.fromEntries(Object.entries(scalars).map(([name, field]) => [name, field.type]))).toEqual({
      defaultDouble: 'double',
      int32: 'int32',
      int64: 'int64',
      uint32: 'uint32',
      uint64: 'uint64',
      sint32: 'sint32',
      sint64: 'sint64',
      fixed32: 'fixed32',
      fixed64: 'fixed64',
      sfixed32: 'sfixed32',
      sfixed64: 'sfixed64',
      float: 'float',
      double: 'double',
      bool: 'bool',
      string: 'string',
    });

    const repeated = descriptor(project, 'PackedInt32').value;
    expect(repeated).toMatch(/repeated\s+int32\s+values\s*=\s*1\s*;/);
    parse(repeated);

    const nested = parse(descriptor(project, 'NestedEnvelope').value).root.lookupType('NestedEnvelope');
    expect(nested.fields.value?.resolve().resolvedType?.name).toBe('NestedValue');

    const optional = descriptor(project, 'OptionalInt32').value;
    const nullable = descriptor(project, 'NullableInt32').value;
    expect(optional).toMatch(/optional\s+int32\s+value\s*=\s*1\s*;/);
    expect(nullable).toMatch(/optional\s+int32\s+value\s*=\s*1\s*;/);
  });
});

describe('wire interop', () => {
  it('decodes bytes produced by a reference implementation', () => {
    // protoc 34.2 produced the same bytes from `reference.proto`.
    expect(Uint8Array.from(referenceBytes)).toEqual(
      Uint8Array.from([
        0x08, 0x96, 0x01, 0x12, 0x03, 0x41, 0x64, 0x61, 0x1a, 0x03, 0x01, 0x00, 0x02, 0x20, 0x01, 0x28, 0x00,
      ]),
    );
    expect(decode(project, 'InteropMessage', referenceBytes).value).toEqual({
      id: 150,
      name: 'Ada',
      deltas: [-1, 0, 1],
      state: 'active',
      marker: 0,
    });
  });

  it('produces bytes a reference implementation decodes', () => {
    const { value: bytes } = encode(
      project,
      'InteropMessage',
      '{ id: 150, name: "Ada", deltas: [-1, 0, 1], state: "active", marker: 0 }',
    );
    const decoded = ReferenceInterop.toObject(ReferenceInterop.decode(bytes), {
      arrays: true,
      defaults: false,
      enums: Number,
    });
    expect(decoded).toEqual(referenceValue);
  });
});
