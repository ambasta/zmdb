import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeTextAtomically } from '../file-io.js';
import type { SchemaSnapshot } from '../index.js';
import { MigrationProjectError, type MigrationProject } from '../project.js';

export interface UpgradeResult {
  readonly from: number;
  readonly to: 1;
  readonly changed: boolean;
  readonly backup?: string;
}

/** Upgrade known snapshot formats without touching the database. */
export async function upgradeSnapshot(project: MigrationProject): Promise<UpgradeResult> {
  const path = join(project.outDir, 'snapshot.json');
  const source = await readFile(path, 'utf8');
  const parsed = snapshotRecord(JSON.parse(source), path);
  const version = snapshotVersion(parsed, path);
  if (version > 1) {
    throw new MigrationProjectError(
      `snapshot ${path} uses version ${String(version)}, newer than this build's version 1`,
    );
  }
  if (version === 1) return { from: 1, to: 1, changed: false };

  const upgraded = upgradeKnownVersion(parsed, version, path);
  const backup = `${path}.bak`;
  await writeTextAtomically(backup, source);
  await writeTextAtomically(path, `${JSON.stringify(upgraded, null, 2)}\n`);
  return { from: version, to: 1, changed: true, backup };
}

function upgradeKnownVersion(
  _snapshot: Readonly<Record<string, unknown>>,
  version: number,
  path: string,
): SchemaSnapshot {
  throw new MigrationProjectError(`snapshot ${path} uses version ${String(version)}, which this build cannot upgrade`);
}

function snapshotRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MigrationProjectError(`snapshot ${path} must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function snapshotVersion(snapshot: Readonly<Record<string, unknown>>, path: string): number {
  const version = snapshot.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    throw new MigrationProjectError(`snapshot ${path} has no safe integer version`);
  }
  return version;
}
