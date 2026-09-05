import { issuesFor } from '@zmdb/aot-validator/utilities';
import type { Predicate } from '@zmdb/query-compiler';
import { isRecord, type CoreSchema, ValidationError } from '@zmdb/schema-core';
import { appTypeOf, type ColumnIR } from '@zmdb/schema-core/ir';

/** One compiler predicate contributed by a named repository filter. */
export interface FilterPredicate {
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR';
}

/**
 * A named predicate applied to repository reads unless it is disabled for one call.
 *
 * `table` is optional for the repository's own table and explicit for a join or
 * populate target. That keeps target filters scoped to this repository instance;
 * there is no process-global registry.
 */
export interface FilterDef<P = void> {
  readonly name: string;
  readonly table?: string;
  /** Required for a target table unless the read supplies that table's schema directly. */
  readonly schema?: CoreSchema<string>;
  readonly where: {
    bivarianceHack(params: P): readonly FilterPredicate[];
  }['bivarianceHack'];
  readonly enabled?: boolean;
  readonly appliesToWrites?: boolean;
}

export type FilterParams<F> = F extends { readonly where: (params: infer P) => readonly FilterPredicate[] } ? P : never;

export type FilterOverride<F> = [FilterParams<F>] extends [never]
  ? unknown | false
  : [FilterParams<F>] extends [void]
    ? false
    : FilterParams<F> | false;

export type FilterOverrides<Defs extends readonly FilterDef<unknown>[]> = {
  readonly [Def in Defs[number] as Def['name']]?: FilterOverride<Def>;
};

export interface ResolvedFilters {
  readonly names: readonly string[];
  readonly predicates: readonly FilterPredicate[];
  readonly groups: readonly {
    readonly name: string;
    readonly predicates: readonly FilterPredicate[];
  }[];
}

export interface ResolveFiltersOptions {
  readonly method: string;
  readonly table: string;
  readonly columnPrefix?: string;
  readonly schema?: CoreSchema<string>;
  readonly qualifyColumns?: boolean;
  readonly knownNames?: readonly string[];
}

export interface FilterTarget {
  where(col: string, op: string, value: unknown): this;
  orWhere?(col: string, op: string, value: unknown): this;
  whereGroup?(predicates: readonly FilterPredicate[]): this;
}

function missingParameterError(filter: FilterDef<unknown>, method: string, names: readonly string[]): ValidationError {
  const required = names.length === 0 ? ['parameters'] : names;
  const rendered = required.join(', ');
  return new ValidationError(
    `filter \`${filter.name}\` requires parameters (${rendered}) and none were supplied; pass them per call — ` +
      `${method}({ filters: { ${filter.name}: { ${rendered} } } }) — or disable it by name`,
  );
}

function trackedObject(value: Record<string, unknown>, accessed: Set<string>): Record<string, unknown> {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (typeof property === 'string') accessed.add(property);
      return Reflect.get(target, property, receiver);
    },
  });
}

function parametersFor(
  filter: FilterDef<unknown>,
  override: unknown,
  supplied: boolean,
  method: string,
): { readonly predicates: readonly FilterPredicate[]; readonly accessed: readonly string[] } {
  const accessed = new Set<string>();
  const rawParameters =
    supplied && override !== null && override !== undefined ? override : trackedObject(Object.create(null), accessed);
  const parameters = isRecord(rawParameters) ? trackedObject(rawParameters, accessed) : rawParameters;

  let predicates: readonly FilterPredicate[];
  try {
    predicates = filter.where(parameters);
  } catch (error) {
    if (
      accessed.size > 0 &&
      (!supplied || [...accessed].some(name => !isRecord(rawParameters) || rawParameters[name] == null))
    ) {
      throw missingParameterError(filter, method, [...accessed]);
    }
    throw error;
  }

  const missing = [...accessed].filter(name => !isRecord(rawParameters) || rawParameters[name] == null);
  if (!supplied && accessed.size > 0) throw missingParameterError(filter, method, [...accessed]);
  if (missing.length > 0) throw missingParameterError(filter, method, missing);
  return { predicates, accessed: [...accessed] };
}

function validatePredicate(
  filter: FilterDef<unknown>,
  predicate: FilterPredicate,
  schema: CoreSchema<string> | undefined,
  accessed: readonly string[],
): ColumnIR {
  if (!isRecord(predicate) || typeof predicate.col !== 'string' || typeof predicate.op !== 'string') {
    throw new ValidationError(`filter \`${filter.name}\` returned an invalid predicate`);
  }
  if (predicate.connector !== undefined && predicate.connector !== 'AND' && predicate.connector !== 'OR') {
    throw new ValidationError(`filter \`${filter.name}\` returned an invalid connector`);
  }
  const validationSchema = filter.schema ?? schema;
  if (validationSchema === undefined) {
    throw new ValidationError(
      `filter \`${filter.name}\` targets \`${filter.table}\` without a schema; provide FilterDef.schema so its columns and parameters can be validated`,
    );
  }

  const columnName = predicate.col.slice(predicate.col.lastIndexOf('.') + 1);
  const column = validationSchema.ir.columns.find(candidate => candidate.name === columnName);
  if (column === undefined) {
    throw new ValidationError(
      `filter \`${filter.name}\` names column \`${predicate.col}\`, which is not declared by \`${validationSchema.ir.table}\``,
    );
  }

  const operator = predicate.op.toLowerCase().trim();
  if (operator === 'is null' || operator === 'is not null') return column;
  if (
    predicate.value !== null &&
    typeof predicate.value === 'object' &&
    'compile' in predicate.value &&
    typeof predicate.value.compile === 'function'
  ) {
    return column;
  }

  const path = `filters.${filter.name}.${accessed[0] ?? columnName}`;
  const values =
    (operator === 'in' || operator === 'not in' || operator === 'nin') && Array.isArray(predicate.value)
      ? predicate.value
      : [predicate.value];
  const issues = values.flatMap((value, index) =>
    issuesFor(value, appTypeOf(column), values.length === 1 ? path : `${path}.${index}`),
  );
  if (issues.length > 0) {
    throw new ValidationError(`validation failed: ${issues.map(issue => issue.path).join(', ')}`, issues);
  }
  return column;
}

/** Resolve disables and parameters before a builder is allowed to compile. */
export function resolveFilters(
  definitions: readonly FilterDef<unknown>[],
  overrides: unknown,
  options: ResolveFiltersOptions,
): ResolvedFilters {
  const values = overrides === undefined ? undefined : isRecord(overrides) ? overrides : undefined;
  if (overrides !== undefined && values === undefined) {
    throw new ValidationError('filters must be an object keyed by declared filter name');
  }

  const knownNames = new Set(options.knownNames ?? definitions.map(filter => filter.name));
  for (const name of Object.keys(values ?? {})) {
    if (!knownNames.has(name)) {
      const declared = [...knownNames].toSorted();
      throw new ValidationError(
        `unknown filter \`${name}\`; declared filters: ${declared.length === 0 ? '(none)' : declared.join(', ')}`,
      );
    }
  }

  const names: string[] = [];
  const predicates: FilterPredicate[] = [];
  const groups: { readonly name: string; readonly predicates: readonly FilterPredicate[] }[] = [];
  for (const filter of definitions) {
    const supplied = values !== undefined && Object.hasOwn(values, filter.name);
    const override = supplied ? values[filter.name] : undefined;
    if (override === false || (!supplied && filter.enabled === false)) continue;

    const resolved = parametersFor(filter, override, supplied, options.method);
    if (!Array.isArray(resolved.predicates) || resolved.predicates.length === 0) {
      throw new ValidationError(`filter \`${filter.name}\` returned no predicates`);
    }

    names.push(filter.name);
    const group: FilterPredicate[] = [];
    for (let index = 0; index < resolved.predicates.length; index++) {
      const predicate = resolved.predicates[index];
      if (predicate === undefined) throw new ValidationError(`filter \`${filter.name}\` returned an empty predicate`);
      const column = validatePredicate(filter, predicate, options.schema, resolved.accessed);
      const separator = predicate.col.lastIndexOf('.');
      const physicalColumn =
        separator === -1 ? column.physicalName : `${predicate.col.slice(0, separator + 1)}${column.physicalName}`;
      const col =
        options.qualifyColumns === true && separator === -1
          ? `${options.columnPrefix ?? options.table}.${physicalColumn}`
          : physicalColumn;
      const qualified = {
        ...predicate,
        col,
        connector: index === 0 ? 'AND' : (predicate.connector ?? 'AND'),
      } satisfies FilterPredicate;
      predicates.push(qualified);
      group.push(qualified);
    }
    groups.push({ name: filter.name, predicates: Object.freeze(group) });
  }

  return {
    names: Object.freeze([...new Set(names)]),
    predicates: Object.freeze(predicates),
    groups: Object.freeze(groups),
  };
}

function needsGrouping(predicates: readonly FilterPredicate[]): boolean {
  return predicates.some((predicate, index) => index > 0 && predicate.connector === 'OR');
}

/** Preserve each filter's boolean boundary when it is placed in WHERE or JOIN ON. */
export function filtersAsPredicates(resolved: ResolvedFilters): readonly Predicate[] {
  const predicates: Predicate[] = [];
  for (const group of resolved.groups) {
    if (needsGrouping(group.predicates)) {
      predicates.push({ kind: 'group', predicates: group.predicates, connector: 'AND' });
    } else {
      predicates.push(...group.predicates);
    }
  }
  return Object.freeze(predicates);
}

/** Conjoin an already-resolved set with the predicates a read builder already carries. */
export function applyResolvedFilters<B extends FilterTarget>(builder: B, resolved: ResolvedFilters): B {
  let filtered = builder;
  for (const group of resolved.groups) {
    if (needsGrouping(group.predicates)) {
      if (filtered.whereGroup === undefined) {
        throw new ValidationError('this statement builder cannot represent a grouped filter predicate');
      }
      filtered = filtered.whereGroup(group.predicates);
      continue;
    }
    for (const predicate of group.predicates) {
      filtered = filtered.where(predicate.col, predicate.op, predicate.value);
    }
  }
  return filtered;
}
