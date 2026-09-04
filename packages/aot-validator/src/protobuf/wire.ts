// The small runtime the AOT protobuf encoder targets.
//
// Message shape, field numbers and scalar choices have already been compiled into
// straight-line JavaScript. This class owns only the wire primitives and a growable
// byte buffer; it never receives a descriptor or performs a field lookup.

const INITIAL_CAPACITY = 64;
const UTF8 = new TextEncoder();

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
