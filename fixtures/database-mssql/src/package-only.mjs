import assert from 'node:assert/strict';

import { mssql, mssqlIntrospector, mssqlVertical } from '@zmdb/mssql';

assert.equal(mssql.name, 'mssql');
assert.equal(mssql.introspector, mssqlIntrospector);
assert.equal(mssqlVertical.dialect, mssql);
assert.equal(mssql.capabilities.streaming, false);
assert.equal(mssql.capabilities.cancellation, false);

console.log('@zmdb/mssql imports without a SQL Server client');
