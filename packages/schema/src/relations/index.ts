import { type SchemaIR } from '../ir/index.js';

export interface ResolvedRelation {
  readonly name: string;
  /** Where the related rows live. */
  readonly targetTable: string;
  /** Ordered columns on the declaring table whose values the join matches. */
  readonly parentKey: readonly string[];
  /** Ordered columns on the target table, positionally paired with `parentKey`. */
  readonly targetKey: readonly string[];
  /** `true` for `oneToMany`: the relation attaches an array, empty where nothing matched. */
  readonly toMany: boolean;
}

/**
 * Resolve one relation of a table by name.
 *
 * Throws for a name the type does not declare — naming the ones it does, because a
 * misspelled `populate` is the common case — and for `manyToMany`, whose `via` is a join
 * table rather than a column: two hops cannot be expressed as one `IN`, and guessing the
 * join table's two foreign keys from the table names either side is how a wrong query gets
 * built quietly.
 */
export function resolveRelation(ir: SchemaIR, name: string): ResolvedRelation {
  const declared = ir.relations;
  const rel = declared.find(candidate => candidate.name === name);
  if (!rel) {
    const known = declared.map(candidate => candidate.name);
    throw new Error(
      `unknown relation "${name}" on ${ir.table}: ` +
        (known.length > 0 ? `the type declares ${known.join(', ')}` : 'the type declares none'),
    );
  }
  if (rel.relation === 'manyToMany') {
    throw new Error(
      `relation "${name}" on ${ir.table} is many-to-many through "${rel.via}", which populate ` +
        'does not resolve — join the two tables explicitly',
    );
  }
  if (rel.relation === 'oneToMany') {
    // The inverse side: the foreign key is a column of the *target*, holding this row's key.
    return inverseRelation(ir, name, rel, true);
  }
  const via = relationColumns(ir, name, rel.via);
  if (rel.relation === 'oneToOne' && !via.every(column => ir.columns.some(candidate => candidate.name === column))) {
    // A one-to-one pair is symmetric, so `OneToOne<'profiles', 'userId'>` does not say which
    // of the two tables holds the key — and the answer is "the one with the column". Declared
    // on `users`, which has no `userId`, it is the inverse side, joined from the primary key
    // exactly as a to-many is; it just cannot match twice.
    return inverseRelation(ir, name, rel, false);
  }
  // The owning side: this row holds the foreign key, and the column it points at is written
  // down on that column, as `References<'users.id'>`.
  return {
    name,
    targetTable: rel.target,
    parentKey: via,
    targetKey: via.map(column => referencedColumn(ir, name, rel.target, column, via.length > 1)),
    toMany: false,
  };
}

function relationColumns(ir: SchemaIR, relation: string, via: string): readonly string[] {
  const columns = via.split(',').map(column => column.trim());
  if (columns.some(column => column.length === 0)) {
    throw new Error(`${ir.table}.${relation}: relation via "${via}" contains an empty column name`);
  }
  return columns;
}

/** The column a foreign key points at, per its `References<'table.column'>`; `id` without one. */
function referencedColumn(
  ir: SchemaIR,
  relation: string,
  target: string,
  fk: string,
  requireReference: boolean,
): string {
  const reference = ir.columns.find(col => col.name === fk)?.references;
  const separator = reference?.lastIndexOf('.') ?? -1;
  if (reference !== undefined && separator > 0 && separator < reference.length - 1) {
    return reference.slice(separator + 1);
  }
  if (requireReference) {
    throw new Error(
      `${ir.table}.${relation}: composite relation via column "${fk}" must carry ` +
        `References<'${target}.column'>; every via column must name its target`,
    );
  }
  return 'id';
}

function primaryKeyOf(ir: SchemaIR): readonly string[] {
  if (ir.primaryKey.length === 0) {
    throw new Error(`schema ${ir.table} has no primary key, so its relations have nothing to join from`);
  }
  return ir.primaryKey;
}

function relationTag(relation: 'manyToOne' | 'oneToMany' | 'oneToOne'): string {
  switch (relation) {
    case 'manyToOne':
      return 'ManyToOne';
    case 'oneToMany':
      return 'OneToMany';
    case 'oneToOne':
      return 'OneToOne';
  }
}

function inverseRelation(
  ir: SchemaIR,
  name: string,
  rel: SchemaIR['relations'][number],
  toMany: boolean,
): ResolvedRelation {
  if (rel.relation !== 'oneToMany' && rel.relation !== 'oneToOne') {
    throw new Error(`${ir.table}.${name}: ${rel.relation} is not an inverse relation`);
  }
  const parentKey = primaryKeyOf(ir);
  const targetKey = relationColumns(ir, name, rel.via);
  if (parentKey.length !== targetKey.length) {
    const tag = relationTag(rel.relation);
    const missing = Math.max(0, parentKey.length - targetKey.length);
    const suggestedVia = [...parentKey.slice(0, missing), ...targetKey].join(',');
    const targetLabel = targetKey.length === 1 ? 'column' : 'columns';
    throw new Error(
      `${ir.table}.${name}: ${tag}<'${rel.target}', '${rel.via}'> supplies ${String(targetKey.length)} target ` +
        `${targetLabel} for a ${String(parentKey.length)}-column parent key (${parentKey.join(', ')}); ` +
        `name every column, in key order — ${tag}<'${rel.target}', '${suggestedVia}'>`,
    );
  }
  return { name, targetTable: rel.target, parentKey, targetKey, toMany };
}
