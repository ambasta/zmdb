export function compileMssqlStatement(dialect: string): string {
  if (dialect === 'mssql') return 'MERGE widgets WITH (HOLDLOCK) AS target';
  return 'SELECT * FROM widgets';
}
