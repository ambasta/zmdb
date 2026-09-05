# SPEC — Custom types & codecs (frozen)

Part of `@zmdb/schema-core`. User-defined column types with a SQL type + TS type

- to-DB/from-DB codec. AOT-friendly, no per-row reflection beyond the codec call. Epic #131.

## API

```ts
interface CustomType<Wire, TS, DB = unknown> {
  readonly sqlType: string; // DDL type, e.g. 'jsonb'
  readonly toDb: (value: TS) => DB; // serialize for the driver
  readonly fromDb: (raw: DB) => TS; // parse a driver row value
  readonly toWire: (value: TS) => Wire; // serialize for a JSON response
  readonly fromWire: (raw: Wire) => TS; // parse a JSON request body value
}
function defineType<Wire, TS, DB>(def: CustomType<Wire, TS, DB>): CustomType<Wire, TS, DB>;
function encodeValue<Wire, TS, DB>(type: CustomType<Wire, TS, DB>, value: TS): DB;
function decodeValue<Wire, TS, DB>(type: CustomType<Wire, TS, DB>, raw: DB): TS;
function wireCodec<Wire, TS, DB>(type: CustomType<Wire, TS, DB>): Codec;
```

Three types, because a column has three (plan D3). A codec that named two of them left the third to be guessed, and the guess was "the same as the app type" — which is how a `Money` instance reached
`JSON.stringify`. All four functions are required: a codec whose `toWire` were optional would be one that sometimes converts, and a caller cannot tell which kind it has.

## Frozen behavior

- `defineType` freezes and returns the codec descriptor.
- `encodeValue`/`decodeValue` apply `toDb`/`fromDb`. Round-trip law: `decodeValue(t, encodeValue(t, v))` deep-equals `v` for codec-clean values.
- `wireCodec(t)` adapts a custom type to the `Codec` the IR's wire crossing consumes, so a `Codec<'Money'>` column resolves through `wireDecoder(Schema, variant, { Money: wireCodec(MoneyType) })`. The
  same round-trip law holds for `toWire`/`fromWire`.
- The wire type is declared to the type system with `WireAs<W>` (see `../tags/SPEC.md`), which is what lets `Wire<T>` and the published document describe it.
- The `sqlType` feeds migration DDL for columns declared with this type.
- No global registry required — a custom type is a value you attach to a column.
