# `@zmdb/singlestore`

SingleStore support for zmdb, implemented as a one-way child of the public `@zmdb/mysql` family surface.

```ts
import { singlestore, singlestoreDriver } from '@zmdb/singlestore';
import { createQueryCompiler } from '@zmdb/query-compiler';
import mysql2 from 'mysql2/promise';

const pool = mysql2.createPool(process.env.SINGLESTORE_URL!);
const compiler = createQueryCompiler(singlestore);
const driver = singlestoreDriver(pool);

await driver.execute(compiler.selectFrom('users').compile());
```

The child inherits MySQL placeholders, quoting, DML, connection pinning, ordinary DDL, and catalog parsing. It owns the differences that cannot safely fall through:

- `serial` emits `BIGINT AUTO_INCREMENT`;
- `timestamp` emits server-supported `DATETIME(6)` rather than inherited MySQL `DATETIME(3)`;
- full-text matching emits `MATCH(column) AGAINST(?)` without MySQL's unsupported natural-language-mode suffix;
- every generated table explicitly declares a shard key or rowstore storage;
- shard keys, sort keys, and rowstore storage round-trip through snapshots, DDL, and the SingleStore catalog;
- foreign keys, incompatible unique keys, storage-dependent explicit index methods, check constraints, sort keys on rowstore tables, storage transitions, and MySQL routine declarations are refused
  before execution; and
- the official structural adapter binds mysql2-compatible clients to the immutable `singlestore` dialect object.

The required qualification path uses the official SingleStore Dev Image and a packed consumer. `mysql2` remains consumer-selected and optional.
