import type { Container } from '../di/index.js';

const ledgers = new WeakMap<Container, object[]>();

export function createLifecycleRecorder(container: Container): (value: unknown) => void {
  const instances: object[] = [];
  const seen = new Set<object>();
  ledgers.set(container, instances);

  return value => {
    if (!isObject(value) || seen.has(value)) return;
    seen.add(value);
    instances.push(value);
  };
}

export function lifecycleInstances(container: Container): readonly object[] {
  return ledgers.get(container) ?? [];
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
