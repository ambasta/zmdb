// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createZmdbReact } from '@zmdb/client/react';
import { createZmdbNextClient } from '@zmdb/next/client';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SERVER_MARKER = "import 'server-only'";

describe('@zmdb/next browser boundary', () => {
  it('browser import cannot reach server-only credentials', async () => {
    expect(createZmdbNextClient).toBe(createZmdbReact);

    const bundled = await build({
      stdin: {
        contents:
          "import { createZmdbNextClient } from '@zmdb/next/client';\n" +
          "export const bindings = createZmdbNextClient('BrowserProbe');\n",
        resolveDir: ROOT,
        sourcefile: 'next-browser-probe.ts',
      },
      bundle: true,
      conditions: ['browser', 'import', 'default'],
      format: 'esm',
      logLevel: 'silent',
      metafile: true,
      platform: 'browser',
      write: false,
    });
    const inputs = Object.keys(bundled.metafile.inputs);
    expect(inputs.some(path => path.includes('packages/next/src/server'))).toBe(false);
    expect(inputs.some(path => path.includes('server-only'))).toBe(false);
    expect(bundled.outputFiles[0]?.text).not.toContain(SERVER_MARKER);

    const sourceHook = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
    const expression = "await import('@zmdb/next/server')";
    const guarded = spawnSync(process.execPath, ['--import', sourceHook, '--input-type=module', '--eval', expression], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(guarded.status).not.toBe(0);
    expect(guarded.stderr).toContain('This module cannot be imported from a Client Component module');

    const server = spawnSync(
      process.execPath,
      ['--conditions=react-server', '--import', sourceHook, '--input-type=module', '--eval', expression],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(server).toMatchObject({ status: 0, stderr: '' });
  });
});
