// Dependency vulnerability audit script (REQ-CI).
//
// Audits all resolved dependencies in `yarn.lock` against OSV (Open Source Vulnerabilities)
// and npm advisory databases for security vulnerabilities.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCKFILE = join(ROOT, 'yarn.lock');

if (!existsSync(LOCKFILE)) {
  console.error(`yarn.lock not found at ${LOCKFILE}`);
  process.exit(1);
}

const content = readFileSync(LOCKFILE, 'utf8');
const packageMap = new Map();

for (const line of content.split('\n')) {
  const match = line.match(/^\s*resolution:\s*"?(@?[^@\s"]+)@npm:([^",\s:]+)"?/);
  if (match) {
    const name = match[1];
    const version = match[2];
    if (!packageMap.has(name)) packageMap.set(name, new Set());
    packageMap.get(name).add(version);
  }
}

const queries = [];
const npmPayload = {};

for (const [name, versions] of packageMap.entries()) {
  npmPayload[name] = Array.from(versions);
  for (const version of versions) {
    queries.push({
      package: { name, ecosystem: 'npm' },
      version,
    });
  }
}

console.log(
  `Auditing ${queries.length} resolved dependency/dependencies (${packageMap.size} unique package(s)) from yarn.lock...`,
);

let vulns = [];
let source = 'OSV';

try {
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`OSV API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  for (let i = 0; i < (data.results || []).length; i++) {
    const r = data.results[i];
    if (r.vulns && r.vulns.length > 0) {
      const q = queries[i];
      for (const v of r.vulns) {
        vulns.push({
          pkg: q.package.name,
          version: q.version,
          id: v.id,
          summary: v.summary || v.details || 'No details provided',
          severity: (v.database_specific?.severity || v.severity?.[0]?.type || 'HIGH').toUpperCase(),
        });
      }
    }
  }
} catch (err) {
  console.warn(`OSV audit query failed (${err.message}). Trying npm bulk advisories API fallback...`);
  try {
    const res = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(npmPayload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`npm advisories API returned HTTP ${res.status}`, { cause: err });
    }

    const data = await res.json();
    source = 'npm';
    for (const [pkg, items] of Object.entries(data)) {
      for (const item of items) {
        vulns.push({
          pkg,
          version: 'any',
          id: item.id,
          summary: item.title,
          severity: (item.severity || 'HIGH').toUpperCase(),
        });
      }
    }
  } catch (fallbackErr) {
    console.error(`npm advisories fallback failed: ${fallbackErr.message}`);
    console.error('Failed to query dependency vulnerability databases.');
    process.exit(1);
  }
}

const IGNORED_ADVISORIES = new Set([
  'GHSA-5p2g-fcmc-qvqq', // image-size DoS (npm 1138808)
  'GHSA-w3rx-r6r6-pgpr', // image-size DoS (npm 1138809)
  '1138808',
  '1138809',
]);

const severeVulns = vulns.filter(
  v => !IGNORED_ADVISORIES.has(String(v.id)) && (['HIGH', 'CRITICAL'].includes(v.severity) || v.severity === 'HIGH'),
);

console.log(`\nAudit results from ${source}: ${queries.length} package(s) scanned.`);
if (vulns.length === 0) {
  console.log('✓ Zero dependency vulnerabilities found.');
  process.exit(0);
} else {
  console.log(`Found ${vulns.length} advisory/advisories (${severeVulns.length} high/critical):`);
  for (const v of vulns) {
    console.log(`  - [${v.severity}] ${v.pkg}@${v.version}: ${v.id} - ${v.summary}`);
  }

  if (severeVulns.length > 0) {
    console.error(
      `\nDependency vulnerability audit failed: ${severeVulns.length} high or critical vulnerability/vulnerabilities detected.`,
    );
    process.exit(1);
  }
}
