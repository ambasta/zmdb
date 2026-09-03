// Operating a zmdb service: is it healthy, what is it doing, and which query is the slow one. The
// fourth page — SQL comments — belongs here rather than with the compiler, because its only purpose is
// to make a database log correlate with an application trace.

export const OPS_EPICS = [
  {
    key: 'ops',
    title:
      '[EPIC] Operability — health checks, OpenTelemetry, trace propagation, and queries tagged for the database log',
    labels: ['enhancement', 'area:ops', 'area:web', 'parity:nestjs'],
    pages: ['web-health-checks', 'web-observability', 'web-tracing', 'sql-comments'],
    packages: ['@zmdb/web', '@zmdb/query-compiler', '@zmdb/repository'],
    motivation: `
Four notes: "no readiness/liveness aggregation module", "no OpenTelemetry instrumentation of the router,
pipeline or driver", "no span propagation across the request pipeline", and "the compiler emits no comment
markers, so queries cannot be tagged for the database log".

The fourth is the one that makes the other three pay off, and the reason to build them together. A trace
that ends at "the driver executed a query taking 400ms" tells you where the time went but not why. A
database slow-query log tells you the query text but not which request produced it. Emitting a
sqlcommenter-style comment — trace id, span id, controller, route — into the SQL means the two logs join.
That is a genuinely useful property and it is cheap to build, but only if the tracing exists to supply
the ids.

zmdb has an advantage on the cost side that is worth designing around rather than discovering later. Most
ORM instrumentation is expensive because it wraps a dynamic query builder and has to reconstruct what
happened. Here the SQL text is known at compile time, so the span attributes that describe a query —
operation, table, statement — can be attached to the compiled query rather than computed per execution.
The per-call cost should be creating a span and nothing else.

The health-check piece is the smallest and the most likely to be got subtly wrong. Liveness and readiness
mean different things: a liveness probe that checks the database will restart a healthy process during a
brief database blip, turning a partial outage into a full one. So the aggregation module has to make the
distinction structural rather than a naming convention, and the docs have to say why.
`,
    dod: [
      'A health module aggregates named checks and exposes liveness and readiness separately, with liveness structurally unable to depend on external services.',
      'Health endpoints have bounded per-check timeouts and never hang, and expose no internal detail to an unauthenticated caller.',
      'OpenTelemetry instrumentation covers the router, the pipeline, guards/pipes/interceptors, and the driver, with a documented span hierarchy and semantic conventions followed.',
      'Trace context propagates through the request pipeline and into message transports, with W3C `traceparent` extraction and injection.',
      'Query span attributes come from compile-time information rather than per-execution analysis.',
      'The compiler can emit a sqlcommenter-style comment carrying trace and route context, off by default, with injection impossible by construction.',
      'A benchmark shows the instrumentation overhead with tracing on and off, published honestly.',
      'All four pages flip to supported.',
    ],
    invariants: [
      '§1 cost model: instrumentation must be opt-in and near-free when off. With no tracer configured there must be no per-request or per-query allocation attributable to observability.',
      '§2.2 no runtime reflection: span attributes describing a query are computed when the query is compiled.',
      '§2.7 no hidden state: the tracer and the health registry are app-owned. No module-level global tracer reference reached from library code.',
      '§2.4 explicit SQL: a SQL comment is generated from a closed set of keys with escaped values. A comment assembled from arbitrary strings is a SQL injection vector, and this one would sit in the most trusted part of the codebase.',
      'A health endpoint is an information-disclosure surface. Detail is for authenticated callers; the public form is a status.',
    ],
    nonGoals: [
      "Shipping an exporter or a collector configuration. The OTel SDK is the user's to configure.",
      'A metrics dashboard. Emitting metrics is in scope; visualising them is not.',
      'Log aggregation.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] health semantics, the span hierarchy, propagation, and the comment format',
        labels: ['spec'],
        goal: 'Freeze liveness versus readiness semantics and the health response shapes, the complete span hierarchy with attribute names, context propagation in both directions, and the SQL comment format with its escaping rules. No code.',
        why: 'Span names and attributes are effectively a public interface — dashboards and alerts get built on them, so changing them later breaks user tooling. Following OpenTelemetry semantic conventions exactly, and writing the hierarchy down, is what stops that. The comment escaping rules need to be in the spec because getting them wrong is a SQL injection in generated SQL.',
        files: [
          '`packages/web/src/health/SPEC.md` (new)',
          '`packages/web/src/observability/SPEC.md` (new)',
          '`packages/query-compiler/src/comments/SPEC.md` (new)',
        ],
        api: `
export interface HealthCheck {
  readonly name: string;
  readonly kind: 'liveness' | 'readiness';
  readonly timeoutMs: number;
  run(signal: AbortSignal): Promise<{ readonly ok: boolean; readonly detail?: string }>;
}

export interface Observability {
  readonly tracer?: Tracer;      // absent means zero cost
  readonly meter?: Meter;
  readonly comments?: { readonly enabled: boolean; readonly keys: readonly CommentKey[] };
}

export type CommentKey = 'traceparent' | 'controller' | 'action' | 'route' | 'framework';
`,
        steps: [
          'Specify liveness as "the process is not wedged" and readiness as "the process can serve traffic", and make it structural: a liveness check must not be able to declare an external dependency. Say what the type-level or registration-level mechanism is, not just the convention.',
          'Specify the response shapes for both, and the two levels of detail: an unauthenticated caller gets a status and nothing else; a detailed form (which check failed, why) requires authentication. Say what the default is — public status only.',
          'Specify per-check timeouts as required with an `AbortSignal`, and specify the aggregate behaviour: the endpoint must return within a bounded time even if every check hangs, and a timed-out check counts as failed.',
          'Specify caching for readiness, because a probe every second that opens a database connection each time is its own load problem. Say the cache window and that a failure is not cached as long as a success.',
          'Specify the span hierarchy: a server span per request, child spans for routing, validation, the handler, each interceptor, and each query. Name every span and every attribute against the current OpenTelemetry semantic conventions for HTTP and database clients, and cite the convention version — this is the part that ages.',
          'Specify which attributes come from compile time (`db.system`, `db.operation`, `db.sql.table`, the statement) and which from runtime (durations, row counts, errors), and state that the compile-time set is attached to the compiled query.',
          'Specify statement recording policy: whether the full SQL is an attribute by default (it can contain nothing sensitive since parameters are bound separately — which is a real advantage worth stating), and that parameter values are never recorded.',
          'Specify propagation: W3C `traceparent`/`tracestate` extraction from an incoming request, injection into outgoing calls, and how context crosses into message transports. Specify what happens with a malformed `traceparent` — ignore and start a new trace, never fail the request.',
          'Specify metrics: which ones, with names following the conventions, and that they are emitted only when a meter is configured.',
          'Specify the SQL comment format (sqlcommenter: key=value pairs, URL-encoded values, sorted keys, in a trailing `/* */` comment), the closed key set, and the escaping rules — including that a value can never introduce `*/` and that the whole comment is built from an allowlist of keys with encoded values. State explicitly that no caller-supplied string reaches the comment unencoded.',
          'Specify where the comment goes (trailing, so it does not disturb prepared-statement caching more than necessary) and note the trade-off: comments in SQL text defeat statement caching on some databases, which is why this is off by default. Say that plainly.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Liveness/readiness distinction made structural, not conventional, with the mechanism named.',
          'Two detail levels specified with public-status-only as the default; required timeouts, bounded aggregate response, and readiness caching rules.',
          'Complete span hierarchy and attribute set specified against a cited semantic-convention version, split into compile-time and runtime sources.',
          'Statement and parameter recording policy stated.',
          'Propagation in both directions specified, including malformed-header behaviour.',
          'Comment format, closed key set and escaping rules frozen, with the statement-cache trade-off and the off-by-default decision stated.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] zero-cost-when-off, span shape, propagation, and comment escaping',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests: an in-memory tracer asserting the span tree and attributes, health tests including hangs and information disclosure, propagation tests, comment escaping tests, and a benchmark proving the off path is free.',
        why: 'The zero-cost claim is the one that will erode silently, so it needs a test and a benchmark rather than a comment. The escaping tests are the security ones, and they should include the case that makes the comment terminate early.',
        files: [
          '`packages/web/src/health/health.spec.ts` (new)',
          '`packages/web/src/observability/observability.spec.ts` (new)',
          '`packages/query-compiler/src/comments/comments.spec.ts` (new)',
          '`benchmarks/` — tracing on/off.',
        ],
        tests: [
          '`reports ready only when every readiness check passes`.',
          '`does not let a liveness check depend on an external service` — the structural guarantee, asserted at the type level if that is the mechanism.',
          '`returns within the bounded time when every check hangs` — the test that catches the probe that wedges.',
          '`counts a timed-out check as failed and names it in the detailed form only`.',
          '`exposes no check detail to an unauthenticated caller` — assert the public body contains no check names or messages.',
          '`caches a successful readiness result for the specified window and does not cache a failure`.',
          '`creates a server span with the conventional name and attributes`.',
          '`nests routing, validation, handler and query spans under the server span` — assert the tree, not just the count.',
          '`takes query span attributes from the compiled query rather than parsing SQL at execution`.',
          '`records the statement but never parameter values`.',
          '`extracts an incoming traceparent and continues the trace`.',
          '`ignores a malformed traceparent and starts a new trace without failing the request` — several malformed forms.',
          '`injects traceparent into an outgoing message` — the transport boundary.',
          '`allocates nothing per request or per query when no tracer is configured` — the zero-cost assertion, measured.',
          '`emits a sorted sqlcommenter comment with url-encoded values`.',
          '`cannot terminate the comment early` — feed values containing `*/`, newlines, and unicode line separators; assert the emitted SQL still parses and the comment is intact.',
          '`refuses a key that is not in the closed set`, including an inherited-property key — the #364 shape again.',
          '`emits no comment when comments are disabled` — assert byte-identical SQL to today.',
          'A benchmark comparing request and query throughput with tracing off, on with a no-op tracer, and on with a real exporter.',
        ],
        steps: [
          'Write the in-memory tracer as a test double that records the span tree, so assertions are about structure rather than about calls to a mock.',
          'Write the hang test with checks that never resolve and a real timer assertion, since this is the failure that takes a service down.',
          "Add the benchmark to the existing harness and follow the project's rules about reporting what was measured.",
        ],
        dod: [
          'Span tree, attributes and compile-time attribute sourcing asserted with an in-memory tracer.',
          'Health tests cover hangs, timeouts, caching and information disclosure.',
          'Propagation tested in both directions including malformed headers.',
          'Comment escaping tested against comment-termination and key-allowlist attacks; disabled path proven byte-identical.',
          'Zero-cost-when-off asserted and benchmarked.',
        ],
      },
      {
        key: 'health',
        title: 'Health checks with liveness and readiness kept apart',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Ship the health module: named checks, structural separation of liveness and readiness, bounded aggregation, caching, and two detail levels.',
        files: ['`packages/web/src/health/index.ts` (new)', '`packages/web/package.json` — a `./health` subpath.'],
        steps: [
          'Register checks explicitly through a module, app-owned, with no ambient registry (§2.7).',
          'Enforce the liveness/readiness separation the spec chose. If the mechanism is a distinct interface for each kind, make a liveness check that takes a driver fail to compile — that is worth more than documentation.',
          'Drive each check with an `AbortSignal` from its timeout and bound the aggregate with its own deadline, so a hanging check cannot hold the endpoint.',
          'Cache readiness successes for the specified window; never cache a failure for as long.',
          "Return the public status by default and the detailed form only to an authenticated caller, with the authentication being the app's normal guard mechanism rather than a bespoke one.",
          'Ship a database readiness check as the worked example, using a trivially cheap query, and document why it is a readiness check and not a liveness one.',
        ],
        tests: ['All health tests green, including hangs, caching and non-disclosure.'],
        dod: [
          'Separation enforced structurally; explicit registration; bounded per-check and aggregate timeouts.',
          'Readiness caching asymmetric between success and failure.',
          'Public status by default, detail behind the normal guard mechanism; a database readiness example ships.',
        ],
      },
      {
        key: 'otel',
        title: 'OpenTelemetry instrumentation and trace propagation',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Instrument the router, pipeline, chain and driver with the specified span hierarchy and attributes, propagate context in and out, and keep the no-tracer path free.',
        why: 'This is where the cost model is most at risk: instrumentation is exactly the kind of feature that adds an allocation to every hot path and is never removed. The zero-cost-when-off test and benchmark are what make the claim real.',
        files: [
          '`packages/web/src/observability/index.ts` (new)',
          '`packages/web/src/pipeline/index.ts` — server and routing spans.',
          '`packages/web/src/middleware/index.ts` — chain spans.',
          '`packages/repository/src/index.ts` — query spans at the driver boundary.',
          '`packages/query-compiler/src/index.ts` — compile-time span attributes on the compiled query.',
        ],
        steps: [
          'Attach the compile-time attribute set to the compiled query when it is compiled, so the driver has them ready. This is the design that makes query spans cheap and it is easy to get wrong by computing them at execution.',
          'Make the tracer optional at the app level and branch once, not per span site — the off path should be a single check, and it must not allocate an options object or a no-op span per call.',
          'Follow the cited semantic conventions exactly for names and attributes, and put the convention version in a comment so a future upgrade is a deliberate act.',
          'Record the statement, never parameters. Note in a comment that this is safe precisely because zmdb binds parameters rather than interpolating them, which is worth saying where someone might later "improve" it.',
          'Implement W3C extraction and injection, ignoring malformed headers, and thread context through the message transports so a trace survives a broker hop.',
          'Emit the specified metrics only when a meter is configured.',
          'Run the benchmark and publish all three numbers, including the honest cost of tracing on.',
        ],
        tests: [
          'All span-tree, attribute and propagation tests green.',
          '`allocates nothing per request or per query when no tracer is configured`.',
          'The benchmark recorded with all three configurations.',
        ],
        dod: [
          'Span hierarchy and attributes follow a cited convention version; query attributes come from compile time.',
          'Single off-path branch with no allocation; statements recorded, parameters never.',
          'Propagation works in and out, including across a transport; metrics gated on a meter.',
          'Overhead measured and published for off, no-op and real-exporter cases.',
        ],
      },
      {
        key: 'comments',
        title: 'sqlcommenter-style query tagging',
        labels: ['enhancement'],
        blockedBy: ['otel'],
        goal: 'Emit an optional trailing comment carrying trace and route context, from a closed key set with encoded values, off by default and byte-identical to today when off.',
        why: 'Small, and the piece that makes the tracing work useful: it is what joins a database slow-query log to an application trace. It goes last because it needs the trace ids the previous slice produces.',
        files: [
          '`packages/query-compiler/src/comments/index.ts` (new)',
          '`packages/query-compiler/src/index.ts` — comment emission at the end of a statement.',
          '`packages/repository/src/index.ts` — supplying the runtime context.',
        ],
        steps: [
          'Build the comment from the closed key set only, looking keys up through a map with no prototype chain (an `Object.create(null)` map or a `Map`), and refuse anything else — the same allowlist discipline as the operator surface after #364.',
          'URL-encode every value, and verify the encoded form cannot contain `*/`. Assert that in a test with adversarial values rather than reasoning about it.',
          'Sort keys so the emitted SQL is deterministic, which also keeps golden tests stable.',
          'Append the comment at the end of the statement, and keep it out of the parameter path entirely.',
          'Keep it off by default and document the statement-cache trade-off at the configuration site, so someone enabling it knows the cost. Note the interaction with `ZMDB_PREPARED` if prepared statements are in play.',
          'Verify the disabled path emits byte-identical SQL by running the existing golden suite unchanged.',
        ],
        tests: [
          'All comment tests green, including comment-termination and key-allowlist attacks.',
          '`emits no comment when comments are disabled` — existing golden suite unchanged.',
        ],
        dod: [
          'Closed key set with prototype-safe lookup; values encoded and provably unable to terminate the comment.',
          'Deterministic ordering; comment never touches parameters.',
          'Off by default with the statement-cache trade-off documented; disabled path byte-identical.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] health checks, observability, tracing, and SQL comments',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['health', 'comments'],
        goal: 'Flip all four pages to supported, with the liveness/readiness warning up front and the trace-to-slow-query-log join as the worked example.',
        files: ['`docs-site/pages.mjs`', 'the four content files'],
        steps: [
          'Open the health page with the liveness trap: a liveness probe that checks the database turns a database blip into a rolling restart. Then show the correct split.',
          'Document the two detail levels and why the public form says so little.',
          'Publish the span hierarchy and the full attribute table with the convention version, since users will build alerts on it.',
          "Publish the measured overhead for off, no-op and real-exporter configurations, following the project's benchmark honesty rules.",
          'Write the SQL comment page around the payoff: a worked example joining a slow-query log entry to a trace, with the actual commands. Then state the statement-cache cost and why it is off by default.',
          'Document propagation, including what happens to a malformed `traceparent`.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Four pages supported; liveness trap documented first; span and attribute tables published with a convention version; measured overhead and the trace-to-database-log join both shown.',
        ],
      },
    ],
  },
];
