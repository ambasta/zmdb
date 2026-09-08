export interface Model<N extends number> {
  number: N;
  negNumber: N;
  maxNumber: N;
  string: string;
  longString: string;
  boolean: boolean;
  deeplyNested: { foo: string; num: N; bool: boolean };
}
