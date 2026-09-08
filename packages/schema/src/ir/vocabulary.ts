/**
 * `ValidationRule.kind` is an open `string`, so this is the set any back-end
 * interprets rather than the set a consumer may write. Anything else is a named
 * custom rule and lands in `ColumnIR.rules`.
 */
export const KNOWN_CONSTRAINT_KINDS = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern'] as const;

export type ConstraintKind = (typeof KNOWN_CONSTRAINT_KINDS)[number];

/**
 * The tag vocabulary as data: **IR field → the tag name the reflection recognises**.
 * `../tags` is types-only and must stay that way, so the reflection cannot import the
 * tags themselves. It matches the escaped unique-symbol name the checker reports
 * (`__@zmdbSerial@1`), except for `Ext`'s frozen structural `__zmdbExt` marker.
 *
 * Keyed by the IR field rather than by the tag's public name because that is the
 * mapping every consumer actually wants, and because keeping it in one table is what
 * lets `vocabulary.type-test.ts` prove the two vocabularies line up. A tag added to
 * `../tags` without an entry here is invisible to the reflection, which is precisely
 * the silent-gap failure the whole IR exists to prevent.
 */
export const TAG_NAMES = {
  table: 'zmdbTable',
  ftsTable: 'zmdbFts',
  shardKey: 'zmdbShardKey',
  sortKey: 'zmdbSortKey',
  rowstore: 'zmdbRowstore',
  softDelete: 'zmdbSoftDelete',
  sql: 'zmdbSqlType',
  extension: 'zmdbExt',
  primaryKey: 'zmdbPrimaryKey',
  serial: 'zmdbSerial',
  unique: 'zmdbUnique',
  hasDefault: 'zmdbDefault',
  sensitive: 'zmdbSensitive',
  references: 'zmdbReferences',
  onDelete: 'zmdbOnDelete',
  onUpdate: 'zmdbOnUpdate',
  foreignKeys: 'zmdbForeignKey',
  length: 'zmdbLength',
  precision: 'zmdbNumeric',
  codec: 'zmdbCodec',
  wire: 'zmdbWire',
  relation: 'zmdbRelation',
  minimum: 'zmdbMin',
  maximum: 'zmdbMax',
  minLength: 'zmdbMinLength',
  maxLength: 'zmdbMaxLength',
  pattern: 'zmdbPattern',
  rules: 'zmdbRule',
  protoField: 'zmdbProtoField',
  protoScalar: 'zmdbProtoScalar',
} as const;

/** An IR field a tag can set. */
export type TagField = keyof typeof TAG_NAMES;
