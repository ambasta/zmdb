// Tests (#284) for modules & providers — RED first (modules exports absent).
// Module graph wiring, provider scopes, imports/exports visibility, cycle
// detection. Per packages/web/src/modules/SPEC.md.
import { describe, it, expect } from 'vitest';
import { createToken, Inject } from '../di/index.ts';
import { Module, compileModule } from './index.ts';

class Clock {
  now(): number {
    return 42;
  }
}
const ClockToken = createToken<Clock>('Clock');
const CounterToken = createToken<{ n: number }>('Counter');

@Module({
  providers: [{ token: ClockToken, useValue: new Clock() }],
  exports: [ClockToken],
})
class SharedModule {}

class TimeService {
  @Inject(ClockToken)
  clock!: Clock;
  read(): number {
    return this.clock.now();
  }
}

@Module({
  imports: [SharedModule],
  controllers: [TimeService],
  providers: [{ token: CounterToken, useFactory: () => ({ n: Math.random() }), scope: 'transient' }],
})
class AppModule {}

describe('@zmdb/web modules: compileModule', () => {
  it('builds controllers with providers resolved from imports', () => {
    const compiled = compileModule(AppModule);
    const svc = compiled.controllers.find((c) => c instanceof TimeService);
    expect(svc).toBeInstanceOf(TimeService);
    expect(svc instanceof TimeService ? svc.read() : 0).toBe(42);
  });

  it('resolves transient providers fresh each time; singletons cached', () => {
    const compiled = compileModule(AppModule);
    const a = compiled.container.resolve(CounterToken);
    const b = compiled.container.resolve(CounterToken);
    expect(a).not.toBe(b); // transient → different objects
    expect(compiled.container.resolve(ClockToken)).toBe(compiled.container.resolve(ClockToken)); // singleton
  });
});

describe('@zmdb/web modules: chains', () => {
  it('compiles an import chain without controllers', () => {
    @Module({})
    class Base {}
    @Module({ imports: [Base] })
    class Mid {}
    @Module({ imports: [Mid] })
    class Top {}
    expect(compileModule(Top).controllers).toEqual([]);
  });
});
