# Contributing to zmdb

Start with the current owning SPEC and an actionable native issue. [ARCHITECTURE.md](./ARCHITECTURE.md) describes system invariants; the [ADR index](./docs/adr/index.md) preserves dated context. A
historical diagram or checklist does not change the issue graph.

## Package and dependency changes

Use package manifests for dependencies and exports, the [product catalog](./scripts/product/catalog.mjs) for package membership, and [release policy](./scripts/release/policy.mjs) for version groups.
Build and documentation tooling read those records directly.

Implement the change and run the existing unit, functional or integration tests that exercise it. Add a regression test only when the behavior lacks coverage. Keep public-package installation checks
for changes to packaging or exports. Use the normal repository checks as appropriate:

```bash
yarn lint
yarn fmt:check
yarn typecheck
yarn test
yarn build
```

Do not introduce source-text policing, arbitrary count or performance ratchets, GitHub-dependent acceptance checks, or tests of bespoke governance machinery. Benchmarks are optional manual tools and
must run on an idle machine; shared-machine timings do not establish a performance baseline.

Release preparation follows [PUBLISHING.md](./PUBLISHING.md).

## Documentation changes

Use the [documentation SPEC](./docs-site/SPEC.md) for the current page, sample and generated-content contracts. Its [measured inventory](./docs-site/SPEC.md#21-current-documentation-inventory) records
page statuses and sample classifications; update those measurements when their inputs change.

- **Add a page:** add its Markdown under `docs-site/content/`, register its title/status in [pages.mjs](./docs-site/pages.mjs), and put its slug in the appropriate group in
  [navigation-plan.mjs](./docs-site/navigation-plan.mjs). Preserve existing URLs. The twelve permanently wontfix GraphQL pages remain unchanged and excluded from sample verification.
- **Add or change a sample:** annotate each TypeScript/TSX opening fence using the [sample metadata contract](./docs-site/SPEC.md#61-fence-parsing-and-metadata-syntax). Choose `compile` for a complete
  program, `expect-error` for an intentional diagnostic, or `illustrative` with the specific missing context. Group related files on one page as defined by the
  [multi-file contract](./docs-site/SPEC.md#65-multi-file-examples). Use public package exports; do not insert private source imports or invented declarations to make an excerpt compile. Runtime
  execution requires explicit opt-in and any external services belong to an existing issue-owned fixture.
- **Add an integration:** update [integrations.mjs](./docs-site/integrations.mjs) with current package, peer, guide and executable-evidence ownership, following the
  [integration contract](./docs-site/SPEC.md#52-framework-integration-matrix). Update [client-applications.mjs](./docs-site/client-applications.mjs) when its client support/example facts change.
- **Add a package:** follow the package/dependency workflow above. The catalog and admitted manifest own the reference entry; do not add a second package list to a guide.

After changing package or integration records, regenerate their pages. Run the applicable documentation checks:

```bash
node docs-site/generated.mjs
yarn verify:docs-generated
yarn verify:docs-samples
yarn build:docs
```

`verify:docs-generated` checks freshness without rewriting files. `verify:docs-samples` compiles classified groups, checks expected diagnostics and reports illustrative excerpts separately;
compilation alone is not live-service or runtime proof. CI and Pages run these checks before building. The canonical `build:docs` command supplies the repository's source-resolution hook.

## Native issue workflow

Read the current native graph before taking work:

```bash
node scripts/roadmap/native-relationships.mjs --json
```

- Native parent/sub-issue links express ownership; native direct blocked-by links express prerequisites. They are separate relationships.
- An open issue is actionable when every direct native blocker is closed. Missing references and cycles are errors. Labels, body checklists, suffixes and saved snapshots do not determine readiness.
- File or repair the native parent and direct blocker links in GitHub, then read them back. Do not add transitive blockers, compatibility readers or blocker-label/body projections.
- Keep the issue's actual scope and remaining work explicit. Finish the focused work and reviewable issue commit before reporting completion; a passing unrelated check does not complete an issue.
- Close an epic only after its native children and its usable outcome are complete. Re-query native state after closures before selecting newly unblocked work.

Verification is read-only. Operational issue updates and release/publication actions remain deliberate operations; the [publishing workflow](./PUBLISHING.md) owns release preparation and approval
boundaries.

## Current specifications and history

Keep current public contracts, ownership, invariants and rejection rules in their owning SPECs. Move dated baselines or completed migration instructions into the
[indexed ADR location](./docs/adr/index.md), preserving source commit, original headings and text. Link the current replacement from the ADR and the history from the SPEC. Do not reconstruct an
interface from a historical example or introduce a new audit gate for the move.
