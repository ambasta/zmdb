export const ROOT: string;
export const PACKAGES: readonly string[];

export function toDist(target: string, extension: string): string;
export function publishManifest(manifest: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
export function readManifest(name: string): Readonly<Record<string, unknown>>;
