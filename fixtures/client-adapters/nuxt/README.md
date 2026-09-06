# Packed Nuxt acceptance fixture

This fixture is copied into a temporary project by `packages/nuxt/src/packed-consumer.spec.ts`. The project installs packed `@zmdb/client`, `@zmdb/vue`, and `@zmdb/nuxt` tarballs plus Nuxt 4.5.2,
then:

1. builds a real Nuxt/Nitro application through the published module entry;
2. renders two concurrent SSR requests with different authorization headers and cookies;
3. proves the internal generated-client requests received only the configured credentials;
4. verifies the rendered HTML carries Nuxt's native payload and each request's isolated result; and
5. compiles and runs a separate packed client-plugin probe whose generated client uses the browser transport.

The fixture has no workspace path mapping and does not import repository source.
