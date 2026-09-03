// The microservice story: a transport-strategy layer, the brokers people use, gRPC, a documented
// custom-transport seam, and one process serving both HTTP and a transport. One epic, because the
// strategy layer is the whole thing and the rest are instances of it.

export const TRANSPORT_EPICS = [
  {
    key: 'transports',
    title: '[EPIC] Microservice transports — a strategy layer, brokers, gRPC, and hybrid applications',
    labels: ['enhancement', 'area:web', 'parity:nestjs'],
    pages: [
      'web-microservices',
      'web-microservices-transports',
      'web-microservices-grpc',
      'web-microservices-custom-transport',
      'web-hybrid-application',
    ],
    packages: ['@zmdb/web', '@zmdb/schema-core'],
    motivation: `
Five notes describing one missing layer: "no transport-strategy layer shipped; adapters are the seam",
"no Redis / MQTT / NATS / RabbitMQ / Kafka transport strategies", "no proto loader, no service binding,
no streaming call types", "no documented CustomTransportStrategy seam yet; the adapter boundary is where
it would go", and hybrid applications "depends on microservice transports, which are not built".

The first note has the design in it. \`@zmdb/web\` is already transport-agnostic in the right way: a
controller is a class of methods, \`Chain\` runs guards/pipes/interceptors/filters over a context, and
HTTP is an adapter over that. A message handler is the same thing with a different context and a
different way of deciding which handler to run — a pattern or subject instead of a method and path.

So this epic is mostly about two things being right. First, the message context has to be a sibling of
the HTTP context rather than a parallel universe, for the same reason the GraphQL execution context does:
a guard that checks a permission should work in both. Second, the request/response versus event
semantics have to be distinguished at the type level, because they behave completely differently under
failure — an unacknowledged event is retried, an unanswered request times out, and a handler written for
one is wrong in the other.

There is also a payload question worth settling early. Messages over a broker are external data, so
they need validation, which zmdb generates. Getting that right means a message handler has the same
guarantee an HTTP handler does, which is genuinely better than the usual state of broker consumers
casting a JSON payload and hoping. And it interacts nicely with the protobuf work: a proto-derived
message type is exactly what gRPC needs.
`,
    dod: [
      'A transport strategy interface exists, with request/response and event-based semantics distinguished at the type level.',
      'A message context is a sibling of the HTTP context, sharing enough that one guard can serve both.',
      'Message payloads are validated by AOT-emitted validators before a handler runs, with a defined behaviour for an invalid payload per transport.',
      'At least Redis, NATS and RabbitMQ strategies ship, with Kafka and MQTT either shipped or explicitly deferred with a reason.',
      'gRPC works: a proto loader, service binding, unary and all three streaming call types, with typed clients.',
      'The custom transport seam is documented and demonstrated by a strategy written entirely against public API.',
      'A hybrid application serves HTTP and at least one transport from one process, sharing the container and lifecycle.',
      'All five pages flip to supported.',
    ],
    invariants: [
      '§2.6 no over-abstraction: the strategy interface is the smallest thing that supports the shipped transports. Every method must be used by at least two strategies or justified.',
      '§2.3 validation at the boundary: a broker message is untrusted. No handler receives an unvalidated payload.',
      '§2.7 no hidden state: transport connections are owned by the app and released through the existing `AsyncDisposable`/`OnShutdown` lifecycle. No module-level connection singletons.',
      '§1 cost model: message dispatch resolves the handler through a structure built at startup, not by scanning patterns per message.',
      'Every broker client is an optional peer dependency. Installing `@zmdb/web` must not pull in five brokers.',
      'Acknowledgement semantics are explicit: a handler that succeeds acks, a handler that throws does not, and redelivery behaviour is documented per transport rather than assumed.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the strategy interface, message context, delivery semantics and gRPC binding',
        labels: ['spec'],
        goal: 'Freeze the transport strategy interface, the message context and its shared portion, request/response versus event typing, acknowledgement and retry semantics per transport, and the gRPC service binding. No code.',
        why: 'Delivery semantics are the part that cannot be added later without breaking every handler written against the earlier assumption. At-least-once versus at-most-once, who acks and when, what a thrown handler means, and whether redelivery is ordered — these differ per broker, and a strategy interface that papers over the differences produces handlers that are correct on one broker and broken on another.',
        files: [
          '`packages/web/src/microservices/SPEC.md` (new)',
          '`packages/web/src/microservices/grpc/SPEC.md` (new)',
        ],
        api: `
export interface MessageContext<T> {
  readonly kind: 'message';
  readonly pattern: string;
  readonly payload: T;                 // already validated
  readonly headers: Readonly<Record<string, string>>;
  readonly request: RequestContext;    // the shared portion, so one guard serves HTTP and messages
  ack(): Promise<void>;
  nack(opts?: { readonly requeue?: boolean }): Promise<void>;
}

export interface TransportStrategy {
  readonly name: string;
  listen(dispatch: (ctx: MessageContext<unknown>) => Promise<unknown>): Promise<void>;
  close(): Promise<void>;
  send<Req, Res>(pattern: string, payload: Req): Promise<Res>;   // request/response
  emit<Req>(pattern: string, payload: Req): Promise<void>;       // fire and forget
}

export declare function MessagePattern(pattern: string): MethodDecorator;   // request/response
export declare function EventPattern(pattern: string): MethodDecorator;     // event
export declare function GrpcMethod(service: string, method?: string): MethodDecorator;
`,
        steps: [
          'Specify the strategy interface and justify every method against at least two shipped transports. If `nack(requeue)` is meaningful for only one broker, decide whether it belongs in the interface or in a transport-specific extension.',
          'Specify the message context and factor the shared portion from the HTTP context explicitly, the same way the GraphQL execution context does. State that a guard written against the shared portion works everywhere, and that narrowing uses the discriminant, not a cast.',
          'Specify `@MessagePattern` versus `@EventPattern` and make the distinction type-level: a request/response handler returns a value that is typed and sent back, an event handler returns `void`. A handler returning a value from an event pattern should be a compile error or a documented no-op — pick one and say so.',
          'Specify acknowledgement per transport: who acks, when (before or after the handler), what a throw does, and what redelivery looks like. Include a table, because this is the reference a developer will come back to.',
          'Specify the invalid-payload behaviour per transport. This matters more than it looks: nacking an unparseable message on a broker with redelivery creates an infinite redelivery loop that will saturate a consumer. Specify a dead-letter or drop-with-log path and make it the default.',
          'Specify timeouts for request/response, with a required value rather than an infinite default, and what the caller observes on timeout.',
          'Specify correlation: how a response is matched to a request, and that a correlation id is generated rather than caller-supplied where a caller-supplied one could collide or be forged.',
          'Specify the gRPC binding: proto loading (build time, so nothing parses a `.proto` at runtime — say why), service binding to a class, the four call types (unary, client streaming, server streaming, bidirectional) and how each maps to a method signature, deadline propagation, and metadata.',
          'Specify how gRPC message types relate to the protobuf work: a proto-derived TypeScript type and its validator should come from the same place, not a second generator. Draw the boundary between this epic and the protobuf epic.',
          'Specify the hybrid application: `createApp` gains transports alongside the HTTP adapter, sharing one container and one lifecycle, with startup ordering and partial-failure behaviour defined (if the broker connection fails, does HTTP still serve? — decide).',
          'Specify the custom-transport contract: exactly which types are public, what a third-party strategy may rely on, and the stability promise.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Strategy interface minimal and justified per method against two transports.',
          'Message context shares a named portion with the HTTP context; discriminant-based narrowing, no casts.',
          'Request/response versus event distinguished at the type level with the return-value rule decided.',
          'Per-transport ack, redelivery and invalid-payload table written, with a dead-letter default that cannot loop.',
          'Required request timeouts and non-forgeable correlation specified.',
          'gRPC binding fully specified including all four call types, deadlines, metadata and build-time proto loading.',
          'Hybrid startup ordering and partial-failure behaviour decided; public custom-transport contract named.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] dispatch, delivery semantics, gRPC call types, hybrid lifecycle',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests against an in-memory strategy for all semantics, plus real-broker integration tests and real gRPC tests for all four call types.',
        why: 'An in-memory strategy makes the semantics testable deterministically — including the failure paths that are hard to trigger against a real broker. But semantics claims about a broker have to be checked against that broker, so both layers are needed and the in-memory one must not be the only coverage.',
        files: [
          '`packages/web/src/microservices/microservices.spec.ts` (new)',
          '`packages/web/src/microservices/microservices.type-test.ts` (new)',
          '`packages/web/src/microservices/grpc/grpc.spec.ts` (new)',
          '`packages/web/src/microservices/__integration__/` (new) — real brokers, gated.',
        ],
        tests: [
          '`dispatches a message to the handler registered for its pattern`.',
          '`resolves the handler through a structure built at startup` — assert no per-message pattern scan, which is the §1 assertion.',
          '`validates a payload before the handler runs` — assert the handler never ran for an invalid payload.',
          '`dead-letters an unparseable message instead of nacking it for redelivery` — the infinite-loop guard.',
          '`acks after a successful handler and does not ack when it throws`.',
          '`runs the same guard over HTTP and over a message` — one guard instance, both front-ends.',
          '`times out a request/response call and reports it distinguishably`.',
          '`rejects a response whose correlation id does not match an outstanding request`.',
          '`fails to compile an event handler that returns a value` — type-test, per the spec decision.',
          '`closes every transport connection on shutdown` — via the existing lifecycle, asserting zero open connections.',
          '`serves HTTP and a transport from one process sharing one container` — assert a singleton is the same instance in both.',
          '`behaves as specified when the broker connection fails at startup` — per the partial-failure decision.',
          '`handles a unary gRPC call`, `a server streaming call`, `a client streaming call`, and `a bidirectional call` — four tests, against real gRPC.',
          '`propagates a gRPC deadline and cancels the handler when it expires` — the deadline must actually cancel work, not just fail the response.',
          '`loads proto definitions at build time` — assert no `.proto` read at runtime.',
          '`a third-party strategy written only against public exports dispatches messages` — the custom-transport seam test, which fails if anything needed is not exported.',
          'Real-broker integration tests per shipped transport, gated and loudly skipped when the broker is absent.',
        ],
        steps: [
          'Write the in-memory strategy as a test helper that can be told to fail, delay, redeliver and drop, so every failure path in the spec has a way to be triggered.',
          "Write the custom-transport test as a genuinely separate module importing only the package's public entry points; that is the only way the seam claim is verified.",
          'Gate the integration tests the way the project gates other environment-dependent suites, and make a skip visible rather than silent.',
        ],
        dod: [
          'In-memory strategy covers every specified failure path, including dead-lettering and correlation mismatch.',
          'Startup-time handler resolution asserted; shared guard asserted across front-ends.',
          'All four gRPC call types tested against real gRPC, with deadline cancellation asserted.',
          'Custom-transport seam verified from public exports only; real-broker suites gated with visible skips.',
        ],
      },
      {
        key: 'layer',
        title: 'The transport strategy layer and message context',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the strategy interface, the message context sharing a portion with the HTTP context, pattern-to-handler resolution at startup, payload validation, and the decorators.',
        why: 'Everything else in the epic is an instance of this. Getting the shared context and the delivery semantics right here means each transport is small; getting them wrong means each transport carries its own workarounds.',
        files: [
          '`packages/web/src/microservices/index.ts` (new)',
          '`packages/web/src/context/index.ts` — the shared portion.',
          '`packages/web/src/index.ts` — `metadataOf` carries message metadata.',
          '`packages/web/package.json` — a `./microservices` subpath.',
        ],
        steps: [
          "Extract the shared context portion (do this once — if the GraphQL epic has already done it, build on that rather than extracting again) and have the message context embed it with a `kind: 'message'` discriminant.",
          'Store handler metadata through the existing `WebMetadata` mechanism, not a new registry.',
          'Build the pattern-to-handler map at startup. For transports with wildcard subjects (NATS, MQTT), build a matcher structure rather than iterating patterns per message, and note its complexity in a comment.',
          'Validate payloads with AOT-emitted validators, and route an invalid payload to the dead-letter path rather than the nack path so redelivery cannot loop.',
          "Run `Chain` for message handlers so guards, pipes, interceptors and filters apply, and map a thrown handler to the transport's failure semantics.",
          'Implement request/response with generated correlation ids, a required timeout, and rejection of unmatched responses.',
          'Wire connections into the app lifecycle so shutdown closes them; hold no connection at module scope.',
        ],
        tests: [
          'Every in-memory strategy test green, including dead-lettering, correlation and shared-guard reuse.',
          '`resolves the handler through a structure built at startup`.',
        ],
        dod: [
          'One shared context portion, embedded by both contexts, with discriminant narrowing and no casts.',
          'Startup-built dispatch (including a wildcard matcher where needed); every payload validated.',
          'Invalid payloads dead-lettered, never redelivery-looped; required timeouts and generated correlation ids.',
          'Connections owned by the app lifecycle.',
        ],
      },
      {
        key: 'brokers',
        title: 'Redis, NATS and RabbitMQ strategies (and a decision on Kafka and MQTT)',
        labels: ['enhancement'],
        blockedBy: ['layer'],
        goal: 'Ship three broker strategies with their real delivery semantics implemented and documented, and either ship or explicitly defer Kafka and MQTT with a stated reason.',
        why: 'Three transports is enough to prove the interface is not shaped around one broker, which is the actual risk. Kafka is the one most likely to reveal that the interface is wrong — consumer groups, partitions and offset commits are not "ack a message" — so deciding about it deliberately is part of the work rather than an afterthought.',
        files: [
          '`packages/web/src/microservices/strategies/redis.ts`, `nats.ts`, `rabbitmq.ts` (new)',
          '`packages/web/package.json` — optional peer dependencies.',
        ],
        steps: [
          'Implement each strategy with its own honest semantics, and fill in the per-transport ack/redelivery table from the spec with what the implementation actually does.',
          'For NATS, implement subject wildcards through the matcher rather than pattern iteration, and cover queue groups.',
          'For RabbitMQ, implement acks, nacks with and without requeue, prefetch (which is the real backpressure control — expose it) and a dead-letter exchange for the invalid-payload path.',
          'For Redis, be explicit about which primitive is used (pub/sub has no delivery guarantee; streams do) and what that means for the semantics table. If pub/sub is used, say plainly that messages are lost when no consumer is connected, because a reader will otherwise assume durability.',
          'Evaluate Kafka against the interface. If it fits, ship it; if it does not, defer it and write down exactly which part of the interface it breaks — that is more valuable than a Kafka strategy that pretends offsets are acks.',
          'Same for MQTT, where QoS levels map onto the semantics table in a way worth stating.',
          'Make every client an optional peer dependency, and verify a plain `@zmdb/web` install pulls in none of them.',
        ],
        tests: [
          'Real-broker integration suites green for each shipped transport, gated.',
          '`a plain install pulls in no broker client` — assert the dependency tree.',
          'Semantics tests per transport matching its row in the table.',
        ],
        dod: [
          'Three strategies ship with honest, documented semantics; Redis durability caveat stated explicitly.',
          'RabbitMQ prefetch and dead-lettering exposed; NATS wildcards use the matcher.',
          'Kafka and MQTT shipped or deferred with a specific written reason.',
          'No broker client in a plain install.',
        ],
      },
      {
        key: 'grpc',
        title: 'gRPC — proto loading, service binding and all four call types',
        labels: ['enhancement'],
        blockedBy: ['layer'],
        goal: 'Ship gRPC with build-time proto loading, typed service binding, unary and all three streaming forms, deadline propagation that actually cancels, and metadata.',
        files: [
          '`packages/web/src/microservices/grpc/index.ts` (new)',
          '`packages/web/src/microservices/grpc/loader.ts` (new) — build-time.',
        ],
        steps: [
          "Load protos at build time into generated TypeScript types plus validators, reusing the protobuf epic's IR work rather than a second descriptor path. If that epic has not landed, use its IR shape and note the dependency rather than forking.",
          'Bind services to classes with `@GrpcMethod`, typing each of the four call types distinctly — a server streaming method returns an async iterable, a client streaming method receives one, bidirectional does both. Make a mismatched signature a compile error.',
          'Propagate deadlines into an `AbortSignal` and thread it to the handler, so an expired deadline cancels the work rather than merely discarding the response. Anything less means a cancelled client still costs the server the full query.',
          'Expose metadata read and write, and validate anything from metadata that reaches application logic.',
          'Ship a typed client for calling other services, with the same four call types.',
          'Keep `@grpc/grpc-js` an optional peer dependency.',
        ],
        tests: [
          'All four call-type tests green against real gRPC.',
          '`propagates a gRPC deadline and cancels the handler when it expires`.',
          '`loads proto definitions at build time`.',
          'Type-tests for each mismatched call-type signature.',
        ],
        dod: [
          'Build-time proto loading through the shared IR, no runtime `.proto` parsing, no second descriptor path.',
          'Four call types distinctly typed with compile errors on mismatch.',
          'Deadlines cancel real work via `AbortSignal`; metadata validated; typed client ships.',
        ],
      },
      {
        key: 'hybrid',
        title: 'Hybrid applications and the documented custom-transport seam',
        labels: ['enhancement'],
        blockedBy: ['brokers', 'grpc'],
        goal: 'Let one app serve HTTP and any number of transports from one container and lifecycle, and make the custom-transport seam a supported public contract.',
        files: [
          '`packages/web/src/app/index.ts` — transports in `createApp`.',
          '`packages/web/src/microservices/index.ts` — the public seam exports.',
        ],
        steps: [
          'Extend `createApp` to accept transports, sharing the container so a singleton is one instance across front-ends, and sequence startup per the spec.',
          'Implement the partial-failure behaviour the spec chose, and make it observable — a process that silently serves HTTP with a dead broker consumer is an outage nobody notices.',
          'Drain in a defined order on shutdown: stop accepting new work, finish in-flight handlers with a bounded grace period, then close connections. An unbounded drain means a shutdown that never completes.',
          'Export exactly the types the custom-transport contract names, and verify with the third-party strategy test that nothing needed is missing.',
          'Check `yarn verify:exports` and `yarn verify:publish` for the new subpaths.',
        ],
        tests: [
          '`serves HTTP and a transport from one process sharing one container`.',
          '`behaves as specified when the broker connection fails at startup`.',
          '`drains in-flight handlers within the grace period and then closes connections`.',
          '`a third-party strategy written only against public exports dispatches messages`.',
        ],
        dod: [
          'One container and lifecycle across front-ends; startup ordering and partial failure implemented and observable.',
          'Bounded, ordered drain on shutdown.',
          'Custom-transport contract exported and verified from outside the package.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] microservices, transports, gRPC, custom transports, hybrid apps',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['hybrid'],
        goal: 'Flip all five pages to supported, with the per-transport semantics table as the centrepiece.',
        files: ['`docs-site/pages.mjs`', 'the five content files'],
        steps: [
          'Publish the per-transport ack/redelivery/durability table prominently. It is the single most useful artefact this epic produces, and it is what stops someone assuming Redis pub/sub is durable.',
          'Document `@MessagePattern` versus `@EventPattern` with the failure-behaviour difference, since that is why the distinction exists.',
          'Document the invalid-payload dead-letter default and how to configure it.',
          'Document gRPC with all four call types and a deadline example showing the handler being cancelled.',
          'Write the custom-transport page from the third-party strategy used in the tests, so the documented seam is the tested seam.',
          'Document hybrid startup ordering, partial-failure behaviour and the shutdown drain, including the grace period.',
          'State clearly whether Kafka and MQTT ship, and if not, why.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Five pages supported; semantics table published; custom-transport page derived from the tested strategy; Kafka/MQTT status stated plainly.',
        ],
      },
    ],
  },
];
