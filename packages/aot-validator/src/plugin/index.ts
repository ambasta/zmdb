import { transformCode } from '../transformer.ts';

export function transformTypeChecks(code: string): string {
  return transformCode(code);
}

// unplugin-compatible plugin factory. The `transform` hook inlines
// validator calls in source modules via transformCode. Shape is
// what unplugin/vite/esbuild/rollup expect: { name, transform(code, id) }.
// For ts-patch/ttypescript, use the program transformer (createTransformer, #81
// follow-up) via tsconfig "plugins"; this hook covers the bundler path.
export interface UnpluginLike {
  readonly name: string;
  transform(code: string, id: string): { code: string } | null;
}

export function zmdbAot(): UnpluginLike {
  return {
    name: 'zmdb-aot',
    transform(code: string, id: string): { code: string } | null {
      // Only source modules; never touch dependencies or declaration files.
      if (id.includes('node_modules')) return null;
      if (!/\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(id)) return null;
      const out = transformCode(code);
      return out === code ? null : { code: out };
    },
  };
}
