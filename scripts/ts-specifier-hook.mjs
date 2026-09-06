// Teaches plain `node` the one resolution rule this repository's sources rely on: a relative
// specifier written `./x.js` may name `./x.ts`.
//
// Every source file here imports its siblings with a `.js` extension, which is what TypeScript
// asks for under `moduleResolution: NodeNext` with `allowImportingTsExtensions: false`. `tsc` and
// vitest both understand that a `.js` specifier in a `.ts` file means the `.ts` file; Node does
// not, and there is no flag that makes it. Since the packages ship their sources — every
// `exports` map points at `./src/**.ts` and Node strips the types — anything that runs the
// sources under plain `node` needs this hook or it fails with `ERR_MODULE_NOT_FOUND` on the
// first internal import.
//
// Register it with `node --import ./scripts/ts-specifier-hook.mjs <entry>`. The scripts in
// `package.json` that load repository sources do exactly that, and `.github/workflows` inherits
// it through them.
//
// The rewrite is deliberately narrow. It fires only when the `.ts` sibling exists *and* the
// `.js` one does not, so a specifier naming a real `.js` file — `packages/web/dist/index.js`, a
// `*.zmdb.generated.js` emitted next to its source — still resolves to that file. `format` is
// left for Node to infer from the extension and the nearest `package.json`, rather than asserted
// here.

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RELATIVE_JS = /^\.{1,2}\/.*\.js$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL !== undefined && RELATIVE_JS.test(specifier)) {
      const asJs = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(asJs))) {
        const asMjs = new URL(`${specifier.slice(0, -'.js'.length)}.mjs`, context.parentURL);
        if (existsSync(fileURLToPath(asMjs))) return { url: asMjs.href, shortCircuit: true };
        const asTs = new URL(`${specifier.slice(0, -'.js'.length)}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(asTs))) return { url: asTs.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
