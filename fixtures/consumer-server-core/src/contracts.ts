import { createApplication, type Application, type ApplicationExtension } from '@zmdb/app';
import { createCommandApp } from '@zmdb/app/commands';
import { createCommandBus } from '@zmdb/app/cqrs';
import { repositoryToken } from '@zmdb/app/data';
import { Container } from '@zmdb/app/di';
import { createEvents } from '@zmdb/app/events';
import { databaseReadinessCheck } from '@zmdb/app/health';
import type { OnShutdown } from '@zmdb/app/lifecycle';
import { createMessageDispatcher } from '@zmdb/app/messaging';
import { Module } from '@zmdb/app/modules';
import { SpanKind } from '@zmdb/app/observability';
import { defineState } from '@zmdb/app/state';
import { Controller } from '@zmdb/web';
import { createApp, type WebApplication } from '@zmdb/web/app';
import { compress } from '@zmdb/web/compression';
import { extractParams } from '@zmdb/web/context';
import { defineHttpContract } from '@zmdb/web/contract';
import { compileHttpContracts } from '@zmdb/web/contract/compiler';
import { createCsrf } from '@zmdb/web/csrf';
import { validateWith } from '@zmdb/web/data';
import { describeGraph } from '@zmdb/web/devtools';
import { validationPipe } from '@zmdb/web/dto-pipes';
import { Gateway } from '@zmdb/web/gateways';
import { healthRoutes } from '@zmdb/web/health';
import { runChain } from '@zmdb/web/middleware';
import { toOpenApi } from '@zmdb/web/openapi';
import { createRouter } from '@zmdb/web/pipeline';
import { Get } from '@zmdb/web/routing';
import { createStaticHandler } from '@zmdb/web/static';
import { createTestApp } from '@zmdb/web/testing';
import { parseMultipart } from '@zmdb/web/upload';
import { Version } from '@zmdb/web/versioning';
import { createApplication as facadeCreateApplication } from 'zmdb/app';
import { createCommandApp as facadeCreateCommandApp } from 'zmdb/app/commands';
import { createCommandBus as facadeCreateCommandBus } from 'zmdb/app/cqrs';
import { repositoryToken as facadeRepositoryToken } from 'zmdb/app/data';
import { Container as FacadeContainer } from 'zmdb/app/di';
import { createEvents as facadeCreateEvents } from 'zmdb/app/events';
import { databaseReadinessCheck as facadeDatabaseReadinessCheck } from 'zmdb/app/health';
import type { OnShutdown as FacadeOnShutdown } from 'zmdb/app/lifecycle';
import { createMessageDispatcher as facadeCreateMessageDispatcher } from 'zmdb/app/messaging';
import { Module as FacadeModule } from 'zmdb/app/modules';
import { SpanKind as FacadeSpanKind } from 'zmdb/app/observability';
import { defineState as facadeDefineState } from 'zmdb/app/state';
import { Controller as FacadeController } from 'zmdb/web';
import { createApp as facadeCreateApp } from 'zmdb/web/app';
import { compress as facadeCompress } from 'zmdb/web/compression';
import { extractParams as facadeExtractParams } from 'zmdb/web/context';
import { defineHttpContract as facadeDefineHttpContract } from 'zmdb/web/contract';
import { compileHttpContracts as facadeCompileHttpContracts } from 'zmdb/web/contract/compiler';
import { createCsrf as facadeCreateCsrf } from 'zmdb/web/csrf';
import { validateWith as facadeValidateWith } from 'zmdb/web/data';
import { describeGraph as facadeDescribeGraph } from 'zmdb/web/devtools';
import { validationPipe as facadeValidationPipe } from 'zmdb/web/dto-pipes';
import { Gateway as FacadeGateway } from 'zmdb/web/gateways';
import { healthRoutes as facadeHealthRoutes } from 'zmdb/web/health';
import { runChain as facadeRunChain } from 'zmdb/web/middleware';
import { toOpenApi as facadeToOpenApi } from 'zmdb/web/openapi';
import { createRouter as facadeCreateRouter } from 'zmdb/web/pipeline';
import { Get as FacadeGet } from 'zmdb/web/routing';
import { createStaticHandler as facadeCreateStaticHandler } from 'zmdb/web/static';
import { createTestApp as facadeCreateTestApp } from 'zmdb/web/testing';
import { parseMultipart as facadeParseMultipart } from 'zmdb/web/upload';
import { Version as FacadeVersion } from 'zmdb/web/versioning';

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

export type _ApplicationInit = Expect<Equal<ReturnType<Application['init']>, Promise<void>>>;
export type _ApplicationDispose = Expect<Equal<ReturnType<Application[typeof Symbol.asyncDispose]>, PromiseLike<void>>>;
export type _ExtensionStart = Expect<Equal<ReturnType<ApplicationExtension['start']>, void | Promise<void>>>;
export type _WebExtendsApplication = Expect<WebApplication extends Application ? true : false>;
export type _FacadeLifecycleIdentity = Expect<FacadeOnShutdown extends OnShutdown ? true : false>;

void [
  createApplication,
  createCommandApp,
  createCommandBus,
  repositoryToken,
  Container,
  createEvents,
  databaseReadinessCheck,
  createMessageDispatcher,
  Module,
  SpanKind,
  defineState,
  Controller,
  createApp,
  compress,
  extractParams,
  defineHttpContract,
  compileHttpContracts,
  createCsrf,
  validateWith,
  describeGraph,
  validationPipe,
  Gateway,
  healthRoutes,
  runChain,
  toOpenApi,
  createRouter,
  Get,
  createStaticHandler,
  createTestApp,
  parseMultipart,
  Version,
  facadeCreateApplication,
  facadeCreateCommandApp,
  facadeCreateCommandBus,
  facadeRepositoryToken,
  FacadeContainer,
  facadeCreateEvents,
  facadeDatabaseReadinessCheck,
  facadeCreateMessageDispatcher,
  FacadeModule,
  FacadeSpanKind,
  facadeDefineState,
  FacadeController,
  facadeCreateApp,
  facadeCompress,
  facadeExtractParams,
  facadeDefineHttpContract,
  facadeCompileHttpContracts,
  facadeCreateCsrf,
  facadeValidateWith,
  facadeDescribeGraph,
  facadeValidationPipe,
  FacadeGateway,
  facadeHealthRoutes,
  facadeRunChain,
  facadeToOpenApi,
  facadeCreateRouter,
  FacadeGet,
  facadeCreateStaticHandler,
  facadeCreateTestApp,
  facadeParseMultipart,
  FacadeVersion,
];

interface ShutdownParticipant extends OnShutdown {
  readonly name: string;
}

const participant: ShutdownParticipant = {
  name: 'consumer',
  onShutdown() {},
};
void participant;
