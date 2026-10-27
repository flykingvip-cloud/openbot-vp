/**
 * Re-export DS path1 manageable memory list (single source: src/data/memory-list).
 * Kept so existing gateway-relative imports/tests continue to resolve.
 */
export {
  isIndexedWorkspaceMemoryKey,
  listAgentMemoryEntries,
  type AgentMemoryListEntry,
} from "../../data/memory-list.js";
