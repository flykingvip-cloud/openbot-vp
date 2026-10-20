export type CognitiveMutationFaultHook = {
  beforeCatalogCas?: () => void | Promise<void>;
  afterCatalogCasBeforeFinalize?: () => void | Promise<void>;
};

let installedHook: CognitiveMutationFaultHook | undefined;

/** Production always reads this slot. Tests install via the test harness only. */
export function getCognitiveMutationFaultHook(): CognitiveMutationFaultHook | undefined {
  return installedHook;
}

/** Test-only. Not re-exported from the production barrel or command signature. */
export function installCognitiveMutationFaultHookForTests(next?: CognitiveMutationFaultHook): void {
  installedHook = next;
}
