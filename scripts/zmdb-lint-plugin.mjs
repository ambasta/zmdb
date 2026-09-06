// Oxlint loads JS plugins before the packages are built. Register the repository's source
// resolver first, then import the same TypeScript entry consumers receive from the published
// `@zmdb/compiler/lint` subpath.
import './ts-specifier-hook.mjs';

const module = await import('../packages/compiler/src/lint/index.js');

export default module.default;
