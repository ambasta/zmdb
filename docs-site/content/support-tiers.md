# Support tiers and versioning

Twenty-seven packages ship from this repository, and they are not equally proven. A single version number across all of them would say the same thing about the PostgreSQL driver, which every push
exercises against a live server, and about the SvelteKit adapter, whose only end-to-end evidence is a fixture no push runs. This page states what each version number promises instead.

Two things vary independently: which packages move together when a release is cut, and how much evidence stands behind a package. Release units answer the first, support tiers answer the second.

## Release units

`@zmdb/core` and the seven packages it composes form one release unit and always carry one byte-identical version. Installing `@zmdb/core` gives you a set of packages that were versioned, packed and
tested together, and the release tooling refuses a build where the eight versions disagree.

Every other package versions on its own. A fix to the MSSQL driver does not move the SQLite driver, and neither moves the kernel. Each such package declares the exact range of every zmdb package and
every third-party peer it is compatible with, so a `@zmdb/core` upgrade cannot silently drag an integration along with it. Those ranges, and the fixture or spec that proves each one, are in the
[package reference](./package-reference.html).

## The two tiers

Every package declares one tier in `scripts/release/policy.mjs`, alongside the evidence path that justifies it. The generated table in the [package reference](./package-reference.html) carries the
tier and the evidence for each package.

| Tier          | What every push proves                                                                                                                          | What the version may be          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `supported`   | The package runs against the real technology it integrates: a live database, an installed packed consumer, or the real peer library in process. | Stable, once the project is 1.0. |
| `provisional` | The package's own behaviour runs, but its promise about an external runtime rests on evidence no push runs.                                     | Prerelease only.                 |

A provisional package is not a preview and it is not unfinished. It is a package whose integration claim is currently checked by a human running a fixture rather than by continuous integration. Its
declaration names those unrun fixtures as gaps, and the release tooling refuses to cut a stable version for it until they run on every push. Six packages are provisional today:

| Package           | Runs on every push                                                             | Not run on any push                                                 |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `@zmdb/client`    | The bindings against real React, Vue, Svelte, Solid, Angular and React Native. | A real app build: bundler, server rendering and the Metro pipeline. |
| `@zmdb/transport` | gRPC, NATS, RabbitMQ and Redis against live services.                          | Kafka and Amazon SQS, for which no push starts a broker.            |
| `@zmdb/next`      | The route and client glue.                                                     | A Next.js build and its App Router runtime.                         |
| `@zmdb/nuxt`      | The server and client glue.                                                    | A Nuxt build and its Nitro runtime.                                 |
| `@zmdb/sveltekit` | The server and client glue.                                                    | A SvelteKit build and its adapter output.                           |
| `@zmdb/mcp`       | The server and client contract.                                                | An installed consumer driving a real MCP host.                      |

Everything else is supported, including all six SQL drivers, the job stores, the kernel, the compiler and the command line. The tiers are not a ranking of effort or of code size: `@zmdb/sqlite` is
small and supported because Node.js ships the engine it drives, and `@zmdb/client` is large and provisional because nothing in continuous integration builds a real application with it.

## Rules the tooling enforces

- A package may not declare `supported` while anything it depends on is `provisional`. A promise cannot be stronger than what it is built on, which is why `@zmdb/next` is provisional as long as
  `@zmdb/client` is.
- Every path a tier names must exist. Deleting a fixture and leaving the claim behind fails the release model.
- A stable version, and a release plan targeting one, is rejected for any package that is not `supported`.

The tier is declared by hand and not derived from the workflow file, because acceptance must not depend on a hosted continuous-integration provider's configuration. That makes each declaration a
review question: the evidence path is what a reviewer opens to check whether it is still true. When a gap starts running on every push, the package moves to `supported` in the same change that adds
the job.

## What this means for you

If you are adopting zmdb on PostgreSQL, MySQL, SQLite, MSSQL, SingleStore or CockroachDB, and you are calling it from your own server, everything in your path is supported. Its version numbers will
behave as semantic versioning says once 1.0 lands.

If your path goes through a framework adapter, a Kafka or SQS transport, or an MCP host, you are using a provisional package. The code is exercised, its shape is checked against an installed pack, and
the guides are written against it, but nothing in continuous integration builds the application you are building. Pin exact versions, and read [common errors](./web-faq-errors.html) before assuming a
break is yours.

Everything here is pre-1.0. See the [project status](https://github.com/ambasta/zmdb) for what that means about cadence and support, and
[publishing](https://github.com/ambasta/zmdb/blob/main/PUBLISHING.md) for how a release is actually cut.
