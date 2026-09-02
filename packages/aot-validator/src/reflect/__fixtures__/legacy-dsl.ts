// The builder DSL the codemod migrates away from, as declarations only.
//
// `defineSchema` and its column builders were deleted from `@zmdb/schema-core` when the last
// caller in this repository became a tagged interface. The codemod that carried them across
// outlives them — a consumer upgrading has a codebase full of the old spelling, and the tool
// that reads it has to keep working long after the library stopped exporting it. Which leaves
// its test corpus needing a `defineSchema` to read.
//
// So this is that surface, and *only* that surface: signatures, no bodies. The codemod is
// purely syntactic about the DSL — it matches on the imported names and interprets the call
// chain from the AST, with no question put to the checker about where any of it came from —
// so a declared shape is indistinguishable to it from the deleted implementation. What the
// declarations buy is that the corpus still compiles, which is how a fixture that has drifted
// out of the shape the codemod expects announces itself.
//
// Nothing here runs, and the corpora that import it are never imported at runtime. That is a
// change from when the DSL was real: the corpus used to double as its own oracle, because
// `irFromSchema` of the value it built was the answer the converted interface had to reflect
// back to. With the implementation gone the oracle is gone too, and what replaced it is
// written out in `codemod.spec.ts` — the exact property lines the codemod is expected to
// produce, which pins two things the IR comparison never could: the order the tags come out
// in, and the bracketing that keeps `(T & Tags) | null` from collapsing.

/** A column under construction. Every modifier returns the same thing, chainably. */
export interface Column<Sql extends string = string, Flags = unknown> {
  readonly __sql?: Sql;
  readonly __flags?: Flags;
  notNull(): Column<Sql, Flags>;
  nullable(): Column<Sql, Flags>;
  primaryKey(): Column<Sql, Flags>;
  unique(): Column<Sql, Flags>;
  defaultTo(value: unknown): Column<Sql, Flags>;
  validate(rule: { readonly kind: string; readonly value: unknown }): Column<Sql, Flags>;
  sensitive(on?: boolean): Column<Sql, Flags>;
}

export declare function serial(): Column<'integer'>;
export declare function integer(): Column<'integer'>;
export declare function bigint(): Column<'bigint'>;
export declare function numeric(precision?: number, scale?: number): Column<'numeric'>;
export declare function text(): Column<'text'>;
export declare function varchar(length: number): Column<'varchar'>;
export declare function boolean(): Column<'boolean'>;
export declare function timestamp(): Column<'timestamp'>;
/** `of` exists only to give `T` a position; the payload was never a runtime value. */
export declare function json<T>(of?: T): Column<'json'>;
export declare function jsonEnum<const V extends readonly string[]>(values: V): Column<'jsonEnum'>;

export declare function notNull<C extends Column>(column: C): C;
export declare function nullable<C extends Column>(column: C): C;
export declare function primaryKey<C extends Column>(column: C): C;
export declare function unique<C extends Column>(column: C): C;
export declare function sensitive<C extends Column>(column: C): C;
export declare function references<C extends Column>(
  column: C,
  target: string | { readonly table: string },
  targetColumn?: string,
): C;

export declare function defineSchema(
  table: string,
  columns: Record<string, Column>,
  options?: { readonly ftsTable?: string | boolean },
): { readonly table: string; readonly columns: Record<string, Column> };
