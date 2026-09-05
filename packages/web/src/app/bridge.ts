import type { Application, ApplicationOptions, CompiledModule, Constructor } from '@zmdb/app';

const APPLICATION_BRIDGE = Symbol.for('@zmdb/app.application-bridge');
const COMPILED_APPLICATION = Symbol.for('@zmdb/app.compiled-application');

export type CompiledController =
  | { readonly kind: 'eager'; readonly controller: object }
  | {
      readonly kind: 'deferred';
      readonly controller: Constructor<object>;
      readonly instance: () => Promise<object>;
    };

interface ApplicationBridge {
  readonly controllers: readonly CompiledController[];
}

interface BridgedApplication extends Application {
  readonly [APPLICATION_BRIDGE]?: ApplicationBridge;
}

interface CompiledApplicationOptions {
  readonly [COMPILED_APPLICATION]?: CompiledModule;
}

export function applicationControllersOf(application: Application): readonly CompiledController[] {
  const carrier: BridgedApplication = application;
  const bridge = carrier[APPLICATION_BRIDGE];
  if (bridge === undefined) {
    throw new Error('@zmdb/web: application omitted its controller graph');
  }
  return bridge.controllers;
}

export function withCompiledApplication(options: ApplicationOptions, compiled: CompiledModule): ApplicationOptions {
  const carrier: ApplicationOptions & CompiledApplicationOptions = { ...options };
  Object.defineProperty(carrier, COMPILED_APPLICATION, { value: compiled });
  return carrier;
}
