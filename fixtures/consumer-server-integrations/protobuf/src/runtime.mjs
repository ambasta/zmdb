const protobuf = await import('@zmdb/protobuf');
const wire = await import('@zmdb/protobuf/wire');

for (const name of ['protoEncode', 'protoDecode', 'protoDescriptor', 'grpcDescriptor', 'loadGrpcService']) {
  if (typeof protobuf[name] !== 'function') throw new Error(`@zmdb/protobuf omitted ${name}`);
}

for (const [name, invoke] of [
  ['protoEncode', () => protobuf.protoEncode({ id: 1 })],
  ['protoDecode', () => protobuf.protoDecode(new Uint8Array())],
  ['protoDescriptor', () => protobuf.protoDescriptor()],
  ['grpcDescriptor', () => protobuf.grpcDescriptor('Orders', 'fixture')],
  ['loadGrpcService', () => protobuf.loadGrpcService('Orders', 'fixture')],
]) {
  let refusal;
  try {
    invoke();
  } catch (error) {
    refusal = error;
  }
  if (!(refusal instanceof Error) || !refusal.message.includes(name)) {
    throw new Error(`@zmdb/protobuf ${name} did not execute its named untransformed-call refusal`, {
      cause: refusal,
    });
  }
}

const writer = new wire.ProtoWriter();
writer.tag(1, 0);
writer.uint32(42);
const reader = new wire.ProtoReader(writer.finish());
if (reader.key() !== 8 || reader.uint32() !== 42 || !reader.done) {
  throw new Error('@zmdb/protobuf/wire failed its installed round trip');
}

console.log('@zmdb/protobuf packed consumer: build-time calls and wire runtime executed');
