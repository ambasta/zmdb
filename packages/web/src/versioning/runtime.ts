// Shared startup/build-time representation helpers. These are deliberately not
// exported from the package: the public surface is VersionStrategy plus the
// decorators, while the router and document generator must still spell paths
// and media types identically.

import { isHttpTokenCode } from '../http-token.js';

function trimSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 47) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(start, end);
}

/** Expand one route path for a path-versioning strategy. */
export function pathForVersion(prefix: string, version: string, path: string): string {
  const head = `/${trimSlashes(prefix)}${version}`;
  return path === '/' ? head : `${head}${path.startsWith('/') ? '' : '/'}${path}`;
}

function mediaParameterValue(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (!isHttpTokenCode(value.charCodeAt(index))) {
      return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    }
  }
  return value;
}

/** The response media type and OpenAPI content key for one exact version. */
export function jsonMediaTypeForVersion(key: string, version: string): string {
  return `application/json; ${key.toLowerCase()}=${mediaParameterValue(version)}`;
}
