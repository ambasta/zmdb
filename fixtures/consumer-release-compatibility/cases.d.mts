export interface ConsumerCase {
  readonly files: Readonly<Record<string, string>>;
  readonly runtime: string;
  readonly roots: readonly string[];
  readonly peers: Readonly<Record<string, string>>;
  readonly conditions: readonly string[];
  readonly evidence: string;
  readonly service?: string;
}
export const CONSUMER_CASES: Readonly<Record<string, ConsumerCase>>;
