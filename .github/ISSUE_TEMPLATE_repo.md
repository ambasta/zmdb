# Implement @zmdb/repository: Auto-validating CRUD

## Goal
Build the BaseRepository that provides <10 line CRUD with automatic AOT validation.

## Scope
Create repository package with:
- BaseRepository generic class
- Pre/post hooks (preInsert, postSelect, etc.)
- Validation interceptors that use aot-validator
- Integration with query-compiler for SQL execution

## Requirements
- Full CRUD: findById, create, update, delete, findAll
- Auto-validates against CreateDTO/UpdateDTO
- No manual validation code needed in subclasses

## Deliverables
- packages/repository/ with BaseRepository
- Auto-validation interceptors
- Integration tests showing <10 line setup

## Dependencies
- @zmdb/schema-core
- @zmdb/query-compiler
- @zmdb/aot-validator