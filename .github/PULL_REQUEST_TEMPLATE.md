## What this changes

<!-- The behaviour before and after, in a sentence or two. Link the issue this closes, if there is one. -->

## Why

<!-- The problem it solves. If the design was a choice between alternatives, say which ones you rejected and why — that is what a reviewer needs and it is what a future ADR will quote. -->

## Checks run

<!-- Paste or tick what you actually ran. See CONTRIBUTING.md. Unrelated failures are worth mentioning too. -->

- [ ] `yarn lint`
- [ ] `yarn fmt:check`
- [ ] `yarn typecheck`
- [ ] `yarn test`
- [ ] `yarn build`
- [ ] Documentation changed: `node docs-site/generated.mjs`, `yarn build:docs`, and `yarn vitest run --project unit docs-site/build.spec.ts docs-site/shell.spec.ts`
- [ ] New source files: `node scripts/license-headers.mjs` and `yarn verify:license-headers`

## Contract and history

- [ ] The owning `SPEC.md` matches this change, or did not need to.
- [ ] A behaviour change that supersedes a documented decision is recorded in the [ADR index](../docs/adr/index.md).
- [ ] The public API changed — say so here, since consumers read the changelog and not the diff.

## Sign-off

Contributions are accepted under the Developer Certificate of Origin, so **every commit needs a `Signed-off-by` line**:

```bash
git commit --signoff
```

If you forgot, `git rebase --signoff main` fixes the whole branch. The DCO line certifies you wrote the change or have the right to submit it under [MPL-2.0](../LICENSE); do not include code from a
project whose license you have not checked.
