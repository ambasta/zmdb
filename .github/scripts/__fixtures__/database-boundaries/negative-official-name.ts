export function compileFor(dialect: { readonly name: string }): string {
  return dialect.name === 'postgres' ? 'vendor branch' : 'generic';
}
