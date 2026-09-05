import { describe, expect, it } from 'vitest';

import { createApplication, Module, type ApplicationExtension } from './index.js';

describe('@zmdb/app application lifecycle', () => {
  it('runs init hooks in order and onShutdown on dispose (reversed)', async () => {
    const log: string[] = [];

    class First {
      onModuleInit(): void {
        log.push('init:first');
      }

      onApplicationBootstrap(): void {
        log.push('bootstrap:first');
      }

      onShutdown(): void {
        log.push('shutdown:first');
      }
    }

    class Second {
      onModuleInit(): void {
        log.push('init:second');
      }

      onApplicationBootstrap(): void {
        log.push('bootstrap:second');
      }

      onShutdown(): void {
        log.push('shutdown:second');
      }
    }

    @Module({ controllers: [First, Second] })
    class Root {}

    const extension: ApplicationExtension = {
      name: 'fixture',
      start() {
        log.push('start:fixture');
      },
      stop() {
        log.push('stop:fixture');
      },
    };
    const application = createApplication(Root, { extensions: [extension] });

    await application.init();
    expect(log).toEqual(['init:first', 'init:second', 'bootstrap:first', 'bootstrap:second', 'start:fixture']);

    await application[Symbol.asyncDispose]();
    expect(log.slice(-3)).toEqual(['stop:fixture', 'shutdown:second', 'shutdown:first']);
  });

  it('rolls back already-started extensions when a later extension fails', async () => {
    const log: string[] = [];
    const failure = new Error('later extension failed');

    @Module({ controllers: [] })
    class Root {}

    const application = createApplication(Root, {
      extensions: [
        {
          name: 'first',
          start() {
            log.push('start:first');
          },
          stop() {
            log.push('stop:first');
          },
        },
        {
          name: 'second',
          start() {
            log.push('start:second');
            throw failure;
          },
          stop() {
            log.push('stop:second');
          },
        },
      ],
    });

    await expect(application.init()).rejects.toBe(failure);
    expect(log).toEqual(['start:first', 'start:second', 'stop:second', 'stop:first']);
  });
});
