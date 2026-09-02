// The type-first tag vocabulary — a prototype of the design in ../../../DESIGN-type-first.md.
//
// Every tag is an OPTIONAL unique-symbol slot. That shape matters:
//   - `unique symbol` makes the slot un-forgeable and collision-proof against a
//     real data property of the same name.
//   - `?` means no runtime value is ever required, so the tag erases completely.
//   - all-optional (weak) object types are NOT assignable from an unrelated type,
//     which is what lets a conditional type ask "does this column carry Serial?"
//     and get an exact answer instead of a false positive. See
//     ../../../DESIGN-type-first.md §3.
//
// There is deliberately NO tag for nullability, optionality, or enums: TypeScript
// already expresses those natively as `| null`, `?`, and a literal union, and the
// generator reads them from the type directly.

declare const zmdbTable: unique symbol;
declare const zmdbSqlType: unique symbol;
declare const zmdbPrimaryKey: unique symbol;
declare const zmdbSerial: unique symbol;
declare const zmdbUnique: unique symbol;
declare const zmdbDefault: unique symbol;
declare const zmdbSensitive: unique symbol;
declare const zmdbReferences: unique symbol;
declare const zmdbLength: unique symbol;
declare const zmdbMin: unique symbol;
declare const zmdbMax: unique symbol;
declare const zmdbMinLength: unique symbol;
declare const zmdbMaxLength: unique symbol;
declare const zmdbPattern: unique symbol;

// --- structural facts the SQL layer needs and TypeScript cannot express -------

/** The table an entity maps to. Applied to the entity interface itself. */
export type Table<Name extends string> = { readonly [zmdbTable]?: Name };

/** The SQL column type. `integer`, `bigint` and `numeric` are all `number` in TS. */
export type Sql<T extends string> = { readonly [zmdbSqlType]?: T };

export type PrimaryKey = { readonly [zmdbPrimaryKey]?: true };
export type Serial = { readonly [zmdbSerial]?: true };
export type Unique = { readonly [zmdbUnique]?: true };
export type HasDefault = { readonly [zmdbDefault]?: true };
export type Sensitive = { readonly [zmdbSensitive]?: true };
export type References<Target extends string> = { readonly [zmdbReferences]?: Target };
export type Length<N extends number> = { readonly [zmdbLength]?: N };

// --- validation constraints --------------------------------------------------

export type Min<N extends number> = { readonly [zmdbMin]?: N };
export type Max<N extends number> = { readonly [zmdbMax]?: N };
export type MinLength<N extends number> = { readonly [zmdbMinLength]?: N };
export type MaxLength<N extends number> = { readonly [zmdbMaxLength]?: N };
export type Pattern<S extends string> = { readonly [zmdbPattern]?: S };

// --- convenience aliases: nullability is native, these just read better ------

/** `Nullable<string>` is exactly `string | null`. No tag involved. */
export type Nullable<T> = T | null;
/** `NonNullable` is the default; present for symmetry at the declaration site. */
export type NonNull<T> = Exclude<T, null | undefined>;

// --- the derivations, driven by the tags -------------------------------------

export type SerialKeys<T> = { [K in keyof T]-?: T[K] extends Serial ? K : never }[keyof T];
export type DefaultKeys<T> = { [K in keyof T]-?: T[K] extends HasDefault ? K : never }[keyof T];
export type PrimaryKeyKeys<T> = { [K in keyof T]-?: T[K] extends PrimaryKey ? K : never }[keyof T];
export type SensitiveKeys<T> = { [K in keyof T]-?: T[K] extends Sensitive ? K : never }[keyof T];

/** The selectable row: every column, required, sensitive columns included. */
export type Entity<T> = { -readonly [K in keyof T]-?: T[K] };

/** Insert shape: DB-generated columns dropped, defaulted columns optional. */
export type CreateDTO<T> = Omit<T, SerialKeys<T> | DefaultKeys<T>> & Partial<Pick<T, DefaultKeys<T>>>;

/** Patch shape: identity columns dropped, everything else optional, constraints kept. */
export type UpdateDTO<T> = Partial<Omit<T, SerialKeys<T> | PrimaryKeyKeys<T>>>;

/** Filter shape: every column optional. */
export type WhereDTO<T> = Partial<Entity<T>>;

/** What a read endpoint may return: sensitive columns removed. */
export type ReadDTO<T> = Omit<Entity<T>, SensitiveKeys<T>>;
