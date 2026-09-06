export const ROOT: string;

export interface PublishPackage {
  readonly id: string;
  readonly directory: string;
  readonly npmName: string;
}

export interface PublishTrain {
  readonly packages: readonly PublishPackage[];
  readonly version: string;
}

export function publishTrain(root?: string): PublishTrain;

export function toDist(target: string, extension: string): string;
export function publishManifest(
  manifest: Readonly<Record<string, unknown>>,
  commonVersion: string,
): Readonly<Record<string, unknown>>;
export function readManifest(identity: string): Readonly<Record<string, unknown>>;
