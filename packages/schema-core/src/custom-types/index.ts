// Custom types & codecs — see ./SPEC.md.

export interface CustomType<TS, DB = unknown> {
  readonly sqlType: string;
  readonly toDb: (value: TS) => DB;
  readonly fromDb: (raw: DB) => TS;
}

export function defineType<TS, DB>(def: CustomType<TS, DB>): CustomType<TS, DB> {
  return Object.freeze({ ...def });
}
export function encodeValue<TS, DB>(type: CustomType<TS, DB>, value: TS): DB {
  return type.toDb(value);
}
export function decodeValue<TS, DB>(type: CustomType<TS, DB>, raw: DB): TS {
  return type.fromDb(raw);
}
