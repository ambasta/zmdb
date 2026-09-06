# Packed SvelteKit adapter fixture

`packages/sveltekit/src/packed.spec.ts` copies this application outside the workspace and installs publish-ready tarballs for `@zmdb/client`, `@zmdb/svelte`, and `@zmdb/sveltekit`.

The fixture:

- typechecks the installed `./client` and `./server` declarations through a generated SvelteKit project;
- builds real server and browser graphs with SvelteKit 2.70.3 and Svelte 5.57.0;
- starts the adapter-node handler and renders concurrent requests with distinct allow-listed headers and cookies;
- verifies native redirects and status errors;
- executes the installed browser load and navigation-cancellation helpers; and
- bundles only `@zmdb/sveltekit/client` for the browser and refuses server-only forwarding code in that graph.

SvelteKit 2.70.3 advertises an optional TypeScript peer only through 6.x. The fixture's `.npmrc` permits that known metadata mismatch while the commands still run the repository's TypeScript 7.0.2
compiler for sync, declaration typechecking, and the production build.
