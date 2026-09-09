export interface ConsumerFixture {
  readonly install: (role: string, packages: readonly string[]) => Promise<string>;
  readonly cleanup: () => Promise<unknown>;
}

export function createFixture(): Promise<ConsumerFixture>;
