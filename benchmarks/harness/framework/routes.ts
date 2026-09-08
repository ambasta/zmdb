import {
  Controller,
  Get,
  Post,
  createRouter,
  getRoutes,
  respond,
  text,
  validateWith,
  type Ctx,
} from '../../../packages/web/src/index.js';
import { assertUserCreate, type UserCreate } from './model.js';

// Ensure the well-known Symbol.metadata exists before the decorated class is
// evaluated. @zmdb/web ships this polyfill, but the package is `sideEffects:
// false`, so a bundler may tree-shake the side-effect import — we install it
// explicitly here (a no-op once a runtime ships Symbol.metadata natively).
interface SymbolWithMetadata {
  metadata?: symbol;
}
const symbolCarrier: SymbolWithMetadata = Symbol;
if (symbolCarrier.metadata === undefined) {
  Object.defineProperty(Symbol, 'metadata', {
    value: Symbol.for('Symbol.metadata'),
    configurable: true,
  });
}

// --- AOT-compiled validation ------------------------------------------------
// Nothing is compiled here, which is the point. `assertUserCreate` is already the
// emitted check for `CreateDTO<User>`; `validateWith` only adapts its throw into
// @zmdb/web's validateBody hook shape.
//
// Two earlier versions of this line are worth remembering, because each was a
// weaker claim. The first derived the descriptor in this file — a `columnKind`
// switch over `SqlType` and a `createDtoDescriptor` that re-implemented "drop the
// auto-increment columns" — so the benchmark measured a validator no user gets. The
// second fixed that by reading `objectTypeFromIR(UserSchema.ir, 'create')` at boot,
// which was the same descriptor the repository builds, but still a
// descriptor walked per request. This one is neither: the shape is the control flow
// (REQ-TF-9).
const validateUserCreate = validateWith<UserCreate>(assertUserCreate);

// An empty 2xx: no body and, deliberately, no content-type. The suite asserts the
// body is byte-empty and never looks at the content type (`v/vanilla_epoll`
// passes while announcing application/json for the same empty response).
const EMPTY = respond({ status: 200 });

@Controller()
class BenchmarkController {
  @Get('/')
  root() {
    return EMPTY;
  }

  @Get('/user/:id')
  getUser(ctx: Ctx<{ id: string }>) {
    // `text`, not a plain return: the contract wants the three bytes of `0`, and
    // a JSON-serialised string would be `"0"`.
    return text(ctx.params.id);
  }

  @Post('/user')
  createUser() {
    return EMPTY;
  }
}

const controller = new BenchmarkController();
export const routes = getRoutes(BenchmarkController);

// The framework's own dispatcher, not a re-implementation of it: register()
// resolves the route table and compiles each pattern once at boot, and handle()
// buckets by (method, segment count) per request.
//
// Validation is registered as the route's `validateBody` hook so it runs where a
// user's would — before the handler, inside the pipeline. The contract's POST
// body is empty, so `undefined` passes straight through; a real payload is
// checked by the compiled validator derived from the `User` interface.
export const router = createRouter();
router.register(controller, {
  createUser: {
    validateBody: (raw: unknown) => (raw === undefined ? undefined : validateUserCreate(raw)),
  },
});
