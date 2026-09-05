# GitHub Scripts & Maintenance Tooling

This directory contains repository maintenance, workflow automation, and CI verification scripts.

## Verification & Validation Scripts

To maintain clarity and avoid duplicate operations across CI jobs, script responsibilities are strictly partitioned by domain:

### 1. Specification & AST Verification (`validate-specs.mjs`)

- **Command**: `yarn validate:spec`
- **CI Job**: `spec-validation`
- **Responsibilities**:
  - Validates specification presence and structure (`# Title`, non-empty) across package `SPEC.md` files.
  - Validates unverified checklist items (`- [ ]`) against changed package source files.
  - Extracts TypeScript code blocks from `SPEC.md` files using TypeScript AST parsing (`ts.createSourceFile`) and compares function, interface, type, and class signatures against exported package code
    to prevent contract drift.
  - Audits codebase hygiene and ARCHITECTURE §2.1 type assertion ratchets (verifying all assertions carry `// boundary:` comments, enforcing 0 `any`, 0 non-null `!`, 0 linter suppressions, and 0
    `eval`/`new Function` call sites).

#### Handling Legitimate Intentional API Changes

When making an intentional change to exported TypeScript types, interfaces, or function signatures:

1. **Run local check**: Run `yarn validate:spec` to identify out-of-sync `SPEC.md` files and line numbers.
2. **Update Specifications**: Update the TypeScript declaration blocks in the corresponding `SPEC.md` file(s) to match your updated implementation signatures.
3. **Verify**: Re-run `yarn validate:spec` to confirm zero contract drift and clean hygiene.
4. **Commit**: Include the updated `SPEC.md` file(s) in your commit.

---

### 2. Export Manifest Resolution Verification (`verify-exports.mjs`)

- **Command**: `yarn verify:exports`
- **CI Job**: `test` (in `ci.yml`)
- **Responsibilities**:
  - Validates package `package.json` export manifests (`exports`, `main`, `module`, `types`) across all monorepo packages to confirm every declared entry point resolves to a built file on disk.

---

## Unit Testing

Unit tests for verification tooling live alongside the scripts in `.github/scripts/*.spec.ts` (executed as part of `yarn vitest run`).
