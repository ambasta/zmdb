import { StringDecoder } from 'node:string_decoder';

import { describe, it, expect } from 'vitest';

import { Controller, Get, Post } from '../routing/index.js';
import {
  createRouter,
  respond,
  text,
  toFetchHandler,
  toNodeHandler,
  type Router,
  type WebRequest,
  type WebResponse,
} from './index.js';

// Streaming responses. Tests freeze for epic #564 (spec freeze #565); the frozen text is
// `./SPEC.md` "Amendments (streaming responses, #565)", and this file is its §A9 list, item by
// item. §A9 items 2 and 3 are compile-time claims and live in `./streaming.type-test.ts`.
//
// `pipeline.spec.ts` next door covers the response model that exists: `body` is a `string`. This
// file covers the model that does not — the three-arm tagged union of §A1 — plus the two request
// -side prerequisites in §A7 that uploads are blocked on.
//
// `it.fails` for every frozen claim, with the current output recorded above it, captured by
// running it. Never `.skip`: `.skip` vanishes from the summary line, while `it.fails` gets its
// own bucket, so `N passed | M expected fail` makes M the size of the debt. Vitest fails an
// `it.fails` whose body passes, so each of these self-retires in the slice that lands it (#567).

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §A1 turns `WebResponse.body` from `string` into a three-arm tagged union. Neither
// `ResponseBody` nor the widened `WebResponse` exists in `./index.ts`, so the widening — and
// only the widening — is declared here. `Omit<WebResponse, 'body'>` is load-bearing: rename
// `status` or `headers` on the real interface and this file stops compiling instead of quietly
// asserting a shape nobody has.

/** §A1, the `text` arm. */
type FrozenTextBody = { readonly kind: 'text'; readonly value: string };
/** §A1, the `bytes` arm. `Uint8Array<ArrayBuffer>`, not bare `Uint8Array` — see §A1. */
type FrozenBytesBody = { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> };
/** §A1, the `stream` arm. `length` is required and explicitly nullable, not `length?`. */
type FrozenStreamBody = {
  readonly kind: 'stream';
  readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly length: number | undefined;
};
type FrozenResponseBody = FrozenTextBody | FrozenBytesBody | FrozenStreamBody;

/** §A1's `WebResponse`, as the real one plus the one field whose type changes. */
type FrozenResponse = Omit<WebResponse, 'body'> & { readonly body: FrozenResponseBody };

/** §A2's `StreamOptions`. `onError` is required, which is why the second argument is. */
interface FrozenStreamOptions {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly length?: number;
  readonly onError: (error: unknown) => void;
}

type FrozenStreamFactory = (
  value: ReadableStream<Uint8Array<ArrayBuffer>>,
  options: FrozenStreamOptions,
) => FrozenResponse;
type FrozenBytesFactory = (
  value: Uint8Array<ArrayBuffer>,
  options?: { readonly status?: number; readonly headers?: Readonly<Record<string, string>> },
) => FrozenResponse;
type FrozenBodyText = (response: FrozenResponse) => Promise<string>;

/**
 * §A3's `NodeResLike`, which gains `write`, `once` and `destroy` and widens `end`.
 *
 * Today's `NodeResLike` is not exported, so there is nothing to intersect with; what pins this
 * to reality instead is that `toNodeHandler` accepts the double structurally. Widen `end`'s
 * parameter or drop `setHeader` on the real interface and the assignment in `nodeDouble` fails.
 */
interface FrozenNodeRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  writeHead?(status: number, headers: Readonly<Record<string, string>>): unknown;
  write(chunk: Uint8Array<ArrayBuffer>): boolean;
  once(event: string, listener: () => void): void;
  destroy(error?: Error): void;
  end(body?: string | Uint8Array<ArrayBuffer>): void;
}

/** §A7's `toNodeHandler`, which gains a second argument carrying the request body limit. */
type FrozenNodeAdapter = (
  router: Router,
  options?: { readonly maxBodyBytes: number },
) => ReturnType<typeof toNodeHandler>;

// ---------------------------------------------------------------------------
// The two boundaries
// ---------------------------------------------------------------------------

/**
 * Resolve one of §A2/§A6's new factories off the real package barrel.
 *
 * boundary: `bytes`, `stream`, `file` and `bodyText` do not exist yet, and a static
 * `import { stream } from '../index.js'` is a link-time SyntaxError that takes the whole file
 * down rather than one test — which would put this debt outside the `expected fail` bucket
 * instead of inside it. The lookup is dynamic and the failure names the export that is missing,
 * so it is distinguishable from a factory that exists and answers wrongly (that failure is an
 * assertion diff). It stops being reachable in the slice that lands the factories.
 */
async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('../index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/web exports no "${name}" (frozen: pipeline/SPEC.md A2/A6)`);
  }
  return value as T;
}

/**
 * A router that answers every request with one frozen-shaped response, so the *real* adapters
 * are what these tests drive.
 *
 * boundary: `FrozenResponse['body']` is an object and today's is a `string`, which do not
 * overlap, so the conversion needs `unknown` in the middle. That is the whole point of putting
 * it in one function: the adapters below are the shipped `toNodeHandler`/`toFetchHandler`, not
 * doubles, so what every assertion records is what the real code does when handed §A1's shape.
 */
function routerAnswering(response: FrozenResponse): Router {
  return {
    register: () => undefined,
    registerDeferred: () => undefined,
    handle: () => Promise.resolve(response as unknown as WebResponse),
  };
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

interface NodeDoubleState {
  status: number;
  readonly headers: Record<string, string>;
  /** Every `write` argument, in order — the byte-count spy §A9.4 asks for. */
  readonly writes: Uint8Array[];
  readonly events: string[];
  endCalls: number;
  endArg: unknown;
  destroyCalls: number;
  destroyArg: unknown;
  readonly done: Promise<void>;
}

/**
 * A `NodeResLike` double that can refuse a write, so backpressure is observable.
 *
 * `writeFalseAt` makes the nth `write` return `false` and hands back the `drain` listener the
 * adapter registered, which is the only way to assert §A3's "suspends production until drain"
 * without a socket.
 */
function nodeDouble(options: { readonly writeFalseAt?: number } = {}): {
  res: FrozenNodeRes;
  state: NodeDoubleState;
  fire(event: string): void;
} {
  const listeners = new Map<string, () => void>();
  let settle: () => void = () => undefined;
  const state: NodeDoubleState = {
    status: 0,
    headers: {},
    writes: [],
    events: [],
    endCalls: 0,
    endArg: undefined,
    destroyCalls: 0,
    destroyArg: undefined,
    done: new Promise<void>(resolve => {
      settle = resolve;
    }),
  };
  const res: FrozenNodeRes = {
    statusCode: 0,
    setHeader(name, value) {
      state.headers[name] = value;
    },
    writeHead(status, headers) {
      state.status = status;
      Object.assign(state.headers, headers);
    },
    write(chunk) {
      state.writes.push(chunk);
      return state.writes.length !== options.writeFalseAt;
    },
    once(event, listener) {
      state.events.push(event);
      listeners.set(event, listener);
    },
    destroy(error) {
      state.destroyCalls += 1;
      state.destroyArg = error;
      settle();
    },
    end(body) {
      state.endCalls += 1;
      state.endArg = body;
      settle();
    },
  };
  return {
    res,
    state,
    fire(event) {
      listeners.get(event)?.();
    },
  };
}

/** A source that records every pull and cancellation, per §A9.5. */
function countingSource(chunks: readonly Uint8Array[]): {
  stream: ReadableStream<Uint8Array<ArrayBuffer>>;
  log: { pulls: number; cancels: number; cancelReason: unknown };
} {
  const log = { pulls: 0, cancels: 0, cancelReason: undefined as unknown };
  let index = 0;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      log.pulls += 1;
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    },
    cancel(reason: unknown) {
      log.cancels += 1;
      log.cancelReason = reason;
    },
  });
  return { stream, log };
}

/** A source that yields one chunk and then throws, per §A9.6. */
function throwingSource(before: readonly Uint8Array[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  let index = 0;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const chunk = before[index];
      index += 1;
      if (chunk === undefined) {
        controller.error(new Error('source exploded mid-stream'));
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    },
  });
}

// A faithful `node:http` request double: it only emits 'data' when the framing headers say
// there is a body, and once `setEncoding` is called it decodes through a real `StringDecoder`
// exactly as `IncomingMessage` does. Copied in shape from `pipeline.spec.ts`'s `FakeReq`,
// because §A7's whole claim is about what that decoding destroys.
class FakeReq {
  readonly listeners = new Map<string, (chunk: unknown) => void>();
  private decoder: StringDecoder | undefined;

  constructor(
    readonly method: string,
    readonly url: string,
    readonly headers: Record<string, string | string[] | undefined> = {},
  ) {}

  on(event: string, listener: (chunk: unknown) => void): void {
    this.listeners.set(event, listener);
  }

  setEncoding(encoding: string): void {
    this.decoder = new StringDecoder(encoding as BufferEncoding);
  }

  push(...chunks: readonly Uint8Array[]): void {
    const data = this.listeners.get('data');
    for (const chunk of chunks) {
      data?.(this.decoder ? this.decoder.write(chunk) : chunk);
    }
    this.listeners.get('end')?.(undefined);
  }
}

/** A router that records the `rawBody` it was handed and answers 200, per §A7. */
function bodySpyRouter(): { router: Router; seen: { raw: unknown } } {
  @Controller('/spy')
  class SpyController {
    @Post('/body')
    body() {
      return text('ok');
    }

    @Get('/ping')
    ping() {
      return text('ok');
    }
  }
  const inner = createRouter();
  inner.register(new SpyController());
  const seen = { raw: 'never handled' as unknown };
  return {
    seen,
    router: {
      register: (controller, options) => inner.register(controller, options),
      registerDeferred: (controller, instance) => inner.registerDeferred(controller, instance),
      handle: (request: WebRequest) => {
        seen.raw = request.rawBody;
        return inner.handle(request);
      },
    },
  };
}

const encoder = new TextEncoder();
const codePointsOf = (value: unknown): readonly (number | undefined)[] =>
  [...String(value)].map(character => character.codePointAt(0));

/**
 * What `end` was handed, as a short comparable string.
 *
 * Not defensiveness and not a proxy for the claim: handed a §A1 body wrapper, `res.end(body)`
 * receives an object holding a live `ReadableStream`, and vitest prints its entire internal state
 * — sixty lines of `Symbol(kState)` — in place of the one fact the assertion is about. This turns
 * the recorded actual into something a comment can quote. It is not used where the *identity* of
 * the bytes is the claim; there the assertion compares the bytes.
 */
function endShape(value: unknown): string {
  if (value === undefined) {
    return 'no body';
  }
  if (typeof value === 'string') {
    return value === '' ? 'empty string' : `string(${String(value.length)})`;
  }
  if (value instanceof Uint8Array) {
    return `bytes(${String(value.byteLength)})`;
  }
  const kind: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'kind') : undefined;
  return typeof kind === 'string' ? `body wrapper kind=${kind}` : `${typeof value}`;
}

// ---------------------------------------------------------------------------
// A9.1 — the byte-for-byte promise, through the adapters
// ---------------------------------------------------------------------------

@Controller('/r')
class ExistingResponsesController {
  @Get('/echo/:id')
  echo(ctx: { readonly params: { readonly id: string } }) {
    return text(ctx.params.id);
  }

  @Get('/redirect')
  redirect() {
    return respond({ status: 302, headers: { location: '/login' } });
  }

  @Get('/html')
  html() {
    return respond({ body: '<h1>hi</h1>' });
  }

  @Get('/nocontent')
  nocontent() {
    return respond({ status: 204 });
  }

  @Get('/notmodified')
  notmodified() {
    return respond({ status: 304 });
  }
}

function existingRouter(): Router {
  const router = createRouter();
  router.register(new ExistingResponsesController());
  return router;
}

describe('response body union: what must not change (frozen: pipeline/SPEC.md A9.1)', () => {
  // Green, and not padding. §A9's promise is "the same bytes, with the same headers, in the same
  // number of writes", and the slice that adds a `switch (body.kind)` to `send` is exactly the
  // change that can make `text` take two writes, gain a `content-length`, or arrive as
  // `[object Object]`. `endCalls` and `writes.length` are asserted, not just the payload,
  // because the write count is half the promise and nothing else in the suite pins it.
  it('serves a text response byte-identically to the current implementation', async () => {
    const { res, state } = nodeDouble();
    toNodeHandler(existingRouter())(new FakeReq('GET', '/r/echo/0'), res);
    await state.done;
    expect(state.status).toBe(200);
    expect(state.headers).toEqual({ 'content-type': 'text/plain; charset=utf-8' });
    expect(state.endArg).toBe('0');
    expect(state.endCalls).toBe(1);
    expect(state.writes).toEqual([]);
  });

  // Green, same reason: `respond()` sends neither a body nor a `content-type`, and §A1's
  // `EMPTY_TEXT` shared constant is a change to how that empty body is represented. A frozen
  // constant that gets mutated, or a `content-length: 0` added on the way through, both show up
  // here.
  it('sends a redirect with no body and no content-type through the node adapter', async () => {
    const { res, state } = nodeDouble();
    toNodeHandler(existingRouter())(new FakeReq('GET', '/r/redirect'), res);
    await state.done;
    expect(state.status).toBe(302);
    expect(state.headers).toEqual({ location: '/login' });
    expect(state.endArg).toBe('');
    expect(state.writes).toEqual([]);
  });

  // Green: the same responses through the other adapter, which §A4 rewrites into a `switch`.
  // Only the parts that hold today are asserted here; the two that do not are the two `it.fails`
  // below, and separating them is the whole reason this file drives the adapters rather than
  // `handle` — `pipeline.spec.ts` asserts all of this against `handle` and therefore never saw
  // either failure.
  it('serves a text response byte-identically through the fetch adapter', async () => {
    const handler = toFetchHandler(existingRouter());
    const plain = await handler(new Request('http://x/r/echo/0'));
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await plain.text()).toBe('0');
    const redirect = await handler(new Request('http://x/r/redirect'));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/login');
    expect(await redirect.text()).toBe('');
  });

  // §A9.1's own words: "`respond({ status: 302, headers })` still sends no body and no
  // `content-type`". The word "still" is wrong. `toFetchHandler` hands `response.body` — a
  // `string`, including the empty one — to `new Response`, and the platform invents a
  // `content-type` for any string `BodyInit`. So `respond()`'s documented "no assumed content
  // type" holds on the node adapter and has never held on the fetch adapter, and the same line
  // serves `respond({ body: '<h1>hi</h1>' })` as `text/plain` to a browser.
  //
  // actual today:
  //   302: expected 'text/plain;charset=UTF-8' to be null
  //   html: content-type is 'text/plain;charset=UTF-8', body '<h1>hi</h1>'
  // Captured by driving the real `toFetchHandler`. This is a defect in the code as it stands,
  // not only a claim about #567: the fix is `new Response(null, …)` for an empty body, and
  // leaving the header off for a `respond()` that declared none.
  it.fails('assumes no content type for respond() through the fetch adapter', async () => {
    const handler = toFetchHandler(existingRouter());
    const redirect = await handler(new Request('http://x/r/redirect'));
    expect(redirect.headers.get('content-type'), '302').toBeNull();
    const html = await handler(new Request('http://x/r/html'));
    expect(html.headers.get('content-type'), 'html').toBeNull();
    expect(await html.text(), 'html').toBe('<h1>hi</h1>');
  });

  // The one that is a live bug rather than a missing feature, and the reason §A9.1 says "through
  // the adapters and not only through `handle`". `respond({ status: 204 })` is a documented,
  // tested response — `pipeline.spec.ts` has "sends a 204 with an empty body" — and it cannot be
  // served through `toFetchHandler` at all: `new Response('', { status: 204 })` is a `TypeError`,
  // thrown after `handle` resolved, so the adapter's promise rejects and the runtime answers with
  // whatever it does for an unhandled rejection. 304 is the same. Both statuses are named
  // explicitly in §A3, and §A4's frozen three-case `switch` does not handle either.
  //
  // actual today:
  //   TypeError: Response constructor: Invalid response status code 204
  //   TypeError: Response constructor: Invalid response status code 304
  // The `try` is here because that throw is a platform constructor's, not the adapter's answer,
  // and an uncaught one prints a stack through `toFetchHandler` instead of the status the test is
  // about. The throw is not the claim — the claim is the status and the empty body.
  it.fails('serves a 204 and a 304 through the fetch adapter without throwing', async () => {
    const handler = toFetchHandler(existingRouter());
    for (const probe of [
      { path: '/r/nocontent', status: 204 },
      { path: '/r/notmodified', status: 304 },
    ]) {
      const answered = await handler(new Request(`http://x${probe.path}`)).then(
        async response => `${String(response.status)} body=${JSON.stringify(await response.text())}`,
        (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : `threw ${String(error)}`),
      );
      expect(answered, probe.path).toBe(`${String(probe.status)} body=""`);
    }
  });
});

// ---------------------------------------------------------------------------
// A9.4–A9.7 — the node adapter
// ---------------------------------------------------------------------------

describe('the node adapter and a stream body (frozen: pipeline/SPEC.md A3, A9.4-A9.7)', () => {
  // §A3's loop: one `write` per chunk, in order, then `end()` with no argument. The in-flight
  // count is the non-materialising claim measured rather than proxied — the adapter pulls the
  // next chunk only after handing the previous one to `write`, so a source that has produced
  // more chunks than the sink has written is a source being drained into memory. Retained heap
  // was the alternative and is not usable here: vitest runs without `--expose-gc`, so a heap
  // reading is a number with a garbage collector's schedule in it.
  //
  // actual today: `expected [] to deeply equal [ 'abc', 'def' ]` — `write` is never called. The
  // cause is one line further on and is asserted here too: `send` calls `res.end(response.body)`
  // unconditionally, so `endShape(state.endArg)` is `body wrapper kind=stream` and the stream is
  // handed to `end` and never read. Nothing is materialised because nothing is sent.
  it.fails('streams a response through the Node adapter without materialising it', async () => {
    const { stream, log } = countingSource([encoder.encode('abc'), encoder.encode('def')]);
    const { res, state } = nodeDouble();
    let maxInFlight = 0;
    const observed = stream.pipeThrough(
      new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform(chunk, controller) {
          maxInFlight = Math.max(maxInFlight, log.pulls - state.writes.length);
          controller.enqueue(chunk);
        },
      }),
    );
    const response: FrozenResponse = {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: { kind: 'stream', value: observed, length: 6 },
    };
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(state.writes.map(chunk => new TextDecoder().decode(chunk))).toEqual(['abc', 'def']);
    expect(state.endCalls).toBe(1);
    expect(endShape(state.endArg)).toBe('no body');
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  // §A3: "Backpressure is the `write` return value, not a hope." The double refuses the first
  // write and only releases the adapter when `drain` fires, so if the adapter ignores the
  // return value the second chunk is written before the assertion below runs.
  //
  // actual today: writes = [], events = [] — no `write` call to return `false` from and no
  // `drain` listener registered, so the assertion that reaches a verdict first is
  // `expect(state.writes.length).toBe(1)` with `received 0`.
  it.fails('suspends production until drain when write returns false', async () => {
    const { stream } = countingSource([encoder.encode('one'), encoder.encode('two')]);
    const { res, state, fire } = nodeDouble({ writeFalseAt: 1 });
    const response: FrozenResponse = {
      status: 200,
      headers: {},
      body: { kind: 'stream', value: stream, length: undefined },
    };
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.writes.length, 'stopped after the refused write').toBe(1);
    expect(state.events, 'registered a drain listener').toContain('drain');
    fire('drain');
    await state.done;
    expect(state.writes.length).toBe(2);
  });

  // §A3: a client disconnect cancels the *reader*, which is what propagates to the source's
  // `cancel` and closes a file descriptor. Cancelling the stream instead, or nothing at all,
  // leaves the descriptor open — which is `../static/SPEC.md` §4's prerequisite.
  //
  // actual today: cancels = 0, and `end` has already been called once with the body object, so
  // there is no loop in flight for a 'close' listener to interrupt. `state.events` is `[]`.
  it.fails('cancels the stream when the client disconnects', async () => {
    const { stream, log } = countingSource([encoder.encode('a'), encoder.encode('b'), encoder.encode('c')]);
    const { res, state, fire } = nodeDouble({ writeFalseAt: 1 });
    const response: FrozenResponse = {
      status: 200,
      headers: {},
      body: { kind: 'stream', value: stream, length: undefined },
    };
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.events, 'registered a close listener').toContain('close');
    fire('close');
    await Promise.resolve();
    await Promise.resolve();
    expect(log.cancels, 'the source was cancelled once').toBe(1);
  });

  // §A3: "`HEAD`, `204` and `304` send headers and no body, and cancel the stream." A handler
  // cannot know it was reached by a `HEAD`, so the adapter is the only place this can be
  // decided, and a stream created and never read is a leaked descriptor.
  //
  // actual today: `HEAD: expected 'body wrapper kind=stream' to be 'no body'`. `writes` is `[]`
  // for all three, so the first assertion passes for the wrong reason — nothing is written
  // because nothing is streamed — and the verdict is reached on the `end` argument. The 204 and
  // 304 cases hand a body-shaped argument to a status that forbids a body, and `cancels` is 0 for
  // all three, so each of these three requests leaks the descriptor behind the stream.
  it.fails('sends headers and no body for HEAD, 204 and 304, and cancels the stream', async () => {
    for (const probe of [
      { label: 'HEAD', method: 'HEAD', status: 200 },
      { label: '204', method: 'GET', status: 204 },
      { label: '304', method: 'GET', status: 304 },
    ]) {
      const { stream, log } = countingSource([encoder.encode('body')]);
      const { res, state } = nodeDouble();
      const response: FrozenResponse = {
        status: probe.status,
        headers: {},
        body: { kind: 'stream', value: stream, length: 4 },
      };
      toNodeHandler(routerAnswering(response))(new FakeReq(probe.method, '/x'), res);
      await state.done;
      expect(state.writes, probe.label).toEqual([]);
      expect(endShape(state.endArg), probe.label).toBe('no body');
      expect(log.cancels, probe.label).toBe(1);
    }
  });

  // §A3's genuinely hard case, and the one with no good answer: once the first byte is on the
  // wire there is no status left to send. The chosen answer is `destroy()` and never `end()`,
  // because under chunked framing omitting the terminating zero-length chunk is the only
  // in-protocol way to say "this response is incomplete". Appending an error object to the body
  // would be a value a JSON consumer parses as data.
  //
  // actual today: `stream` does not exist, so the wrapper that reports to `onError` does not
  // exist either. The recorded actual is the boundary's refusal:
  //   Error: @zmdb/web exports no "stream" (frozen: pipeline/SPEC.md A2/A6)
  it.fails('ends the connection and logs when the stream errors after headers are sent', async () => {
    const stream = await frozenExport<FrozenStreamFactory>('stream');
    const errors: unknown[] = [];
    const response = stream(throwingSource([encoder.encode('first')]), {
      onError: error => {
        errors.push(error);
      },
    });
    const { res, state } = nodeDouble();
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(state.writes.length, 'the first chunk shipped').toBe(1);
    expect(errors.length, 'onError called exactly once').toBe(1);
    expect(state.destroyCalls, 'destroyed').toBe(1);
    expect(state.endCalls, 'never ended').toBe(0);
  });

  // §A3: "An error thrown _before_ the first byte is unchanged from today: a normal 500." The
  // discriminator is whether headers have been written, so a source that errors on its first
  // pull must still be a JSON 500 — the existing path, not the destroy path.
  //
  // actual today: Error: @zmdb/web exports no "stream" (frozen: pipeline/SPEC.md A2/A6)
  //
  // Recorded so the reason for the red is not mistaken for the claim: this is the one item in
  // §A3 whose answer is "what happens now", and it is asserted here because the slice that adds
  // the destroy path is the slice that can extend it one chunk too far.
  it.fails('answers 500 for a stream that throws before the first chunk', async () => {
    const stream = await frozenExport<FrozenStreamFactory>('stream');
    const errors: unknown[] = [];
    const response = stream(throwingSource([]), {
      onError: error => {
        errors.push(error);
      },
    });
    const { res, state } = nodeDouble();
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(state.status).toBe(500);
    expect(state.destroyCalls).toBe(0);
    expect(state.endCalls).toBe(1);
    expect(JSON.parse(String(state.endArg))).toEqual({ error: 'source exploded mid-stream' });
    expect(errors.length).toBe(1);
  });
});

describe('content-length and framing (frozen: pipeline/SPEC.md A5, A9.7)', () => {
  // §A5: a `bytes` body's `content-length` is set *after* merging the handler's headers, so a
  // handler-supplied value cannot survive. This is not cosmetic — behind a proxy that trusts it,
  // a `content-length` that disagrees with the payload is a request-smuggling primitive.
  //
  // actual today: `expected '99' to be '4'` — the handler's wrong value is the only one there,
  // and `endShape(state.endArg)` is `body wrapper kind=bytes` rather than `bytes(4)`.
  it.fails('overrides a handler-supplied content-length with the real byte length', async () => {
    const value = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const response: FrozenResponse = {
      status: 200,
      headers: { 'content-length': '99', 'content-type': 'application/octet-stream' },
      body: { kind: 'bytes', value },
    };
    const { res, state } = nodeDouble();
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(state.headers['content-length']).toBe('4');
    expect(state.endArg).toEqual(value);
  });

  // §A5: a `stream` with a declared `length` that under-delivers is the destroy path with its
  // own `onError` report, "because a response that under-delivers a declared length is
  // indistinguishable to a cache from a truncated one it may store".
  //
  // actual today: Error: @zmdb/web exports no "stream" (frozen: pipeline/SPEC.md A2/A6)
  it.fails('destroys the connection when a stream under-delivers its declared length', async () => {
    const stream = await frozenExport<FrozenStreamFactory>('stream');
    const errors: unknown[] = [];
    const { stream: source } = countingSource([encoder.encode('short')]);
    const response = stream(source, {
      length: 4096,
      onError: error => {
        errors.push(error);
      },
    });
    const { res, state } = nodeDouble();
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(state.headers['content-length']).toBe('4096');
    expect(state.destroyCalls).toBe(1);
    expect(state.endCalls).toBe(0);
    expect(errors.length).toBe(1);
  });

  // §A5: a `stream` with no `length` sends no `content-length` and is framed chunked. "Do not
  // guess." A handler-supplied `transfer-encoding` is dropped in the same breath, because
  // framing belongs to the adapter and a handler that sets it is describing a body it did not
  // encode.
  //
  // actual today: `expected [ 'transfer-encoding' ] to not include 'transfer-encoding'`. The
  // `content-length` half already passes, and passes for the wrong reason — there is no
  // `content-length` because nothing in the adapter sets one, not because the adapter decided not
  // to. The verdict is reached on the framing header, which survives the handler verbatim.
  it.fails('sends no content-length for a stream with no length, and drops transfer-encoding', async () => {
    const { stream } = countingSource([encoder.encode('chunk')]);
    const response: FrozenResponse = {
      status: 200,
      headers: { 'transfer-encoding': 'chunked' },
      body: { kind: 'stream', value: stream, length: undefined },
    };
    const { res, state } = nodeDouble();
    toNodeHandler(routerAnswering(response))(new FakeReq('GET', '/x'), res);
    await state.done;
    expect(Object.keys(state.headers)).not.toContain('content-length');
    expect(Object.keys(state.headers)).not.toContain('transfer-encoding');
  });
});

// ---------------------------------------------------------------------------
// A9.8, A9.9 — the fetch adapter and reading a body back
// ---------------------------------------------------------------------------

describe('the fetch adapter and all three arms (frozen: pipeline/SPEC.md A4, A9.8)', () => {
  // §A4 is a three-case `switch` that hands `body.value` straight to `new Response`, verified in
  // the spec to compile for all three arms with no cast. The runtime owns backpressure and
  // cancellation, which is a reason to prefer this adapter and not a gap.
  //
  // actual today, all three: the response body arrives as the string
  //   [object Object]
  // — `new Response(response.body)` stringifies the wrapper object, so a byte body and a stream
  // body both ship fifteen bytes of nothing. That is the failure mode worth recording: it is a
  // 200 with a plausible-looking body, not an error.
  it.fails('streams a response through the fetch adapter', async () => {
    const { stream } = countingSource([encoder.encode('str'), encoder.encode('eam')]);
    const arms: readonly { readonly label: string; readonly body: FrozenResponseBody; readonly expected: string }[] = [
      { label: 'text', body: { kind: 'text', value: 'plain' }, expected: 'plain' },
      { label: 'bytes', body: { kind: 'bytes', value: encoder.encode('bytes') }, expected: 'bytes' },
      { label: 'stream', body: { kind: 'stream', value: stream, length: undefined }, expected: 'stream' },
    ];
    for (const arm of arms) {
      const response: FrozenResponse = { status: 200, headers: {}, body: arm.body };
      const fetched = await toFetchHandler(routerAnswering(response))(new Request('http://x/y'));
      expect(await fetched.text(), arm.label).toBe(arm.expected);
    }
  });
});

describe('bodyText reads a body back (frozen: pipeline/SPEC.md A6, A9.9)', () => {
  // §A6: one place for every consumer that treats the body as a string. `text` verbatim, `bytes`
  // UTF-8 decoded, `stream` drained. It is async because one arm is, and it consumes a stream
  // body — the response is not sendable afterwards, which is why nothing in the adapters uses it.
  //
  // actual today: Error: @zmdb/web exports no "bodyText" (frozen: pipeline/SPEC.md A2/A6)
  it.fails('reads all three body arms back as a string', async () => {
    const bodyText = await frozenExport<FrozenBodyText>('bodyText');
    const { stream } = countingSource([encoder.encode('dra'), encoder.encode('ined')]);
    expect(await bodyText({ status: 200, headers: {}, body: { kind: 'text', value: 'as-is' } })).toBe('as-is');
    // A multi-byte character in the bytes arm, so "UTF-8 decodes" is a claim with a witness.
    expect(await bodyText({ status: 200, headers: {}, body: { kind: 'bytes', value: encoder.encode('café') } })).toBe(
      'café',
    );
    expect(
      await bodyText({ status: 200, headers: {}, body: { kind: 'stream', value: stream, length: undefined } }),
    ).toBe('drained');
  });

  // §A2's `bytes` factory: a byte body goes through the new factory rather than `respond`,
  // because "`respond` assumes no content type and a byte body with no `content-type` is a
  // browser-sniffing hazard rather than a convenience".
  //
  // actual today: Error: @zmdb/web exports no "bytes" (frozen: pipeline/SPEC.md A2/A6)
  it.fails('builds a bytes response through the bytes factory', async () => {
    const bytes = await frozenExport<FrozenBytesFactory>('bytes');
    const response = bytes(new Uint8Array([1, 2, 3]), { status: 201, headers: { 'content-type': 'image/png' } });
    expect(response.status).toBe(201);
    expect(response.body.kind).toBe('bytes');
    expect(response.headers['content-type']).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// A9.10, A9.11 — the request side
// ---------------------------------------------------------------------------

describe('a non-JSON request body reaches rawBody as bytes (frozen: pipeline/SPEC.md A7, A9.10)', () => {
  // §A7: `toNodeHandler` calls `req.setEncoding('utf8')` and accumulates `String(chunk)`, which
  // is correct for JSON and destroys any byte sequence that is not valid UTF-8. This is the
  // assertion `../upload/SPEC.md` §6.1 says would have caught the defect, and it is why uploads
  // are blocked on this section rather than on the response union.
  //
  // actual today: `expected '��AB' to be an instance of Uint8Array`. `rawBody` is a
  // string whose code points are [65533, 65533, 65, 66]; re-encoded as UTF-8 that is
  // [239,191,189,239,191,189,65,66] — two bytes in, six bytes out — and the status is a cheerful
  // 200. Captured by driving the real `toNodeHandler` with the `StringDecoder`-backed `FakeReq`
  // above, which is how `node:http` decodes once `setEncoding` has been called.
  it.fails('carries a non-UTF-8 request body to rawBody with every byte intact', async () => {
    const { router, seen } = bodySpyRouter();
    const raw = new Uint8Array([0xff, 0xfe, 0x41, 0x42]);
    const { res, state } = nodeDouble();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': 'application/octet-stream',
      'content-length': String(raw.length),
    });
    toNodeHandler(router)(request, res);
    request.push(raw);
    await state.done;
    expect(seen.raw).toBeInstanceOf(Uint8Array);
    expect([...(seen.raw instanceof Uint8Array ? seen.raw : [])]).toEqual([0xff, 0xfe, 0x41, 0x42]);
  });

  // The same claim with the bytes split across two chunks, which is where a decoder that
  // buffers a partial sequence and a decoder that does not diverge. `00 E2 9C 93 FF` is cut
  // after the first byte of the three-byte U+2713, so a per-chunk decode mangles the character
  // and a stateful one does not — and neither preserves the trailing `FF`.
  //
  // actual today: `expected [ +0, 10003, 65533 ] to deeply equal [ +0, 226, 156, 147, 255 ]`.
  // Recorded because it contradicted what the probe was written to show: the checkmark *survived*
  // the chunk boundary — the `StringDecoder` carried the partial sequence, exactly as the comment
  // in `toNodeHandler` says it was added to — and five bytes still arrived as three code points
  // because `0xFF` is not decodable at all. So the split is not the bug and never was; the
  // decoding is. The upload spec's §6.1 asks for the straddling case anyway, and this is it.
  it.fails('keeps a byte sequence split across two chunks intact in rawBody', async () => {
    const { router, seen } = bodySpyRouter();
    const raw = new Uint8Array([0x00, 0xe2, 0x9c, 0x93, 0xff]);
    const { res, state } = nodeDouble();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': 'application/octet-stream',
      'content-length': String(raw.length),
    });
    toNodeHandler(router)(request, res);
    request.push(raw.subarray(0, 2), raw.subarray(2));
    await state.done;
    expect([...(seen.raw instanceof Uint8Array ? seen.raw : codePointsOf(seen.raw))]).toEqual([...raw]);
  });

  // Green, and the half §A7 promises does not change: a JSON content type keeps today's exact
  // path — `setEncoding`, string accumulation, `parseJson` — so no existing route changes shape.
  // The slice that adds a bytes path is the slice that can accidentally route JSON through it,
  // and then every `validateBody` in the repository receives a `Uint8Array`.
  it('leaves a JSON request body on the string path', async () => {
    const { router, seen } = bodySpyRouter();
    const raw = encoder.encode(JSON.stringify({ name: 'ada' }));
    const { res, state } = nodeDouble();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': 'application/json',
      'content-length': String(raw.length),
    });
    toNodeHandler(router)(request, res);
    request.push(raw);
    await state.done;
    expect(seen.raw).toEqual({ name: 'ada' });
    expect(state.status).toBe(200);
  });
});

describe('maxBodyBytes (frozen: pipeline/SPEC.md A7, A9.11)', () => {
  // §A7's stated exception to the byte-for-byte promise: there is no request body limit today at
  // all, "which makes every POST route in every deployment an unbounded allocation reachable by
  // one request". Over the limit is a 413 and then the connection is destroyed — destroyed and
  // not drained, per `../upload/SPEC.md` §3, because draining is the resource consumption the
  // limit just refused.
  //
  // The assertion that matters is not the status. It is `seen.raw`: a limit checked after the
  // body is buffered has already lost, so this asserts the router was never reached at all and
  // that the bytes read stopped at the limit.
  //
  // actual today: `a 413, not a 200: expected 200 to be 413`. The router *was* reached and
  // `rawBody` is a 4,194,304-character string — four mebibytes accumulated against a 64-byte
  // limit the adapter has no parameter to receive, and `toNodeHandler.length` is 1.
  it.fails('refuses a request body over maxBodyBytes with a 413 and destroys the connection', async () => {
    const adapt: FrozenNodeAdapter = toNodeHandler;
    const { router, seen } = bodySpyRouter();
    const raw = new Uint8Array(4 * 1024 * 1024).fill(0x41);
    const { res, state } = nodeDouble();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': 'application/octet-stream',
      'content-length': String(raw.length),
    });
    adapt(router, { maxBodyBytes: 64 })(request, res);
    request.push(raw);
    await state.done;
    expect(state.status, 'a 413, not a 200').toBe(413);
    expect(seen.raw, 'the router was never reached').toBe('never handled');
    expect(state.destroyCalls, 'the connection was destroyed, not drained').toBe(1);
  });

  // §A7: the limit defaults to 1 MiB. A deployment that needs more than a megabyte of JSON
  // raises it; the absence of a limit "cannot be fixed by the person it hurts". The default is
  // asserted separately from the configured case because a slice that reads the option but
  // forgets the default leaves every deployment that did not configure one unbounded.
  //
  // actual today: `expected 200 to be 413`, with a 2,097,152-character `rawBody` — no default,
  // no limit, no parameter.
  it.fails('defaults maxBodyBytes to 1 MiB when no option is given', async () => {
    const { router, seen } = bodySpyRouter();
    const raw = new Uint8Array(2 * 1024 * 1024).fill(0x41);
    const { res, state } = nodeDouble();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': 'application/octet-stream',
      'content-length': String(raw.length),
    });
    toNodeHandler(router)(request, res);
    request.push(raw);
    await state.done;
    expect(state.status).toBe(413);
    expect(seen.raw).toBe('never handled');
  });

  // §A7 and the epic's "bounded by construction": every limit has a safe default that cannot be
  // removed, only raised. `0` and `Infinity` are the two clever ways to disable a check and
  // both are construction errors, as is a non-integer.
  //
  // actual today: `0: expected [Function] to throw an error` — it fails on the first row and none
  // of the four throws. `toNodeHandler.length` is 1, the second argument is ignored entirely, and
  // each call returns a working handler, which is the shape of a limit that can be removed.
  it.fails('rejects a maxBodyBytes of 0, Infinity, a negative and a non-integer', () => {
    const adapt: FrozenNodeAdapter = toNodeHandler;
    const { router } = bodySpyRouter();
    for (const maxBodyBytes of [0, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => adapt(router, { maxBodyBytes }), String(maxBodyBytes)).toThrow();
    }
    // Raising it is the supported operation and must not throw.
    expect(() => adapt(router, { maxBodyBytes: 64 * 1024 * 1024 })).not.toThrow();
  });
});
