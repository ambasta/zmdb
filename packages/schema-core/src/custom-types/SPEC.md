# SPEC — Custom types & codecs (frozen)

Part of `@zmdb/schema-core`. User-defined column types with a SQL type + TS type
+ to-DB/from-DB codec. AOT-friendly, no per-row reflection beyond the codec call.
Epic #131.

## API

```ts
interface CustomType<TS, DB = unknown> {
  readonly sqlType: string;                 // DDL type, e.g. 'jsonb'
  readonly toDb: (value: TS) => DB;         // serialize for the driver
  readonly fromDb: (raw: DB) => TS;         // parse a driver row value
}
function defineType<TS, DB>(def: CustomType<TS, DB>): CustomType<TS, DB>;
function encodeValue<TS, DB>(type: CustomType<TS, DB>, value: TS): DB;
function decodeValue<TS, DB>(type: CustomType<TS, DB>, raw: DB): TS;
```

## Frozen behavior

- `defineType` freezes and returns the codec descriptor.
- `encodeValue`/`decodeValue` apply `toDb`/`fromDb`. Round-trip law:
  `decodeValue(t, encodeValue(t, v))` deep-equals `v` for codec-clean values.
- The `sqlType` feeds migration DDL for columns declared with this type.
- No global registry required — a custom type is a value you attach to a column.
