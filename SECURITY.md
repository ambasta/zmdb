# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ambasta/zmdb/security/advisories/new) — it is enabled on this repository and it is the whole process. The report stays private, the fix
is developed in a private fork, and the advisory is published with credit when the fix ships.

If GitHub is unavailable to you, email <amit.prakash.ambasta@gmail.com> with `zmdb security` in the subject.

**Do not open a public issue for a vulnerability**, and do not disclose it publicly until a fix is available.

## What to include

- The affected package and version, plus your Node and TypeScript versions.
- What an attacker can do, and what they need in order to do it — a network position, a database credential, a controlled column name, a crafted request body.
- A reproduction: the table declaration, the query or route, and the input. A working reproduction is the difference between a fix this week and a discussion this month.

## What is in scope

zmdb's security-relevant surface is where untrusted input meets generated code:

- **SQL injection** — any input that reaches emitted SQL as anything other than a bound parameter, including identifiers, operators, ordering, pagination and full-text search.
- **Validation bypass** — input that `assert<T>()` or a generated validator accepts although the type forbids it, or that reaches a repository unvalidated.
- **HTTP request handling in `@zmdb/web`** — header or response splitting, a policy that fails to apply, a guard that can be bypassed, path handling that escapes its route.
- **The build-time transform** — emitted code that differs in a security-relevant way from the declared types, or a transform that reads or writes outside the project.
- **Generated artifacts** — a client, migration or OpenAPI document that embeds something it should not, such as a credential from configuration.
- **Credential handling** — a connection string, token or query parameter value appearing in a log line, an error message returned to a client, or telemetry.

## What is not a vulnerability

- **Anything requiring a value you interpolated yourself.** A statement you hand to `driver.execute` with its own `text` is yours to make safe — pass values as `parameters`. See
  [Raw SQL](https://ambasta.github.io/zmdb/docs/raw-sql.html).
- **A missing hardening feature**, unless its absence breaks a documented guarantee. Open it as a feature request.
- **Resource exhaustion from your own query**, such as a request that fetches unbounded rows because no limit was set.
- **Findings against a dependency** with no zmdb-specific exploit path — report those upstream. Dependabot already covers the routine updates here.
- **Automated scanner output with no demonstrated impact.**

## What to expect

zmdb is pre-1.0, developed by a single maintainer, and there is no guaranteed response time. In practice: an acknowledgement when the report is read, an assessment once it is reproduced, and a fix
released as a new patch of the current version. Fixes land on the latest published version only — there is no LTS branch and no backports.

Coordinated disclosure, with a published GitHub advisory and a CVE where one is warranted. Credit is given unless you ask otherwise. There is no bug bounty.

## Supported versions

| Version               | Supported                             |
| --------------------- | ------------------------------------- |
| latest `1.0.0-beta.*` | yes                                   |
| earlier prereleases   | no — upgrade to the latest prerelease |

The [project status note](./README.md) states the rest of what pre-1.0 means here.
