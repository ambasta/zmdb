# zmdb Generated Output Exception

**Version 1.0**

This document grants an additional permission under Section 10.2 of the Mozilla Public License, Version 2.0 ("the MPL"), the license under which zmdb is distributed. It only ever **widens** the rights
the MPL gives you. Nothing here takes anything away.

Read it alongside [`LICENSE`](./LICENSE).

## Why this exists

zmdb is a build-time tool as much as a runtime library. Three parts of it write code into places you own:

- the ahead-of-time compiler rewrites your own source modules, inlining validation checks and schema descriptors derived from your TypeScript types;
- `zmdb client generate` writes a TypeScript client and an OpenAPI document into your repository;
- `zmdb generate` and the migrations tooling write migration files into your repository;
- `zmdb new project` and the scaffolding commands write starter files into your project.

Because the MPL defines "Modifications" to include _any new file containing Covered Software_ (Section 1.10(b)), someone could argue that a file zmdb wrote into — or wrote out — is now covered by the
MPL, and must therefore be published under it.

That is not the intent, has never been the intent, and this document says so in writing.

## The grant

**Generated Output** means any of the following:

1. Source code, data, or documents produced by `@zmdb/compiler` or any zmdb build plugin, transform, or code generator, including code inlined into your own modules by the ahead-of-time transform.
2. Client code and API documents produced by `zmdb client generate` or the equivalent programmatic API.
3. Migration files, schema snapshots, and DDL produced by `zmdb generate`, `@zmdb/migrations`, or the equivalent programmatic API.
4. Project, module, schema, controller, repository, and command files produced by `zmdb new`, `zmdb generate`, or any other zmdb scaffolding command.
5. Any file of yours that a zmdb tool has modified in place, to the extent of that modification.

**Generated Output is not Covered Software.** It carries no obligation under the MPL. You may use, modify, distribute, sell, and license Generated Output under terms entirely of your choosing, and you
are not required to disclose it, publish it, or make its source available to anyone.

This applies regardless of how the output is produced or delivered — inlined into your modules, emitted as separate files, bundled, transpiled, minified, tree-shaken, or served over a network.

**Larger Works are unaffected.** For the avoidance of doubt, this is in addition to Section 3.3 of the MPL, under which an application, service, or product that merely combines with or links against
zmdb is a Larger Work you may distribute under terms of your choice. Building a product or a service on zmdb creates no obligation to open it, and zmdb imposes no condition on network use of any kind.

## What this does not do

This exception does not:

- change the license of zmdb's own source files, which remain under the MPL;
- permit removing or altering MPL notices in zmdb's own source files;
- apply to modifications you make to zmdb's own source files. If you change zmdb itself and distribute the result, MPL Section 3 still applies to those files, and the person you distribute to is
  entitled to that source.

In short: **what you build with zmdb is yours. What you change inside zmdb belongs to whoever receives it.**

## Notes for license tooling

The `license` field in every zmdb package manifest reads `MPL-2.0`. That is deliberate and conservative: this document grants an additional permission rather than replacing the license, so the SPDX
identifier for zmdb's own source is unchanged. Automated scanners will read `MPL-2.0`, which is correct for the files they are scanning.

## Applicability

This exception applies to all releases of zmdb that include this file, and to every past release. It is irrevocable for any version to which it has been applied.

---

_This is a licensing document, not legal advice. If your organisation needs a formal opinion, have your own counsel read this file and [`LICENSE`](./LICENSE)._
