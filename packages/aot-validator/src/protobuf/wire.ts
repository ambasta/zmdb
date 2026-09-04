// The small runtime the AOT protobuf codecs target.
//
// Message shape, field numbers and scalar choices have already been compiled into
// straight-line JavaScript. These classes own only byte-level wire primitives; neither
// receives a descriptor or performs a field lookup.

const INITIAL_CAPACITY = 64;
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const EMPTY_BYTES = new Uint8Array();
const MAX_FIELD_NUMBER = 536_870_911;

/** A growable protobuf output buffer. `finish()` returns an exact-sized copy. */
export class ProtoWriter {
  #buffer = new Uint8Array(INITIAL_CAPACITY);
  #view = new DataView(this.#buffer.buffer);
  #length = 0;

  /** A field key: `(field number << 3) | wire type`, without 32-bit bitwise truncation. */
  tag(fieldNumber: number, wireType: 0 | 1 | 2 | 5): void {
    this.uint32(fieldNumber * 8 + wireType);
  }

  uint32(value: number): void {
    this.#varint(BigInt.asUintN(32, BigInt(value)));
  }

  int32(value: number): void {
    this.#varint(BigInt.asUintN(64, BigInt(value)));
  }

  sint32(value: number): void {
    const signed = BigInt.asIntN(32, BigInt(value));
    this.#varint(BigInt.asUintN(32, (signed << 1n) ^ (signed >> 31n)));
  }

  uint64(value: bigint): void {
    this.#varint(BigInt.asUintN(64, value));
  }

  int64(value: bigint): void {
    this.#varint(BigInt.asUintN(64, value));
  }

  sint64(value: bigint): void {
    const signed = BigInt.asIntN(64, value);
    this.#varint(BigInt.asUintN(64, (signed << 1n) ^ (signed >> 63n)));
  }

  fixed32(value: number): void {
    this.#reserve(4);
    this.#view.setUint32(this.#length, value, true);
    this.#length += 4;
  }

  sfixed32(value: number): void {
    this.#reserve(4);
    this.#view.setInt32(this.#length, value, true);
    this.#length += 4;
  }

  fixed64(value: bigint): void {
    this.#reserve(8);
    this.#view.setBigUint64(this.#length, BigInt.asUintN(64, value), true);
    this.#length += 8;
  }

  sfixed64(value: bigint): void {
    this.#reserve(8);
    this.#view.setBigInt64(this.#length, BigInt.asIntN(64, value), true);
    this.#length += 8;
  }

  float(value: number): void {
    this.#reserve(4);
    this.#view.setFloat32(this.#length, value, true);
    this.#length += 4;
  }

  double(value: number): void {
    this.#reserve(8);
    this.#view.setFloat64(this.#length, value, true);
    this.#length += 8;
  }

  bool(value: boolean): void {
    this.uint32(value ? 1 : 0);
  }

  string(value: string): void {
    this.bytes(UTF8.encode(value));
  }

  bytes(value: Uint8Array): void {
    this.uint32(value.byteLength);
    this.#reserve(value.byteLength);
    this.#buffer.set(value, this.#length);
    this.#length += value.byteLength;
  }

  /** Detach the written prefix from spare capacity. */
  finish(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }

  #varint(value: bigint): void {
    let remaining = value;
    while (remaining >= 0x80n) {
      this.#byte(Number((remaining & 0x7fn) | 0x80n));
      remaining >>= 7n;
    }
    this.#byte(Number(remaining));
  }

  #byte(value: number): void {
    this.#reserve(1);
    this.#buffer[this.#length] = value;
    this.#length += 1;
  }

  #reserve(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#buffer.byteLength) return;

    let capacity = this.#buffer.byteLength;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.#buffer);
    this.#buffer = grown;
    this.#view = new DataView(grown.buffer);
  }
}

/** A bounded protobuf input cursor. Every length is checked before a view is made. */
export class ProtoReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(bytes: Uint8Array = EMPTY_BYTES) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.#offset === this.#bytes.byteLength;
  }

  get offset(): number {
    return this.#offset;
  }

  /** Read and validate a field key, returning `(field number << 3) | wire type`. */
  key(): number {
    const at = this.#offset;
    const value = this.#varint();
    if (value > 0xffff_ffffn) {
      throw new RangeError(`protobuf field key at offset ${at} exceeds 32 bits`);
    }
    const key = Number(value);
    const fieldNumber = Math.floor(key / 8);
    const wireType = key % 8;
    if (fieldNumber < 1 || fieldNumber > MAX_FIELD_NUMBER) {
      throw new RangeError(`invalid protobuf field number ${fieldNumber} at offset ${at}`);
    }
    if (wireType === 6 || wireType === 7) {
      throw new RangeError(`invalid protobuf wire type ${wireType} at offset ${at}`);
    }
    return key;
  }

  uint32(): number {
    return Number(BigInt.asUintN(32, this.#varint()));
  }

  int32(): number {
    return Number(BigInt.asIntN(32, this.#varint()));
  }

  sint32(): number {
    const value = BigInt.asUintN(32, this.#varint());
    return Number(BigInt.asIntN(32, (value >> 1n) ^ -(value & 1n)));
  }

  uint64(): bigint {
    return BigInt.asUintN(64, this.#varint());
  }

  int64(): bigint {
    return BigInt.asIntN(64, this.#varint());
  }

  sint64(): bigint {
    const value = BigInt.asUintN(64, this.#varint());
    return BigInt.asIntN(64, (value >> 1n) ^ -(value & 1n));
  }

  fixed32(): number {
    this.#require(4, 'fixed32');
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  sfixed32(): number {
    this.#require(4, 'sfixed32');
    const value = this.#view.getInt32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  fixed64(): bigint {
    this.#require(8, 'fixed64');
    const value = this.#view.getBigUint64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  sfixed64(): bigint {
    this.#require(8, 'sfixed64');
    const value = this.#view.getBigInt64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  float(): number {
    this.#require(4, 'float');
    const value = this.#view.getFloat32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  double(): number {
    this.#require(8, 'double');
    const value = this.#view.getFloat64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  bool(): boolean {
    return this.#varint() !== 0n;
  }

  string(): string {
    const at = this.#offset;
    const bytes = this.#lengthDelimited();
    try {
      return UTF8_DECODER.decode(bytes);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TypeError(`invalid protobuf UTF-8 string at offset ${at}: ${detail}`, { cause: error });
    }
  }

  /** A cursor bounded to one length-delimited payload. */
  message(): ProtoReader {
    return new ProtoReader(this.#lengthDelimited());
  }

  /** Discard one unknown occurrence without trusting its length. Groups are refused. */
  skip(wireType: number): void {
    const at = this.#offset;
    switch (wireType) {
      case 0:
        this.#varint();
        return;
      case 1:
        this.#advance(8, 'fixed64 unknown field');
        return;
      case 2:
        this.#lengthDelimited();
        return;
      case 3:
      case 4:
        throw new RangeError(`deprecated protobuf group wire type ${wireType} at offset ${at} is not supported`);
      case 5:
        this.#advance(4, 'fixed32 unknown field');
        return;
      default:
        throw new RangeError(`invalid protobuf wire type ${wireType} at offset ${at}`);
    }
  }

  #varint(): bigint {
    const start = this.#offset;
    let value = 0n;
    for (let index = 0; index < 10; index += 1) {
      if (this.#offset >= this.#bytes.byteLength) {
        throw new RangeError(`truncated protobuf varint at offset ${start}; input ended at offset ${this.#offset}`);
      }
      const byte = this.#bytes[this.#offset];
      if (byte === undefined) {
        throw new RangeError(`truncated protobuf varint at offset ${start}; input ended at offset ${this.#offset}`);
      }
      this.#offset += 1;
      if (index === 9 && byte > 1) {
        throw new RangeError(`protobuf varint at offset ${start} exceeds 64 bits`);
      }
      value |= BigInt(byte & 0x7f) << BigInt(index * 7);
      if ((byte & 0x80) === 0) return value;
    }
    throw new RangeError(`protobuf varint at offset ${start} exceeds 10 bytes`);
  }

  #lengthDelimited(): Uint8Array {
    const prefix = this.#offset;
    const encoded = this.#varint();
    const remaining = BigInt(this.#bytes.byteLength - this.#offset);
    if (encoded > remaining) {
      throw new RangeError(
        `protobuf length ${encoded} at offset ${prefix} exceeds ${remaining} remaining byte(s) at offset ${this.#offset}`,
      );
    }
    const length = Number(encoded);
    const start = this.#offset;
    this.#offset += length;
    return this.#bytes.subarray(start, this.#offset);
  }

  #advance(length: number, what: string): void {
    this.#require(length, what);
    this.#offset += length;
  }

  #require(length: number, what: string): void {
    const remaining = this.#bytes.byteLength - this.#offset;
    if (length > remaining) {
      throw new RangeError(
        `truncated protobuf ${what} at offset ${this.#offset}: needs ${length} byte(s), ${remaining} remaining`,
      );
    }
  }
}
