// One labelled probe per TypeScript construct the reflection has to answer for.
//
// `PLAN-type-first.md` Phase 4's gate is "every row either passing or producing a
// named diagnostic — zero rows silently wrong", and this file is that table as code.
// The label is the assertion key in `reflect.spec.ts`; a construct with no row here
// has no coverage, which is the only way a gap stays invisible.
//
// Refusals are as much part of the contract as successes. `probe<any>` is here
// because "`any` is refused with a reason" is a promise, and an untested promise
// about a validator that always passes is the worst kind.

import type { Brand } from '@zmdb/aot-validator/advanced';
import type {
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  Nullable,
  Pattern,
  PrimaryKey,
  Proto,
  ProtoField,
  Rule,
  Sensitive,
  Serial,
  Sql,
  Unique,
} from '@zmdb/schema-core/tags';

// `of` is never passed and never called — the declaration exists so a call site can
// hand `T` to the checker. The unused parameter is there to give `T` a position, which
// the lint rule for unused type parameters asks for.
declare function probe<T>(label: string, of?: T): void;

// --- scalars ---------------------------------------------------------------
probe<string>('string');
probe<number>('number');
probe<boolean>('boolean');
probe<bigint>('bigint');
probe<Date>('date');

// --- literals and unions ---------------------------------------------------
probe<'admin'>('string-literal');
probe<7>('number-literal');
probe<true>('true-literal');
probe<'admin' | 'viewer'>('literal-union');
probe<string | null>('nullable-string');
probe<string | undefined>('optional-string');
probe<string | number>('mixed-union');
probe<10n>('bigint-literal');

// --- tagged scalars --------------------------------------------------------
probe<number & Sql<'integer'>>('tagged-integer');
probe<number & Sql<'integer'>>('tagged-serial');
probe<number & Sql<'numeric'>>('tagged-numeric');
// The checker distributes the intersection over `true | false`, so this arrives at the
// walk as two intersections and not as `boolean` at all.
probe<boolean & Sql<'boolean'>>('tagged-boolean');
probe<number & Min<18> & Max<120>>('tagged-bounds');
probe<string & MinLength<3> & MaxLength<64>>('tagged-lengths');
probe<string & Sql<'varchar'> & Length<255>>('tagged-varchar');
probe<string & Length<64> & MaxLength<10>>('tagged-length-vs-maxlength');
probe<string & Pattern<'^\\S+@\\S+$'>>('tagged-pattern');
probe<Nullable<string & MinLength<3>>>('tagged-nullable');
probe<number & Proto<'int32'> & ProtoField<7>>('protobuf-tags');
probe<Serial>('tags-only');

// --- composites ------------------------------------------------------------
probe<readonly string[]>('readonly-array');
probe<number[]>('array');
probe<(string & MinLength<2>)[]>('array-of-tagged');
probe<readonly (string & MinLength<1>)[] & MaxLength<3>>('tagged-array');
probe<[string, number]>('tuple');
probe<[string, number?]>('tuple-optional');
probe<[string, ...number[]]>('tuple-rest');

// --- objects ---------------------------------------------------------------
export interface Address {
  street: string;
  zip: string & Length<10>;
}
export interface Profile {
  address: Address;
  nickname?: string;
}
probe<Profile>('nested-object');
probe<{ a: number }>('anonymous-object');
probe<{}>('empty-object');

export interface Node_ {
  value: string;
  next: Node_ | null;
}
probe<Node_>('recursive');

export interface Tree {
  left: Tree | null;
  right: Tree | null;
}
probe<Tree>('recursive-twice');

// Mutual recursion, which a single-frame cycle guard would miss: neither type is its
// own ancestor, but the pair is.
export interface Folder {
  name: string;
  files: FileEntry[];
}
export interface FileEntry {
  name: string;
  parent: Folder | null;
}
probe<Folder>('mutual-recursion');

// --- unions of objects -----------------------------------------------------
export interface Circle {
  kind: 'circle';
  radius: number;
}
export interface Square {
  kind: 'square';
  side: number;
}
probe<Circle | Square>('discriminated-union');

export interface HasEmail {
  email: string;
}
export interface HasPhone {
  phone: string;
}
probe<HasEmail | HasPhone>('undiscriminated-union');

// --- intersections and type operators --------------------------------------
probe<Address & { country: string }>('object-intersection');
probe<Omit<Profile, 'nickname'>>('omit');
probe<Pick<Address, 'street'>>('pick');
probe<Partial<Address>>('partial');
probe<Required<Profile>>('required');
probe<{ [K in 'a' | 'b']: number }>('mapped');
probe<string extends string ? number : never>('conditional');

// --- brands and template literals ------------------------------------------
// A brand is a phantom `unique symbol` slot, exactly like our tags but with a name the
// reflection does not know. It erases at runtime, so the checkable type is the base.
probe<Brand<number, 'UserId'>>('brand');
probe<`${string}@${string}`>('template-literal');
// A union placeholder is normalised to a union of template literal types before the
// reflection sees it, so this is two patterns rather than one alternation.
probe<`v${1 | 2}.${string}`>('template-literal-union');
// `${number}` is refused rather than approximated: no short regex matches exactly the
// text TypeScript accepts there. See `placeholderPattern`.
probe<`${number}px`>('template-literal-number');
probe<Uppercase<string>>('string-mapping');

// --- refusals: the reflection must name each of these ----------------------
probe<unknown>('unknown');
// oxlint-disable-next-line no-explicit-any -- refusing `any` is the assertion
probe<any>('any');
probe<never>('never');
probe<object>('bare-object');
probe<symbol>('symbol');
probe<Record<string, number>>('record');
probe<{ [key: string]: number }>('index-signature');
probe<Map<string, number>>('map');
probe<Set<string>>('set');
probe<Promise<number>>('promise');
probe<Uint8Array>('typed-array');
probe<(a: number) => string>('function');

export class Point {
  x = 0;
  y = 0;
}
probe<Point>('class');

export interface WithMethod {
  a: number;
  run(): void;
}
probe<WithMethod>('object-with-method');

/** A type parameter is refused where it is written, not at the instantiation site. */
export function generic<T>(): void {
  probe<T>('type-parameter');
}

// --- tag argument errors ---------------------------------------------------
probe<string & Rule<'luhn'>>('rule');
probe<string & Rule<'luhn' | 'checksum'>>('rule-union');

// --- flags that only mean something on a column ----------------------------
probe<number & Sql<'integer'> & Serial & PrimaryKey>('column-id');
probe<string & Sql<'text'> & Sensitive>('column-sensitive');
probe<string & Sql<'varchar'> & Length<32> & Unique & HasDefault>('column-flags');
