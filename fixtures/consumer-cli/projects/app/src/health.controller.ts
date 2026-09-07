import { Inject } from '@zmdb/app/di';
import { Controller, Get, Public } from '@zmdb/web/routing';

import { USERS, type RepositoryService } from './providers.js';
@Controller('/health')
export class HealthController {
  @Inject(USERS) users!: RepositoryService;
  @Public()
  @Get('/')
  health() {
    return { ok: true, users: this.users.list() };
  }
}
