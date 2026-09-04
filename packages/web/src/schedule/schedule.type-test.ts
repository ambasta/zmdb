// Compile-time half of #587. Replace the local declarations with imports when #589 lands.
type ScheduledMethod = () => void | Promise<void>;
type TaskDecorator = (target: ScheduledMethod, context: ClassMethodDecoratorContext) => void;

interface TaskOptions {
  readonly runs: 'once-per-replica' | 'once-per-cluster';
  readonly name?: string;
  readonly timeZone?: string;
  readonly timeoutMs?: number;
}

declare function Cron(expression: string, options: TaskOptions): TaskDecorator;

class ValidTasks {
  @Cron('0 0 3 * * *', { runs: 'once-per-cluster', timeZone: 'UTC' })
  nightly(): Promise<void> {
    return Promise.resolve();
  }
}

class InvalidTasks {
  // @ts-expect-error - a scheduled method receives no argument.
  @Cron('0 0 3 * * *', { runs: 'once-per-cluster' })
  withArgument(_when: Date): void {}

  // @ts-expect-error - no caller consumes a scheduled method's return value.
  @Cron('0 0 3 * * *', { runs: 'once-per-cluster' })
  returnsValue(): Promise<number> {
    return Promise.resolve(1);
  }

  // @ts-expect-error - runs is required because neither choice is a safe default.
  @Cron('0 0 3 * * *', { timeZone: 'UTC' })
  missingRuns(): void {}

  // @ts-expect-error - overlap is never a supported option.
  @Cron('0 0 3 * * *', { runs: 'once-per-replica', overlap: true })
  overlapping(): void {}
}

void ValidTasks;
void InvalidTasks;
