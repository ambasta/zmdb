import { describe, expect, it } from 'vitest';

import { grpcDescriptor, loadGrpcService, protoDecode, protoDescriptor, protoEncode } from './index.js';
import { ProtoReader, ProtoWriter } from './wire.js';

describe('@zmdb/protobuf', () => {
  it('exports only the five transformed runtime calls from the package root', async () => {
    const protobuf: Record<string, unknown> = await import('./index.js');
    expect(Object.keys(protobuf).toSorted()).toEqual([
      'grpcDescriptor',
      'loadGrpcService',
      'protoDecode',
      'protoDescriptor',
      'protoEncode',
    ]);
  });

  it.each([
    ['protoEncode', () => protoEncode({ id: 1 })],
    ['protoDecode', () => protoDecode(new Uint8Array())],
    ['protoDescriptor', () => protoDescriptor()],
    ['grpcDescriptor', () => grpcDescriptor('Orders', 'orders')],
    ['loadGrpcService', () => loadGrpcService('Orders', 'orders')],
  ])('%s refuses an untransformed call by name', (name, call) => {
    expect(call).toThrow(name);
  });

  it('round-trips the generated-code wire ABI without another runtime', () => {
    const writer = new ProtoWriter();
    writer.tag(1, 0);
    writer.uint32(150);

    const reader = new ProtoReader(writer.finish());
    expect(reader.key()).toBe(8);
    expect(reader.uint32()).toBe(150);
    expect(reader.done).toBe(true);
  });
});
