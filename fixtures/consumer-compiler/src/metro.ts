import { withZmdb } from '@zmdb/compiler/metro';
import type { MetroConfig } from 'metro';

declare const config: MetroConfig;
export const wrapped: MetroConfig = withZmdb(config, { workerCount: 1 });
