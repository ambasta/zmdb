// Custom types & codecs — see ./SPEC.md.

export interface CustomType<TS, DB = unknown> {
  readonly sqlType: string;
  readonly toDb: (value: TS) => DB;
  readonly fromDb: (raw: DB) => TS;
}

export function defineType<TS, DB>(def: CustomType<TS, DB>): CustomType<TS, DB> {
  throw new Error('not implemented');
}
export function encodeValue<TS, DB>(_type: CustomType<TS, DB>, _value: TS): DB {
  throw new Error('not implemented');
}
export function decodeValue<TS, DB>(_type: CustomType<TS, DB>, _raw: DB): TS {
  throw new Error('not implemented');
}
