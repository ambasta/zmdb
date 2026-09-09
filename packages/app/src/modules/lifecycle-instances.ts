import type { Container } from '../di/index.js';

const ledgers = new WeakMap<Container, object[]>();
const recorders = new WeakMap<Container, (value: unknown) => void>();

export function createLifecycleRecorder(container: Container): (value: unknown) => void {
  const existing = recorders.get(container);
  if (existing !== undefined) return existing;
  const instances: object[] = [];
  const seen = new Set<object>();
  ledgers.set(container, instances);

  const record = (value: unknown): void => {
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    instances.push(value);
  };
  recorders.set(container, record);
  return record;
}

export function lifecycleInstances(container: Container): readonly object[] {
  return ledgers.get(container) ?? [];
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
