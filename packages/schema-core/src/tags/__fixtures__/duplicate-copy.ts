// A deliberate second copy of three tags from `../index.ts`, standing in for a
// consumer whose `node_modules` ended up with two `@zmdb/schema-core` installs.
//
// The source text below is a copy of the real declarations. The *types* are not
// the same types, and that is the whole point: `unique symbol` identity is
// nominal, so copying the file does not copy the tag. See
// `../duplicate-install.type-test.ts` for what that does to a derived DTO, and
// `PLAN-type-first.md` D5 for the resolution.
//
// This file is never imported by shipping code. `verify:tf-coverage` asserts that.

declare const zmdbSerial: unique symbol;
declare const zmdbDefault: unique symbol;
declare const zmdbPrimaryKey: unique symbol;

export type Serial = { readonly [zmdbSerial]?: true };
export type HasDefault = { readonly [zmdbDefault]?: true };
export type PrimaryKey = { readonly [zmdbPrimaryKey]?: true };
