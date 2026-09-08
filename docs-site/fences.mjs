export function readFence(lines, start) {
  const opening = /^( {0,3})(`{3,})([^`]*)$/.exec(lines[start] ?? '');
  if (!opening) return undefined;
  const [, indentation, delimiter, rawInfo] = opening;
  const [language = '', metadata] = rawInfo.trim().split(/\s+(.*)/s, 2);
  const closing = new RegExp(`^ {0,3}\`{${delimiter.length},}\\s*$`);
  const code = [];
  let next = start + 1;
  while (next < lines.length && !closing.test(lines[next])) {
    code.push(lines[next].replace(new RegExp(`^ {0,${indentation.length}}`), ''));
    next++;
  }
  return { language, metadata, code: code.join('\n'), line: start + 1, next: Math.min(next + 1, lines.length) };
}

export function parseFences(markdown) {
  const lines = markdown.split('\n');
  const fences = [];
  for (let index = 0; index < lines.length; index++) {
    const fence = readFence(lines, index);
    if (!fence) continue;
    fences.push(fence);
    index = fence.next - 1;
  }
  return fences;
}
