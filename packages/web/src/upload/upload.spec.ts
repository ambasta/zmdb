import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { describe, expect, it } from 'vitest';

import { createRouter, text, toNodeHandler, type Router, type WebRequest } from '../index.js';
import { Controller, Post } from '../routing/index.js';

// Multipart uploads. Tests freeze for epic #564 (spec freeze #565); the frozen text is `./SPEC.md`,
// and this file is its §6 list, item by item.
//
// `it.fails` for every frozen claim, never `.skip`: `.skip` vanishes from the summary line while
// `it.fails` has its own bucket, so `N passed | M expected fail` makes M the size of the debt.
// Vitest *fails* an `it.fails` whose body passes, so each of these self-retires in the slice that
// implements it. Nothing is `declare`d — a declared stub throws `ReferenceError`, which reads
// identically whether the feature is missing, misnamed or wrong.
//
// The shared actual: `packages/web/src/upload/` holds `SPEC.md` and nothing else, so every test
// that reaches the parser reports
//
//   Error: @zmdb/web exports no "parseMultipart" (frozen: upload/SPEC.md 3)
//
// and `the module exists at all` records the `ENOENT` underneath it. Two tests have a *different*
// actual and it is recorded on them, because those two are the ones that say something about
// shipped code rather than about an absent module: the chunk-boundary test, which is §6.1's real
// subject, and the `413` test, which is where the frozen status table meets `runChain`.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------

/** §3's limits, total rather than optional — see §3 on `exactOptionalPropertyTypes`. */
interface FrozenUploadLimits {
  readonly maxParts: number;
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFieldNameBytes: number;
  readonly maxFilenameBytes: number;
  readonly maxPartHeaderBytes: number;
}

/** §4's part. `filename` and `declaredType` are labels; only `bytes` is trusted. */
interface FrozenUploadPart {
  readonly name: string;
  readonly filename: string | undefined;
  readonly declaredType: string | undefined;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

interface FrozenMultipart {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly FrozenUploadPart[];
}

type FrozenParseMultipart = (
  rawBody: unknown,
  contentType: string,
  limits?: Partial<FrozenUploadLimits>,
) => FrozenMultipart;

/** §3's defaults, restated so `UPLOAD_DEFAULTS` can be compared against something. */
const FROZEN_DEFAULTS: FrozenUploadLimits = {
  maxParts: 16,
  maxPartBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  maxFieldNameBytes: 100,
  maxFilenameBytes: 255,
  maxPartHeaderBytes: 1024,
};

// ---------------------------------------------------------------------------
// The boundaries
// ---------------------------------------------------------------------------

/**
 * Resolve a name off the real package barrel.
 *
 * boundary: `parseMultipart` and `UPLOAD_DEFAULTS` do not exist, and a static
 * `import { parseMultipart } from '../index.js'` is a link-time SyntaxError that takes the whole
 * file down rather than one test — moving this debt out of the `expected fail` bucket instead of
 * into it. `import './index.js'` is worse: the file is absent, so it is a TS2307 against the
 * typecheck gate. The lookup is therefore dynamic and the message names what is missing, so it is
 * distinguishable from a parser that exists and answers wrongly, whose failure is a diff.
 */
async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('../index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (value === undefined) {
    throw new Error(`@zmdb/web exports no "${name}" (frozen: upload/SPEC.md 3)`);
  }
  return value as T;
}

/**
 * §3's status table, as one comparable string.
 *
 * boundary: the status is the claim and the throw is only how it travels, so an uncaught throw
 * here would print a stack where a two-character answer belongs. This renders the three outcomes
 * that a reader has to be able to tell apart — the documented status, a throw that carries no
 * status at all, and no throw — instead of collapsing them into "did it reject".
 *
 * It also documents the gap it is standing in: §3 says `413` and `400`, and the frozen surface
 * `parseMultipart(...): Multipart` has no error channel in which a status can travel. `ChainError`
 * in `../middleware/index.ts` is the only status-carrying error in the package, and §5's `Pipe`
 * wiring cannot produce a `413` with it — `runChain` rewrites *every* pipe failure as
 * `ChainError(400)`. So this reads `error.status` because that is the only shape a status could
 * plausibly take, and reports its absence rather than guessing.
 */
function statusOf(run: () => unknown): string {
  try {
    run();
    return 'no throw';
  } catch (error) {
    if (!(error instanceof Error)) {
      return `threw a non-Error: ${String(error)}`;
    }
    const status: unknown = Reflect.get(error, 'status');
    return typeof status === 'number' ? String(status) : `${error.name} with no status: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// Building multipart bodies out of bytes
// ---------------------------------------------------------------------------
//
// `TextEncoder` and `Uint8Array` throughout, never `Buffer`: `.oxlintrc.json` restricts the global
// and `Buffer.from`/`concat` by name, and §4's whole subject is a body that a `Buffer`-shaped
// string path already destroyed.

const BOUNDARY = 'zmdbBoundary1234';

interface RawPart {
  readonly headers: readonly string[];
  readonly bytes: Uint8Array;
}

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

const utf8 = new TextEncoder();

/** Assemble a `multipart/form-data` body. `terminated: false` drops the closing `--`. */
function multipart(
  parts: readonly RawPart[],
  options: { readonly terminated?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    chunks.push(utf8.encode(`--${BOUNDARY}\r\n${part.headers.join('\r\n')}\r\n\r\n`));
    chunks.push(part.bytes);
    chunks.push(utf8.encode('\r\n'));
  }
  chunks.push(utf8.encode(options.terminated === false ? `--${BOUNDARY}` : `--${BOUNDARY}--\r\n`));
  return concat(chunks);
}

function filePart(name: string, filename: string, bytes: Uint8Array, type = 'application/octet-stream'): RawPart {
  return {
    headers: [`content-disposition: form-data; name="${name}"; filename="${filename}"`, `content-type: ${type}`],
    bytes,
  };
}

function fieldPart(name: string, value: string): RawPart {
  return { headers: [`content-disposition: form-data; name="${name}"`], bytes: utf8.encode(value) };
}

const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

/**
 * The bytes §6.1 is about: a byte pair that is not valid UTF-8 in any position, a lone `0xFF`, and
 * a well-formed multi-byte character to sit next to them. `0xFF 0xFE` is a UTF-16 byte-order mark,
 * which is exactly the leading bytes of a file a browser really does upload.
 */
const HOSTILE = new Uint8Array([0xff, 0xfe, 0x41, 0x42, 0x00, 0xe2, 0x9c, 0x93, 0x80, 0xc0, 0xff]);

// ---------------------------------------------------------------------------

describe('the module (frozen: upload/SPEC.md 3)', () => {
  // The root cause under every other failure in this file, asserted once so a reader is not left
  // inferring it from twenty identical messages. It retires first, and on that day the rest of the
  // file starts reporting assertion diffs instead of a missing name.
  //
  // actual today: `ENOENT: no such file or directory, open
  // '/home/.../packages/web/src/upload/index.ts'` — the directory holds `SPEC.md` alone.
  it.fails('exists as a module and is exported from the package barrel', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(0);
    expect(typeof (await frozenExport<FrozenParseMultipart>('parseMultipart'))).toBe('function');
    expect(await frozenExport<FrozenUploadLimits>('UPLOAD_DEFAULTS')).toEqual(FROZEN_DEFAULTS);
  });

  // §6.10: "the parser never touches the filesystem — asserted by there being no `node:fs` import
  // in the module". The frozen text calls that a lint-visible property rather than a runtime one,
  // and it is right that no runtime assertion can prove a negative about I/O. What a test *can*
  // do is read the source, which is what this does — and it is worth doing because the failure it
  // guards against is a well-meaning "write large parts to a temp directory" that §'s non-goals
  // reject for choosing a cleanup story, a permissions story and a disk-exhaustion story on the
  // application's behalf. `node:os` is checked too, because `tmpdir()` is the first line of that
  // change.
  it.fails('imports no filesystem module', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+'node:fs/);
    expect(source).not.toMatch(/from\s+'node:os'/);
    expect(source).not.toMatch(/from\s+'node:crypto'/);
  });
});

// ---------------------------------------------------------------------------
// §6.1 — the bytes, which is what this whole feature is blocked on
// ---------------------------------------------------------------------------

describe('a file part is bytes, not a string (frozen: upload/SPEC.md 2, 6.1)', () => {
  // §6.1's first half, against the parser alone: given a `Uint8Array` body, every byte of the file
  // part comes back. Compared as a number array rather than with `toEqual` on the views, because a
  // failure on the array prints the differing byte and a failure on two `Uint8Array`s prints two
  // typed-array dumps in which the reader has to find it.
  it.fails('round-trips a file part that is not valid UTF-8, byte for byte', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const result = parse(multipart([filePart('avatar', 'a.bin', HOSTILE)]), CONTENT_TYPE);
    expect(result.files.length).toBe(1);
    expect([...(result.files[0]?.bytes ?? [])]).toEqual([...HOSTILE]);
  });

  // §6.1's second half, and the only test in this file that says something about code that ships
  // today. `./SPEC.md`'s preamble is the claim: `toNodeHandler` calls `req.setEncoding('utf8')`
  // and accumulates `String(chunk)`, so a multipart body reaches a handler with its boundaries
  // intact and its file content destroyed. The chunk split is in the test because #565's list
  // named it — and running it showed the split is *not* where the loss happens: `StringDecoder`
  // carries a partial sequence across the boundary exactly as the adapter's own comment claims,
  // and the checkmark survives being cut in half. What is lost is every byte that is not part of
  // a well-formed sequence, wherever it sits. So the assertion is on the bytes and not on the
  // seam, and the comment says which of the two the reader is looking at.
  //
  // actual today: `expected '--zmdbBoundary1234\r\ncontent-disposi…' to be an instance of
  // Uint8Array`. The router *is* reached and `rawBody` is a string. Probed on the eleven file
  // bytes directly: an 87-byte body arrives as an 85-character string, and
  // `[0xff,0xfe,0x41,0x42,0x00,0xe2,0x9c,0x93,0x80,0xc0,0xff]` arrives as code points
  // `[65533,65533,65,66,0,10003,65533,65533,65533]` — the checkmark (`0xe2 0x9c 0x93`) survives,
  // and every byte that is not part of a well-formed sequence has collapsed into U+FFFD with no
  // way back. This is `../pipeline/SPEC.md` §A7 and the reason `./SPEC.md`'s preamble says nothing
  // here is implementable before it lands.
  it.fails('keeps a file part intact when the request arrives in two chunks', async () => {
    const body = multipart([filePart('avatar', 'a.bin', HOSTILE)]);
    const split = Math.floor(body.length / 2);
    const { router, seen } = bodySpyRouter();
    const request = new FakeReq('POST', '/spy/body', {
      'content-type': CONTENT_TYPE,
      'content-length': String(body.length),
    });
    toNodeHandler(router)(request, fakeRes());
    request.push(body.slice(0, split), body.slice(split));
    await Promise.resolve();
    expect(seen.raw).toBeInstanceOf(Uint8Array);
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const result = parse(seen.raw, CONTENT_TYPE);
    expect([...(result.files[0]?.bytes ?? [])]).toEqual([...HOSTILE]);
  });
});

// ---------------------------------------------------------------------------
// §6.2, §6.4, §6.9 — the limits and the status table
// ---------------------------------------------------------------------------

describe('exceeding a limit (frozen: upload/SPEC.md 3, 6.2, 6.4)', () => {
  // §3's table, one test per row, because a table row that regresses on its own is a limit that
  // silently stopped being enforced and a single looping test would report it as the same one
  // failure as any other row.
  //
  // The `maxBodyBytes` row is deliberately **not** here: §3 says it answers `413` "at the adapter,
  // before the parser runs", which is `../pipeline/SPEC.md` §A7's claim and is asserted by
  // `../pipeline/streaming.spec.ts`'s `refuses a request body over maxBodyBytes with a 413 and
  // destroys the connection` — including its "the router was never reached" half, which is the
  // part this module depends on. Restating it here would produce two tests that retire on one fix
  // and would put the byte-counting spy in the file that cannot see the adapter.
  it.fails.each([
    ['maxTotalBytes', { maxTotalBytes: 64 }, [filePart('a', 'a.bin', new Uint8Array(200))]],
    ['maxPartBytes', { maxPartBytes: 32 }, [filePart('a', 'a.bin', new Uint8Array(200))]],
    ['maxParts', { maxParts: 2 }, [fieldPart('a', '1'), fieldPart('b', '2'), fieldPart('c', '3')]],
    ['maxFieldNameBytes', { maxFieldNameBytes: 4 }, [fieldPart('averylongfieldname', '1')]],
    ['maxFilenameBytes', { maxFilenameBytes: 4 }, [filePart('a', 'far-too-long.bin', new Uint8Array(4))]],
  ])('answers 413 for %s', async (_limit: string, limits: Partial<FrozenUploadLimits>, parts: readonly RawPart[]) => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    expect(statusOf(() => parse(multipart(parts), CONTENT_TYPE, limits))).toBe('413');
  });

  // §3: `maxPartHeaderBytes` bounds each part's header block, "because a part with a
  // ten-megabyte `content-disposition` line is an unbounded allocation that never contains a
  // single byte of file content". Its own test because the header block is the one region a parser
  // must read before it knows anything at all, so it is the one limit that cannot be enforced
  // after the fact — a parser that checks it at the end has already made the allocation.
  it.fails('answers 413 for maxPartHeaderBytes before allocating the header block', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const bloated: RawPart = {
      headers: [`content-disposition: form-data; name="a"; filename="${'x'.repeat(4000)}.bin"`],
      bytes: new Uint8Array(4),
    };
    expect(statusOf(() => parse(multipart([bloated]), CONTENT_TYPE, { maxPartHeaderBytes: 64 }))).toBe('413');
  });

  // §6.4, and it is the adversarial reading of "total". A parser that sums only part *contents*
  // measures a quantity the attacker does not control the cost of: the boundaries, the header
  // blocks and the CRLFs are all bytes the process allocated. So a body of many tiny parts whose
  // contents sum well under the limit but whose framing pushes the transfer over it must still be
  // refused. Sixty-four two-byte fields is under 200 bytes of content and over 4 KiB of transfer.
  it.fails('counts framing toward maxTotalBytes, not only part contents', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const parts = Array.from({ length: 64 }, (_, index) => fieldPart(`f${String(index)}`, 'ab'));
    const body = multipart(parts);
    // The premise, so the test cannot pass for the wrong reason if the builder changes.
    const contents = 64 * 2;
    expect(contents).toBeLessThan(1024);
    expect(body.length).toBeGreaterThan(1024);
    expect(statusOf(() => parse(body, CONTENT_TYPE, { maxParts: 64, maxTotalBytes: 1024 }))).toBe('413');
  });

  // §6.9 and §3's last table row: malformed input is `400` and never `413`, "because the two mean
  // different things to a client: one says 'send less', the other says 'send it correctly', and
  // collapsing them makes both unactionable". Every row here is a body a real client produces when
  // something upstream truncated it, so distinguishing them from a size refusal is what tells an
  // operator whether to raise a limit or fix a proxy.
  it.fails.each([
    ['no boundary parameter in the content type', 'multipart/form-data', true, true],
    ['a boundary that does not appear in the body', `multipart/form-data; boundary=other`, true, true],
    ['an empty content type', '', true, true],
    ['a body with no closing boundary', CONTENT_TYPE, false, true],
    ['a part with no content-disposition', CONTENT_TYPE, true, false],
  ])('answers 400 for %s', async (_case: string, contentType: string, terminated: boolean, disposed: boolean) => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const part: RawPart = disposed
      ? filePart('a', 'a.bin', utf8.encode('hi'))
      : { headers: ['content-type: text/plain'], bytes: utf8.encode('hi') };
    const body = multipart([part], { terminated });
    expect(statusOf(() => parse(body, contentType))).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// §6.3 — a limit cannot be removed, only raised
// ---------------------------------------------------------------------------

describe('limits cannot be disabled (frozen: upload/SPEC.md 3, 6.3)', () => {
  // §3: "`parseMultipart` rejects a limit that is not a positive, finite, safe integer — so `0`,
  // `Infinity`, `-1`, `NaN` and `2 ** 60` are all construction errors rather than clever ways to
  // disable a check." Each value is its own test because each is a different mistake: `0` reads
  // as "off", `Infinity` as "unlimited", `-1` as a sentinel somebody copied from a C API, `NaN` as
  // an unvalidated `Number(process.env.MAX)`, and `2 ** 60` as "effectively unlimited" — which is
  // the one that is not a typo and is therefore the one most likely to be argued for.
  //
  // `NaN` is the row that catches the laziest possible check: `typeof x === 'number' && x > 0` is
  // `false` for `NaN`, but `!(x <= 0)` is `true`, and the two are the same line to a reader.
  it.fails.each([
    ['zero', 0],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative', -1],
    ['NaN', Number.NaN],
    ['a non-integer', 1.5],
    ['a value past Number.MAX_SAFE_INTEGER', 2 ** 60],
  ])('refuses %s as maxTotalBytes', async (_name: string, value: number) => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const body = multipart([fieldPart('a', '1')]);
    expect(() => parse(body, CONTENT_TYPE, { maxTotalBytes: value })).toThrow();
  });

  // And the other side of "raising a limit is the supported operation": a raised limit works, and
  // the defaults are the documented numbers. Without this the test above is satisfied by a parser
  // that rejects every `limits` argument it is given.
  it.fails('accepts a raised limit and defaults the rest', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const defaults = await frozenExport<FrozenUploadLimits>('UPLOAD_DEFAULTS');
    expect(defaults).toEqual(FROZEN_DEFAULTS);
    const body = multipart([filePart('a', 'a.bin', new Uint8Array(2048))]);
    const result = parse(body, CONTENT_TYPE, { maxTotalBytes: 64 << 20 });
    expect(result.files.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6.5, §6.6, §6.7 — the client-supplied strings
// ---------------------------------------------------------------------------

describe('filenames are untrusted (frozen: upload/SPEC.md 4, 6.5, 6.6)', () => {
  // §4: a `\0` or a path separator in a filename makes the part a `400` "rather than being
  // stripped — stripping produces a *different* name that looks sanitised, and the sanitised
  // version of `../../etc/passwd` is a filename somebody will concatenate". Each row is a
  // traversal technique in the one client-supplied string this feature stores, and the second
  // assertion in the body is the half that matters: a parser that sanitises instead of refusing
  // also passes a status check, because it returns a part rather than throwing — so the test has
  // to look for the surviving fragment as well.
  it.fails.each([
    ['a relative traversal', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a backslash separator', '..\\..\\windows\\win.ini'],
    ['an embedded null byte', 'ok.png\u0000.php'],
    ['a bare parent segment', '..'],
    ['a drive letter', 'C:\\secrets.txt'],
  ])('answers 400 for a filename with %s', async (_technique: string, filename: string) => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const body = multipart([filePart('a', filename, utf8.encode('hi'))]);
    expect(statusOf(() => parse(body, CONTENT_TYPE))).toBe('400');
    // And nothing sanitised came back. A parser that stripped the separators would answer with a
    // part whose `filename` is `etcpasswd` or `passwd`, which is the outcome §4 refuses.
    let rendered = 'threw';
    try {
      rendered = JSON.stringify(parse(body, CONTENT_TYPE));
    } catch {
      rendered = 'threw';
    }
    expect(rendered).toBe('threw');
  });

  // §6.6: over `maxFilenameBytes` the *label* is truncated and the part is still accepted — which
  // is the one place in this spec where an over-limit value is not a `413`, because the filename
  // is never used for anything, so there is nothing for a client to correct. The pair of
  // assertions is the claim: truncated, and accepted.
  it.fails('truncates an over-long filename and keeps the part', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const filename = `${'n'.repeat(400)}.bin`;
    const body = multipart([filePart('a', filename, utf8.encode('hi'))]);
    const result = parse(body, CONTENT_TYPE, { maxFilenameBytes: 16 });
    expect(result.files.length).toBe(1);
    expect(utf8.encode(result.files[0]?.filename ?? '').length).toBeLessThanOrEqual(16);
    expect([...(result.files[0]?.bytes ?? [])]).toEqual([...utf8.encode('hi')]);
  });

  // §6.7: `declaredType` is "recorded, never trusted, and never used to decide anything". The
  // adversarial value is the point — a type that is nonsense, a type that is a header injection
  // attempt, and `image/svg+xml`, which §4 names as the one that actually matters because an SVG
  // served from your origin executes script. All three must arrive verbatim and none may change
  // whether the part is a file.
  it.fails('records declaredType verbatim and branches on nothing', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const types = ['not/a real type', 'image/svg+xml', 'text/html\r\nx-injected: 1', ''];
    const parts = types.map((type, index) => filePart(`f${String(index)}`, `f${String(index)}.bin`, HOSTILE, type));
    const result = parse(multipart(parts), CONTENT_TYPE, { maxParts: 8 });
    expect(result.files.length).toBe(types.length);
    expect(result.files.map(part => part.declaredType ?? '<undefined>')).toEqual(
      types.map(type => (type === '' ? '' : type)),
    );
    // Every part kept its bytes, so nothing was filtered on the strength of its declared type.
    for (const part of result.files) {
      expect([...part.bytes]).toEqual([...HOSTILE]);
    }
  });

  // §4: "`filename` is never used for I/O, and the type cannot express that, so the rule is the
  // contract." What a test can do is assert the observable half — a legitimate filename survives
  // as a label — so that the refusal tests above are not satisfied by a parser that discards every
  // filename it is given.
  it.fails('keeps a legitimate filename as an opaque label', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const result = parse(multipart([filePart('a', 'holiday photo (1).jpeg', HOSTILE)]), CONTENT_TYPE);
    expect(result.files[0]?.filename).toBe('holiday photo (1).jpeg');
  });
});

// ---------------------------------------------------------------------------
// §6.8 — repeated fields
// ---------------------------------------------------------------------------

describe('fields are strings (frozen: upload/SPEC.md 4, 6.8)', () => {
  // §4: a repeated field name keeps the **last** value and does not build an array, "because a
  // `string | string[]` field is the shape that produces type-confusion bugs in validators — the
  // same reason `flattenHeaders` collapses repeated headers today". Both halves are asserted: the
  // type is a string, and the value is the last one. A parser that kept the *first* would satisfy
  // a `typeof` check and silently invert what every HTML form means by a resubmitted field.
  it.fails('keeps the last value for a repeated field name and never an array', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const body = multipart([fieldPart('mode', 'first'), fieldPart('mode', 'second'), fieldPart('mode', 'third')]);
    const result = parse(body, CONTENT_TYPE, { maxParts: 8 });
    expect(typeof result.fields['mode']).toBe('string');
    expect(result.fields['mode']).toBe('third');
    expect(Array.isArray(result.fields['mode'])).toBe(false);
  });

  // §4: "a non-file part over `maxPartBytes` is a `413` like any other". Its own test because a
  // parser that applies the limit only to parts carrying a `filename` leaves an unbounded text
  // field, which is the same memory bug through the half of the body nobody thinks of as an
  // upload.
  it.fails('applies maxPartBytes to a field as well as to a file', async () => {
    const parse = await frozenExport<FrozenParseMultipart>('parseMultipart');
    const body = multipart([fieldPart('note', 'x'.repeat(4096))]);
    expect(statusOf(() => parse(body, CONTENT_TYPE, { maxPartBytes: 64 }))).toBe('413');
  });
});

// ---------------------------------------------------------------------------
// Green — the fixtures, and the two facts the red tests rest on
// ---------------------------------------------------------------------------

describe('the bodies under these tests', () => {
  // Green, and not padding. Every red test above is a claim about what the parser does with a
  // body; none of them says anything unless the body really is what the comment says. If
  // `HOSTILE` became valid UTF-8, or `multipart()` stopped emitting CRLFs, or the unterminated
  // body still ended with `--`, the corresponding red tests would go green for reasons that have
  // nothing to do with uploads — and vitest reports a passing `it.fails` as a failure, so the file
  // would retire itself while the holes stayed open.
  it('really are ill-formed UTF-8 inside a well-formed multipart envelope', () => {
    // Not decodable: a strict decoder throws, and a lenient one produces replacement characters.
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(HOSTILE)).toThrow(TypeError);
    expect(new TextDecoder().decode(HOSTILE)).toContain('\uFFFD');
    // The envelope is the shape a browser sends, CRLFs and all.
    const rendered = new TextDecoder().decode(multipart([filePart('avatar', 'a.bin', HOSTILE)]));
    expect(rendered.startsWith(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="avatar"`)).toBe(true);
    expect(rendered.endsWith(`\r\n--${BOUNDARY}--\r\n`)).toBe(true);
    // And the unterminated variant really is missing the closing marker, which is what the `400`
    // row for "a body with no closing boundary" depends on.
    const truncated = new TextDecoder().decode(multipart([fieldPart('a', '1')], { terminated: false }));
    expect(truncated.endsWith(`--${BOUNDARY}--\r\n`)).toBe(false);
    expect(truncated.endsWith(`--${BOUNDARY}`)).toBe(true);
  });

  // Green. `counts framing toward maxTotalBytes` only means something if the framing really does
  // dominate, and that is arithmetic a reader should not have to do. This is the same premise the
  // red test asserts inline, kept here as well so it survives if that test is ever simplified.
  it('has framing overhead that dominates a body of small fields', () => {
    const parts = Array.from({ length: 64 }, (_, index) => fieldPart(`f${String(index)}`, 'ab'));
    const body = multipart(parts);
    expect(body.length).toBeGreaterThan(64 * 2 * 8);
  });

  // Green, and the reason the chunk-boundary red test is written as it is. `StringDecoder` really
  // does carry a partial multi-byte sequence across a chunk boundary — so the seam is *not* where
  // §6.1's corruption comes from, and a reader who assumed otherwise would write a weaker test
  // that passes once the split is handled and still loses every byte of a JPEG. What is destroyed
  // is every byte that is not part of a well-formed sequence, at any position.
  it('has a decoder that survives a split character and destroys a lone byte anyway', () => {
    const check = new Uint8Array([0xe2, 0x9c, 0x93]);
    const decoder = new StringDecoder('utf8');
    const joined = `${decoder.write(check.slice(0, 2))}${decoder.write(check.slice(2))}`;
    expect(joined).toBe('\u2713');
    expect(new StringDecoder('utf8').write(new Uint8Array([0xff, 0xfe]))).toBe('\uFFFD\uFFFD');
  });
});

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * The `IncomingMessage` shape `toNodeHandler` reads, with a real `StringDecoder` behind
 * `setEncoding` so the decoding under test is the platform's and not a stand-in. Copied in shape
 * from `../pipeline/pipeline.spec.ts` for the same reason it exists there: the adapter only
 * attaches a `data` listener when the framing headers say there is a body.
 */
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

function fakeRes(): { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void } {
  return {
    statusCode: 0,
    setHeader: () => undefined,
    end: () => undefined,
  };
}

/** A router that records `rawBody` on its way past and then answers normally. */
function bodySpyRouter(): { router: Router; seen: { raw: unknown } } {
  @Controller('/spy')
  class SpyController {
    @Post('/body')
    body() {
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
      handle: (request: WebRequest) => {
        seen.raw = request.rawBody;
        return inner.handle(request);
      },
    },
  };
}
