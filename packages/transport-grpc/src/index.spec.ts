import { readFileSync } from 'node:fs';

import { Client, Metadata, credentials, status, type ClientWritableStream } from '@grpc/grpc-js';
import { createApplication, type ApplicationExtension } from '@zmdb/app';
import type { WithHeaders } from '@zmdb/app/messaging';
import { Module } from '@zmdb/app/modules';
import { describe, expect, it } from 'vitest';

import {
  ordersService,
  type Chunk,
  type GetOrder,
  type Order,
  type Orders,
  type UploadAck,
} from './__fixtures__/orders.js';
import {
  GrpcError,
  bindGrpcService,
  createGrpcClient,
  grpcExtension,
  type GrpcClient,
  type GrpcFailure,
  type GrpcHandlers,
  type GrpcMetadata,
  type GrpcMetadataValidator,
  type GrpcServiceSpec,
} from './index.js';
import { openGrpcServer, type OpenedGrpcServer } from './runtime.js';

interface Harness extends AsyncDisposable {
  readonly address: string;
  readonly client: GrpcClient<Orders>;
  readonly failures: GrpcFailure[];
  readonly server: OpenedGrpcServer;
}

interface StartOptions {
  readonly validateServerMetadata?: GrpcMetadataValidator;
  readonly validateClientMetadata?: GrpcMetadataValidator;
  readonly maxDurationMs?: number;
}

function identityMetadata(metadata: GrpcMetadata): GrpcMetadata {
  return metadata;
}

function standardHandlers(): GrpcHandlers<Orders> {
  return {
    get: async call => ({ id: call.payload.id, total: 1 }),
    upload: async call => {
      let received = 0;
      for await (const chunk of call.payload) received += chunk.text.length;
      return { received };
    },
    watch: async function* (call) {
      yield { id: `${call.payload.id}-1`, total: 1 };
      yield { id: `${call.payload.id}-2`, total: 2 };
    },
    chat: async function* (call) {
      for await (const chunk of call.payload) yield chunk;
    },
  };
}

async function start(handlers: GrpcHandlers<Orders>, options: StartOptions = {}): Promise<Harness> {
  const failures: GrpcFailure[] = [];
  const spec: GrpcServiceSpec<Orders> = {
    definition: ordersService,
    validateMetadata: options.validateServerMetadata ?? identityMetadata,
    onError: failure => {
      failures.push(failure);
    },
    ...(options.maxDurationMs === undefined ? {} : { maxDurationMs: options.maxDurationMs }),
  };
  const binding = bindGrpcService(spec, handlers);
  const server = await openGrpcServer({
    address: '127.0.0.1:0',
    bindings: [binding],
    credentials: 'insecure',
  });
  const address = `127.0.0.1:${String(server.port)}`;
  const client = createGrpcClient<Orders>({
    definition: ordersService,
    address,
    credentials: 'insecure',
    deadlineMs: 10_000,
    validateMetadata: options.validateClientMetadata ?? identityMetadata,
  });
  return {
    address,
    client,
    failures,
    server,
    [Symbol.asyncDispose]: async () => {
      client.close();
      await server.close(500);
    },
  };
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

async function* chunks(...values: string[]): AsyncIterable<Chunk> {
  for (const text of values) yield { text };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function grpcMetadata(
  headers: Readonly<Record<string, string>> = {},
  binaryHeaders: Readonly<Record<string, Uint8Array>> = {},
): GrpcMetadata {
  return { headers, binaryHeaders };
}

async function rawGet(address: string): Promise<Order> {
  const client = new Client(address, credentials.createInsecure());
  const method = ordersService.methods.get;
  try {
    return await new Promise<Order>((resolve, reject) => {
      client.makeUnaryRequest<GetOrder, Order>(
        method.path,
        value => globalThis.Buffer.from(method.serializeRequest(method.validateRequest(value))),
        bytes => method.validateResponse(method.deserializeResponse(bytes)),
        { id: 'o1' },
        new Metadata(),
        (error, response) => {
          if (error !== null) reject(error);
          else if (response === undefined) reject(new Error('gRPC unary call returned no response'));
          else resolve(response);
        },
      );
    });
  } finally {
    client.close();
  }
}

async function malformedGet(address: string): Promise<void> {
  const client = new Client(address, credentials.createInsecure());
  const method = ordersService.methods.get;
  try {
    await new Promise<void>((resolve, reject) => {
      client.makeUnaryRequest<unknown, Order>(
        method.path,
        () => globalThis.Buffer.from(Uint8Array.of()),
        bytes => method.validateResponse(method.deserializeResponse(bytes)),
        {},
        new Metadata(),
        (error, _response) => {
          if (error === null) resolve();
          else reject(error);
        },
      );
    });
  } finally {
    client.close();
  }
}

describe('the protobuf boundary', () => {
  it('grpcDescriptor is owned by @zmdb/protobuf while emission stays in @zmdb/aot-validator', () => {
    const protobuf = readFileSync(new URL('../../protobuf/src/index.ts', import.meta.url), 'utf8');
    const aotRoot = readFileSync(new URL('../../aot-validator/src/index.ts', import.meta.url), 'utf8');
    const emit = readFileSync(new URL('../../aot-validator/src/emit/index.ts', import.meta.url), 'utf8');
    const wanted = ['protoEncode', 'protoDecode', 'protoDescriptor', 'grpcDescriptor', 'loadGrpcService'];
    expect(wanted.every(name => protobuf.includes(`function ${name}`))).toBe(true);
    expect(wanted.every(name => !aotRoot.includes(`function ${name}`))).toBe(true);
    expect(wanted.every(name => emit.includes(name))).toBe(true);
  });

  it('@grpc/proto-loader is not a direct dependency', () => {
    const root = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    const transport = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    expect([root.includes('"@grpc/proto-loader"'), transport.includes('"@grpc/proto-loader"')]).toEqual([false, false]);
  });

  it('the gRPC surface is the sole root export of @zmdb/transport-grpc', () => {
    const transport = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      readonly exports?: unknown;
    };
    const web = readFileSync(new URL('../../web/package.json', import.meta.url), 'utf8');
    expect(transport.exports).toEqual({ '.': './src/index.ts' });
    expect(web).not.toContain('./microservices/grpc');
  });
});

describe('typed server and client calls', () => {
  it('all four call types round-trip against a real gRPC server', async () => {
    let seenHeaders: Readonly<Record<string, string>> = {};
    let seenBinary: Readonly<Record<string, Uint8Array>> = {};
    let validatedClientMetadata = 0;
    const handlers: GrpcHandlers<Orders> = {
      ...standardHandlers(),
      get: async call => {
        seenHeaders = call.headers;
        seenBinary = call.binaryHeaders;
        return { id: call.payload.id, total: 42 };
      },
      chat: async function* (call) {
        let count = 0;
        for await (const chunk of call.payload) {
          count += 1;
          yield chunk;
        }
        call.setTrailer('x-message-count', String(count));
        yield { text: 'after-half-close' };
      },
    };
    await using harness = await start(handlers, {
      validateClientMetadata: metadata => {
        validatedClientMetadata += 1;
        return metadata;
      },
    });
    let trailer: GrpcMetadata | undefined;

    const unary = await harness.client.get(
      { id: 'o1' },
      {
        metadata: grpcMetadata({ 'x-api-key': 'secret' }, { 'trace-bin': Uint8Array.of(1, 2, 3) }),
      },
    );
    const upload = await harness.client.upload(chunks('ab', 'c'));
    const watch = await collect(harness.client.watch({ id: 'o1' }));
    const chat = await collect(
      harness.client.chat(chunks('one', 'two'), {
        onTrailer: metadata => {
          trailer = metadata;
        },
      }),
    );

    expect({ unary, upload, watch, chat }).toEqual({
      unary: { id: 'o1', total: 42 },
      upload: { received: 3 },
      watch: [
        { id: 'o1-1', total: 1 },
        { id: 'o1-2', total: 2 },
      ],
      chat: [{ text: 'one' }, { text: 'two' }, { text: 'after-half-close' }],
    });
    expect(seenHeaders).toMatchObject({ 'x-api-key': 'secret' });
    expect(seenHeaders['trace-bin']).toBeUndefined();
    expect(seenBinary['trace-bin']).toEqual(Uint8Array.of(1, 2, 3));
    expect(trailer?.headers['x-message-count']).toBe('2');
    expect(validatedClientMetadata).toBeGreaterThan(0);
  });

  it('one authorisation function written against WithHeaders is callable with a GrpcCall', async () => {
    const requiresApiKey = (ctx: WithHeaders): boolean => ctx.headers['x-api-key'] === 'secret';
    let grpcAuthorised = false;
    await using harness = await start({
      ...standardHandlers(),
      get: async call => {
        grpcAuthorised = requiresApiKey(call);
        return { id: call.payload.id, total: 1 };
      },
    });
    await harness.client.get({ id: 'o1' }, { metadata: grpcMetadata({ 'x-api-key': 'secret' }) });

    expect(grpcAuthorised).toBe(true);
  });

  it('serves an external call with no deadline and reports an infinite budget', async () => {
    let remaining = 0;
    await using harness = await start({
      ...standardHandlers(),
      get: async call => {
        remaining = call.remainingMs();
        return { id: call.payload.id, total: 1 };
      },
    });

    await expect(rawGet(harness.address)).resolves.toEqual({ id: 'o1', total: 1 });
    expect(remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('bidirectional: the request half closing does not close the response half', async () => {
    await using harness = await start({
      ...standardHandlers(),
      chat: async function* (call) {
        for await (const chunk of call.payload) yield chunk;
        yield { text: 'summary' };
      },
    });

    await expect(collect(harness.client.chat(chunks('one', 'two')))).resolves.toEqual([
      { text: 'one' },
      { text: 'two' },
      { text: 'summary' },
    ]);
  });

  it('bidirectional request validation failures reject the response iterator', async () => {
    await using harness = await start(standardHandlers());

    async function* invalidChunks(): AsyncIterable<Chunk> {
      yield { text: 1 } as unknown as Chunk;
    }

    await expect(collect(harness.client.chat(invalidChunks()))).rejects.toThrow('expected string');
  });
});

describe('deadlines and cancellation', () => {
  it('propagates a gRPC deadline and cancels the handler when it expires', async () => {
    const cancelled = deferred<void>();
    const remaining: number[] = [];
    await using harness = await start({
      ...standardHandlers(),
      get: async call => {
        try {
          remaining.push(call.remainingMs());
          await wait(20);
          remaining.push(call.remainingMs());
          await waitForAbort(call.signal);
          remaining.push(call.remainingMs());
          throw call.signal.reason;
        } finally {
          cancelled.resolve();
        }
      },
    });

    await expect(harness.client.get({ id: 'o1' }, { deadlineMs: 100 })).rejects.toMatchObject({
      code: status.DEADLINE_EXCEEDED,
    });
    await expect(cancelled.promise).resolves.toBeUndefined();
    expect(remaining[0]).toBeGreaterThan(remaining[1] ?? Number.POSITIVE_INFINITY);
    expect(remaining.at(-1)).toBe(0);
  });

  it('propagates the remaining deadline budget to an outbound typed call', async () => {
    let nestedClient: GrpcClient<Orders> | undefined;
    let nestedRemaining = Number.POSITIVE_INFINITY;
    await using harness = await start({
      ...standardHandlers(),
      get: async call => {
        if (call.payload.id === 'inner') {
          nestedRemaining = call.remainingMs();
          return { id: 'inner', total: 1 };
        }
        await wait(25);
        if (nestedClient === undefined) throw new Error('nested client was not attached');
        return nestedClient.get({ id: 'inner' }, { deadlineMs: call.remainingMs() });
      },
    });
    nestedClient = harness.client;

    await expect(harness.client.get({ id: 'outer' }, { deadlineMs: 250 })).resolves.toEqual({
      id: 'inner',
      total: 1,
    });
    expect(nestedRemaining).toBeGreaterThan(0);
    expect(nestedRemaining).toBeLessThan(240);
  });

  it('unary: a caller that cancels aborts the signal and the handler runs its finally', async () => {
    const started = deferred<void>();
    const finished = deferred<void>();
    await using harness = await start({
      ...standardHandlers(),
      get: async call => {
        started.resolve();
        try {
          await waitForAbort(call.signal);
          throw call.signal.reason;
        } finally {
          finished.resolve();
        }
      },
    });
    const controller = new AbortController();
    const pending = harness.client.get({ id: 'o1' }, { signal: controller.signal });
    await started.promise;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: status.CANCELLED });
    await expect(finished.promise).resolves.toBeUndefined();
  });

  it('server streaming: a caller that stops reading aborts the signal and runs the handler finally', async () => {
    const finished = deferred<void>();
    await using harness = await start({
      ...standardHandlers(),
      watch: async function* (call) {
        try {
          yield { id: call.payload.id, total: 1 };
          await waitForAbort(call.signal);
          throw call.signal.reason;
        } finally {
          finished.resolve();
        }
      },
    });

    for await (const _message of harness.client.watch({ id: 'o1' })) break;

    await expect(finished.promise).resolves.toBeUndefined();
  });

  it('a for-await over call.payload is interrupted only if the request iterable observes call.signal', async () => {
    const started = deferred<void>();
    const finished = deferred<void>();
    await using harness = await start({
      ...standardHandlers(),
      upload: async call => {
        started.resolve();
        try {
          for await (const _chunk of call.payload) {
            // Wait for the next frame; cancellation must interrupt that wait.
          }
          return { received: 0 };
        } finally {
          finished.resolve();
        }
      },
    });
    const raw = new Client(harness.address, credentials.createInsecure());
    const method = ordersService.methods.upload;
    const completion = deferred<UploadAck>();
    const call: ClientWritableStream<Chunk> = raw.makeClientStreamRequest(
      method.path,
      value => globalThis.Buffer.from(method.serializeRequest(method.validateRequest(value))),
      bytes => method.validateResponse(method.deserializeResponse(bytes)),
      new Metadata(),
      (error, response) => {
        if (error !== null) completion.reject(error);
        else if (response === undefined) completion.reject(new Error('gRPC client stream returned no response'));
        else completion.resolve(response);
      },
    );
    call.write({ text: 'one' });
    await started.promise;
    call.cancel();

    await expect(completion.promise).rejects.toMatchObject({ code: status.CANCELLED });
    await expect(finished.promise).resolves.toBeUndefined();
    raw.close();
  });
});

describe('validation and error boundaries', () => {
  it('rejects malformed protobuf frames as INVALID_ARGUMENT', async () => {
    await using harness = await start(standardHandlers());
    await expect(malformedGet(harness.address)).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
      details: 'invalid request',
    });
  });

  it('validates metadata before exposing it to a handler', async () => {
    const validate: GrpcMetadataValidator = metadata => {
      if (metadata.headers['x-api-key'] !== 'secret') throw new Error('missing key');
      return metadata;
    };
    await using harness = await start(standardHandlers(), { validateServerMetadata: validate });

    await expect(harness.client.get({ id: 'o1' })).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
      details: 'invalid metadata',
    });
    await expect(
      harness.client.get({ id: 'o1' }, { metadata: grpcMetadata({ 'x-api-key': 'secret' }) }),
    ).resolves.toEqual({ id: 'o1', total: 1 });
  });

  it('maps private failures to a fixed INTERNAL response and reports the real error', async () => {
    const privateFailure = new Error('database topology: secret');
    await using harness = await start({
      ...standardHandlers(),
      get: async () => {
        throw privateFailure;
      },
    });

    await expect(harness.client.get({ id: 'o1' })).rejects.toMatchObject({
      code: status.INTERNAL,
      details: 'internal error',
    });
    expect(harness.failures).toEqual([
      {
        service: 'orders.Orders',
        method: 'get',
        status: 'INTERNAL',
        error: privateFailure,
      },
    ]);
  });

  it('sends only the safe status and details from GrpcError', async () => {
    await using harness = await start({
      ...standardHandlers(),
      get: async () => {
        throw new GrpcError('NOT_FOUND', 'order not found');
      },
    });

    await expect(harness.client.get({ id: 'missing' })).rejects.toMatchObject({
      code: status.NOT_FOUND,
      details: 'order not found',
    });
    expect(harness.failures).toEqual([]);
  });
});

describe('application lifecycle', () => {
  @Module({})
  class RootModule {}

  it('a failed bind rejects init and closes what was already opened', async () => {
    await using occupied = await start(standardHandlers());
    const events: string[] = [];
    const transport: ApplicationExtension = {
      name: 'scripted',
      start: async () => {
        events.push('transport:open');
      },
      stop: async () => {
        events.push('transport:close');
      },
    };
    const binding = bindGrpcService(
      {
        definition: ordersService,
        validateMetadata: identityMetadata,
        onError: () => undefined,
      },
      standardHandlers(),
    );
    const app = createApplication(RootModule, {
      extensions: [
        transport,
        grpcExtension({
          address: occupied.address,
          bindings: [binding],
          credentials: 'insecure',
        }),
      ],
    });

    await expect(app.init()).rejects.toThrow();
    expect(events).toEqual(['transport:open', 'transport:close']);
    await app[Symbol.asyncDispose]();
  });

  it('forces shutdown after the configured grace period', async () => {
    const started = deferred<void>();
    const finished = deferred<void>();
    await using harness = await start({
      ...standardHandlers(),
      upload: async call => {
        started.resolve();
        try {
          for await (const _chunk of call.payload) {
            // Keep the RPC open until shutdown cancels it.
          }
          return { received: 0 };
        } finally {
          finished.resolve();
        }
      },
    });
    const raw = new Client(harness.address, credentials.createInsecure());
    const method = ordersService.methods.upload;
    const completion = deferred<UploadAck>();
    const call = raw.makeClientStreamRequest(
      method.path,
      value => globalThis.Buffer.from(method.serializeRequest(method.validateRequest(value))),
      bytes => method.validateResponse(method.deserializeResponse(bytes)),
      new Metadata(),
      (error, response) => {
        if (error !== null) completion.reject(error);
        else if (response === undefined) completion.reject(new Error('gRPC client stream returned no response'));
        else completion.resolve(response);
      },
    );
    call.write({ text: 'one' });
    await started.promise;

    await expect(harness.server.close(30)).resolves.toBeUndefined();
    await expect(completion.promise).rejects.toBeInstanceOf(Error);
    await expect(finished.promise).resolves.toBeUndefined();
    raw.close();
  });
});
