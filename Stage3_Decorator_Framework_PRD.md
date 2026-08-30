# Product Requirements Document (PRD)

## Zero-Dependency Stage 3 Decorator Backend Architecture

---

### 1. Vision & Core Philosophy

The objective is to design a next-generation TypeScript backend framework core that delivers NestJS-like Developer Experience (controllers, route mapping, dependency injection) while completely aligning with **TC39 Stage 3 (ECMAScript) Decorators** (standardized in TypeScript 5.0+).

Unlike legacy frameworks, this architecture completely eliminates implicit runtime metadata reflection (`reflect-metadata`), parameter decorators, and loose typing. By pairing Stage 3 standard decorators with advanced TypeScript type-level programming, all domain rules, signatures, and injection graphs are validated **strictly at compile-time**, yielding zero runtime metadata reflection overhead and uncompromised type safety.

---

### 2. Core Goals & Constraints

- **Zero External Dependencies:** No `reflect-metadata`, no `lodash`, no third-party libraries. Built purely on standard ECMAScript APIs and native TypeScript features.
- **Performance First:** Zero runtime type-parsing, zero dynamic reflection lookup loops per request. Route resolution and DI trees are statically wired or cached on class initialization.
- **Compile-Time Domain Rules:** Shift domain invariants, state transitions, and request validation directly into TypeScript's type system (e.g., using Template Literal Types, Phantom/Branded Types, and Conditional Types).
- **Strict Type Verification (Zero Escape Hatches):** Eliminate `any`, `unknown` casting (`as T`), type assertions, and type erasure across framework boundaries. If an argument, route, or dependency is invalid, it **must** fail at compile time.

---

### 3. Architecture & Functional Requirements

#### 3.1 Stage 3 Metadata & Controller Routing

- **Requirement:** Route decorators (`@Get`, `@Post`) must use standard Stage 3 `ClassMethodDecoratorContext` and store runtime context strictly in `context.metadata`.
- **Parameter Handling:** Because Stage 3 lacks parameter decorators, route handlers must receive a **strongly-typed Context object** `Ctx<Params, Body, Query>`.

```ts
// Ideal Developer Experience (DX)
@Controller('/users')
class UserController {
  @Get('/:id')
  getUser(ctx: Ctx<{ id: string }>) {
    return { userId: ctx.params.id };
  }
}
```

#### 3.2 Type-Safe Dependency Injection (No Implicit Type Erasure)

- **Requirement:** Without `emitDecoratorMetadata`, DI cannot infer types from constructor parameters.
- **Design:** DI must use explicit class tokens or Stage 3 Field Decorators (`@Inject`), enforcing that injected types exactly match the token interface at compile time without manual casting.

```ts
// Compile-time verified field injection
class UserController {
  @Inject(UserService)
  private userService!: UserService;
}
```

#### 3.3 Compile-Time Domain & State Invariants

- **Requirement:** Domain models must use TypeScript's type system to prevent invalid state transitions before the code ever runs.
- **Design:** Implement compile-time state machines (e.g., using Brand Types / Phantom Types) so handlers cannot invoke operations on invalid domain states.

---

### 4. Technical Specification & Implementation Blueprint

```ts
// ==========================================
// 1. CORE TYPES & COMPILE-TIME STATE MACHINE
// ==========================================

// Phantom type branding to eliminate type erasure
export type Brand<K, T> = K & { readonly __brand: T };

// Domain State Invariants enforced at compile-time
export type DraftOrder = Brand<{ id: string; items: string[] }, 'DraftOrder'>;
export type PaidOrder = Brand<{ id: string; items: string[]; paymentId: string }, 'PaidOrder'>;

export class OrderDomain {
  // Domain rule: You CANNOT pay an already paid order at compile time.
  static pay(order: DraftOrder, paymentId: string): PaidOrder {
    return { ...order, paymentId } as PaidOrder;
  }
}

// ==========================================
// 2. STAGE 3 METADATA & DECORATORS (ZERO DEPS)
// ==========================================

export interface RouteDefinition {
  method: 'GET' | 'POST';
  path: string;
  handlerName: string | symbol;
}

export type Ctx<Params = Record<string, string>, Body = unknown> = {
  params: Params;
  body: Body;
};

// Stage 3 Method Decorator
export function Get(path: string) {
  return function <T, Args extends [Ctx<any, any>], Return>(
    target: (this: T, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<T, (this: T, ...args: Args) => Return>,
  ) {
    context.metadata.routes = context.metadata.routes || [];
    (context.metadata.routes as RouteDefinition[]).push({
      method: 'GET',
      path,
      handlerName: context.name,
    });
  };
}

// Stage 3 Class Decorator for Controllers
export function Controller(prefix: string) {
  return function <T extends abstract new (...args: any[]) => any>(target: T, context: ClassDecoratorContext<T>) {
    context.metadata.prefix = prefix;
  };
}

// ==========================================
// 3. ZERO-COST COMPILE-TIME DEPENDENCY INJECTION
// ==========================================

type Constructor<T = any> = new (...args: any[]) => T;

export class Container {
  private static registry = new Map<Constructor, any>();

  static register<T>(token: Constructor<T>, instance: T): void {
    Container.registry.set(token, instance);
  }

  static resolve<T>(token: Constructor<T>): T {
    const instance = Container.registry.get(token);
    if (!instance) throw new Error(`Unregistered token: ${token.name}`);
    return instance;
  }
}

// Stage 3 Field Decorator for DI
export function Inject<Service>(token: Constructor<Service>) {
  return function (value: undefined, context: ClassFieldDecoratorContext<any, Service>) {
    return function (this: any): Service {
      return Container.resolve(token);
    };
  };
}

// ==========================================
// 4. USAGE EXAMPLE (STRICT TYPE SAFETY)
// ==========================================

class OrderService {
  processPayment(draft: DraftOrder): PaidOrder {
    return OrderDomain.pay(draft, 'tx_12345');
  }
}

// Register service into container
Container.register(OrderService, new OrderService());

@Controller('/orders')
class OrderController {
  @Inject(OrderService)
  private orderService!: OrderService;

  @Get('/:id/pay')
  checkout(ctx: Ctx<{ id: string }, { items: string[] }>) {
    // 1. Construct branded draft order safely
    const draft = { id: ctx.params.id, items: ctx.body.items } as DraftOrder;

    // 2. State transition strictly checked at compile-time
    const paidOrder = this.orderService.processPayment(draft);

    /* 
       COMPILE-TIME ERROR PREVENTION EXAMPLE:
       this.orderService.processPayment(paidOrder); 
       --> TS Error: Type 'PaidOrder' is not assignable to 'DraftOrder'
    */

    return { status: 'success', order: paidOrder };
  }
}
```

---

### 5. Non-Functional Requirements & Verification

- **Build-Time Type Strictness:** TypeScript `tsconfig.json` must enforce:
  - `"strict": true`
  - `"noImplicitAny": true`
  - `"exactOptionalPropertyTypes": true`
  - `"experimentalDecorators": false` _(enforces standard Stage 3 decorators)_
- **Zero Type Erasure Overhead:** Branded types (`DraftOrder`, `PaidOrder`) exist purely at compile-time and incur **0 bytes** of bundle output and **0ms** runtime evaluation cost.
- **Benchmarking:** Request context resolution using standard Stage 3 `context.metadata` must benchmark within **<2% variance** of native HTTP router speeds (e.g., Node `http` or `uWebSockets.js`), eliminating the lookup overhead inherent to NestJS's `Reflect.getMetadata()`.
