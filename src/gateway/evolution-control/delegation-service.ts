import path from "node:path";
import { createFileDelegationStore } from "../../diagnosis/delegation-file-store.js";
import {
  createDiagnosisDelegationMachine,
  type DiagnosisDelegationMachine,
} from "../../diagnosis/delegation.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export const DELEGATION_GRANTS_FILENAME = "delegation-grants.snapshot.json";

let sharedMachine: DiagnosisDelegationMachine | undefined;
let sharedPersistDir: string | undefined;

export function resolveDelegationStorePath(persistDir?: string): string {
  return path.join(resolveEvolutionControlRoot(persistDir), DELEGATION_GRANTS_FILENAME);
}

/** Process-wide delegation machine backed by the evolution-control persist dir. */
export function getSharedDiagnosisDelegationMachine(
  persistDir?: string,
): DiagnosisDelegationMachine {
  const dir = resolveEvolutionControlRoot(persistDir);
  if (sharedMachine && sharedPersistDir === dir) {
    return sharedMachine;
  }
  sharedMachine = createDiagnosisDelegationMachine({
    store: createFileDelegationStore(resolveDelegationStorePath(dir)),
  });
  sharedPersistDir = dir;
  return sharedMachine;
}

export function resetSharedDiagnosisDelegationForTests(): void {
  sharedMachine = undefined;
  sharedPersistDir = undefined;
}
