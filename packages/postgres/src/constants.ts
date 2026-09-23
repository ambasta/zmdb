// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type DialectTypeMap } from '@zmdb/sql';

export const POSTGRES_TYPES: DialectTypeMap = Object.freeze({
  serial: 'SERIAL',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  numeric: 'NUMERIC',
  text: 'TEXT',
  varchar: 'VARCHAR',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMPTZ',
  json: 'JSONB',
  jsonEnum: 'TEXT',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  decimal: 'decimal',
  blob: 'bytea',
});
