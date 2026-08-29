// AOT build plugin — API stubs (red phase, #79). Implementation in #80–#83.
// The transformer reads a checked TS type and emits inline validators. Here we
// stub a source-string transform harness (like the primitive-tag transformer)
// so the spec-freeze golden tests can pin the emitted-JS contract.

const NOT_IMPL = 'not implemented';

// Transform a TS source string, inlining is<T>()/assert<T>() calls whose type
// argument is a supported object/primitive shape. (The real plugin uses the TS
// program/checker; this string harness pins the emitted-JS contract for tests.)
export function transformTypeChecks(_code: string): string {
  throw new Error(NOT_IMPL);
}

// unplugin factory (packaging wrapper).
export function zmdbAot(): unknown {
  throw new Error(NOT_IMPL);
}
