# Package reference

> [!NOTE] This catalog-backed reference is specified by #618 and remains a TODO until #622 generates it and #624 publishes the verified product journey. The absence of a generated table here is
> deliberate: a handwritten package list would create the drift this page is meant to remove.

zmdb is installed as one product:

```bash
npm add zmdb@alpha
```

The root and `zmdb/*` subpaths are the application-facing contract. Individual `@zmdb/*` packages are advanced dependency firebreaks for consumers that deliberately need one concern without the
complete product; they are not steps in the beginner setup.

The generated reference must contain one row per official product-catalog entry, with:

- the manifest-derived npm name and version;
- the package's product role;
- whether it is required, tooling-only, or a selected integration;
- root and subpath facade exposure;
- its documentation owner; and
- the packed external fixture that proves it, or the catalog's explicit reason for having no fixture.

Optional drivers, frontend adapters, transports, brokers, telemetry providers, and similar technologies appear only when selected. Importing `zmdb` must not load them.

<!-- generated: product-catalog package-reference -->
<!-- /generated: product-catalog package-reference -->

Release versions, changelog entries, npm tags, and publish order are not product catalog fields. See the architecture and publishing references; that policy is owned by architecture-governance EPIC
#721 and #728.
