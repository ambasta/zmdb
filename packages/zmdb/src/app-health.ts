// zmdb/app/health — curated protocol-neutral health facade.
export { databaseReadinessCheck } from '@zmdb/app/health';
export type {
  CheckResult,
  DatabaseReadinessOptions,
  DetailedCheck,
  HealthChecks,
  LivenessCheck,
  ReadinessCheck,
} from '@zmdb/app/health';
