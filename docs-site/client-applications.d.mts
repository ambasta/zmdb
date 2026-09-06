export type ClientApplicationKind = 'base' | 'meta-framework' | 'native';
export type ClientApplicationSupport = 'framework-owned' | 'n/a' | 'native' | 'no' | 'yes';

export interface ClientApplicationDocumentation {
  readonly name: string;
  readonly package: string;
  readonly slug: string;
  readonly kind: ClientApplicationKind;
  readonly support: {
    readonly csr: ClientApplicationSupport;
    readonly ssr: ClientApplicationSupport;
    readonly hydration: ClientApplicationSupport;
    readonly cancellation: ClientApplicationSupport;
    readonly nativeLifecycle: ClientApplicationSupport;
  };
  readonly example: string;
  readonly packedTest: string;
}

export const CLIENT_APPLICATIONS: readonly ClientApplicationDocumentation[];
export const RECIPE_ONLY_CLIENTS: readonly string[];
export const CLIENT_GUIDE_SECTIONS: readonly string[];
