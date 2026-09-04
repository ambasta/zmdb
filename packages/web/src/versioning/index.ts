// @zmdb/web — API version declarations (epic #572, spec ./SPEC.md).
// Stage-3 class/method decorators write one private metadata value; the router
// reads it once at registration. No reflect-metadata and no runtime reflection.

import '../polyfill.js';

/** The one version source configured for a router. */
export type VersionStrategy =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'header'; readonly name: string; readonly default: string }
  | { readonly kind: 'media-type'; readonly key: string; readonly default: string };

type ControllerClass = abstract new (...args: never[]) => unknown;
type ControllerMethod = (...args: never[]) => unknown;
type VersionDeclaration = readonly string[] | 'neutral';

/** A Stage-3 decorator that can be applied to a controller or one handler. */
interface VersionDecorator {
  <T extends ControllerClass>(target: T, context: ClassDecoratorContext<T>): void;
  (target: ControllerMethod, context: ClassMethodDecoratorContext): void;
}

const CONTROLLER_VERSION = Symbol('zmdb.web.controller-version');
const HANDLER_VERSIONS = Symbol('zmdb.web.handler-versions');

interface VersionMetadata {
  [CONTROLLER_VERSION]?: VersionDeclaration;
  [HANDLER_VERSIONS]?: Map<string, VersionDeclaration>;
}

// boundary: these private symbol slots are written only by the decorators below.
function versionView(metadata: DecoratorMetadata): VersionMetadata {
  return metadata;
}

function ownHandlerVersions(metadata: DecoratorMetadata): Map<string, VersionDeclaration> | undefined {
  return Object.hasOwn(metadata, HANDLER_VERSIONS) ? versionView(metadata)[HANDLER_VERSIONS] : undefined;
}

function recordVersion(
  declaration: VersionDeclaration,
  context: ClassDecoratorContext<ControllerClass> | ClassMethodDecoratorContext,
): void {
  if (context.kind === 'class') {
    versionView(context.metadata)[CONTROLLER_VERSION] = declaration;
    return;
  }

  const name = typeof context.name === 'string' ? context.name : context.name.toString();
  const handlers = ownHandlerVersions(context.metadata);
  if (handlers === undefined) {
    versionView(context.metadata)[HANDLER_VERSIONS] = new Map([[name, declaration]]);
  } else {
    handlers.set(name, declaration);
  }
}

function decoratorFor(declaration: VersionDeclaration): VersionDecorator {
  function decorate<T extends ControllerClass>(_target: T, context: ClassDecoratorContext<T>): void;
  function decorate(_target: ControllerMethod, context: ClassMethodDecoratorContext): void;
  function decorate(
    _target: ControllerClass | ControllerMethod,
    context: ClassDecoratorContext<ControllerClass> | ClassMethodDecoratorContext,
  ): void {
    recordVersion(declaration, context);
  }
  return decorate;
}

/** Declare the versions a controller or handler serves. */
export function Version(...versions: readonly [string, ...string[]]): VersionDecorator {
  return decoratorFor(Object.freeze([...versions]));
}

/** Declare that a controller or handler has the same behaviour in every version. */
export function VersionNeutral(): VersionDecorator {
  return decoratorFor('neutral');
}

/**
 * Read the declaration effective for one handler.
 *
 * A method declaration wins over every class declaration, including when the
 * method is inherited. Otherwise the nearest class declaration wins.
 */
export function versionsOf(controller: ControllerClass, handlerName: string): VersionDeclaration | undefined {
  const metadata = controller[Symbol.metadata];
  if (metadata === undefined || metadata === null) {
    return undefined;
  }

  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    const handlers = ownHandlerVersions(record);
    if (handlers?.has(handlerName) === true) {
      return handlers.get(handlerName);
    }
  }

  for (let record: DecoratorMetadata | null = metadata; record !== null; record = Object.getPrototypeOf(record)) {
    if (Object.hasOwn(record, CONTROLLER_VERSION)) {
      return versionView(record)[CONTROLLER_VERSION];
    }
  }

  return undefined;
}
