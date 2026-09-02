// The build-time entry point. Importing this pulls in `typescript`; that is the whole
// difference between it and `.` (see the note at the top of `src/index.ts`).
export { zmdbAot, transformTypeChecks, type UnpluginLike, type ZmdbAotOptions } from './plugin/index.ts';
export {
  transformCode,
  transformFile,
  type TransformContext,
  type TransformDiagnostic,
  type TransformResult,
} from './transformer.ts';
