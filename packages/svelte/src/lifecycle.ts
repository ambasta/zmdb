// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export function lifecycleAbort(message: string): Error {
  const reason = new Error(message);
  reason.name = 'AbortError';
  return reason;
}

export function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && Object.is(error, signal.reason);
}
