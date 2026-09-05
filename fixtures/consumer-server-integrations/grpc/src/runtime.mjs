import { createServer } from 'node:net';

import { createApplication, Module } from '@zmdb/app';
import { bindGrpcService, createGrpcClient, grpcExtension } from '@zmdb/transport-grpc';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function request(value) {
  const candidate = record(value, 'request');
  if (typeof candidate.id !== 'string') throw new TypeError('request.id must be a string');
  return { id: candidate.id };
}

function response(value) {
  const candidate = record(value, 'response');
  if (typeof candidate.id !== 'string') throw new TypeError('response.id must be a string');
  return { id: candidate.id };
}

function encode(value) {
  return encoder.encode(JSON.stringify(value));
}

function decode(bytes) {
  return JSON.parse(decoder.decode(bytes));
}

const definition = Object.freeze({
  name: 'fixture.Orders',
  descriptor: 'service Orders { rpc get (GetOrder) returns (Order); }',
  methods: Object.freeze({
    get: Object.freeze({
      path: '/fixture.Orders/get',
      requestStream: false,
      responseStream: false,
      validateRequest: request,
      serializeRequest: encode,
      deserializeRequest: bytes => request(decode(bytes)),
      validateResponse: response,
      serializeResponse: encode,
      deserializeResponse: bytes => response(decode(bytes)),
    }),
  }),
});

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') throw new Error('port probe returned no TCP address');
  await new Promise((resolve, reject) => {
    probe.close(error => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

class RootModule {
  fixture = 'transport-grpc';
}
const metadata = Object.create(null);
Object.defineProperty(RootModule, Symbol.metadata, { value: metadata });
Module({})(RootModule, { metadata });

const port = await availablePort();
const binding = bindGrpcService(
  {
    definition,
    validateMetadata: value => {
      if (value.headers['x-consumer'] !== 'packed') throw new Error('missing packed consumer metadata');
      return value;
    },
    onError: error => {
      throw error.error;
    },
  },
  {
    get: async call => ({ id: `${call.payload.id}:${call.headers['x-consumer'] ?? 'missing'}` }),
  },
);
const app = createApplication(RootModule, {
  extensions: [
    grpcExtension({
      address: `127.0.0.1:${String(port)}`,
      bindings: [binding],
      credentials: 'insecure',
    }),
  ],
  graceMs: 500,
});
let client;
try {
  await app.init();
  client = createGrpcClient({
    definition,
    address: `127.0.0.1:${String(port)}`,
    credentials: 'insecure',
    deadlineMs: 2_000,
    validateMetadata: value => value,
  });
  const result = await client.get(
    { id: 'order-1' },
    {
      metadata: {
        headers: { 'x-consumer': 'packed' },
        binaryHeaders: {},
      },
    },
  );
  if (result.id !== 'order-1:packed') throw new Error(`unexpected gRPC result: ${JSON.stringify(result)}`);
  console.log('@zmdb/transport-grpc packed consumer: lifecycle and typed unary call OK');
} finally {
  client?.close();
  await app[Symbol.asyncDispose]();
}
