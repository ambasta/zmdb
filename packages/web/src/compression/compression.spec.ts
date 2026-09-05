import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { text, type AnyCtx, type WebResponse } from '../index.js';

// Response-compression acceptance for epic #564 (spec freeze #565). The frozen text is
// `./SPEC.md`, and this file is its §10 list item by item. §10 item 1 — no `br` in
// `ContentCoding` — is a compile-time claim in `./compression.type-test.ts`.
//
// `TextEncoder` and `Uint8Array` throughout and never `Buffer`, per §9 and `.oxlintrc.json`.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// `AnyCtx` is part of the public compression signature; the type test pins its exact shape.

type FrozenTextBody = { readonly kind: 'text'; readonly value: string };
type FrozenBytesBody = { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> };
type FrozenStreamBody = {
  readonly kind: 'stream';
  readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly length: number | undefined;
};
type FrozenResponseBody = FrozenTextBody | FrozenBytesBody | FrozenStreamBody;

/**
 * §A1's `WebResponse`, as the real one plus the one field whose type changes.
 *
 * `Omit<WebResponse, 'body'>` is load-bearing and is the only widening here: rename `status` or
 * `headers` on the real interface and this file stops compiling instead of quietly asserting a
 * shape nobody has. `../pipeline/streaming.type-test.ts` pins those two fields so the intersection
 * cannot rot silently.
 */
type FrozenResponse = Omit<WebResponse, 'body'> & { readonly body: FrozenResponseBody };

interface FrozenCompressionOptions {
  readonly minBytes?: number;
  readonly types?: readonly string[];
  readonly skip?: (response: FrozenResponse, ctx: AnyCtx) => boolean;
}

type FrozenCompress = (response: FrozenResponse, ctx: AnyCtx, options?: FrozenCompressionOptions) => FrozenResponse;

// ---------------------------------------------------------------------------
// The one boundary
// ---------------------------------------------------------------------------

/**
 * Resolve `compress` off the real package barrel.
 *
 * The dynamic lookup keeps a missing barrel export as one focused assertion instead of a
 * link-time failure that prevents the negotiation table from reporting.
 */
async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('../index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/web exports no "${name}" (frozen: compression/SPEC.md 2)`);
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const utf8 = new TextEncoder();

/**
 * A payload comfortably over the 1024-byte default and genuinely compressible, with a multi-byte
 * character in it — §10.6 requires the round-trip to hold for one, and a byte-oriented compressor
 * that re-encodes rather than passing bytes through is what that catches.
 */
const LONG = `${'the quick brown fox jumps over the lazy dog. '.repeat(40)}✓ éè \u{1f600}`;

function textResponse(headers: Readonly<Record<string, string>> = {}, value = LONG): FrozenResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/plain', ...headers },
    body: { kind: 'text', value },
  };
}

function bytesResponse(value: Uint8Array<ArrayBuffer>, headers: Readonly<Record<string, string>>): FrozenResponse {
  return { status: 200, headers, body: { kind: 'bytes', value } };
}

/** A `stream` body over the given chunks, with an explicitly declared `length`. */
function streamResponse(
  chunks: readonly Uint8Array<ArrayBuffer>[],
  length: number | undefined,
  headers: Readonly<Record<string, string>> = { 'content-type': 'application/json' },
): FrozenResponse {
  const value = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return { status: 200, headers, body: { kind: 'stream', value, length } };
}

function ctxFor(headers: Readonly<Record<string, string>> = {}, method = 'GET'): AnyCtx {
  return { params: {}, body: undefined, query: {}, headers, method, path: '/report' };
}

function accepting(encoding: string, method = 'GET'): AnyCtx {
  return ctxFor({ 'accept-encoding': encoding }, method);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function drain(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    chunks.push(next.value);
  }
  return concat(chunks);
}

async function bodyBytes(body: FrozenResponseBody): Promise<Uint8Array<ArrayBuffer>> {
  if (body.kind === 'text') {
    return utf8.encode(body.value);
  }
  if (body.kind === 'bytes') {
    return body.value;
  }
  return drain(body.value);
}

/** Inflate a compressed body back to bytes — §10.6's round-trip, using the platform's own decoder. */
async function inflate(body: FrozenResponseBody, coding: 'gzip' | 'deflate'): Promise<Uint8Array<ArrayBuffer>> {
  const source =
    body.kind === 'stream'
      ? body.value
      : new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            void bodyBytes(body).then(bytes => {
              controller.enqueue(bytes);
              controller.close();
            });
          },
        });
  return drain(source.pipeThrough(new DecompressionStream(coding)));
}

/**
 * The negotiation outcome as one comparable string: the status, the chosen coding, whether `vary`
 * was set, and whether a `content-length` survived. §4 and §7 are a joint claim — a coding chosen
 * without a `vary` is a cache-poisoning bug and a coding chosen with the original
 * `content-length` is a truncated response — so they are asserted together rather than one test
 * per header, which is also what makes a failure show which half moved.
 */
function outcome(response: FrozenResponse): string {
  const encoding = response.headers['content-encoding'] ?? 'none';
  const vary = response.headers['vary'] ?? 'none';
  const length = response.headers['content-length'] ?? 'none';
  return `${String(response.status)} encoding=${encoding} vary=${vary} length=${length}`;
}

// ---------------------------------------------------------------------------

describe('the module (frozen: compression/SPEC.md 2)', () => {
  // Pin both source modules and the curated package-barrel exports.
  it('exists as a module and exports both halves of the split', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(0);
    expect(typeof (await frozenExport<FrozenCompress>('compress'))).toBe('function');
    expect(typeof (await frozenExport<unknown>('compressionInterceptor'))).toBe('function');
  });

  // §3's whole argument for declining brotli is that `node:zlib` would make the middleware
  // Node-only "in a package whose response model was just designed so that `toFetchHandler` works
  // on any Fetch runtime", and that "a feature that silently does nothing on half the supported
  // runtimes is worse than a feature that is documented as absent". The import is the only
  // observable form of that claim — a `node:zlib` compressor produces byte-identical gzip, so no
  // behavioural test can tell the two apart, and it would pass on this Node either way.
  //
  // `.oxlintrc.json` bans the `Buffer` global and the `node:buffer` and `node:crypto` imports but
  // says nothing about `node:zlib`, so this test is the only gate on §3's decision. It is a
  // source-text assertion, which is weaker than the rest of this file; it is narrowed to the import
  // form rather than the word `zlib` so that a comment explaining why the module does not use it
  // cannot fail it. The positive half — that a `CompressionStream` is what is used instead — is
  // what stops the claim being satisfiable by a module that compresses nothing at all.
  it('imports no Node-only compressor', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+'node:zlib'/);
    expect(source).toMatch(/new CompressionStream\(/);
  });

  it('preserves handler-controlled responses through both public entry points', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const marker = Symbol.for('zmdb.web.response');
    const direct = compress(text(LONG), accepting('gzip'));
    expect(marker in direct).toBe(true);

    const interceptor = await frozenExport<
      () => {
        intercept(ctx: AnyCtx, next: () => Promise<unknown>): Promise<unknown>;
      }
    >('compressionInterceptor').then(create => create());
    const intercepted = await interceptor.intercept(accepting('gzip'), () => Promise.resolve(text(LONG)));
    expect(typeof intercepted === 'object' && intercepted !== null && marker in intercepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10.2 — negotiating Accept-Encoding
// ---------------------------------------------------------------------------

describe('negotiation (frozen: compression/SPEC.md 4, 10.2)', () => {
  // Every row of §4, one test each. The adversarial rows first, because they are the ones a
  // negotiation written as `accept.includes('gzip')` gets wrong — which is exactly what the
  // `web-compression.md` docs page shows a reader today.
  it.each([
    // §4.1: `q=0` is *forbidden*, not merely unpreferred — and it is the row `includes('gzip')`
    // fails on, sending gzip to a client that explicitly refused it.
    ['gzip;q=0', 'none'],
    // §4.1 again: "removed from consideration even if it appears again". A repeated coding with a
    // zero and a non-zero q is what a proxy chain produces, and the refusal has to win.
    ['gzip;q=0, gzip', 'none'],
    ['gzip, gzip;q=0', 'none'],
    // §4.2: order by the client's q, so a client that prefers deflate gets deflate even though
    // gzip is our own preference.
    ['deflate;q=1.0, gzip;q=0.5', 'deflate'],
    // §4.2's tie-break: equal q resolves to gzip, "because it is universally supported and
    // slightly cheaper than `deflate` for the same output".
    ['gzip, deflate', 'gzip'],
    ['deflate, gzip', 'gzip'],
    ['deflate;q=0.7, gzip;q=0.7', 'gzip'],
    // §4.3: `*` matches any coding not otherwise named, with its own q. Here gzip is named at a
    // low q and `*` covers deflate at a high one, so deflate wins — a wildcard implemented as
    // "anything goes, pick our favourite" answers gzip and is wrong.
    ['gzip;q=0.1, *;q=1.0', 'deflate'],
    ['*', 'gzip'],
    // §4.1 and §4.3 together: a named exclusion beats the wildcard that would otherwise allow it.
    ['*, gzip;q=0', 'deflate'],
    // A coding we cannot produce, with identity still acceptable: no compression, not a 406.
    ['br', 'none'],
    ['zstd, br', 'none'],
    // Whitespace and case, which is what a hand-written header from a test client looks like.
    // §4 does not state either rule. RFC 9110 §8.4.1 makes a content coding case-insensitive and
    // §5.6.1's list production allows optional whitespace around the delimiters, so these rows
    // resolve the gap toward the RFC rather than toward whichever way the first implementation
    // happens to fall — recorded as a spec gap rather than left for a slice to decide silently.
    ['GZIP', 'gzip'],
    ['  gzip ;  q=0.9  ', 'gzip'],
    ['gzip;Q=0', 'none'],
  ])('answers %s with %s', async (header: string, coding: string) => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse(), accepting(header));
    expect(result.headers['content-encoding'] ?? 'none').toBe(coding);
    // §7: `vary` is present either way, which is the assertion §10.5 makes separately and is
    // repeated here so a row that regresses cannot take the cache header with it silently.
    expect(result.headers['vary']).toBe('accept-encoding');
  });

  // §4.5: "A missing `Accept-Encoding` means no compression. It does not mean `identity;q=0` and it
  // does not mean gzip is safe to assume." Its own test because the two wrong answers are
  // opposite — assuming gzip breaks an old client, and answering 406 breaks every client — and a
  // row in the table above could not assert both.
  it('does not compress and does not answer 406 when Accept-Encoding is absent', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse(), ctxFor({}));
    expect(outcome(result)).toBe('200 encoding=none vary=accept-encoding length=none');
  });

  // §4.4: the one path where this middleware changes the status. The client said uncompressed is
  // unacceptable and we cannot satisfy anything it will accept, so RFC 9110 §12.5.3's answer is a
  // `406` with an empty body. §4 calls it "a real client configuration rather than a hypothetical",
  // and each row is a different way of saying it.
  it.each([['identity;q=0'], ['identity;q=0, br'], ['*;q=0'], ['*;q=0, br;q=1'], ['identity;q=0, *;q=0']])(
    'answers 406 for %s',
    async (header: string) => {
      const compress = await frozenExport<FrozenCompress>('compress');
      const result = compress(textResponse(), accepting(header));
      expect(result.status).toBe(406);
      expect((await bodyBytes(result.body)).length).toBe(0);
    },
  );

  // The inverse, so the `406` rows are not satisfied by a middleware that answers 406 whenever it
  // sees the word `identity`: a client that forbids identity but accepts gzip gets gzip, because
  // there *is* something satisfiable. This is the row that separates "nothing acceptable remains"
  // from "identity was excluded".
  it('compresses rather than answering 406 when identity is refused but gzip is offered', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse(), accepting('identity;q=0, gzip'));
    expect(result.status).toBe(200);
    expect(result.headers['content-encoding']).toBe('gzip');
  });
});

// ---------------------------------------------------------------------------
// §10.3, §10.7, §10.8 — the skip list
// ---------------------------------------------------------------------------

describe('when compression is skipped (frozen: compression/SPEC.md 5, 6, 10.3, 10.7, 10.8)', () => {
  // §5's refusals, one row each, in §5's own order. Every one is "a refusal rather than a
  // preference", and the table is the only form in which a reader can check that none went missing.
  it.each([
    // §5: a 204, a 304 and any 1xx have no body to compress.
    ['a 204', { status: 204, headers: { 'content-type': 'text/plain' } }],
    ['a 304', { status: 304, headers: { 'content-type': 'text/plain' } }],
    ['a 100', { status: 100, headers: { 'content-type': 'text/plain' } }],
    // §6: a type not in the allow-list. `image/png` is §10.7's row and is already compressed, so
    // inflating it spends CPU on a payload that gets bigger.
    ['an image/png', { status: 200, headers: { 'content-type': 'image/png' } }],
    ['a video/mp4', { status: 200, headers: { 'content-type': 'video/mp4' } }],
    ['an application/zip', { status: 200, headers: { 'content-type': 'application/zip' } }],
    // §6: "A response with no `content-type` at all — which `respond()` produces on purpose — is
    // not compressed. Guessing the type of a body whose author declined to declare one is exactly
    // the sniffing this package refuses to do elsewhere." §10.7's second row.
    ['no content-type at all', { status: 200, headers: {} }],
  ])('skips %s', async (_case: string, shape: { status: number; headers: Record<string, string> }) => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const response: FrozenResponse = { ...shape, body: { kind: 'text', value: LONG } };
    const result = compress(response, accepting('gzip'));
    expect(result.headers['content-encoding']).toBeUndefined();
    // §7: the `vary` is still there. This is the half that §10.5 is about and the half that a
    // "return the response untouched" early exit drops.
    expect(result.headers['vary']).toBe('accept-encoding');
  });

  // §10.4: an already-set `content-encoding` "is never touched, including `identity`". `identity`
  // is the row that matters: it is a legal value that means "not encoded", so a middleware that
  // tests `content-encoding !== undefined` skips it correctly and one that tests for a *known*
  // coding re-encodes it and produces a response no client can decode. §5's words are "Something
  // upstream encoded this body and re-encoding it is a bug, not double the compression."
  it.each([['gzip'], ['deflate'], ['identity'], ['br'], ['gzip, deflate']])(
    'never re-encodes a body already marked %s',
    async (existing: string) => {
      const compress = await frozenExport<FrozenCompress>('compress');
      const response = bytesResponse(utf8.encode(LONG), {
        'content-type': 'text/plain',
        'content-encoding': existing,
        'content-length': '99',
      });
      const result = compress(response, accepting('gzip'));
      expect(result.headers['content-encoding']).toBe(existing);
      // Untouched means untouched: the bytes and the framing the upstream chose both survive.
      expect([...(await bodyBytes(result.body))]).toEqual([...utf8.encode(LONG)]);
      expect(result.headers['content-length']).toBe('99');
      expect(result.headers['vary']).toBe('accept-encoding');
    },
  );

  // §10.8: a `HEAD` request is not compressed. §5's reason is the one that is easy to miss — the
  // body will not be sent, so compressing wastes the work *and*, worse, "produces a
  // `content-length` for a representation that never ships", which is a client waiting for bytes
  // that do not exist.
  it('does not compress a HEAD response', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse(), accepting('gzip', 'HEAD'));
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['vary']).toBe('accept-encoding');
  });

  // §5's `minBytes`, and §10.3's specific demand: "a `stream` with no `length` **is** compressed
  // while one with a `length` under `minBytes` is not". That asymmetry is stated in §5 "so nobody
  // later 'fixes' it by buffering", and it is the single most likely thing to be quietly
  // normalised away, because it looks like an inconsistency until the reason is read: there is no
  // way to learn a stream's size without buffering the thing streaming exists to avoid.
  it('compresses a stream with no length and skips one whose length is under minBytes', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const small = utf8.encode('{"ok":true}');
    const unknownLength = compress(streamResponse([small], undefined), accepting('gzip'));
    expect(unknownLength.headers['content-encoding']).toBe('gzip');
    const knownLength = compress(streamResponse([small], small.length), accepting('gzip'));
    expect(knownLength.headers['content-encoding']).toBeUndefined();
    expect(knownLength.headers['vary']).toBe('accept-encoding');
  });

  // §5's `minBytes` on the two materialised arms, with the boundary asserted rather than a
  // comfortable value either side of it. "Below that the gzip header and dictionary make the
  // output larger, and the CPU is spent for a negative result" — so exactly `minBytes` is
  // compressed and one byte less is not, and an implementation written with `>` instead of `>=`
  // differs from one written the other way on precisely this input.
  it.each([
    ['text', 1023, undefined],
    ['text', 1024, 'gzip'],
    ['bytes', 1023, undefined],
    ['bytes', 1024, 'gzip'],
  ])(
    'applies the default minBytes to a %s body of %i bytes',
    async (kind: string, size: number, coding: string | undefined) => {
      const compress = await frozenExport<FrozenCompress>('compress');
      const filler = 'a'.repeat(size);
      const response =
        kind === 'text'
          ? textResponse({}, filler)
          : bytesResponse(utf8.encode(filler), { 'content-type': 'text/plain' });
      const result = compress(response, accepting('gzip'));
      expect(result.headers['content-encoding']).toBe(coding);
    },
  );

  // §6's allow-list, and the two rows that are not literal entries: "any subtype ending `+json` or
  // `+xml`". A middleware built from an exact-match `Set` passes every literal row and fails these
  // two, which is why they are here — and §6's own argument for an allow-list over a deny-list is
  // that the missing entry costs bandwidth rather than CPU, so getting the suffix rule wrong is
  // the cheap kind of mistake and worth catching anyway.
  it.each([
    ['text/html; charset=utf-8', 'gzip'],
    ['text/css', 'gzip'],
    ['text/plain', 'gzip'],
    ['application/json', 'gzip'],
    ['application/json; charset=utf-8', 'gzip'],
    ['application/javascript', 'gzip'],
    ['application/xml', 'gzip'],
    ['application/xhtml+xml', 'gzip'],
    ['image/svg+xml', 'gzip'],
    ['application/ld+json', 'gzip'],
    ['application/vnd.api+json', 'gzip'],
    ['application/atom+xml', 'gzip'],
    ['image/png', undefined],
    ['application/octet-stream', undefined],
    ['application/pdf', undefined],
    ['font/woff2', undefined],
  ])('treats %s as %s', async (contentType: string, coding: string | undefined) => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse({ 'content-type': contentType }), accepting('gzip'));
    expect(result.headers['content-encoding']).toBe(coding);
  });

  // §10.9: `skip` returning `true` wins over every other condition. §8 names this the escape hatch
  // for BREACH, and an escape hatch that only works when compression was going to be skipped anyway
  // is not one.
  //
  // "Wins over" is not separately observable, and saying so is more useful than a test that pretends
  // otherwise. Every item in §5 is a refusal, and `skip` is listed *last* in §5's order, so the
  // decision is an OR over seven refusals and the answer is the same whatever order they are
  // evaluated in. The only difference an implementation can show is whether `skip` is *called* when
  // an earlier refusal already applies — and §5's ordering says it is not, while §10.9's wording
  // reads as though it is. This test therefore asserts the part that is real: on a response that
  // would otherwise be compressed, `skip` is consulted exactly once, receives the real response and
  // ctx, and its `true` is honoured. It deliberately does not assert a call count on an
  // already-refused response, because both answers are defensible under the frozen text.
  it('lets skip win over every other condition', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const calls: string[] = [];
    const skip = (response: FrozenResponse, ctx: AnyCtx): boolean => {
      calls.push(`${String(response.status)} ${ctx.method}`);
      return true;
    };
    const result = compress(textResponse(), accepting('gzip'), { skip });
    expect(result.headers['content-encoding']).toBeUndefined();
    // §7's `vary` still applies: the header was examined, so the response depended on it.
    expect(result.headers['vary']).toBe('accept-encoding');
    // §8: `skip` "takes the response so a handler can mark its own output however it likes", which
    // is only true if the response it is given is the real one.
    expect(calls).toEqual(['200 GET']);
    // And `false` does not force compression past a refusal — `skip` is a veto, not a switch.
    const forced = compress(textResponse({ 'content-type': 'image/png' }), accepting('gzip'), { skip: () => false });
    expect(forced.headers['content-encoding']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §10.5, §10.6 — headers and the round-trip
// ---------------------------------------------------------------------------

describe('headers after compressing (frozen: compression/SPEC.md 7, 10.5, 10.6)', () => {
  // §10.5, and §7 calls it "the detail that matters most and the one most often got wrong":
  // without `Vary`, a shared cache stores whichever representation it saw first and serves gzip
  // bytes to a client that cannot decode them. The header describes what the response *depended
  // on*, not what happened, so a skipped compression still varies. Every row above asserts this in
  // passing; this test is the one that says it on its own, so a reader looking for §10.5 finds it.
  it('sends vary: accept-encoding on a response it chose not to compress', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const skipped = compress(textResponse({ 'content-type': 'image/png' }), accepting('gzip'));
    expect(skipped.headers['vary']).toBe('accept-encoding');
    const noHeader = compress(textResponse(), ctxFor({}));
    expect(noHeader.headers['vary']).toBe('accept-encoding');
  });

  // §7 says the header is **appended**, and that word is the claim. A response that already varies
  // on something else — a localised page varying on `accept-language`, which is the common case —
  // must end up varying on both. A middleware that assigns rather than appends silently turns a
  // correctly-cached localised response into one cache entry for every language, served to
  // everybody.
  it('appends to an existing vary rather than replacing it', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse({ 'content-type': 'text/html', vary: 'accept-language' }), accepting('gzip'));
    const vary = (result.headers['vary'] ?? '').split(',').map(part => part.trim().toLowerCase());
    expect(vary).toContain('accept-language');
    expect(vary).toContain('accept-encoding');
    // And it does not accumulate a duplicate when it is already there.
    const twice = compress(textResponse({ 'content-type': 'text/html', vary: 'accept-encoding' }), accepting('gzip'));
    expect(
      (twice.headers['vary'] ?? '')
        .toLowerCase()
        .split(',')
        .filter(part => part.includes('encoding')).length,
    ).toBe(1);
  });

  // §10.6's first half. §7: "`content-length` is removed and not recomputed. The compressed length
  // is not known until the stream ends, and the framing rules in `../pipeline/SPEC.md` §A5 already
  // produce a chunked response when no length is present. Keeping the original length is a
  // truncated response; buffering to compute the new one defeats the point." All three outcomes
  // are distinguishable here: the original value surviving, a recomputed value, and absence.
  //
  // `etag` is asserted in the same test because §7's reason ties them together — a weak validator
  // is allowed to identify several representations of the same resource, which is exactly the
  // relationship between the coded and uncoded forms, and it is why `../static/SPEC.md` §6 does
  // not claim a strong one.
  it('removes content-length without recomputing it, and leaves etag alone', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const original = utf8.encode(LONG);
    const response = bytesResponse(original, {
      'content-type': 'text/plain',
      'content-length': String(original.length),
      etag: 'W/"1234-5678"',
    });
    const result = compress(response, accepting('gzip'));
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers['etag']).toBe('W/"1234-5678"');
    // §9: a `text` or `bytes` body becomes a single-chunk stream through `CompressionStream`, so
    // the resulting arm is a `stream` with `length: undefined` — which is what makes the framing
    // rules in §A5 produce a chunked response rather than a wrong one.
    expect(result.body.kind).toBe('stream');
    if (result.body.kind === 'stream') {
      expect(result.body.length).toBeUndefined();
    }
  });

  // §10.6's second half: the compressed body round-trips through a `DecompressionStream` back to
  // the original bytes, "including for a multi-chunk source and for a body containing a multi-byte
  // character". Both are here, and both are load-bearing. A multi-chunk source is where a
  // compressor that resets its dictionary per chunk produces output that inflates to a truncated
  // body; a multi-byte character is where a compressor that round-trips through a string re-encodes
  // and changes the bytes. The comparison is on numbers rather than on the views so a failure
  // prints the differing byte instead of two typed-array dumps.
  it.each([['gzip'], ['deflate']])('round-trips a multi-chunk body through %s', async (coding: string) => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const chunks = [utf8.encode(LONG), utf8.encode('✓ second chunk '), utf8.encode(LONG)];
    const expected = concat(chunks);
    const result = compress(streamResponse(chunks, undefined), accepting(coding));
    expect(result.headers['content-encoding']).toBe(coding);
    expect(result.body.kind).toBe('stream');
    if (result.body.kind !== 'stream') {
      return;
    }
    // A ReadableStream is single-consumer. Tee once so the test can independently prove both
    // round-trip correctness and that the encoded representation is smaller.
    const [forInflation, forSize] = result.body.value.tee();
    const inflated = await drain(
      forInflation.pipeThrough(new DecompressionStream(coding === 'deflate' ? 'deflate' : 'gzip')),
    );
    expect([...inflated]).toEqual([...expected]);
    // And the compression actually did something — a "compressor" that passes bytes through and
    // sets the header would satisfy the round-trip and break every client.
    const compressed = await drain(forSize);
    expect(compressed.length).toBeLessThan(expected.length);
  });

  it('round-trips a text body containing multi-byte characters', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const result = compress(textResponse(), accepting('gzip'));
    const inflated = await inflate(result.body, 'gzip');
    expect(new TextDecoder().decode(inflated)).toBe(LONG);
  });

  it('emits compressed bytes before the source produces its final chunk', { timeout: 2000 }, async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    let releaseFinal = (): void => undefined;
    const finalAllowed = new Promise<void>(resolve => {
      releaseFinal = resolve;
    });
    let markFinalPull = (): void => undefined;
    const finalPullStarted = new Promise<void>(resolve => {
      markFinalPull = resolve;
    });
    let pulls = 0;
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(utf8.encode('a'.repeat(128 * 1024)));
          return;
        }
        markFinalPull();
        await finalAllowed;
        controller.enqueue(utf8.encode('last'));
        controller.close();
      },
    });
    const result = compress(
      {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: { kind: 'stream', value: source, length: undefined },
      },
      accepting('gzip'),
    );
    expect(result.body.kind).toBe('stream');
    if (result.body.kind !== 'stream') {
      return;
    }
    const reader = result.body.value.getReader();
    const firstRead = reader.read();
    await finalPullStarted;
    const first = await firstRead;
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);
    releaseFinal();
    while (!(await reader.read()).done) {
      // drain
    }
  });
});

// ---------------------------------------------------------------------------
// §10.10 — a failure mid-stream
// ---------------------------------------------------------------------------

describe('a source that fails mid-stream (frozen: compression/SPEC.md 9, 10.10)', () => {
  // §10.10: "A source that throws mid-stream calls the response's `onError` once and destroys the
  // connection; the compressor does not swallow it." §9's reason is that a compression failure and
  // a source failure "are the same event to the client", so the middleware must not introduce a
  // second sink.
  //
  // What this test asserts is the half that lives in the pure function: the error comes out of the
  // *compressed* stream rather than being absorbed by the pipe, and `onError` fires exactly once
  // rather than once per stage. The destroy half is `../pipeline/SPEC.md` §A3's and is asserted by
  // `../pipeline/streaming.spec.ts`'s `ends the connection and logs when the stream errors after
  // headers are sent`; restating it here would produce two tests that retire on one fix, in the
  // file that cannot see a `NodeResLike`.
  //
  // "Exactly once" is the assertion that a naive `pipeThrough` gets wrong: the source's error
  // propagates to the transform's readable *and* to its writable, and a middleware that attaches
  // its own rejection handler as well as passing the original `onError` through calls the sink
  // twice — which turns one incident into two alerts and, in a deployment that pages on the sink,
  // doubles the noise of every client that hangs up.
  it('lets a mid-stream error out of the compressed stream and reports it once', async () => {
    const compress = await frozenExport<FrozenCompress>('compress');
    const seen: unknown[] = [];
    const boom = new Error('source went away');
    const value = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(utf8.encode(LONG));
      },
      pull(controller) {
        controller.error(boom);
      },
    });
    const response: FrozenResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { kind: 'stream', value, length: undefined },
    };
    const result = compress(response, accepting('gzip'), { skip: () => false });
    // The failure is visible to whoever drains the compressed body, not swallowed into an empty
    // but successful response — which would ship a valid gzip trailer over a truncated payload.
    await expect(drain(result.body.kind === 'stream' ? result.body.value : new ReadableStream())).rejects.toThrow(
      'source went away',
    );
    expect(seen.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Platform facts the behavior tests rest on
// ---------------------------------------------------------------------------

describe('the platform under these tests', () => {
  // Green, and the measured basis of §3's entire decision. §3 quotes the throw as its evidence for
  // declining brotli, and if a future Node ever adds `br` to `CompressionFormat` the decision has
  // to be re-argued rather than inherited — so the fact is a passing test rather than a sentence.
  //
  // The message here is the captured one and it differs from `./SPEC.md` §3's quotation by a
  // trailing full stop, which the spec drops. Recorded because a test that quoted the spec would
  // fail today for a reason that has nothing to do with compression.
  it('really cannot construct a brotli or zstd CompressionStream', () => {
    expect(() => new CompressionStream('br' as CompressionFormat)).toThrow(
      /Failed to construct 'CompressionStream': 1st argument (value )?'br' is not a valid enum value of type CompressionFormat\./,
    );
    expect(() => new CompressionStream('zstd' as CompressionFormat)).toThrow(TypeError);
    // And the three §3 says are available, which is where `ContentCoding`'s two values come from —
    // `deflate-raw` is excluded not by the platform but by §3, "because no client asks for it".
    for (const format of ['gzip', 'deflate', 'deflate-raw'] as const) {
      expect(new CompressionStream(format).readable).toBeInstanceOf(ReadableStream);
    }
  });

  // Green. §10.6's round-trip is only a test if `DecompressionStream` is the platform's inverse of
  // `CompressionStream`, and the multi-chunk and multi-byte properties the behavior tests rely on
  // are properties of the platform pair rather than of the middleware.
  it('has a CompressionStream and DecompressionStream that are inverses over multiple chunks', async () => {
    const chunks = [utf8.encode(LONG), utf8.encode('✓\u{1f600}'), utf8.encode(LONG)];
    const expected = concat(chunks);
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const compressed = await drain(source.pipeThrough(new CompressionStream('gzip')));
    expect(compressed.length).toBeLessThan(expected.length);
    const roundTripped = await drain(
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      }).pipeThrough(new DecompressionStream('gzip')),
    );
    expect([...roundTripped]).toEqual([...expected]);
    expect(new TextDecoder().decode(roundTripped)).toContain('\u{1f600}');
  });

  // Green, and it is why `applies the default minBytes to a %s body of %i bytes` uses 1023 and
  // 1024 rather than 10 and 10000: the 1024 default exists because below it "the gzip header and
  // dictionary make the output larger", and that is a measurable claim rather than folklore. If it
  // ever stopped being true the threshold would be worth revisiting, and this is where that shows
  // up.
  it('really does make a short body larger when gzipped', async () => {
    const short = utf8.encode('a'.repeat(64));
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(short);
        controller.close();
      },
    });
    const compressed = await drain(source.pipeThrough(new CompressionStream('gzip')));
    // Not necessarily larger for a maximally repetitive payload, but never worth the CPU: the
    // saving on 64 bytes is bounded by the gzip envelope, which is what the assertion pins.
    expect(compressed.length).toBeGreaterThan(short.length - 48);
  });
});
