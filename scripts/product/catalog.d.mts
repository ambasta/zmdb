export interface ProductPackageFacade {
  readonly root: readonly string[];
  readonly subpaths: readonly `zmdb/${string}`[];
}

export type ProductPackageOptionality =
  | { readonly kind: 'required' }
  | { readonly kind: 'tooling' }
  | { readonly kind: 'integration'; readonly technology: string };

export type ProductPackageConsumer = { readonly fixture: `fixtures/${string}` } | { readonly reason: string };

export interface ProductPackage {
  readonly id: string;
  readonly directory: `packages/${string}`;
  readonly npmName: string;
  readonly role: string;
  readonly facade: ProductPackageFacade;
  readonly optionality: ProductPackageOptionality;
  readonly docsOwner: string;
  readonly consumer: ProductPackageConsumer;
}

export const PRODUCT_CATALOG: readonly ProductPackage[];
