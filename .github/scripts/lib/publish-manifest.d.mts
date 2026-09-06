import type { ProductPackage } from '../../../scripts/product/catalog.mjs';

export const ROOT: string;

export interface PublishPackage {
  readonly id: string;
  readonly directory: string;
  readonly directoryPath: string;
  readonly manifestPath: string;
  readonly npmName: string;
  readonly catalog: ProductPackage;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface PublishTrain {
  readonly packages: readonly PublishPackage[];
  readonly releaseId: string;
  readonly version: string;
}

export type ReleaseTarget =
  | { readonly kind: 'core'; readonly version: string }
  | { readonly kind: 'package'; readonly id: string; readonly version: string };

export function publishCatalog(root?: string): Promise<readonly PublishPackage[]>;
export function publishTrain(root?: string, target?: ReleaseTarget): Promise<PublishTrain>;

export function toDist(target: string, extension: string): string;
export function publishManifest(manifest: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export function readManifest(identity: string, packages: readonly PublishPackage[]): Readonly<Record<string, unknown>>;
