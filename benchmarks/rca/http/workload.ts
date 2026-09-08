import {
  Controller,
  Get,
  Post,
  createRouter,
  text,
  toFetchHandler,
  toNodeHandler,
  validateWith,
  type Ctx,
} from '@zmdb/web';

import { assertUserCreate, type UserCreate } from '../../harness/framework/model.js';

const symbols: { metadata?: symbol } = Symbol;
if (symbols.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', { value: Symbol.for('Symbol.metadata') });
}

@Controller()
class Workload {
  @Get('/text')
  greeting() {
    return text('hello world');
  }

  @Get('/user/:id')
  user(ctx: Ctx<{ id: string }>) {
    return text(ctx.params.id);
  }

  @Post('/user')
  create(ctx: Ctx<Record<string, never>, UserCreate>) {
    return { name: ctx.body.name, email: ctx.body.email };
  }
}

const router = createRouter();
router.register(new Workload(), { create: { validateBody: validateWith(assertUserCreate) } });

export const nodeHandler = toNodeHandler(router);
export const fetchHandler = toFetchHandler(router);
