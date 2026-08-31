// Types for ./build, which is esbuild output and therefore has none of its own.
//
// This sits beside the build directory rather than inside it, so `rimraf
// cases/zmdb/build` cannot delete it. TypeScript resolves `./build` to this file
// (a `.d.ts` sibling is tried before the directory), while Node resolves the
// same specifier to build/index.js at runtime.
//
// Emitting these with `tsc --emitDeclarationOnly` from the participant source
// would drag this repository's whole type graph into the upstream clone's
// compile; the surface is four functions, so it is written out instead.
export declare function looseIs(data: unknown): boolean;
export declare function strictEquals(data: unknown): boolean;
export declare function parseSafe(data: unknown): unknown;
export declare function parseStrict(data: unknown): unknown;
