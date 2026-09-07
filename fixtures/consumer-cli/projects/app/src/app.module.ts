import { Module, lazy } from '@zmdb/app/modules';

import { HealthController } from './health.controller.js';
import { ADMIN, DATABASE, USERS, event } from './providers.js';
@Module({ providers: [{ token: ADMIN, useValue: { enabled: true } }] })
export class AdminModule {}
@Module({
  imports: [lazy(AdminModule)],
  providers: [
    {
      token: DATABASE,
      useFactory() {
        event('factory:database');
        return {
          name: 'fixture',
          onModuleInit() {
            event('init:database');
          },
          onShutdown() {
            event('shutdown:database');
          },
        };
      },
    },
    {
      token: USERS,
      useFactory(container) {
        event('factory:repository');
        const db = container.resolve(DATABASE);
        return {
          list: () => `users@${db.name}`,
          onModuleInit() {
            event('init:repository');
          },
          onShutdown() {
            event('shutdown:repository');
          },
        };
      },
    },
  ],
  controllers: [HealthController],
})
export class AppModule {}
