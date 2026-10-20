export {
  discoverWorkspaceCandidates,
  resolveInventoryContainmentRoot,
} from "./discover-candidates.js";
export { classifyWorkspaceDurability } from "./durability.js";
export { runWorkspaceInventory, type RunWorkspaceInventoryParams } from "./inventory.js";
export { assertSafePathSegment, isPathInside, toPathPattern } from "./path-safety.js";
export { scanWorkspaceRoot, type ScanRootLimits, type ScanRootResult } from "./scan-root.js";
export {
  redactInventoryRecord,
  SUMMARY_SHA256_ALGORITHM,
  stripSummarySha,
  toRedactedInventorySummary,
  verifySummarySha256,
} from "./summary.js";
export {
  WORKSPACE_INVENTORY_RAW_SCHEMA,
  WORKSPACE_INVENTORY_SUMMARY_SCHEMA,
  type DiscoverCandidateDescriptor,
  type WorkspaceBindingRole,
  type WorkspaceDurabilityClass,
  type WorkspaceInventoryLimits,
  type WorkspaceInventoryRecord,
  type WorkspaceInventoryReport,
  type WorkspaceInventoryStats,
  type WorkspaceInventorySummary,
  type WorkspaceOwnershipStatus,
} from "./types.js";
