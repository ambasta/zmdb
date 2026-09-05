The generated matrix below reports support in the current release. It does not turn a frozen design or open implementation issue into shipped code.

`documented` means a repository-backed recipe exists over current public packages. `not-planned` means this release has no official framework adapter; use the generated HTTP client through the
framework's ordinary request and lifecycle primitives.

<!-- generated: integrations framework-integrations -->

| Framework    | Status      | Public package      | Optional peer | Documentation                                           | Repository evidence                                                                             |
| ------------ | ----------- | ------------------- | ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Angular      | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Next.js      | documented  | @zmdb/repository    | —             | [deploy-nextjs](./deploy-nextjs.html)                   | `packages/repository/src/repository.spec.ts`<br>`packages/zmdb/src/client-integrations/SPEC.md` |
| Nuxt         | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| React        | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| React Native | documented  | @zmdb/aot-validator | —             | [connect-react-native](./connect-react-native.html)     | `packages/aot-validator/src/plugin/metro.spec.ts`<br>`fixtures/consumer-metro`                  |
| Solid        | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Svelte       | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| SvelteKit    | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |
| Vue          | not-planned | —                   | —             | [framework-integrations](./framework-integrations.html) | `packages/zmdb/src/client-integrations/SPEC.md`                                                 |

<!-- /generated: integrations framework-integrations -->

The dedicated client-adapter packages described by the frozen architecture contract do not exist in this checkout. React Native and Next.js remain documented because their current recipes use shipped
package boundaries without claiming those future adapters.
