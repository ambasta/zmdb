// The roadmap, as data. Twenty-seven epics covering every `todo` page in the docs site; each epic is an
// independent capability goal, and each sub-issue is a slice that lands something testable. Order here
// is the order issues get filed, so an epic whose sub-issues are blocked by another epic's should come
// after it — `file-issues.mjs` validates every reference regardless, so a mistake is loud, not silent.
//
// The three GraphQL epics (#537, #543, #550) used to be here, as 07-graphql.mjs with sixteen
// sub-issues. GraphQL is out of scope and they are closed as wontfix, so the data is gone rather than
// commented out: `file-issues.mjs` is idempotent by title and would re-file whatever is still in this
// list. What was decided survives in the frozen specs (`packages/web/src/graphql/**/SPEC.md`,
// `packages/schema-core/src/sdl/SPEC.md`) and in the twelve docs pages, now marked `wontfix`.

import { SCHEMA_EPICS } from './01-schema.mjs';
import { SCHEMA_OBJECT_EPICS } from './01b-schema-objects.mjs';
import { DATA_EPICS } from './02-data.mjs';
import { VALIDATOR_EPICS } from './03-validator-tooling.mjs';
import { CLI_EPICS } from './04-cli.mjs';
import { DIALECT_EPICS } from './05-dialects.mjs';
import { LLM_EPICS } from './06-llm.mjs';
import { TRANSPORT_EPICS } from './08-transports.mjs';
import { HTTP_EPICS } from './09-http.mjs';
import { OPS_EPICS } from './10-ops.mjs';
import { JOB_EPICS } from './11-jobs.mjs';
import { MODULE_EPICS } from './12-modules.mjs';

export const EPICS = [
  ...SCHEMA_EPICS,
  ...SCHEMA_OBJECT_EPICS,
  ...DATA_EPICS,
  ...VALIDATOR_EPICS,
  ...CLI_EPICS,
  ...DIALECT_EPICS,
  ...LLM_EPICS,
  ...TRANSPORT_EPICS,
  ...HTTP_EPICS,
  ...OPS_EPICS,
  ...JOB_EPICS,
  ...MODULE_EPICS,
];
