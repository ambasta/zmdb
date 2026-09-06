import {
  quoteColumn,
  quoteIdentifier,
  quoteTable,
  UnsupportedFeatureError,
  type DialectCompiler,
  type DialectReturningColumn,
  type DialectReturningContext,
  type DialectUpsertContext,
} from '@zmdb/query-compiler';

function outputColumn(
  context: DialectReturningContext,
  pseudoTable: 'INSERTED' | 'DELETED',
  column: DialectReturningColumn,
): string {
  if (typeof column === 'string') {
    return column === '*' ? `${pseudoTable}.*` : `${pseudoTable}.${quoteColumn(context.dialect, column)}`;
  }
  return (
    `${pseudoTable}.${quoteColumn(context.dialect, column.column)} AS ` + quoteIdentifier(context.dialect, column.alias)
  );
}

function returning(context: DialectReturningContext) {
  const pseudoTable = context.row === 'old' ? 'DELETED' : 'INSERTED';
  // SQL Server rejects OUTPUT without INTO when the target has an enabled
  // trigger for the statement's DML action. OUTPUT INTO would require a table
  // variable plus a second statement, outside the one-statement compiler contract.
  return Object.freeze({
    inline: ` OUTPUT ${context.columns.map(column => outputColumn(context, pseudoTable, column)).join(', ')}`,
    suffix: '',
  });
}

function upsert(context: DialectUpsertContext): string {
  const target = context.conflict.target;
  if (target === undefined || target.length === 0) {
    throw new UnsupportedFeatureError(
      'upsert without a conflict target',
      context.dialect.name,
      'MERGE needs an explicit join predicate; pass the conflicting column(s) to onConflict(...).',
    );
  }

  const keySet = new Set(context.columns);
  for (const column of target) {
    if (!keySet.has(column)) {
      throw new TypeError(`MERGE conflict target ${JSON.stringify(column)} is not present in values()`);
    }
  }

  const quoted = (column: string) => quoteIdentifier(context.dialect, column);
  const source = (column: string) => `src.${quoted(column)}`;
  const current = (column: string) => `tgt.${quoted(column)}`;
  const sourceColumns = context.columns.map(quoted).join(', ');
  const predicate = target.map(column => `${current(column)} = ${source(column)}`).join(' AND ');
  let matched = '';

  if (context.conflict.action === 'update') {
    let setSql: string;
    if (Array.isArray(context.conflict.updateFields)) {
      for (const column of context.conflict.updateFields) {
        if (!keySet.has(column)) {
          throw new TypeError(`MERGE update field ${JSON.stringify(column)} is not present in values()`);
        }
      }
      setSql = context.conflict.updateFields.map(column => `${quoted(column)} = ${source(column)}`).join(', ');
    } else if (context.conflict.updateFields !== undefined) {
      const entries = Object.entries(context.conflict.updateFields);
      if (entries.length === 0) throw new TypeError('MERGE doUpdate() requires at least one update field');
      setSql = entries
        .map(([column, value]) => {
          if (context.isProposedValue(value) && !keySet.has(column)) {
            throw new TypeError(`MERGE proposed field ${JSON.stringify(column)} is not present in values()`);
          }
          return (
            `${quoted(column)} = ` +
            context.renderUpdateValue(column, value, {
              current: current(column),
              proposed: source(column),
            })
          );
        })
        .join(', ');
    } else {
      const targetSet = new Set(target);
      const nonTarget = context.columns.filter(column => !targetSet.has(column));
      const updateColumns = nonTarget.length > 0 ? nonTarget : context.columns;
      setSql = updateColumns.map(column => `${quoted(column)} = ${source(column)}`).join(', ');
    }
    matched = ` WHEN MATCHED THEN UPDATE SET ${setSql}`;
  }

  // HOLDLOCK supplies the serializable range lock that prevents concurrent
  // upserts from both observing an absent key and racing into INSERT.
  return (
    `MERGE ${quoteTable(context.dialect, context.table)} WITH (HOLDLOCK) AS tgt ` +
    `USING (VALUES (${context.placeholders.join(', ')})) AS src (${sourceColumns}) ON ${predicate}` +
    matched +
    ` WHEN NOT MATCHED THEN INSERT (${sourceColumns}) VALUES (${context.columns.map(source).join(', ')})` +
    `${context.returning.inline};`
  );
}

export const mssqlCompiler: DialectCompiler = Object.freeze({
  returning,
  upsert,
});
