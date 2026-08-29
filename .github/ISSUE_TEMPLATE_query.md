# Implement @zmdb/query-compiler: Kysely fork with raw SQL

## Goal
Build the query compiler that generates raw SQL strings with zero runtime type resolution.

## Scope
Create query-compiler package with:
- SELECT compiler (selectFrom, where, orderBy, limit, etc.)
- INSERT compiler
- UPDATE compiler
- DELETE compiler
- Dialect support: PostgreSQL, MySQL, SQLite

## Requirements
- No runtime type resolution (compile-time only)
- Parameterized queries ($1, $2 or ?)
- No dependencies on Kysely runtime

## Deliverables
- packages/query-compiler/ with full SQL compilation
- Tests for each SQL dialect
- Benchmarks showing zero overhead vs Kysely

## Dependencies
None (pure compiler, no DB drivers)