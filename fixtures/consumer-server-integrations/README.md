# Optional server package consumers

Each child directory is one external consumer for #655 and #663. It imports one package root at runtime and typechecks that package's declarations without a workspace `paths` mapping.

`verify-installed.mjs --integrations` builds and packs the real workspace packages in the existing publish-manifest order, installs each target, its internal dependency closure and only its selected
peer into a clean npm consumer, then runs `src/runtime.mjs` and strict `tsc`. It fails if that order puts a package before one of its dependencies, if an installed manifest exposes the wrong peer, or
if an unrelated optional server package or peer appears in the consumer tree.

The ordinary local lane visibly skips NATS, RabbitMQ, Redis or PostgreSQL execution when its service URL is absent. The required CI and release lane is `yarn verify:server-integrations`; it requires
`ZMDB_NATS_URL`, `ZMDB_RABBITMQ_URL`, `ZMDB_REDIS_URL` and `ZMDB_PG`, turns PostgreSQL absence into a failure, and executes every installed public integration. gRPC runs against its local grpc-js
server, while protobuf and OpenTelemetry execute without external services.

The fixture root deliberately has no `tsconfig.json`. Each technology selection remains its own project, while the aggregate assertion verifies that every integration can be packed, installed,
imported, and typechecked without turning the ordinary monorepo typecheck into one giant application.
