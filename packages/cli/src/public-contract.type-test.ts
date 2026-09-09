// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { runCli as facade } from '@zmdb/core/cli';

import { runCli, type CliEnvironment, type RollbackResult } from './index.js';
const options: CliEnvironment = {
  stdout(text) {
    process.stdout.write(text);
  },
};
const argv: readonly string[] = [];
const promise: Promise<number> = runCli(argv, options);
const identity: typeof runCli = facade;
export function versions(value: RollbackResult): readonly { readonly version: number; readonly name: string }[] {
  return value.versions;
}
void [promise, identity];
