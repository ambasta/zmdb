// Shared startup/build-time representation helpers. These are deliberately not
// exported from the package: the public surface is VersionStrategy plus the
// decorators, while the router and document generator must still spell paths
// and media types identically.

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

function isTokenCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 33 ||
    code === 35 ||
    code === 36 ||
    code === 37 ||
    code === 38 ||
    code === 39 ||
    code === 42 ||
    code === 43 ||
    code === 45 ||
    code === 46 ||
    code === 94 ||
    code === 95 ||
    code === 96 ||
    code === 124 ||
    code === 126
  );
}

function mediaParameterValue(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (!isTokenCode(value.charCodeAt(index))) {
      return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    }
  }
  return value;
}

/** The response media type and OpenAPI content key for one exact version. */
export function jsonMediaTypeForVersion(key: string, version: string): string {
  return `application/json; ${key.toLowerCase()}=${mediaParameterValue(version)}`;
}
