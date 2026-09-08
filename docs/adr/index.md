# Architecture decision records

Current contracts live in the owning `SPEC.md` files. These records preserve dated decisions and evidence; their current-contract links lead back to the active rules.

| Record                                                                                          | Status     | Current owner                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| [0001 — Architecture and native-graph history](./0001-architecture-and-native-graph-history.md) | Superseded | [Architecture SPEC](../../scripts/architecture/SPEC.md)                                    |
| [0002 — Selected-jobs packed baseline](./0002-selected-jobs-baseline.md)                        | Superseded | [Jobs SPEC](../../packages/jobs/SPEC.md)                                                   |
| [0003 — Release-policy starting inventory and probe](./0003-release-baseline.md)                | Superseded | [Release SPEC](../../scripts/release/SPEC.md)                                              |
| [0004 — Package extraction and product baselines](./0004-package-and-product-baselines.md)      | Superseded | [Package and product contracts](./0004-package-and-product-baselines.md#current-contracts) |

Each record names its decision date, owning issues, source evidence, consequences and current replacement. The original excerpt bytes are retained, including historical names and measurements. Current
package or issue counts must be obtained from the live authoritative models, not from an ADR.

This index covers the explicitly dated blocks moved in #737. It is not a certification that every historical sentence in every package specification has been classified. Use the
[contributor workflow](../../CONTRIBUTING.md) for current changes and preserve any later historical move with the same source context.
