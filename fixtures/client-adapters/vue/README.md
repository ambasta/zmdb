# Packed Vue adapter consumer

This private fixture qualifies `@zmdb/vue` from the installed-package side of the boundary.

- `src/browser.ts` installs the plugin on a real Vue application, runs a query in an effect scope, and is bundled for the browser.
- `src/ssr.ts` creates concurrent SSR applications with different clients and verifies that their credentials remain isolated.
- `packages/vue/src/packed-consumer.spec.ts` builds and packs `@zmdb/client` and `@zmdb/vue`, installs only the tarballs and pinned Vue peer in a temporary project, typechecks the fixture, runs both
  entries, and executes the 11 shared adapter conformance cases.

The fixture has no workspace path mapping and is not published.
