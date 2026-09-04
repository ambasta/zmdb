// Oxlint loads JS plugins before the packages are built. Register the repository's source
// resolver first, then import the same TypeScript entry consumers receive from the published
// `@zmdb/aot-validator/lint` subpath.
import './ts-specifier-hook.mjs';

const module = await import('../packages/aot-validator/src/lint/index.ts');

export default module.default;
