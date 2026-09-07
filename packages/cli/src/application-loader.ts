import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ModuleClass } from '@zmdb/app/modules';

import { CliInvocationError } from './errors.js';

let applicationLoader: Promise<void> | undefined;

export function requireOptionalPeer(name: '@zmdb/app' | '@zmdb/web' | 'esbuild'): void {
  try {
    import.meta.resolve(name);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
      throw new CliInvocationError(`this command requires ${name}; install ${name}`);
    }
    throw error;
  }
}

export async function loadRootModule(moduleSpec: string, cwd: string): Promise<ModuleClass> {
  const hash = moduleSpec.lastIndexOf('#');
  if (hash <= 0 || hash === moduleSpec.length - 1) {
    throw new CliInvocationError(`module spec "${moduleSpec}" must be <path>#<export>`);
  }
  const namedPath = moduleSpec.slice(0, hash);
  const exportName = moduleSpec.slice(hash + 1);
  const file = resolve(cwd, namedPath);
  if (!existsSync(file)) {
    throw new CliInvocationError(`module path "${namedPath}" does not exist; cannot load export "${exportName}"`);
  }

  requireOptionalPeer('esbuild');
  await installApplicationLoader();
  let loaded: object;
  try {
    const candidate: unknown = await import(pathToFileURL(file).href);
    if (typeof candidate !== 'object' || candidate === null) {
      throw new Error(`module path "${namedPath}" did not load as a module record`);
    }
    loaded = candidate;
  } catch (error) {
    throw new CliInvocationError(
      `could not import module path "${namedPath}" for export "${exportName}": ${errorMessage(error)}`,
    );
  }
  const root: unknown = Reflect.get(loaded, exportName);
  if (!isModuleClass(root)) {
    throw new CliInvocationError(`module path "${namedPath}" has no class export "${exportName}"`);
  }
  return root;
}

/**
 * Lower Stage-3 decorators while importing application TypeScript.
 *
 * Node 26 strips types but does not parse standard decorator syntax. The hook
 * applies the same esbuild transform used by the repository's Vitest setup, and
 * only after the CLI command asks to import application source.
 */
async function installApplicationLoader(): Promise<void> {
  applicationLoader ??= import('esbuild').then(({ transformSync }) => {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL !== undefined && /^\.{1,2}\/.*\.js$/.test(specifier)) {
          const asJavaScript = new URL(specifier, context.parentURL);
          if (!existsSync(fileURLToPath(asJavaScript))) {
            const asTypeScript = new URL(`${specifier.slice(0, -'.js'.length)}.ts`, context.parentURL);
            if (existsSync(fileURLToPath(asTypeScript))) {
              return { url: asTypeScript.href, shortCircuit: true };
            }
          }
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (!url.startsWith('file:') || !/\.[cm]?tsx?$/.test(new URL(url).pathname)) {
          return nextLoad(url, context);
        }
        const file = fileURLToPath(url);
        const transformed = transformSync(readFileSync(file, 'utf8'), {
          loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
          format: 'esm',
          target: 'es2022',
          sourcefile: file,
          sourcemap: 'inline',
          tsconfigRaw: {
            compilerOptions: {
              experimentalDecorators: false,
              useDefineForClassFields: true,
            },
          },
        });
        return { format: 'module', source: transformed.code, shortCircuit: true };
      },
    });
  });
  await applicationLoader;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function isModuleClass(value: unknown): value is ModuleClass {
  return typeof value === 'function';
}
