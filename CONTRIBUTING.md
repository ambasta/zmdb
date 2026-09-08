# Contributing to zmdb

Start with the current owning SPEC and an actionable native issue. [ARCHITECTURE.md](./ARCHITECTURE.md) describes system invariants; the [ADR index](./docs/adr/index.md) preserves dated context. A
historical diagram or checklist does not authorise a current package edge or change the issue graph.

## Current authorities

| Concern                                                   | Source                                                                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official packages, identity and product role              | [Product catalog](./scripts/product/catalog.mjs) and [SPEC](./scripts/product/SPEC.md)                                                                         |
| Allowed dependencies, zones, rings and entry reachability | [Architecture policy](./scripts/architecture/policy.mjs) and [SPEC](./scripts/architecture/SPEC.md)                                                            |
| Release units and compatibility ranges                    | [Release policy](./scripts/release/policy.mjs) and [SPEC](./scripts/release/SPEC.md)                                                                           |
| Temporary owned exceptions                                | [Exception registry](./scripts/architecture/exceptions.mjs) and [exception contract](./scripts/architecture/SPEC.md#13-structured-exceptions)                  |
| Composed read-only architecture queries                   | [loadGovernanceSnapshot](./scripts/architecture/governance.mjs)                                                                                                |
| Issue ownership, blockers and actionability               | [Native relationship reader](./scripts/roadmap/native-relationships.mjs) and [contract](./scripts/architecture/SPEC.md#14-native-issue-relationship-semantics) |

The governance snapshot composes the catalog, policy, manifests and their queries. Consumers use those records instead of rebuilding a package list or graph. Generated architecture and
package-reference tables are projections of the same sources.

## Package and dependency changes

1. Identify the existing responsibility and its public boundary. Read the nearest SPEC and keep its current invariants and refusal behavior with the implementation.
2. When admitting a package, change its manifest, exports, documentation, license and catalog/architecture/release records together. When changing an edge, update its manifest declaration and policy
   classification together; use the existing SPEC rules for runtime, tooling, required-peer and optional-peer edges.
3. Implement and run the focused unit, functional or integration checks needed for the changed behavior. Reuse unchanged installed-consumer proof. A prose-only change needs formatting and
   affected-link checks, not a new runtime campaign.
4. When model facts change, regenerate the existing views with `node docs-site/generated.mjs`. Do not edit a generated row as a second authority.
5. After disjoint issue changes are composed, run one applicable integrated gate. The historical per-issue 36-command boilerplate is not the current workflow. Release preparation follows
   [PUBLISHING.md](./PUBLISHING.md).

The existing aggregate can inspect the composed model against fresh native issue data:

```bash
zmdb_relationships_file="$(mktemp)"
node scripts/roadmap/native-relationships.mjs --json > "$zmdb_relationships_file"
yarn verify:governance --relationships "$zmdb_relationships_file"
rm "$zmdb_relationships_file"
```

The relationship reader performs the explicit read-only network capture. Governance queries inspect that supplied snapshot and do not mutate GitHub, publish packages or create another tracker
projection. Focused query commands remain available for diagnosis; they consume the same model.

## Exception lifecycle

Fix a finding at its owner. If reviewed temporary debt is necessary, add one exact structured registry record with its stable finding, explicit scope, rationale, evidence, open removal issue, measured
ceiling and expiry condition. Use the existing [exception contract](./scripts/architecture/SPEC.md#13-structured-exceptions) for its schema and refusals.

A lower positive finding count requires a lower ceiling. When the finding disappears or its removal condition becomes true, remove the record in the same change. A closed owner cannot own live debt.
Do not broaden a scope, restore deleted code or preserve an obsolete count to keep an exception alive.

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
