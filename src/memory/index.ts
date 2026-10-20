export { MemoryIndexManager } from "./manager.js";
export type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "./types.js";
export {
  bumpMemoryGovernanceEpoch,
  buildMemorySearchGovernanceFromCallEntry,
  closeAllMemorySearchManagers,
  getMemoryGovernanceEpoch,
  getMemorySearchManager,
  invalidateCogniWeaveManagersForGovernanceChange,
  invalidateCogniWeaveManagersForGovernanceChangeSync,
  isManagedCogniWeaveTenant,
  resetMemoryGovernanceEpochForTests,
  type MemorySearchDataPlaneFields,
  type MemorySearchGovernance,
  type MemorySearchManagerParams,
  type MemorySearchManagerResult,
  resolveMemorySearchManagerDataRoot,
} from "./search-manager.js";
