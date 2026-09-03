import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Ctx, QueryValues } from '../../context/index.js';

// The runtime half of the gRPC tests freeze (#556 / spec freeze #557). Frozen text: `./SPEC.md` §3,
// §5, §6, §7, §11 and §12.
//
// ---------------------------------------------------------------------------
// Why this file is mostly green, and what that costs
// ---------------------------------------------------------------------------
//
// `./SPEC.md` §12 lists seventeen assertions. Five of them (1, 2, 3, 4 and 15) are type-tests and live
// in `./grpc.type-test.ts`. Of the twelve that are runtime assertions, ten — 5, 6, 7, 8, 9, 10, 11,
// 12, 13, 14 — say "against an in-process server", and there is no server: `@grpc/grpc-js` is not a
// dependency of this repository (asserted below), `packages/web/src/microservices/grpc/` contains one
// `SPEC.md` and no code, and a tests freeze cannot add a dependency. §17 needs the same server. §16 is
// worse than blocked and is discussed at the end of this comment.
//
// A `declare`d function or a dynamic `import()` in a `try` would turn all twelve into red tests, and
// both are refused for the reason the convention gives: they fail identically whether the feature is
// missing, misnamed or wrong, so the failure teaches nobody anything.
//
// What is left is genuinely worth having, and it is what the four call types actually need. §5 makes a
// specific claim about cancellation — "when the caller's stream closes, `call.signal` aborts, the
// `for await` in the handler's generator throws at the next suspension point, and `finally` runs.
// There is no other cancellation path and no way to leak the iterator." Every noun in that sentence is
// plain JavaScript: an `AbortSignal`, an async generator, and the `return()` an interrupted `for await`
// performs. So the frozen handler shapes can be driven by hand, with no server and no socket, and what
// happens when the *other* side ends early can be recorded as an ordered array for each of the four
// call types. Two of those recordings contradict §5. That is the point of writing them.
//
// The tests below are therefore green: they assert facts that are true today, about the arrangement
// §5 froze rather than about code that exists. Each one says in its comment which frozen sentence it
// is checking and what #561 has to keep true. They are the executable form of an obligation, and the
// tests-freeze notes record that #561 should re-point them at the real adapter rather than delete
// them.
//
// §12.16 — "a failed bind rejects init and closes what was already opened" — is not blocked for want
// of a dependency but for want of an observable. `GrpcServerOptions` (§9) is three data members:
// `address`, `bindings`, `credentials`. Nothing in it is a callback, so unlike `DispatcherOptions`
// (`../SPEC.md` §5, three required sinks) there is no seam a scripted fake can be handed, and the only
// way to fail a bind is to attempt one. The shared half of that ordering is asserted in
// `../microservices.spec.ts` against `AppOptions.transports`, which does have a seam. Reported as a
// gap in the frozen text rather than left looking covered.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// Held locally because `./index.ts` does not exist, so there is nothing to intersect with.
// `./grpc.type-test.ts` is what anchors these transcriptions to the real exported names — it imports
// them and asserts each shape — so this file can be plain TypeScript with no directives in it.

interface FrozenGrpcMethodDef {
  readonly request: unknown;
  readonly response: unknown;
  readonly requestStream?: true;
  readonly responseStream?: true;
}

/** §5, and §7's two metadata decisions: `binaryHeaders` is separate, and there is no `setHeader`. */
interface FrozenGrpcCall<T> {
  readonly kind: 'grpc';
  readonly service: string;
  readonly method: string;
  readonly payload: T;
  readonly headers: Readonly<Record<string, string>>;
  readonly binaryHeaders: Readonly<Record<string, Uint8Array>>;
  readonly peer: string;
  readonly signal: AbortSignal;
  remainingMs(): number;
  setTrailer(key: string, value: string): void;
}

/** §5's conditional, verbatim. `./grpc.type-test.ts` proves it produces §5's four-row table. */
type FrozenGrpcHandler<D extends FrozenGrpcMethodDef> = D extends { requestStream: true }
  ? D extends { responseStream: true }
    ? (call: FrozenGrpcCall<AsyncIterable<D['request']>>) => AsyncIterable<D['response']>
    : (call: FrozenGrpcCall<AsyncIterable<D['request']>>) => Promise<D['response']>
  : D extends { responseStream: true }
    ? (call: FrozenGrpcCall<D['request']>) => AsyncIterable<D['response']>
    : (call: FrozenGrpcCall<D['request']>) => Promise<D['response']>;

/** `../SPEC.md` §3.1. The whole of what an authorisation function is allowed to see. */
type FrozenWithHeaders = { readonly headers: Readonly<Record<string, string>> };

// §4's example service, one method per call type.
interface GetOrder {
  readonly id: string;
}
interface Order {
  readonly id: string;
  readonly total: number;
}
interface Chunk {
  readonly bytes: Uint8Array;
}
interface UploadAck {
  readonly received: number;
}

type GetDef = { request: GetOrder; response: Order };
type UploadDef = { request: Chunk; response: UploadAck; requestStream: true };
type WatchDef = { request: GetOrder; response: Order; responseStream: true };
type ChatDef = { request: Order; response: Order; requestStream: true; responseStream: true };

/**
 * A `GrpcCall` as the adapter would construct one.
 *
 * `remainingMs` returns `Number.POSITIVE_INFINITY`, which is §6's answer for a call with no deadline:
 * "It is the caller's right to omit one and not this server's business to invent one." `setTrailer`
 * records into `trailers` so §7's after-the-first-yield case is observable without a server.
 */
function callFor<T>(
  method: string,
  payload: T,
  signal: AbortSignal,
  trailers: Record<string, string> = {},
): FrozenGrpcCall<T> {
  return {
    kind: 'grpc',
    service: 'orders.Orders',
    method,
    payload,
    headers: { 'x-api-key': 'secret' },
    binaryHeaders: { 'trace-bin': Uint8Array.of(1, 2, 3) },
    peer: 'ipv4:10.0.0.1:51000',
    signal,
    remainingMs: () => Number.POSITIVE_INFINITY,
    setTrailer: (key, value) => {
      trailers[key] = value;
    },
  };
}

/** Drain an `AbortController.abort()` through the microtask and job queues, with no clock. */
function flush(): Promise<void> {
  return new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

describe('the protobuf boundary (frozen: microservices/grpc/SPEC.md 3, 11)', () => {
  // §11 states this as a dependency and says why it is recorded there: "a spec that let that be
  // discovered during implementation would have cost a slice." §3: "`grpcDescriptor` lives in
  // `@zmdb/aot-validator`, next to `protoDescriptor`, **not here**. `@zmdb/web` does not gain a
  // `TypeIR` walker."
  //
  // Asserted by reading the emitter's entry point as text rather than by importing the names, because
  // a named import that a module does not provide is an ESM link error: the whole file would fail to
  // collect and the diff would be a stack trace instead of four names. §11's table is the assertion —
  // three names from `@zmdb/aot-validator/emit`'s already-frozen §7b plus `grpcDescriptor`, which §3
  // adds beside them.
  //
  // This is also the test that makes "#561 is blocked in fact" mechanical: the day it goes green,
  // #561's real blocker is gone.
  //
  // actual today:
  //   { present: [], sortedAll: false }
  it.fails('grpcDescriptor lives in @zmdb/aot-validator, next to protoDescriptor', () => {
    const emit = readFileSync(new URL('../../../../aot-validator/src/emit/index.ts', import.meta.url), 'utf8');
    const wanted = ['protoEncode', 'protoDecode', 'protoDescriptor', 'grpcDescriptor'];
    const present = wanted.filter(name => emit.includes(name));
    expect({ present, sortedAll: present.length === wanted.length }).toEqual({
      present: wanted,
      sortedAll: true,
    });
  });

  // Green, and it is the non-goal a slice is most likely to walk into. §3: "`@grpc/proto-loader`
  // parses a `.proto` file at process start and produces an object whose types are `any` or
  // hand-declared. That is three defects in one dependency." §2 adds that following #557's steps
  // literally "would have produced two schema sources, which the page itself names as 'the specific
  // problem the project's type-derived design exists to avoid'".
  //
  // `@grpc/grpc-js` is deliberately *not* asserted absent: §3 expects #561 to use its
  // `Server.addService`, so this test would have to be edited by the slice it was meant to constrain.
  // Only the parser is refused, and this is the difference recorded as an assertion.
  it('@grpc/proto-loader is not a dependency', () => {
    const root = readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8');
    const web = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    expect([root.includes('@grpc/proto-loader'), web.includes('@grpc/proto-loader')]).toEqual([false, false]);
  });

  // #556 DoD 5 and §9. The counterpart of `../microservices.spec.ts`'s broker-subpath assertion, split
  // from it so each retires with the slice that lands it: `./microservices` is #559's, this one is
  // #561's. Text rather than an import, because `verify:exports` loads every published subpath under
  // plain node, so the entry and the module have to arrive together.
  //
  // actual today:
  //   absent
  it.fails('the gRPC surface is a published subpath of @zmdb/web', () => {
    const web = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
    expect(web.includes('"./microservices/grpc":') ? 'exported' : 'absent').toBe('exported');
  });
});

describe('the shared authorisation function (frozen: microservices/grpc/SPEC.md 7)', () => {
  // §12.15, and §7's stated payoff: "`headers` is `Readonly<Record<string, string>>` — the same type
  // as `Ctx.headers` and `MessageContext.headers`, character for character, so a `GrpcCall` satisfies
  // `WithHeaders` … That is the payoff for having spelled the shared portion structurally instead of
  // nominally."
  //
  // Green, and load-bearing for the same reason the broker file's twin is: the cheap way to make one
  // authorisation function reach a gRPC call is to give `GrpcCall` a `method` and a `path` and reuse
  // `Guard`, and `../SPEC.md` §1 calls that a security hole. `Ctx` is imported real, so the two
  // contexts are compared as they actually are rather than as this file imagines them.
  //
  // §7's second half is asserted in the same test because it is the same claim from the other side:
  // binary metadata is on `binaryHeaders` as `Uint8Array` and is *not* on `headers`, so a check that
  // reads `headers` can never see an encoding it will misread as text.
  it('one authorisation function written against WithHeaders is callable with a GrpcCall', () => {
    const requiresApiKey = (ctx: FrozenWithHeaders): boolean => ctx.headers['x-api-key'] === 'secret';

    const httpCtx: Ctx<Record<string, string>, unknown, QueryValues> = {
      params: {},
      body: undefined,
      query: {},
      headers: { 'x-api-key': 'secret' },
      method: 'GET',
      path: '/orders',
    };
    const call = callFor('get', { id: 'o1' }, new AbortController().signal);

    expect([requiresApiKey(httpCtx), requiresApiKey(call)]).toEqual([true, true]);
    expect([requiresApiKey({ ...httpCtx, headers: {} }), requiresApiKey({ ...call, headers: {} })]).toEqual([
      false,
      false,
    ]);

    // §7: two maps, different value types, and the binary key is not reachable as text.
    expect(call.binaryHeaders['trace-bin']).toBeInstanceOf(Uint8Array);
    expect(call.headers['trace-bin']).toBeUndefined();

    // §6: a call with no deadline is served and the budget is infinite, not zero and not a guess.
    expect(call.remainingMs()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('what happens when the other side ends early (frozen: microservices/grpc/SPEC.md 5, 6)', () => {
  // Unary. §6: `signal` "is what a handler passes to anything cancellable, and the reason there is no
  // separate `onCancelled` callback". So a cancelled unary call is observable only through the signal,
  // and the handler's own `finally` is the only cleanup path — which is the property asserted, as a
  // recorded order rather than as a final state, because a handler that ran its `finally` before
  // resolving and one that never resolved agree on every other observable.
  it('unary: a caller that cancels aborts the signal and the handler runs its finally', async () => {
    const events: string[] = [];
    const controller = new AbortController();

    const get: FrozenGrpcHandler<GetDef> = async call => {
      events.push('handler:start');
      try {
        await new Promise<never>((_resolve, reject) => {
          call.signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true });
        });
        events.push('handler:resolved');
        return { id: call.payload.id, total: 1 };
      } finally {
        events.push('handler:finally');
      }
    };

    const pending = get(callFor('get', { id: 'o1' }, controller.signal));
    const settled = pending.then(
      () => 'resolved',
      (error: unknown) => `rejected:${error instanceof Error ? error.message : String(error)}`,
    );
    controller.abort();

    expect([await settled, events]).toEqual(['rejected:CANCELLED', ['handler:start', 'handler:finally']]);
  });

  // Server streaming, and this is the recording that contradicts §5. §5 says cancellation is
  // "`AbortSignal`-driven with no `unsubscribe` … when the caller's stream closes, `call.signal`
  // aborts, the `for await` in the handler's generator throws at the next suspension point, and
  // `finally` runs. There is no other cancellation path".
  //
  // For a server-streaming handler there *is* another path, and it is the one that actually runs:
  // whoever consumes the handler's generator interrupts its `for await`, which calls `return()` on the
  // iterator, which resumes the generator with a return completion and runs `finally`. The signal is
  // never touched — `signalAborted:false` is in the recorded array precisely to say so. Both mechanisms
  // are needed and §5 names only one; the tests-freeze notes carry the correction.
  //
  // "No way to leak the iterator" is the half of §5 that holds, and it holds because of `return()`.
  it('server streaming: a caller that stops reading runs the handler finally without aborting the signal', async () => {
    const events: string[] = [];
    const controller = new AbortController();

    const watch: FrozenGrpcHandler<WatchDef> = async function* (call) {
      try {
        // Bounded rather than `for (;;)` so a broken `return()` fails the assertion instead of
        // hanging the suite. Five is more than the two the caller reads.
        for (let i = 1; i <= 5; i += 1) {
          events.push(`yield:${i}`);
          yield { id: `${call.payload.id}-${i}`, total: i };
        }
        events.push('handler:exhausted');
      } finally {
        events.push('handler:finally');
      }
    };

    for await (const message of watch(callFor('watch', { id: 'o1' }, controller.signal))) {
      events.push(`sent:${message.id}`);
      if (message.total === 2) break;
    }
    events.push(`signalAborted:${controller.signal.aborted}`);

    expect(events).toEqual(['yield:1', 'sent:o1-1', 'yield:2', 'sent:o1-2', 'handler:finally', 'signalAborted:false']);
  });

  // Client streaming, and the second recording that says something §5 and §12 do not. When the caller
  // hangs up mid-upload, the request iterable simply ends — "the client finished" and "the client
  // vanished" are the same event at the handler — so a half-finished upload produces a **successful**
  // `UploadAck`. Nothing in the frozen text tells a handler how to tell the two apart, and
  // `deliveryAttempt`'s broker equivalent has no analogue here.
  //
  // Recorded rather than argued: the assertion is the order plus the ack, so an implementation that
  // decided to reject a truncated upload would have to change this test on purpose.
  it('client streaming: a caller that hangs up mid-upload gets a successful ack', async () => {
    const events: string[] = [];

    const upload: FrozenGrpcHandler<UploadDef> = async call => {
      let received = 0;
      try {
        for await (const chunk of call.payload) {
          received += chunk.bytes.length;
          events.push(`recv:${received}`);
        }
        events.push('request-stream-ended');
        return { received };
      } finally {
        events.push('handler:finally');
      }
    };

    async function* twoChunksThenHangUp(): AsyncIterable<Chunk> {
      yield { bytes: Uint8Array.of(1, 2) };
      yield { bytes: Uint8Array.of(3) };
    }

    const ack = await upload(callFor('upload', twoChunksThenHangUp(), new AbortController().signal));

    expect([events, ack]).toEqual([['recv:2', 'recv:3', 'request-stream-ended', 'handler:finally'], { received: 3 }]);
  });

  // Bidirectional, where the frozen types get it right and it is worth pinning that they do. The two
  // halves are two independent iterables — `GrpcCall<AsyncIterable<Req>>` in, `AsyncIterable<Res>` out
  // — so the request side closing does not close the response side, which is gRPC's half-close and the
  // one shape a single `(req, res)` callback could not express.
  //
  // §7's `setTrailer` is exercised here and nowhere else, because this is the only call type where
  // "after it has started emitting" is reachable: the trailer is set after two messages have already
  // gone out, and §7's argument for having no `setHeader` is exactly that a header could not be.
  it('bidirectional: the request half closing does not close the response half', async () => {
    const events: string[] = [];
    const trailers: Record<string, string> = {};

    const chat: FrozenGrpcHandler<ChatDef> = async function* (call) {
      try {
        for await (const note of call.payload) {
          events.push(`echo:${note.id}`);
          yield note;
        }
        events.push('request-stream-ended');
        call.setTrailer('x-note-count', '2');
        yield { id: 'summary', total: 2 };
        events.push('emitted-after-request-ended');
      } finally {
        events.push('handler:finally');
      }
    };

    async function* twoNotes(): AsyncIterable<Order> {
      yield { id: 'n1', total: 1 };
      yield { id: 'n2', total: 1 };
    }

    const call = callFor('chat', twoNotes(), new AbortController().signal, trailers);
    for await (const message of chat(call)) events.push(`sent:${message.id}`);

    expect([events, trailers]).toEqual([
      [
        'echo:n1',
        'sent:n1',
        'echo:n2',
        'sent:n2',
        'request-stream-ended',
        'sent:summary',
        'emitted-after-request-ended',
        'handler:finally',
      ],
      { 'x-note-count': '2' },
    ]);
  });

  // The obligation §5 leaves unstated, and the reason the two contradictions above matter. §5 says the
  // `for await` in the handler "throws at the next suspension point" when the signal aborts. It does
  // not, and cannot: an `AbortSignal` has no relationship to an async iterable unless something puts
  // one there. Whether a cancelled call unblocks a handler that is waiting on `call.payload` is
  // therefore a property of the adapter's request iterable, not of the frozen types — and #561 owes
  // the abort-aware one.
  //
  // Both arrangements are driven in one test so the difference is the assertion: a naive iterable
  // leaves the handler pending forever after an abort, an abort-aware one rejects it and runs
  // `finally`. Nothing here reads a clock; `flush()` drains the job queue with `setImmediate`.
  it('a for-await over call.payload is interrupted only if the request iterable observes call.signal', async () => {
    const outcome = async (abortAware: boolean): Promise<string> => {
      const controller = new AbortController();
      let finallyRan = false;

      // Never yields on its own. `abortAware` is the only difference between the two runs.
      const requests: AsyncIterable<Chunk> = {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<Chunk>>((_resolve, reject) => {
              if (!abortAware) return;
              controller.signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true });
            }),
        }),
      };

      const upload: FrozenGrpcHandler<UploadDef> = async call => {
        try {
          for await (const chunk of call.payload) void chunk;
          return { received: 0 };
        } finally {
          finallyRan = true;
        }
      };

      let settled = 'pending';
      void upload(callFor('upload', requests, controller.signal)).then(
        () => {
          settled = 'resolved';
        },
        (error: unknown) => {
          settled = `rejected:${error instanceof Error ? error.message : String(error)}`;
        },
      );

      controller.abort();
      await flush();
      return `${settled} finallyRan:${String(finallyRan)}`;
    };

    expect([await outcome(false), await outcome(true)]).toEqual([
      'pending finallyRan:false',
      'rejected:CANCELLED finallyRan:true',
    ]);
  });
});
