// File the @zmdb/web EPICs + TDD sub-issues (core PRD + full NestJS parity),
// with epic→epic and sub-issue→sub-issue blocking. SPEC & TDD first; the
// architecture invariants (no `as` in consumer surface, no runtime reflection,
// Stage 3 decorators, zero deps) are baked into every epic's DoD.
//
// SAFE: prints the plan unless invoked with `--run`. Two passes when --run:
// create everything, then rewrite bodies/checklists with resolved numbers.
import { execFileSync } from 'node:child_process';

const REPO = 'ambasta/zmdb';
const RUN = process.argv.includes('--run');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input }).trim();

// Each epic: key, title, parity labels, motivation, dod[], blockedByEpics[] (epic keys),
// subs[] (kind spec|tests|impl|docs, title, blockedBy sub-keys, pages? for docs).
const EPICS = [
  {
    key: 'W1',
    title: '[EPIC] @zmdb/web — package scaffold + Stage-3 decorator baseline',
    blockedByEpics: [],
    motivation:
      'Establish the `@zmdb/web` package (per ARCHITECTURE.md §3 it sits above @zmdb/repository in the DAG) and the Stage-3 decorator baseline the whole framework builds on: `Symbol.metadata` availability, a tsconfig that pins `experimentalDecorators:false` + `noImplicitAny`, tsup build (ESM .js+.d.ts), and publish/umbrella wiring so it ships like the other packages and is reachable as `zmdb/web`.',
    dod: [
      'New `packages/web` workspace (name `@zmdb/web`, GPL-3.0-or-later, deps: schema-core, aot-validator, repository).',
      'tsconfig enforces strict + noImplicitAny + exactOptionalPropertyTypes + `experimentalDecorators:false` (Stage 3); a verified `Symbol.metadata` baseline (zero-dep shim only if Node 26 needs it).',
      'tsup build; wired into prepare-publish.mjs META, repoint-dist.mjs ENTRIES, publish.yml loop (after repository), and re-exported from the `zmdb` umbrella as `zmdb/web`.',
      'A trivial exported decorator + type compiles & round-trips through build to prove the baseline.',
    ],
    subs: [
      { key: 'W1s', kind: 'spec', title: 'web package layout + Stage-3/Symbol.metadata baseline', blockedBy: [] },
      { key: 'W1t', kind: 'tests', title: 'baseline decorator metadata round-trip', blockedBy: ['W1s'] },
      { key: 'W1i', kind: 'impl', title: 'scaffold @zmdb/web + build/publish/umbrella wiring', blockedBy: ['W1t'] },
      { key: 'W1d', kind: 'docs', title: 'web overview + install', pages: ['web-overview'], blockedBy: ['W1i'] },
    ],
  },
  {
    key: 'W2',
    title: '[EPIC] @zmdb/web — controllers & routing (Stage-3 metadata)',
    blockedByEpics: ['W1'],
    motivation:
      'Route decorators (`@Controller`, `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete`) using standard Stage-3 `ClassDecoratorContext`/`ClassMethodDecoratorContext`, storing route/prefix data strictly in `context.metadata` (never `reflect-metadata`). A `getRoutes(controller)` reader assembles the route table once at class-init (no per-request reflection).',
    dod: [
      '@Controller(prefix) + @Get/@Post/@Put/@Patch/@Delete(path) writing RouteDefinition[] to context.metadata; prefixes compose with method paths.',
      'getRoutes(ControllerClass) returns the resolved, ordered route table (method/path/handlerName) — computed once, cached.',
      'No `reflect-metadata`, no runtime type reflection; NO `as` on the consumer surface.',
    ],
    subs: [
      { key: 'W2s', kind: 'spec', title: 'route decorators + metadata contract', blockedBy: [] },
      { key: 'W2t', kind: 'tests', title: 'route metadata recorded + prefix composition', blockedBy: ['W2s'] },
      { key: 'W2i', kind: 'impl', title: '@Controller + HTTP-verb decorators + getRoutes', blockedBy: ['W2t'] },
      { key: 'W2d', kind: 'docs', title: 'controllers & routing', pages: ['web-controllers'], blockedBy: ['W2i'] },
    ],
  },
  {
    key: 'W3',
    title: '[EPIC] @zmdb/web — typed Ctx + path-param derivation',
    blockedByEpics: ['W1'],
    motivation:
      'Since Stage 3 has no parameter decorators, handlers take one strongly-typed `Ctx<Params, Body, Query>`. Crucially, `Params` is DERIVED from the route path via template-literal types (`/users/:id/posts/:postId` → `{ id: string; postId: string }`) so params are never hand-written — the compile-time rigor ARCHITECTURE.md §1 demands, with zero runtime cost.',
    dod: [
      '`Ctx<Params, Body, Query>` type; `PathParams<Path>` template-literal type deriving `{ [param]: string }` from a route string (nested/multiple params, trailing segments).',
      'Handler signature type helper binds a route path to its derived Params so a mismatch is a compile error.',
      'Type-level tests (`expectTypeOf`) prove derivation; NO `as` needed by consumers.',
    ],
    subs: [
      { key: 'W3s', kind: 'spec', title: 'Ctx + PathParams<Path> derivation contract', blockedBy: [] },
      { key: 'W3t', kind: 'tests', title: 'type-level PathParams derivation cases', blockedBy: ['W3s'] },
      { key: 'W3i', kind: 'impl', title: 'Ctx + PathParams template-literal types', blockedBy: ['W3t'] },
      { key: 'W3d', kind: 'docs', title: 'typed request context', pages: ['web-context'], blockedBy: ['W3i'] },
    ],
  },
  {
    key: 'W4',
    title: '[EPIC] @zmdb/web — compile-time dependency injection',
    blockedByEpics: ['W1'],
    motivation:
      'DI without `emitDecoratorMetadata`/reflection: a `Container` with explicit class tokens and a Stage-3 field decorator `@Inject(Token)` whose injected field type EXACTLY matches the token instance type at compile time — no manual casting. Resolution is wired at class-init and cached, not looked up per request (ARCHITECTURE.md §1/§6).',
    dod: [
      'Container.register(token, instance) / resolve(token) with an unregistered-token error; no global mutable hot-path state beyond this explicit registry.',
      '@Inject(Token) field decorator returning an initializer that resolves the token; the field type is inferred as the token instance type with NO `as`.',
      'Type-level test: injecting a mismatched token is a compile error; runtime test: resolution + unregistered-token throw.',
    ],
    subs: [
      { key: 'W4s', kind: 'spec', title: 'Container + @Inject contract (no-as, no-reflection)', blockedBy: [] },
      { key: 'W4t', kind: 'tests', title: 'DI resolution + type-level token match', blockedBy: ['W4s'] },
      { key: 'W4i', kind: 'impl', title: 'Container + @Inject field decorator', blockedBy: ['W4t'] },
      { key: 'W4d', kind: 'docs', title: 'dependency injection', pages: ['web-di'], blockedBy: ['W4i'] },
    ],
  },
  {
    key: 'W5',
    title: '[EPIC] @zmdb/web — compile-time domain state machines',
    blockedByEpics: ['W1'],
    motivation:
      'Phantom/branded types so illegal domain state transitions fail to compile (the PRD `DraftOrder → PaidOrder` example): `pay(DraftOrder)` compiles, `pay(PaidOrder)` is a type error. Zero runtime bytes/cost. Must honour the no-`as` rule — provide a safe brand constructor (a validated smart-constructor) so users never write `as PaidOrder`.',
    dod: [
      '`Brand<K, T>` + a `defineState`/smart-constructor helper that produces branded values WITHOUT requiring consumer `as` casts (construction goes through a checked factory).',
      'A `transition` helper typing state-machine edges so only declared transitions compile.',
      'Type-level negative tests (`@ts-expect-error`) prove illegal transitions/paths do not compile; branded types erase to 0 runtime cost.',
    ],
    subs: [
      { key: 'W5s', kind: 'spec', title: 'Brand + smart-constructor + transition contract (no-as)', blockedBy: [] },
      { key: 'W5t', kind: 'tests', title: 'type-level legal/illegal transition cases', blockedBy: ['W5s'] },
      { key: 'W5i', kind: 'impl', title: 'Brand/defineState/transition', blockedBy: ['W5t'] },
      { key: 'W5d', kind: 'docs', title: 'domain state machines', pages: ['web-domain-state'], blockedBy: ['W5i'] },
    ],
  },
  {
    key: 'W6',
    title: '[EPIC] @zmdb/web — request pipeline & runtime adapters',
    blockedByEpics: ['W2', 'W3', 'W4'],
    motivation:
      'The dispatcher that ties it together: given a controller instance + an incoming request, resolve the route from the cached table, build the typed `Ctx` (params from the matched path, parsed body/query), validate the body via `@zmdb/aot-validator` `assert`, invoke the handler, and serialize the response via the AOT serializer. Thin, optional adapters for Node `http` and Hono (no hard dep). Supersedes/absorbs the existing `makeEndpoint`.',
    dod: [
      'A `Router`/dispatcher resolving method+path → handler with path-param extraction; body validated BEFORE the handler (400 on invalid, handler never called), response serialized.',
      'Optional Node `http` and Hono adapters, structurally typed (no forced dependency).',
      'No per-request reflection or allocation beyond the one Ctx + result object; NO `as` in the public API.',
    ],
    subs: [
      { key: 'W6s', kind: 'spec', title: 'dispatcher + adapter contract', blockedBy: [] },
      { key: 'W6t', kind: 'tests', title: 'route dispatch + validate-before-handler + serialize', blockedBy: ['W6s'] },
      { key: 'W6i', kind: 'impl', title: 'Router/dispatcher + node:http + Hono adapters', blockedBy: ['W6t'] },
      { key: 'W6d', kind: 'docs', title: 'request pipeline & adapters', pages: ['web-pipeline'], blockedBy: ['W6i'] },
    ],
  },
  {
    key: 'W7',
    title: '[EPIC] @zmdb/web — zmdb data-layer integration',
    blockedByEpics: ['W6'],
    motivation:
      'Wire the framework to the data layer: controllers inject `@zmdb/repository` repositories via DI, route bodies validate against schema-derived `CreateDTO`/`UpdateDTO`, and responses serialize `Entity<S>`. Ship the PRD `OrdersSchema` example end-to-end (schema → repo → controller → validated route) as a runnable E2E on node:sqlite.',
    dod: [
      'A documented pattern + helper for injecting a repository into a controller (register a defineRepository instance as a DI token).',
      'Route body validation bound to schema DTOs (CreateDTO/UpdateDTO) via the AOT validator.',
      'Runnable E2E (node:sqlite): the PRD Orders domain served end-to-end, request→validated→persisted→typed response.',
    ],
    subs: [
      { key: 'W7s', kind: 'spec', title: 'controller↔repository integration contract', blockedBy: [] },
      { key: 'W7t', kind: 'tests', title: 'Orders end-to-end E2E (node:sqlite)', blockedBy: ['W7s'] },
      { key: 'W7i', kind: 'impl', title: 'repo-injection helper + DTO-bound validation + example', blockedBy: ['W7t'] },
      {
        key: 'W7d',
        kind: 'docs',
        title: 'building an API with zmdb',
        pages: ['web-data-integration'],
        blockedBy: ['W7i'],
      },
    ],
  },
  // ---------------- Full NestJS parity follow-ups ----------------
  {
    key: 'W8',
    title: '[EPIC] @zmdb/web — modules & providers (NestJS parity)',
    blockedByEpics: ['W4'],
    motivation:
      '`@Module({ controllers, providers, imports, exports })` (Stage-3 class decorator into context.metadata) organizing controllers + providers into a composable graph over the DI Container, with provider scoping (singleton default; transient/request opt-in). Static wiring resolved at bootstrap, cached — no per-request graph walk.',
    dod: [
      '@Module decorator + a module graph that registers providers/controllers into the Container and resolves imports/exports acyclically.',
      'Provider scopes (singleton/transient/request) with explicit, documented semantics.',
      'No runtime reflection; NO `as` on the consumer surface.',
    ],
    subs: [
      { key: 'W8s', kind: 'spec', title: '@Module + provider graph + scopes contract', blockedBy: [] },
      { key: 'W8t', kind: 'tests', title: 'module graph wiring + scope resolution', blockedBy: ['W8s'] },
      { key: 'W8i', kind: 'impl', title: '@Module + provider graph + scopes', blockedBy: ['W8t'] },
      { key: 'W8d', kind: 'docs', title: 'modules & providers', pages: ['web-modules'], blockedBy: ['W8i'] },
    ],
  },
  {
    key: 'W9',
    title: '[EPIC] @zmdb/web — guards, interceptors, pipes & exception filters (NestJS parity)',
    blockedByEpics: ['W6'],
    motivation:
      'The request middleware chain: guards (authorization, `canActivate`), pipes (transform/validate a Ctx slice), interceptors (wrap handler pre/post), and exception filters (typed error→response mapping). Composed statically per route at class-init; typed so a guard/pipe output feeds the handler without `as`.',
    dod: [
      'Guard / Pipe / Interceptor / ExceptionFilter interfaces + method/class decorators to attach them, resolved into a per-route chain at init.',
      'Deterministic execution order (guards → pipes → interceptor(before) → handler → interceptor(after) → filter on throw).',
      'Typed data flow through the chain with NO `as`; no per-request reflection.',
    ],
    subs: [
      { key: 'W9s', kind: 'spec', title: 'guard/pipe/interceptor/filter contract + order', blockedBy: [] },
      { key: 'W9t', kind: 'tests', title: 'chain order + short-circuit + error mapping', blockedBy: ['W9s'] },
      { key: 'W9i', kind: 'impl', title: 'guards/pipes/interceptors/filters + wiring', blockedBy: ['W9t'] },
      {
        key: 'W9d',
        kind: 'docs',
        title: 'guards, pipes, interceptors & filters',
        pages: ['web-middleware'],
        blockedBy: ['W9i'],
      },
    ],
  },
  {
    key: 'W10',
    title: '[EPIC] @zmdb/web — application bootstrap & lifecycle (NestJS parity)',
    blockedByEpics: ['W8'],
    motivation:
      '`createApp(RootModule)` bootstrap that builds the module graph, wires DI + routes once, and exposes lifecycle hooks (`onModuleInit`/`onApplicationBootstrap`/`onShutdown`) with `using`-based (Stage 3 explicit resource management) graceful shutdown. Everything wired at boot, nothing reflected per request.',
    dod: [
      'createApp(RootModule) → an app object with a listen/handle entry point over the W6 dispatcher.',
      'Lifecycle hooks invoked in documented order; graceful shutdown via `await using`/`Symbol.asyncDispose`.',
      'Boot cost paid once; per-request path unchanged from W6.',
    ],
    subs: [
      { key: 'W10s', kind: 'spec', title: 'createApp + lifecycle + shutdown contract', blockedBy: [] },
      { key: 'W10t', kind: 'tests', title: 'bootstrap wiring + hook order + shutdown', blockedBy: ['W10s'] },
      { key: 'W10i', kind: 'impl', title: 'createApp + lifecycle hooks', blockedBy: ['W10t'] },
      {
        key: 'W10d',
        kind: 'docs',
        title: 'application bootstrap & lifecycle',
        pages: ['web-app'],
        blockedBy: ['W10i'],
      },
    ],
  },
  {
    key: 'W11',
    title: '[EPIC] @zmdb/web — validation & serialization pipes from zmdb DTOs (NestJS parity)',
    blockedByEpics: ['W9', 'W7'],
    motivation:
      'First-class pipes that auto-bind a route to schema-derived `CreateDTO`/`UpdateDTO` validation (AOT) and auto-serialize `Entity<S>` responses via the AOT serializer — the NestJS `ValidationPipe`/`ClassSerializerInterceptor` analogue, but zero-runtime-parser and type-driven. Ties W9 (pipes) to W7 (data layer).',
    dod: [
      'A validation pipe that validates the body against a schema DTO before the handler (AOT), and a serialization interceptor that emits the response via the AOT serializer.',
      'Bound by type from the schema — no duplicate validation declarations; NO `as`.',
      'E2E: an invalid body is rejected by the pipe (400), a valid one flows typed into the handler.',
    ],
    subs: [
      { key: 'W11s', kind: 'spec', title: 'DTO validation-pipe + serialization-interceptor contract', blockedBy: [] },
      { key: 'W11t', kind: 'tests', title: 'pipe rejects invalid, serializer emits Entity', blockedBy: ['W11s'] },
      { key: 'W11i', kind: 'impl', title: 'zmdb validation pipe + serialization interceptor', blockedBy: ['W11t'] },
      {
        key: 'W11d',
        kind: 'docs',
        title: 'validation & serialization',
        pages: ['web-validation'],
        blockedBy: ['W11i'],
      },
    ],
  },
  {
    key: 'W12',
    title: '[EPIC] @zmdb/web — OpenAPI generation from routes + schemas (NestJS parity)',
    blockedByEpics: ['W7'],
    motivation:
      'Generate an OpenAPI 3.1 document from the route table (W2) + the schema-derived JSON Schemas (`@zmdb/schema-core/openapi`), deterministically at build/boot — the `@nestjs/swagger` analogue with zero decorators-for-docs duplication (paths/params/bodies/responses derived from the routes and DTOs already declared).',
    dod: [
      'toOpenApi(app|modules) → an OpenAPI 3.1 document: paths from routes, params from PathParams, request bodies from CreateDTO/UpdateDTO, responses from Entity — reusing schema-core openapi.',
      'Deterministic (stable ordering), build/boot-time, no runtime reflection.',
      'A served `/openapi.json` route helper (optional).',
    ],
    subs: [
      { key: 'W12s', kind: 'spec', title: 'routes+schemas → OpenAPI 3.1 mapping', blockedBy: [] },
      {
        key: 'W12t',
        kind: 'tests',
        title: 'generated document shape (paths/params/bodies/responses)',
        blockedBy: ['W12s'],
      },
      { key: 'W12i', kind: 'impl', title: 'toOpenApi generator + optional serve route', blockedBy: ['W12t'] },
      { key: 'W12d', kind: 'docs', title: 'OpenAPI generation', pages: ['web-openapi'], blockedBy: ['W12i'] },
    ],
  },
  {
    key: 'W13',
    title: '[EPIC] @zmdb/web — WebSocket & SSE gateways (NestJS parity)',
    blockedByEpics: ['W10'],
    motivation:
      '`@Gateway`/`@Subscribe(event)` decorators for WebSocket and Server-Sent-Events handlers over the same Stage-3 metadata + DI machinery, with a typed message `Ctx`. The `@nestjs/websockets` analogue, adapter-based (no hard ws dependency).',
    dod: [
      '@Gateway + @Subscribe(event) decorators writing to context.metadata; typed message context.',
      'A structurally-typed transport adapter (ws / SSE) — no forced dependency; SSE works on node:http alone.',
      'No runtime reflection; NO `as` on the consumer surface.',
    ],
    subs: [
      { key: 'W13s', kind: 'spec', title: 'gateway/subscribe + transport-adapter contract', blockedBy: [] },
      { key: 'W13t', kind: 'tests', title: 'event dispatch + typed message ctx (SSE in-process)', blockedBy: ['W13s'] },
      { key: 'W13i', kind: 'impl', title: '@Gateway/@Subscribe + SSE adapter', blockedBy: ['W13t'] },
      { key: 'W13d', kind: 'docs', title: 'websockets & SSE', pages: ['web-gateways'], blockedBy: ['W13i'] },
    ],
  },
  {
    key: 'W14',
    title: '[EPIC] @zmdb/web — testing utilities (NestJS parity)',
    blockedByEpics: ['W10'],
    motivation:
      'A test harness (`createTestApp`) that builds an app from a module with **DI overrides** (swap a provider for a fake) and drives routes in-process without a socket — the `@nestjs/testing` analogue. Makes controllers/guards/pipes unit-testable without a live server.',
    dod: [
      'createTestApp(module, { overrides }) → in-process request driver (inject a synthetic request, get the handler result/response).',
      'Provider override API (replace a token with a stub) resolved through the same Container.',
      "Used by the framework's own E2E tests.",
    ],
    subs: [
      { key: 'W14s', kind: 'spec', title: 'test harness + override contract', blockedBy: [] },
      { key: 'W14t', kind: 'tests', title: 'in-process request + provider override', blockedBy: ['W14s'] },
      { key: 'W14i', kind: 'impl', title: 'createTestApp + overrides', blockedBy: ['W14t'] },
      { key: 'W14d', kind: 'docs', title: 'testing', pages: ['web-testing'], blockedBy: ['W14i'] },
    ],
  },
  {
    key: 'W15',
    title: '[EPIC] @zmdb/web — router benchmark & performance verification',
    blockedByEpics: ['W6'],
    motivation:
      "Prove the PRD non-functional claim: Stage-3 `context.metadata` route resolution runs within a small variance of a native router and carries none of NestJS's `Reflect.getMetadata()` per-request overhead. Add a real microbench + a route-resolution/DI benchmark to the existing dashboard, measured honestly (route table built once at init).",
    dod: [
      'A benchmark comparing zmdb/web route resolution to a bare node:http router and (indicatively) an emitDecoratorMetadata/reflect-based baseline.',
      'Results added to the benchmarks dashboard with the same honesty policy (no averaged score, caveats stated).',
      'A regression guard on the resolution being init-time (no per-request metadata lookup).',
    ],
    subs: [
      { key: 'W15s', kind: 'spec', title: 'router-perf acceptance + methodology', blockedBy: [] },
      { key: 'W15t', kind: 'tests', title: 'init-time-resolution regression guard', blockedBy: ['W15s'] },
      { key: 'W15i', kind: 'impl', title: 'router/DI microbench + dashboard integration', blockedBy: ['W15t'] },
      {
        key: 'W15d',
        kind: 'docs',
        title: 'web performance & benchmarks',
        pages: ['web-benchmarks'],
        blockedBy: ['W15i'],
      },
    ],
  },
];

const subTitle = s =>
  (
    ({
      spec: '[sub-issue] [Spec Freeze] ',
      tests: '[sub-issue] [Tests Freeze] ',
      docs: '[sub-issue] [Docs] ',
      impl: '[sub-issue] ',
    })[s.kind] + s.title
  ).slice(0, 250);
const subLabels = (s, blocked) => {
  const l = ['sub-issue'];
  if (s.kind === 'spec' || s.kind === 'tests') l.push('spec');
  if (s.kind === 'docs') l.push('documentation');
  if (blocked) l.push('blocked');
  return l;
};
const gate = k =>
  k === 'spec'
    ? '## TDD gate\n- [ ] Spec frozen BEFORE any test/impl (SPEC.md section).\n- [ ] Golden type-level + runtime examples enumerated.\n- [ ] Acceptance stated. No implementation.'
    : k === 'tests'
      ? '## TDD gate\n- [ ] Depends on the spec being frozen first.\n- [ ] FAILING tests (red), incl. type-level (`expectTypeOf`/`@ts-expect-error`).\n- [ ] No implementation.'
      : k === 'impl'
        ? '## Definition of Done\n- [ ] Spec frozen; tests red first.\n- [ ] Tests green (incl. type-level).\n- [ ] **No `as`/`any`/`!` on the consumer surface; no runtime reflection; Stage 3 decorators; ESM/Node 26/TS 7.**\n- [ ] Full suite green + typecheck clean.'
        : '## Definition of Done\n- [ ] Depends on impl green.\n- [ ] Docs page(s) written with real, verified examples; rebuilt + deployed.';

// ---- run ----
let existing = [];
if (RUN)
  existing = JSON.parse(
    gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '800', '--json', 'number,title']),
  );
const byTitle = t => existing.find(i => i.title === t);
const subNum = {}; // sub key -> issue number
const epicNum = {}; // epic key -> issue number
let planned = 0;

function create({ title, body, labels }) {
  planned++;
  if (!RUN) {
    console.log(`  [dry] [${labels.join(',')}] ${title}`);
    return 0;
  }
  const f = byTitle(title);
  if (f) {
    console.log(`  = #${f.number} ${title}`);
    return f.number;
  }
  const args = ['issue', 'create', '--repo', REPO, '--title', title, '--body-file', '-'];
  for (const l of labels) args.push('--label', l);
  const n = Number(gh(args, body).split('/').pop());
  existing.push({ number: n, title });
  console.log(`  + #${n} ${title}`);
  return n;
}
function subBody(epicKey, s, blockersText) {
  return [
    `Parent epic: ${epicNum[epicKey] ? '#' + epicNum[epicKey] : '(epic ' + epicKey + ')'} (@zmdb/web)`,
    '',
    '## Goal',
    s.kind === 'spec'
      ? `Freeze the spec for: **${s.title}** (SPEC & TDD first — no implementation).`
      : s.kind === 'tests'
        ? `Author FAILING tests for: **${s.title}** (red), incl. type-level assertions.`
        : s.kind === 'docs'
          ? `Document: **${s.title}** — page(s) ${(s.pages || []).map(p => '`' + p + '`').join(', ')}.`
          : `Implement: **${s.title}**.`,
    '',
    '> Architecture invariants (ARCHITECTURE.md): no `as`/reflection on the consumer surface; Stage 3 decorators via `context.metadata`; zero required deps; push work left of runtime.',
    '',
    blockersText || '',
    gate(s.kind),
  ].join('\n');
}
function epicBody(e, checklist) {
  const eb = e.blockedByEpics.length
    ? `\n## Blocked by epics\n${e.blockedByEpics.map(k => (epicNum[k] ? '#' + epicNum[k] : k)).join(', ')}\n`
    : '';
  return `# ${e.title}\n\n## Motivation\n${e.motivation}\n\n## Definition of Done\n${e.dod.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Process\nSPEC & TDD first: spec-freeze → tests-freeze → implementation → docs; sub-issues block each other. Follows ARCHITECTURE.md (§3 DAG: @zmdb/web sits above @zmdb/repository; §2 no-\`as\`/no-reflection; §4 Stage-3 baseline).\n${eb}\n## Sub-issues\n${checklist || '_(populated below)_'}`;
}

console.log(RUN ? '=== FILING @zmdb/web EPICS (live) ===' : '=== DRY RUN (pass --run) ===');
// Pass 1: create epics + subs.
for (const e of EPICS) {
  console.log(`\nEPIC ${e.key}: ${e.title}`);
  const epicBlocked = e.blockedByEpics.length > 0;
  epicNum[e.key] = create({
    title: e.title,
    body: epicBody(e, null),
    labels: ['epic', 'parity:nestjs', ...(epicBlocked ? ['blocked'] : [])],
  });
  for (const s of e.subs) {
    const blocked = (s.blockedBy && s.blockedBy.length > 0) || epicBlocked; // blocked if intra-dep OR its epic is blocked
    subNum[s.key] = create({ title: subTitle(s), body: subBody(e.key, s, ''), labels: subLabels(s, blocked) });
  }
}
// Pass 2: rewrite bodies + checklists with resolved numbers.
if (RUN) {
  const blocks = {}; // sub key -> keys it blocks (intra-epic)
  for (const e of EPICS) for (const s of e.subs) for (const b of s.blockedBy || []) (blocks[b] ||= []).push(s.key);
  for (const e of EPICS) {
    for (const s of e.subs) {
      const bb = (s.blockedBy || []).map(k => `#${subNum[k]}`);
      // first sub of a blocked epic also lists the blocking epics' final-impl deps implicitly via the epic; keep sub-level intra deps here
      const bl = (blocks[s.key] || []).map(k => `#${subNum[k]}`);
      const txt =
        (bb.length ? `## Blocked by\n${bb.join(', ')}\n\n` : '') + (bl.length ? `## Blocks\n${bl.join(', ')}\n\n` : '');
      gh(['issue', 'edit', String(subNum[s.key]), '--repo', REPO, '--body-file', '-'], subBody(e.key, s, txt));
    }
    const checklist = e.subs
      .map(
        s =>
          `- [ ] #${subNum[s.key]}${(s.blockedBy || []).length ? ` (blocked by ${s.blockedBy.map(k => '#' + subNum[k]).join(', ')})` : ''}`,
      )
      .join('\n');
    gh(['issue', 'edit', String(epicNum[e.key]), '--repo', REPO, '--body-file', '-'], epicBody(e, checklist));
    console.log(`  ~ wired epic #${epicNum[e.key]} (${e.key})`);
  }
}
console.log(`\n${RUN ? 'DONE' : 'DRY TALLY'}: ${EPICS.length} epics, ${planned} issues total.`);
