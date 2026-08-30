// Decide the dist-tag to publish a version under, implementing the policy:
//   `latest` = highest-precedence release (stable > rc > beta > alpha).
// Called at publish time. Prints TWO lines to stdout:
//   CHANNEL=<alpha|beta|rc|latest>     (the channel/quality tag)
//   LATEST=<yes|no>                    (whether this version should also be `latest`)
//
// Because npm OIDC authorizes `npm publish --tag X` but NOT `npm dist-tag`, we
// move `latest` purely via the publish command: if this version is the
// highest-precedence version that will exist after publishing, we publish it
// under `--tag latest` (npm then also serves it as its channel implicitly is
// not set — see workflow, which publishes twice-tagged is impossible, so we
// choose `latest` when it wins, else the channel tag).
import { execFileSync } from 'node:child_process';

const pkg = process.argv[2];
const version = process.argv[3];
if (!pkg || !version) {
  console.error('usage: decide-dist-tag.mjs <pkg> <version>');
  process.exit(2);
}

function rank(v) {
  if (!v.includes('-')) return 4;
  const pre = v.split('-')[1];
  if (pre.startsWith('rc')) return 3;
  if (pre.startsWith('beta')) return 2;
  if (pre.startsWith('alpha')) return 1;
  return 0;
}
function channelOf(v) {
  return ['unknown', 'alpha', 'beta', 'rc', 'latest'][rank(v)];
}
// Compare two versions under the POLICY ordering: channel precedence dominates
// (stable > rc > beta > alpha), and only within the same channel does the
// numeric/prerelease version decide. Returns >0 if a should rank above b.
function gt(a, b) {
  const ra = rank(a),
    rb = rank(b);
  if (ra !== rb) return ra - rb; // precedence first
  const parse = v => {
    const [c, pre = ''] = v.split('-');
    return { n: c.split('.').map(Number), p: pre ? pre.split('.').map(x => (isNaN(+x) ? x : +x)) : [] };
  };
  const pa = parse(a),
    pb = parse(b);
  for (let i = 0; i < 3; i++) if ((pa.n[i] || 0) !== (pb.n[i] || 0)) return (pa.n[i] || 0) - (pb.n[i] || 0);
  const la = pa.p.at(-1) ?? 0,
    lb = pb.p.at(-1) ?? 0;
  return typeof la === 'number' && typeof lb === 'number' ? la - lb : String(la).localeCompare(String(lb));
}

let existing = [];
try {
  const out = execFileSync('npm', ['view', pkg, 'versions', '--json'], { encoding: 'utf8' });
  existing = JSON.parse(out);
  if (!Array.isArray(existing)) existing = [existing];
} catch {
  existing = []; // brand-new package: this version wins by default
}

// After publishing, the full set is existing ∪ {version}. This version should be
// `latest` iff it is the maximum of that set under precedence+semver.
const all = [...new Set([...existing, version])];
const best = all.reduce((m, v) => (gt(v, m) > 0 ? v : m), all[0]);
const isLatest = best === version;

console.log(`CHANNEL=${channelOf(version)}`);
console.log(`LATEST=${isLatest ? 'yes' : 'no'}`);
