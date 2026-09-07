import { Module } from '@zmdb/app';
import { Interval } from '@zmdb/jobs';

@Module({ controllers: [] })
export class JobsApplication {}

export class ClusterTasks {
  constructor(readonly execute: (signal: AbortSignal) => Promise<void>) {}

  @Interval(10, { runs: 'once-per-cluster', name: 'qualified-task', timeoutMs: 1000 })
  async run(signal: AbortSignal): Promise<void> {
    await this.execute(signal);
  }
}
