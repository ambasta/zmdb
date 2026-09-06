import { join } from 'node:path';

import { loadConfig, runBuild } from 'metro';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'fixtures', 'consumer-metro');

describe('@zmdb/react-native Metro consumer', () => {
  it('Metro consumer bundles without Node built-ins', async () => {
    const config = await loadConfig({
      config: join(FIXTURE, 'metro.native.config.js'),
      cwd: FIXTURE,
    });
    const bundle = await runBuild(config, {
      entry: 'src/native.ts',
      dev: false,
      minify: false,
      platform: 'ios',
    });

    expect(bundle.code).toContain('__ZMDB_REACT_NATIVE_BINDING__');
    expect(bundle.code).not.toMatch(
      /\bnode:(?:assert|buffer|child_process|crypto|events|fs|http|https|module|net|os|path|process|stream|tls|url|util|vm|worker_threads|zlib)\b/,
    );
    expect(bundle.code).not.toContain('@react-native-async-storage/async-storage');
    expect(bundle.code).not.toContain('@react-native-community/netinfo');
    expect(bundle.code).not.toContain('expo-secure-store');
    expect(bundle.code).not.toContain('react-native-keychain');
  }, 180_000);
});
