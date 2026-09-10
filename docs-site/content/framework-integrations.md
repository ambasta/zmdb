Generate one client from the server contract, then consume that same module everywhere: server handlers, browser applications, SSR requests, hydration, and native devices. Framework packages do not
generate a second client and do not reimplement HTTP behavior.

The [generated HTTP client](./generated-client.html) and `@zmdb/client` own URL construction, transport, authentication patches, request/response validation, stable errors, and cancellation signals.
Framework adapters own only the framework boundary:

- base adapters own DI/context, reactive query/mutation state, and framework lifecycle cleanup;
- React Native additionally owns AppState/connectivity policy and injected credential-store ports;
- meta-framework adapters own request-local fetch/credentials, SSR isolation, hydration, and server/browser separation.

## Official packages

The generated matrix below reports support in the current release. `optional` means the package is installed only by applications using that framework.

<!-- generated: integrations framework-integrations -->

| Framework    | Status   | Import entry              | Published package | Framework peers            | Documentation                                     | Repository evidence                                                                                                                                                                                                                                                          |
| ------------ | -------- | ------------------------- | ----------------- | -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Angular      | optional | @zmdb/client/angular      | @zmdb/client      | @angular/core<br>rxjs      | [client-angular](./client-angular.html)           | `packages/client/src/angular/index.spec.ts`<br>`packages/client/src/angular/index.type-test.ts`<br>`packages/client/src/angular/packed-consumer.spec.ts`<br>`fixtures/client-adapters/angular`                                                                               |
| Next.js      | optional | @zmdb/next                | @zmdb/next        | next<br>react<br>react-dom | [client-next](./client-next.html)                 | `packages/next/src/client.spec.ts`<br>`packages/next/src/server.spec.ts`<br>`packages/next/src/packed-consumer.spec.ts`<br>`fixtures/next-app-router`                                                                                                                        |
| Nuxt         | optional | @zmdb/nuxt                | @zmdb/nuxt        | nuxt<br>vue                | [client-nuxt](./client-nuxt.html)                 | `packages/nuxt/src/client/client.spec.ts`<br>`packages/nuxt/src/server/server.spec.ts`<br>`packages/nuxt/src/packed-consumer.spec.ts`<br>`fixtures/client-adapters/nuxt`                                                                                                     |
| React        | optional | @zmdb/client/react        | @zmdb/client      | react                      | [client-react](./client-react.html)               | `packages/client/src/react/react.spec.ts`<br>`packages/client/src/react/packed-consumer.spec.ts`<br>`fixtures/client-adapters`                                                                                                                                               |
| React Native | optional | @zmdb/client/react-native | @zmdb/client      | react<br>react-native      | [client-react-native](./client-react-native.html) | `packages/compiler/src/metro/metro.spec.ts`<br>`packages/client/src/react-native/index.spec.ts`<br>`packages/client/src/react-native/metro.spec.ts`<br>`packages/client/src/react-native/packed-consumer.spec.ts`<br>`fixtures/client-adapters`<br>`fixtures/consumer-metro` |
| Solid        | optional | @zmdb/client/solid        | @zmdb/client      | solid-js                   | [client-solid](./client-solid.html)               | `packages/client/src/solid/SPEC.md`<br>`packages/client/src/solid/solid.spec.ts`<br>`packages/client/src/solid/packed-consumer.spec.ts`<br>`fixtures/client-adapters/src/solid-binding.ts`                                                                                   |
| Svelte       | optional | @zmdb/client/svelte       | @zmdb/client      | svelte                     | [client-svelte](./client-svelte.html)             | `packages/client/src/svelte/SPEC.md`<br>`packages/client/src/svelte/svelte.spec.ts`<br>`packages/client/src/svelte/packed.spec.ts`<br>`fixtures/client-adapters/svelte-packed`                                                                                               |
| SvelteKit    | optional | @zmdb/sveltekit           | @zmdb/sveltekit   | @sveltejs/kit<br>svelte    | [client-sveltekit](./client-sveltekit.html)       | `packages/sveltekit/SPEC.md`<br>`packages/sveltekit/src/server.spec.ts`<br>`packages/sveltekit/src/client.spec.ts`<br>`fixtures/client-adapters/sveltekit-packed`                                                                                                            |
| Vue          | optional | @zmdb/client/vue          | @zmdb/client      | vue                        | [client-vue](./client-vue.html)                   | `packages/client/src/vue/index.spec.ts`<br>`packages/client/src/vue/index.type-test.ts`<br>`packages/client/src/vue/packed-consumer.spec.ts`<br>`fixtures/client-adapters/vue`                                                                                               |

<!-- /generated: integrations framework-integrations -->

## Support matrix

| Framework    | CSR    | SSR | Hydration       | Cancellation | Native lifecycle |
| ------------ | ------ | --- | --------------- | ------------ | ---------------- |
| React        | yes    | yes | framework-owned | yes          | no               |
| Angular      | yes    | yes | framework-owned | yes          | no               |
| Vue          | yes    | yes | framework-owned | yes          | no               |
| Svelte       | yes    | yes | framework-owned | yes          | no               |
| Solid        | yes    | yes | framework-owned | yes          | no               |
| React Native | native | no  | n/a             | yes          | yes              |
| Next.js      | yes    | yes | yes             | yes          | no               |
| Nuxt         | yes    | yes | yes             | yes          | no               |
| SvelteKit    | yes    | yes | yes             | yes          | no               |

“Framework-owned” means the base adapter is safe in independently created SSR application trees while the host framework decides how state is serialized and hydrated. Meta-framework packages have a
dedicated hydration contract. React Native is a device lifecycle rather than a browser/SSR lifecycle.

## Qualification and ownership

A framework receives a package only when zmdb must own a framework-specific DI, lifecycle, SSR/hydration, native, or build boundary. Each official package has source-level conformance checks and a
packed consumer that installs publish-shaped tarballs. All nine documentation examples compile in one external packed consumer against the same generated fixture client.

Choose the guide for the owning application:

- [React](./client-react.html)
- [Angular](./client-angular.html)
- [Vue](./client-vue.html)
- [Svelte](./client-svelte.html)
- [Solid](./client-solid.html)
- [React Native](./client-react-native.html)
- [Next.js](./client-next.html)
- [Nuxt](./client-nuxt.html)
- [SvelteKit](./client-sveltekit.html)

## Recipe-only integrations

Astro, Electron, Ember, Lit, Qwik, and Remix do not currently earn framework packages. Create the generated client at the framework's ordinary request or context boundary, pass its methods through the
framework's own lifecycle primitives, and forward cancellation signals to each operation. These are recipes, not package or conformance claims: there is no `@zmdb/astro`, `@zmdb/electron`,
`@zmdb/ember`, `@zmdb/lit`, `@zmdb/qwik`, or `@zmdb/remix` package.

Start from the [generated client contract](./generated-client.html), then follow the selected framework guide above. Server-side additions use the same [application lifecycle](./web-app.html);
[package reference](./package-reference.html) owns their current install and support rows.
