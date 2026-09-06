export default {
  async check({ Yarn }) {
    for (const workspace of Yarn.workspaces()) {
      for (const dependency of workspace.manifest.dependencies) {
        if (dependency.range.startsWith('workspace:') && dependency.range !== 'workspace:^') {
          dependency.error('Cross-package workspace dependencies must use workspace:^');
        }
      }
      for (const dependency of workspace.manifest.devDependencies) {
        if (dependency.range.startsWith('workspace:') && dependency.range !== 'workspace:^') {
          dependency.error('Cross-package workspace devDependencies must use workspace:^');
        }
      }
      if (workspace.manifest.raw.engines?.node !== '>=26') {
        workspace.error('Workspace must specify node engine >=26');
      }
    }
  },
};
