/** Package managers that are currently supported. */
export function getPossiblePackageManagers() {
  return ['npm', 'pnpm', 'yarn'] as const;
}
