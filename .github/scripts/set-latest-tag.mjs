// After publishing, set each @zmdb package's `latest` dist-tag to the
// highest-PRECEDENCE published version:
//   stable  >  -rc.*  >  -beta.*  >  -alpha.*
// (npm always keeps a `latest` tag; without this it can get stuck on whatever
// was published first. Prerelease publishes also keep their channel tag, e.g.
// `alpha`, via publishConfig.tag / --tag.)
//
// Usage: node .github/scripts/set-latest-tag.mjs            (uses npm CLI)
//        node .github/scripts/set-latest-tag.mjs --dry-run  (print only)
import { execFileSync } from 'node:child_process';

const PACKAGES = [
  '@zmdb/client',
  '@zmdb/react',
  '@zmdb/angular',
  '@zmdb/vue',
  '@zmdb/svelte',
  '@zmdb/next',
  '@zmdb/query-compiler',
  '@zmdb/schema-core',
  '@zmdb/ai',
  '@zmdb/ai-anthropic',
  '@zmdb/ai-langchain',
  '@zmdb/ai-vercel',
  '@zmdb/mcp',
  '@zmdb/protobuf',
  '@zmdb/aot-validator',
  '@zmdb/repository',
  '@zmdb/sqlite',
  '@zmdb/app',
  '@zmdb/jobs',
  '@zmdb/jobs-postgres',
  '@zmdb/otel',
  '@zmdb/transport-grpc',
  '@zmdb/transport-nats',
  '@zmdb/transport-rabbitmq',
  '@zmdb/transport-redis',
  '@zmdb/web',
  'zmdb',
];
const DRY = process.argv.includes('--dry-run');

// precedence rank of a version's channel: higher = preferred for `latest`.
function rank(v) {
  if (!v.includes('-')) return 4; // stable
  const pre = v.split('-')[1];
  if (pre.startsWith('rc')) return 3;
  if (pre.startsWith('beta')) return 2;
  if (pre.startsWith('alpha')) return 1;
  return 0; // unknown prerelease channel
}

// crude but sufficient semver compare (x.y.z with optional -chan.n)
function cmp(a, b) {
  const parse = v => {
    const [core, pre = ''] = v.split('-');
    const nums = core.split('.').map(Number);
    const preNums = pre ? pre.split('.').map(x => (isNaN(+x) ? x : +x)) : [];
    return { nums, pre, preNums };
  };
  const pa = parse(a),
    pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  const ra = rank(a),
    rb = rank(b);
  if (ra !== rb) return ra - rb;
  // same channel: compare the trailing prerelease counter
  const la = pa.preNums.at(-1) ?? 0,
    lb = pb.preNums.at(-1) ?? 0;
  return typeof la === 'number' && typeof lb === 'number' ? la - lb : String(la).localeCompare(String(lb));
}

function chooseLatest(versions) {
  // Best = highest rank; within that, highest semver.
  return [...versions].toSorted((a, b) => {
    const ra = rank(a),
      rb = rank(b);
    if (ra !== rb) return rb - ra; // prefer higher channel
    return cmp(b, a); // then newest
  })[0];
}

for (const pkg of PACKAGES) {
  let versions;
  try {
    versions = JSON.parse(execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8' }));
    if (!Array.isArray(versions)) versions = [versions];
  } catch (err) {
    console.log(`skip ${pkg}: cannot read versions (${err.message.split('\n')[0]})`);
    continue;
  }
  const target = chooseLatest(versions);
  console.log(`${pkg}: latest → ${target}  (from ${versions.length} versions)`);
  if (!DRY) {
    try {
      execFileSync('npm', ['dist-tag', 'add', `${pkg}@${target}`, 'latest'], { stdio: 'inherit' });
    } catch (err) {
      console.log(`  failed to set latest for ${pkg}: ${err.message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
}
