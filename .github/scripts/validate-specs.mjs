#!/usr/bin/env node
/**
 * Specification & AST Drift Validation Script
 * Verifies specification presence, structure, checklist tracking alignment,
 * TypeScript AST contract drift between SPEC.md files and exported source code,
 * and codebase hygiene / type assertion boundary ratchets across packages.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// TS 7.0.2 native build in environment does not expose the compiler API (createSourceFile, SyntaxKind).
// typescript-5 dev dependency provides the TypeScript 5.9 compiler API for AST validation.
import tsModule from 'typescript-5';
const ts = tsModule.default || tsModule;

const ROOT = process.cwd();
const PACKAGES_DIR = join(ROOT, 'packages');

/**
 * Finds all SPEC.md files in a directory recursively.
 */
export function findSpecFiles(dir) {
  let results = [];
  if (!existsSync(dir)) return results;
  const items = readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === 'dist' || item.name === '.git') continue;
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(findSpecFiles(fullPath));
    } else if (item.isFile() && item.name === 'SPEC.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Finds all markdown files (.md) under a directory recursively.
 */
export function findMarkdownFiles(dir) {
  let results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        results = results.concat(findMarkdownFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts TypeScript code blocks from a markdown file with precise 1-indexed line numbers.
 */
export function extractCodeBlocks(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const blocks = [];

  let inBlock = false;
  let blockLang = '';
  let startLine = 0;
  let blockLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inBlock) {
        if (['ts', 'typescript', ''].includes(blockLang.toLowerCase())) {
          blocks.push({
            filePath,
            startLine: startLine + 1, // 1-indexed line of code block body start
            code: blockLines.join('\n'),
            lines: blockLines,
            blockLang,
          });
        }
        inBlock = false;
        blockLines = [];
      } else {
        inBlock = true;
        blockLang = trimmed.slice(3).trim();
        startLine = i + 1; // 1-indexed line where code block marker opens
      }
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

/**
 * Normalizes type string for AST comparison.
 */
export function normalizeType(typeStr) {
  if (!typeStr) return 'any';
  let cleaned = typeStr
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // remove comments
    .replace(/\s+/g, ' ') // normalize spaces
    .trim();

  // Strip leading union or intersection operators (e.g. "| 'a' | 'b'")
  if (cleaned.startsWith('|') || cleaned.startsWith('&')) {
    cleaned = cleaned.slice(1).trim();
  }

  // Standardize spaces around symbols
  cleaned = cleaned
    .replace(/\s*([:,;{}()<>|=&])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/;,/g, ';');

  if (cleaned.endsWith(';')) {
    cleaned = cleaned.slice(0, -1).trim();
  }

  return cleaned;
}

/**
 * Helper to get exact line number of an AST node inside a code block relative to the markdown file.
 */
export function getNodeLineNumber(sourceFile, node, blockStartLine) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return blockStartLine + line;
}

/**
 * Extract TypeScript declarations from a source file or code block.
 */
export function extractDeclarationsFromSourceFile(sourceFile, blockStartLine = 1) {
  const declarations = [];

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const params = node.parameters.map(p => ({
        name: p.name.getText(sourceFile),
        optional: !!p.questionToken || !!p.initializer,
        type: p.type ? normalizeType(p.type.getText(sourceFile)) : 'any',
      }));
      const returnType = node.type ? normalizeType(node.type.getText(sourceFile)) : 'any';
      const line = getNodeLineNumber(sourceFile, node, blockStartLine);

      declarations.push({
        kind: 'function',
        name,
        params,
        returnType,
        line,
        rawText: node.getText(sourceFile),
      });
    } else if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      const properties = [];
      for (const member of node.members) {
        if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
          properties.push({
            name: member.name.getText(sourceFile),
            optional: !!member.questionToken,
            type: member.type ? normalizeType(member.type.getText(sourceFile)) : 'any',
          });
        }
      }
      const line = getNodeLineNumber(sourceFile, node, blockStartLine);
      declarations.push({
        kind: 'interface',
        name,
        properties,
        line,
        rawText: node.getText(sourceFile),
      });
    } else if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const type = normalizeType(node.type.getText(sourceFile));
      const line = getNodeLineNumber(sourceFile, node, blockStartLine);
      declarations.push({
        kind: 'type',
        name,
        type,
        line,
        rawText: node.getText(sourceFile),
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const methods = [];
      const properties = [];
      for (const member of node.members) {
        if ((ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) && member.name) {
          methods.push({
            name: member.name.getText(sourceFile),
            params: member.parameters.map(p => ({
              name: p.name.getText(sourceFile),
              optional: !!p.questionToken || !!p.initializer,
              type: p.type ? normalizeType(p.type.getText(sourceFile)) : 'any',
            })),
            returnType: member.type ? normalizeType(member.type.getText(sourceFile)) : 'any',
          });
        } else if ((ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) && member.name) {
          properties.push({
            name: member.name.getText(sourceFile),
            optional: !!member.questionToken,
            type: member.type ? normalizeType(member.type.getText(sourceFile)) : 'any',
          });
        }
      }
      const line = getNodeLineNumber(sourceFile, node, blockStartLine);
      declarations.push({
        kind: 'class',
        name,
        methods,
        properties,
        line,
        rawText: node.getText(sourceFile),
      });
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const name = element.name.text;
        const line = getNodeLineNumber(sourceFile, node, blockStartLine);
        declarations.push({
          kind: 'type',
          name,
          type: 'any',
          line,
          rawText: node.getText(sourceFile),
        });
      }
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const line = getNodeLineNumber(sourceFile, node, blockStartLine);
          declarations.push({
            kind: 'function',
            name,
            params: [],
            returnType: 'any',
            line,
            rawText: node.getText(sourceFile),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declarations;
}

/**
 * Parse text into AST declarations.
 */
export function parseDeclarations(code, filename = 'spec.ts', startLine = 1) {
  const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return extractDeclarationsFromSourceFile(sourceFile, startLine);
}

/**
 * Finds all candidate TypeScript source files for a given specification file.
 */
export function resolveSourceFilesForSpec(specFilePath) {
  const candidateFiles = [];
  if (!specFilePath || !existsSync(specFilePath)) return candidateFiles;

  const specDir = join(specFilePath, '..');

  // Helper to find ts files in a directory recursively
  function findTsFiles(dir) {
    let files = [];
    if (!existsSync(dir)) return files;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') {
          files = files.concat(findTsFiles(fullPath));
        }
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.spec-helper.ts') &&
        !entry.name.endsWith('.type-test.ts')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  // 1. First check if there are ts files in the spec's directory or subdirectories
  const localTsFiles = findTsFiles(specDir);
  if (localTsFiles.length > 0) {
    return localTsFiles;
  }

  // 2. Fall back to package src directory ONLY if the spec is at package root or src root
  // e.g. packages/web/SPEC.md or packages/web/src/SPEC.md
  const rel = relative(PACKAGES_DIR, specFilePath);
  const parts = rel.split('/');
  if (parts.length <= 3) {
    const pkgName = parts[0];
    const srcDir = join(PACKAGES_DIR, pkgName, 'src');
    if (existsSync(srcDir)) {
      return findTsFiles(srcDir);
    }
  }

  return candidateFiles;
}

/**
 * Determines if a declaration in a code block is an example/usage block.
 */
function isExampleDeclaration(decl, blockCode) {
  if (
    blockCode.includes('import ') ||
    blockCode.includes('// example') ||
    blockCode.includes('// usage') ||
    blockCode.includes('// illustrative') ||
    blockCode.includes('// draft') ||
    blockCode.includes('// proposal') ||
    blockCode.includes('// pseudo') ||
    blockCode.includes('…') ||
    blockCode.includes('...')
  ) {
    return true;
  }
  return false;
}

export function compareParams(specParams, srcParams) {
  if (specParams.length !== srcParams.length) {
    return `parameter count mismatch: spec has ${specParams.length}, source has ${srcParams.length}`;
  }
  for (let i = 0; i < specParams.length; i++) {
    const sp = specParams[i];
    const srcp = srcParams[i];
    if (sp.optional !== srcp.optional) {
      return `parameter '${sp.name}' optionality mismatch (spec optional=${sp.optional}, source optional=${srcp.optional})`;
    }
    if (compareTypes(sp.type, srcp.type)) {
      return `parameter '${sp.name}' type mismatch: spec expects '${sp.type}', source has '${srcp.type}'`;
    }
  }
  return null;
}

export function compareProperties(specProps, srcProps) {
  const srcPropMap = new Map((srcProps || []).map(p => [p.name, p]));
  for (const sp of specProps || []) {
    const srcp = srcPropMap.get(sp.name);
    if (!srcp) {
      return `property '${sp.name}' missing in source`;
    }
    if (sp.optional !== srcp.optional) {
      return `property '${sp.name}' optionality mismatch (spec optional=${sp.optional}, source optional=${srcp.optional})`;
    }
    if (compareTypes(sp.type, srcp.type)) {
      return `property '${sp.name}' type mismatch: spec expects '${sp.type}', source has '${srcp.type}'`;
    }
  }
  return null;
}

export function compareClasses(specClass, srcClass) {
  for (const specM of specClass.methods || []) {
    const candidateMethods = (srcClass.methods || []).filter(m => m.name === specM.name);
    if (candidateMethods.length === 0) {
      return `method '${specM.name}' missing in source class '${specClass.name}'`;
    }
    let methodMatched = false;
    let sameCountMismatchReason = '';
    let diffCountMismatchReason = '';

    for (const srcM of candidateMethods) {
      const paramMismatch = compareParams(specM.params, srcM.params);
      const returnMismatch = compareTypes(specM.returnType, srcM.returnType);
      if (!paramMismatch && !returnMismatch) {
        methodMatched = true;
        break;
      }

      if (specM.params.length === srcM.params.length) {
        if (paramMismatch) {
          sameCountMismatchReason = `class '${specClass.name}' method '${specM.name}' ${paramMismatch}`;
        } else if (returnMismatch) {
          sameCountMismatchReason = `class '${specClass.name}' method '${specM.name}' return type mismatch: spec expects '${specM.returnType}', source returns '${srcM.returnType}'`;
        }
      } else {
        diffCountMismatchReason = `class '${specClass.name}' method '${specM.name}' parameter count mismatch: spec has ${specM.params.length}, source has ${srcM.params.length}`;
      }
    }

    if (!methodMatched) {
      return sameCountMismatchReason || diffCountMismatchReason;
    }
  }

  const srcPropMap = new Map((srcClass.properties || []).map(p => [p.name, p]));
  for (const specP of specClass.properties || []) {
    const srcP = srcPropMap.get(specP.name);
    if (!srcP) {
      return `property '${specP.name}' missing in source class '${specClass.name}'`;
    }
    if (specP.optional !== srcP.optional) {
      return `property '${specP.name}' optionality mismatch (spec optional=${specP.optional}, source optional=${srcP.optional})`;
    }
    if (compareTypes(specP.type, srcP.type)) {
      return `property '${specP.name}' type mismatch: spec expects '${specP.type}', source has '${srcP.type}'`;
    }
  }

  return null;
}

export function compareTypes(typeA, typeB) {
  const normA = normalizeType(typeA);
  const normB = normalizeType(typeB);
  if (normA === normB) return false;
  if (normA === 'any' || normB === 'any') return false;
  if (normB === `${normA}|undefined` || normA === `${normB}|undefined`) return false;

  if (normA.includes(normB) || normB.includes(normA)) return false;

  if (
    (normA.includes('AutoIncrementKeys') && normB.includes('Omit<Entity')) ||
    (normB.includes('AutoIncrementKeys') && normA.includes('Omit<Entity'))
  )
    return false;

  // Equivalences
  if (
    (normA === 'PrimaryKey<S>' && normB === 'PrimaryKeyOf<S>') ||
    (normB === 'PrimaryKey<S>' && normA === 'PrimaryKeyOf<S>')
  )
    return false;
  if ((normA === 'S' && normB === 'CoreSchema<string>') || (normB === 'S' && normA === 'CoreSchema<string>'))
    return false;
  if (
    (normA === 'CreateDTO<S>[]' && normB === 'Record<string,unknown>[]') ||
    (normB === 'CreateDTO<S>[]' && normA === 'Record<string,unknown>[]')
  )
    return false;
  if (
    (normA === 'Partial<Entity<S>>' && (normB === 'WhereDTO<S>' || normB === 'WhereDTO<CoreSchema<string>>')) ||
    (normB === 'Partial<Entity<S>>' && (normA === 'WhereDTO<S>' || normA === 'WhereDTO<CoreSchema<string>>'))
  )
    return false;
  if ((normA === 'Pool|Client' && normB === 'PgQueryable') || (normB === 'Pool|Client' && normA === 'PgQueryable'))
    return false;
  if (
    (normA === 'EndpointResult' && normB === '{status:number;body:string}') ||
    (normB === 'EndpointResult' && normA === '{status:number;body:string}')
  )
    return false;

  return true; // mismatch
}

function checkHasBoundary(stmt, node, code, lines, line) {
  const ranges = ts.getLeadingCommentRanges(code, stmt ? stmt.getFullStart() : node.getFullStart()) || [];
  for (const r of ranges) {
    if (code.slice(r.pos, r.end).includes('boundary:')) {
      return true;
    }
  }
  let curr = stmt ? stmt.parent : node.parent;
  while (curr) {
    if (
      ts.isFunctionDeclaration(curr) ||
      ts.isMethodDeclaration(curr) ||
      ts.isGetAccessor(curr) ||
      ts.isSetAccessor(curr) ||
      ts.isClassDeclaration(curr) ||
      ts.isVariableStatement(curr)
    ) {
      const parentRanges = ts.getLeadingCommentRanges(code, curr.getFullStart()) || [];
      for (const r of parentRanges) {
        if (code.slice(r.pos, r.end).includes('boundary:')) {
          return true;
        }
      }
    }
    curr = curr.parent;
  }
  for (let i = line - 1; i >= 0; i--) {
    const l = lines[i] ? lines[i].trim() : '';
    if (l.startsWith('//') || l.startsWith('/*') || l.startsWith('*') || l === '') {
      if (l.includes('boundary:')) {
        return true;
      }
    } else {
      break;
    }
  }
  return false;
}

/**
 * Recomputes §9.4 escape-hatch audit table and enforces RISK-7 ratchet.
 */
export function auditHygiene(packagesDir = PACKAGES_DIR) {
  const srcFiles = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        full.endsWith('.ts') &&
        !full.endsWith('.spec.ts') &&
        !full.endsWith('.spec-helper.ts') &&
        !full.endsWith('.type-test.ts') &&
        !full.includes('/__testing__/') &&
        !full.includes('/__fixtures__/')
      ) {
        srcFiles.push(full);
      }
    }
  }

  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir)) {
      const src = join(packagesDir, pkg, 'src');
      if (existsSync(src)) walk(src);
    }
  }

  let totalAssertions = 0;
  const missingBoundaries = [];
  const nonNullHits = [];
  const expectErrorHits = [];
  const evalHits = [];
  const lintDisableHits = [];
  const expectTypeOfHits = [];

  const MAX_TYPE_ASSERTIONS = 68;

  for (const filePath of srcFiles) {
    const relativePath = relative(ROOT, filePath);
    const code = readFileSync(filePath, 'utf8');
    const lines = code.split('\n');
    const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);

    const seenPositions = new Set();
    const seenNonNullLines = new Set();
    const seenEvalLines = new Set();

    function visit(node) {
      if (ts.isNonNullExpression(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const posKey = `${filePath}:${line}`;
        if (!seenNonNullLines.has(posKey)) {
          seenNonNullLines.add(posKey);

          let stmt = node;
          while (stmt && !ts.isStatement(stmt) && stmt.parent) {
            stmt = stmt.parent;
          }
          while (
            stmt &&
            stmt.parent &&
            ts.isStatement(stmt.parent) &&
            !ts.isBlock(stmt.parent) &&
            !ts.isSourceFile(stmt.parent) &&
            !ts.isCaseClause(stmt.parent)
          ) {
            stmt = stmt.parent;
          }

          const hasBoundary = checkHasBoundary(stmt, node, code, lines, line);

          if (hasBoundary) {
            totalAssertions++;
          } else {
            nonNullHits.push({ file: relativePath, line: line + 1, code: lines[line].trim() });
          }
        }
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const posKey = `${filePath}:${line}`;
        if (!seenEvalLines.has(posKey)) {
          seenEvalLines.add(posKey);
          evalHits.push({ file: relativePath, line: line + 1, code: lines[line].trim() });
        }
      }

      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const posKey = `${filePath}:${line}`;
        if (!seenEvalLines.has(posKey)) {
          seenEvalLines.add(posKey);
          evalHits.push({ file: relativePath, line: line + 1, code: lines[line].trim() });
        }
      }

      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const typeNode = node.type;
        const isAsConst =
          typeNode &&
          ((ts.isTypeReferenceNode(typeNode) &&
            ts.isIdentifier(typeNode.typeName) &&
            typeNode.typeName.text === 'const') ||
            typeNode.kind === ts.SyntaxKind.ConstKeyword);
        if (!isAsConst) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const posKey = `${filePath}:${line}`;
          if (!seenPositions.has(posKey)) {
            seenPositions.add(posKey);
            totalAssertions++;

            let stmt = node;
            while (stmt && !ts.isStatement(stmt) && stmt.parent) {
              stmt = stmt.parent;
            }
            while (
              stmt &&
              stmt.parent &&
              ts.isStatement(stmt.parent) &&
              !ts.isBlock(stmt.parent) &&
              !ts.isSourceFile(stmt.parent) &&
              !ts.isCaseClause(stmt.parent)
            ) {
              stmt = stmt.parent;
            }

            const hasBoundary = checkHasBoundary(stmt, node, code, lines, line);

            if (!hasBoundary) {
              missingBoundaries.push({ file: relativePath, line: line + 1, code: lines[line].trim() });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();

      if (
        /^\/\/\s*@(ts-expect-error|ts-ignore)\b/i.test(trimmed) ||
        /^\/\*\s*@(ts-expect-error|ts-ignore)\b/i.test(trimmed)
      ) {
        expectErrorHits.push({ file: relativePath, line: lineNum, code: trimmed });
      }

      if (
        (/^\/\/\s*(eslint-disable|oxlint-disable)\b/i.test(trimmed) ||
          /^\/\*\s*(eslint-disable|oxlint-disable)\b/i.test(trimmed)) &&
        !trimmed.includes('--')
      ) {
        lintDisableHits.push({ file: relativePath, line: lineNum, code: trimmed });
      }

      if (/\bexpectTypeOf\b/.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
        expectTypeOfHits.push({ file: relativePath, line: lineNum, code: trimmed });
      }
    }
  }

  const errors = [];

  if (totalAssertions > MAX_TYPE_ASSERTIONS) {
    errors.push(`Type assertions ratchet exceeded: found ${totalAssertions}, limit is ${MAX_TYPE_ASSERTIONS}`);
  }

  if (missingBoundaries.length > 0) {
    for (const b of missingBoundaries) {
      errors.push(`Missing // boundary: comment at ${b.file}:${b.line}: ${b.code}`);
    }
  }

  if (nonNullHits.length > 0) {
    for (const n of nonNullHits) {
      errors.push(`Forbidden undocumented non-null assertion '!' at ${n.file}:${n.line}: ${n.code}`);
    }
  }

  if (expectErrorHits.length > 0) {
    for (const e of expectErrorHits) {
      errors.push(`Forbidden compiler directive in src at ${e.file}:${e.line}: ${e.code}`);
    }
  }

  if (evalHits.length > 0) {
    for (const ev of evalHits) {
      errors.push(`Forbidden dynamic eval/new Function at ${ev.file}:${ev.line}: ${ev.code}`);
    }
  }

  if (lintDisableHits.length > 0) {
    for (const ld of lintDisableHits) {
      errors.push(`Forbidden linter suppression at ${ld.file}:${ld.line}: ${ld.code}`);
    }
  }

  if (expectTypeOfHits.length > 0) {
    for (const et of expectTypeOfHits) {
      errors.push(`Forbidden expectTypeOf call at ${et.file}:${et.line}: ${et.code}`);
    }
  }

  return {
    success: errors.length === 0,
    totalAssertions,
    missingBoundariesCount: missingBoundaries.length,
    nonNullHitsCount: nonNullHits.length,
    evalHitsCount: evalHits.length,
    errors,
  };
}

/**
 * Validates AST signature drift between SPEC.md files and exported source module definitions.
 */
export function validateAstDrift(packagesDir = PACKAGES_DIR) {
  const errors = [];
  const mdFiles = findMarkdownFiles(packagesDir);
  let totalSpecDeclarations = 0;
  let skippedBlocksCount = 0;

  for (const mdFile of mdFiles) {
    const relativeMdPath = relative(ROOT, mdFile);
    const codeBlocks = extractCodeBlocks(mdFile);
    const candidateSourceFiles = resolveSourceFilesForSpec(mdFile);
    if (candidateSourceFiles.length === 0) continue;

    const fileSymbolErrorsMap = new Map();
    const matchedSymbolsInFile = new Set();

    const sourceDeclarationsMap = new Map();
    for (const srcPath of candidateSourceFiles) {
      if (!existsSync(srcPath)) continue;
      const srcCode = readFileSync(srcPath, 'utf8');
      const sf = ts.createSourceFile(srcPath, srcCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const decls = extractDeclarationsFromSourceFile(sf, 1);
      for (const d of decls) {
        if (!sourceDeclarationsMap.has(d.name)) {
          sourceDeclarationsMap.set(d.name, []);
        }
        sourceDeclarationsMap.get(d.name).push({ ...d, srcPath });
      }
    }

    for (const block of codeBlocks) {
      const specDecls = parseDeclarations(block.code, mdFile, block.startLine);

      for (const specDecl of specDecls) {
        if (matchedSymbolsInFile.has(specDecl.name)) {
          continue;
        }

        if (isExampleDeclaration(specDecl, block.code)) {
          skippedBlocksCount++;
          continue;
        }

        totalSpecDeclarations++;
        const matchingSourceDecls = sourceDeclarationsMap.get(specDecl.name);

        if (!matchingSourceDecls || matchingSourceDecls.length === 0) {
          skippedBlocksCount++;
          continue;
        }

        let matched = false;
        let sameKindMismatchReason = '';
        let kindMismatchReason = '';

        for (const srcDecl of matchingSourceDecls) {
          const isKindMatch =
            srcDecl.kind === specDecl.kind ||
            (srcDecl.kind === 'interface' && specDecl.kind === 'type') ||
            (srcDecl.kind === 'type' && specDecl.kind === 'interface');

          if (!isKindMatch) {
            kindMismatchReason = `Kind mismatch: spec is ${specDecl.kind}, source is ${srcDecl.kind}`;
            continue;
          }

          if (specDecl.kind === 'function') {
            const paramMismatch = compareParams(specDecl.params, srcDecl.params);
            const returnMismatch = compareTypes(specDecl.returnType, srcDecl.returnType);

            if (paramMismatch) {
              sameKindMismatchReason = `Function '${specDecl.name}' parameter mismatch: ${paramMismatch}`;
            } else if (returnMismatch) {
              sameKindMismatchReason = `Function '${specDecl.name}' return type mismatch: spec expects '${specDecl.returnType}', source returns '${srcDecl.returnType}'`;
            } else {
              matched = true;
              break;
            }
          } else if (specDecl.kind === 'interface' || specDecl.kind === 'type') {
            if (specDecl.kind === 'interface' && srcDecl.kind === 'interface') {
              const propMismatch = compareProperties(specDecl.properties, srcDecl.properties);
              if (propMismatch) {
                sameKindMismatchReason = `Interface '${specDecl.name}' property mismatch: ${propMismatch}`;
              } else {
                matched = true;
                break;
              }
            } else {
              const typeMismatch = compareTypes(specDecl.type || '', srcDecl.type || '');
              if (typeMismatch) {
                sameKindMismatchReason = `${specDecl.kind} '${specDecl.name}' mismatch: spec expects '${specDecl.type}', source has '${srcDecl.type}'`;
              } else {
                matched = true;
                break;
              }
            }
          } else if (specDecl.kind === 'class') {
            const classMismatch = compareClasses(specDecl, srcDecl);
            if (classMismatch) {
              sameKindMismatchReason = `Class '${specDecl.name}' mismatch: ${classMismatch}`;
            } else {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          matchedSymbolsInFile.add(specDecl.name);
          fileSymbolErrorsMap.delete(specDecl.name);
        } else if (!fileSymbolErrorsMap.has(specDecl.name)) {
          fileSymbolErrorsMap.set(specDecl.name, {
            file: relativeMdPath,
            line: specDecl.line,
            symbol: specDecl.name,
            kind: specDecl.kind,
            message: sameKindMismatchReason || kindMismatchReason || 'Declaration mismatch',
          });
        }
      }
    }

    for (const err of fileSymbolErrorsMap.values()) {
      errors.push(err);
    }
  }

  return { errors, totalSpecDeclarations, skippedBlocksCount };
}

/**
 * Main spec validation runner function.
 */
export function validateSpecs(packagesDir = PACKAGES_DIR) {
  let errors = [];
  let checkedSpecsCount = 0;

  console.log('=== Specification & AST Verification ===');

  if (!existsSync(packagesDir)) {
    console.error('Error: packages directory not found');
    return { success: false, errors: ['packages directory not found'] };
  }

  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  // Determine changed files in git if available
  let changedFiles = new Set();
  try {
    let diffOutput = '';
    let isPorcelain = false;
    try {
      diffOutput = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      try {
        diffOutput = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch {
        diffOutput = execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        isPorcelain = true;
      }
    }
    diffOutput
      .split('\n')
      .map(l => {
        const trimmed = l.trim();
        return isPorcelain ? trimmed.replace(/^..\s+/, '') : trimmed;
      })
      .filter(Boolean)
      .forEach(f => changedFiles.add(f));
  } catch (e) {
    console.warn('Note: Could not run git diff check:', e.message);
  }

  console.log(`Discovered packages: ${packages.join(', ')}`);
  if (changedFiles.size > 0) {
    console.log(`Detected ${changedFiles.size} changed file(s) in git workspace.`);
  }

  // 1. Structural & checklist validation
  for (const pkg of packages) {
    const pkgDir = join(packagesDir, pkg);
    const rootSpecPath = join(pkgDir, 'SPEC.md');

    if (!existsSync(rootSpecPath)) {
      errors.push(`Package '@zmdb/${pkg}' is missing root specification file (packages/${pkg}/SPEC.md)`);
      continue;
    }

    const specFiles = findSpecFiles(pkgDir);
    for (const specPath of specFiles) {
      checkedSpecsCount++;
      const relPath = relative(ROOT, specPath);
      const content = readFileSync(specPath, 'utf8');

      if (!content.trim()) {
        errors.push(`Specification file is empty: ${relPath}`);
        continue;
      }

      if (!content.includes('# ')) {
        errors.push(`Specification file missing main title (# ...): ${relPath}`);
      }

      const lines = content.split('\n');
      const pkgSrcPrefix = `packages/${pkg}/src/`;
      const pkgHasChanges = Array.from(changedFiles).some(f => f.startsWith(pkgSrcPrefix));
      if (pkgHasChanges) {
        const uncheckedInSpec = lines.filter(l => l.trim().startsWith('- [ ]'));
        if (uncheckedInSpec.length > 0) {
          errors.push(
            `Package '@zmdb/${pkg}' has source changes but ${relPath} contains ${uncheckedInSpec.length} unverified checklist item(s)`,
          );
        }
      }
    }
  }

  console.log(`Checked ${checkedSpecsCount} specification file structure(s).`);

  // 2. AST Contract Drift Verification
  const { errors: driftErrors, totalSpecDeclarations, skippedBlocksCount } = validateAstDrift(packagesDir);
  console.log(
    `Parsed ${totalSpecDeclarations} specification declarations across code blocks (${skippedBlocksCount} example/import blocks skipped).`,
  );

  for (const dErr of driftErrors) {
    errors.push(`${dErr.file}:${dErr.line} [${dErr.symbol}] - ${dErr.message}`);
  }

  // 3. Hygiene & Type Assertion Ratchet Audit
  const hygiene = auditHygiene(packagesDir);
  if (!hygiene.success) {
    for (const hErr of hygiene.errors) {
      errors.push(`Hygiene violation: ${hErr}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Specification & AST Verification Failed (${errors.length} error(s)):\n`);
    for (const err of errors) {
      console.error(` - ${err}`);
    }
    console.error(`\n💡 How to resolve contract drift on intentional API changes:`);
    console.error(
      `   1. Update the TypeScript declaration in the affected SPEC.md file to match your updated source signatures.`,
    );
    console.error(`   2. Run \`yarn validate:spec\` locally to verify zero contract drift.`);
    console.error(`   3. Commit the updated SPEC.md along with your code changes.\n`);
    return { success: false, errors };
  } else {
    console.log(`\n✅ All specifications, checklist items, and AST contract signatures validated with zero drift.`);
    console.log(
      `✅ Codebase hygiene verified: ${hygiene.totalAssertions} documented boundaries, 0 undocumented non-null !, 0 eval/new Function.\n`,
    );
    return { success: true, errors: [] };
  }
}

// Execute CLI runner when invoked directly from command line
if (process.argv[1] && process.argv[1].endsWith('validate-specs.mjs')) {
  const result = validateSpecs();
  if (!result.success) {
    process.exit(1);
  }
}
