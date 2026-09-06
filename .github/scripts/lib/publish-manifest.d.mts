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
  readonly version: string;
}

export function publishTrain(root?: string): Promise<PublishTrain>;

export function toDist(target: string, extension: string): string;
export function publishManifest(
  manifest: Readonly<Record<string, unknown>>,
  commonVersion: string,
): Readonly<Record<string, unknown>>;
export function readManifest(identity: string, train: PublishTrain): Readonly<Record<string, unknown>>;
