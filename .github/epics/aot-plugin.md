# [EPIC] Wire the AOT validator as a real build plugin (prove the AOT premise)

## Motivation (from real benchmarks)
Our headline design claim is **AOT-inlined validation faster than runtime
parsers**. The comparative benchmark
([benchmarks/RESULTS.md](../../benchmarks/RESULTS.md)) shows we have **NOT proven
this**: zmdb currently runs its **runtime** validator (`is`/`equals` walking a
`TypeDescriptor`), because `transformSource` is not wired as a build plugin.

Real numbers (moltar runner, ops/s):

| case | zmdb (runtime) | zod v4 | typebox (JIT) | ajv |
|------|---------------:|-------:|--------------:|----:|
| assertLoose | 5,037,460 | 4,603,060 | 88,070,252 | 43,363,522 |
| assertStrict | 1,207,424 | 3,918,349 | 29,157,066 | 29,246,420 |
| parseSafe | 1,438,372 | 8,052,444 | — | — |
| parseStrict | 1,258,077 | 4,680,788 | — | — |

**zod v4 beats our runtime path on 3 of 4 cases; JIT libs are 6–24× ahead on
assert.** Our AOT path — the entire premise — is unmeasured. This epic wires it
and proves (or disproves) the claim on the same benchmark.

## Goal
Ship `@zmdb/aot-validator` as a **real TypeScript transformer build plugin**
(ts-patch / ttypescript / unplugin), so `is<T>()` / `assert<T>()` / `validate<T>()`
calls are replaced at build time with inlined, allocation-free, monomorphic JS —
no `TypeDescriptor` walk, no per-field function dispatch at runtime.

## Definition of Done
Sub-issues collectively deliver:
1. Frozen spec: plugin packaging, the `<T>`→inlined-JS contract, and the
   benchmark acceptance target.
2. Type-driven code generation from a real TS type `T` (not a runtime descriptor):
   emit straight-line checks with early-exit.
3. ts-patch / unplugin packaging + a fixture build that emits inlined output.
4. Re-run the moltar suite with the AOT build and record real numbers.
5. **Acceptance: AOT `assert`/`is` must beat our runtime path by ≥5× and be
   competitive with TypeBox-JIT; if it cannot, document why and revise the
   architecture claim honestly.**

## Constraints
- No `TypeDescriptor` walk on the hot path (that is the runtime fallback).
- Emitted code must be monomorphic + allocation-free on the success path.
- ESM-only, Node 26+, TS 7.

Labels: epic, perf, parity:zod, parity:typia.
