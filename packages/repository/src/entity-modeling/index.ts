// Entity modeling: lifecycle events, embeddables, inheritance — see ./SPEC.md.

// §1 lifecycle events
export type LifecycleEvent =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete';

export interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}

export class EventBus {
  private subs: Subscriber[] = [];
  subscribe(s: Subscriber): () => void {
    this.subs.push(s);
    return () => {
      const i = this.subs.indexOf(s);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }
  async emit(event: LifecycleEvent, ctx: unknown): Promise<void> {
    for (const s of this.subs) {
      if (s.on === event) await s.run(ctx);
    }
  }
}

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
