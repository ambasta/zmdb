// Upstream competitor documentation inventories — the denominator for the docs
// coverage gate (.github/scripts/verify-docs-coverage.mjs).
//
// Each list is the set of documentation pages the upstream project publishes,
// harvested from its docs source tree at the pinned commit below (not scraped
// from the rendered site, so it cannot drift with their CDN). Refresh with:
//
//   node .github/scripts/refresh-docs-inventory.mjs
//
// Deliberately EXCLUDED from these lists, because they are not capability docs:
//   * release notes / changelogs   (drizzle latest-releases/*, ~45 pages)
//   * "upgrading vN to vN+1"       (mikro-orm upgrading-*, drizzle upgrade-*)
//   * marketing / community pages  (enterprise, support, who-uses, sustainability)
//   * duplicated dialect variants  (drizzle re-publishes ~55 pages once per
//     dialect; we keep one entry per concept and note the dialects on the page)
//   * per-driver get-started forks (drizzle get-started/<driver>-{new,existing};
//     54 pages that differ only in the connection snippet)
//
// Everything else is in scope: if a page appears here it must map to a zmdb page
// or to an explicit anti-pattern rationale in ./mapping.mjs.

export const SOURCES = {
  "drizzle": {
    label: "Drizzle ORM",
    docsHome: "https://orm.drizzle.team/docs/",
    repo: "drizzle-team/drizzle-orm-docs",
    branch: "main",
    commit: "9c6173f2929bff0f271ddcfeccf32e1019d4f704",
    contentDir: "src/content/docs",
  },
  "nestjs": {
    label: "NestJS",
    docsHome: "https://docs.nestjs.com/",
    repo: "nestjs/docs.nestjs.com",
    branch: "master",
    commit: "e1db7bc14893088915b7855bd24a63d4a2f13400",
    contentDir: "content",
  },
  "mikro-orm": {
    label: "MikroORM",
    docsHome: "https://mikro-orm.io/docs/",
    repo: "mikro-orm/mikro-orm",
    branch: "master",
    commit: "69ed8f816e887067d1ea8de4c3d894b7751b1056",
    contentDir: "docs/docs",
  },
  "typia": {
    label: "Typia",
    docsHome: "https://typia.io/docs/",
    repo: "samchon/typia",
    branch: "master",
    commit: "00872d2952ecdb06c548c83fb4f2a376256b7d9a",
    contentDir: "website/pages/docs",
  },
};

export const INVENTORY = {
  "drizzle": [
    "aliases", "arktype", "batch-api", "cache", "codecs", "column-types", "column-types/cockroach",
    "column-types/mssql", "connect-aws-data-api-mysql", "connect-aws-data-api-pg", "connect-bun-sql",
    "connect-bun-sqlite", "connect-cloudflare-d1", "connect-cloudflare-do", "connect-drizzle-proxy",
    "connect-effect-postgres", "connect-expo-sqlite", "connect-neon", "connect-netlify-db", "connect-nile",
    "connect-node-sqlite", "connect-op-sqlite", "connect-overview", "connect-pglite", "connect-planetscale",
    "connect-planetscale-postgres", "connect-prisma-postgres", "connect-react-native-sqlite",
    "connect-sqlite-cloud", "connect-supabase", "connect-tidb", "connect-turso", "connect-turso-database",
    "connect-turso-serverless", "connect-turso-sync", "connect-vercel-postgres", "connect-xata", "custom-types",
    "data-querying", "delete", "drizzle-config-file", "drizzle-kit-check", "drizzle-kit-export",
    "drizzle-kit-generate", "drizzle-kit-migrate", "drizzle-kit-pull", "drizzle-kit-push", "drizzle-kit-studio",
    "drizzle-kit-up", "dynamic-query-building", "effect-schema", "eslint-plugin", "extensions", "faq",
    "generated-columns", "get-started", "get-started-cockroach", "get-started-gel", "get-started-mssql",
    "get-started-mysql", "get-started-postgresql", "get-started-singlestore", "get-started-sqlite", "goodies",
    "gotchas", "graphql", "guides", "guides/conditional-filters-in-query", "guides/count-rows",
    "guides/cursor-based-pagination", "guides/d1-http-with-drizzle-kit", "guides/decrementing-a-value",
    "guides/empty-array-default-value", "guides/full-text-search-with-generated-columns", "guides/gel-ext-auth",
    "guides/include-or-exclude-columns", "guides/incrementing-a-value", "guides/limit-offset-pagination",
    "guides/mysql-local-setup", "guides/point-datatype-psql", "guides/postgis-geometry-point",
    "guides/postgresql-full-text-search", "guides/postgresql-local-setup", "guides/seeding-using-with-option",
    "guides/seeding-with-partially-exposed-schema", "guides/select-parent-rows-with-at-least-one-related-child-row",
    "guides/timestamp-default-value", "guides/toggling-a-boolean-field", "guides/unique-case-insensitive-email",
    "guides/update-many-with-different-value", "guides/upsert", "guides/vector-similarity-search",
    "indexes-constraints", "insert", "jit-mappers", "joins", "kit-custom-migrations", "kit-migrations-for-teams",
    "kit-overview", "kit-seed-data", "kit-web-mobile", "migrations", "operators", "overview", "perf-queries",
    "perf-serverless", "query-utils", "read-replicas", "relations", "relations-schema-declaration", "rls", "rqb",
    "schemas", "seed-functions", "seed-limitations", "seed-overview", "seed-versioning", "select", "sequences",
    "set-operations", "sql", "sql-comments", "sql-schema-declaration", "transactions", "tutorials",
    "tutorials/bun-railway-pg", "tutorials/drizzle-nextjs-neon", "tutorials/drizzle-with-encore",
    "tutorials/drizzle-with-neon", "tutorials/drizzle-with-netlify-edge-functions-neon",
    "tutorials/drizzle-with-netlify-edge-functions-supabase", "tutorials/drizzle-with-nile",
    "tutorials/drizzle-with-supabase", "tutorials/drizzle-with-supabase-edge-functions",
    "tutorials/drizzle-with-turso", "tutorials/drizzle-with-vercel", "tutorials/drizzle-with-vercel-edge-functions",
    "tutorials/drizzle-with-xata", "tutorials/node-railway-pg", "tutorials/railway-postgres-tailscale",
    "tutorials/railway-studio-tailscale", "typebox", "update", "valibot", "views", "why-drizzle", "zod",
  ],
  "nestjs": [
    "application-context", "cli/libraries", "cli/overview", "cli/scripts", "cli/usages", "cli/workspaces",
    "components", "controllers", "custom-decorators", "deployment", "devtools/ci-cd", "devtools/overview",
    "exception-filters", "faq/errors", "faq/global-prefix", "faq/http-adapter", "faq/hybrid-application",
    "faq/keep-alive-connections", "faq/multiple-servers", "faq/raw-body", "faq/request-lifecycle", "faq/serverless",
    "first-steps", "fundamentals/async-components", "fundamentals/circular-dependency",
    "fundamentals/dependency-injection", "fundamentals/discovery-service", "fundamentals/dynamic-modules",
    "fundamentals/execution-context", "fundamentals/lazy-loading-modules", "fundamentals/lifecycle-events",
    "fundamentals/module-reference", "fundamentals/platform-agnosticism", "fundamentals/provider-scopes",
    "fundamentals/unit-testing", "graphql/cli-plugin", "graphql/complexity", "graphql/directives",
    "graphql/extensions", "graphql/federation", "graphql/field-middleware", "graphql/guards-interceptors",
    "graphql/interfaces", "graphql/mapped-types", "graphql/mutations", "graphql/plugins", "graphql/quick-start",
    "graphql/resolvers-map", "graphql/scalars", "graphql/schema-generator", "graphql/sharing-models",
    "graphql/subscriptions", "graphql/unions-and-enums", "guards", "interceptors", "introduction",
    "microservices/basics", "microservices/custom-transport", "microservices/exception-filters",
    "microservices/grpc", "microservices/guards", "microservices/interceptors", "microservices/kafka",
    "microservices/mqtt", "microservices/nats", "microservices/pipes", "microservices/pre-request-hooks",
    "microservices/rabbitmq", "microservices/redis", "middlewares", "modules", "observability/dashboard",
    "observability/distributed-tracing", "observability/manual-instrumentation", "observability/mcp-server",
    "observability/overview", "observability/sdk", "openapi/cli-plugin", "openapi/decorators",
    "openapi/introduction", "openapi/mapped-types", "openapi/operations", "openapi/other-features",
    "openapi/security", "openapi/types-and-parameters", "pipes", "recipes/async-local-storage", "recipes/cqrs",
    "recipes/crud-generator", "recipes/documentation", "recipes/hot-reload", "recipes/mikroorm", "recipes/mongodb",
    "recipes/necord", "recipes/nest-commander", "recipes/passport", "recipes/prisma", "recipes/repl",
    "recipes/router-module", "recipes/sentry", "recipes/serve-static", "recipes/sql-sequelize",
    "recipes/sql-typeorm", "recipes/suites", "recipes/swc", "recipes/terminus", "security/authentication",
    "security/authorization", "security/cors", "security/csrf", "security/encryption-hashing", "security/helmet",
    "security/rate-limiting", "techniques/caching", "techniques/compression", "techniques/configuration",
    "techniques/cookies", "techniques/events", "techniques/file-upload", "techniques/http-module",
    "techniques/logger", "techniques/mongo", "techniques/mvc", "techniques/performance", "techniques/queues",
    "techniques/serialization", "techniques/server-sent-events", "techniques/sessions", "techniques/sql",
    "techniques/streaming-files", "techniques/task-scheduling", "techniques/validation", "techniques/versioning",
    "websockets/adapter", "websockets/exception-filters", "websockets/gateways", "websockets/guards",
    "websockets/interceptors", "websockets/pipes",
  ],
  "mikro-orm": [
    "architecture", "caching", "cascading", "collections", "composite-keys", "configuration", "custom-driver",
    "custom-types", "dataloaders", "decorators", "define-entity", "defining-entities", "deployment", "embeddables",
    "entity-constructors", "entity-generator", "entity-manager", "events", "filters", "folder-based-discovery",
    "guide/00-introduction", "guide/01-first-entity", "guide/02-relationships", "guide/03-project-setup",
    "guide/04-advanced", "guide/05-type-safety", "identity-map", "indexes", "inheritance-mapping",
    "json-properties", "kysely", "loading-strategies", "logging", "materialized-views", "metadata-cache",
    "metadata-providers", "migrations", "multiple-schemas", "naming-strategy", "populating-relations",
    "propagation", "property-validation", "query-builder", "query-cancellation", "query-conditions", "quick-start",
    "raw-queries", "read-connections", "relationships", "repositories", "schema-first-guide", "schema-generator",
    "seeding", "serializing", "stored-routines", "streaming", "transactional-outbox", "transactions",
    "type-safe-relations", "unit-of-work", "usage-with-adminjs", "usage-with-adonis", "usage-with-cockroachdb",
    "usage-with-jest", "usage-with-js", "usage-with-mongo", "usage-with-nestjs", "usage-with-nextjs",
    "usage-with-pglite", "usage-with-sql", "usage-with-sqlite", "usage-with-transpilers", "using-bigint-pks",
    "using-decorators", "view-entities", "virtual-entities", "wrap-helper",
  ],
  "typia": [
    "json/parse", "json/schema", "json/stringify", "llm/application", "llm/chat", "llm/http", "llm/json",
    "llm/langchain", "llm/mcp", "llm/parameters", "llm/schema", "llm/strategy", "llm/structuredOutput",
    "llm/vercel", "misc", "protobuf/decode", "protobuf/encode", "protobuf/message", "pure", "random", "setup",
    "setup/legacy", "utilization/hono", "utilization/langchain", "utilization/mcp", "utilization/nestjs",
    "utilization/trpc", "utilization/vercel", "validators/assert", "validators/is", "validators/shallow",
    "validators/tags", "validators/validate",
  ],
};

// drizzle publishes a separate get-started page per driver; they are one concept
// for us (Installation + Drivers) and are listed here so the count is honest.
export const DRIZZLE_GET_STARTED_VARIANTS = 54;

export const TOTAL_UPSTREAM_PAGES = Object.values(INVENTORY).reduce((n, l) => n + l.length, 0);

