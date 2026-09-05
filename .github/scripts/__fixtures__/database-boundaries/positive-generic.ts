export function quote(open: string, close: string, identifier: string): string {
  return `${open}${identifier}${close}`;
}
