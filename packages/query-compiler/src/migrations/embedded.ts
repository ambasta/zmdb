export interface EmbeddedMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly checksum: string;
}

export interface EmbeddedConnection {
  /** May contain multiple statements; used for migration bodies and transaction control. */
  exec(sql: string): Promise<void>;
  /** Executes one parameterized statement; used for ledger writes. */
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  /** Executes one parameterized query; used for ledger inspection. */
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}

export type EmbeddedMigrationErrorKind = 'duplicate' | 'checksum' | 'ledger-ahead' | 'ledger-shape';

export class EmbeddedMigrationError extends Error {
  readonly kind: EmbeddedMigrationErrorKind;

  constructor(kind: EmbeddedMigrationErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbeddedMigrationError';
    this.kind = kind;
  }
}

interface LedgerRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string | null;
}

const LEDGER_TABLE = '_zmdb_migrations';
const CREATE_LEDGER = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT
)`;
const READ_LEDGER_COLUMNS = `SELECT name FROM pragma_table_info('${LEDGER_TABLE}') ORDER BY cid`;
const READ_LEDGER = `SELECT version, name, checksum FROM ${LEDGER_TABLE} ORDER BY version`;
const INSERT_LEDGER = `INSERT INTO ${LEDGER_TABLE} (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)`;

/**
 * Apply bundle-resident SQLite migrations without importing a compiler, driver,
 * filesystem API, or hashing implementation.
 */
export async function runEmbedded(
  connection: EmbeddedConnection,
  migrations: readonly EmbeddedMigration[],
): Promise<readonly number[]> {
  const ordered = validatedMigrations(migrations);
  await ensureLedger(connection);
  const ledger = await readLedger(connection);
  verifyLedger(ledger, ordered);

  const applied = new Set(ledger.map(row => row.version));
  const completed: number[] = [];
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    await applyMigration(connection, migration);
    completed.push(migration.version);
  }
  return completed;
}

function validatedMigrations(migrations: readonly EmbeddedMigration[]): readonly EmbeddedMigration[] {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version)) {
      throw new EmbeddedMigrationError(
        'ledger-shape',
        `embedded migration ${migration.name} version ${String(migration.version)} is not a safe integer`,
      );
    }
    if (seen.has(migration.version)) {
      throw new EmbeddedMigrationError(
        'duplicate',
        `embedded migration version ${String(migration.version)} appears more than once in the bundle`,
      );
    }
    seen.add(migration.version);
  }
  return migrations.toSorted((left, right) => left.version - right.version);
}

async function ensureLedger(connection: EmbeddedConnection): Promise<void> {
  const rows = await connection.rows(READ_LEDGER_COLUMNS, []);
  if (rows.length === 0) {
    await connection.exec(CREATE_LEDGER);
    return;
  }

  const columns = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const name = row.name;
    if (typeof name !== 'string') {
      throw new EmbeddedMigrationError(
        'ledger-shape',
        `migration ledger column ${String(index)} has a non-string name`,
      );
    }
    columns.add(name);
  }
  for (const required of ['version', 'name', 'applied_at']) {
    if (!columns.has(required)) {
      throw new EmbeddedMigrationError('ledger-shape', `migration ledger ${LEDGER_TABLE} has no ${required} column`);
    }
  }
  if (!columns.has('checksum')) {
    await connection.exec(`ALTER TABLE ${LEDGER_TABLE} ADD COLUMN checksum TEXT`);
  }
}

async function readLedger(connection: EmbeddedConnection): Promise<readonly LedgerRow[]> {
  const rows = await connection.rows(READ_LEDGER, []);
  const ledger: LedgerRow[] = [];
  const seen = new Set<number>();
  for (const [index, row] of rows.entries()) {
    const version = row.version;
    const name = row.name;
    const checksum = row.checksum;
    if (
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      typeof name !== 'string' ||
      (checksum !== null && typeof checksum !== 'string')
    ) {
      throw new EmbeddedMigrationError(
        'ledger-shape',
        `migration ledger row ${String(index)} has an invalid version, name, or checksum`,
      );
    }
    if (seen.has(version)) {
      throw new EmbeddedMigrationError(
        'ledger-shape',
        `migration ledger contains duplicate version ${String(version)}`,
      );
    }
    seen.add(version);
    ledger.push({ version, name, checksum });
  }
  return ledger;
}

function verifyLedger(ledger: readonly LedgerRow[], migrations: readonly EmbeddedMigration[]): void {
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  for (const row of ledger) {
    const migration = byVersion.get(row.version);
    if (migration === undefined || row.checksum === null) continue;
    if (migration.checksum !== row.checksum) {
      throw new EmbeddedMigrationError(
        'checksum',
        `embedded migration ${String(row.version)} ${migration.name} was edited after it was applied: ` +
          `ledger has ${row.checksum}, bundle has ${migration.checksum}`,
      );
    }
  }

  const unknown = ledger.find(row => !byVersion.has(row.version));
  if (unknown === undefined) return;
  const newest = migrations.at(-1)?.version;
  throw new EmbeddedMigrationError(
    'ledger-ahead',
    `migration ledger contains version ${String(unknown.version)} ${unknown.name}, which this bundle does not have; ` +
      `the app is older than the database and the newest bundled migration is ${newest === undefined ? 'none' : String(newest)}`,
  );
}

async function applyMigration(connection: EmbeddedConnection, migration: EmbeddedMigration): Promise<void> {
  await connection.exec('BEGIN');
  try {
    await connection.exec(migration.up);
    await connection.run(INSERT_LEDGER, [migration.version, migration.name, Date.now(), migration.checksum]);
    await connection.exec('COMMIT');
  } catch (error) {
    try {
      await connection.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `failed to apply embedded migration ${String(migration.version)} ${migration.name}, and rollback also failed`,
        { cause: rollbackError },
      );
    }
    throw new Error(`failed to apply embedded migration ${String(migration.version)} ${migration.name}`, {
      cause: error,
    });
  }
}
