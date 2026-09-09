// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Product-level test application and compiler-backed schema helpers.

export { schemaIrsFrom, schemasFrom, schemasFromFiles } from '@zmdb/compiler/testing';
export type { SchemasFromFilesOptions, SchemasFromOptions } from '@zmdb/compiler/testing';

export { createTestApp } from '@zmdb/web/testing';
export type { TestApp, TestAppOptions } from '@zmdb/web/testing';
