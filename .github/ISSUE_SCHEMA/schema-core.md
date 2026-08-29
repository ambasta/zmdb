## Goal

Implement the core schema DSL and compile-time type derivation system.

## Scope

Create `schema-core` package with:

- **DSL**: Column builders (serial(), integer(), text(), numeric(), jsonEnum(), timestamp(), etc.)
- **Modifiers**: notNull(), primaryKey(), references(), defaultTo(), validate()
- **Type Derivation**:
  - Entity<T> - raw DB row type
  - CreateDTO<T> - strips auto-increment fields
  - UpdateDTO<T> - all fields optional
- **Validation Rules**: tags.Minimum, tags.MaxLength, tags.Pattern, tags.Enum

## Requirements

- No runtime dependencies
- ESM-only
- TypeScript 7.0+

## Deliverables

- packages/schema-core/ with full implementation
- Unit tests for DSL chainability
- Type tests for derivation correctness

## Dependencies

None (this is the foundation)