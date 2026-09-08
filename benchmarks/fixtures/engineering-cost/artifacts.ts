import type {
  EngineeringAssessment,
  EngineeringBucket,
  EngineeringCostArtifact,
  EngineeringCostPlan,
  EngineeringObservation,
} from '../../src/results.js';
import projects from './projects.json' with { type: 'json' };

// Deliberately synthetic: these are validator inputs, never measured claims.
export const consumed = JSON.stringify({
  diagnostics: [2322],
  completions: ['name'],
  renameLocations: 3,
  rows: 1,
  closed: true,
});
export async function checksum(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return bytes.toHex();
}
const consumedHash = await checksum(consumed);

const inputHashes: Record<string, string> = {};
for (const graph of Object.values(projects)) {
  for (const file of graph.files) inputHashes[file.source] = file.sha256;
}
const workloads: readonly [EngineeringBucket, string, 'cold' | 'primed' | 'warm'][] = [
  ['editor', 'load', 'cold'],
  ['editor', 'diagnostics', 'warm'],
  ['editor', 'completion', 'warm'],
  ['editor', 'quick-info', 'warm'],
  ['editor', 'rename', 'warm'],
  ['editor', 'affected-edit', 'warm'],
  ['typecheck', 'clean', 'cold'],
  ['typecheck', 'no-change', 'primed'],
  ['typecheck', 'affected-edit', 'primed'],
  ['typecheck', 'packed', 'cold'],
  ['build', 'clean', 'cold'],
  ['build', 'cached', 'primed'],
  ['distribution', 'pack', 'cold'],
  ['distribution', 'install-empty-cache', 'cold'],
  ['distribution', 'install-populated-cache', 'primed'],
  ['startup', 'import', 'cold'],
  ['startup', 'ready', 'cold'],
  ['startup', 'first-request', 'cold'],
  ['startup', 'first-query', 'cold'],
  ['runtime', 'validation', 'warm'],
  ['runtime', 'sql', 'warm'],
  ['runtime', 'persistence', 'warm'],
  ['runtime', 'http', 'warm'],
];

export function fixturePlan(): EngineeringCostPlan {
  return {
    version: 1,
    id: 'synthetic-engineering-contract',
    mode: 'comparative',
    repetitions: 20,
    orderSeed: 0,
    inputHashes: { ...inputHashes },
    targets: ['baseline', 'candidate'].map((id, index) => ({
      id,
      revision: String(index + 1).repeat(40),
      inputHashes: { ...inputHashes },
      dependencies: { zmdb: '1.0.0-alpha.4', typescript: '7.0.2', '@types/node': '26.4.1' },
    })),
    cells: workloads.map(([bucket, workload, cache]) => ({
      id: `${bucket}.${workload}`,
      bucket,
      graph: bucket === 'editor' ? 'small' : bucket === 'build' || bucket === 'typecheck' ? 'medium' : 'whole-product',
      cache,
      command: ['synthetic-fixture', `${bucket}.${workload}`],
      warmup: {
        kind: cache === 'cold' ? 'none' : bucket === 'runtime' ? 'milliseconds' : 'iterations',
        amount: cache === 'cold' ? 0 : bucket === 'runtime' ? 5000 : bucket === 'editor' ? 3 : 1,
      },
      metrics: [{ name: 'elapsed', unit: 'ms', direction: 'lower', maxRatio: 1.05, absoluteLimit: 200 }],
      consumedSha256: consumedHash,
      checks: ['correct-result', 'closed-resources'],
    })),
    analysis: { confidence: 0.95, resamples: 10000, seed: 740 },
  };
}

export async function fixtureArtifact(plan = fixturePlan()): Promise<EngineeringCostArtifact> {
  const observations: EngineeringObservation[] = [];
  const assessments: EngineeringAssessment[] = [];
  for (const cell of plan.cells) {
    for (let round = 0; round < plan.repetitions; round++) {
      for (const [targetIndex, target] of plan.targets.entries()) {
        const warmup = JSON.stringify(cell.warmup);
        const raw = JSON.stringify({ workload: cell.id, consumed });
        observations.push({
          cell: cell.id,
          target: target.id,
          round,
          position:
            (targetIndex - round - (plan.orderSeed % plan.targets.length) + plan.targets.length * plan.repetitions) %
            plan.targets.length,
          processId: 1000 + observations.length,
          startedAt: new Date(Date.UTC(2026, 8, 8, 0, 0, observations.length)).toISOString(),
          cache: cell.cache,
          command: [...cell.command],
          warmup: {
            kind: cell.warmup.kind,
            completed: cell.warmup.amount,
            raw: warmup,
            sha256: await checksum(warmup),
          },
          values: { elapsed: 100 },
          raw,
          rawSha256: await checksum(raw),
          consumed,
          consumedSha256: consumedHash,
          checks: [...cell.checks],
          exitCode: 0,
          cleaned: true,
        });
      }
    }
    for (const target of plan.targets.slice(1)) {
      for (const metric of cell.metrics)
        assessments.push({
          cell: cell.id,
          target: target.id,
          metric: metric.name,
          ratio: 1,
          interval: [1, 1],
          decision: 'pass',
        });
    }
  }
  return {
    version: 1,
    planSha256: await checksum(JSON.stringify(plan)),
    mode: plan.mode,
    origin: 'synthetic',
    inputHashes: { ...plan.inputHashes },
    targets: structuredClone(plan.targets),
    provenance: {
      cpu: 'synthetic CPU',
      cores: 2,
      ramBytes: 1024,
      storage: 'synthetic tmpfs',
      os: 'synthetic Linux',
      kernel: 'synthetic kernel',
      runtime: 'node 26.8.0',
      compiler: 'typescript 7.0.2',
      packageManager: 'npm 12.0.0',
      measurementTool: 'synthetic fixture v1',
      powerPolicy: 'synthetic fixed',
      environmentSha256: await checksum('{}'),
      environment: {},
      registryPolicy: 'synthetic archives; no network',
      database: 'synthetic SQLite',
      sampling: 'synthetic exact observations; no timer executed',
    },
    observations,
    assessments,
  };
}
