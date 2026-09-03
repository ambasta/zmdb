// Tests for the spans, metrics and trace propagation frozen in ./SPEC.md (#580, epic #578).
//
// RED ON PURPOSE, AND VISIBLY SO. ./index.ts does not exist and `createRouter` takes no
// argument: #582 writes both. Every assertion whose subject is unimplemented is `it.fails`,
// never `it.skip`, because a skipped test is invisible in the summary line and an
// expected-failing one is counted there. When #582 lands, each `it.fails` that starts passing
// fails the suite with `Error: Expect test to fail`, which is the ratchet: the implementer
// cannot land the code without also deleting the `.fails`.
//
// THE IDIOM, used in all three of #580's spec files. An `it.fails` whose body cannot be
// typechecked asserts nothing, so the frozen surface is transcribed from ./SPEC.md into the
// block below and each missing function is a `const` holding a throwing implementation of its
// frozen type. A `const` rather than `declare function` for three reasons: nothing throws at
// module load, so collection succeeds and the tests appear in the summary; the type is checked
// against the spec's signature at compile time, so a signature that drifts is a build failure;
// and there is no `declare`d name that oxlint's `no-undef` would have to be told about. When
// #582 lands, the block is replaced by one `import` and the test bodies are untouched.
//
// THE TRACER DOUBLE IS A RECORDER, NOT A MOCK. `recordingTracer` below keeps every span it
// created, with its parent's span id, so the assertions are about the *shape of the tree* —
// which is what §1 says is the public interface — rather than about the order of calls on a
// spy. A call-order assertion passes an implementation that emits the right calls in the
// wrong hierarchy, and the hierarchy is the thing a waterfall renders.
//
// CURRENT ACTUALS. Every `it.fails` records what the code produces today. That matters more
// here than in the other two files, because ./SPEC.md §9.1's "byte-identical responses" and
// §9.8's "produces a 200" are *already true* — there is no tracing code at all, so nothing
// can perturb a response. Those halves would pass for the wrong reason, so each test below
// also asserts the part that genuinely cannot hold today: that a span was recorded, or that
// `ctx.span` is populated. The recorded 404/200 bodies are in the green baseline test.
import { type CompiledQuery } from '@zmdb/query-compiler';
import { describe, expect, it, vi } from 'vitest';

import { createRouter, json, type Ctx, type Router, type WebRequest } from '../pipeline/index.js';
import { Controller, Get, Post } from '../routing/index.js';

// ---------------------------------------------------------------------------
// FROZEN SURFACE — delete this block when `./index.js` exists (#582)
// ---------------------------------------------------------------------------

/** ./SPEC.md §2, and `../../../query-compiler/src/comments/SPEC.md` §2. */
type CommentKey = 'traceparent' | 'controller' | 'action' | 'route' | 'framework';

interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
  setStatus(status: { readonly error: boolean }): void;
  end(): void;
  spanContext(): SpanContext;
}

interface Tracer {
  startSpan(name: string, options?: { readonly parent?: SpanContext; readonly link?: SpanContext }): Span;
}

type Attributes = Readonly<Record<string, string | number | boolean>>;

interface Meter {
  counter(name: string): { add(value: number, attributes: Attributes): void };
  histogram(name: string, unit: 's'): { record(value: number, attributes: Attributes): void };
}

interface Observability {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly comments?: { readonly keys: readonly [CommentKey, ...CommentKey[]] };
}

/** ./SPEC.md §5. Attached to the compiled query by the compiler, not re-derived. */
interface QueryTelemetry {
  readonly system: 'postgresql' | 'mysql' | 'sqlite';
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}

type TelemetryQuery = CompiledQuery & { readonly telemetry?: QueryTelemetry };

/** ./SPEC.md §3: `Ctx` gains exactly one field, definite inside the tracer branch. */
type TracedCtx = Ctx<Record<string, string>> & { readonly span?: Span };

/**
 * ./SPEC.md §4: the server span is created by the **Router**, not by the adapter, because
 * `http.route` is not derivable from anything a handler or an adapter sees. So the seam is
 * `createRouter`'s argument. Today `createRouter` takes none (`createRouter.length` is 0,
 * asserted in the baseline test below); #582 widens it.
 */
const createTracedRouter: (observability?: Observability) => Router = () => {
  throw new Error('#580 tests freeze: createRouter does not accept an Observability yet (observability SPEC §3)');
};

/**
 * ./SPEC.md §4: one database span per query, created by the driver decorator. Named
 * structurally rather than against `@zmdb/repository`'s `Driver` so that this file does not
 * add a dependency; `Driver` is `{ dialect?, execute }` at `packages/repository/src/index.ts:51-54`.
 */
interface ExecutingDriver {
  readonly dialect?: 'postgres' | 'mysql' | 'sqlite';
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

const tracedDriver: (driver: ExecutingDriver, observability: Observability, parent?: Span) => ExecutingDriver = () => {
  throw new Error('#580 tests freeze: tracedDriver is unimplemented (observability SPEC §4)');
};

/** ./SPEC.md §8, outbound. The one export §8 names: the framework does not wrap `fetch`. */
const toTraceparent: (span: Span) => string = () => {
  throw new Error('#580 tests freeze: toTraceparent is unimplemented (observability SPEC §8)');
};

/**
 * ./SPEC.md §8, inbound. §9.10 requires that `toTraceparent`'s output "is accepted by the
 * inbound parser", so the parser has to be reachable from a test; §8 names only the outbound
 * export, so this name is #582's to choose and this signature is what §9.10 needs. Returns
 * `undefined` for a malformed header, which is §8's "ignored, and a new trace begins".
 */
const fromTraceparent: (header: string) => SpanContext | undefined = () => {
  throw new Error('#580 tests freeze: fromTraceparent is unimplemented (observability SPEC §8)');
};

/**
 * ./SPEC.md §8, message transports: a request/reply consumer starts a **child** span and a
 * queued consumer starts a **linked** one. The envelope carries the same string
 * `toTraceparent` produces. The name and the exact argument shape are #582's; the discriminant
 * has to exist, because it is the only thing §9.11 can assert.
 */
const consumerSpan: (
  observability: Observability,
  envelope: { readonly traceparent?: string },
  delivery: 'queued' | 'request-reply',
) => Span = () => {
  throw new Error('#580 tests freeze: consumerSpan is unimplemented (observability SPEC §8)');
};
// --------------------------- end frozen surface ---------------------------

// --- the recording tracer -------------------------------------------------

interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly context: SpanContext;
  readonly parent?: SpanContext;
  readonly link?: SpanContext;
  readonly exceptions: Error[];
  status?: { readonly error: boolean };
  ended: boolean;
}

interface RecordingTracer extends Tracer {
  readonly spans: readonly RecordedSpan[];
  /** The recorded spans whose `parent` is `span`, in creation order. */
  childrenOf: (span: RecordedSpan) => readonly RecordedSpan[];
  readonly root: () => RecordedSpan | undefined;
}

const hex = (length: number, seed: number): string => seed.toString(16).padStart(length, '0');

const recordingTracer = (traceId = hex(32, 0x4bf9)): RecordingTracer => {
  const spans: RecordedSpan[] = [];
  let nextId = 1;

  const tracer: RecordingTracer = {
    spans,
    root: () => spans.find(s => s.parent === undefined),
    childrenOf: parent => spans.filter(s => s.parent?.spanId === parent.context.spanId),
    startSpan: (name, options) => {
      nextId += 1;
      const context: SpanContext = {
        // §9.9: a child of an extracted context keeps the incoming trace id, so the recorder
        // has to inherit it rather than mint one, or the assertion would be vacuous.
        traceId: options?.parent?.traceId ?? traceId,
        spanId: hex(16, nextId),
        traceFlags: 1,
      };
      const recorded: RecordedSpan = {
        name,
        attributes: {},
        context,
        ...(options?.parent === undefined ? {} : { parent: options.parent }),
        ...(options?.link === undefined ? {} : { link: options.link }),
        exceptions: [],
        ended: false,
      };
      spans.push(recorded);
      return {
        setAttribute: (key, value) => {
          recorded.attributes[key] = value;
        },
        recordException: error => {
          recorded.exceptions.push(error);
        },
        setStatus: status => {
          recorded.status = status;
        },
        end: () => {
          recorded.ended = true;
        },
        spanContext: () => context,
      };
    },
  };
  return tracer;
};

/**
 * §9.1's instrument: every method throws. Passed where a tracer *is* configured, so that the
 * tracerless run's silence is evidence of a branch rather than of a swallowed call.
 */
const throwingTracer = (): Tracer => ({
  startSpan: () => {
    throw new Error('tracer was constructed on a path that must not touch it');
  },
});

interface RecordedMeasurement {
  readonly metric: string;
  readonly unit: string;
  readonly value: number;
  readonly attributes: Attributes;
}

interface RecordingMeter extends Meter {
  readonly measurements: readonly RecordedMeasurement[];
}

const recordingMeter = (): RecordingMeter => {
  const measurements: RecordedMeasurement[] = [];
  return {
    measurements,
    counter: metric => ({
      add: (value, attributes) => {
        measurements.push({ metric, unit: '', value, attributes });
      },
    }),
    histogram: (metric, unit) => ({
      record: (value, attributes) => {
        measurements.push({ metric, unit, value, attributes });
      },
    }),
  };
};

// --- the application under test -------------------------------------------

/** A `CompiledQuery` carrying §5's `telemetry`, which today's compiler does not attach. */
const telemetryQuery = (text: string, parameters: readonly unknown[], telemetry: QueryTelemetry): TelemetryQuery => ({
  text,
  parameters,
  telemetry,
});

const noRows = (): ExecutingDriver => ({
  dialect: 'postgres',
  execute: () => Promise.resolve([]),
});

/**
 * Produced by the real compiler, recorded 2026-09-04: `Object.isFrozen` is true and
 * `Object.keys` is exactly `["text","parameters"]`, which is the shape §5's `telemetry` is
 * additive to. The `telemetry` here is what the compiler will attach, not something derived.
 */
const INSERT_ORDER: TelemetryQuery = telemetryQuery('INSERT INTO "orders" ("sku", "qty") VALUES ($1, $2)', ['X-1', 2], {
  system: 'postgresql',
  operation: 'INSERT',
  collection: 'orders',
});

const seenContexts: TracedCtx[] = [];

/**
 * Set by the nesting test only. §4 puts the database span under the *handler* span rather
 * than under the server span, and the only way to assert that is for a handler to actually
 * issue a query — so `create` runs one when this is set, through the decorator §4 names, with
 * `ctx.span` as the parent. Every other test leaves it `undefined`, which is why the green
 * baseline below can POST without touching the unimplemented decorator.
 */
let queryObservability: Observability | undefined;

@Controller('/posts')
class PostsController {
  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) {
    seenContexts.push(ctx as TracedCtx);
    return { id: ctx.params.id };
  }

  @Post('/')
  async create(ctx: Ctx<Record<never, string>, { title: string }>) {
    const traced = ctx as unknown as TracedCtx;
    seenContexts.push(traced);
    if (queryObservability !== undefined) {
      const driver = tracedDriver(noRows(), queryObservability, traced.span);
      await driver.execute(INSERT_ORDER);
    }
    return json({ title: ctx.body.title }, { status: 201 });
  }
}

const controller = () => new PostsController();
const validateTitle = (raw: unknown): unknown => {
  const body = raw as { title?: unknown };
  if (typeof body.title !== 'string') {
    throw new TypeError('title must be a string');
  }
  return body;
};

const GET_POST: WebRequest = { method: 'GET', path: '/posts/1', headers: {} };
const VALID_TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('spans, metrics and propagation (#580 freeze of observability SPEC)', () => {
  // GREEN, and the whole file leans on it. ./SPEC.md §9.1 asks for "byte-identical
  // responses" and §9.8 for "a 200"; both are trivially true today because there is no
  // tracing code, so the only way those assertions mean anything after #582 is if the bytes
  // were written down before it. This test is that record.
  //
  // Recorded 2026-09-04 by driving the real `createRouter` under vitest. The seven
  // `traceparent` variants below — valid, malformed, uppercase hex, all-zero trace id,
  // version `ff`, version `01` with a trailing field, and absent — all produce the identical
  // 200 today, which is exactly why §9.8's status assertion needs the span half beside it.
  it('the untraced response is the byte-identical baseline this freeze recorded', async () => {
    const router = createRouter();
    router.register(controller(), { create: { validateBody: validateTitle } });

    const headers = [
      {},
      { traceparent: VALID_TRACEPARENT },
      { traceparent: 'not-a-traceparent' },
      { traceparent: '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01' },
      { traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01' },
      { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01' },
      { traceparent: 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      { traceparent: '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra' },
    ];

    for (const header of headers) {
      const response = await router.handle({ ...GET_POST, headers: header });
      expect(response.status).toBe(200);
      expect(response.body).toBe('{"id":"1"}');
      expect(response.headers['content-type']).toBe('application/json');
    }

    const unmatched = await router.handle({ method: 'GET', path: '/nope/1', headers: {} });
    expect(unmatched.status).toBe(404);
    expect(unmatched.body).toBe('{"error":"no route for GET /nope/1"}');

    const wrongMethod = await router.handle({ method: 'DELETE', path: '/posts/1', headers: {} });
    expect(wrongMethod.status).toBe(404);
    expect(wrongMethod.body).toBe('{"error":"no route for DELETE /posts/1"}');

    const created = await router.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 'hi' } });
    expect(created.status).toBe(201);
    expect(created.body).toBe('{"title":"hi"}');

    const rejected = await router.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 1 } });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toBe('{"error":"title must be a string"}');

    // §3's seam does not exist yet, stated as a number rather than as prose so that the day it
    // changes is the day this line changes. #582 widens `createRouter` to take an
    // `Observability`, at which point `length` becomes 0 still (the parameter is optional) —
    // so the assertion that actually moves is `createTracedRouter` stopping to throw.
    expect(createRouter.length).toBe(0);
    expect(Object.keys(createRouter())).toEqual(['register', 'handle']);
  });

  // GREEN. ./SPEC.md §5's central argument for attaching `telemetry` to the compiled query is
  // that the alternative "is a bug that is already written down": `web-observability.md`
  // derives the operation name with `/^\s*(\w+)/`, and that page is live documentation, not a
  // hypothetical. Both failure modes it names are asserted here against the page's own code,
  // because §9.6's `it.fails` can only assert what the *fix* does — this is the assertion that
  // the thing being fixed is real.
  //
  // Recorded 2026-09-04 with `node`, against the expression still printed at
  // `docs-site/content/web-observability.md:116`:
  //   a CTE ending in an insert       -> "WITH"
  //   a leading-comment SELECT        -> "OTHER"
  //   a trailing-comment SELECT       -> "SELECT"
  it('the operation-name regex on the docs page misreads a CTE and a leading comment', () => {
    const verb = (sql: string) => (/^\s*(\w+)/.exec(sql)?.[1] ?? 'other').toUpperCase();

    expect(verb('WITH moved AS (DELETE FROM "a" RETURNING *) INSERT INTO "b" SELECT * FROM moved')).toBe('WITH');
    expect(verb("/*route='%2Fposts%2F%3Aid'*/ SELECT 1")).toBe('OTHER');
    expect(verb("SELECT 1 /*route='%2Fposts%2F%3Aid'*/")).toBe('SELECT');

    // Neither answer is `INSERT`, which is what §9.6 requires and what the compiler knows
    // without a regular expression. `other` is the label every database metric in an
    // application collapses to the moment a leading comment appears, which is §4 of the
    // comment spec's third reason for putting the tag at the end.
    expect(verb('WITH moved AS (DELETE FROM "a" RETURNING *) INSERT INTO "b" SELECT * FROM moved')).not.toBe('INSERT');
  });

  // §9.1. Two runs, and the discriminating assertion is the second one.
  //
  // With no `Observability`, `ctx.span` must be `undefined`: §3 fills it "only inside the
  // branch where a tracer exists". A no-op-tracer implementation — the design §3 rejects —
  // would hand the handler a no-op `Span`, and that is observable from the handler, which is
  // why this is the assertion rather than a timing measurement. The issue body asks for the
  // zero-cost property "measured"; a measurement is a benchmark (`../bench/SPEC.md` owns the
  // numbers, and the roadmap gives publishing them to #582), so what lands here is §9.1's own
  // behavioural form.
  //
  // With a throwing tracer, `handle` must reach the tracer, which proves the tracerless run's
  // silence came from a branch rather than from an implementation that ignores its argument.
  //
  // Current actual: `createTracedRouter` throws
  // `Error: #580 tests freeze: createRouter does not accept an Observability yet
  // (observability SPEC §3)`. The real `createRouter` today gives `ctx.span === undefined`
  // for free, because `Ctx` has no `span` field at all — so the first half of this test
  // already holds and only the second half can fail once #582 exists.
  it.fails('allocates nothing per request or per query when no tracer is configured', async () => {
    seenContexts.length = 0;
    const untraced = createTracedRouter({});
    untraced.register(controller());
    const response = await untraced.handle(GET_POST);

    expect(response.body).toBe('{"id":"1"}');
    expect(seenContexts).toHaveLength(1);
    expect(seenContexts[0]?.span).toBeUndefined();
    expect('span' in (seenContexts[0] ?? {})).toBe(false);

    // The driver decorator has the same branch, and the same evidence: no tracer, no span,
    // and the compiled query reaches the driver untouched.
    const seen: CompiledQuery[] = [];
    const driver = tracedDriver({ execute: q => (seen.push(q), Promise.resolve([])) }, {});
    const query = telemetryQuery('SELECT 1', [], { system: 'postgresql', operation: 'SELECT', collection: 'x' });
    await driver.execute(query);
    expect(seen[0]).toBe(query);

    // And a configured tracer *is* used, so the silence above is a branch.
    const traced = createTracedRouter({ tracer: throwingTracer() });
    traced.register(controller());
    await expect(traced.handle(GET_POST)).rejects.toThrow('tracer was constructed');
  });

  // §9.3 and §9.4. Semconv requires `{method} {http.route}` with a low-cardinality route, so
  // the name is `GET /posts/:id` and never `GET /posts/1`. §4 explains why the router has to
  // be the thing that creates it: `Ctx` is `{ params, body, query, headers, method, path }`
  // and `path` is the concrete `/posts/1`, so only the matched route knows `/posts/:id`.
  //
  // Every key is a literal string, per §9.4: "A test that compares against a constant
  // exported from the implementation would pass through a rename, which is the exact failure
  // §1 is about."
  //
  // Current actual: `createTracedRouter` throws `Error: #580 tests freeze: createRouter does
  // not accept an Observability yet (observability SPEC §3)`. The untraced response today is
  // `{"status":200,"body":"{\"id\":\"1\"}"}` with no span of any kind.
  it.fails('creates a server span with the conventional name and attributes', async () => {
    const tracer = recordingTracer();
    const router = createTracedRouter({ tracer });
    router.register(controller());

    await router.handle({ ...GET_POST, headers: { host: 'api.example.test' } });

    const root = tracer.root();
    expect(root?.name).toBe('GET /posts/:id');
    expect(root?.name).not.toContain('/posts/1');
    expect(root?.ended).toBe(true);

    expect(root?.attributes['http.request.method']).toBe('GET');
    expect(root?.attributes['http.route']).toBe('/posts/:id');
    expect(root?.attributes['url.path']).toBe('/posts/1');
    expect(root?.attributes['url.scheme']).toBe('http');
    expect(root?.attributes['http.response.status_code']).toBe(200);
    expect(root?.attributes['server.address']).toBe('api.example.test');

    // The deprecated spelling the issue body used must not also be present: emitting both is
    // how a dashboard keeps working while nobody notices the rename never happened.
    expect(root?.attributes).not.toHaveProperty('http.status_code');

    // §5: `_OTHER` for a method not in the RFC list, and uppercase for one that is.
    const oddMethod = recordingTracer();
    const oddRouter = createTracedRouter({ tracer: oddMethod });
    oddRouter.register(controller());
    await oddRouter.handle({ method: 'propfind', path: '/posts/1', headers: {} });
    expect(oddMethod.root()?.attributes['http.request.method']).toBe('_OTHER');

    // §5: `error.type` is the thrown value's constructor name, and the status code is set at
    // the end — so it is present here because the request completed, 400 and all.
    const errored = recordingTracer();
    const errorRouter = createTracedRouter({ tracer: errored });
    errorRouter.register(controller(), { create: { validateBody: validateTitle } });
    await errorRouter.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 1 } });
    expect(errored.root()?.attributes['error.type']).toBe('TypeError');
    expect(errored.root()?.attributes['http.response.status_code']).toBe(400);
    expect(errored.root()?.status).toEqual({ error: true });
  });

  // §9.3, the other half. §4: "A request that matches no route has no `http.route`, so its
  // span name is the method alone — `GET` — because semconv forbids putting the raw path in a
  // span name and an unmatched path is unbounded cardinality by definition." The raw path is
  // the whole risk here: a scanner hitting ten thousand distinct URLs is ten thousand span
  // names, which is the classic way to bankrupt a tracing bill.
  //
  // Current actual: `createTracedRouter` throws. The real router today answers
  // `{"status":404,"body":"{\"error\":\"no route for GET /nope/1\"}"}` and records nothing.
  it.fails('names the server span for the method alone when no route matched', async () => {
    const tracer = recordingTracer();
    const router = createTracedRouter({ tracer });
    router.register(controller());

    const response = await router.handle({ method: 'GET', path: '/nope/1', headers: {} });
    expect(response.status).toBe(404);

    const root = tracer.root();
    expect(root?.name).toBe('GET');
    expect(root?.name).not.toContain('/nope');
    expect(root?.attributes).not.toHaveProperty('http.route');
    // §5: `url.path` is "the concrete path — an attribute, never a span name", so the path is
    // still recoverable for whoever is looking at the scanner.
    expect(root?.attributes['url.path']).toBe('/nope/1');
    expect(root?.attributes['http.response.status_code']).toBe(404);
  });

  // §9.2. Four span kinds in §4's nesting, and the nesting is asserted through `parent` span
  // ids rather than through call order, because a flat list of correctly-named spans renders
  // as four unrelated traces.
  //
  // No interceptor span: §4 is explicit that `runChain` has no caller in the pipeline (#573),
  // so a fifth span would be one that never executes — "it appears in this document, somebody
  // builds a panel expecting it, and the panel is empty for a reason nobody can find". The
  // issue body's five-span list is corrected to four here, and the absence is asserted.
  //
  // Current actual: `createTracedRouter` throws `Error: #580 tests freeze: createRouter does
  // not accept an Observability yet (observability SPEC §3)`.
  it.fails('nests routing, validation, handler and query spans under the server span', async () => {
    const tracer = recordingTracer();
    const router = createTracedRouter({ tracer });
    router.register(controller(), { create: { validateBody: validateTitle } });

    queryObservability = { tracer };
    try {
      await router.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 'hi' } });
    } finally {
      queryObservability = undefined;
    }

    const root = tracer.root();
    expect(root?.name).toBe('POST /posts');
    expect(root).toBeDefined();

    const children = root === undefined ? [] : tracer.childrenOf(root);
    expect(children.map(c => c.name)).toEqual(['zmdb.route', 'zmdb.validate', 'zmdb.handler']);

    // Every child of the server span is one of §4's three request-side kinds, and each shares
    // the trace: the tree is one level deep on the request side.
    for (const child of children) {
      expect(child.parent?.spanId).toBe(root?.context.spanId);
      expect(child.context.traceId).toBe(root?.context.traceId);
      expect(child.ended).toBe(true);
    }

    // The query span is the fourth kind and it is a *grandchild*: §4 nests it under the
    // handler, not under the server span, because the driver decorator is handed `ctx.span`.
    // A query span parented to the server span would render beside the handler rather than
    // inside it, which is the wrong answer to "what was this query doing".
    const handler = children.find(c => c.name === 'zmdb.handler');
    expect(handler).toBeDefined();
    const dbSpans = handler === undefined ? [] : tracer.childrenOf(handler);
    expect(dbSpans).toHaveLength(1);
    expect(dbSpans[0]?.attributes['db.operation.name']).toBe('INSERT');
    expect(dbSpans[0]?.context.traceId).toBe(root?.context.traceId);
    for (const other of children) {
      if (other.name !== 'zmdb.handler') {
        expect(tracer.childrenOf(other)).toHaveLength(0);
      }
    }

    // Four kinds, not five. No span named for an interceptor, under any spelling.
    for (const span of tracer.spans) {
      expect(span.name).not.toContain('interceptor');
      expect(span.name).not.toBe('zmdb.intercept');
    }
    expect(tracer.spans).toHaveLength(5);
  });

  // §9.2's other half: `zmdb.validate` is present only when `RouteOptions.validateBody` is
  // set. A validation span emitted unconditionally is an empty span on every route that has no
  // validator, which is a per-request allocation and a waterfall row that means nothing.
  //
  // Note the shape of `register`'s second argument, which the issue body's sketch gets wrong:
  // it is `Readonly<Record<string, RouteOptions>>` keyed by *handler name*
  // (`pipeline/index.ts`), not a single `RouteOptions`. Verified by running the real router:
  // passing `{ validateBody }` directly registers no validator and the bad body is accepted
  // with a 201 and `{"title":1}`.
  //
  // Current actual: `createTracedRouter` throws.
  it.fails('omits the validation span when validateBody is unset', async () => {
    const withValidator = recordingTracer();
    const validating = createTracedRouter({ tracer: withValidator });
    validating.register(controller(), { create: { validateBody: validateTitle } });
    await validating.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 'hi' } });
    expect(withValidator.spans.map(s => s.name)).toContain('zmdb.validate');

    const withoutValidator = recordingTracer();
    const plain = createTracedRouter({ tracer: withoutValidator });
    plain.register(controller());
    await plain.handle({ method: 'POST', path: '/posts', headers: {}, rawBody: { title: 'hi' } });
    expect(withoutValidator.spans.map(s => s.name)).not.toContain('zmdb.validate');
    expect(withoutValidator.spans.map(s => s.name)).toEqual(['POST /posts', 'zmdb.route', 'zmdb.handler']);
  });

  // §9.6, and §9.4 for the database keys. The attributes come from `CompiledQuery.telemetry`,
  // which the compiler filled in because it "knows the dialect, the verb and the table without
  // a regular expression".
  //
  // The CTE case is the assertion the docs page's regex fails, and it is built from a
  // hand-written `CompiledQuery` rather than a compiled one on purpose: zmdb's compiler has no
  // `WITH` clause at all (`tests/api-coverage/mapping.mjs` records this as `NO_CTE`, "zmdb has
  // no WITH clause"), so there is no builder call that would produce this text. Nothing is lost
  // — §9.6 is an assertion about where the label comes from, and a literal makes that sharper
  // than a builder would, because the text and the telemetry visibly disagree.
  //
  // Current actual: `tracedDriver` throws `Error: #580 tests freeze: tracedDriver is
  // unimplemented (observability SPEC §4)`. Recorded with `node`: the docs page's
  // `/^\s*(\w+)/` returns `"WITH"` for this exact text, which is the wrong label.
  it.fails('takes query span attributes from the compiled query rather than parsing SQL at execution', async () => {
    const tracer = recordingTracer();
    const cte = telemetryQuery(
      'WITH moved AS (DELETE FROM "staging" RETURNING *) INSERT INTO "orders" SELECT * FROM moved',
      [],
      { system: 'postgresql', operation: 'INSERT', collection: 'orders' },
    );

    const driver = tracedDriver(noRows(), { tracer });
    await driver.execute(cte);

    const dbSpan = tracer.spans.at(-1);
    expect(dbSpan?.attributes['db.operation.name']).toBe('INSERT');
    expect(dbSpan?.attributes['db.operation.name']).not.toBe('WITH');
    expect(dbSpan?.attributes['db.collection.name']).toBe('orders');
    expect(dbSpan?.attributes['db.system.name']).toBe('postgresql');
    expect(dbSpan?.attributes['db.query.text']).toBe(cte.text);
    expect(dbSpan?.attributes['zmdb.db.parameter_count']).toBe(0);

    // §5: all four of the issue body's database attribute names are the deprecated spellings,
    // and emitting both the old and the new one is how a rename never actually happens.
    for (const deprecated of ['db.system', 'db.operation', 'db.sql.table', 'db.statement']) {
      expect(dbSpan?.attributes).not.toHaveProperty(deprecated);
    }

    // §5: `zmdb.db.parameter_count` is namespaced outside `db.` because semconv reserves that
    // prefix and recent releases use `db.operation.parameter.<key>` for parameter *values*,
    // which §6 refuses to emit under any setting.
    expect(dbSpan?.attributes).not.toHaveProperty('db.parameter_count');
    expect(dbSpan?.attributes).not.toHaveProperty('db.operation.parameter.0');

    // A leading comment cannot change the label either, which is the property that makes the
    // comment spec's placement decision a belt-and-braces one rather than the only defence.
    const commented = telemetryQuery(`/*route='%2Fx'*/ ${cte.text}`, [], {
      system: 'postgresql',
      operation: 'INSERT',
      collection: 'orders',
    });
    await driver.execute(commented);
    expect(tracer.spans.at(-1)?.attributes['db.operation.name']).toBe('INSERT');
  });

  // §9.5. The statement is recorded — §6 argues zmdb "has an unusually strong right to do it",
  // because `CompiledQuery` is `{ text, parameters }` with parameters bound by the driver, so
  // the text contains no user data *by construction*. The parameter values are never recorded
  // at any level and there is no option that enables it.
  //
  // Asserted the way §9.5 asks: a distinctive parameter, then a search of *every* recorded
  // attribute on *every* span. A per-attribute assertion would miss the leak that arrives on
  // a key nobody thought of, which is the only way this leak ever arrives.
  //
  // Current actual: `tracedDriver` throws `Error: #580 tests freeze: tracedDriver is
  // unimplemented (observability SPEC §4)`. Recorded with `node`: the real compiler produces
  // `SELECT "id" FROM "users" WHERE "email" = $1` with `parameters: ["zz-canary-9f3a@example.test"]`,
  // so the canary genuinely is in the query and absent from the text.
  it.fails('records the statement but never parameter values', async () => {
    const canary = 'zz-canary-9f3a@example.test';
    const tracer = recordingTracer();
    const query = telemetryQuery('SELECT "id" FROM "users" WHERE "email" = $1', [canary], {
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });

    const driver = tracedDriver(noRows(), { tracer });
    await driver.execute(query);

    const dbSpan = tracer.spans.at(-1);
    expect(dbSpan?.attributes['db.query.text']).toBe('SELECT "id" FROM "users" WHERE "email" = $1');
    expect(dbSpan?.attributes['db.query.text']).toBe(query.text);
    expect(dbSpan?.attributes['zmdb.db.parameter_count']).toBe(1);

    for (const span of tracer.spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(`${key}=${String(value)}`).not.toContain(canary);
      }
      expect(JSON.stringify(span.attributes)).not.toContain(canary);
    }
  });

  // §9.7. Seconds, not milliseconds, and §7's reason is mechanical rather than stylistic:
  // semconv's duration histograms have bucket boundaries chosen for seconds, so a
  // millisecond value exported under a seconds-named metric lands every observation in the
  // top bucket and the histogram is a flat line at the maximum.
  //
  // §9.7 asks for "an operation held open past one second producing a value greater than one
  // and less than a hundred". That range is what distinguishes seconds from milliseconds
  // (1500) and from nanoseconds, and it is asserted on the fake clock so the test is not a
  // 1.5-second sleep in CI. #582 must therefore measure with something `vi.useFakeTimers()`
  // controls — `Date.now()` or `performance.now()`, both of which vitest fakes by default.
  //
  // Current actual: `createTracedRouter` throws.
  it.fails('records durations in seconds, not milliseconds', async () => {
    vi.useFakeTimers();
    try {
      const meter = recordingMeter();
      const router = createTracedRouter({ meter });
      router.register(controller(), {
        get: {
          validateBody: () => {
            vi.advanceTimersByTime(1500);
            return undefined;
          },
        },
      });

      await router.handle(GET_POST);

      const http = meter.measurements.find(m => m.metric === 'http.server.request.duration');
      expect(http).toBeDefined();
      expect(http?.unit).toBe('s');
      expect(http?.value).toBeGreaterThan(1);
      expect(http?.value).toBeLessThan(100);

      // §7's attribute set is exactly semconv's required and recommended keys, which is the
      // cardinality bound. `url.path` is the one that must not be here: it is
      // `web-observability.md`'s worked mistake, and unbounded label cardinality is how a
      // metrics backend falls over.
      expect(Object.keys(http?.attributes ?? {}).toSorted()).toEqual([
        'http.request.method',
        'http.response.status_code',
        'http.route',
      ]);
      expect(http?.attributes).not.toHaveProperty('url.path');

      // Two metrics, not four (§7): no pool metrics, and no separate error counter, because
      // error rate is derivable from `error.type` on the duration histogram.
      const names = new Set(meter.measurements.map(m => m.metric));
      expect([...names].toSorted()).toEqual(['http.server.request.duration']);
      for (const name of names) {
        expect(name).not.toContain('_ms');
        expect(name).not.toContain('pool');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // §9.9. Without extraction "the caller's trace ends at the door", which
  // `web-tracing.md` calls the single most common tracing misconfiguration.
  //
  // Current actual: `createTracedRouter` throws. Recorded with the real router: a request
  // carrying this exact header produces a response byte-identical to one without it, which is
  // precisely the failure — the header is read by nothing.
  it.fails('extracts an incoming traceparent and continues the trace', async () => {
    const tracer = recordingTracer('ffffffffffffffffffffffffffffffff');
    const router = createTracedRouter({ tracer });
    router.register(controller());

    const response = await router.handle({ ...GET_POST, headers: { traceparent: VALID_TRACEPARENT } });
    expect(response.body).toBe('{"id":"1"}');

    const root = tracer.root() ?? tracer.spans[0];
    // The server span is a *child* of the extracted context, so it is not a root at all: its
    // parent is the incoming span id and the trace id is the incoming trace id, not the one
    // this tracer would have minted.
    expect(root?.parent?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(root?.parent?.spanId).toBe('00f067aa0ba902b7');
    expect(root?.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(root?.context.traceId).not.toBe('ffffffffffffffffffffffffffffffff');
    expect(root?.context.spanId).not.toBe('00f067aa0ba902b7');

    // Every span in the request shares the incoming trace id, or the trace is two traces.
    for (const span of tracer.spans) {
      expect(span.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    }

    // §8: `tracestate` that fails to parse is dropped while `traceparent` is kept, "because
    // the two carry different things and the vendor field is the one nobody's correctness
    // depends on".
    const keptTracer = recordingTracer();
    const keptRouter = createTracedRouter({ tracer: keptTracer });
    keptRouter.register(controller());
    await keptRouter.handle({
      ...GET_POST,
      headers: { traceparent: VALID_TRACEPARENT, tracestate: 'this=is=not=valid,,,' },
    });
    expect(keptTracer.spans[0]?.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  // §9.8. Each of §8's malformed cases produces a 200 and a *root* span with a fresh trace id.
  // The 200 is not the interesting half — it is already true, because nothing reads the header
  // — so the assertion that carries the weight is that a span exists and has no parent.
  //
  // §8's reason for never failing the request is a failure mode, not a preference: "a
  // misconfigured upstream injecting a bad header takes down every downstream service at
  // once", and a header a client controls must not be able to produce a 400 on a route that
  // has nothing to do with tracing.
  //
  // Current actual: `createTracedRouter` throws. All six malformed headers already produce
  // `{"status":200,"body":"{\"id\":\"1\"}"}` today, recorded in the baseline test above.
  it.fails('ignores a malformed traceparent and starts a new trace without failing the request', async () => {
    const malformed: readonly [string, string][] = [
      ['wrong field count', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7'],
      ['wrong length', '00-4bf92f-00f067aa0ba902b7-01'],
      ['uppercase hex', '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01'],
      ['all-zero trace id', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
      ['all-zero span id', '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'],
      ['version ff', 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
      ['not hex at all', 'not-a-traceparent'],
      ['empty', ''],
    ];

    for (const [label, header] of malformed) {
      const tracer = recordingTracer();
      const router = createTracedRouter({ tracer });
      router.register(controller());

      const response = await router.handle({ ...GET_POST, headers: { traceparent: header } });
      expect(response.status, label).toBe(200);
      expect(response.body, label).toBe('{"id":"1"}');

      const root = tracer.spans[0];
      expect(root?.parent, label).toBeUndefined();
      expect(root?.context.traceId, label).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(root?.context.traceId, label).not.toBe('00000000000000000000000000000000');
      expect(fromTraceparent(header), label).toBeUndefined();
    }
  });

  // §9.8's last clause, and §8 flags it as "the forward-compatibility rule the W3C spec
  // requires and the one an implementation is most likely to get wrong by rejecting instead".
  // A future version number with a trailing field is read by taking the first four fields and
  // ignoring the remainder; rejecting it means every downstream service loses the trace the
  // day one upstream upgrades.
  //
  // Current actual: `fromTraceparent` throws `Error: #580 tests freeze: fromTraceparent is
  // unimplemented (observability SPEC §8)`.
  it.fails('accepts a version 01 traceparent with a trailing field', () => {
    const accepted = fromTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-what-comes-next');
    expect(accepted?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(accepted?.spanId).toBe('00f067aa0ba902b7');

    // Version `00` with a trailing field is *not* the same case: `00` is fully specified, so a
    // fifth field means the header is malformed rather than newer.
    expect(fromTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra')).toBeUndefined();
    // And `ff` is reserved, so it stays rejected however many fields it has.
    expect(fromTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeUndefined();
  });

  // §9.10. `toTraceparent` round-trips through the inbound parser. §8 exports one function and
  // the caller writes one header, because "patching a global is what a no-dependency package
  // should be least willing to do" and two things patching the same `fetch` is a debugging
  // session nobody enjoys.
  //
  // The round trip is the assertion rather than a string comparison because it is the property
  // that matters: the two halves must agree, and a shared constant would let both drift
  // together.
  //
  // Current actual: `toTraceparent` throws `Error: #580 tests freeze: toTraceparent is
  // unimplemented (observability SPEC §8)`.
  it.fails('injects traceparent into an outgoing message', () => {
    const tracer = recordingTracer();
    const span = tracer.startSpan('zmdb.handler');
    const header = toTraceparent(span);

    expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    const parsed = fromTraceparent(header);
    expect(parsed?.traceId).toBe(span.spanContext().traceId);
    expect(parsed?.spanId).toBe(span.spanContext().spanId);

    // The header names the span it was produced from, not its parent: a consumer that parents
    // itself to the producer's parent produces a flat trace.
    expect(header).toContain(span.spanContext().spanId);
    expect(header.toLowerCase()).toBe(header);
  });

  // §9.11. A request/reply consumer is a **child**; a queued consumer is **linked**. §8's
  // reason: "a parent-child edge across an unbounded queue delay produces a trace whose
  // duration is the queue's latency and whose waterfall is unreadable". A trace that says a
  // request took four hours because the message sat in a queue is a trace nobody can use.
  //
  // Current actual: `consumerSpan` throws `Error: #580 tests freeze: consumerSpan is
  // unimplemented (observability SPEC §8)`.
  it.fails('links a queued consumer span and parents a request-reply one', () => {
    const queued = recordingTracer();
    consumerSpan({ tracer: queued }, { traceparent: VALID_TRACEPARENT }, 'queued');
    const queuedSpan = queued.spans[0];
    expect(queuedSpan?.link?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(queuedSpan?.link?.spanId).toBe('00f067aa0ba902b7');
    expect(queuedSpan?.parent).toBeUndefined();
    // Linked, so a new trace: the consumer's duration is its own, not the queue's.
    expect(queuedSpan?.context.traceId).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    const replying = recordingTracer();
    consumerSpan({ tracer: replying }, { traceparent: VALID_TRACEPARENT }, 'request-reply');
    const replySpan = replying.spans[0];
    expect(replySpan?.parent?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(replySpan?.parent?.spanId).toBe('00f067aa0ba902b7');
    expect(replySpan?.link).toBeUndefined();
    expect(replySpan?.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');

    // An envelope with no context is a root either way, and a malformed one is ignored
    // exactly as an HTTP header is (§8: "the same validation on the way in").
    const orphan = recordingTracer();
    consumerSpan({ tracer: orphan }, {}, 'queued');
    consumerSpan({ tracer: orphan }, { traceparent: 'not-a-traceparent' }, 'request-reply');
    for (const span of orphan.spans) {
      expect(span.parent).toBeUndefined();
      expect(span.link).toBeUndefined();
    }
  });

  // §3's `Ctx.span`, which is the seam every reader in the epic goes through — the sqlcommenter
  // tag, a caller's own log line, and the driver decorator's parent span all read it. §3
  // refuses `AsyncLocalStorage` for it twice over: it is a `node:async_hooks` import in a
  // package whose whole shape is a Fetch-runtime handler, and it makes the current span
  // implicit, "which is only correct if every await boundary in the process is well behaved".
  //
  // The property `sql-comments.md` names as the virtue of explicit propagation is the one
  // asserted here: two concurrent requests cannot see each other's span.
  //
  // Current actual: `createTracedRouter` throws. `Ctx` today is
  // `{ params, body, query, headers, method, path }` with no `span` field, so
  // `'span' in ctx` is `false` and there is nothing for a handler to read.
  it.fails('hands the handler its own span through Ctx and not through ambient state', async () => {
    seenContexts.length = 0;
    const tracer = recordingTracer();
    const router = createTracedRouter({ tracer });
    router.register(controller());

    await Promise.all([
      router.handle({ ...GET_POST, path: '/posts/1' }),
      router.handle({ ...GET_POST, path: '/posts/2' }),
      router.handle({ ...GET_POST, path: '/posts/3' }),
    ]);

    expect(seenContexts).toHaveLength(3);
    const spanIds = seenContexts.map(ctx => ctx.span?.spanContext().spanId);
    expect(spanIds.every(id => typeof id === 'string')).toBe(true);
    expect(new Set(spanIds).size).toBe(3);

    // Each handler's span is the `zmdb.handler` span of its own request, so its parent is that
    // request's server span and no other.
    for (const ctx of seenContexts) {
      const own = tracer.spans.find(s => s.context.spanId === ctx.span?.spanContext().spanId);
      expect(own?.name).toBe('zmdb.handler');
      const parent = tracer.spans.find(s => s.context.spanId === own?.parent?.spanId);
      expect(parent?.attributes['url.path']).toBe(ctx.path);
    }
  });

  // §4's database span is created by the driver decorator, so its parent is whatever span the
  // caller passed — which in a request is `ctx.span`. Without that edge the query span is a
  // root and the waterfall shows a request and an unrelated query, which is the exact gap
  // `web-tracing.md` papers over with a hand-written helper.
  //
  // Current actual: `tracedDriver` throws `Error: #580 tests freeze: tracedDriver is
  // unimplemented (observability SPEC §4)`.
  it.fails('parents each query span to the span it was given', async () => {
    const tracer = recordingTracer();
    const parent = tracer.startSpan('zmdb.handler');
    const driver = tracedDriver(noRows(), { tracer }, parent);

    const first = telemetryQuery('SELECT "id" FROM "users"', [], {
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });
    const second = telemetryQuery('DELETE FROM "users" WHERE "id" = $1', [1], {
      system: 'postgresql',
      operation: 'DELETE',
      collection: 'users',
    });

    await driver.execute(first);
    await driver.execute(second);

    // §4: "one per query", so two queries are two spans and never one reused.
    const dbSpans = tracer.spans.filter(s => s.parent?.spanId === parent.spanContext().spanId);
    expect(dbSpans).toHaveLength(2);
    expect(new Set(dbSpans.map(s => s.context.spanId)).size).toBe(2);
    expect(dbSpans.map(s => s.attributes['db.operation.name'])).toEqual(['SELECT', 'DELETE']);
    for (const span of dbSpans) {
      expect(span.ended).toBe(true);
      expect(span.context.traceId).toBe(parent.spanContext().traceId);
    }

    // §5: `db.response.status_code` is the dialect's own error code on failure, and the span
    // records the exception rather than swallowing it.
    const failing = tracedDriver(
      { dialect: 'postgres', execute: () => Promise.reject(Object.assign(new Error('deadlock'), { code: '40P01' })) },
      { tracer },
      parent,
    );
    await expect(failing.execute(first)).rejects.toThrow('deadlock');
    const errored = tracer.spans.at(-1);
    expect(errored?.attributes['db.response.status_code']).toBe('40P01');
    expect(errored?.status).toEqual({ error: true });
    expect(errored?.exceptions.map(e => e.message)).toEqual(['deadlock']);
    expect(errored?.ended).toBe(true);
  });
});
