// @zmdb/benchmarks — results schema + report helpers (#69, #72).
// `validateResult` below is the frozen schema: every in-scope case must appear
// for every target, as `ok` (with ops/sec) or `dnf` (with a reason) — never
// silently omitted.

export type ResultStatus = 'ok' | 'dnf';

// The two optional members admit `undefined` explicitly: a `dnf` row *has* no
// ops/sec, and under `exactOptionalPropertyTypes` a bare `?: number` rejects
// writing that fact down as `opsPerSec: undefined` (only omitting the key is
// allowed). Since `validateResult` keys off `typeof r.opsPerSec !== 'number'`,
// both spellings are equally valid input and the type should say so.
export interface BenchResult {
  readonly suite: 'validation' | 'orm';
  readonly case: string;
  readonly target: string;
  readonly status: ResultStatus;
  readonly opsPerSec?: number | undefined;
  readonly dnfReason?: string | undefined;
}

// The set of in-scope case ids per suite (frozen in SPEC.md). Every in-scope
// case MUST appear (as ok or dnf) for a given target — never silently omitted.
export const IN_SCOPE_CASES: Readonly<Record<'validation' | 'orm', readonly string[]>> = Object.freeze({
  validation: Object.freeze(['safe-parse', 'strict-parse', 'loose-assert', 'strict-assert']),
  orm: Object.freeze([
    'customer-by-id',
    'products-search',
    'order-with-items',
    'top-products',
    'prepared-reuse',
    'lazy-relation-graph',
    'identity-map-dedup',
    'active-record-save',
  ]),
});

export interface SchemaError {
  readonly path: string;
  readonly message: string;
}

// Validate a single result record against the frozen schema rules.
export function validateResult(r: BenchResult): readonly SchemaError[] {
  const errors: SchemaError[] = [];
  if (r.status === 'ok' && typeof r.opsPerSec !== 'number') {
    errors.push({ path: `${r.suite}.${r.case}.${r.target}`, message: 'ok result must carry opsPerSec' });
  }
  if (r.status === 'dnf' && (!r.dnfReason || r.dnfReason.length === 0)) {
    errors.push({ path: `${r.suite}.${r.case}.${r.target}`, message: 'dnf result must carry a non-empty dnfReason' });
  }
  return errors;
}

// Validate that a target's result set covers EVERY in-scope case for a suite
// (each present as ok or dnf). Returns errors for missing/duplicate cases.
export function validateCoverage(
  suite: 'validation' | 'orm',
  target: string,
  results: readonly BenchResult[],
): readonly SchemaError[] {
  const errors: SchemaError[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.suite !== suite || r.target !== target) continue;
    if (seen.has(r.case)) {
      errors.push({ path: `${suite}.${r.case}.${target}`, message: `duplicate case "${r.case}"` });
    }
    seen.add(r.case);
  }
  for (const c of IN_SCOPE_CASES[suite]) {
    if (!seen.has(c)) {
      errors.push({
        path: `${suite}.${c}.${target}`,
        message: `in-scope case "${c}" is missing (must be ok or dnf, never silently omitted)`,
      });
    }
  }
  return errors;
}

// Engineering-cost artifacts (#740). A caller supplies the required plan; an
// artifact cannot declare its own coverage. Existing BenchResult stays unchanged.
export type EngineeringBucket = 'editor' | 'typecheck' | 'build' | 'distribution' | 'startup' | 'runtime';
export type EngineeringMode = 'smoke' | 'comparative';

export interface EngineeringMetric {
  readonly name: string;
  readonly unit: 'ms' | 'bytes' | 'count' | 'ops/s';
  readonly direction: 'lower' | 'higher';
  readonly maxRatio: number;
  readonly absoluteLimit?: number;
}

export interface EngineeringCell {
  readonly id: string;
  readonly bucket: EngineeringBucket;
  readonly graph: string;
  readonly cache: 'cold' | 'primed' | 'warm';
  readonly command: readonly string[];
  readonly warmup: { readonly kind: 'none' | 'iterations' | 'milliseconds'; readonly amount: number };
  readonly metrics: readonly EngineeringMetric[];
  readonly consumedSha256: string;
  readonly checks: readonly string[];
}

export interface EngineeringTarget {
  readonly id: string;
  readonly revision: string;
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
}

export interface EngineeringCostPlan {
  readonly version: 1;
  readonly id: string;
  readonly mode: EngineeringMode;
  readonly repetitions: number;
  readonly orderSeed: number;
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly targets: readonly EngineeringTarget[];
  readonly cells: readonly EngineeringCell[];
  readonly analysis: { readonly confidence: 0.95; readonly resamples: 10000; readonly seed: number };
}

export interface EngineeringProvenance {
  readonly cpu: string;
  readonly cores: number;
  readonly ramBytes: number;
  readonly storage: string;
  readonly os: string;
  readonly kernel: string;
  readonly runtime: string;
  readonly compiler: string;
  readonly packageManager: string;
  readonly measurementTool: string;
  readonly powerPolicy: string;
  readonly environmentSha256: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly registryPolicy: string;
  readonly database: string;
  readonly sampling: string;
}

export interface EngineeringObservation {
  readonly cell: string;
  readonly target: string;
  readonly round: number;
  readonly position: number;
  readonly processId: number;
  readonly startedAt: string;
  readonly cache: EngineeringCell['cache'];
  readonly command: readonly string[];
  readonly warmup: {
    readonly kind: EngineeringCell['warmup']['kind'];
    readonly completed: number;
    readonly raw: string;
    readonly sha256: string;
  };
  readonly values: Readonly<Record<string, number>>;
  readonly raw: string;
  readonly rawSha256: string;
  readonly consumed: string;
  readonly consumedSha256: string;
  readonly checks: readonly string[];
  readonly exitCode: number;
  readonly cleaned: boolean;
}

export interface EngineeringAssessment {
  readonly cell: string;
  readonly target: string;
  readonly metric: string;
  readonly ratio: number;
  readonly interval: readonly [number, number];
  readonly decision: 'pass' | 'regression' | 'inconclusive' | 'accepted-regression';
  readonly acceptance?: {
    readonly issue: string;
    readonly owner: string;
    readonly rationale: string;
    readonly evidenceSha256: string;
  };
}

export interface EngineeringCostArtifact {
  readonly version: 1;
  readonly planSha256: string;
  readonly mode: EngineeringMode;
  readonly origin: 'synthetic' | 'measured';
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly targets: readonly EngineeringTarget[];
  readonly provenance: EngineeringProvenance;
  readonly observations: readonly EngineeringObservation[];
  readonly assessments: readonly EngineeringAssessment[];
}

// The transcript describes editor operations, not one vendor's wire framing.
// #741 owns translating these exact anchors/edits into its recorded protocol calls.
export interface EngineeringEditorRequest {
  readonly seq: number;
  readonly command: 'load' | 'diagnostics' | 'completion' | 'quickInfo' | 'rename' | 'edit' | 'close';
  readonly file: string;
  readonly anchor?: string;
  readonly offset?: number;
  readonly replace?: { readonly before: string; readonly after: string };
  readonly expected: {
    readonly project?: string;
    readonly codes?: readonly number[];
    readonly includes?: readonly string[];
    readonly locations?: number;
    readonly sha256?: string;
    readonly closed?: boolean;
  };
}

// A digest binds the exact JSON plan supplied by the scheduling caller. Runners
// use this function rather than maintaining their own serialization or schema.
async function engineeringSha256(text: string): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toHex();
}

export function engineeringPlanDigest(plan: EngineeringCostPlan): Promise<string> {
  return engineeringSha256(JSON.stringify(plan));
}

function engineeringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function engineeringText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function engineeringHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function engineeringFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function engineeringStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(engineeringText);
}

function engineeringSameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    engineeringStrings(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function engineeringSameMap(value: unknown, expected: Readonly<Record<string, string>>): boolean {
  return (
    engineeringRecord(value) &&
    Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

export function validateEngineeringPlan(plan: EngineeringCostPlan): readonly SchemaError[] {
  const errors: SchemaError[] = [];
  const require = (condition: boolean, path: string, message: string) => {
    if (!condition) errors.push({ path, message });
  };
  require(plan.version === 1, 'plan.version', 'unsupported engineering plan version');
  require(engineeringText(plan.id), 'plan.id', 'a stable plan id is required');
  require(plan.mode === 'smoke' || plan.mode === 'comparative', 'plan.mode', 'unknown evidence mode');
  require(Number.isSafeInteger(plan.orderSeed) &&
    plan.orderSeed >= 0, 'plan.orderSeed', 'a nonnegative order seed is required');
  require(Number.isSafeInteger(plan.repetitions) &&
    plan.repetitions > 0, 'plan.repetitions', 'positive complete repetitions are required');
  require(plan.mode !== 'comparative' ||
    plan.repetitions >=
      20, 'plan.repetitions', 'comparative engineering cells require at least 20 observations per target');
  require(plan.targets.length >=
    (plan.mode === 'comparative' ? 2 : 1), 'plan.targets', 'baseline and comparison targets are required');
  require(plan.targets.length > 0 &&
    plan.repetitions % plan.targets.length ===
      0, 'plan.repetitions', 'repetitions must contain complete balanced rotations');
  require(plan.analysis.confidence === 0.95 &&
    plan.analysis.resamples === 10000 &&
    Number.isSafeInteger(plan.analysis.seed), 'plan.analysis', 'declare the frozen analysis method and seed');
  const hashMap = (values: Readonly<Record<string, string>>, path: string) => {
    require(Object.keys(values).length > 0 &&
      Object.entries(values).every(
        ([name, value]) => engineeringText(name) && engineeringHash(value),
      ), path, 'nonempty input hashes are required');
  };
  hashMap(plan.inputHashes, 'plan.inputHashes');
  const targets = new Set<string>();
  for (const target of plan.targets) {
    require(engineeringText(target.id) &&
      !targets.has(target.id), 'plan.targets', 'target ids must be nonempty and unique');
    targets.add(target.id);
    require(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(
      target.revision,
    ), `plan.targets.${target.id}.revision`, 'an exact source revision is required');
    hashMap(target.inputHashes, `plan.targets.${target.id}.inputHashes`);
    require(Object.keys(target.dependencies).length > 0 &&
      Object.entries(target.dependencies).every(
        ([name, version]) => engineeringText(name) && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version),
      ), `plan.targets.${target.id}.dependencies`, 'resolved dependency versions are required, not ranges');
  }
  require(plan.cells.length > 0, 'plan.cells', 'the caller must select required cells');
  const cells = new Set<string>();
  const buckets = new Set<EngineeringBucket>(['editor', 'typecheck', 'build', 'distribution', 'startup', 'runtime']);
  for (const cell of plan.cells) {
    const path = `plan.cells.${cell.id}`;
    require(engineeringText(cell.id) && !cells.has(cell.id), path, 'cell ids must be nonempty and unique');
    cells.add(cell.id);
    require(buckets.has(cell.bucket), `${path}.bucket`, 'unknown paid bucket');
    require(engineeringText(cell.graph), `${path}.graph`, 'a pinned project graph is required');
    require(['cold', 'primed', 'warm'].includes(cell.cache), `${path}.cache`, 'an explicit cache policy is required');
    require(cell.command.length > 0 &&
      cell.command.every(engineeringText), `${path}.command`, 'the exact command is required');
    require(['none', 'iterations', 'milliseconds'].includes(cell.warmup.kind) &&
      Number.isSafeInteger(cell.warmup.amount) &&
      (cell.warmup.kind === 'none'
        ? cell.warmup.amount === 0
        : cell.warmup.amount > 0), `${path}.warmup`, 'an explicit bounded warmup policy is required');
    require(engineeringHash(cell.consumedSha256) &&
      cell.checks.length > 0 &&
      cell.checks.every(engineeringText) &&
      new Set(cell.checks).size ===
        cell.checks.length, `${path}.consumption`, 'a checksum and unique correctness checks are required');
    require(cell.metrics.length > 0, `${path}.metrics`, 'at least one metric is required');
    const metrics = new Set<string>();
    for (const metric of cell.metrics) {
      require(engineeringText(metric.name) &&
        !metrics.has(metric.name), `${path}.metrics`, 'metric names must be nonempty and unique');
      metrics.add(metric.name);
      require(['ms', 'bytes', 'count', 'ops/s'].includes(metric.unit) &&
        ['lower', 'higher'].includes(
          metric.direction,
        ), `${path}.metrics.${metric.name}`, 'metric units and direction are required');
      require(engineeringFinite(metric.maxRatio) &&
        metric.maxRatio >= 1 &&
        (metric.absoluteLimit === undefined ||
          engineeringFinite(
            metric.absoluteLimit,
          )), `${path}.metrics.${metric.name}.budget`, 'finite per-metric regression limits are required');
    }
  }
  return errors;
}

// This validates raw evidence, not a release claim. Synthetic and inconclusive
// artifacts remain explicitly labelled; [] does not promote either to a pass.
export async function validateEngineeringArtifact(
  plan: EngineeringCostPlan,
  artifact: unknown,
): Promise<readonly SchemaError[]> {
  const errors = [...validateEngineeringPlan(plan)];
  if (errors.length > 0) return errors;
  const require = (condition: boolean, path: string, message: string) => {
    if (!condition) errors.push({ path, message });
  };
  if (!engineeringRecord(artifact))
    return [{ path: 'artifact', message: 'an engineering artifact object is required' }];
  require(artifact.version === 1, 'artifact.version', 'unsupported engineering artifact version');
  require(artifact.planSha256 ===
    (await engineeringPlanDigest(plan)), 'artifact.planSha256', 'artifact does not match the caller plan');
  require(artifact.mode === plan.mode, 'artifact.mode', 'smoke and comparative evidence cannot be substituted');
  require(artifact.origin === 'synthetic' ||
    artifact.origin === 'measured', 'artifact.origin', 'declare synthetic or measured origin');
  require(engineeringSameMap(
    artifact.inputHashes,
    plan.inputHashes,
  ), 'artifact.inputHashes', 'source/configuration inputs changed or were omitted');
  if (!Array.isArray(artifact.targets)) {
    errors.push({ path: 'artifact.targets', message: 'target provenance is required' });
  } else {
    require(artifact.targets.length === plan.targets.length, 'artifact.targets', 'targets were omitted or added');
    for (const [index, target] of plan.targets.entries()) {
      const actual: unknown = artifact.targets[index];
      require(engineeringRecord(actual) &&
        actual.id === target.id &&
        actual.revision === target.revision &&
        engineeringSameMap(actual.inputHashes, target.inputHashes) &&
        engineeringSameMap(
          actual.dependencies,
          target.dependencies,
        ), `artifact.targets.${target.id}`, 'target revision, input hashes or resolved dependencies drifted from its own plan');
    }
  }
  const memo = new Map<string, Promise<string>>();
  const digest = (text: string) => {
    const previous = memo.get(text);
    if (previous !== undefined) return previous;
    const current = engineeringSha256(text);
    memo.set(text, current);
    return current;
  };
  const provenance = artifact.provenance;
  if (!engineeringRecord(provenance)) {
    errors.push({ path: 'artifact.provenance', message: 'complete machine and tool provenance is required' });
  } else {
    for (const name of [
      'cpu',
      'storage',
      'os',
      'kernel',
      'runtime',
      'compiler',
      'packageManager',
      'measurementTool',
      'powerPolicy',
      'registryPolicy',
      'database',
      'sampling',
    ]) {
      require(engineeringText(provenance[name]), `artifact.provenance.${name}`, 'required provenance is missing');
    }
    for (const name of ['cores', 'ramBytes'])
      require(engineeringFinite(provenance[name]) &&
        provenance[name] > 0, `artifact.provenance.${name}`, 'positive hardware capacity is required');
    require(engineeringRecord(provenance.environment) &&
      Object.values(provenance.environment).every(
        value => typeof value === 'string',
      ), 'artifact.provenance.environment', 'a sanitized environment map is required');
    require(provenance.environmentSha256 ===
      (await digest(
        JSON.stringify(provenance.environment) ?? '',
      )), 'artifact.provenance.environmentSha256', 'environment checksum does not match');
  }
  if (!Array.isArray(artifact.observations))
    return [...errors, { path: 'artifact.observations', message: 'raw observations are required' }];
  const cells = new Map(plan.cells.map(cell => [cell.id, cell]));
  const targets = new Map(plan.targets.map((target, index) => [target.id, index]));
  const observations = new Map<string, Record<string, unknown>>();
  const key = (cell: string, target: string, round: number) => JSON.stringify([cell, target, round]);
  for (const [index, value] of artifact.observations.entries()) {
    const path = `artifact.observations.${index}`;
    if (
      !engineeringRecord(value) ||
      typeof value.cell !== 'string' ||
      typeof value.target !== 'string' ||
      typeof value.round !== 'number'
    ) {
      errors.push({ path, message: 'observation cell, target and round are required' });
      continue;
    }
    const cell = cells.get(value.cell);
    const targetIndex = targets.get(value.target);
    if (
      cell === undefined ||
      targetIndex === undefined ||
      !Number.isSafeInteger(value.round) ||
      value.round < 0 ||
      value.round >= plan.repetitions
    ) {
      errors.push({ path, message: 'observation is outside the caller coverage plan' });
      continue;
    }
    const identity = key(cell.id, value.target, value.round);
    require(!observations.has(identity), path, 'duplicate sample cannot count as an independent observation');
    observations.set(identity, value);
    const position =
      (targetIndex - ((value.round + plan.orderSeed) % plan.targets.length) + plan.targets.length) %
      plan.targets.length;
    require(value.position === position, `${path}.position`, 'sample order is not the planned balanced rotation');
    require(engineeringFinite(value.processId) &&
      Number.isSafeInteger(value.processId) &&
      value.processId > 0, `${path}.processId`, 'an observed process id is required');
    require(engineeringText(value.startedAt) &&
      /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value.startedAt) &&
      Number.isFinite(
        Date.parse(value.startedAt),
      ), `${path}.startedAt`, 'an unambiguous observation timestamp is required');
    require(value.cache === cell.cache, `${path}.cache`, 'cache policy differs from the plan');
    require(engineeringSameStrings(value.command, cell.command), `${path}.command`, 'command differs from the plan');
    const warmup = value.warmup;
    if (!engineeringRecord(warmup))
      errors.push({ path: `${path}.warmup`, message: 'warmup provenance is required, including explicit none' });
    else {
      require(warmup.kind === cell.warmup.kind &&
        warmup.completed === cell.warmup.amount, `${path}.warmup`, 'declared warmup was not completed');
      require(engineeringText(warmup.raw) &&
        warmup.sha256 ===
          (await digest(warmup.raw)), `${path}.warmup.sha256`, 'retain checksummed raw warmup evidence');
    }
    require(engineeringText(value.raw) &&
      value.rawSha256 === (await digest(value.raw)), `${path}.raw`, 'retain checksummed original tool output');
    require(engineeringText(value.consumed) &&
      value.consumedSha256 === cell.consumedSha256 &&
      value.consumedSha256 ===
        (await digest(value.consumed)), `${path}.consumed`, 'consumed result does not match the frozen oracle');
    require(engineeringSameStrings(
      value.checks,
      cell.checks,
    ), `${path}.checks`, 'required correctness checks were omitted or changed');
    require(value.exitCode === 0, `${path}.exitCode`, 'failed commands are invalid samples');
    require(value.cleaned === true, `${path}.cleaned`, 'owned resources were not cleaned');
    if (!engineeringRecord(value.values))
      errors.push({ path: `${path}.values`, message: 'metric observations are required' });
    else {
      require(Object.keys(value.values).length ===
        cell.metrics.length, `${path}.values`, 'metric coverage differs from the plan');
      for (const metric of cell.metrics) {
        const measured = value.values[metric.name];
        require(engineeringFinite(measured) &&
          (metric.direction !== 'higher' ||
            measured >
              0), `${path}.values.${metric.name}`, 'metric observations must be finite nonnegative costs or positive throughput');
        if (engineeringFinite(measured) && metric.absoluteLimit !== undefined)
          require(metric.direction === 'lower'
            ? measured <= metric.absoluteLimit
            : measured >= metric.absoluteLimit, `${path}.values.${metric.name}`, 'absolute per-cell budget exceeded');
      }
    }
  }
  for (const cell of plan.cells)
    for (const target of plan.targets)
      for (let round = 0; round < plan.repetitions; round++) {
        require(observations.has(
          key(cell.id, target.id, round),
        ), `artifact.coverage.${cell.id}.${target.id}.${round}`, 'missing required sample');
      }
  if (!Array.isArray(artifact.assessments))
    return [...errors, { path: 'artifact.assessments', message: 'per-cell assessments are required' }];
  const assessmentKeys = new Set<string>();
  const baseline = plan.targets[0];
  if (baseline === undefined) return errors;
  for (const [index, value] of artifact.assessments.entries()) {
    const path = `artifact.assessments.${index}`;
    if (
      !engineeringRecord(value) ||
      typeof value.cell !== 'string' ||
      typeof value.target !== 'string' ||
      typeof value.metric !== 'string'
    ) {
      errors.push({ path, message: 'assessment cell, target and metric are required' });
      continue;
    }
    const cell = cells.get(value.cell);
    const metric = cell?.metrics.find(item => item.name === value.metric);
    if (cell === undefined || metric === undefined || !targets.has(value.target) || value.target === baseline.id) {
      errors.push({ path, message: 'assessment lies outside required comparison coverage' });
      continue;
    }
    const identity = JSON.stringify([cell.id, value.target, metric.name]);
    require(!assessmentKeys.has(identity), path, 'duplicate assessment');
    assessmentKeys.add(identity);
    const ratios: number[] = [];
    for (let round = 0; round < plan.repetitions; round++) {
      const before = observations.get(key(cell.id, baseline.id, round))?.values;
      const after = observations.get(key(cell.id, value.target, round))?.values;
      if (!engineeringRecord(before) || !engineeringRecord(after)) continue;
      const left = before[metric.name];
      const right = after[metric.name];
      if (!engineeringFinite(left) || !engineeringFinite(right)) continue;
      const numerator = metric.direction === 'lower' ? right : left;
      const denominator = metric.direction === 'lower' ? left : right;
      ratios.push(denominator === 0 ? (numerator === 0 ? 1 : Infinity) : numerator / denominator);
    }
    ratios.sort((left, right) => left - right);
    const middle = Math.floor(ratios.length / 2);
    const upper = ratios[middle];
    const lower = ratios[Math.max(0, middle - 1)];
    const median =
      upper === undefined || lower === undefined ? NaN : ratios.length % 2 === 0 ? (lower + upper) / 2 : upper;
    require(ratios.length === plan.repetitions &&
      engineeringFinite(value.ratio) &&
      Math.abs(value.ratio - median) <=
        Number.EPSILON *
          Math.max(1, median) *
          8, `${path}.ratio`, 'reported ratio does not match the paired raw observations');
    const interval = value.interval;
    if (
      !Array.isArray(interval) ||
      interval.length !== 2 ||
      !engineeringFinite(interval[0]) ||
      !engineeringFinite(interval[1]) ||
      interval[0] > median ||
      interval[1] < median
    ) {
      errors.push({
        path: `${path}.interval`,
        message: 'an ordered finite interval containing the raw ratio is required',
      });
      continue;
    }
    const decision =
      interval[1] <= metric.maxRatio ? 'pass' : interval[0] > metric.maxRatio ? 'regression' : 'inconclusive';
    if (value.decision === 'accepted-regression') {
      const acceptance = value.acceptance;
      require(decision === 'regression' &&
        engineeringRecord(acceptance) &&
        ['issue', 'owner', 'rationale'].every(name => engineeringText(acceptance[name])) &&
        engineeringHash(
          acceptance.evidenceSha256,
        ), `${path}.decision`, 'accepted regression needs its exact recorded owner, rationale and raw evidence');
    } else
      require(value.decision ===
        decision, `${path}.decision`, `raw interval requires ${decision}; an aggregate cannot excuse a cell`);
  }
  for (const cell of plan.cells)
    for (const target of plan.targets.slice(1))
      for (const metric of cell.metrics) {
        require(assessmentKeys.has(
          JSON.stringify([cell.id, target.id, metric.name]),
        ), `artifact.assessments.${cell.id}.${target.id}.${metric.name}`, 'missing required per-cell assessment');
      }
  return errors;
}
