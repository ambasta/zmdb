// zmdb docs page registry. PRODUCT_JOURNEY owns navigation order and page
// ownership; this file keeps only the live compatibility expansion plus page
// title/status metadata. Page bodies live in ./content/<slug>.md.
//
//   status:'supported' -> the API is real; the page documents it. `note` may
//                         narrow platform coverage without calling the whole API TODO.
//   status:'todo'      -> a legitimate capability we have not built yet (roadmap,
//                         NOT an anti-pattern). `note` says what is missing.
//   status:'wontfix'   -> a capability we had a frozen design for and then declined
//                         to build. The page stays, because it is where the reader
//                         finds out the answer is no and what to use instead; `note`
//                         says why. Distinct from an anti-pattern, which never had a
//                         page — and from 'todo', which is a promise.
//
// Anti-patterns are deliberately absent from NAV and enumerated, with rationale,
// in coverage/mapping.mjs + the anti-patterns page.

import { LEGACY_REDIRECTS, PRODUCT_JOURNEY } from './navigation-plan.mjs';

const LEGACY_GRAPHQL_SLUGS = Object.freeze(Object.keys(LEGACY_REDIRECTS));

function livePages(pages) {
  return pages.flatMap(slug => (slug === 'graphql' ? LEGACY_GRAPHQL_SLUGS : [slug]));
}

export function derivePageGroups(nav, pageMeta) {
  const ownership = new Map();
  const duplicates = new Set();
  const missing = new Set();

  for (const group of nav) {
    for (const slug of group.pages) {
      if (ownership.has(slug)) duplicates.add(slug);
      else ownership.set(slug, group.title);
      if (!Object.hasOwn(pageMeta, slug)) missing.add(slug);
    }
  }

  const orphaned = Object.keys(pageMeta).filter(slug => !ownership.has(slug));
  const problems = [];
  if (duplicates.size > 0) problems.push('duplicate slugs: ' + [...duplicates].toSorted().join(', '));
  if (missing.size > 0) problems.push('missing page metadata: ' + [...missing].toSorted().join(', '));
  if (orphaned.length > 0) problems.push('orphaned page metadata: ' + orphaned.toSorted().join(', '));
  if (problems.length > 0) throw new Error('docs navigation registry invalid:\n- ' + problems.join('\n- '));

  return Object.freeze(Object.fromEntries(ownership));
}

// #718 will replace the twelve retained GraphQL refusal pages with the canonical
// `graphql` page and redirects. Until then, preserve those live pages at the
// frozen GraphQL position without changing their status, content or filenames.
export const NAV = PRODUCT_JOURNEY.map(group =>
  Object.freeze({ title: group.title, pages: Object.freeze(livePages(group.pages)) }),
);

export const PAGE_META = {
  introduction: {
    title: 'Introduction',
    status: 'supported',
  },
  'why-zmdb': {
    title: 'Why zmdb',
    status: 'supported',
  },
  'quick-start': {
    title: 'Quick Start',
    status: 'supported',
  },
  installation: {
    title: 'Installation',
    status: 'supported',
  },
  'aot-setup': {
    title: 'AOT Setup (transformer)',
    status: 'supported',
  },
  'pure-typescript': {
    title: 'Pure TypeScript',
    status: 'supported',
  },
  'tutorial-blog-api': {
    title: 'Tutorial: a blog API end to end',
    status: 'supported',
  },
  architecture: {
    title: 'Architecture',
    status: 'supported',
  },
  faq: {
    title: 'FAQ',
    status: 'supported',
  },
  gotchas: {
    title: 'Gotchas',
    status: 'supported',
  },
  goodies: {
    title: 'Goodies',
    status: 'supported',
  },
  'migrate-from-drizzle': {
    title: 'From Drizzle ORM',
    status: 'supported',
  },
  'migrate-from-mikro-orm': {
    title: 'From MikroORM',
    status: 'supported',
  },
  'migrate-from-typeorm': {
    title: 'From TypeORM',
    status: 'supported',
  },
  'migrate-from-sequelize': {
    title: 'From Sequelize',
    status: 'supported',
  },
  'migrate-from-prisma': {
    title: 'From Prisma',
    status: 'supported',
  },
  'web-faq': {
    title: 'FAQ — Migrating from NestJS',
    status: 'supported',
  },
  codemod: {
    title: 'Codemod: defineSchema → a type',
    status: 'supported',
  },
  'schema-declaration': {
    title: 'Schema Declaration',
    status: 'supported',
  },
  'column-types': {
    title: 'Column Types',
    status: 'supported',
  },
  'type-derivation': {
    title: 'Type Derivation',
    status: 'supported',
  },
  'tags-reference': {
    title: 'Tag Reference',
    status: 'supported',
  },
  relations: {
    title: 'Relations',
    status: 'supported',
  },
  'composite-keys': {
    title: 'Composite Primary Keys',
    status: 'supported',
  },
  'bigint-keys': {
    title: 'bigint Primary Keys',
    status: 'supported',
  },
  'indexes-constraints': {
    title: 'Indexes & Constraints',
    status: 'supported',
  },
  'naming-strategy': {
    title: 'Naming Strategy',
    status: 'supported',
  },
  'json-properties': {
    title: 'JSON Properties',
    status: 'supported',
  },
  views: {
    title: 'Views',
    status: 'supported',
  },
  'materialized-views': {
    title: 'Materialized Views',
    status: 'supported',
  },
  'virtual-entities': {
    title: 'Virtual Entities',
    status: 'supported',
  },
  sequences: {
    title: 'Sequences',
    status: 'supported',
  },
  'generated-columns': {
    title: 'Generated Columns',
    status: 'supported',
  },
  'schemas-namespaces': {
    title: 'Schemas / Namespaces',
    status: 'supported',
  },
  rls: {
    title: 'Row-Level Security (RLS)',
    status: 'supported',
  },
  'db-extensions': {
    title: 'Database Extensions',
    status: 'supported',
  },
  'stored-routines': {
    title: 'Stored Procedures & Functions',
    status: 'supported',
  },
  'schema-first': {
    title: 'Schema-First (existing database)',
    status: 'supported',
  },
  crud: {
    title: 'CRUD',
    status: 'supported',
  },
  repository: {
    title: 'Repository',
    status: 'supported',
  },
  select: {
    title: 'Select',
    status: 'supported',
  },
  insert: {
    title: 'Insert',
    status: 'supported',
  },
  update: {
    title: 'Update',
    status: 'supported',
  },
  delete: {
    title: 'Delete',
    status: 'supported',
  },
  upsert: {
    title: 'Upsert',
    status: 'supported',
  },
  filters: {
    title: 'Filters & Operators',
    status: 'supported',
  },
  'entity-filters': {
    title: 'Entity Filters (soft delete)',
    status: 'supported',
  },
  pagination: {
    title: 'Ordering & Pagination',
    status: 'supported',
  },
  'read-dtos': {
    title: 'Read/Query DTOs — Get / List / Search',
    status: 'supported',
  },
  projections: {
    title: 'Projections (partial select)',
    status: 'supported',
  },
  joins: {
    title: 'Joins',
    status: 'supported',
  },
  'populate-results': {
    title: 'Typed Populate & Join Results',
    status: 'supported',
  },
  'loading-strategies': {
    title: 'Loading Strategies',
    status: 'supported',
  },
  dataloaders: {
    title: 'DataLoaders',
    status: 'supported',
  },
  aggregations: {
    title: 'Aggregations',
    status: 'supported',
  },
  'aggregate-results': {
    title: 'Typed Aggregate Results',
    status: 'supported',
  },
  'full-text-search': {
    title: 'Full-Text Search',
    status: 'supported',
  },
  aliases: {
    title: 'Aliases',
    status: 'supported',
  },
  'set-operations': {
    title: 'Set Operations',
    status: 'supported',
  },
  'dynamic-queries': {
    title: 'Dynamic Query Building',
    status: 'supported',
  },
  'query-utils': {
    title: 'Query Utilities',
    status: 'supported',
  },
  'raw-sql': {
    title: 'Raw SQL',
    status: 'supported',
  },
  'sql-comments': {
    title: 'SQL Comments',
    status: 'supported',
  },
  streaming: {
    title: 'Streaming Results',
    status: 'supported',
  },
  'query-cancellation': {
    title: 'Query Cancellation',
    status: 'supported',
  },
  serialization: {
    title: 'Serialization',
    status: 'supported',
  },
  'inert-rows': {
    title: 'Why Fetched Rows Are Inert',
    status: 'supported',
  },
  transactions: {
    title: 'Transactions',
    status: 'supported',
  },
  batch: {
    title: 'Batch API',
    status: 'supported',
  },
  cascading: {
    title: 'Cascading',
    status: 'supported',
  },
  'transactional-outbox': {
    title: 'Transactional Outbox',
    status: 'supported',
  },
  'read-replicas': {
    title: 'Read Replicas',
    status: 'supported',
  },
  'lifecycle-hooks': {
    title: 'Lifecycle Hooks & Events',
    status: 'supported',
  },
  migrations: {
    title: 'Migrations',
    status: 'supported',
  },
  'migrations-cli': {
    title: 'Migrations CLI',
    status: 'supported',
  },
  'migrations-custom': {
    title: 'Custom Migrations',
    status: 'supported',
  },
  'migrations-teams': {
    title: 'Migrations in a Team',
    status: 'supported',
  },
  'migrations-web-mobile': {
    title: 'Migrations on Web & Mobile',
    status: 'supported',
  },
  seeding: {
    title: 'Seeding',
    status: 'supported',
  },
  'seed-functions': {
    title: 'Seed Value Generators',
    status: 'supported',
  },
  'cli-overview': {
    title: 'CLI Overview',
    status: 'supported',
  },
  'config-file': {
    title: 'Config File',
    status: 'supported',
  },
  'cli-codegen': {
    title: 'zmdb-codegen',
    status: 'supported',
  },
  'cli-generate': {
    title: 'generate',
    status: 'supported',
  },
  'cli-migrate': {
    title: 'migrate',
    status: 'supported',
  },
  'cli-push': {
    title: 'push',
    status: 'supported',
  },
  'cli-pull': {
    title: 'pull (introspect)',
    status: 'supported',
  },
  'cli-check': {
    title: 'check',
    status: 'supported',
  },
  'cli-up': {
    title: 'up',
    status: 'supported',
  },
  'cli-export': {
    title: 'export',
    status: 'supported',
  },
  'cli-studio': {
    title: 'studio',
    status: 'supported',
  },
  'dialect-postgres': {
    title: 'PostgreSQL',
    status: 'supported',
  },
  'dialect-mysql': {
    title: 'MySQL',
    status: 'supported',
    note: 'compiler and DDL supported; no bundled driver or live-server gate, and row-returning repository create/update/upsert methods refuse',
  },
  'dialect-sqlite': {
    title: 'SQLite',
    status: 'supported',
  },
  'dialect-cockroach': {
    title: 'CockroachDB',
    status: 'supported',
  },
  'dialect-mssql': {
    title: 'SQL Server',
    status: 'supported',
  },
  'dialect-singlestore': {
    title: 'SingleStore',
    status: 'supported',
  },
  'dialect-gel': {
    title: 'Gel (EdgeDB)',
    status: 'todo',
    note: 'refused: Gel owns its schema, so zmdb would be a client rather than the source; the SQL endpoint is the supported path',
  },
  'dialect-mongodb': {
    title: 'MongoDB',
    status: 'todo',
    note: 'refused: a Serial key has no MongoDB equivalent, aggregate hands SQL to application code, and savepoint has none',
  },
  'custom-driver': {
    title: 'Writing a Driver',
    status: 'supported',
  },
  drivers: {
    title: 'Drivers',
    status: 'supported',
  },
  'connect-postgres': {
    title: 'PostgreSQL (node-postgres)',
    status: 'supported',
  },
  'connect-sqlite': {
    title: 'SQLite (node:sqlite)',
    status: 'supported',
  },
  'connect-pglite': {
    title: 'PGlite',
    status: 'supported',
  },
  'connect-neon': {
    title: 'Neon',
    status: 'supported',
  },
  'connect-supabase': {
    title: 'Supabase',
    status: 'supported',
  },
  'connect-vercel-postgres': {
    title: 'Vercel Postgres',
    status: 'supported',
  },
  'connect-xata': {
    title: 'Xata',
    status: 'supported',
  },
  'connect-nile': {
    title: 'Nile',
    status: 'supported',
  },
  'connect-prisma-postgres': {
    title: 'Prisma Postgres',
    status: 'supported',
  },
  'connect-planetscale': {
    title: 'PlanetScale',
    status: 'supported',
  },
  'connect-tidb': {
    title: 'TiDB Cloud',
    status: 'supported',
  },
  'connect-turso': {
    title: 'Turso / libSQL',
    status: 'supported',
  },
  'connect-sqlite-cloud': {
    title: 'SQLite Cloud',
    status: 'supported',
  },
  'connect-cloudflare-d1': {
    title: 'Cloudflare D1',
    status: 'supported',
  },
  'connect-cloudflare-do': {
    title: 'Cloudflare Durable Objects',
    status: 'supported',
  },
  'connect-aws-data-api': {
    title: 'AWS RDS Data API',
    status: 'supported',
  },
  'connect-bun': {
    title: 'Bun',
    status: 'supported',
  },
  'connect-http-proxy': {
    title: 'HTTP Proxy',
    status: 'supported',
  },
  'connect-react-native': {
    title: 'React Native & Expo',
    status: 'supported',
  },
  'validators-is': {
    title: 'is()',
    status: 'supported',
  },
  'validators-assert': {
    title: 'assert()',
    status: 'supported',
  },
  'validators-validate': {
    title: 'validate()',
    status: 'supported',
  },
  'validators-tags': {
    title: 'Special Tags',
    status: 'supported',
  },
  'validators-shallow': {
    title: 'Shallow Validation',
    status: 'supported',
  },
  'validators-misc': {
    title: 'equals, random & other utilities',
    status: 'supported',
  },
  'unions-refinements': {
    title: 'Unions, Refinements & Transforms',
    status: 'supported',
  },
  'json-stringify': {
    title: 'stringify()',
    status: 'supported',
  },
  'json-parse': {
    title: 'parse()',
    status: 'supported',
  },
  'json-schema': {
    title: 'JSON Schema',
    status: 'supported',
  },
  openapi: {
    title: 'OpenAPI',
    status: 'supported',
  },
  random: {
    title: 'Random Generator',
    status: 'supported',
  },
  'protobuf-message': {
    title: 'Protobuf Messages',
    status: 'supported',
  },
  'protobuf-encode': {
    title: 'protobuf encode',
    status: 'supported',
  },
  'protobuf-decode': {
    title: 'protobuf decode',
    status: 'supported',
  },
  'llm-function-calling': {
    title: 'LLM Function Calling',
    status: 'supported',
  },
  'llm-json-schema': {
    title: 'LLM Schemas',
    status: 'supported',
  },
  'llm-structured-output': {
    title: 'Structured Output',
    status: 'supported',
  },
  'llm-strategy': {
    title: 'Provider Schema Strategies',
    status: 'supported',
  },
  'llm-chat': {
    title: 'Chat & Agents',
    status: 'supported',
  },
  'llm-http': {
    title: 'HTTP Tools from Controllers',
    status: 'supported',
  },
  'llm-mcp': {
    title: 'Model Context Protocol',
    status: 'supported',
  },
  'llm-langchain': {
    title: 'LangChain',
    status: 'supported',
  },
  'llm-vercel-ai-sdk': {
    title: 'Vercel AI SDK',
    status: 'supported',
  },
  'custom-types': {
    title: 'Custom Types & Codecs',
    status: 'supported',
  },
  embeddables: {
    title: 'Embeddables',
    status: 'supported',
  },
  inheritance: {
    title: 'Inheritance Mapping',
    status: 'supported',
  },
  configuration: {
    title: 'Configuration',
    status: 'supported',
  },
  logging: {
    title: 'Logging',
    status: 'supported',
  },
  caching: {
    title: 'Query Caching',
    status: 'supported',
  },
  testing: {
    title: 'Testing',
    status: 'supported',
  },
  'jit-vs-aot': {
    title: 'AOT vs JIT',
    status: 'supported',
  },
  'perf-queries': {
    title: 'Query Performance',
    status: 'supported',
  },
  'perf-serverless': {
    title: 'Serverless Performance',
    status: 'supported',
  },
  deployment: {
    title: 'Deployment',
    status: 'supported',
  },
  'lint-rules': {
    title: 'Lint Rules',
    status: 'supported',
  },
  'interop-zod': {
    title: 'Zod',
    status: 'supported',
  },
  'interop-valibot': {
    title: 'Valibot',
    status: 'supported',
  },
  'interop-typebox': {
    title: 'TypeBox',
    status: 'supported',
  },
  'interop-arktype': {
    title: 'ArkType',
    status: 'supported',
  },
  'interop-effect-schema': {
    title: 'Effect Schema',
    status: 'supported',
  },
  'interop-trpc': {
    title: 'tRPC',
    status: 'supported',
  },
  'interop-hono': {
    title: 'Hono',
    status: 'supported',
  },
  'framework-integrations': {
    title: 'Framework Integrations',
    status: 'supported',
  },
  guides: {
    title: 'Guides',
    status: 'supported',
  },
  'guide-conditional-filters': {
    title: 'Conditional filters',
    status: 'supported',
  },
  'guide-count-rows': {
    title: 'Counting rows',
    status: 'supported',
  },
  'guide-cursor-pagination': {
    title: 'Cursor-based pagination',
    status: 'supported',
  },
  'guide-exists-subquery': {
    title: 'Parents with at least one child',
    status: 'supported',
  },
  'guide-increment-decrement': {
    title: 'Incrementing and decrementing a value',
    status: 'supported',
  },
  'guide-toggle-boolean': {
    title: 'Toggling a boolean',
    status: 'supported',
  },
  'guide-bulk-update': {
    title: 'Bulk updates',
    status: 'supported',
  },
  'guide-array-defaults': {
    title: 'Array columns and empty defaults',
    status: 'supported',
  },
  'guide-timestamp-defaults': {
    title: 'Timestamp defaults',
    status: 'supported',
  },
  'guide-case-insensitive-unique': {
    title: 'Case-insensitive unique email',
    status: 'supported',
  },
  'guide-fts-generated-columns': {
    title: 'Full-text search with a generated column',
    status: 'supported',
  },
  'guide-vector-search': {
    title: 'Vector similarity search',
    status: 'supported',
  },
  'guide-postgis': {
    title: 'Geometry and point columns',
    status: 'supported',
  },
  'guide-local-postgres': {
    title: 'A local PostgreSQL',
    status: 'supported',
  },
  'guide-local-mysql': {
    title: 'A local MySQL',
    status: 'supported',
  },
  tutorials: {
    title: 'Deployment Tutorials',
    status: 'supported',
  },
  'deploy-vercel': {
    title: 'Vercel',
    status: 'supported',
  },
  'deploy-nextjs': {
    title: 'Next.js',
    status: 'supported',
  },
  'deploy-netlify': {
    title: 'Netlify',
    status: 'supported',
  },
  'deploy-supabase-edge': {
    title: 'Supabase Edge Functions',
    status: 'supported',
  },
  'deploy-railway': {
    title: 'Railway',
    status: 'supported',
  },
  'deploy-encore': {
    title: 'Encore',
    status: 'supported',
  },
  'web-overview': {
    title: '@zmdb/web — Overview',
    status: 'supported',
  },
  'web-controllers': {
    title: 'Controllers & Routing',
    status: 'supported',
  },
  'web-context': {
    title: 'Typed Request Context',
    status: 'supported',
  },
  'web-di': {
    title: 'Dependency Injection',
    status: 'supported',
  },
  'web-modules': {
    title: 'Modules & Providers',
    status: 'supported',
  },
  'web-middleware': {
    title: 'Guards, Pipes, Interceptors & Filters',
    status: 'supported',
  },
  'web-exception-filters': {
    title: 'Exception Filters',
    status: 'supported',
  },
  'web-custom-decorators': {
    title: 'Custom Decorators',
    status: 'supported',
  },
  'web-pipeline': {
    title: 'Request Pipeline & Adapters',
    status: 'supported',
  },
  'web-app': {
    title: 'Application Bootstrap & Lifecycle',
    status: 'supported',
  },
  'web-standalone': {
    title: 'Standalone Applications',
    status: 'supported',
  },
  'web-request-lifecycle': {
    title: 'Request Lifecycle',
    status: 'supported',
  },
  'web-validation': {
    title: 'Validation & Serialization',
    status: 'supported',
  },
  'web-domain-state': {
    title: 'Domain State Machines',
    status: 'supported',
  },
  'web-data-integration': {
    title: 'Building an API with zmdb',
    status: 'supported',
  },
  'web-gateways': {
    title: 'WebSockets & SSE',
    status: 'supported',
  },
  'web-ws-adapter': {
    title: 'WebSocket Adapters',
    status: 'supported',
  },
  'web-testing': {
    title: 'Testing',
    status: 'supported',
  },
  'web-benchmarks': {
    title: 'Web Performance & Benchmarks',
    status: 'supported',
  },
  'web-dynamic-modules': {
    title: 'Dynamic Modules',
    status: 'supported',
  },
  'web-injection-scopes': {
    title: 'Injection Scopes',
    status: 'supported',
  },
  'web-async-providers': {
    title: 'Asynchronous Providers',
    status: 'supported',
  },
  'web-circular-dependency': {
    title: 'Circular Dependencies',
    status: 'supported',
  },
  'web-module-ref': {
    title: 'Module Reference',
    status: 'supported',
  },
  'web-discovery': {
    title: 'Discovery & Introspection',
    status: 'supported',
  },
  'web-lazy-modules': {
    title: 'Lazy-Loading Modules',
    status: 'supported',
  },
  'web-router-module': {
    title: 'Route Composition',
    status: 'supported',
  },
  'web-cqrs': {
    title: 'CQRS',
    status: 'supported',
  },
  'web-openapi': {
    title: 'OpenAPI Generation',
    status: 'supported',
  },
  'web-openapi-operations': {
    title: 'Operations & Responses',
    status: 'supported',
  },
  'web-openapi-decorators': {
    title: 'Schema Decorators',
    status: 'supported',
  },
  'web-openapi-security': {
    title: 'Security Schemes',
    status: 'supported',
  },
  'web-mapped-types': {
    title: 'Mapped Types',
    status: 'supported',
  },
  'web-configuration': {
    title: 'Configuration',
    status: 'supported',
  },
  'web-logging': {
    title: 'Logging',
    status: 'supported',
  },
  'web-caching': {
    title: 'Caching',
    status: 'supported',
  },
  'web-request-context': {
    title: 'Request Context',
    status: 'supported',
  },
  'web-raw-body': {
    title: 'Raw Body',
    status: 'supported',
  },
  'web-events': {
    title: 'Events',
    status: 'supported',
  },
  'web-http-client': {
    title: 'HTTP Client',
    status: 'supported',
  },
  'web-file-upload': {
    title: 'File Upload',
    status: 'supported',
  },
  'web-streaming-files': {
    title: 'Streaming Files',
    status: 'supported',
  },
  'web-compression': {
    title: 'Compression',
    status: 'supported',
  },
  'web-static-files': {
    title: 'Serving Static Files',
    status: 'supported',
  },
  'web-templates': {
    title: 'Server-Side Templates',
    status: 'wontfix',
    note: 'declined — call the template engine in the handler and return its HTML with respond()',
  },
  'web-task-scheduling': {
    title: 'Task Scheduling',
    status: 'supported',
  },
  'web-queues': {
    title: 'Queues',
    status: 'supported',
  },
  'web-versioning': {
    title: 'API Versioning',
    status: 'supported',
  },
  'web-performance': {
    title: 'Performance & Keep-Alive',
    status: 'supported',
  },
  'web-health-checks': {
    title: 'Health Checks',
    status: 'supported',
  },
  'web-observability': {
    title: 'Observability',
    status: 'supported',
  },
  'web-tracing': {
    title: 'Distributed Tracing',
    status: 'supported',
  },
  'web-devtools': {
    title: 'Devtools',
    status: 'supported',
  },
  'web-hot-reload': {
    title: 'Hot Reload',
    status: 'supported',
  },
  'web-repl': {
    title: 'REPL',
    status: 'supported',
  },
  'web-multiple-servers': {
    title: 'Multiple Servers',
    status: 'supported',
  },
  'web-hybrid-application': {
    title: 'Hybrid Applications',
    status: 'supported',
  },
  'web-serverless': {
    title: 'Serverless',
    status: 'supported',
  },
  'web-deployment': {
    title: 'Deployment',
    status: 'supported',
  },
  'web-authentication': {
    title: 'Authentication',
    status: 'supported',
  },
  'web-authorization': {
    title: 'Authorization',
    status: 'supported',
  },
  'web-cors': {
    title: 'CORS',
    status: 'supported',
  },
  'web-csrf': {
    title: 'CSRF Protection',
    status: 'supported',
  },
  'web-encryption': {
    title: 'Encryption & Hashing',
    status: 'supported',
  },
  'web-security-headers': {
    title: 'Security Headers',
    status: 'supported',
  },
  'web-rate-limiting': {
    title: 'Rate Limiting',
    status: 'supported',
  },
  'web-cookies-sessions': {
    title: 'Cookies & Sessions',
    status: 'supported',
  },
  'web-cli': {
    title: 'CLI & Scaffolding',
    status: 'supported',
  },
  'web-cli-monorepo': {
    title: 'Monorepos & Libraries',
    status: 'supported',
  },
  'web-cli-apps': {
    title: 'Building CLI Applications',
    status: 'supported',
  },
  'web-microservices': {
    title: 'Microservices',
    status: 'supported',
  },
  'web-microservices-transports': {
    title: 'Broker Transports',
    status: 'supported',
  },
  'web-microservices-grpc': {
    title: 'gRPC',
    status: 'supported',
  },
  'web-microservices-custom-transport': {
    title: 'Custom Transports',
    status: 'supported',
  },
  'web-graphql': {
    title: 'GraphQL',
    status: 'wontfix',
    note: 'out of scope — run a GraphQL server next to the application instead',
  },
  'web-graphql-resolvers': {
    title: 'Resolvers & Mutations',
    status: 'wontfix',
    note: 'out of scope — a schema library calling your services directly is the answer',
  },
  'web-graphql-subscriptions': {
    title: 'Subscriptions',
    status: 'wontfix',
    note: 'out of scope — @Gateway and SSE are what real-time runs on',
  },
  'web-graphql-scalars': {
    title: 'Scalars, Enums, Unions & Interfaces',
    status: 'wontfix',
    note: 'out of scope — the wire-type-to-SDL mapping stays as a record',
  },
  'web-graphql-mapped-types': {
    title: 'Mapped Types & Shared Models',
    status: 'wontfix',
    note: "out of scope — TypeScript's own operators already compose the types",
  },
  'web-graphql-directives': {
    title: 'Directives & Extensions',
    status: 'wontfix',
    note: 'out of scope — every directive here has a zmdb equivalent already',
  },
  'web-graphql-plugins': {
    title: 'Plugins',
    status: 'wontfix',
    note: 'out of scope — every hook a plugin would carry already has a home',
  },
  'web-graphql-complexity': {
    title: 'Complexity Limits',
    status: 'wontfix',
    note: 'out of scope — the estimator would be yours to call between parse and execute',
  },
  'web-graphql-field-middleware': {
    title: 'Field Middleware',
    status: 'wontfix',
    note: 'out of scope — a Chain binds to a route, and there are no fields to bind to',
  },
  'web-graphql-middleware': {
    title: 'Guards & Interceptors',
    status: 'wontfix',
    note: 'out of scope — the four middleware interfaces are HTTP-side and real',
  },
  'web-graphql-federation': {
    title: 'Federation',
    status: 'wontfix',
    note: 'out of scope — one deployable with real module boundaries is the cheaper answer',
  },
  'web-graphql-schema-first': {
    title: 'Schema-First',
    status: 'wontfix',
    note: 'out of scope — and SDL as the source of truth is refused on principle',
  },
  'web-faq-errors': {
    title: 'Common Errors',
    status: 'supported',
  },
  'anti-patterns': {
    title: 'Anti-patterns (deliberately excluded)',
    status: 'supported',
  },
  'package-reference': {
    title: 'Package reference',
    status: 'todo',
    note: 'catalog contract frozen; generated package rows and the verified one-product documentation journey are pending',
  },
  benchmarks: {
    title: 'Benchmarks',
    status: 'supported',
  },
};

export const PAGE_GROUPS = derivePageGroups(NAV, PAGE_META);
