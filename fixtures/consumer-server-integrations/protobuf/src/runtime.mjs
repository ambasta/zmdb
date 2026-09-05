const protobuf = await import('@zmdb/protobuf');
const wire = await import('@zmdb/protobuf/wire');

for (const name of ['protoEncode', 'protoDecode', 'protoDescriptor', 'grpcDescriptor', 'loadGrpcService']) {
  if (typeof protobuf[name] !== 'function') throw new Error(`@zmdb/protobuf omitted ${name}`);
}

const writer = new wire.ProtoWriter();
writer.tag(1, 0);
writer.uint32(42);
const reader = new wire.ProtoReader(writer.finish());
if (reader.key() !== 8 || reader.uint32() !== 42 || !reader.done) {
  throw new Error('@zmdb/protobuf/wire failed its installed round trip');
}
