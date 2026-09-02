// The validation suite's data model — moltar's, exactly — declared **once**, as a type.
//
// Everything the benchmark validates against is derived from this declaration:
// `model.generated.ts` holds the IR the runtime walker reads and the inlined functions
// the transformer emits, and both come out of this interface (see `generate.mjs`).
//
// It used to be written three times: a `TypeDescriptor` literal in the bench, another in
// the participant, and a hand-inlined validator that a comment promised was "exactly what
// the transformer would emit". Three copies of one shape, in a benchmark whose entire
// claim is that you write the shape once (REQ-TF-9). Worse, the hand-inlined copy was the
// measured one, so the published AOT number belonged to code no user could obtain.
export interface Moltar {
  number: number;
  negNumber: number;
  maxNumber: number;
  string: string;
  longString: string;
  boolean: boolean;
  deeplyNested: {
    foo: string;
    num: number;
    bool: boolean;
  };
}
