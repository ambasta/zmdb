# Architecture exceptions

Temporary architecture debt is data with an owner and an expiry condition, not a copied diagnostic string. The sole registry is [`scripts/architecture/exceptions.mjs`](./exceptions.mjs). It currently
contains 81 live records migrated from the exact `958a67ff` inventory after #675 completed the database ownership cutover:

| Verifier            | Live records | Retired legacy rows | Measured occurrence ceiling |
| ------------------- | -----------: | ------------------: | --------------------------: |
| database boundaries |            0 |                   0 |                           0 |
| runtime foundation  |           78 |                   0 |                         262 |
| server boundaries   |            0 |                   0 |                           0 |
| tooling boundaries  |            3 |                   0 |                           3 |
| **Total**           |       **81** |               **0** |                     **265** |

The former database, runtime-foundation, and server JSON baselines and the two tooling violation sets were deleted only after an executable comparison accounted for all 81 entries present at that
base. Issue #675 had already removed all 28 database findings, so its closed issue owns no live exception. Issue #628 had removed every runtime tooling violation; #735 preserves that result and
registers only the three generated private-source findings that remain.

## Inspect the registry

```bash
node scripts/architecture/exceptions.mjs
node scripts/architecture/exceptions.mjs --migration-report
```

The migration report prints the former source and entry, structured exception id, stable raw finding id, owner issue, and measured ceiling for every live record. It is a projection of the registry,
never an input to a verifier.

## Add an exception

Do not start by editing the registry. Run the affected verifier and identify the raw rule code and exact structured scope. Fix the finding unless temporary debt is a reviewed requirement. If an
exception is necessary, add one record that includes:

1. a unique `GEX-…` id and the exact stable finding id;
2. one exact package, entry, edge, path, or issue scope—no glob, regular expression, prefix, or prose-only identity;
3. a concrete rationale;
4. the introducing or first-measured issue, full commit id, and existing evidence path;
5. one open issue that removes the debt;
6. the measured positive `finding-count` ceiling; and
7. an explicit removal condition.

Add or update a mutation test proving that a different path, package, entry, edge, or rule is not covered. A new path beside an excepted path remains unowned debt and fails.

## Lower a ceiling

When a count falls but remains positive, the verifier emits `GOV_EXCEPTION_CEILING_RAISED` and names the measured value. Lower `ceiling.maximum` in the same issue-scoped change. Do not restore deleted
code or broaden the scope to preserve the old number.

## Remove an exception

When the exact finding disappears, the verifier emits `GOV_EXCEPTION_FINDING_ABSENT`; when another explicit expiry condition becomes true, it emits `GOV_EXCEPTION_REMOVAL_DUE`. Delete the record in
the same change. A live finding whose owner issue is closed emits `GOV_EXCEPTION_OWNER_CLOSED`; reopening or changing ownership requires an explicit review.

Specialised local verifiers classify raw findings without performing network access. Routine aggregate verification must receive a complete native relationship snapshot captured live by #734's
external adapter:

```bash
snapshot="$(mktemp)"
node scripts/roadmap/native-relationships.mjs --json > "$snapshot"
yarn verify:governance --relationships "$snapshot"
rm "$snapshot"
```

The aggregate command fails with `GOV_EXCEPTION_RELATIONSHIPS_REQUIRED` when that explicit input is absent. It passes the snapshot's existing read-only `issues` map through
`verifyGovernanceSnapshotExceptionSource`; the adapter extracts owner state but never reads package membership, imports, labels, or issue prose. A missing owner emits `GOV_EXCEPTION_OWNER_MISSING`,
and a closed owner with a live finding emits `GOV_EXCEPTION_OWNER_CLOSED`. Verification code performs no network access and never mutates GitHub. CI performs the same capture with its read-only
`GITHUB_TOKEN`; no checked-in owner-state projection is accepted as current authority.
