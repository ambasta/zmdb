import type { Guard } from '../middleware/index.js';

/** Guard instances applied before every route, or every route on one controller. */
export interface GuardRegistry {
  readonly app?: readonly Guard[];
  readonly controllers?: Readonly<Record<string, readonly Guard[]>>;
}

const NO_GUARDS: readonly Guard[] = [];

/** Resolve the effective guard chain in runtime order: app, controller, route. */
export function resolveGuards(
  registry: GuardRegistry | undefined,
  controllerName: string,
  routeGuards: readonly Guard[] = NO_GUARDS,
): readonly Guard[] {
  const appGuards = registry?.app ?? NO_GUARDS;
  const controllerGuards = registry?.controllers?.[controllerName] ?? NO_GUARDS;
  if (appGuards.length === 0 && controllerGuards.length === 0) {
    return routeGuards;
  }
  return [...appGuards, ...controllerGuards, ...routeGuards];
}
