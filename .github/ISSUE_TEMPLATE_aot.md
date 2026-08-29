# Implement @zmdb/aot-validator: Compile-time validation inlining

## Goal
Create TypeScript transformer that inlines validation at compile-time for zero runtime overhead.

## Scope
Create aot-validator package with:
- TypeScript transformer plugin
- Validation rules: minimum, maximum, minLength, maxLength, pattern, enum
- JavaScript AST emitter for inline checks

## Requirements
- Validates at compile-time, not runtime
- Zero runtime function calls in production
- Works with schema-core validation tags

## Deliverables
- packages/aot-validator/ with transformer
- Validation rules implementation
- Integration test proving AOT inlining works

## Dependencies
TypeScript (dev dependency only)