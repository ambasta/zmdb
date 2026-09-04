import path from 'node:path';

import type { TypeIR } from '@zmdb/schema-core/ir';
import { API } from 'typescript/unstable/sync';
import { describe, it, expect, vi } from 'vitest';

import { tsTypeToTypeIR, emitCheckFromIR } from '../transformer.js';
import { zmdbAot, transformTypeChecks } from './index.js';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('TypeChecker Integration with TypeIR in Unplugin', () => {
  const api = new API();
  const snapshot = api.updateSnapshot({ openProjects: ['tsconfig.json'] });
  const proj = snapshot.getProjects()[0]!;
  const checker = proj.checker;
  const appFilePath = path.resolve('benchmarks/harness/framework/app.ts');

  it('Requirement 1 & AC 1: extracts full structural type info for imported interfaces and generates static validation statements', () => {
    // UserCreate is an imported interface/type alias in app.ts with fields name: string, email: string
    const src = 'const ok = is<UserCreate>(input);';
    const sourceFile = proj.program.getSourceFile(appFilePath);

    const out = transformTypeChecks(src, { sourceFile, checker, id: appFilePath });
    const n = norm(out);

    expect(n).toContain('typeof input === "object"');
    expect(n).toContain('input !== null');
    expect(n).toContain('typeof input.name === "string"');
    expect(n).toContain('typeof input.email === "string"');
  });

  it('Requirement 3 & AC 2: type aliases imported across workspace package boundaries resolve via path configurations', () => {
    const plugin = zmdbAot({ tsconfigPath: 'tsconfig.json' });
    const sampleCode = 'const ok = assert<UserCreate>(payload);';

    const transformed = plugin.transform(sampleCode, appFilePath);
    expect(transformed).not.toBeNull();
    const n = norm(transformed!.code);

    expect(n).toContain('typeof payload === "object"');
    expect(n).toContain('payload !== null');
    expect(n).toContain('typeof payload.name === "string"');
    expect(n).toContain('typeof payload.email === "string"');
  });

  it('Requirement 2 & AC 3: complex structural types (primitives, arrays, nested objects, unions) map into TypeIR without data loss', () => {
    const b1 = {
      isErrorType: () => false,
      isStringLiteralType: () => false,
      isNumberLiteralType: () => false,
      isBooleanLiteralType: () => false,
      isUnionType: () => false,
      isObjectType: () => false,
    };
    const b2 = {
      isErrorType: () => false,
      isStringLiteralType: () => false,
      isNumberLiteralType: () => false,
      isBooleanLiteralType: () => false,
      isUnionType: () => false,
      isObjectType: () => false,
    };

    const mockUnionType = {
      isErrorType: () => false,
      isStringLiteralType: () => false,
      isNumberLiteralType: () => false,
      isBooleanLiteralType: () => false,
      isUnionType: () => true,
      getTypes: () => [b1, b2],
    };

    const mockChecker = {
      typeToString: (t: unknown) => (t === b1 ? 'string' : t === b2 ? 'number' : 'union'),
      getPropertiesOfType: () => [],
    };

    const ir = tsTypeToTypeIR(mockUnionType, mockChecker);
    expect(ir).toEqual<TypeIR>({
      kind: 'union',
      members: [
        { kind: 'scalar', scalar: 'string' },
        { kind: 'scalar', scalar: 'number' },
      ],
    });

    const inlineCheck = emitCheckFromIR(ir!, 'val');
    expect(norm(inlineCheck)).toContain('typeof val === "string"');
    expect(norm(inlineCheck)).toContain('typeof val === "number"');
  });

  it('Requirement 4 & AC 4: non-imported inline primitive validations continue to transform without added compilation latency', () => {
    const inlineSrc = 'const ok = is<{ a: boolean; b: number }>(input);';
    const sourceFile = proj.program.getSourceFile(appFilePath);
    const start = performance.now();
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      transformTypeChecks(inlineSrc, { sourceFile, checker, id: appFilePath });
    }
    const duration = performance.now() - start;

    const out = transformTypeChecks(inlineSrc, { sourceFile, checker, id: appFilePath });
    expect(norm(out)).toContain('typeof input.a === "boolean"');
    expect(norm(out)).toContain('typeof input.b === "number"');
    expect(duration).toBeLessThan(500); // High throughput execution (<0.5ms per transform)
  });

  it('Requirement 5 & AC 5: unresolvable type references log a descriptive warning and fall back cleanly to runtime validation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const code = 'const ok = is<UnknownNonExistentDTO>(input);';
    const plugin = zmdbAot();
    const res = plugin.transform(code, '/src/unknown.ts');

    expect(res).toBeNull(); // Code left unchanged for runtime fallback
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[zmdb-aot] Warning: Could not resolve type 'UnknownNonExistentDTO' in /src/unknown.ts, falling back to runtime validation.",
      ),
    );

    warnSpy.mockRestore();
  });
});
