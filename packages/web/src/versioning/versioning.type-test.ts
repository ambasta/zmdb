import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { createRouter, Router, RouterOptions } from '../pipeline/index.js';
import { Version, VersionNeutral, type versionsOf, type VersionStrategy } from './index.js';

type FrozenVersionStrategy =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'header'; readonly name: string; readonly default: string }
  | { readonly kind: 'media-type'; readonly key: string; readonly default: string };

type ControllerClass = abstract new (...args: never[]) => unknown;
type ControllerMethod = (...args: never[]) => unknown;

interface FrozenVersionDecorator {
  <T extends ControllerClass>(target: T, context: ClassDecoratorContext<T>): void;
  (target: ControllerMethod, context: ClassMethodDecoratorContext): void;
}

type FrozenVersion = (...versions: readonly [string, ...string[]]) => FrozenVersionDecorator;
type FrozenVersionNeutral = () => FrozenVersionDecorator;
type FrozenVersionsOf = (controller: ControllerClass, handlerName: string) => readonly string[] | 'neutral' | undefined;

export type _StrategyShape = Expect<Equal<VersionStrategy, FrozenVersionStrategy>>;
export type _RouterCarriesOneStrategy = Expect<Equal<RouterOptions['versioning'], FrozenVersionStrategy | undefined>>;
export type _CreateRouterParameter = Expect<
  Equal<Parameters<typeof createRouter>, [routerOptions?: RouterOptions | undefined]>
>;
export type _CreateRouterReturn = Expect<Equal<ReturnType<typeof createRouter>, Router>>;
export type _VersionSignature = Expect<Equal<typeof Version, FrozenVersion>>;
export type _VersionNeutralSignature = Expect<Equal<typeof VersionNeutral, FrozenVersionNeutral>>;
export type _VersionsOfSignature = Expect<Equal<typeof versionsOf, FrozenVersionsOf>>;
export type _VersionAppliesToClass = Expect<
  Extends<ReturnType<typeof Version>, <T extends ControllerClass>(target: T, context: ClassDecoratorContext<T>) => void>
>;
export type _VersionAppliesToMethod = Expect<
  Extends<ReturnType<typeof Version>, (target: ControllerMethod, context: ClassMethodDecoratorContext) => void>
>;
export type _ThreeKinds = Expect<Equal<VersionStrategy['kind'], 'path' | 'header' | 'media-type'>>;

@Version('1')
class ClassVersion {
  run(): void {}
}

class MethodVersion {
  @Version('2')
  run(): void {}
}

@VersionNeutral()
class NeutralClass {
  @VersionNeutral()
  run(): void {}
}

void ClassVersion;
void MethodVersion;
void NeutralClass;

// @ts-expect-error — a declaration always serves at least one version
@Version()
class EmptyVersion {}
void EmptyVersion;

// @ts-expect-error — a header strategy always has a default
const headerWithoutDefault: VersionStrategy = { kind: 'header', name: 'accept-version' };
void headerWithoutDefault;

// @ts-expect-error — a path strategy cannot carry a default
const pathWithDefault: VersionStrategy = { kind: 'path', prefix: 'v', default: '1' };
void pathWithDefault;

const severalStrategies: RouterOptions = {
  // @ts-expect-error — one router has one strategy, never a precedence-ordered array
  versioning: [
    { kind: 'path', prefix: 'v' },
    { kind: 'header', name: 'accept-version', default: '1' },
  ],
};
void severalStrategies;

// @ts-expect-error — query-parameter extraction is not one of the frozen strategies
const queryStrategy: VersionStrategy = { kind: 'query', name: 'version', default: '1' };
void queryStrategy;
