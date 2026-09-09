# Internal planning history

These files are a record of how work was planned and closed. They are **not** current plans, and nothing here is a contract.

- `epics/` — twelve epic briefs written before the corresponding features were implemented. They name packages and APIs that have since been renamed (`@zmdb/query-compiler` is now `@zmdb/sql`) and
  quote benchmark results that later runs superseded. Read them for the motivation behind a feature, not for its present shape.
- `issue-closures/` — one record per closed issue, naming the implementing commit.

Current material lives elsewhere: [ARCHITECTURE.md](../../ARCHITECTURE.md) for system invariants, the owning `SPEC.md` for each concern's public contract, the [ADR index](../adr/index.md) for dated
decisions, and the GitHub issue graph for what is actually planned. `CONTRIBUTING.md` says it directly — a historical diagram or checklist does not change the issue graph.

They moved here from `.github/` because that directory is where a visitor looks for how to report a bug and how to open a pull request, and internal planning artifacts were crowding out those answers.
