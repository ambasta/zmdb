// #44 — migration runner + version tracking. Applies/rolls back ordered
// migrations against a minimal connection, recording applied versions in a
// _zmdb_migrations table. The CLI (below) is a thin wrapper over this.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string; // SQL
  readonly down: string; // SQL
}

// Minimal synchronous connection the runner needs (node:sqlite-compatible).
export interface MigrationConnection {
  exec(sql: string): void;
  appliedVersions(): readonly number[];
  recordApplied(version: number, name: string): void;
  recordReverted(version: number): void;
}

const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

export interface MigrationStatus {
  readonly version: number;
  readonly name: string;
  readonly applied: boolean;
}

export function ensureVersionTable(conn: MigrationConnection): void {
  conn.exec(VERSION_TABLE);
}

// Apply all pending migrations (version > max applied), in order.
export function up(conn: MigrationConnection, migrations: readonly Migration[]): number[] {
  ensureVersionTable(conn);
  const applied = new Set(conn.appliedVersions());
  const pending = [...migrations].filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  const done: number[] = [];
  for (const m of pending) {
    conn.exec(m.up);
    conn.recordApplied(m.version, m.name);
    done.push(m.version);
  }
  return done;
}

// Roll back the single most-recently applied migration.
export function down(conn: MigrationConnection, migrations: readonly Migration[]): number | undefined {
  ensureVersionTable(conn);
  const applied = [...conn.appliedVersions()].sort((a, b) => b - a);
  const latest = applied[0];
  if (latest === undefined) return undefined;
  const m = migrations.find((x) => x.version === latest);
  if (!m) throw new Error(`no migration definition for applied version ${latest}`);
  conn.exec(m.down);
  conn.recordReverted(latest);
  return latest;
}

export function status(conn: MigrationConnection, migrations: readonly Migration[]): MigrationStatus[] {
  ensureVersionTable(conn);
  const applied = new Set(conn.appliedVersions());
  return [...migrations]
    .sort((a, b) => a.version - b.version)
    .map((m) => ({ version: m.version, name: m.name, applied: applied.has(m.version) }));
}

// Thin CLI dispatch (verb → runner call). Returns a human-readable line.
export function runCli(
  verb: 'up' | 'down' | 'status',
  conn: MigrationConnection,
  migrations: readonly Migration[],
): string {
  switch (verb) {
    case 'up':
      return `applied: ${up(conn, migrations).join(', ') || '(none)'}`;
    case 'down': {
      const v = down(conn, migrations);
      return v === undefined ? 'nothing to roll back' : `reverted: ${v}`;
    }
    case 'status':
      return status(conn, migrations)
        .map((s) => `${s.applied ? '[x]' : '[ ]'} ${s.version} ${s.name}`)
        .join('\n');
  }
}
