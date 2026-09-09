// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/di — curated dependency-injection facade.
export { Container, Inject, UnresolvedTokenError, createToken, injectionsOf } from '@zmdb/app/di';
export type { Constructor, Scope, Token } from '@zmdb/app/di';
