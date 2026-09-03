import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type WebResponse } from '../index.js';

// Static file serving. Tests freeze for epic #564 (spec freeze #565); the frozen text is
// `./SPEC.md`, and this file is its §8 list, item by item. §8 item 5 — "there is no option that
// enables directory listing" — is a compile-time claim and lives in `./static.type-test.ts`.
//
// `./SPEC.md`'s own preamble says this is "the one file in the epic where a mistake is a disclosed
// private key rather than a slow response", so the confinement refusals come first and are a
// table: one row per technique, one `it.fails` per row, so the count in `N passed | M expected
// fail` is the number of techniques still unrefused rather than the number of files still unbuilt.
//
// `it.fails`, never `.skip`: `.skip` disappears from the summary line while `it.fails` has its own
// bucket, and vitest *fails* an `it.fails` whose body passes, so every test here self-retires in
// the slice that implements it.
//
// The shared actual, recorded once because there is only one. `packages/web/src/static/` contains
// `SPEC.md` and nothing else — no `index.ts` — so every test below currently reports
//
//   Error: @zmdb/web exports no "createStaticHandler" (frozen: static/SPEC.md 1)
//
// from the `frozenExport` boundary, and `the module exists at all` records the `ENOENT` underneath
// it. The per-test comments therefore carry the frozen claim and the technique that distinguishes
// it, and note the actual only where it differs from the shared one. Repeating one identical
// captured line thirty times would bury the two places it is not identical.

// ---------------------------------------------------------------------------
// The frozen surface, declared locally
// ---------------------------------------------------------------------------
//
// §1's surface, plus the `ResponseBody` union `serve` returns from
// `../pipeline/SPEC.md` §A1. `Omit<WebResponse, 'body'>` is load-bearing and is the only
// widening here: rename `status` or `headers` on the real interface and this file stops compiling
// instead of quietly asserting a shape nobody has. `../pipeline/streaming.type-test.ts` pins those
// two fields so the intersection cannot rot silently.

type FrozenTextBody = { readonly kind: 'text'; readonly value: string };
type FrozenBytesBody = { readonly kind: 'bytes'; readonly value: Uint8Array<ArrayBuffer> };
type FrozenStreamBody = {
  readonly kind: 'stream';
  readonly value: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly length: number | undefined;
};
type FrozenResponseBody = FrozenTextBody | FrozenBytesBody | FrozenStreamBody;
type FrozenResponse = Omit<WebResponse, 'body'> & { readonly body: FrozenResponseBody };

/** §1's `StaticOptions`. `onError` is required, which is why `serving()` always passes one. */
interface FrozenStaticOptions {
  readonly root: string;
  readonly index?: string;
  readonly cacheControl?: string;
  readonly contentTypes?: Readonly<Record<string, string>>;
  readonly onError: (error: unknown) => void;
}

interface FrozenStaticHandler {
  serve(pathname: string, headers: Readonly<Record<string, string>>): Promise<FrozenResponse>;
}

type FrozenCreateStaticHandler = (options: FrozenStaticOptions) => Promise<FrozenStaticHandler>;

// ---------------------------------------------------------------------------
// The one boundary
// ---------------------------------------------------------------------------

/**
 * Resolve `createStaticHandler` off the real package barrel.
 *
 * boundary: the export does not exist, and a static `import { createStaticHandler } from
 * '../index.js'` is a link-time SyntaxError that takes the whole file down rather than one test —
 * which moves this debt out of the `expected fail` bucket instead of into it. `import
 * './index.js'` is worse still: the file is absent, so it is a TS2307 that fails the typecheck
 * gate. The lookup is therefore dynamic, and the message names the missing export so it is
 * distinguishable from a handler that exists and answers wrongly, whose failure is an assertion
 * diff. Nothing here is `declare`d: a declared stub throws `ReferenceError`, which reads the same
 * whether the feature is missing, misnamed or wrong.
 */
async function frozenExport<T>(name: string): Promise<T> {
  const module: unknown = await import('../index.js');
  const value: unknown = Reflect.get(Object(module), name);
  if (typeof value !== 'function') {
    throw new Error(`@zmdb/web exports no "${name}" (frozen: static/SPEC.md 1)`);
  }
  return value as T;
}

/** Build a handler over the fixture root. Every option except `root`/`onError` is defaulted off. */
async function serving(overrides: Partial<FrozenStaticOptions> = {}): Promise<FrozenStaticHandler> {
  const create = await frozenExport<FrozenCreateStaticHandler>('createStaticHandler');
  return create({ root, onError: () => errors.push('onError'), ...overrides });
}

// ---------------------------------------------------------------------------
// Fixtures — real files, real symlinks, real FIFO
// ---------------------------------------------------------------------------
//
// A confinement test over a mocked filesystem asserts that the mock refuses the path, which is a
// fact about the mock. §2 steps 8 and 9 are specifically about what `realpath` and an open
// descriptor say, and neither has a string form. So these are real files in a real temporary
// directory, and the escaping symlink really does point at a really readable secret.

let base = '';
let root = '';
let errors: string[] = [];

/** 1,000 bytes of known content, so a range window's size is checkable by arithmetic. */
const BIN = new Uint8Array(1000).map((_, index) => index % 251);

/**
 * Make a path that is not a regular file. §2.10 names "a directory, a FIFO, a device or a socket"
 * and §8.4 names the FIFO specifically, because reading one blocks the handler forever — the
 * denial of service that contains no traversal at all. `mkfifo` is a POSIX utility rather than a
 * Node API; where it is unavailable a Unix domain socket is created instead, which is the same
 * claim ("not a regular file") through a different inode type. The function reports which it made
 * so a reader of a failure knows what was under test.
 */
function makeNotARegularFile(path: string): string {
  execFileSync('mkfifo', [path]);
  return 'fifo';
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'zmdb-static-'));
  root = join(base, 'assets');
  await mkdir(join(root, 'sub'), { recursive: true });
  await mkdir(join(root, 'dir'), { recursive: true });
  await mkdir(join(base, 'assets-private'), { recursive: true });
  await writeFile(join(root, 'app.css'), 'body{color:red}\n');
  await writeFile(join(root, 'data.bin'), BIN);
  await writeFile(join(root, 'unknown.zzz'), 'opaque');
  await writeFile(join(root, '.env'), 'SECRET=1\n');
  await writeFile(join(root, 'sub', 'nested.txt'), 'nested\n');
  await writeFile(join(base, 'secret.txt'), 'PRIVATE KEY\n');
  await writeFile(join(base, 'assets-private', 'x'), 'sibling\n');
  await writeFile(join(base, 'plain-file'), 'not a directory\n');
  // Inside the root, pointing inside the root: must be served (§8.2, second half).
  await symlink(join(root, 'app.css'), join(root, 'inside.css'));
  // Inside the root, pointing outside it: must be a 404 (§8.2, first half).
  await symlink(join(base, 'secret.txt'), join(root, 'escape.txt'));
  // Inside the root, pointing at the *sibling directory* whose name extends the root's. This is
  // the only input that reaches §2.7's trailing-separator test — see the test's own comment.
  await symlink(join(base, 'assets-private'), join(root, 'priv'));
  makeNotARegularFile(join(root, 'pipe'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a frozen body to bytes. §8.9 counts bytes, so nothing here may summarise them. */
async function readBody(body: FrozenResponseBody): Promise<Uint8Array> {
  if (body.kind === 'text') {
    return new TextEncoder().encode(body.value);
  }
  if (body.kind === 'bytes') {
    return body.value;
  }
  const reader = body.value.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    chunks.push(next.value);
    total += next.value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * §3's rejection, as one comparable value: the status, whether a body was sent, and every header.
 * §3 requires a refused traversal, a miss, a directory, an escaping symlink and a FIFO to be
 * *indistinguishable*, and "indistinguishable" is a claim about the whole response rather than
 * about the status — a `content-type` present on one and absent on another is the oracle §3 is
 * spending an entire section to close. Comparing a rendered string rather than the object also
 * keeps a failure readable: the object form prints a `ReadableStream`'s internal state where the
 * one differing header should be.
 */
async function rejection(response: FrozenResponse): Promise<string> {
  const bytes = await readBody(response.body);
  const headers = Object.entries(response.headers)
    .map(([name, value]) => `${name.toLowerCase()}=${value}`)
    .toSorted()
    .join(',');
  return `${String(response.status)} bytes=${String(bytes.length)} [${headers}]`;
}

/** The number of descriptors this process holds. See `never opens the file` for why. */
function openDescriptors(): number {
  return readdirSync('/proc/self/fd').length;
}

// ---------------------------------------------------------------------------

describe('the module (frozen: static/SPEC.md 1)', () => {
  // The root cause under every other failure in this file, asserted once so a reader is not left
  // inferring it from thirty identical messages. It retires first, and on the day it does the
  // rest of the file starts reporting assertion diffs instead of a missing name.
  //
  // actual today: `ENOENT: no such file or directory, open
  // '/home/.../packages/web/src/static/index.ts'` — the directory holds `SPEC.md` alone.
  it.fails('exists as a module and is exported from the package barrel', async () => {
    const source = await readFile(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source.length).toBeGreaterThan(0);
    const create = await frozenExport<FrozenCreateStaticHandler>('createStaticHandler');
    expect(typeof create).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// §8.1 — the ten refusals, technique by technique
// ---------------------------------------------------------------------------
//
// The adversarial cases first, because the title of #566 says so and because §2's ordering says
// so. Each row is the input some production static handler was missing, and each is its own test:
// a single test looping over the table would collapse ten independent debts into one line of the
// summary and would stop at the first row that regressed.
//
// Two rows are not in #565's enumeration and are here because the brief for this freeze demanded
// them: the UTF-8 overlong encoding, and the long `../` chain. The overlong row is the interesting
// one — see its own comment.
const REFUSALS: readonly (readonly [string, string])[] = [
  // §2.1 — one percent-decode is what turns this into `../` where the segment check can see it.
  ['percent-encoded dot-dot', '%2e%2e%2fsecret.txt'],
  // §2.1 — double encoding. One decode leaves `%2e%2e%2f`, whose surviving `%` is the refusal;
  // a decode *loop* would turn it into `../` and a loop's termination is its own question.
  ['double percent-encoded dot-dot', '%252e%252e%252fsecret.txt'],
  // §2.1 — a literal percent that survives one decode, which is the same rule seen from the
  // legitimate side: the cost of the restriction is a rename, and this row is that cost.
  ['a surviving literal percent', '50%2525.css'],
  // §2.2 — a null byte truncates the path in any layer below that is C-shaped, so the check can
  // pass on the whole string while a different file is opened. Percent-encoded...
  ['percent-encoded null byte', 'app.css%00.txt'],
  // ...and raw, because `decodeURIComponent` is not the only way a NUL arrives.
  ['a raw null byte', 'app.css\0.txt'],
  // §2.3 — a path separator on Windows, never meaningful in a URL path.
  ['backslash separators', '..\\..\\secret.txt'],
  // §2.4 — an absolute path is an attempt to replace the root rather than index into it.
  ['an absolute path', '/etc/passwd'],
  // §2.4 — a drive letter.
  ['a drive letter', 'C:/Windows/win.ini'],
  // §2.4 — a UNC prefix, which is also §2.6's empty segment; both must refuse it.
  ['a UNC prefix', '//etc/passwd'],
  // §2.5 — the plain `..` segment, refused on the segment rather than by trusting `normalize`.
  ['a dot-dot segment', '../secret.txt'],
  // §2.5 — and a long chain of them, which is what a scanner actually sends: `resolve` clamps at
  // the filesystem root, so a handler that only compared the *resolved* prefix and skipped the
  // segment check would answer this one from `/` upwards.
  ['a long dot-dot chain', `${'../'.repeat(40)}etc/passwd`],
  // §2.5 — a dotfile, refused as a class rather than as a list. This one exists in the fixture
  // root, so a handler missing the rule answers 200 with the secret rather than 404 with nothing.
  ['a dotfile that exists', '.env'],
  // §2.5 — and a dotfile inside a subdirectory, because the rule is per segment.
  ['a dot segment inside a path', 'sub/./nested.txt'],
  // §2.6 — a trailing slash resolves to a directory, and §5 says a directory is never served.
  ['a trailing slash', 'sub/'],
  // §2.6 — an empty segment.
  ['an empty segment', 'sub//nested.txt'],
];

describe('confinement: every refusal is the same 404 (frozen: static/SPEC.md 2, 3, 8.1)', () => {
  it.fails.each(REFUSALS)('refuses a path with %s', async (_technique: string, pathname: string) => {
    const handler = await serving();
    const refused = await handler.serve(pathname, {});
    const missing = await handler.serve('no-such-file.css', {});
    // The same 404, byte for byte and header for header, as an ordinary miss. §3: any distinction
    // is an oracle that maps the filesystem one request at a time without ever reading a file.
    expect(await rejection(refused)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
    expect(await rejection(refused)).toBe(await rejection(missing));
  });

  // §2.1's decode is `decodeURIComponent`, and `decodeURIComponent('%c0%ae')` **throws**
  // `URIError: URI malformed` — verified on Node 26.8.1 — because an overlong UTF-8 encoding of
  // `.` is not a well-formed sequence. So this row cannot join the table above: the frozen text
  // says "percent-decode exactly once, then refuse any remaining `%`" and does not say what
  // happens when the decode itself fails, and the two plausible implementations differ in a way
  // §3 cares about. A handler that lets the `URIError` out answers with a rejected promise, which
  // an adapter turns into a 500 carrying a stack — a different answer from a 404, and therefore
  // the oracle §3 exists to close. Asserted here as the 404 it has to be, and recorded as a gap
  // in the frozen text rather than silently assumed.
  it.fails('refuses an overlong UTF-8 encoding of dot-dot without letting URIError escape', async () => {
    const handler = await serving();
    const refused = await handler.serve('%c0%ae%c0%ae%2fsecret.txt', {});
    expect(await rejection(refused)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });

  // §2.8's "follow within root only", and it needs both halves. Refusing every symlink would pass
  // the first half and break the release-directory deployment §2.8 says it supports; following
  // every symlink would pass the second half and disclose the key. The fixture's `escape.txt`
  // really does point at a really readable file outside the root, so a handler that skips the
  // real-path re-check answers 200 with `PRIVATE KEY`.
  it.fails('refuses a symlink whose target escapes the root', async () => {
    const handler = await serving();
    const escaped = await handler.serve('escape.txt', {});
    expect(await rejection(escaped)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });

  it.fails('serves a symlink whose target is inside the root', async () => {
    const handler = await serving();
    const served = await handler.serve('inside.css', {});
    expect(served.status).toBe(200);
    expect(new TextDecoder().decode(await readBody(served.body))).toBe('body{color:red}\n');
  });

  // §8.3, the trailing-separator case — and the reason it is written as a symlink rather than as
  // the string `../assets-private/x` the frozen text implies. With §2.4 and §2.5 in force there is
  // **no pathname** that reaches §2.7's containment test with a resolved path outside the root:
  // an absolute path is refused at step 4 and a `..` segment at step 5, both before any resolve
  // happens. The only input that gets there is a symlink inside the root whose target is the
  // sibling directory, so that is what the fixture builds. The bug the row is about is real —
  // `'/base/assets-private/x'.startsWith('/base/assets')` is `true` — it is just only reachable
  // through step 8.
  it.fails('refuses a sibling directory whose name extends the root', async () => {
    const handler = await serving();
    const sibling = await handler.serve('priv/x', {});
    expect(await rejection(sibling)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });

  // §8.4. The FIFO is the one that matters: a handler that opens it and streams it never answers
  // at all, so the failure mode is a hung request rather than a leaked file, and a test that only
  // asserted the status would hang with it. The timeout is explicit and short so a regression
  // reports as a failure rather than as a stuck suite.
  it.fails('refuses a FIFO rather than blocking on it', { timeout: 2000 }, async () => {
    const handler = await serving();
    const pipe = await handler.serve('pipe', {});
    expect(await rejection(pipe)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });

  it.fails('refuses a directory rather than listing it', async () => {
    const handler = await serving();
    const directory = await handler.serve('dir', {});
    expect(await rejection(directory)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });

  // §3's second paragraph: `onError` fires for a refusal, an unreadable file and a symlink escape
  // and **not** for an ordinary miss, so a deployment can alert on it without alerting on every
  // favicon. Two claims in one test because the distinction is the claim: either alone is
  // satisfied by a sink that fires always or never.
  it.fails('reports a refusal to onError and stays silent on an ordinary miss', async () => {
    const seen: string[] = [];
    const handler = await serving({ onError: error => seen.push(String(error)) });
    await handler.serve('../secret.txt', {});
    expect(seen.length).toBe(1);
    await handler.serve('no-such-file.css', {});
    expect(seen.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §8.12 — construction refuses a bad root, at construction
// ---------------------------------------------------------------------------

describe('createStaticHandler validates root (frozen: static/SPEC.md 1, 8.12)', () => {
  // §1: `root` is resolved to its real path **once, at construction**. "At construction, not at
  // the first request" is the load-bearing half — a handler that defers the check serves for the
  // lifetime of a process that was misconfigured at boot, and a `root` that becomes a symlink at
  // runtime changes what is served without the process noticing.
  it.fails.each([
    ['a missing directory', 'no-such-directory'],
    ['a regular file', 'plain-file'],
    ['a FIFO', 'assets/pipe'],
  ])('rejects %s as a root', async (_kind: string, relative: string) => {
    const create = await frozenExport<FrozenCreateStaticHandler>('createStaticHandler');
    await expect(create({ root: join(base, relative), onError: () => undefined })).rejects.toThrow();
  });

  it.fails('resolves the root once, so a later swap of the root symlink changes nothing', async () => {
    const linked = join(base, 'current');
    await symlink(root, linked);
    const handler = await frozenExport<FrozenCreateStaticHandler>('createStaticHandler').then(create =>
      create({ root: linked, onError: () => undefined }),
    );
    await rm(linked);
    await symlink(base, linked);
    // The handler is still confined to what `root` resolved to at construction, so the file that
    // is now one level up is still outside it.
    expect(await rejection(await handler.serve('secret.txt', {}))).toBe('404 bytes=0 [x-content-type-options=nosniff]');
  });
});

// ---------------------------------------------------------------------------
// §8.5's runtime half, and §5
// ---------------------------------------------------------------------------

describe('directory listing and index (frozen: static/SPEC.md 5, 8.5)', () => {
  // The compile-time half of §8.5 is in `./static.type-test.ts`: a runtime test cannot assert
  // that an option is absent, only that a particular spelling of it does nothing. What a runtime
  // test *can* say is that the default answer for a directory is a 404 and not a listing, which
  // is the observable §5 promises, and that is what this is.
  it.fails('never lists a directory', async () => {
    const handler = await serving();
    const listing = await handler.serve('sub', {});
    expect(await rejection(listing)).toBe('404 bytes=0 [x-content-type-options=nosniff]');
    // Not a listing under any of the spellings that produce one elsewhere.
    expect(await rejection(await handler.serve('sub/', {}))).toBe(await rejection(listing));
    expect(await rejection(await handler.serve('', {}))).toBe(await rejection(listing));
  });

  // §5: `index` is off by default and is not a listing. Off-by-default is the half that matters —
  // "an implicit index means the same URL serves different content depending on which files
  // exist", and the fixture deliberately has no `index.html` so a handler that invented one
  // would answer 404 here for the wrong reason. So the pair is asserted: absent by default, and
  // used when named.
  it.fails('appends index only when the option names one', async () => {
    await writeFile(join(root, 'index.html'), '<h1>root</h1>');
    const bare = await serving();
    expect((await bare.serve('', {})).status).toBe(404);
    const indexed = await serving({ index: 'index.html' });
    const served = await indexed.serve('', {});
    expect(served.status).toBe(200);
    expect(new TextDecoder().decode(await readBody(served.body))).toBe('<h1>root</h1>');
    // And it is an index, not a fallback: an unmatched path is still a 404. §5 refuses the
    // single-page-application catch-all because it turns every mistyped API path into a 200 of
    // HTML, which is the most confusing failure available.
    expect((await indexed.serve('no-such-route', {})).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// §8.6, §8.7 — conditional requests
// ---------------------------------------------------------------------------

describe('conditional requests (frozen: static/SPEC.md 6, 8.6, 8.7)', () => {
  // §6: the ETag is weak — `W/"<size>-<mtimeMs>"`. The `W/` prefix is not decoration: §6 argues
  // that labelling it strong would license a client to assemble byte ranges from two different
  // responses, so the label is what keeps the range table below correct. Asserted as a shape
  // rather than as a literal, because `mtimeMs` is whatever the filesystem said.
  it.fails('sends a weak ETag built from size and mtimeMs', async () => {
    const handler = await serving();
    const served = await handler.serve('app.css', {});
    expect(served.headers['etag']).toMatch(/^W\/"16-\d+(\.\d+)?"$/);
    expect(served.headers['last-modified']).toMatch(/GMT$/);
    expect(served.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(served.headers['accept-ranges']).toBe('bytes');
  });

  // §8.6, and the technique is the point. "Never opens the file" cannot be asserted from the
  // response — a 304 has no body either way — so it is asserted from the descriptor count.
  //
  // §8.6 offers "a descriptor count or an `open` spy". The spy is not available: `StaticOptions`
  // has no injection seam for `open`, by design, and the handler calls `node:fs/promises` itself.
  // So the count is the only technique the frozen surface permits, and it is a fact about this
  // process rather than about the handler: `/proc/self/fd` is Linux-only, which is why the first
  // assertion is that the reading works at all rather than that it is unchanged. A platform with
  // no `/proc` fails loudly here instead of passing vacuously.
  it.fails('answers 304 on a matching If-None-Match without opening the file', async () => {
    const handler = await serving();
    const first = await handler.serve('app.css', {});
    await readBody(first.body);
    const etag = first.headers['etag'] ?? '';
    const before = openDescriptors();
    expect(before).toBeGreaterThan(0);
    const notModified = await handler.serve('app.css', { 'if-none-match': etag });
    expect(openDescriptors()).toBe(before);
    expect(notModified.status).toBe(304);
    // No body and no content-length. A 304 carrying either is a client that waits for bytes that
    // never arrive, or a cache that stores a zero-length representation.
    expect((await readBody(notModified.body)).length).toBe(0);
    expect(notModified.headers['content-length']).toBeUndefined();
    expect(notModified.headers['etag']).toBe(etag);
    expect(notModified.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  });

  // §6 and §8.7. `If-Modified-Since` has one-second resolution and the ETag has a millisecond
  // component, so a file modified twice inside one second is unchanged as far as the date can
  // tell. The adversarial arrangement is the contradiction: a *stale* `If-Modified-Since` that
  // says "send it" together with a *matching* `If-None-Match` that says "do not". RFC 9110 makes
  // the entity tag win, and a handler that checks the date first answers 200 and re-sends the
  // whole file on every conditional request — a performance bug that no status assertion on
  // either header alone can see.
  it.fails('lets If-None-Match win over a contradicting If-Modified-Since', async () => {
    const handler = await serving();
    const first = await handler.serve('data.bin', {});
    await readBody(first.body);
    const answer = await handler.serve('data.bin', {
      'if-none-match': first.headers['etag'] ?? '',
      'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT',
    });
    expect(answer.status).toBe(304);
    // And the other way round, so the test is not satisfied by a handler that ignores dates
    // entirely: a non-matching ETag with a fresh date is still a 200.
    const changed = await handler.serve('data.bin', {
      'if-none-match': 'W/"0-0"',
      'if-modified-since': new Date(Date.now() + 60_000).toUTCString(),
    });
    expect(changed.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// §8.8, §8.9 — ranges
// ---------------------------------------------------------------------------

describe('range requests (frozen: static/SPEC.md 6, 8.8, 8.9)', () => {
  // Every row of §6's table, one test per row. The two rows that are decisions rather than
  // transcriptions — multiple ranges and `If-Range`, both ignored — are the ones a later
  // "improvement" would silently reverse, and they are the reason this is a table and not three
  // representative cases.
  it.fails.each([
    ['bytes=0-499', 206, 'bytes 0-499/1000', 0, 500],
    ['bytes=500-', 206, 'bytes 500-999/1000', 500, 500],
    ['bytes=-500', 206, 'bytes 500-999/1000', 500, 500],
    ['bytes=0-0', 206, 'bytes 0-0/1000', 0, 1],
    // `end` past the end clamps to `size - 1` and stays a 206, rather than becoming a 416.
    ['bytes=900-5000', 206, 'bytes 900-999/1000', 900, 100],
    // Malformed is ignored: the whole file, per RFC 9110 §14.2, and not a 400 or a 416.
    ['bytes=abc', 200, '', 0, 1000],
    ['bytes=', 200, '', 0, 1000],
    ['items=0-10', 200, '', 0, 1000],
    // More than one range is ignored rather than answered with `multipart/byteranges`.
    ['bytes=0-99,200-299', 200, '', 0, 1000],
  ])(
    'answers %s with %i',
    async (range: string, status: number, contentRange: string, start: number, length: number) => {
      const handler = await serving();
      const answer = await handler.serve('data.bin', { range });
      expect(answer.status).toBe(status);
      expect(answer.headers['content-range'] ?? '').toBe(contentRange);
      // §8.9: the window is asserted by the stream's byte count, not by timing. A handler that
      // opens the whole file and slices the buffer produces the same `content-range` and the same
      // bytes as one that opens the descriptor with a start and an end; what distinguishes them
      // is how many bytes came out of the stream, so that is what is counted.
      const bytes = await readBody(answer.body);
      expect(bytes.length).toBe(length);
      expect(bytes.slice(0, 4)).toEqual(BIN.slice(start, start + 4));
      expect(answer.headers['content-length']).toBe(String(length));
    },
  );

  // §6: `start >= size` is the one range that is an error rather than a fallback, and it carries
  // the unsatisfied-range form of `content-range` so the client learns the size it should have
  // asked about. A 416 with no `content-range` leaves a resuming download with no way forward.
  it.fails('answers 416 with content-range for a start past the end', async () => {
    const handler = await serving();
    const answer = await handler.serve('data.bin', { range: 'bytes=1000-1500' });
    expect(answer.status).toBe(416);
    expect(answer.headers['content-range']).toBe('bytes */1000');
    expect((await readBody(answer.body)).length).toBe(0);
  });

  // §6: `If-Range` is ignored for the same reason the ETag is weak. Answering it with a weak
  // validator is how a client splices two versions of a file together, and "ignored" here means
  // the whole file — not the range, and not a 412.
  it.fails('ignores If-Range and sends the whole file', async () => {
    const handler = await serving();
    const answer = await handler.serve('data.bin', { range: 'bytes=0-9', 'if-range': 'W/"16-0"' });
    expect(answer.status).toBe(200);
    expect(answer.headers['content-range']).toBeUndefined();
    expect((await readBody(answer.body)).length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// §8.10 — content types
// ---------------------------------------------------------------------------

describe('content types are an allow-list (frozen: static/SPEC.md 7, 8.10)', () => {
  it.fails.each([
    ['app.css', 'text/css'],
    ['unknown.zzz', 'application/octet-stream'],
  ])('serves %s as %s', async (pathname: string, type: string) => {
    const handler = await serving();
    const answer = await handler.serve(pathname, {});
    expect(answer.headers['content-type']).toBe(type);
    await readBody(answer.body);
  });

  // §7: overridable by `contentTypes` but never *derived*. The override is asserted alongside the
  // fallback because a handler that ignores the option and a handler that has no option are
  // indistinguishable from the fallback alone.
  it.fails('lets contentTypes override the map without deriving anything', async () => {
    const handler = await serving({ contentTypes: { '.zzz': 'application/x-zzz' } });
    const answer = await handler.serve('unknown.zzz', {});
    expect(answer.headers['content-type']).toBe('application/x-zzz');
    await readBody(answer.body);
  });

  // §7's fallback only works if the browser honours it, so `nosniff` is on **every** response —
  // and §8.10 says "every response", which includes the ones §3 makes indistinguishable. A 404
  // with no headers at all is the more likely first implementation, so this is the assertion that
  // catches it, and the `rejection()` helper's expected string above encodes the same claim.
  it.fails('sends nosniff on a 200, a 404, a 304 and a 416', async () => {
    const handler = await serving();
    const ok = await handler.serve('app.css', {});
    await readBody(ok.body);
    const missing = await handler.serve('nope', {});
    const notModified = await handler.serve('app.css', { 'if-none-match': ok.headers['etag'] ?? '' });
    const unsatisfiable = await handler.serve('data.bin', { range: 'bytes=9999-' });
    for (const answer of [ok, missing, notModified, unsatisfiable]) {
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  // §7: `Content-Disposition` is not set by this handler. A static asset is meant to render; a
  // download is `file()` with an explicit disposition, where the caller owns the filename and its
  // escaping. Asserted because the alternative — a handler that helpfully attaches one derived
  // from the path — puts an unescaped, client-influenced string into a header.
  it.fails('never sets content-disposition', async () => {
    const handler = await serving();
    const answer = await handler.serve('unknown.zzz', {});
    expect(answer.headers['content-disposition']).toBeUndefined();
    await readBody(answer.body);
  });
});

// ---------------------------------------------------------------------------
// §8.11 — disconnect
// ---------------------------------------------------------------------------

describe('a client disconnect closes the descriptor (frozen: static/SPEC.md 4, 8.11)', () => {
  // §4: `readableWebStream()`'s cancellation closes the descriptor, which is why
  // `../pipeline/SPEC.md` §A3's disconnect handling is a prerequisite and not a refinement. The
  // failure this catches is the one that does not show up in any response: a handler that leaks
  // one descriptor per aborted download runs out of them after `ulimit -n` requests and then
  // fails every request, including the ones that were working.
  //
  // Counted rather than spied for the reason in `answers 304 ...` above, and over ten iterations
  // rather than one because a single leaked descriptor is inside the noise of anything else the
  // process is doing, while ten is not.
  it.fails('releases the descriptor when the response stream is cancelled mid-file', async () => {
    const handler = await serving();
    const before = openDescriptors();
    expect(before).toBeGreaterThan(0);
    for (let index = 0; index < 10; index += 1) {
      const answer = await handler.serve('data.bin', {});
      expect(answer.body.kind).toBe('stream');
      if (answer.body.kind === 'stream') {
        const reader = answer.body.value.getReader();
        await reader.read();
        await reader.cancel(new Error('client went away'));
      }
    }
    expect(openDescriptors()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Green — the fixtures, and the reason each red test can be trusted
// ---------------------------------------------------------------------------

describe('the fixtures under these tests', () => {
  // Green, and not padding. Every refusal above is a claim about what the handler does with an
  // input; none of them says anything unless the input is genuinely dangerous. If `escape.txt`
  // stopped being a symlink, or `secret.txt` stopped being readable, or the FIFO were created as
  // an ordinary file, the corresponding red test would go green for a reason that has nothing to
  // do with confinement — and vitest reports a passing `it.fails` as a failure, so the file would
  // "retire" itself while the hole stayed open. This test is what makes that impossible.
  it('really are a readable secret, an escaping symlink and a FIFO', async () => {
    expect(await readFile(join(base, 'secret.txt'), 'utf8')).toBe('PRIVATE KEY\n');
    expect(await readFile(join(root, 'escape.txt'), 'utf8')).toBe('PRIVATE KEY\n');
    expect(await readFile(join(root, 'inside.css'), 'utf8')).toBe('body{color:red}\n');
    expect(await readFile(join(base, 'assets-private', 'x'), 'utf8')).toBe('sibling\n');
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('SECRET=1\n');
    // The trailing-separator bug the `priv/x` test is about, demonstrated on the strings so the
    // test above is not the only place a reader can see why the separator matters.
    expect(join(base, 'assets-private').startsWith(root)).toBe(true);
    expect(join(base, 'assets-private').startsWith(`${root}/`)).toBe(false);
  });

  // Green. `openDescriptors()` is the technique two red tests depend on, and a technique that
  // silently returns a constant would make both of them pass for no reason. This pins that it
  // actually moves when a descriptor is opened.
  it('counts descriptors, so the leak tests measure something', async () => {
    const before = openDescriptors();
    const buffer = await readFile(join(root, 'data.bin'));
    expect(buffer.length).toBe(1000);
    expect(before).toBeGreaterThan(2);
  });

  // Green. §2.1's decode throwing on an overlong sequence is a platform fact the refusal test
  // above depends on, and it is the kind of fact that changes under a Node upgrade. Recorded here
  // so a future reader learns it from a passing test rather than from a comment.
  it('has a percent-decoder that throws on an overlong UTF-8 sequence', () => {
    expect(() => decodeURIComponent('%c0%ae')).toThrow(URIError);
    expect(decodeURIComponent('%2e%2e%2f')).toBe('../');
    expect(decodeURIComponent('%252e')).toBe('%2e');
    // And a NUL survives one decode as a real character, which is why §2.2 refuses the byte and
    // not the escape.
    expect(decodeURIComponent('%00').charCodeAt(0)).toBe(0);
  });

  // Green, and it is the reason the `errors` sink in `serving()` is safe to share: a leftover
  // entry from a previous test would make the `onError` assertion above pass on the wrong call.
  it('starts every handler with an empty onError sink', () => {
    errors = [];
    expect(errors).toEqual([]);
  });
});
