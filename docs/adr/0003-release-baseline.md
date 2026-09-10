# 0003 — Release-policy starting inventory and probe

**Status:** superseded

**Decision date:** 2026-09-06, as recorded by #746

**Owning issues:** #746, #749, #750; workflow #751; archival separation #737

## Context

The initial release contract recorded one inventory and a particular Vercel compatibility experiment. Package counts and future compatibility results belong to their current sources and evidence.

## Decision

Keep release policy authoritative and distinguish the successful installed probe from the stricter declaration attempt that failed.

## Evidence

The excerpts below are copied byte-for-byte from source commit `271a731e32be377343fe279070050d7ee6bd55a2`. Their original dates, commits, issue numbers, headings and measurements remain unchanged.
Statements inside the excerpts describe their recorded state.

## Consequences

Current release policy supersedes the recorded inventory. The preserved probe retains its original TypeScript settings and does not claim a new qualification run.

## Current contract

[Release SPEC](../../scripts/release/SPEC.md), [release policy](../../scripts/release/policy.mjs), [publishing workflow](../../PUBLISHING.md).

**Superseded by:** the current contracts linked above and their implementing issues.

## Preserved source excerpts

### 1. scripts/release/SPEC.md — Opening release-policy implementation status

Original source: `scripts/release/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `4fa45d6f6e6ee00652ec6900b32b6fa6102f156f7330848752440226aa50e529`.

```text
> **Status:** target contract frozen by issue #746 on 2026-09-06, extended by issues #674 and #628 to classify the admitted `@zmdb/singlestore` and `@zmdb/compiler` packages, and implemented
> structurally by issue #749. Issue #750 still owns packed compatibility-matrix qualification.

```

### 2. scripts/release/SPEC.md — §1 measured release baseline

Original source: `scripts/release/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `746582e9e01cdfd21c3c3489bba8ed9a26f65df892c18de55f02d70fc5468185`.

```text
## 1. Measured baseline and evidence boundary

The current structurally implemented state contains:

- 38 public catalog packages, all currently at `1.0.0-alpha.4`;
- 73 direct non-development workspace edges: 20 within the cohesive core and 53 crossing release units;
- 63 peer entries: 33 third-party and 30 internal, split into 18 optional and 45 required entries;
- six private root workspaces;
- six `packages/*` roadmap directories with no manifest; and
- one implemented release model with an eight-package cohesive core, 28 independent integrations, and two independent tooling packages.

The release groups below are a policy decision over that measured inventory. Existing common versions are evidence of the starting state, not justification for keeping every package lockstep.

```

### 3. scripts/release/SPEC.md — §1 dated Vercel compatibility probe

Original source: `scripts/release/SPEC.md` at `271a731e32be377343fe279070050d7ee6bd55a2`. SHA-256: `27b6ba68c6498223bc78a2780acbf6aac24d0854d67e6bff74557ddbbc38845a`.

```text
For the disputed Vercel floor, the #746 probe packed `@zmdb/sql`, `@zmdb/schema`, `@zmdb/ai`, and `@zmdb/ai/vercel`, installed those four tarballs with exact `ai@7.0.93`, `zod@4.5.4`,
`typescript@7.0.2`, and `@types/node@26.4.1` through npm 12.0.2 on Node 26.8.1. It resolved both `ai` and `@zmdb/ai/vercel` from the temporary consumer's `node_modules`. Strict usage with
`exactOptionalPropertyTypes: true` and the documented `skipLibCheck: true` typechecked; runtime reported adapter version `1.0.0-alpha.4`, AI SDK version `7.0.93`, keys `description`, `execute`, and
`inputSchema`, and result `packed-7.0.93`.

The earlier `skipLibCheck: false` attempt reached errors inside `@ai-sdk/provider-utils` declarations, including a missing `Buffer` ambient and `exactOptionalPropertyTypes`-incompatible generic
constraints. The successful proof therefore matches the documented consumer configuration; it is not a claim that the upstream declaration graph is clean under `skipLibCheck: false`. Neither result
justifies advertising an older floor. The supported and tested zmdb floor is **AI SDK 7.0.93**.

```
