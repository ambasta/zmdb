import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checksum, consumed, fixtureArtifact, fixturePlan } from '../fixtures/engineering-cost/artifacts.js';
import transcript from '../fixtures/engineering-cost/editor-transcript.json' with { type: 'json' };
import projects from '../fixtures/engineering-cost/projects.json' with { type: 'json' };
import {
  engineeringPlanDigest,
  validateEngineeringArtifact,
  validateEngineeringPlan,
  type EngineeringObservation,
} from './results.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plan = fixturePlan();
const artifact = await fixtureArtifact(plan);
const emptyHash = await checksum('');
const acceptanceHash = await checksum('retained synthetic decision');
const consumedHash = await checksum(consumed);
const firstObservation = (change: (observation: EngineeringObservation) => unknown) => ({
  ...artifact,
  observations: artifact.observations.map((observation, index) => (index === 0 ? change(observation) : observation)),
});
const hasError = async (value: unknown, pattern: RegExp) =>
  expect(
    (await validateEngineeringArtifact(plan, value)).some(error => pattern.test(`${error.path}: ${error.message}`)),
  ).toBe(true);

function slowRuntime(decision: 'pass' | 'accepted-regression') {
  return {
    ...artifact,
    observations: artifact.observations.map(observation =>
      observation.cell === 'runtime.http' && observation.target === 'candidate'
        ? { ...observation, values: { elapsed: 150 } }
        : observation,
    ),
    assessments: artifact.assessments.map(assessment =>
      assessment.cell === 'runtime.http'
        ? {
            ...assessment,
            ratio: 1.5,
            interval: [1.5, 1.5],
            decision,
            ...(decision === 'accepted-regression'
              ? {
                  acceptance: {
                    issue: '#740-fixture',
                    owner: 'synthetic owner',
                    rationale: 'synthetic explicit regression decision',
                    evidenceSha256: acceptanceHash,
                  },
                }
              : {}),
          }
        : assessment,
    ),
  };
}

describe('engineering-cost frozen planning and raw artifacts', () => {
  it('pins small, medium and whole-product graphs by reference without executing a timed campaign', async () => {
    expect(Object.keys(projects)).toEqual(['small', 'medium', 'whole-product']);
    expect(projects.medium.producer.moduleCounts).toEqual([8, 64]);
    expect(projects['whole-product'].roots).toEqual(['zmdb', '@zmdb/jobs', '@zmdb/jobs-sqlite']);
    for (const graph of Object.values(projects)) {
      for (const file of graph.files)
        expect(await checksum(readFileSync(`${root}${file.source}`, 'utf8')), file.source).toBe(file.sha256);
    }
    expect(validateEngineeringPlan(plan)).toEqual([]);
    expect(await engineeringPlanDigest(plan)).toBe(await checksum(JSON.stringify(plan)));
  });

  it('replays the exact editor request/edit sequence and restores its source checksum', async () => {
    const original = readFileSync(new URL('../fixtures/engineering-cost/editor.input.txt', import.meta.url), 'utf8');
    let current = original;
    expect(transcript.map(request => request.command)).toEqual([
      'load',
      'diagnostics',
      'completion',
      'quickInfo',
      'rename',
      'edit',
      'diagnostics',
      'edit',
      'diagnostics',
      'close',
    ]);
    for (const [index, request] of transcript.entries()) {
      expect(request.seq).toBe(index + 1);
      if (request.anchor !== undefined) {
        expect(current.split(request.anchor)).toHaveLength(2);
        expect(request.offset).toBeGreaterThanOrEqual(0);
        expect(request.offset).toBeLessThanOrEqual(request.anchor.length);
      }
      if (request.replace !== undefined) {
        expect(current.split(request.replace.before)).toHaveLength(2);
        current = current.replace(request.replace.before, request.replace.after);
        expect(await checksum(current)).toBe(request.expected.sha256);
      }
    }
    expect(
      transcript.filter(request => request.command === 'diagnostics').map(request => request.expected.codes),
    ).toEqual([[], [2322], []]);
    expect(current).toBe(original);
  });

  it('accepts a complete explicitly synthetic artifact without asserting wall-clock performance', async () => {
    expect(artifact.origin).toBe('synthetic');
    expect(await validateEngineeringArtifact(plan, artifact)).toEqual([]);
  });

  it('accepts a caller-selected editor/typecheck plan while keeping artifact coverage subordinate to that plan', async () => {
    const selected = {
      ...plan,
      cells: plan.cells.filter(cell => cell.bucket === 'editor' || cell.bucket === 'typecheck'),
    };
    expect(validateEngineeringPlan(selected)).toEqual([]);
    expect(await validateEngineeringArtifact(selected, await fixtureArtifact(selected))).toEqual([]);
  });

  it.each([
    ['empty cells', { ...plan, cells: [] }],
    ['duplicate cell', { ...plan, cells: [...plan.cells, ...plan.cells] }],
    [
      'missing dependency versions',
      { ...plan, targets: plan.targets.map(target => ({ ...target, dependencies: {} })) },
    ],
    ['invalid source hash', { ...plan, inputHashes: { input: 'not-a-hash' } }],
    ['too few comparative samples', { ...plan, repetitions: 2 }],
    ['incomplete balanced round', { ...plan, repetitions: 21 }],
  ])('rejects invalid planning: %s', (_name, invalid) => {
    expect(validateEngineeringPlan(invalid).length).toBeGreaterThan(0);
  });

  it('rejects a result generated from changed source inputs', async () =>
    await hasError({ ...artifact, inputHashes: { ...artifact.inputHashes, changed: 'a'.repeat(64) } }, /inputHashes/));
  it('rejects a changed target source revision', async () =>
    await hasError(
      { ...artifact, targets: artifact.targets.map(target => ({ ...target, revision: 'f'.repeat(40) })) },
      /targets/,
    ));
  it('rejects dependency drift', async () =>
    await hasError(
      {
        ...artifact,
        targets: artifact.targets.map(target => ({
          ...target,
          dependencies: { ...target.dependencies, typescript: '7.0.3' },
        })),
      },
      /dependencies|targets/,
    ));
  it('rejects a different frozen plan', async () =>
    hasError({ ...artifact, planSha256: 'b'.repeat(64) }, /planSha256/));
  it('rejects an omitted slow bucket', async () =>
    await hasError(
      {
        ...artifact,
        observations: artifact.observations.filter(observation => !observation.cell.startsWith('runtime.')),
      },
      /missing|coverage/,
    ));
  it('rejects a missing sample', async () =>
    await hasError({ ...artifact, observations: artifact.observations.slice(1) }, /missing|coverage/));
  it('rejects duplicate samples masquerading as repetitions', async () =>
    await hasError(
      { ...artifact, observations: [...artifact.observations, ...artifact.observations.slice(0, 1)] },
      /duplicate/,
    ));
  it('rejects unbalanced target order', async () =>
    await hasError(
      {
        ...artifact,
        observations: artifact.observations.map(observation => ({
          ...observation,
          position: observation.target === 'baseline' ? 0 : 1,
        })),
      },
      /order|position/,
    ));
  it('rejects missing warmup provenance', async () =>
    await hasError(
      firstObservation(({ warmup: _warmup, ...observation }) => observation),
      /warmup/,
    ));
  it('rejects insufficient declared warmup', async () =>
    await hasError(
      {
        ...artifact,
        observations: artifact.observations.map(observation => ({
          ...observation,
          warmup: { ...observation.warmup, completed: 0 },
        })),
      },
      /warmup/,
    ));
  it('rejects an undisclosed cache or command change', async () =>
    await hasError(
      firstObservation(observation => ({ ...observation, cache: 'warm', command: ['different-command'] })),
      /cache|command/,
    ));
  it('rejects a workload whose result is not consumed', async () =>
    await hasError(
      firstObservation(observation => ({ ...observation, consumed: '', consumedSha256: emptyHash })),
      /consum/,
    ));
  it('rejects raw evidence with a stale checksum', async () =>
    await hasError(
      firstObservation(observation => ({ ...observation, raw: 'replaced output' })),
      /raw/,
    ));
  it('rejects omitted correctness checks', async () =>
    await hasError(
      firstObservation(observation => ({ ...observation, checks: [] })),
      /checks/,
    ));
  it('rejects leaked resources and failed commands', async () =>
    await hasError(
      firstObservation(observation => ({ ...observation, cleaned: false, exitCode: 1 })),
      /cleaned|exitCode/,
    ));
  it.each([NaN, Infinity, -1])(
    'rejects invalid numeric evidence %s',
    async value =>
      await hasError(
        firstObservation(observation => ({ ...observation, values: { elapsed: value } })),
        /values|finite/,
      ),
  );
  it('rejects missing machine/compiler provenance', async () => {
    const { compiler: _compiler, ...provenance } = artifact.provenance;
    await hasError({ ...artifact, provenance }, /provenance/);
  });
  it('rejects CI smoke represented as comparative evidence', async () =>
    hasError({ ...artifact, mode: 'smoke' }, /mode/));
  it('rejects unexplained regressions even if every other bucket is faster', async () =>
    await hasError(slowRuntime('pass'), /regression|decision|budget/));
  it('retains a specifically accepted regression without relabelling it as a passing result', async () =>
    expect(await validateEngineeringArtifact(plan, slowRuntime('accepted-regression'))).toEqual([]));
  it('rejects a fabricated favorable summary over slower raw observations', async () =>
    await hasError({ ...slowRuntime('pass'), assessments: artifact.assessments }, /ratio|raw|regression/));
  it('rejects missing per-cell decisions', async () =>
    await hasError({ ...artifact, assessments: artifact.assessments.slice(1) }, /assessment|missing/));
  it('retains an inconclusive interval without presenting it as a pass', async () => {
    const assessments = artifact.assessments.map(assessment => ({
      ...assessment,
      interval: [1, 1.1],
      decision: 'inconclusive',
    }));
    expect(await validateEngineeringArtifact(plan, { ...artifact, assessments })).toEqual([]);
    await hasError(
      { ...artifact, assessments: assessments.map(assessment => ({ ...assessment, decision: 'pass' })) },
      /decision|inconclusive/,
    );
  });
  it.each([null, [], 'not an artifact', {}])(
    'rejects malformed raw artifact %s without throwing',
    async value => await hasError(value, /artifact|version|provenance/),
  );
  it('uses a fixed consumed-result oracle rather than an elapsed-time assertion', async () => {
    expect(JSON.parse(consumed)).toEqual({
      diagnostics: [2322],
      completions: ['name'],
      renameLocations: 3,
      rows: 1,
      closed: true,
    });
    expect(plan.cells.every(cell => cell.consumedSha256 === consumedHash)).toBe(true);
  });
});
