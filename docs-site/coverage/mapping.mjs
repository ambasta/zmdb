// Upstream doc page -> zmdb doc page, or an explicit "we don't do that" rationale.
//
// zmdb claims to be a single replacement for Drizzle, MikroORM, Typia and NestJS.
// A claim that size is only worth anything if it is checkable, so every page in
// coverage/inventory.mjs gets an entry here and .github/scripts/verify-docs-coverage.mjs
// fails the build when one is missing or points at a slug that does not exist.
//
// Two kinds of entry:
//
//   'upstream/page': 'zmdb-slug'
//       The topic is covered. The zmdb page may be marked status:'todo' in
//       pages.mjs — that means "we intend to build this and the page says what is
//       missing", which is a different statement from "covered".
//
//   'upstream/page': ap('reason', 'see-slug')
//       We deliberately do not have this page, because the thing it documents is
//       something zmdb's design rules out. `reason` is the argument, not a label,
//       and `see` points at the page that explains what we do instead. These are
//       rendered on the anti-patterns page.
//
// Many-to-one is expected and fine: Drizzle publishes four Turso connection pages
// and sixteen deploy tutorials, and collapsing those into one page each is better
// documentation, not thinner coverage. What is NOT fine is a topic with no home.

/** Mark an upstream page as deliberately out of scope. */
const ap = (reason, see) => ({ antiPattern: reason, see });

// ---------------------------------------------------------------------------
// Drizzle ORM — orm.drizzle.team/docs
// ---------------------------------------------------------------------------
export const DRIZZLE = {
  'overview': 'introduction',
  'why-drizzle': 'why-zmdb',
  'get-started': 'quick-start',
  'faq': 'faq',
  'gotchas': 'gotchas',
  'goodies': 'goodies',
  'guides': 'guides',
  'tutorials': 'tutorials',

  // Per-dialect getting started. We keep one page per dialect because the
  // supported type set and DDL genuinely differ; per-driver forks do not.
  'get-started-postgresql': 'dialect-postgres',
  'get-started-mysql': 'dialect-mysql',
  'get-started-sqlite': 'dialect-sqlite',
  'get-started-cockroach': 'dialect-cockroach',
  'get-started-mssql': 'dialect-mssql',
  'get-started-singlestore': 'dialect-singlestore',
  'get-started-gel': 'dialect-gel',

  // Schema
  'sql-schema-declaration': 'schema-first',
  'column-types': 'column-types',
  'column-types/cockroach': 'dialect-cockroach',
  'column-types/mssql': 'dialect-mssql',
  'indexes-constraints': 'indexes-constraints',
  'sequences': 'sequences',
  'generated-columns': 'generated-columns',
  'views': 'views',
  'schemas': 'schemas-namespaces',
  'extensions': 'db-extensions',
  'rls': 'rls',
  'relations': 'relations',
  'relations-schema-declaration': 'relations',
  'custom-types': 'custom-types',
  'codecs': 'custom-types',

  // Querying
  'data-querying': 'crud',
  'select': 'select',
  'insert': 'insert',
  'update': 'update',
  'delete': 'delete',
  'operators': 'filters',
  'joins': 'joins',
  'rqb': 'populate-results',
  'aliases': 'aliases',
  'set-operations': 'set-operations',
  'transactions': 'transactions',
  'batch-api': 'batch',
  'read-replicas': 'read-replicas',
  'dynamic-query-building': 'dynamic-queries',
  'query-utils': 'query-utils',
  'sql': 'raw-sql',
  'sql-comments': 'sql-comments',
  'cache': 'caching',

  // Performance
  'perf-queries': 'perf-queries',
  'perf-serverless': 'perf-serverless',
  'jit-mappers': 'jit-vs-aot',

  // drizzle-kit CLI
  'kit-overview': 'cli-overview',
  'drizzle-config-file': 'config-file',
  'drizzle-kit-generate': 'cli-generate',
  'drizzle-kit-migrate': 'cli-migrate',
  'drizzle-kit-push': 'cli-push',
  'drizzle-kit-pull': 'cli-pull',
  'drizzle-kit-check': 'cli-check',
  'drizzle-kit-up': 'cli-up',
  'drizzle-kit-export': 'cli-export',
  'drizzle-kit-studio': 'cli-studio',
  'migrations': 'migrations',
  'kit-custom-migrations': 'migrations-custom',
  'kit-migrations-for-teams': 'migrations-teams',
  'kit-web-mobile': 'migrations-web-mobile',

  // Seeding
  'seed-overview': 'seeding',
  'seed-functions': 'seed-functions',
  'seed-versioning': 'seeding',
  'seed-limitations': 'seeding',
  'kit-seed-data': 'seeding',

  // Validator interop
  'zod': 'interop-zod',
  'valibot': 'interop-valibot',
  'typebox': 'interop-typebox',
  'arktype': 'interop-arktype',
  'effect-schema': 'interop-effect-schema',
  'graphql': 'web-graphql',
  'eslint-plugin': 'lint-rules',

  // Connections. One page per platform, not per package: Turso publishes four
  // client packages against one service, and Drizzle documents each separately.
  'connect-overview': 'drivers',
  'connect-neon': 'connect-neon',
  'connect-netlify-db': 'connect-neon',
  'connect-supabase': 'connect-supabase',
  'connect-vercel-postgres': 'connect-vercel-postgres',
  'connect-xata': 'connect-xata',
  'connect-pglite': 'connect-pglite',
  'connect-nile': 'connect-nile',
  'connect-prisma-postgres': 'connect-prisma-postgres',
  'connect-planetscale': 'connect-planetscale',
  'connect-planetscale-postgres': 'connect-planetscale',
  'connect-tidb': 'connect-tidb',
  'connect-turso': 'connect-turso',
  'connect-turso-database': 'connect-turso',
  'connect-turso-serverless': 'connect-turso',
  'connect-turso-sync': 'connect-turso',
  'connect-sqlite-cloud': 'connect-sqlite-cloud',
  'connect-cloudflare-d1': 'connect-cloudflare-d1',
  'connect-cloudflare-do': 'connect-cloudflare-do',
  'connect-aws-data-api-pg': 'connect-aws-data-api',
  'connect-aws-data-api-mysql': 'connect-aws-data-api',
  'connect-bun-sql': 'connect-bun',
  'connect-bun-sqlite': 'connect-bun',
  'connect-node-sqlite': 'connect-sqlite',
  'connect-expo-sqlite': 'connect-react-native',
  'connect-op-sqlite': 'connect-react-native',
  'connect-react-native-sqlite': 'connect-react-native',
  'connect-effect-postgres': 'connect-postgres',
  'connect-drizzle-proxy': 'connect-http-proxy',

  // Guides
  'guides/conditional-filters-in-query': 'guide-conditional-filters',
  'guides/count-rows': 'guide-count-rows',
  'guides/cursor-based-pagination': 'guide-cursor-pagination',
  'guides/limit-offset-pagination': 'pagination',
  'guides/include-or-exclude-columns': 'projections',
  'guides/incrementing-a-value': 'guide-increment-decrement',
  'guides/decrementing-a-value': 'guide-increment-decrement',
  'guides/toggling-a-boolean-field': 'guide-toggle-boolean',
  'guides/update-many-with-different-value': 'guide-bulk-update',
  'guides/upsert': 'upsert',
  'guides/empty-array-default-value': 'guide-array-defaults',
  'guides/timestamp-default-value': 'guide-timestamp-defaults',
  'guides/unique-case-insensitive-email': 'guide-case-insensitive-unique',
  'guides/select-parent-rows-with-at-least-one-related-child-row': 'guide-exists-subquery',
  'guides/postgresql-full-text-search': 'full-text-search',
  'guides/full-text-search-with-generated-columns': 'guide-fts-generated-columns',
  'guides/vector-similarity-search': 'guide-vector-search',
  'guides/point-datatype-psql': 'guide-postgis',
  'guides/postgis-geometry-point': 'guide-postgis',
  'guides/postgresql-local-setup': 'guide-local-postgres',
  'guides/mysql-local-setup': 'guide-local-mysql',
  'guides/d1-http-with-drizzle-kit': 'connect-cloudflare-d1',
  'guides/gel-ext-auth': 'dialect-gel',
  'guides/seeding-using-with-option': 'seeding',
  'guides/seeding-with-partially-exposed-schema': 'seeding',

  // Tutorials — all sixteen are "deploy this stack somewhere". Collapsed by
  // target platform, which is the only axis on which they actually differ.
  'tutorials/drizzle-with-neon': 'connect-neon',
  'tutorials/drizzle-with-supabase': 'connect-supabase',
  'tutorials/drizzle-with-turso': 'connect-turso',
  'tutorials/drizzle-with-xata': 'connect-xata',
  'tutorials/drizzle-with-nile': 'connect-nile',
  'tutorials/drizzle-nextjs-neon': 'deploy-nextjs',
  'tutorials/drizzle-with-vercel': 'deploy-vercel',
  'tutorials/drizzle-with-vercel-edge-functions': 'deploy-vercel',
  'tutorials/drizzle-with-netlify-edge-functions-neon': 'deploy-netlify',
  'tutorials/drizzle-with-netlify-edge-functions-supabase': 'deploy-netlify',
  'tutorials/drizzle-with-supabase-edge-functions': 'deploy-supabase-edge',
  'tutorials/drizzle-with-encore': 'deploy-encore',
  'tutorials/bun-railway-pg': 'deploy-railway',
  'tutorials/node-railway-pg': 'deploy-railway',
  'tutorials/railway-postgres-tailscale': 'deploy-railway',
  'tutorials/railway-studio-tailscale': 'deploy-railway',
};

// ---------------------------------------------------------------------------
// MikroORM — mikro-orm.io/docs
// ---------------------------------------------------------------------------
export const MIKRO_ORM = {
  'quick-start': 'quick-start',
  'architecture': 'architecture',
  'configuration': 'configuration',
  'deployment': 'deployment',
  'logging': 'logging',
  'caching': 'caching',

  // Guided tour
  'guide/00-introduction': 'quick-start',
  'guide/01-first-entity': 'schema-declaration',
  'guide/02-relationships': 'relations',
  'guide/03-project-setup': 'installation',
  'guide/04-advanced': 'tutorial-blog-api',
  'guide/05-type-safety': 'type-derivation',

  // Schema
  'defining-entities': 'schema-declaration',
  'define-entity': 'schema-declaration',
  'using-decorators': 'schema-declaration',
  'decorators': 'tags-reference',
  'relationships': 'relations',
  'collections': ap(
    'A `Collection` is a lazy-loading proxy: reading `book.tags` can issue a query, ' +
      'so the cost of a property access depends on hydration state that is invisible in ' +
      'the type. zmdb returns plain arrays that are already fully materialised — a ' +
      'relation you did not request is absent from the type, not silently fetched.',
    'inert-rows',
  ),
  'type-safe-relations': 'populate-results',
  'composite-keys': 'composite-keys',
  'using-bigint-pks': 'bigint-keys',
  'indexes': 'indexes-constraints',
  'custom-types': 'custom-types',
  'json-properties': 'json-properties',
  'embeddables': 'embeddables',
  'inheritance-mapping': 'inheritance',
  'naming-strategy': 'naming-strategy',
  'multiple-schemas': 'schemas-namespaces',
  'view-entities': 'views',
  'virtual-entities': 'virtual-entities',
  'materialized-views': 'materialized-views',
  'stored-routines': 'stored-routines',
  'folder-based-discovery': 'configuration',
  'schema-first-guide': 'schema-first',
  'entity-generator': 'cli-pull',
  'schema-generator': 'cli-push',
  'migrations': 'migrations',
  'seeding': 'seeding',

  // Querying
  'entity-manager': ap(
    'The `EntityManager` is the front door to the identity map and unit of work: it ' +
      'holds references to every entity you have touched and decides what to flush. ' +
      'zmdb has no session to hold, so there is no object to inject — a repository ' +
      'takes a connection and returns data.',
    'repository',
  ),
  'repositories': 'repository',
  'query-builder': 'select',
  'query-conditions': 'filters',
  'raw-queries': 'raw-sql',
  'usage-with-sql': 'raw-sql',
  'kysely': 'raw-sql',
  'populating-relations': 'populate-results',
  'loading-strategies': 'loading-strategies',
  'dataloaders': 'dataloaders',
  'filters': 'entity-filters',
  'streaming': 'streaming',
  'query-cancellation': 'query-cancellation',
  'transactions': 'transactions',
  'transactional-outbox': 'transactional-outbox',
  'read-connections': 'read-replicas',
  'events': 'lifecycle-hooks',
  'cascading': 'cascading',
  'serializing': 'serialization',
  'property-validation': 'validators-assert',
  'custom-driver': 'custom-driver',

  // The unit-of-work cluster. These four pages exist because MikroORM tracks
  // live objects; each needs its own argument, not one shared dismissal.
  'unit-of-work': ap(
    'A unit of work batches your mutations until `flush()` and infers the SQL from ' +
      'diffing tracked objects. The write that runs is therefore not visible at the ' +
      'call site, and ordering bugs surface at flush time rather than where they were ' +
      'caused. zmdb writes when you call the write method, and the statement is the one ' +
      'the compiler emitted for that call.',
    'transactions',
  ),
  'identity-map': ap(
    'An identity map guarantees reference equality across a session by caching every ' +
      'loaded entity. That cache is correctness-critical (two reads must not diverge) ' +
      'and unbounded (it grows with the session), which makes long-lived contexts leak ' +
      'and request-scoped ones require careful clearing. zmdb returns a fresh value per ' +
      'read; equality is structural.',
    'inert-rows',
  ),
  'propagation': ap(
    'Setting one side of a bidirectional relation and having the other side update ' +
      'itself requires the ORM to own both objects and watch them. It is convenient ' +
      'until the propagated write is the one you did not want. zmdb has no live objects ' +
      'to propagate between; a foreign key is a column you set.',
    'inert-rows',
  ),
  'wrap-helper': ap(
    '`wrap(entity).isInitialized()` / `.init()` / `.toJSON()` exist because entities ' +
      'are proxies whose real state is not what the type says. Needing a helper to ask ' +
      'an object whether it is really loaded is the tell. zmdb rows carry no hidden ' +
      'state, so there is nothing to unwrap.',
    'inert-rows',
  ),
  'entity-constructors': ap(
    'MikroORM documents which constructor runs during hydration and which does not, ' +
      'because entities are both your domain classes and the ORM\'s row containers. ' +
      'zmdb never constructs your classes: a read returns data shaped by the schema, ' +
      'and what you build from it is yours.',
    'inert-rows',
  ),
  'metadata-cache': ap(
    'A metadata cache exists to amortise the cost of discovering entity metadata at ' +
      'runtime — reading decorators, walking source files, resolving types. zmdb ' +
      'resolves all of that at compile time, so there is no discovery step to cache and ' +
      'no cache to invalidate when it goes stale against your source.',
    'jit-vs-aot',
  ),
  'metadata-providers': ap(
    '`ReflectMetadataProvider` and `TsMorphMetadataProvider` are two strategies for ' +
      'recovering type information that the runtime has thrown away — one guesses from ' +
      '`design:type`, the other re-parses your TypeScript at boot. zmdb reads the real ' +
      'checker types during compilation, so the information never has to be recovered.',
    'aot-setup',
  ),

  // Platform and tooling integrations
  'usage-with-nestjs': 'web-data-integration',
  'usage-with-nextjs': 'deploy-nextjs',
  'usage-with-adonis': 'framework-integrations',
  'usage-with-adminjs': 'framework-integrations',
  'usage-with-jest': 'testing',
  'usage-with-transpilers': 'aot-setup',
  'usage-with-sqlite': 'dialect-sqlite',
  'usage-with-cockroachdb': 'dialect-cockroach',
  'usage-with-pglite': 'connect-pglite',
  'usage-with-mongo': 'dialect-mongodb',
  'usage-with-js': ap(
    'MikroORM supports schemas written in plain JavaScript via `EntitySchema`, because ' +
      'its metadata comes from decorators and options objects either way. zmdb derives ' +
      'the schema, the DTOs and the validators from TypeScript types, so a .js file has ' +
      'nothing for it to read. TypeScript is the input format, not a preference.',
    'pure-typescript',
  ),
};

// ---------------------------------------------------------------------------
// Typia — typia.io/docs
// ---------------------------------------------------------------------------
export const TYPIA = {
  'setup': 'aot-setup',
  'pure': 'pure-typescript',
  'misc': 'validators-misc',
  'random': 'random',

  'validators/is': 'validators-is',
  'validators/assert': 'validators-assert',
  'validators/validate': 'validators-validate',
  'validators/tags': 'validators-tags',
  'validators/shallow': 'validators-shallow',

  'json/stringify': 'json-stringify',
  'json/parse': 'json-parse',
  'json/schema': 'json-schema',

  'protobuf/message': 'protobuf-message',
  'protobuf/encode': 'protobuf-encode',
  'protobuf/decode': 'protobuf-decode',

  'llm/application': 'llm-function-calling',
  'llm/parameters': 'llm-function-calling',
  'llm/schema': 'llm-json-schema',
  'llm/json': 'llm-json-schema',
  'llm/structuredOutput': 'llm-structured-output',
  'llm/strategy': 'llm-strategy',
  'llm/chat': 'llm-chat',
  'llm/http': 'llm-http',
  'llm/mcp': 'llm-mcp',
  'llm/langchain': 'llm-langchain',
  'llm/vercel': 'llm-vercel-ai-sdk',

  'utilization/nestjs': 'web-validation',
  'utilization/trpc': 'interop-trpc',
  'utilization/hono': 'interop-hono',
  'utilization/mcp': 'llm-mcp',
  'utilization/langchain': 'llm-langchain',
  'utilization/vercel': 'llm-vercel-ai-sdk',

  'setup/legacy': ap(
    'Typia\'s legacy mode runs a generator that writes the validators into your repo as ' +
      'source, for build pipelines that cannot host a transformer. The checked-in ' +
      'artefact then has to be regenerated whenever a type changes, and nothing fails ' +
      'if you forget — you ship a validator for last week\'s type. zmdb requires the ' +
      'transformer so that the validator cannot be out of date with the type it came from.',
    'aot-setup',
  ),
};

// ---------------------------------------------------------------------------
// NestJS — docs.nestjs.com
// ---------------------------------------------------------------------------
export const NESTJS = {
  'introduction': 'web-overview',
  'first-steps': 'web-overview',
  'controllers': 'web-controllers',
  'components': 'web-di',
  'modules': 'web-modules',
  'middlewares': 'web-middleware',
  'exception-filters': 'web-exception-filters',
  'pipes': 'web-middleware',
  'guards': 'web-middleware',
  'interceptors': 'web-middleware',
  'custom-decorators': 'web-custom-decorators',
  'application-context': 'web-standalone',
  'deployment': 'web-deployment',

  // Fundamentals
  'fundamentals/dependency-injection': 'web-di',
  'fundamentals/async-components': 'web-async-providers',
  'fundamentals/dynamic-modules': 'web-dynamic-modules',
  'fundamentals/provider-scopes': 'web-injection-scopes',
  'fundamentals/circular-dependency': 'web-circular-dependency',
  'fundamentals/module-reference': 'web-module-ref',
  'fundamentals/lazy-loading-modules': 'web-lazy-modules',
  'fundamentals/execution-context': 'web-context',
  'fundamentals/lifecycle-events': 'web-app',
  'fundamentals/platform-agnosticism': 'web-pipeline',
  'fundamentals/discovery-service': 'web-discovery',
  'fundamentals/unit-testing': 'web-testing',

  // Techniques
  'techniques/configuration': 'web-configuration',
  'techniques/validation': 'web-validation',
  'techniques/serialization': 'web-validation',
  'techniques/caching': 'web-caching',
  'techniques/compression': 'web-compression',
  'techniques/cookies': 'web-cookies-sessions',
  'techniques/sessions': 'web-cookies-sessions',
  'techniques/events': 'web-events',
  'techniques/file-upload': 'web-file-upload',
  'techniques/streaming-files': 'web-streaming-files',
  'techniques/http-module': 'web-http-client',
  'techniques/logger': 'web-logging',
  'techniques/mvc': 'web-templates',
  'techniques/performance': 'web-performance',
  'techniques/queues': 'web-queues',
  'techniques/server-sent-events': 'web-gateways',
  'techniques/task-scheduling': 'web-task-scheduling',
  'techniques/versioning': 'web-versioning',
  'techniques/sql': 'web-data-integration',
  'techniques/mongo': 'dialect-mongodb',

  // Security
  'security/authentication': 'web-authentication',
  'security/authorization': 'web-authorization',
  'security/cors': 'web-cors',
  'security/csrf': 'web-csrf',
  'security/helmet': 'web-security-headers',
  'security/rate-limiting': 'web-rate-limiting',
  'security/encryption-hashing': 'web-encryption',

  // FAQ
  'faq/request-lifecycle': 'web-request-lifecycle',
  'faq/errors': 'web-faq-errors',
  'faq/global-prefix': 'web-app',
  'faq/http-adapter': 'web-pipeline',
  'faq/hybrid-application': 'web-hybrid-application',
  'faq/multiple-servers': 'web-multiple-servers',
  'faq/raw-body': 'web-raw-body',
  'faq/keep-alive-connections': 'web-performance',
  'faq/serverless': 'web-serverless',

  // OpenAPI
  'openapi/introduction': 'web-openapi',
  'openapi/types-and-parameters': 'openapi',
  'openapi/operations': 'web-openapi-operations',
  'openapi/decorators': 'web-openapi-decorators',
  'openapi/other-features': 'web-openapi-decorators',
  'openapi/security': 'web-openapi-security',
  'openapi/mapped-types': 'web-mapped-types',
  'openapi/cli-plugin': ap(
    'The Swagger CLI plugin re-parses your TypeScript during the build to recover the ' +
      'property types, optionality and comments that `@ApiProperty()` would otherwise ' +
      'make you retype by hand. It is a workaround for decorators not being able to see ' +
      'the type they are attached to. zmdb\'s transformer already has the checker types, ' +
      'so the schema comes from the type with no second parse and no annotations to drift.',
    'web-openapi',
  ),

  // GraphQL
  'graphql/quick-start': 'web-graphql',
  'graphql/resolvers-map': 'web-graphql-resolvers',
  'graphql/mutations': 'web-graphql-resolvers',
  'graphql/subscriptions': 'web-graphql-subscriptions',
  'graphql/scalars': 'web-graphql-scalars',
  'graphql/unions-and-enums': 'web-graphql-scalars',
  'graphql/interfaces': 'web-graphql-scalars',
  'graphql/mapped-types': 'web-graphql-mapped-types',
  'graphql/sharing-models': 'web-graphql-mapped-types',
  'graphql/directives': 'web-graphql-directives',
  'graphql/extensions': 'web-graphql-directives',
  'graphql/plugins': 'web-graphql-plugins',
  'graphql/complexity': 'web-graphql-complexity',
  'graphql/field-middleware': 'web-graphql-field-middleware',
  'graphql/guards-interceptors': 'web-graphql-middleware',
  'graphql/federation': 'web-graphql-federation',
  'graphql/schema-generator': 'web-graphql-schema-first',
  'graphql/cli-plugin': ap(
    'Same workaround as the Swagger plugin, in the GraphQL SDL generator: a build-time ' +
      're-parse of your source to recover types the decorators could not see. With the ' +
      'AOT transformer the SDL is derived from the checker types directly.',
    'web-graphql',
  ),

  // WebSockets
  'websockets/gateways': 'web-gateways',
  'websockets/adapter': 'web-ws-adapter',
  'websockets/exception-filters': 'web-gateways',
  'websockets/pipes': 'web-gateways',
  'websockets/guards': 'web-gateways',
  'websockets/interceptors': 'web-gateways',

  // Microservices
  'microservices/basics': 'web-microservices',
  'microservices/exception-filters': 'web-microservices',
  'microservices/pipes': 'web-microservices',
  'microservices/guards': 'web-microservices',
  'microservices/interceptors': 'web-microservices',
  'microservices/redis': 'web-microservices-transports',
  'microservices/mqtt': 'web-microservices-transports',
  'microservices/nats': 'web-microservices-transports',
  'microservices/rabbitmq': 'web-microservices-transports',
  'microservices/kafka': 'web-microservices-transports',
  'microservices/grpc': 'web-microservices-grpc',
  'microservices/custom-transport': 'web-microservices-custom-transport',
  'microservices/pre-request-hooks': 'web-microservices-custom-transport',

  // Observability
  'observability/overview': 'web-observability',
  'observability/sdk': 'web-observability',
  'observability/distributed-tracing': 'web-tracing',
  'observability/manual-instrumentation': 'web-tracing',
  'observability/mcp-server': 'llm-mcp',
  'observability/dashboard': ap(
    'A hosted dashboard is a product, not a framework capability, and documenting one ' +
      'in the framework manual ties your telemetry to a vendor. zmdb emits OpenTelemetry ' +
      'spans and metrics; point them at whatever backend you already run.',
    'web-observability',
  ),

  // Devtools
  'devtools/overview': 'web-devtools',
  'devtools/ci-cd': 'web-devtools',

  // CLI
  'cli/overview': 'web-cli',
  'cli/usages': 'web-cli',
  'cli/scripts': 'web-cli',
  'cli/workspaces': 'web-cli-monorepo',
  'cli/libraries': 'web-cli-monorepo',

  // Recipes
  'recipes/passport': 'web-authentication',
  'recipes/async-local-storage': 'web-request-context',
  'recipes/router-module': 'web-router-module',
  'recipes/serve-static': 'web-static-files',
  'recipes/terminus': 'web-health-checks',
  'recipes/sentry': 'web-observability',
  'recipes/repl': 'web-repl',
  'recipes/hot-reload': 'web-hot-reload',
  'recipes/swc': 'aot-setup',
  'recipes/suites': 'web-testing',
  'recipes/documentation': 'web-openapi',
  'recipes/cqrs': 'web-cqrs',
  'recipes/crud-generator': 'web-cli',
  'recipes/nest-commander': 'web-cli-apps',
  'recipes/necord': 'web-standalone',
  'recipes/mongodb': 'dialect-mongodb',
  'recipes/mikroorm': 'migrate-from-mikro-orm',
  'recipes/prisma': 'migrate-from-prisma',
  'recipes/sql-typeorm': 'migrate-from-typeorm',
  'recipes/sql-sequelize': 'migrate-from-sequelize',
};

export const MAPPING = {
  'drizzle': DRIZZLE,
  'mikro-orm': MIKRO_ORM,
  'typia': TYPIA,
  'nestjs': NESTJS,
};

/** Every anti-pattern entry, flattened, for rendering the anti-patterns page. */
export function antiPatterns() {
  const out = [];
  for (const [source, table] of Object.entries(MAPPING)) {
    for (const [page, target] of Object.entries(table)) {
      if (typeof target === 'object') {
        out.push({ source, page, reason: target.antiPattern, see: target.see });
      }
    }
  }
  return out;
}

/** Every zmdb slug an upstream page maps onto. */
export function mappedSlugs() {
  const out = new Set();
  for (const table of Object.values(MAPPING)) {
    for (const target of Object.values(table)) {
      if (typeof target === 'string') out.add(target);
    }
  }
  return out;
}
