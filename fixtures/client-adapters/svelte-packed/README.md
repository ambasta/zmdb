# Packed Svelte adapter fixture

This fixture is copied into a clean application by `packages/svelte/src/packed.spec.ts`. The test packs publish-ready `@zmdb/client` and `@zmdb/svelte` tarballs, installs Svelte 5.57.0, then:

- typechecks generated-client inference against the installed declarations;
- compiles the same component sources for Svelte browser and server targets;
- bundles the browser target with esbuild; and
- renders two server component trees with distinct clients.

The application is outside the workspace and rejects symlinked package installs through the shared `runPackedProject` helper.
