# 0001 — Architecture and native-graph history

**Status:** superseded

**Decision date:** 2026-09-05 and 2026-09-06, as recorded below

**Owning issues:** #722, #732–#737; foundation cutover #638; archival separation #737

## Context

Package inventories, the earlier dependency diagram and the label/body projection migration described measured starting states. Their policy and native-graph implementations now exist.

## Decision

Use the composed governance snapshot and native relationships as the current read authorities. Preserve the original measurements and completed migration instructions as history.

## Evidence

The excerpts below are copied byte-for-byte from source commit `271a731e32be377343fe279070050d7ee6bd55a2`. Their original dates, commits, issue numbers, headings and measurements remain unchanged.
Statements inside the excerpts describe their recorded state.

## Consequences

The current policy, foundation implementation and native cutover supersede the recorded inventories and preconditions. They do not require restoring old owners, labels, readers, counters or repeated
gate lists.

## Current contract

[Architecture SPEC](../../scripts/architecture/SPEC.md), [current architecture](../../ARCHITECTURE.md), and [contributor workflow](../../CONTRIBUTING.md).

**Superseded by:** the current contracts linked above and their implementing issues.

## Preserved source excerpts

### 1. scripts/architecture/SPEC.md — Opening status and implementation sequence

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `3323ea9f0e35488f06f43e6eb550d877fcb95e90a693957c03ddfa4952a87673`.

```text
> **Status:** target contract frozen by issue #722 for epic #721 and amended for the packages admitted by #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #670, #671, #691, #692,
> #693, #694, #695, #696, #657, #658, #659, #660, #661, #672, #673, #697, #698, #699, #628, #629, and the #710 AI ownership cutover. Issue #724 implements the canonical policy plus read-only discovery
> and graph APIs; #725 implements architecture-zone, ring and workspace-edge enforcement; and #727 implements package metadata and lockstep-manifest enforcement. #726 implements policy-driven runtime,
> tooling and optional-peer reachability; #728 implements the original release plan, changelog, bump and publication-governance boundary. Issue #746 supersedes only the release clauses with
> `scripts/release/SPEC.md`: architecture still owns dependency direction and reachability, while release groups, versions, ranges, and compatibility floors move to release policy. Issue #749
> implements that replacement policy and its manifest/release consumers. The original measured baseline is commit `5adba11e` on 2026-09-05. Issue #732 freezes the composed governance snapshot,
> structured-exception lifecycle, native GitHub relationship semantics and current-contract/ADR boundary in §§11–16. It changes no verifier, tracker projection or GitHub state; #733 freezes parity,
> #734 implements the composed snapshot, #735 implements owned expiring exceptions, and #736/#737 complete the native-relationship and ADR migrations. Issue #753 adds the successor jobs-selection
> graph in §17.

```

### 2. scripts/architecture/SPEC.md — §1 measured baseline

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `036e0c4319a8d83d88725fbe532cfd37917785645a826283c5075cd467f7f055`.

```text
At the measured baseline:

- exactly six directories under `packages/` contained publishable manifests;
- all six manifests carried `1.0.0-alpha.4`;
- their manifests contain 14 directed workspace dependency entries;
- the six manifests declare 11 optional peers in total;
- `@zmdb/sql` declares `oxfmt`, while `zmdb` declares `esbuild` and `oxfmt`; measured source paths reach those third-party dependencies only from the tooling entries frozen below;
- `.github/scripts/lib/publish-manifest.mjs`, `.github/scripts/prepare-publish.mjs` and `.github/workflows/publish.yml` each repeat package membership, while `.github/scripts/set-latest-tag.mjs`
  carries a stale four-package subset;
- no root `CHANGELOG.md`, `scripts/release/plan.mjs` or `scripts/release/bump.mjs` exists; and
- `tsconfig.json` sets `allowImportingTsExtensions` to `false`.

```

### 3. scripts/architecture/SPEC.md — §1 package admission history

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `76741f7e7796377eb1d0f1b281a8b9b95baa24776f101a2665b93c8c4b2ca16e`.

```text
Issues #656, #682, #705, #647, #650, #706, #707, #708, #709, #662, #669, #670, #671, #672, #691, #692, #693, #694, #695, #696, #657, #658, #659, #660, #661, #628, and #629 add `@zmdb/protobuf`,
`@zmdb/client`, `@zmdb/ai`, `@zmdb/app`, `@zmdb/jobs`, `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, `@zmdb/ai-vercel`, `@zmdb/mcp`, `@zmdb/otel`, `@zmdb/sqlite`, `@zmdb/postgres`, `@zmdb/mssql`,
`@zmdb/mysql`, `@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, `@zmdb/solid`, `@zmdb/react-native`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`, `@zmdb/transport-rabbitmq`,
`@zmdb/transport-redis`, `@zmdb/jobs-postgres`, `@zmdb/compiler`, and `@zmdb/migrations`; issue #673 adds `@zmdb/cockroach`, #674 adds `@zmdb/singlestore`, #697 adds `@zmdb/next`, #698 adds
`@zmdb/nuxt`, and #699 adds `@zmdb/sveltekit`. Issue #710 removed the temporary LangChain-to-schema-core edge. `loadArchitecture(root)` enumerates current manifests and their direct non-dev workspace
and peer declarations from the product catalog. Release-policy validation checks the required peer projection.

```

### 4. scripts/architecture/SPEC.md — §4 recorded pre-foundation policy object

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `a139a863d652c64e5773fa7dd3a0bac40d4827837a2fa303b31f64ca14beccc2`.

````text
```ts
export const PACKAGE_POLICY = {
  client: {
    directory: 'packages/client',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./testing'],
  },
  react: {
    directory: 'packages/react',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'react-native': {
    directory: 'packages/react-native',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'react'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  angular: {
    directory: 'packages/angular',
    zone: 'integration',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  vue: {
    directory: 'packages/vue',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  svelte: {
    directory: 'packages/svelte',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  next: {
    directory: 'packages/next',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'react'],
    allowedRuntimeDependencies: ['server-only'],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  nuxt: {
    directory: 'packages/nuxt',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'vue'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  solid: {
    directory: 'packages/solid',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'query-compiler': {
    directory: 'packages/query-compiler',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  migrations: {
    directory: 'packages/migrations',
    zone: 'foundation',
    ring: 1,
    allowedWorkspaceDependencies: ['query-compiler'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./declarations', './files', './testing'],
  },
  'schema-core': {
    directory: 'packages/schema-core',
    zone: 'foundation',
    ring: 1,
    allowedWorkspaceDependencies: ['query-compiler'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  ai: {
    directory: 'packages/ai',
    zone: 'runtime',
    ring: 2,
    allowedWorkspaceDependencies: ['schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: ['./compiler'],
  },
  'ai-anthropic': {
    directory: 'packages/ai-anthropic',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@anthropic-ai/sdk': ['.'],
    },
    toolingEntries: [],
  },
  'ai-langchain': {
    directory: 'packages/ai-langchain',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@langchain/core': ['.'],
    },
    toolingEntries: [],
  },
  'ai-vercel': {
    directory: 'packages/ai-vercel',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      ai: ['.'],
    },
    toolingEntries: [],
  },
  mcp: {
    directory: 'packages/mcp',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  protobuf: {
    directory: 'packages/protobuf',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'aot-validator': {
    directory: 'packages/aot-validator',
    zone: 'runtime',
    ring: 2,
    allowedWorkspaceDependencies: ['schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
    release: 'lockstep',
  },
  compiler: {
    directory: 'packages/compiler',
    zone: 'tooling',
    ring: 3,
    allowedWorkspaceDependencies: ['ai', 'aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      metro: ['./metro'],
      'metro-babel-transformer': ['./metro'],
      oxlint: ['./lint'],
    },
    toolingEntries: ['.', './config', './emit', './errors', './lint', './metro', './reflect', './testing', './transform', './unplugin'],
  },
  repository: {
    directory: 'packages/repository',
    zone: 'runtime',
    ring: 3,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  mssql: {
    directory: 'packages/mssql',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mssql: ['.'],
    },
    toolingEntries: [],
  },
  postgres: {
    directory: 'packages/postgres',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      pg: ['.'],
    },
    toolingEntries: [],
  },
  cockroach: {
    directory: 'packages/cockroach',
    zone: 'runtime',
    ring: 5,
    allowedWorkspaceDependencies: ['migrations', 'postgres', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  singlestore: {
    directory: 'packages/singlestore',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['migrations', 'mysql', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mysql2: ['.'],
    },
    toolingEntries: [],
  },
  sqlite: {
    directory: 'packages/sqlite',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  mysql: {
    directory: 'packages/mysql',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mysql2: ['.'],
    },
    toolingEntries: [],
  },
  app: {
    directory: 'packages/app',
    zone: 'application',
    ring: 4,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'repository', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  otel: {
    directory: 'packages/otel',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  jobs: {
    directory: 'packages/jobs',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-grpc': {
    directory: 'packages/transport-grpc',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app', 'protobuf'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-kafka': {
    directory: 'packages/transport-kafka',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-nats': {
    directory: 'packages/transport-nats',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-rabbitmq': {
    directory: 'packages/transport-rabbitmq',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-redis': {
    directory: 'packages/transport-redis',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'transport-sqs': {
    directory: 'packages/transport-sqs',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'jobs-postgres': {
    directory: 'packages/jobs-postgres',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['jobs', 'postgres'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  'jobs-sqlite': {
    directory: 'packages/jobs-sqlite',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['jobs', 'sqlite'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  },
  web: {
    directory: 'packages/web',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['app', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@zmdb/compiler': ['./contract/compiler'],
      typescript: ['./contract/compiler'],
    },
    toolingEntries: ['./contract/compiler', './devtools', './testing'],
  },
  zmdb: {
    directory: 'packages/zmdb',
    zone: 'facade',
    ring: 7,
    allowedWorkspaceDependencies: ['app', 'aot-validator', 'migrations', 'mssql', 'postgres', 'query-compiler', 'repository', 'schema-core', 'sqlite', 'web'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@zmdb/mssql': ['./cli', './drivers/mssql', 'bin:zmdb'],
      '@zmdb/postgres': ['./drivers/pg'],
    },
    toolingEntries: ['./cli', './compiler', './config', './migrations', './testing', './unplugin', './web/contract/compiler', 'bin:zmdb'],
  },
} as const;
```
````

### 5. scripts/architecture/SPEC.md — §14 native relationship audit and backfill measurements

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `75a6d5b0e28625562d45e3724e6b5ac93de8fffa1381b9c71c1307b51b3fbfce`.

````text
At the corrected live #732 authority audit on 2026-09-06 at 14:51 IST:

| Measurement                                                   | Result |
| ------------------------------------------------------------- | -----: |
| Open sub-issues                                               |     50 |
| Open sub-issues with a native parent                          |     49 |
| Open sub-issues with open native blockers                     |     39 |
| Direct open native blocker edges                              |     51 |
| Open sub-issues carrying `blocked`                            |     40 |
| Issue bodies containing literal `(blocked by #…)` projections |     40 |
| Open/closed split of those affected bodies                    |  20/20 |
| Open epic/non-epic split of those affected bodies             |  10/10 |
| Literal `(blocked by #…)` occurrences                         |    116 |
| Open/closed split of those occurrences                        |  50/66 |
| Checklist suffix occurrences across 30 epic bodies            |    106 |
| Open/closed split of those checklist suffix occurrences       |  40/66 |
| Occurrences across the 10 open non-epic affected bodies       |     10 |
| Issue bodies containing `blocked by` prose in any form        |    138 |
| Open/closed split of that broader prose inventory             | 21/117 |
| Pre-backfill native computation reporting as actionable       |     11 |

The exact native-blocked set was:

```text
623 624 630 631 632 633 637 638 639 640 641 642 643 652 675 676 677 719 720 733 734 735 736 737 740 741 742 743 744 747 748 749 750 751 754 755 756 757 758
```

The exact pre-backfill native computation reported:

```text
620 628 651 674 701 717 730 732 739 746 753
```

That eleven-issue set is not the accepted target actionability set. #730 was the sole incomplete native record: it had labels `sub-issue` and `blocked`, its body named parent epic #644 and blocker
#652, but live native data returned `parent = null`, `blockedBy = []` and `blocking = []`. The reviewed #736 backfill therefore adds exactly `#644 -> child #730` and `#730 blockedBy #652` before any
projection deletion. Applying that repair to the recorded 14:51 snapshot before either prerequisite closes produces the deterministic fixture result 50/50 native parents, 40 open sub-issues with open
native blockers across 52 direct open blocker edges, and these ten actionable issues:

```text
620 628 651 674 701 717 732 739 746 753
```

That 50/40/52/10 result is test evidence only, not #736's future live deletion state. The prerequisite closures produce these deterministic transitions from the same recorded graph:

| Transition                | Open sub-issues | Native parents | Native-blocked | Open blocker edges | Actionable |
| ------------------------- | --------------: | -------------: | -------------: | -----------------: | ---------: |
| After #732 closes         |              49 |             48 |             38 |                 50 |         11 |
| After #733 closes         |              48 |             47 |             35 |                 47 |         13 |
| After #730 repair in #736 |              48 |             48 |             36 |                 48 |         12 |

After #732 closes:

```text
620 628 651 674 701 717 730 733 739 746 753
```

After #733 closes:

```text
620 628 651 674 701 717 730 734 735 736 739 746 753
```

After #736 repairs #730:

```text
620 628 651 674 701 717 734 735 736 739 746 753
```

#730 remains deferred benchmark work after the backfill. The repository label `blocked` existed with description `Has unmet dependencies; cannot start until its blockers close`; #730 was both the sole
missing parent and sole extra label relative to the observed native graph. The 40 affected bodies contained 116 literal parenthesized blocker occurrences: 106 checklist suffix rows across 30 epic
bodies, split 40 open and 66 closed, plus one occurrence in each of 10 open non-epic/sub-issue bodies. The affected bodies themselves split 20 open/20 closed and, within the open half, 10 epic/10
non-epic. After #732 closed, `close-sub.mjs` removed exactly the #733 checklist suffix from #731, leaving the same 40 bodies but 115 occurrences: 105 epic checklist suffixes split 39 open/66 closed
plus the same 10 open non-epic occurrences. Closing #733 removes the #734, #735 and #736 suffixes from #731, leaving 40 affected bodies but 112 occurrences: 102 checklist suffixes split 36 open/66
closed plus the same 10 open non-epic occurrences. The `blocked` label count transitions from 40 at the 14:51 baseline to 39 after #732 and 36 after #733. The broader phrase `blocked by` appears in
138 bodies, split 21 open and 117 closed. Twenty of the 21 open bodies are the open parenthesized-projection bodies; the sole extra is #730's `**Blocked by:** #652` field. After #730's native edge is
backfilled, #736 removes that field and every open parenthesized occurrence so zero open issue bodies retain blocker prose. Closed historical narrative may remain unless it is one of the 66
parenthesized checklist suffixes explicitly slated for removal. Historical prose is never dependency data. These measurements and the reviewed backfill are migration evidence; after the two native
links are written and re-queried, only the native graph determines actionability.

````

### 6. scripts/architecture/SPEC.md — §15 completed parity, backfill and projection-removal checklist

Original source: `scripts/architecture/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `a8a87d57cdb0f47d2b788f1db6678801b368398402b4ad8f865184db89ae8da6`.

```text
## 15. #733 parity, backfill and #736 removal gates

### 15.1 Tests and measured parity required in #733

#733 records the current clean-tree output and mutation fixtures before any implementation is replaced. Its fixtures and assertions must cover every consumer/helper row in §12 and prove:

1. **Raw-finding parity:** for each focused verifier, the legacy implementation and target query produce the same multiset of stable finding ids and exact scopes. A target-only finding is allowed only
   when the test names it as a deliberate stricter rule; a legacy-only finding is never allowed.
2. **Command parity:** existing package-script names, supported CLI flags, exit classes and success/failure polarity remain unchanged through #737. Human summaries may be reformatted only when the
   stable ids and measured subjects remain present.
3. **Generated-byte parity:** the four marker-owned outputs in §12 are byte-identical before and after snapshot adoption for an unchanged authority set.
4. **Release parity:** catalog train membership, common version, changelog body and dependency-first publish order are identical.
5. **Exception backfill parity:** all 81 opaque entries at the exact implementation base map one-to-one to structured records. Findings removed by prerequisite issues stay removed rather than becoming
   historical exceptions. The migration report lists old source, old entry, new exception id and raw finding id; no catch-all or dead record is allowed.
6. **Native graph parity:** a complete recorded GitHub REST fixture covers unblocked, multiply blocked, closed-blocker, cross-epic, missing-parent, pagination and cycle cases. Mutating only labels or
   body suffixes leaves actionability bytes unchanged.
7. **Helper parity:** the native actionability report replaces `unblocked*.mjs`; `file-issues.mjs` still creates the same native parent and direct blocked-by edges; `close-sub.mjs` still checks earned
   tasks and parent completion without needing unrelated issue edits.
8. **Live-audit backfill:** the recorded 14:51 IST fixture reproduces all 50 open sub-issues, 49 native parents, the exact 39 pre-backfill native-blocked issue numbers, all 51 open blocker edges, the
   eleven-issue pre-backfill computed set, 40 label assignments, all 40 affected bodies with their 20-open/20-closed and 10-open-epic/10-open-non-epic splits, all 116 parenthesized occurrences with
   their 50-open/66-closed split, the 106 checklist suffix rows with their 40-open/66-closed split, the 10 open non-epic occurrences, the 138-body broader prose inventory with its 21-open/117-closed
   split, and #730 as the sole missing parent, extra label and open blocker-prose body outside the parenthesized inventory. A second recorded state proves that closing #732 removed only the #733
   suffix from #731, leaving 40 bodies and 115 occurrences.
9. **Prerequisite-close transitions:** closing #732 produces 49 open sub-issues, 48 native parents, 38 natively blocked issues, 50 open blocker edges and the exact eleven-issue set above. Closing #733
   then produces 48 open sub-issues, 47 native parents, 35 natively blocked issues, 47 open blocker edges and the exact thirteen-issue set above. Projection fixtures record 39 then 36 labels and 115
   then 112 parenthesized occurrences without treating either projection as authority.
10. **Required #730 repair:** applying only parent `#644` and blocker `#652` to the pre-close fixture proves the retained 50/50-parent, 40-blocked, 52-edge and ten-actionable result. Applying the same
    repair after #732 and #733 close proves #736's live target: 48 open sub-issues, 48 native parents, 36 natively blocked issues, 48 open blocker edges and the exact twelve-issue set above. Label or
    body changes cannot satisfy either test.

The parity harness normalises only presentation details. It must not discard a code, stable scope, issue number, package id, selector, path, edge, state or remediation. Counts are reported per
consumer and in aggregate, with the before/after command lines and exit status.

### 15.2 Native backfill required before #736

Backfill is a reviewed write plan, not an inference from a label or suffix:

1. Query every relevant issue, native parent, native child and direct native blocker with pagination.
2. Compare that native set with the authored roadmap plan and temporary projections only to find possible omissions. A projection can raise a discrepancy; it cannot decide actionability or overwrite a
   conflicting native edge.
3. Produce a deterministic manifest of proposed missing native relationships with issue numbers and the authored-plan key that justifies each edge.
4. Refuse application while any issue is absent, any parent is ambiguous, any blocker is missing, any cycle exists or the API result is incomplete.
5. The #732-reviewed manifest contains the known #730 repair: attach #730 to parent #644 and add direct blocker #652. No projection deletion may precede those two writes.
6. After explicit application in #736, re-query from GitHub and require exact set equality with the reviewed manifest plus all pre-existing native relationships, then require the transition-aware live
   result of 48 open sub-issues, 48 native parents, 36 natively blocked issues, 48 open blocker edges and the exact twelve actionable issues frozen above.

### 15.3 Strict preconditions for deleting projections in #736

#736 must not remove a label, suffix or helper until all of these are true in one exact-head run:

1. A fresh complete native re-query passes §14 after #732 and #733 are closed: 48 open roadmap sub-issues, all 48 with their intended parent, 36 with open native blockers across 48 open blocker edges,
   and #730 with parent #644 and direct blocker #652.
2. Native actionability has zero mismatches against the reviewed backfill manifest. A shadow comparison with the temporary projections is reported for migration evidence; any mismatch is resolved by
   reviewing and correcting native relationships, never by making projections authoritative.
3. Every reader and writer in §12 has been migrated, archived or deleted. Repository and `zmdb-handover` searches report zero active code or operator instructions that derive actionability from the
   `blocked` label or any `blocked by` prose.
4. `scripts/roadmap/file-issues.mjs` writes native parent and blocked-by links but does not add the label. `scripts/roadmap/render.mjs` emits task rows without blocker suffixes.
5. `unblocked.mjs`, `unblocked2.mjs` and `close-sub.mjs` use the native adapter. Closing one issue does not edit unrelated epic bodies or labels.
6. `sync-blocks.mjs`, `sync-labels.mjs` and `stale-blocks.mjs` have zero remaining callers. Their deletion is in the same #736 change as the final projection removal, not in #732 or #733.
7. No workflow, saved contributor command, `HANDOVER.md`, `PROMPT.md` or active filing helper filters, adds, removes or explains actionability through the label or prose.
8. A dry-run records the exact 40 label assignments and all 40 affected bodies measured at 14:51 IST, including all 116 parenthesized occurrences, their 50-open/66-closed split, all 106 checklist
   suffix rows with their 40-open/66-closed split, the 10 open non-epic occurrences and checksums for every affected body. It also records the post-#732 40-body/115-occurrence state, the 138-body
   broader prose audit with its 21 open bodies, #730 as the sole open non-parenthesized blocker-prose body, the 49-parent/51-edge pre-close graph, the retained 50-parent/52-edge pre-close repair
   fixture, the post-#732 49/48-parent/38-blocked/50-edge transition, the post-#733 48/47-parent/35-blocked/47-edge transition, and #736's 48/48-parent/36-blocked/48-edge live target. It also records
   the post-#733 projection state of 36 labels, 40 affected bodies, 112 occurrences and 102 checklist suffixes. Drift since either audit requires a fresh body, occurrence, label and native-graph
   measurement.
9. The destructive GitHub mutation is explicit and fail-closed: remove every current literal parenthesized blocker occurrence from every affected body and remove all label assignments, verify zero
   `(blocked by #…)` occurrences, remove #730's `**Blocked by:** #652` field after its native edge exists, and verify zero open issue bodies contain blocker prose and zero active label/prose readers
   or writers remain before deleting the repository label. Closed historical narrative outside the 66 targeted checklist suffixes is retained. A failed intermediate verification stops before label
   deletion.
10. Immediately before deletion, every consumer/helper reports native relationships as its only authority: zero label or suffix readers, zero label or suffix writers, 36 natively blocked open
    sub-issues and exactly these twelve actionable issue numbers: `620 628 651 674 701 717 734 735 736 739 746 753`. A final fresh native re-query produces byte-identical actionability to the
    post-backfill/pre-removal native result, and the full non-benchmark gate is green.

Until all ten conditions pass, the current label, body projections and sync machinery remain intact even though they are non-authoritative.

```

### 7. ARCHITECTURE.md — §2.1 dated assertion measurements

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `829d7ae516e8856a800738e42051e693414abadd33c97ec20dd739d1e4242915`.

```text
> As of 2026-09-06, the 278 shipped files covered by `verify:escape-hatches` contain 53 assertions and 54 `// boundary:` comments. They contain no `any`, no non-null assertions, no `as unknown as`,
> and one lint suppression. The consumer documentation contains no required casts.
>
> The count rose from 28 during the type-first work. Of the 53 current assertions, 26 are in `aot-validator`, mainly around checker values, parsed JSON, and validated return values. Each assertion
> records the runtime guarantee behind its assertion.
>
```

### 8. ARCHITECTURE.md — §3.2 former database-vertical extraction diagram

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `a2b87c006f78336e58bdf4cb2bc1c3f328c3141f057125247cda839febe92d2c`.

````text
This is the shipped graph during the database-vertical extraction frozen in §3.4. SQLite, PostgreSQL, MySQL, and SQL Server are side verticals over query-compiler and repository; CockroachDB extends
PostgreSQL one-way, and SingleStore extends MySQL one-way.

```
      ┌────────────────┐
      │@zmdb/query-    │  (runtime dep: oxfmt, declaration-emitter path only)
      │  compiler      │
      └───────┬────────┘
              ▼
      ┌───────────────────┐
      │ @zmdb/schema │  (the schema SoT + type derivation)
      └─────────┬─────────┘
                ▼
      ┌────────────────┐
      │    @zmdb/ai    │  (also depends directly on schema-core)
      │ (neutral tools)│
      └───┬────────┬───┘
          │        ▼
          │  ┌────────────────┐
          │  │   @zmdb/mcp    │  (depends only on AI; platform APIs)
          │  │ (MCP protocol) │
          │  └────────────────┘
          ▼
      ┌────────────────┐
      │@zmdb/aot-      │  (also depends directly on schema-core)
      │  validator     │
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │@zmdb/repository│  (also depends directly on schema-core + query-compiler)
      └───────┬────────┘
              ├──────────────▶┌────────────────┐
              │               │@zmdb/postgres  │  (also query-compiler; optional peer: pg)
              │               └────────────────┘
              ├──────────────▶┌────────────────┐
              │               │ @zmdb/mysql    │  (also query-compiler; optional peer: mysql2)
              │               └────────────────┘
              ├──────────────▶┌────────────────┐
              │               │  @zmdb/mssql   │  (also query-compiler; optional peer: mssql)
              │               └────────────────┘
              ▼
      ┌────────────────┐
      │   @zmdb/app    │  (also depends directly on schema-core,
      │ (app kernel)   │   query-compiler, and aot-validator)
      └───────┬────────┘
              ├──────────────▶┌────────────────┐
              │               │  @zmdb/otel    │  (required peer: @opentelemetry/api)
              │               └────────────────┘
              ├──────────────▶┌──────────────────────┐
              │               │@zmdb/transport-nats │  (required peer: @nats-io/transport-node)
              │               └──────────────────────┘
              ├──────────────▶┌──────────────────────────┐
              │               │@zmdb/transport-rabbitmq │  (required peer: amqplib)
              │               └──────────────────────────┘
              ▼
      ┌────────────────┐
      │   @zmdb/web    │  (also depends directly on schema-core;
      │(decorator HTTP)│   compiler + TS are optional tooling peers)
      └───────┬────────┘
              ▼
      ┌────────────────┐
      │      zmdb      │  (cohesive product facade; ZERO logic)
      └────────────────┘
```

````

### 9. ARCHITECTURE.md — §3.3 former handwritten package map

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `e8b2e881edec5d487c1fbe4bdca4c1f0c34d238f27990a167397fb738f63072c`.

```text
### 3.3 Current package map

| Package                    | Responsibility                                                                                                                                          | Runtime deps                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@zmdb/client`             | Dependency-free structural HTTP transport, deterministic request planning, response reading, cancellation, authentication injection, and typed errors   | none                                                                                                                            |
| `@zmdb/angular`            | Angular DI, signal, `DestroyRef`, Observable cancellation, and request-local generated-client ownership                                                 | `@angular/core`, `rxjs` (required peers)                                                                                        |
| `@zmdb/react`              | Optional React context, hooks and component-lifecycle ownership for generated clients                                                                   | client; `react` (required peer)                                                                                                 |
| `@zmdb/react-native`       | Optional AppState, connectivity, and credential-store lifecycle policy over the React generated-client hooks                                            | client, react; `react`, `react-native` (required peers)                                                                         |
| `@zmdb/next`               | Optional Next.js request-scoped server clients and browser bindings for generated clients                                                               | client, react, `server-only`; `next`, `react`, `react-dom` (required peers)                                                     |
| `@zmdb/nuxt`               | Optional Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration                                                                | client, vue; `nuxt`, `vue` (required peers)                                                                                     |
| `@zmdb/vue`                | Optional Vue plugin, reactive query/mutation composables, watcher/effect-scope cancellation, and per-application SSR isolation                          | client; `vue` (required peer)                                                                                                   |
| `@zmdb/svelte`             | Optional typed Svelte context, lazy query and mutation stores, stale-result suppression, and lifecycle cancellation                                     | client; `svelte` (required peer)                                                                                                |
| `@zmdb/sveltekit`          | Optional request-local SvelteKit server/client loads, explicit credential forwarding, native errors, and navigation cancellation                        | client, svelte; `@sveltejs/kit`, `svelte` (required peers)                                                                      |
| `@zmdb/solid`              | Optional Solid context, native resources, owner cancellation, stale-result suppression, and native Suspense/error propagation                           | client; `solid-js` (required peer)                                                                                              |
| `@zmdb/sql`                | SQL-first compiler, schema-object DDL, database protocols, and remaining built-in dialect definitions                                                   | none                                                                                                                            |
| `@zmdb/migrations`         | Schema snapshots, deterministic diffs and DDL plans, migration files, runners, catalog introspection, drift detection, and declaration emission         | query-compiler; oxfmt (declaration entry only)                                                                                  |
| `@zmdb/schema`             | Tags, `TypeIR`, derived DTOs, relations, JSON Schema, seeding, and custom types; no AI source, export, or peer                                          | query-compiler                                                                                                                  |
| `@zmdb/ai`                 | Provider-neutral tool documents and dialects, lenient parsing, bounded chat orchestration, shared invocation, and OpenAPI-derived tools                 | schema-core                                                                                                                     |
| `@zmdb/ai-anthropic`       | Optional Anthropic Messages API driver over the provider-neutral chat contract                                                                          | ai; `@anthropic-ai/sdk` (optional peer)                                                                                         |
| `@zmdb/ai-langchain`       | Optional LangChain structured-tool contract and the sole `@langchain/core` peer                                                                         | ai; `@langchain/core` (optional peer)                                                                                           |
| `@zmdb/ai-vercel`          | Optional Vercel AI SDK tool fields with caller-owned schema branding and validation                                                                     | ai; `ai` (optional peer)                                                                                                        |
| `@zmdb/mcp`                | Transport-neutral MCP client/server protocol handling, authenticated identity injection, validation, and bounded remote calls                           | ai                                                                                                                              |
| `@zmdb/protobuf`           | Dependency-free protobuf calls, descriptors, generated-code wire ABI, and typed gRPC artifacts                                                          | none                                                                                                                            |
| `@zmdb/validator`          | Compiler-free validation, serialization, errors, and emitted-code runtime helpers                                                                       | schema-core                                                                                                                     |
| `@zmdb/compiler`           | TypeScript reflection, TypeIR production, AOT emission, project compilation, unplugin/Metro adapters, lint rules, testing utilities, and project config | ai, aot-validator, query-compiler, schema-core; TypeScript (required peer)                                                      |
| `@zmdb/orm`                | Auto-validating typed CRUD, transactions, relations, populate, loaders, lifecycle events, and vendor-neutral driver protocols                           | aot-validator, query-compiler, schema-core                                                                                      |
| `@zmdb/mssql`              | Complete SQL Server traits, DDL/migrations/refusals, catalog introspection, capabilities, and structural node-mssql driver                              | migrations, query-compiler, repository; `mssql` (optional peer)                                                                 |
| `@zmdb/postgres`           | Complete PostgreSQL traits, DDL/migrations, catalog introspection, structural driver, streaming, cancellation, and family extension points              | migrations, query-compiler, repository; `pg` (optional peer)                                                                    |
| `@zmdb/sqlite`             | Complete SQLite traits, DDL/migrations/refusals, introspection, embedded migrations, capabilities, and structural `node:sqlite` driver                  | migrations, query-compiler, repository                                                                                          |
| `@zmdb/mysql`              | Complete MySQL traits, DDL/migrations/refusals, introspection, structural mysql2 driver, capabilities, and packed live acceptance                       | migrations, query-compiler, repository; `mysql2` (optional peer)                                                                |
| `@zmdb/app`                | Protocol-neutral metadata, DI, modules, lifecycle/extensions, messaging, commands, events, CQRS, state, health contracts, and observability ports       | aot-validator, query-compiler, repository, schema-core                                                                          |
| `@zmdb/jobs`               | Typed queues, workers, dead letters, scheduling, leases and the built-in SQLite memory backend                                                          | app, query-compiler, repository, sqlite                                                                                         |
| `@zmdb/jobs-postgres`      | PostgreSQL `JobStore` adaptation over caller-owned pools and clients                                                                                    | jobs, postgres; `pg` (required peer)                                                                                            |
| `@zmdb/otel`               | OpenTelemetry API adaptation over caller-owned tracers and meters, without provider, SDK, exporter, or ambient-context ownership                        | app; `@opentelemetry/api` (required peer)                                                                                       |
| `@zmdb/transport-grpc`     | Typed grpc-js server/client adaptation over generated protobuf service artifacts, with explicit application lifecycle and caller-owned clients          | app, protobuf; `@grpc/grpc-js` (required peer)                                                                                  |
| `@zmdb/transport-nats`     | Core NATS wildcard and queue-group messaging over the public application transport strategy contract                                                    | app; `@nats-io/transport-node` (required peer)                                                                                  |
| `@zmdb/transport-rabbitmq` | RabbitMQ topic transport with bounded prefetch, confirmed delayed retries, request/reply, and owned dead-letter topology                                | app; `amqplib` (required peer)                                                                                                  |
| `@zmdb/transport-redis`    | Redis Pub/Sub event and request/reply transport over concrete application messaging channels                                                            | app; `redis` (required peer)                                                                                                    |
| `@zmdb/web`                | Stage-3 HTTP framework: controllers, routing, request pipeline, OpenAPI, gateways, HTTP-aware testing, and runtime adapters                             | app, schema-core; compiler and TypeScript (optional tooling peers)                                                              |
| `zmdb`                     | Curated product facade and CLI; no AI, MCP, or OTel public re-export                                                                                    | app, aot-validator, compiler, migrations, query-compiler, repository, schema-core, sqlite, web; mssql/postgres (optional peers) |

**Watch-list for future splits** (kept as sub-modules until they earn §3.1):

- `@zmdb/web` keeps HTTP concerns as sub-modules unless one becomes independently useful; the protocol-neutral application kernel has already moved to `@zmdb/app`.
- Native/WASM hot-path kernels (§4) would ship as their own artifact packages (`@zmdb/<x>-native`) loaded optionally, never as a hard dependency.

```

### 10. ARCHITECTURE.md — §3.10 measured release/exception inventory and native cutover

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `645f8aba64b7182becc0828bc92d0ebb45822c400e27c3c8caf23e82367b43d6`.

```text
Issue #749 implements the #746 release contract, extended for the packages admitted by #674 and #628, without changing the dependency graph: eight lockstep core packages, 28 independently versioned
integrations, two independently versioned tooling packages, and six private root workspaces. `scripts/release/policy.mjs` is the sole release-group and compatibility authority; manifests, planning,
preparation, tags, publication selection, and the generated release-unit column are checked projections.

Issue #732 froze the next governance boundary in [`scripts/architecture/SPEC.md` §§11–16](./scripts/architecture/SPEC.md): one read-only snapshot composes these independent authorities, temporary
findings become owned structured exceptions, and GitHub's native parent/sub-issue and blocked-by relationships are the sole actionability authority. The implemented architecture portion now loads
catalog, policy, workspace manifests, graph facts, reachability, metadata, product documentation, and the current release plan once through `loadGovernanceSnapshot({ root })`. `yarn verify:governance`
runs those five domain queries plus the owned-exception query together; the focused commands call the same queries with the same snapshot records. Issue #735 implements the exception side in
[`scripts/architecture/exceptions.mjs`](./scripts/architecture/exceptions.mjs): 81 exact live records replace zero database, 78 runtime-foundation, zero server, and 3 tooling findings at the
`958a67ff` base. Issue #675 had already removed every database finding, so its closed issue owns no live exception. Issue #628 had removed every runtime tooling violation; #735 preserves that
extraction and assigns the three remaining generated private-source findings to their open runtime package owners. All 81 current opaque entries are therefore accounted for without preserving dead
debt. Adding, lowering, and removing records follows [`scripts/architecture/EXCEPTIONS.md`](./scripts/architecture/EXCEPTIONS.md). Issue #736 implements the repository side of the native relationship
cutover in [`scripts/roadmap/native-relationships.mjs`](./scripts/roadmap/native-relationships.mjs): the live reader paginates open issues, consults child and blocker endpoints only for issues whose
native REST total counters report those relationships, retains closed referenced rows for parent-completion decisions, and computes actionability without labels or body prose. The canonical roadmap
filer writes native links and plain task rows only; the three older projection-writing filers are archived. Operational planning and close helpers use the same native reader, while blocker suffixes,
issue label assignments, the repository `blocked` label and their three synchronizer/staleness helpers are removed.

```

### 11. ARCHITECTURE.md — §3.10 former admission checklist and repeated gate list

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `26d6c64d825bb104807049e0d5790e59adc72fef675ae8729735962d084adb50`.

````text
Package admission is one atomic workflow:

1. add the publishable manifest, public exports, package documentation, license and external-consumer evidence;
2. add one same-id row to `scripts/product/catalog.mjs`, `scripts/architecture/policy.mjs`, and `scripts/release/policy.mjs`;
3. declare every direct catalog dependency, list the same ids in `allowedWorkspaceDependencies`, use the canonical minimal ring, and apply the same-core or explicit cross-unit range form from release
   policy;
4. assign tooling entries and optional peers to exact export/bin selectors and record every exact peer floor plus packed evidence in release policy;
5. add the root changelog bullet owned by the correct release unit; and
6. regenerate and verify every derived surface:

```bash
node docs-site/generated.mjs
yarn verify:governance
yarn verify:product-catalog
yarn verify:architecture-zones
yarn verify:runtime-reachability
yarn verify:package-metadata
yarn verify:release-governance
yarn verify:docs-generated
```

No workflow, release helper, package reference or architecture diagram receives a separate package row or publish position.

````

### 12. ARCHITECTURE.md — §3.10 dated release-unit counts

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `c41820f8fdba3e07b6965b5e83835b5b1845705c4d85936b0136092f93ea6f12`.

```text
The executable release model has one eight-package lockstep core, 28 independently versioned integrations, two independently versioned tooling packages, and private workspaces that never publish.
Same-core edges use `workspace:^`; every edge crossing release units carries an explicit measured compatibility range. The root changelog identifies `core` or one independent catalog id, and tags are
`core-v<version>` or `<catalog-id>-v<version>`. Product membership, architecture constraints, release/compatibility policy, release content, and npm credentials remain separate authorities.

```

### 13. ARCHITECTURE.md — §7 superseded architecture and package-count narrative

Original source: `ARCHITECTURE.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `8fd5d7c8c7ea216a0a430477b20b7cc8ac403fe7213c6c4c968052bacbcaddb2`.

```text
## 7. Superseded

This document replaces the 2026-08-29 "Zero-Maintenance Data Layer — Architecture Specification." Notably it **reverses** that document's §4 recommendation ("TypeScript for all packages") in favour of
the north-star-driven language policy in §4 here, and it records the thirty-eight-package implementation reality (including `@zmdb/client`, `@zmdb/react`, `@zmdb/react-native`, `@zmdb/angular`,
`@zmdb/vue`, `@zmdb/svelte`, `@zmdb/sveltekit`, `@zmdb/solid`, `@zmdb/next`, `@zmdb/nuxt`, `@zmdb/ai`, its opt-in integrations, `@zmdb/mcp`, `@zmdb/protobuf`, `@zmdb/app`, `@zmdb/jobs`,
`@zmdb/jobs-postgres`, `@zmdb/mssql`, `@zmdb/postgres`, `@zmdb/cockroach`, `@zmdb/sqlite`, `@zmdb/mysql`, `@zmdb/singlestore`, `@zmdb/otel`, `@zmdb/transport-grpc`, `@zmdb/transport-nats`,
`@zmdb/transport-rabbitmq`, `@zmdb/transport-redis`, `@zmdb/compiler`, and `@zmdb/web`) rather than the original four. Component-level details in the old doc that remain accurate now live in each
package's `SPEC.md` and the docs site.
```
