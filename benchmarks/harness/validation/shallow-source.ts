// One realistic populated row for the full-vs-shallow measurement.
//
// The root has exactly three populated relation objects and one 100-element list in the
// benchmark data. Both functions are transformed from these public calls; the generated
// module is what the benchmark imports, so neither row is a hand-written approximation.
import { is, isShallow } from '../../../packages/aot-validator/src/utilities/index.js';

export interface CustomerRow {
  readonly id: string;
  readonly email: string;
  readonly loyaltyTier: 'standard' | 'priority';
}

export interface WarehouseRow {
  readonly id: string;
  readonly code: string;
  readonly region: string;
}

export interface CarrierRow {
  readonly id: string;
  readonly service: 'ground' | 'air';
  readonly trackingPrefix: string;
}

export interface OrderItemRow {
  readonly id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly lineTotal: number;
  readonly taxRate: number;
  readonly fulfilled: boolean;
}

export interface PopulatedOrderRow {
  readonly id: string;
  readonly status: 'open' | 'paid' | 'shipped';
  readonly currency: 'INR' | 'USD';
  readonly total: number;
  readonly placedAt: string;
  readonly customer: CustomerRow;
  readonly warehouse: WarehouseRow;
  readonly carrier: CarrierRow;
  readonly items: readonly OrderItemRow[];
}

export function fullPopulatedRow(value: unknown): value is PopulatedOrderRow {
  return is<PopulatedOrderRow>(value);
}

export function shallowPopulatedRow(value: unknown): value is PopulatedOrderRow {
  return isShallow<PopulatedOrderRow, 1>(value);
}
