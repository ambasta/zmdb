const workspaceSource = process.env['ZMDB_NEXT_WORKSPACE_SOURCE'] === '1';

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(workspaceSource
    ? {
        experimental: {
          extensionAlias: {
            '.js': ['.ts', '.js'],
            '.jsx': ['.tsx', '.jsx'],
          },
        },
      }
    : {}),
};

export default config;
