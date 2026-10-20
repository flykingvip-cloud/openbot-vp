import type { AssetType, SkillLifecycleState } from "../skill-lifecycle-store.js";

/** Directory name prefix for materialised lifecycle skills (must not collide with user skills). */
export const SKILL_EXECUTION_BINDING_PREFIX = "ob-asset-";

/** Asset types that may become executable skills after install+enable. */
export const EXECUTABLE_ASSET_TYPES: ReadonlySet<AssetType> = new Set([
  "capability",
  "workflow",
  "prompt",
  "template",
  "agent",
  "tool",
  "mcp",
]);

/**
 * Lifecycles that must never enter the execution projection.
 * draft is incomplete; rejected/retired are withdrawn.
 * reviewing stays executable: the owner already submitted a complete asset and may
 * install it onto their own robots while enterprise review is pending.
 */
export const NON_EXECUTABLE_LIFECYCLES: ReadonlySet<SkillLifecycleState> = new Set([
  "draft",
  "rejected",
  "retired",
]);

/** Lifecycles allowed into SkillExecutionBinding materialisation. */
export const EXECUTABLE_LIFECYCLES: ReadonlySet<SkillLifecycleState> = new Set([
  "private",
  "reviewing",
  "approved",
  "published",
]);

export type SkillExecutionBindingRecord = {
  agentId: string;
  skillId: string;
  skillName: string;
  /** Pinned skill version. SAR runs keep this when the catalog head moves. */
  installedVersion: string;
  /**
   * SAR artifact digest pinned at install. Absent for ordinary lifecycle skills.
   * Catalog upgrades must not replace it.
   */
  artifactDigest?: string;
  enabled: boolean;
  materialisedPath: string;
  updatedAtMs: number;
};

export type SyncSkillExecutionBindingResult = {
  action: "materialised" | "removed" | "skipped";
  reason?: string;
  skillName?: string;
  materialisedPath?: string;
};
