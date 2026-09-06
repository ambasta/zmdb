# Product catalog — specification

Issue #618 froze the read-only metadata contract for the canonical module `scripts/product/catalog.mjs`. #622 implements that module and replaces handwritten product inventories with generated or
verified consumers.

## 1. Authority and exclusions

The catalog is the sole authority for whether a workspace package is an official part of the zmdb product and how that package appears through the product facade. Directory enumeration, publish
scripts, docs, and fixtures may validate catalog rows against the repository, but they do not infer a second membership list.

The catalog does not contain or mutate:

- package versions or dependency ranges;
- changelog entries or release notes;
- npm tags or publication credentials;
- publish order or dependency-ring policy;
- compatibility, deprecation, or partial-release decisions.

Those are owned by architecture-governance EPIC #721. #728 may read catalog membership, but derives release order from the architecture policy and reads versions from authoritative manifests.

## 2. Canonical record

Every row has exactly these product fields:

```ts
export interface ProductPackage {
  /** Stable catalog key, unique across time and independent of npm scope. */
  readonly id: string;
  /** Repository-relative package directory; it must contain package.json. */
  readonly directory: `packages/${string}`;
  /** Exact package.json name. */
  readonly npmName: string;
  /** Unique user-facing responsibility, such as schema, sql, validator, orm, web, or product. */
  readonly role: string;
  /** Exact root symbols and zmdb subpaths delegated to this package. */
  readonly facade: {
    readonly root: readonly string[];
    readonly subpaths: readonly `zmdb/${string}`[];
  };
  /** Whether one-install users always receive it or choose the technology explicitly. */
  readonly optionality: { readonly kind: 'required' } | { readonly kind: 'tooling' } | { readonly kind: 'integration'; readonly technology: string };
  /** Docs slug whose generated package section owns the role and install guidance. */
  readonly docsOwner: string;
  /** Packed external proof, or a machine-checked reason why no fixture is appropriate. */
  readonly consumer: { readonly fixture: `fixtures/${string}` } | { readonly reason: string };
}
```

`id`, `directory`, `npmName`, and `role` are unique. Root symbols and subpaths are globally unique across all `facade` records. Empty arrays are explicit: `facade: { root: [], subpaths: [] }` means an
official package has no direct facade exposure, not that its metadata was forgotten.

`optionality` describes the product journey, not npm's manifest syntax:

- `required` is part of the normal application journey. Generated installation guidance uses the one-product facade only when its current manifest actually installs that package; an independently
  landed package extraction is documented with its direct install until the facade dependency lands.
- `tooling` is product-owned but may only be reached through an explicit build/CLI/migration subpath or executable.
- `integration` is selected only when the consumer chooses that technology. Its external dependencies must remain confined to its assigned entry point.

The catalog is deeply read-only, deterministic, and import-side-effect free. It does not read the filesystem at module evaluation and exposes no mutator. Consumers that need manifest data receive the
repository root explicitly.

## 3. Measured package inventory

At the #618 baseline, six directories under `packages/` contained publishable manifests. Issues #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #691, #692, #693, #694, #657, #658,
#659, #660, #661, #695, #696, #697, #698, and #699 add `@zmdb/protobuf`, `@zmdb/client`, `@zmdb/ai`, `@zmdb/app`, `@zmdb/jobs`, the independently selected `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`,
`@zmdb/ai-vercel`, `@zmdb/mcp`, `@zmdb/otel`, `@zmdb/sqlite`, `@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`,
`@zmdb/transport-redis`, `@zmdb/jobs-postgres`, `@zmdb/solid`, `@zmdb/react-native`, `@zmdb/next`, `@zmdb/nuxt`, and `@zmdb/sveltekit`. The catalog now accounts for all thirty-one manifest-backed
packages exactly once. The separate hard-coded publication sequence remains release-governance state until #728 derives its order from architecture policy; it is not product membership:

| Directory                     | npm name                   | Frozen product role | Current facade ownership                                       |
| ----------------------------- | -------------------------- | ------------------- | -------------------------------------------------------------- |
| `packages/client`             | `@zmdb/client`             | `client`            | None; generated clients import it directly                     |
| `packages/angular`            | `@zmdb/angular`            | `angular`           | None; selected Angular generated-client lifecycle integration  |
| `packages/schema-core`        | `@zmdb/schema-core`        | `schema`            | Root schema names; `tags`, `derive`, `dto`, `relations`, `ir`  |
| `packages/query-compiler`     | `@zmdb/query-compiler`     | `sql`               | Root SQL names and the root `migrations` namespace             |
| `packages/react`              | `@zmdb/react`              | `react`             | None; selected React generated-client lifecycle integration    |
| `packages/react-native`       | `@zmdb/react-native`       | `react-native`      | None; selected native generated-client lifecycle integration   |
| `packages/vue`                | `@zmdb/vue`                | `vue`               | None; selected Vue generated-client lifecycle integration      |
| `packages/svelte`             | `@zmdb/svelte`             | `svelte`            | None; selected Svelte generated-client lifecycle integration   |
| `packages/next`               | `@zmdb/next`               | `next`              | None; selected Next.js generated-client integration            |
| `packages/nuxt`               | `@zmdb/nuxt`               | `nuxt`              | None; selected Nuxt generated-client SSR/hydration integration |
| `packages/sveltekit`          | `@zmdb/sveltekit`          | `sveltekit`         | None; selected SvelteKit generated-client load integration     |
| `packages/solid`              | `@zmdb/solid`              | `solid`             | None; selected Solid generated-client lifecycle integration    |
| `packages/ai`                 | `@zmdb/ai`                 | `ai`                | None; installed and imported independently                     |
| `packages/ai-anthropic`       | `@zmdb/ai-anthropic`       | `anthropic`         | None; selected integration with no facade export               |
| `packages/ai-langchain`       | `@zmdb/ai-langchain`       | `langchain`         | None; selected integration with no facade export               |
| `packages/ai-vercel`          | `@zmdb/ai-vercel`          | `vercel-ai`         | None; selected integration with no facade export               |
| `packages/mcp`                | `@zmdb/mcp`                | `mcp`               | None; selected protocol integration with no facade export      |
| `packages/protobuf`           | `@zmdb/protobuf`           | `protobuf`          | None; installed and imported independently                     |
| `packages/aot-validator`      | `@zmdb/aot-validator`      | `validator`         | Root validator names and `unplugin`                            |
| `packages/repository`         | `@zmdb/repository`         | `orm`               | Root ORM names and temporary PostgreSQL/SQL Server subpaths    |
| `packages/sqlite`             | `@zmdb/sqlite`             | `sqlite`            | `zmdb/drivers/sqlite` during the facade cutover                |
| `packages/app`                | `@zmdb/app`                | `app`               | None; the current `zmdb/web` aggregate is owned by web         |
| `packages/jobs`               | `@zmdb/jobs`               | `jobs`              | None until the server facade lands in #651                     |
| `packages/jobs-postgres`      | `@zmdb/jobs-postgres`      | `jobs-postgres`     | None; selected PostgreSQL job adapter with no facade export    |
| `packages/otel`               | `@zmdb/otel`               | `otel`              | None; selected OpenTelemetry integration with no facade export |
| `packages/transport-grpc`     | `@zmdb/transport-grpc`     | `grpc`              | None; selected gRPC integration with no facade export          |
| `packages/transport-nats`     | `@zmdb/transport-nats`     | `transport-nats`    | None; selected core NATS integration with no facade export     |
| `packages/transport-rabbitmq` | `@zmdb/transport-rabbitmq` | `rabbitmq`          | None; selected RabbitMQ integration with no facade export      |
| `packages/transport-redis`    | `@zmdb/transport-redis`    | `transport-redis`   | None; selected Redis Pub/Sub transport with no facade export   |
| `packages/web`                | `@zmdb/web`                | `web`               | `zmdb/web`                                                     |
| `packages/zmdb`               | `zmdb`                     | `product`           | Root composition, `config`, `cli`, and the executable          |

This table is review evidence, not the canonical machine source. The thirty-one rows in `catalog.mjs` assign `docsOwner` and `consumer`, so later package additions or renames are one catalog edit plus
the consumers that verify it. A planned package is not catalogued until its package manifest exists; roadmap names are not published facts.

## 4. Required consumers

The following surfaces consume the catalog directly:

1. **Facade ownership verifier/generator** — checks every root symbol and `zmdb/*` subpath has exactly one owner, and that `packages/zmdb` delegates rather than implements it.
2. **Package reference generator** — emits role, install mode, facade exposure, docs link, and manifest-derived package name/version into `docs-site/content/package-reference.md`.
3. **Support/integration matrix generator** — combines catalog optionality with each integration's authoritative support record; it does not hand-copy package names.
4. **Packed-consumer inventory** — discovers each package's fixture or verifies its explicit no-fixture reason.
5. **Architecture policy** — `scripts/architecture/policy.mjs` attaches exactly one zone/ring policy row to each catalog member, while `scripts/architecture/index.mjs` rejects missing or stale rows
   without recreating membership.
6. **Release governance** — #728 reads membership only. Versions, changelog, tags, graph-derived order, and publish actions remain outside the catalog.

Generated consumers compare bytes in tests and write only when their explicit generation command is run. Verification is read-only and fails on drift.

## 5. Rejection rules

`verify-product-catalog` must reject:

- a package manifest under `packages/` with no row, or a row whose directory or manifest no longer exists;
- a name mismatch between `npmName` and `package.json`;
- duplicate `id`, `npmName`, `role`, root symbol, or facade subpath ownership;
- a facade export with no catalog owner or a catalog exposure missing from the actual facade;
- an empty/missing docs owner, or a docs owner absent from the page registry;
- a package with neither a real external fixture nor a non-empty reason;
- an integration marked `required`, or an optional external dependency reachable outside its assigned integration entry point;
- version, changelog, tag, publish-order, credential, or mutation fields in a catalog row;
- a handwritten product-package table in the facade docs, package reference, support matrix, or packed-consumer inventory.

## 6. Frozen tests

#619 uses these exact test titles:

- `derives every official package role and facade exposure from one product catalog`
- `rejects a facade export whose owning package or visibility is absent from the catalog`
- `rejects a package-reference or integration row that disagrees with the catalog`
- `assigns every official package an external consumer or an explicit catalog reason`

#622 adds implementation-level tests for stale rows, duplicate roles, generated bytes, fixture discovery, and the read-only release-governance seam.
