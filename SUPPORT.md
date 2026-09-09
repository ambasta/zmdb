# Getting help

zmdb is pre-1.0 and has one maintainer. There is no support contract, no response-time commitment and no paid tier. What follows is what actually exists.

## Read first

Most questions have a written answer already:

- [Documentation](https://ambasta.github.io/zmdb/) — a page per topic, including a page for each rejected design that records why it was rejected.
- [FAQ](https://ambasta.github.io/zmdb/docs/faq.html) — licensing, LLM authorship, and the questions that come up before adoption.
- [Anti-patterns](https://ambasta.github.io/zmdb/docs/anti-patterns.html) — the fastest way to find out whether zmdb's design suits your application, and the first place to look when something fights
  you.
- [ARCHITECTURE.md](./ARCHITECTURE.md) and each package's `SPEC.md` — the invariants and the public contract. A SPEC is the authority when the docs and the code disagree.
- [ADR index](./docs/adr/index.md) — dated decisions, including ones that have since been superseded.

## Ask in an issue

[GitHub Issues](https://github.com/ambasta/zmdb/issues) is the only channel. Discussions are not enabled, there is no chat server, and the maintainer's email is for security reports and Code of
Conduct reports, not for usage questions — an answer in an issue is searchable by the next person with the same problem.

Search the closed issues before opening one. The [question template](https://github.com/ambasta/zmdb/issues/new?template=question.yml) asks for your versions and a snippet, because a compile-time
schema library behaves differently across TypeScript versions and bundler configurations, and a question without those usually costs a round trip.

- **Bug** — [bug template](https://github.com/ambasta/zmdb/issues/new?template=bug_report.yml). A minimal reproduction gets a fix; a description of one usually gets questions.
- **Feature** — [feature template](https://github.com/ambasta/zmdb/issues/new?template=feature_request.yml). Check the docs first: several frequently requested features are documented as deliberately
  out of scope, and those pages give the reasoning rather than a "no".
- **Security vulnerability** — do not open a public issue. Use [private vulnerability reporting](https://github.com/ambasta/zmdb/security/advisories/new), as [SECURITY.md](./SECURITY.md) describes.

## What to expect

Best effort, from one person, in one time zone. Issues with a runnable reproduction get looked at first. Only the latest published version gets fixes: there is no LTS, no backport branch, and the
public API may change before 1.0.0 — see the project status note in the [README](./README.md).

If you need a guarantee about response times or API stability, zmdb is not ready for you yet. That is a statement about the project's age, not about your requirements.

## Helping instead of asking

An answer you had to work out yourself is worth writing down. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the workflow; a documentation fix is a normal pull request and is the most useful first
contribution.
