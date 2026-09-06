// Compile-only freeze for the app/web/jobs package split (#646).
//
// The local declarations below transcribe the exact shared lifecycle ABI from
// the #645 SPECs. App and web retain their product facades; jobs remains a
// package-owned selected capability.

import type {
  Application as AppPackageApplication,
  ApplicationOptions as AppPackageApplicationOptions,
} from '@zmdb/app';
import type { Worker as JobsPackageWorker } from '@zmdb/jobs';
import type { Equal, Expect } from '@zmdb/schema-core';
import type {
  // @ts-expect-error #649 deletes the compatibility application name
  App as RemovedWebApp,
  // @ts-expect-error #649 keeps transport-shaped options out of HTTP
  AppOptions as RemovedWebAppOptions,
  createApp as webCreateApp,
  WebApplication as WebPackageApplication,
  WebApplicationOptions as WebPackageApplicationOptions,
} from '@zmdb/web/app';
import type { Application as AppFacadeApplication } from 'zmdb/app';
// @ts-expect-error selected jobs intentionally has no product facade
import type { Worker as ForbiddenJobsFacadeWorker } from 'zmdb/jobs';

interface FrozenContainer {}
interface FrozenLazyModuleHandle {
  readonly name: string;
  readonly status: 'unloaded' | 'loading' | 'loaded' | 'failed';
  load(): Promise<void>;
}
interface FrozenObservability {}
type FrozenModuleClass = abstract new (...args: never[]) => unknown;
interface FrozenGuardRegistry {}
type FrozenVersionStrategy = (request: FrozenWebRequest) => string | undefined;

interface FrozenApplicationExtensionContext {
  readonly container: FrozenContainer;
  readonly controllers: readonly object[];
  readonly commands: readonly object[];
  readonly observability: FrozenObservability;
}

interface FrozenApplicationExtension {
  readonly name: string;
  start(context: FrozenApplicationExtensionContext): void | Promise<void>;
  stop(options: { readonly graceMs: number }): void | Promise<void>;
}

interface FrozenApplicationOptions {
  readonly extensions?: readonly FrozenApplicationExtension[];
  readonly observability?: FrozenObservability;
  readonly graceMs?: number;
}

interface FrozenApplication extends AsyncDisposable {
  readonly container: FrozenContainer;
  readonly lazy: readonly FrozenLazyModuleHandle[];
  init(): Promise<void>;
}

type FrozenCreateApplication = (rootModule: FrozenModuleClass, options?: FrozenApplicationOptions) => FrozenApplication;

interface FrozenWebRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

interface FrozenWebResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

interface FrozenWebApplicationOptions extends FrozenApplicationOptions {
  readonly maxBodySize?: number;
  readonly maxBodyBytes?: number;
  readonly guardRegistry?: FrozenGuardRegistry;
  readonly versioning?: FrozenVersionStrategy;
}

interface FrozenWebApplication extends FrozenApplication {
  handle(request: FrozenWebRequest): Promise<FrozenWebResponse>;
  fetch(request: Request): Promise<Response>;
}

type FrozenCreateApp = (rootModule: FrozenModuleClass, options?: FrozenWebApplicationOptions) => FrozenWebApplication;
type PublishedCreateApp = typeof webCreateApp;

export type _ApplicationKeys = Expect<
  Equal<keyof FrozenApplication, 'container' | 'init' | 'lazy' | typeof Symbol.asyncDispose>
>;
export type _ApplicationOptionsKeys = Expect<
  Equal<keyof FrozenApplicationOptions, 'extensions' | 'graceMs' | 'observability'>
>;
export type _ApplicationContextKeys = Expect<
  Equal<keyof FrozenApplicationExtensionContext, 'commands' | 'container' | 'controllers' | 'observability'>
>;
export type _ExtensionKeys = Expect<Equal<keyof FrozenApplicationExtension, 'name' | 'start' | 'stop'>>;
export type _ExtensionStartReturn = Expect<
  Equal<ReturnType<FrozenApplicationExtension['start']>, void | Promise<void>>
>;
export type _ExtensionStopParameter = Expect<
  Equal<Parameters<FrozenApplicationExtension['stop']>, [{ readonly graceMs: number }]>
>;
export type _CreateApplicationParameters = Expect<
  Equal<Parameters<FrozenCreateApplication>, [FrozenModuleClass, (FrozenApplicationOptions | undefined)?]>
>;
export type _CreateApplicationReturn = Expect<Equal<ReturnType<FrozenCreateApplication>, FrozenApplication>>;
export type _WebApplicationExtendsApplication = Expect<FrozenWebApplication extends FrozenApplication ? true : false>;
export type _WebApplicationOwnKeys = Expect<
  Equal<Exclude<keyof FrozenWebApplication, keyof FrozenApplication>, 'fetch' | 'handle'>
>;
export type _WebOptionsOwnKeys = Expect<
  Equal<
    Exclude<keyof FrozenWebApplicationOptions, keyof FrozenApplicationOptions>,
    'guardRegistry' | 'maxBodyBytes' | 'maxBodySize' | 'versioning'
  >
>;
export type _CreateAppParameters = Expect<
  Equal<Parameters<FrozenCreateApp>, [FrozenModuleClass, (FrozenWebApplicationOptions | undefined)?]>
>;
export type _CreateAppReturn = Expect<Equal<ReturnType<FrozenCreateApp>, FrozenWebApplication>>;
export type _PublishedWebApplicationExtendsApplication = Expect<
  WebPackageApplication extends AppPackageApplication ? true : false
>;
export type _PublishedWebApplicationOwnKeys = Expect<
  Equal<Exclude<keyof WebPackageApplication, keyof AppPackageApplication>, 'fetch' | 'handle'>
>;
export type _PublishedWebOptionsOwnKeys = Expect<
  Equal<
    keyof WebPackageApplicationOptions,
    keyof AppPackageApplicationOptions | 'guardRegistry' | 'maxBodyBytes' | 'maxBodySize' | 'versioning'
  >
>;
export type _PublishedCreateAppParameters = Expect<
  Equal<Parameters<PublishedCreateApp>, [FrozenModuleClass, (WebPackageApplicationOptions | undefined)?]>
>;
export type _PublishedCreateAppReturn = Expect<Equal<ReturnType<PublishedCreateApp>, WebPackageApplication>>;
export type _AppFacadeIdentity = Expect<Equal<AppFacadeApplication, AppPackageApplication>>;
export type _PackageRetirementTriggers = [
  AppPackageApplication,
  JobsPackageWorker,
  RemovedWebApp,
  RemovedWebAppOptions,
  AppFacadeApplication,
  ForbiddenJobsFacadeWorker,
];
