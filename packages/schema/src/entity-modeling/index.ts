// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// §2 embeddables
export function flattenEmbeddable(prefix: string, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[`${prefix}_${k}`] = v;
  return out;
}
export function liftEmbeddable(prefix: string, row: Record<string, unknown>): Record<string, unknown> {
  const p = `${prefix}_`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith(p)) out[k.slice(p.length)] = v;
  }
  return out;
}

// §3 inheritance
export interface SingleTableInheritance {
  discriminator: string;
  map: Record<string, readonly string[]>;
}
export function discriminatorFor(_sti: SingleTableInheritance, type: string): string {
  return type;
}
export function rowToSubtype(
  sti: SingleTableInheritance,
  row: Record<string, unknown>,
): { type: string; data: Record<string, unknown> } {
  const type = String(row[sti.discriminator]);
  const cols = sti.map[type] ?? [];
  const data: Record<string, unknown> = {};
  for (const c of cols) data[c] = row[c];
  return { type, data };
}
