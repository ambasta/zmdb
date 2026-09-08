import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { PACKED_BUILD_TEST_TIMEOUT_MS } from '../../../fixtures/client-adapters/src/packed-project.js';

const root = process.cwd();
const expected = JSON.parse(readFileSync(join(root, 'fixtures/consumer-product/expected.json'), 'utf8'));
const execute = promisify(execFile);

interface ProductReport {
  readonly cleaned: boolean;
  readonly failures: readonly string[];
  readonly installation: {
    readonly directZmdbDependencies: readonly string[];
    readonly packageManager: string;
    readonly workspaceLeaks: readonly string[];
    readonly ci: boolean;
    readonly archiveIntegrity: boolean;
    readonly optionalInstalled: readonly string[];
    readonly optionalLoaded: readonly string[];
  };
  readonly typecheck: { readonly status: number; readonly skipLibCheck: boolean; readonly paths: boolean };
  readonly commands: readonly { readonly command: string; readonly status: number }[];
  readonly migration: {
    readonly generated: boolean;
    readonly ledgerRows: number;
    readonly table: string;
    readonly checksumMatches: boolean;
    readonly columns: readonly unknown[];
  };
  readonly http: {
    readonly loopback: boolean;
    readonly invalidStatus: number;
    readonly validStatus: number;
    readonly rowsAfterInvalid: number;
    readonly created: unknown;
    readonly stored: unknown;
    readonly closed: boolean;
    readonly contentType: string;
    readonly read: { readonly status: number; readonly body: unknown };
    readonly update: { readonly status: number; readonly body: unknown };
    readonly readUpdated: { readonly status: number; readonly body: unknown };
    readonly remove: { readonly status: number; readonly body: unknown };
    readonly rowsAfterDelete: number;
    readonly shutdowns: number;
  };
  readonly publicImports: {
    readonly privateImports: readonly string[];
    readonly generatedPrivateImports: readonly string[];
    readonly loaded: readonly string[];
  };
}

let measured: Promise<ProductReport> | undefined;
function product(): Promise<ProductReport> {
  measured ??= execute(process.execPath, [join(root, 'fixtures/consumer-product/verify-installed.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: PACKED_BUILD_TEST_TIMEOUT_MS - 10_000,
  }).then(({ stdout }) => JSON.parse(stdout) as ProductReport);
  return measured;
}

describe('one-install product publication (#623)', () => {
  it(
    'installs only zmdb and typechecks without workspace paths or skipLibCheck',
    async () => {
      const manifest = JSON.parse(readFileSync(join(root, 'packages/zmdb/package.json'), 'utf8'));
      expect(manifest.dependencies['@zmdb/sqlite']).toMatch(/^workspace:/);
      expect(manifest.peerDependencies?.['@zmdb/sqlite']).toBeUndefined();
      const report = await product();
      expect(report.installation.directZmdbDependencies).toEqual(expected.directZmdbDependencies);
      expect(report.installation.packageManager).toBe('npm');
      expect(report.installation.workspaceLeaks).toEqual([]);
      expect(report.installation.ci).toBe(true);
      expect(report.installation.archiveIntegrity).toBe(true);
      expect(report.installation.optionalInstalled).toEqual([]);
      expect(report.installation.optionalLoaded).toEqual([]);
      expect(report.typecheck).toEqual({ status: 0, skipLibCheck: false, paths: false });
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'loads the canonical config and applies a generated SQLite migration from the installed CLI',
    async () => {
      const report = await product();
      expect(report.commands.map(command => command.command)).toEqual(expected.commands);
      expect(report.commands.every(command => command.status === 0)).toBe(true);
      expect(report.migration).toEqual({
        generated: true,
        ledgerRows: 1,
        table: 'orders',
        checksumMatches: true,
        columns: expected.columns,
      });
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'rejects an invalid DTO and persists a valid entity through the installed facade',
    async () => {
      const { http } = await product();
      expect(http.invalidStatus).toBe(expected.invalidStatus);
      expect(http.rowsAfterInvalid).toBe(expected.rowsAfterInvalid);
      expect(http.validStatus).toBe(expected.validStatus);
      expect(http.created).toEqual(expected.created);
      expect(http.stored).toEqual(expected.stored);
      expect(http.contentType).toContain('application/json');
      expect(http.read).toMatchObject({ status: expected.readStatus, body: expected.created });
      expect(http.update).toMatchObject({ status: expected.updateStatus, body: expected.updated });
      expect(http.readUpdated).toMatchObject({ status: expected.readStatus, body: expected.updated });
      expect(http.remove).toMatchObject({ status: expected.deleteStatus, body: true });
      expect(http.rowsAfterDelete).toBe(expected.rowsAfterDelete);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'serves one validated HTTP route and shuts down without an open handle',
    async () => {
      const { http } = await product();
      expect(http.loopback).toBe(true);
      expect(http.closed).toBe(true);
      expect(http.shutdowns).toBe(expected.shutdowns);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'contains no direct internal-package import in fixture source or generated output',
    async () => {
      const report = (await product()).publicImports;
      expect(report.privateImports).toEqual([]);
      expect(report.generatedPrivateImports).toEqual([]);
      expect(report.loaded).toEqual(expected.publicImports);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );

  it(
    'retains complete successful evidence and cleans the external consumer',
    async () => {
      const report = await product();
      expect(report.failures).toEqual([]);
      expect(report.cleaned).toBe(true);
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
  for (const title of [
    'installs only zmdb and serves a validated SQLite-backed HTTP request from packed tarballs',
    'builds the documented application using only the zmdb root and documented subpaths',
  ]) {
    it(
      title,
      async () => {
        const report = await product();
        expect(report.failures).toEqual([]);
        expect(report.cleaned).toBe(true);
        expect(report.migration).toEqual({
          generated: true,
          ledgerRows: 1,
          table: 'orders',
          checksumMatches: true,
          columns: expected.columns,
        });
        expect(report.http).toMatchObject({
          invalidStatus: 400,
          rowsAfterInvalid: 0,
          validStatus: 200,
          created: expected.created,
          stored: expected.stored,
          closed: true,
        });
      },
      PACKED_BUILD_TEST_TIMEOUT_MS,
    );
  }
});
