/**
 * Collaboration storage convergence status (Phase 6 complete).
 */

/** Fixed sentence for code comments, docs, and onboarding. Do not paraphrase. */
export const COLLABORATION_SPACES_MIRROR_SENTENCE =
  "{stateDir}/spaces/{groupId} 是 UI / 治理镜像，不是 runtime memory 决策真相；runtime 读写以 resolveGroupCollaborationPaths() 输出的 group root 为准。";

export const COLLABORATION_CONVERGENCE_STATUS = "legacy-free" as const;

export type LegacyCompatRemovalItem = {
  id: string;
  location: string;
  symbol: string;
  removedAt: string;
};

/** Completed Phase 6 cleanup wave (LC-1 … LC-7). */
export const LEGACY_COMPAT_REMOVAL_COMPLETED: LegacyCompatRemovalItem[] = [
  {
    id: "LC-1",
    symbol: "createGroupFileStore read fallback",
    location: "shared.ts",
    removedAt: "2026-06-19",
  },
  {
    id: "LC-2",
    symbol: "legacyGroupRootDir factory field",
    location: "shared.ts",
    removedAt: "2026-06-19",
  },
  {
    id: "LC-3",
    symbol: "agent-workspace collaboration root export",
    location: "shared.ts",
    removedAt: "2026-06-19",
  },
  {
    id: "LC-4",
    symbol: "space-store legacy enumeration",
    location: "space-store.ts",
    removedAt: "2026-06-19",
  },
  {
    id: "LC-5",
    symbol: "ledger reader dual-source merge",
    location: "reader.ts",
    removedAt: "2026-06-19",
  },
  { id: "LC-6", symbol: "resolveLegacyLedgerPath", location: "writer.ts", removedAt: "2026-06-19" },
  {
    id: "LC-7",
    symbol: "managed-space read fallback in group store",
    location: "shared.ts",
    removedAt: "2026-06-19",
  },
];

/** @deprecated Use LEGACY_COMPAT_REMOVAL_COMPLETED. Queue is empty after Phase 6. */
export const LEGACY_COMPAT_REMOVAL_QUEUE: LegacyCompatRemovalItem[] = [];
